const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.TRACKING_API_KEY || 'default_secret_key';

app.use(cors());
app.use(express.json());

// Middleware to check API Key
const apiKeyMiddleware = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// 1. Log a new event
app.post('/api/v1/track', apiKeyMiddleware, async (req, res) => {
  const { visitorId, sessionId, name, properties, context } = req.body;

  if (!visitorId || !sessionId || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Upsert visitor
    const visitor = await prisma.visitor.upsert({
      where: { id: visitorId },
      update: {},
      create: { id: visitorId },
    });

    // Get or create session
    let session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      session = await prisma.session.create({
        data: {
          id: sessionId,
          visitorId: visitor.id,
          ip: req.ip || context?.ip,
          userAgent: req.headers['user-agent'] || context?.userAgent,
          device: context?.device,
          location: context?.location,
        },
      });
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        sessionId: session.id,
        name,
        properties: properties || {},
      },
    });

    res.status(201).json({ success: true, eventId: event.id });
  } catch (error) {
    console.error('Track error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Identify a user (Identity Stitching)
app.post('/api/v1/identify', apiKeyMiddleware, async (req, res) => {
  const { visitorId, userId, traits } = req.body;

  if (!visitorId || !userId) {
    return res.status(400).json({ error: 'Missing visitorId or userId' });
  }

  try {
    // Create/Update user
    const user = await prisma.user.upsert({
      where: { id: userId },
      update: { email: traits?.email },
      create: { id: userId, email: traits?.email },
    });

    // Create identity mapping
    const mapping = await prisma.identityMapping.upsert({
      where: { visitorId },
      update: { userId },
      create: { visitorId, userId },
    });

    res.json({ success: true, mapping });
  } catch (error) {
    console.error('Identify error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Analytics: Get all sessions with events
app.get('/api/v1/analytics/sessions', async (req, res) => {
  try {
    const sessions = await prisma.session.findMany({
      include: {
        events: true,
        visitor: {
          include: {
            identityMapping: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: { startedAt: 'desc' },
    });

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Tracking server running on port ${PORT}`);
});
