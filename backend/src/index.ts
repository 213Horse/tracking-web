import express, { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import geoip from 'geoip-lite';
import swaggerUi from 'swagger-ui-express';
import { aggregateDimensionStats, parseDimensionParam, type SessionAgg } from './dimension-analytics';
import { computeDashboardSummaryFromSessions } from './dashboard-summary';
import {
  mapCheckoutPreviewEvent,
  mapCheckoutSuccessEvent,
  parseCommercePageParams,
  parseRankEventsLimit,
  tallyProductNamesFromPropertiesRows,
} from './commerce-analytics';
import {
  TRAFFIC_PEAK_TIMEZONE,
  buildTrafficPeakMatrix,
  matrixMaxCount,
  trafficPeakDayLabelsVi,
} from './traffic-peak-hours';
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
/** TTL cache JSON tổng hợp dimension (giây). 0 = không cache. */
const ANALYTICS_DIMENSION_CACHE_TTL_SEC = Math.max(
  0,
  parseInt(process.env.ANALYTICS_DIMENSION_CACHE_TTL_SEC || '90', 10) || 0
);

/** Tối đa số dòng dimension trả về mỗi request khi dùng rowsPageSize (tránh payload quá lớn). */
const DIMENSION_ROWS_PAGE_MAX = Math.min(5000, ANALYTICS_MAX_LIMIT);

/**
 * Giới hạn số phiên quét cho dashboardKpis trong GET /active-users (giảm RAM/CPU).
 * Không đặt = chỉ bị giới hạn bởi `limit` query (mặc định như analytics).
 */
function parseActiveUsersKpiEnvCap(): number | null {
  const raw = process.env.ACTIVE_USERS_KPI_MAX_SESSIONS;
  if (raw == null || String(raw).trim() === '') return null;
  const v = parseInt(String(raw), 10);
  if (Number.isNaN(v) || v < 1) return null;
  return Math.min(v, ANALYTICS_MAX_LIMIT);
}

const ACTIVE_USERS_KPI_ENV_CAP = parseActiveUsersKpiEnvCap();

function resolveActiveUsersKpiSessionTake(req: Request, sessionLimitFromQuery: number): number {
  let take = Math.min(sessionLimitFromQuery, ANALYTICS_MAX_LIMIT);
  if (ACTIVE_USERS_KPI_ENV_CAP != null) {
    take = Math.min(take, ACTIVE_USERS_KPI_ENV_CAP);
  }
  const q = req.query.kpiSessionLimit;
  if (q != null && String(q).trim() !== '') {
    const v = parseInt(String(q), 10);
    if (!Number.isNaN(v) && v >= 1) {
      take = Math.min(take, Math.min(v, ANALYTICS_MAX_LIMIT));
    }
  }
  return Math.max(1, take);
}

/**
 * Phân trang mảng `rows` của dimension-stats (sau khi tổng hợp — giảm kích thước HTTP).
 * Không giảm tải DB: vẫn đọc tối đa `limit` phiên để build full rows (cache lưu full rows).
 */
function parseDimensionRowsPagination(req: Request): { pageNumber: number; pageSize: number } | null {
  const pnRaw = req.query.rowsPageNumber;
  const psRaw = req.query.rowsPageSize;
  const hasPaged =
    (pnRaw != null && String(pnRaw).trim() !== '') || (psRaw != null && String(psRaw).trim() !== '');
  if (!hasPaged) return null;
  let pageNumber = parseInt(String(pnRaw ?? '1'), 10);
  if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
  let pageSize = parseInt(String(psRaw ?? '50'), 10);
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 50;
  pageSize = Math.min(pageSize, DIMENSION_ROWS_PAGE_MAX);
  return { pageNumber, pageSize };
}

function applyDimensionRowsPage<T>(
  fullRows: T[],
  page: { pageNumber: number; pageSize: number } | null
): {
  rows: T[];
  pageMeta: Record<string, number>;
} {
  const rowsTotal = fullRows.length;
  if (!page) {
    return { rows: fullRows, pageMeta: { rowsTotal } };
  }
  const { pageNumber, pageSize } = page;
  const rowsTotalPages = rowsTotal === 0 ? 0 : Math.ceil(rowsTotal / pageSize);
  const skip = (pageNumber - 1) * pageSize;
  return {
    rows: fullRows.slice(skip, skip + pageSize),
    pageMeta: {
      rowsTotal,
      rowsPageNumber: pageNumber,
      rowsPageSize: pageSize,
      rowsTotalPages,
    },
  };
}

function parseAnalyticsSince(req: Request): Date {
  if (req.query.since != null && String(req.query.since).trim() !== '') {
    const since = new Date(String(req.query.since));
    if (Number.isNaN(since.getTime())) {
      return new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
    }
    return since;
  }
  return new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
}

function parseAnalyticsSinceLimit(req: Request): { since: Date; limit: number } {
  let limit = parseInt(String(req.query.limit ?? ''), 10);
  if (Number.isNaN(limit) || limit < 1) limit = Math.min(5000, ANALYTICS_MAX_LIMIT);
  limit = Math.min(limit, ANALYTICS_MAX_LIMIT);
  return { since: parseAnalyticsSince(req), limit };
}

/**
 * Không gửi pageNumber/pageSize → legacy: trả mảng Session[], dùng `limit`.
 * Có pageNumber hoặc pageSize → phân trang: trả { items, meta }.
 */
function parseAnalyticsSessionsListQuery(
  req: Request
): { kind: 'legacy'; since: Date; limit: number } | { kind: 'paged'; since: Date; pageNumber: number; pageSize: number } {
  const since = parseAnalyticsSince(req);

  const pnRaw = req.query.pageNumber;
  const psRaw = req.query.pageSize;
  const hasPaged =
    (pnRaw != null && String(pnRaw).trim() !== '') || (psRaw != null && String(psRaw).trim() !== '');

  if (hasPaged) {
    let pageNumber = parseInt(String(pnRaw ?? '1'), 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
    let pageSize = parseInt(String(psRaw ?? '50'), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 50;
    pageSize = Math.min(pageSize, ANALYTICS_MAX_LIMIT);
    return { kind: 'paged', since, pageNumber, pageSize };
  }

  let limit = parseInt(String(req.query.limit ?? ''), 10);
  if (Number.isNaN(limit) || limit < 1) limit = Math.min(5000, ANALYTICS_MAX_LIMIT);
  limit = Math.min(limit, ANALYTICS_MAX_LIMIT);
  return { kind: 'legacy', since, limit };
}

function toSessionAggList(
  rows: {
    id: string;
    visitorId: string;
    startedAt: Date;
    updatedAt: Date;
    device: string | null;
    location: string | null;
    userAgent: string | null;
    events: { name: string; timestamp: Date; properties: unknown }[];
  }[]
): SessionAgg[] {
  return rows.map((s) => ({
    id: s.id,
    visitorId: s.visitorId,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    device: s.device,
    location: s.location,
    userAgent: s.userAgent,
    events: s.events.map((e) => ({
      name: e.name,
      timestamp: e.timestamp,
      properties: e.properties as Record<string, unknown> | null,
    })),
  }));
}

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
  if (context?.referrer != null && mergedProperties.referrer == null) {
    mergedProperties.referrer = context.referrer;
  }
  if (context?.language != null && mergedProperties.language == null) {
    mergedProperties.language = context.language;
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
    const parsed = parseAnalyticsSessionsListQuery(req);
    const where = { startedAt: { gte: parsed.since } };
    const includeBlock = {
      events: {
        orderBy: { timestamp: 'desc' as const },
        take: ANALYTICS_MAX_EVENTS_PER_SESSION,
      },
      visitor: { include: { identityMapping: { include: { user: true } } } },
    };

    res.setHeader('X-Analytics-Since', parsed.since.toISOString());
    res.setHeader('X-Analytics-Events-Cap', String(ANALYTICS_MAX_EVENTS_PER_SESSION));

    if (parsed.kind === 'paged') {
      const { pageNumber, pageSize } = parsed;
      const skip = (pageNumber - 1) * pageSize;

      const [total, sessions] = await prisma.$transaction([
        prisma.session.count({ where }),
        prisma.session.findMany({
          where,
          include: includeBlock,
          orderBy: { startedAt: 'desc' },
          skip,
          take: pageSize,
        }),
      ]);

      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      res.setHeader('X-Analytics-Total', String(total));
      res.setHeader('X-Analytics-Page', String(pageNumber));
      res.setHeader('X-Analytics-Page-Size', String(pageSize));
      res.setHeader('X-Analytics-Page-Count', String(totalPages));

      return res.json({
        items: sessions,
        meta: {
          total,
          pageNumber,
          pageSize,
          totalPages,
          since: parsed.since.toISOString(),
          eventsCapPerSession: ANALYTICS_MAX_EVENTS_PER_SESSION,
        },
      });
    }

    const sessions = await prisma.session.findMany({
      where,
      include: includeBlock,
      orderBy: { startedAt: 'desc' },
      take: parsed.limit,
    });

    res.setHeader('X-Analytics-Limit', String(parsed.limit));

    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Thương mại: preview giỏ (checkout_preview) + đơn thành công (checkout_success),
 * kèm bảng xếp hạng sản phẩm — phân trang độc lập cho 2 danh sách.
 */
app.get('/api/v1/analytics/commerce', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    const since = parseAnalyticsSince(req);
    const previewPage = parseCommercePageParams(req, 'preview');
    const successPage = parseCommercePageParams(req, 'success');
    const rankLimit = parseRankEventsLimit(req);

    const previewWhere = {
      name: 'checkout_preview' as const,
      session: { startedAt: { gte: since } },
    };
    const successWhere = {
      name: 'checkout_success' as const,
      session: { startedAt: { gte: since } },
    };

    const sessionInclude = {
      visitor: {
        include: {
          identityMapping: { include: { user: true } },
        },
      },
    };

    const previewSkip = (previewPage.pageNumber - 1) * previewPage.pageSize;
    const successSkip = (successPage.pageNumber - 1) * successPage.pageSize;

    const [
      previewTotal,
      previewEvents,
      successTotal,
      successEvents,
      rankPreviewRows,
      rankSuccessRows,
    ] = await prisma.$transaction([
      prisma.event.count({ where: previewWhere }),
      prisma.event.findMany({
        where: previewWhere,
        orderBy: { timestamp: 'desc' },
        skip: previewSkip,
        take: previewPage.pageSize,
        include: { session: { include: sessionInclude } },
      }),
      prisma.event.count({ where: successWhere }),
      prisma.event.findMany({
        where: successWhere,
        orderBy: { timestamp: 'desc' },
        skip: successSkip,
        take: successPage.pageSize,
        include: { session: { include: sessionInclude } },
      }),
      prisma.event.findMany({
        where: previewWhere,
        orderBy: { timestamp: 'desc' },
        take: rankLimit,
        select: { properties: true },
      }),
      prisma.event.findMany({
        where: successWhere,
        orderBy: { timestamp: 'desc' },
        take: rankLimit,
        select: { properties: true },
      }),
    ]);

    const productWantRank = tallyProductNamesFromPropertiesRows(rankPreviewRows, 'productNames');
    const productPurchasedRank = tallyProductNamesFromPropertiesRows(rankSuccessRows, 'productNames');

    const previewTotalPages =
      previewTotal === 0 ? 0 : Math.ceil(previewTotal / previewPage.pageSize);
    const successTotalPages =
      successTotal === 0 ? 0 : Math.ceil(successTotal / successPage.pageSize);

    res.setHeader('X-Analytics-Since', since.toISOString());

    res.json({
      since: since.toISOString(),
      checkoutPreview: {
        items: previewEvents.map(mapCheckoutPreviewEvent),
        total: previewTotal,
        pageNumber: previewPage.pageNumber,
        pageSize: previewPage.pageSize,
        totalPages: previewTotalPages,
      },
      checkoutSuccess: {
        items: successEvents.map(mapCheckoutSuccessEvent),
        total: successTotal,
        pageNumber: successPage.pageNumber,
        pageSize: successPage.pageSize,
        totalPages: successTotalPages,
      },
      productWantRank,
      productPurchasedRank,
      meta: {
        rankEventsLimit: rankLimit,
        rankPreviewEventsScanned: rankPreviewRows.length,
        rankSuccessEventsScanned: rankSuccessRows.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ma trận Traffic Peak Hours (7 ngày × 24 giờ, GMT+7) — đếm phiên theo startedAt.
 */
app.get('/api/v1/analytics/traffic-peak-hours', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    const { since, limit } = parseAnalyticsSinceLimit(req);

    const sessions = await prisma.session.findMany({
      where: { startedAt: { gte: since } },
      select: { startedAt: true },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    const startedAts = sessions.map((s) => s.startedAt);
    const matrix = buildTrafficPeakMatrix(startedAts);
    const maxCount = matrixMaxCount(matrix);

    res.setHeader('X-Analytics-Since', since.toISOString());
    res.setHeader('X-Analytics-Limit', String(limit));

    res.json({
      timeZone: TRAFFIC_PEAK_TIMEZONE,
      dayLabels: trafficPeakDayLabelsVi(),
      matrix,
      maxCount,
      since: since.toISOString(),
      sessionsScanned: sessions.length,
      sessionLimit: limit,
      note:
        'Mỗi phiên cộng 1 vào ô (hàng = Thứ 2..CN, cột = giờ 0–23) theo startedAt tại timeZone. Chỉ gồm tối đa sessionLimit phiên mới nhất trong cửa sổ since.',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Tổng hợp bảng Phân tích chi tiết (Khách / Lượt xem / Phiên / Thoát / Thời gian TB).
 * Lưu snapshot JSON trong AnalyticsDimensionCache (TTL ANALYTICS_DIMENSION_CACHE_TTL_SEC).
 */
app.get('/api/v1/analytics/dimension-stats', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    const dimension = parseDimensionParam(req.query.dimension as string);
    if (!dimension) {
      return res.status(400).json({
        error:
          'Invalid dimension. Use: path, title, country, city, browser, os, device, language, entry, exit, referrer',
      });
    }

    const { since, limit } = parseAnalyticsSinceLimit(req);
    const search = String(req.query.search ?? '');
    const rowsPage = parseDimensionRowsPagination(req);

    res.setHeader('X-Analytics-Since', since.toISOString());
    res.setHeader('X-Analytics-Limit', String(limit));
    res.setHeader('X-Analytics-Events-Cap', String(ANALYTICS_MAX_EVENTS_PER_SESSION));

    const cachePayload = {
      dimension,
      since: since.toISOString(),
      limit,
      eventsCap: ANALYTICS_MAX_EVENTS_PER_SESSION,
      search,
    };
    const cacheKey = createHash('sha256').update(JSON.stringify(cachePayload)).digest('hex');

    const sendDimensionPayload = (
      fullRows: unknown[],
      baseMeta: Record<string, unknown>,
      fromCache: boolean
    ) => {
      const { rows: pagedRows, pageMeta } = applyDimensionRowsPage(fullRows, rowsPage);
      if (rowsPage) {
        res.setHeader('X-Analytics-Rows-Total', String(pageMeta.rowsTotal));
        res.setHeader('X-Analytics-Rows-Page', String(pageMeta.rowsPageNumber));
        res.setHeader('X-Analytics-Rows-Page-Size', String(pageMeta.rowsPageSize));
        res.setHeader('X-Analytics-Rows-Page-Count', String(pageMeta.rowsTotalPages));
      }
      return res.json({
        rows: pagedRows,
        meta: { ...baseMeta, ...pageMeta, fromCache },
      });
    };

    if (ANALYTICS_DIMENSION_CACHE_TTL_SEC > 0) {
      const hit = await prisma.analyticsDimensionCache.findUnique({ where: { cacheKey } });
      if (hit && Date.now() - hit.computedAt.getTime() < ANALYTICS_DIMENSION_CACHE_TTL_SEC * 1000) {
        const payload = hit.payload as { rows?: unknown[]; meta?: Record<string, unknown> };
        const fullRows = Array.isArray(payload.rows) ? payload.rows : [];
        const baseMeta = payload.meta && typeof payload.meta === 'object' ? { ...payload.meta } : {};
        return sendDimensionPayload(fullRows, baseMeta, true);
      }
    }

    const slim = await prisma.session.findMany({
      where: { startedAt: { gte: since } },
      select: {
        id: true,
        visitorId: true,
        startedAt: true,
        updatedAt: true,
        device: true,
        location: true,
        userAgent: true,
        events: {
          orderBy: { timestamp: 'desc' },
          take: ANALYTICS_MAX_EVENTS_PER_SESSION,
          select: { name: true, timestamp: true, properties: true },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    const sessionsAgg = toSessionAggList(slim);
    const rows = aggregateDimensionStats(dimension, sessionsAgg, search);

    const body = {
      rows,
      meta: {
        dimension,
        since: since.toISOString(),
        sessionLimit: limit,
        eventsCapPerSession: ANALYTICS_MAX_EVENTS_PER_SESSION,
        computedAt: new Date().toISOString(),
        fromCache: false,
      },
    };

    if (ANALYTICS_DIMENSION_CACHE_TTL_SEC > 0) {
      const payloadJson = JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
      await prisma.analyticsDimensionCache.upsert({
        where: { cacheKey },
        create: { cacheKey, payload: payloadJson },
        update: { payload: payloadJson, computedAt: new Date() },
      });
    }

    return sendDimensionPayload(body.rows, body.meta, false);
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

    const { since, limit } = parseAnalyticsSinceLimit(req);
    const kpiSessionsScanned = resolveActiveUsersKpiSessionTake(req, limit);

    const sessionWhere = { startedAt: { gte: since } };
    const [sessionsInWindow, slimForKpis] = await prisma.$transaction([
      prisma.session.count({ where: sessionWhere }),
      prisma.session.findMany({
        where: sessionWhere,
        select: {
          visitorId: true,
          startedAt: true,
          updatedAt: true,
          events: {
            orderBy: { timestamp: 'desc' },
            take: ANALYTICS_MAX_EVENTS_PER_SESSION,
            select: { name: true },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: kpiSessionsScanned,
      }),
    ]);

    const dashboardKpis = computeDashboardSummaryFromSessions(slimForKpis);

    res.setHeader('X-Analytics-Since', since.toISOString());
    res.setHeader('X-Analytics-Limit', String(limit));
    res.setHeader('X-Analytics-Events-Cap', String(ANALYTICS_MAX_EVENTS_PER_SESSION));
    res.setHeader('X-Analytics-Kpi-Sessions-Scanned', String(kpiSessionsScanned));

    res.json({
      count,
      since: since.toISOString(),
      sessionLimit: limit,
      kpiSessionsScanned,
      sessionsInWindow,
      kpiApproximate: sessionsInWindow > kpiSessionsScanned,
      eventsCapPerSession: ANALYTICS_MAX_EVENTS_PER_SESSION,
      dashboardKpis: dashboardKpis,
    });
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
