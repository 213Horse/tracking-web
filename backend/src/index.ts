import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import geoip from 'geoip-lite';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi-spec';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;
/** Khóa cố định: đặt TRACKING_API_KEY trong .env (production bắt buộc đổi khỏi default). */
const API_KEY = process.env.TRACKING_API_KEY || 'default_secret_key';
const IS_PROD = process.env.NODE_ENV === 'production';
const API_PUBLIC_BASE = (process.env.API_PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

/** Mặc định chỉ tải phiên trong N ngày gần đây (tránh OOM). */
const ANALYTICS_DEFAULT_DAYS = Math.min(
  Math.max(parseInt(process.env.ANALYTICS_DEFAULT_DAYS || '30', 10) || 30, 1),
  365
);
const ANALYTICS_MAX_LIMIT = Math.min(
  Math.max(parseInt(process.env.ANALYTICS_MAX_LIMIT || '8000', 10) || 8000, 100),
  50000
);
const ANALYTICS_MAX_EVENTS_PER_SESSION = Math.min(
  Math.max(parseInt(process.env.ANALYTICS_MAX_EVENTS_PER_SESSION || '4000', 10) || 4000, 100),
  50000
);

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '256kb' }));

/** Liveness: không cần API key (monitoring, Nginx, curl sau deploy). */
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

if (!IS_PROD) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
}

const snippetStaticDir =
  process.env.SNIPPET_DIR != null && process.env.SNIPPET_DIR !== ''
    ? path.resolve(process.env.SNIPPET_DIR)
    : path.join(__dirname, '../../snippet');
app.use('/snippet', express.static(snippetStaticDir));

if (IS_PROD && API_KEY === 'default_secret_key') {
  console.warn('[security] TRACKING_API_KEY đang là default — hãy đặt khóa mạnh trong production.');
}

const openApiDocument = buildOpenApiDocument(API_PUBLIC_BASE);
if (process.env.ENABLE_SWAGGER !== '0') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { swaggerOptions: { persistAuthorization: true } }));
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
}

