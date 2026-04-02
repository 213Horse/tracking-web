import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import dotenv from 'dotenv';
import geoip from 'geoip-lite';

dotenv.config();

const app = express();
// In Prisma 7, the URL must be passed if not in schema. prisma.config.ts helps CLI but client needs it too.
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.TRACKING_API_KEY || 'default_secret_key';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key']
}));
app.use(express.json());

// Simple logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve the tracking snippet as a static file
app.use('/snippet', express.static(path.join(__dirname, '../../snippet')));

// Middleware to check API Key
const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// ... (rest of the endpoints remain the same, just keeping it concise for the fix)
app.post('/api/v1/track', apiKeyMiddleware, async (req: Request, res: Response) => {
  const { visitorId, sessionId, name, properties, context } = req.body;
  if (!visitorId || !sessionId || !name) return res.status(400).json({ error: 'Missing required fields' });
  try {
    // Ensure visitor exists (or create if not)
    await prisma.visitor.upsert({ where: { id: visitorId }, update: {}, create: { id: visitorId } });

    // Update session or create new one
    let session = await prisma.session.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      const ipRaw = (req.headers['x-forwarded-for'] || req.ip || context?.ip) as string;
      const ip = (ipRaw || '').split(',')[0].trim();
      let locationStr = context?.location as string;

      if (!locationStr) {
        if (ip === '::1' || ip === '127.0.0.1') {
          locationStr = JSON.stringify({ country: 'VN', region: 'VN-SG', city: 'Ho Chi Minh City', timezone: 'Asia/Ho_Chi_Minh' });
        } else {
          const geo = geoip.lookup(ip);
          if (geo) {
            locationStr = JSON.stringify({ country: geo.country, region: geo.region, city: geo.city, timezone: geo.timezone });
          }
        }
      }

      session = await prisma.session.create({
        data: {
          id: sessionId,
          visitorId: visitorId,
          userAgent: (req.headers['user-agent'] || context?.userAgent) as string,
          device: context?.device as string,
          ip: ip,
          location: locationStr,
        }
      });
    } else {
      // Update updatedAt to track "last seen" and clear endedAt just in case it was briefly closed
      await prisma.session.update({
        where: { id: sessionId },
        data: { updatedAt: new Date(), endedAt: null }
      });
    }

    // Merge context.url into properties to ensure it's available in dashboard
    const mergedProperties = { ...(properties || {}) };
    if (context?.url && !mergedProperties.url) {
      mergedProperties.url = context.url;
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        sessionId,
        name,
        properties: mergedProperties,
        timestamp: context?.timestamp ? new Date(context.timestamp) : new Date()
      }
    });
    res.status(201).json({ success: true, eventId: event.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/identify', apiKeyMiddleware, async (req: Request, res: Response) => {
  let { visitorId, userId, traits } = req.body;
  if (!visitorId || !userId) return res.status(400).json({ error: 'Missing visitorId or userId' });
  
  // Sticky Identity: Check if visitor is already mapped to an ERP ID
  const existingMapping = await prisma.identityMapping.findUnique({
    where: { visitorId },
    include: { user: true }
  });

  // Prioritize ERP ID from payload or fallback to existing bound ERP ID
  let extractedErpId = traits?.erpId || traits?.erpid || traits?.erp_id;
  if (!extractedErpId && existingMapping?.user?.erpId) {
    extractedErpId = existingMapping.user.erpId; // STICKY: Do not downgrade!
  }

  if (extractedErpId) {
    userId = extractedErpId; // Override UUID with ERP ID
    if (!traits) traits = {};
    traits.erpId = extractedErpId;
  }

  try {
    const user = await prisma.user.upsert({ 
      where: { id: userId }, 
      update: { 
        email: traits?.email,
        name: traits?.name || (traits?.firstname ? `${traits?.firstname} ${traits?.lastname || ''}`.trim() : undefined),
        erpId: extractedErpId,
        traits: traits || {}
      }, 
      create: { 
        id: userId, 
        email: traits?.email,
        name: traits?.name || (traits?.firstname ? `${traits?.firstname} ${traits?.lastname || ''}`.trim() : undefined),
        erpId: extractedErpId,
        traits: traits || {}
      } 
    });
    const mapping = await prisma.identityMapping.upsert({ where: { visitorId }, update: { userId }, create: { visitorId, userId } });

    // Clean up orphaned UUID user if a merge happened
    if (req.body.userId !== userId) {
      try {
        const orphanLinks = await prisma.identityMapping.count({ where: { userId: req.body.userId }});
        if (orphanLinks === 0) {
          await prisma.user.delete({ where: { id: req.body.userId }});
        }
      } catch (e) { /* ignore */ }
    }

    res.json({ success: true, mapping });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/analytics/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      include: {
        events: true,
        visitor: { include: { identityMapping: { include: { user: true } } } }
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get active users (last 1 minute)
app.get('/api/v1/active-users', async (req, res) => {
  try {
    const activeWindow = new Date(Date.now() - 60 * 1000); // 1 minute window for active presence
    const count = await prisma.session.count({
      where: {
        updatedAt: {
          gt: activeWindow
        },
        endedAt: null // Explicitly not ended
      }
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active users' });
  }
});

// Session Heartbeat Ping
app.post('/api/v1/ping', apiKeyMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date(), endedAt: null }
    });
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false }); // Ignore errors if session missing
  }
});

// Explicit session end
app.post('/api/v1/session-end', apiKeyMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { endedAt: new Date() }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

app.listen(PORT, () => {
  console.log(`Tracking server running on port ${PORT}`);
});