const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const raw = req.headers['x-api-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

function resolveLocationForNewSession(req: Request, context: any): string | undefined {
  const ipRaw = (req.headers['x-forwarded-for'] || req.ip || context?.ip) as string;
  const ip = (ipRaw || '').split(',')[0].trim();
  let locationStr = context?.location as string;

  if (!locationStr) {
    if (ip === '::1' || ip === '127.0.0.1') {
      locationStr = JSON.stringify({
        country: 'VN',
        region: 'VN-SG',
        city: 'Ho Chi Minh City',
        timezone: 'Asia/Ho_Chi_Minh',
      });
    } else {
      const geo = geoip.lookup(ip);
      if (geo) {
        locationStr = JSON.stringify({
          country: geo.country,
          region: geo.region,
          city: geo.city,
          timezone: geo.timezone,
        });
      }
    }
  }
  return locationStr;
}

/**
 * Ghi event: transaction + không UPDATE Session mỗi lần (giảm ~1 write/event).
 * Cập nhật "đang online" dùng POST /ping (nhẹ hơn và không tạo row Event).
 */
app.post('/api/v1/track', apiKeyMiddleware, async (req: Request, res: Response) => {
  const { visitorId, sessionId, name, properties, context } = req.body;
  if (!visitorId || !sessionId || !name) return res.status(400).json({ error: 'Missing required fields' });

  const mergedProperties = { ...(properties || {}) };
  if (context?.url && !mergedProperties.url) {
    mergedProperties.url = context.url;
  }

  const ipRaw = (req.headers['x-forwarded-for'] || req.ip || context?.ip) as string;
  const ip = (ipRaw || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || context?.userAgent) as string;
  const device = context?.device as string;
  const locationStr = resolveLocationForNewSession(req, context);

  try {
    const event = await prisma.$transaction(async (tx) => {
      await tx.visitor.upsert({
        where: { id: visitorId },
        update: {},
        create: { id: visitorId },
      });

      const existing = await tx.session.findUnique({ where: { id: sessionId } });
      if (!existing) {
        await tx.session.create({
          data: {
            id: sessionId,
            visitorId,
            userAgent: ua,
            device,
            ip: ip || undefined,
            location: locationStr,
          },
        });
      }

      return tx.event.create({
        data: {
          sessionId,
          name,
          properties: mergedProperties,
          timestamp: context?.timestamp ? new Date(context.timestamp) : new Date(),
        },
      });
    });

    res.status(201).json({ success: true, eventId: event.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/identify', apiKeyMiddleware, async (req: Request, res: Response) => {
  let { visitorId, userId, traits } = req.body;
  if (!visitorId || !userId) return res.status(400).json({ error: 'Missing visitorId or userId' });

  const existingMapping = await prisma.identityMapping.findUnique({
    where: { visitorId },
    include: { user: true },
  });

  let extractedErpId = traits?.erpId || traits?.erpid || traits?.erp_id;
  if (!extractedErpId && existingMapping?.user?.erpId) {
    extractedErpId = existingMapping.user.erpId;
  }

  if (extractedErpId) {
    userId = extractedErpId;
    if (!traits) traits = {};
    traits.erpId = extractedErpId;
  }

  try {
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        email: traits?.email,
        name: traits?.name || (traits?.firstname ? `${traits?.firstname} ${traits?.lastname || ''}`.trim() : undefined),
        erpId: extractedErpId,
        traits: traits || {},
      },
      create: {
        id: userId,
        email: traits?.email,
        name: traits?.name || (traits?.firstname ? `${traits?.firstname} ${traits?.lastname || ''}`.trim() : undefined),
        erpId: extractedErpId,
        traits: traits || {},
      },
    });
    const mapping = await prisma.identityMapping.upsert({
      where: { visitorId },
      update: { userId },
      create: { visitorId, userId },
    });

    if (req.body.userId !== userId) {
      try {
        const orphanLinks = await prisma.identityMapping.count({ where: { userId: req.body.userId } });
        if (orphanLinks === 0) {
          await prisma.user.delete({ where: { id: req.body.userId } });
        }
      } catch {
        /* ignore */
      }
    }

    res.json({ success: true, mapping });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/analytics/sessions', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    let limit = parseInt(String(req.query.limit ?? ''), 10);
    if (Number.isNaN(limit) || limit < 1) limit = Math.min(5000, ANALYTICS_MAX_LIMIT);
    limit = Math.min(limit, ANALYTICS_MAX_LIMIT);

    let since: Date;
    if (req.query.since != null && String(req.query.since).trim() !== '') {
      since = new Date(String(req.query.since));
      if (Number.isNaN(since.getTime())) {
        since = new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
      }
    } else {
      since = new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
    }

    const sessions = await prisma.session.findMany({
      where: { startedAt: { gte: since } },
      include: {
        events: {
          orderBy: { timestamp: 'desc' },
          take: ANALYTICS_MAX_EVENTS_PER_SESSION,
        },
        visitor: { include: { identityMapping: { include: { user: true } } } },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    res.setHeader('X-Analytics-Since', since.toISOString());
    res.setHeader('X-Analytics-Limit', String(limit));
    res.setHeader('X-Analytics-Events-Cap', String(ANALYTICS_MAX_EVENTS_PER_SESSION));

    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/active-users', apiKeyMiddleware, async (req, res) => {
  try {
    const activeWindow = new Date(Date.now() - 60 * 1000);
    const count = await prisma.session.count({
      where: {
        updatedAt: { gt: activeWindow },
        endedAt: null,
      },
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active users' });
  }
});

app.post('/api/v1/ping', apiKeyMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date(), endedAt: null },
    });
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

app.post('/api/v1/session-end', apiKeyMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Tracking server on port ${PORT} (analytics window default ${ANALYTICS_DEFAULT_DAYS}d, max ${ANALYTICS_MAX_LIMIT} sessions)`);
  if (process.env.ENABLE_SWAGGER !== '0') {
    console.log(`Swagger UI: ${API_PUBLIC_BASE}/api-docs   | OpenAPI JSON: ${API_PUBLIC_BASE}/openapi.json`);
  }
});

const shutdown = () => {
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
