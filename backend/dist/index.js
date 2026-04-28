"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const path_1 = __importDefault(require("path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const client_1 = require("@prisma/client");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const geoip_lite_1 = __importDefault(require("geoip-lite"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const dimension_analytics_1 = require("./dimension-analytics");
const dashboard_summary_1 = require("./dashboard-summary");
const commerce_analytics_1 = require("./commerce-analytics");
const traffic_peak_hours_1 = require("./traffic-peak-hours");
const openapi_spec_1 = require("./openapi-spec");
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const PORT = process.env.PORT || 3001;
/** Khóa cố định: đặt TRACKING_API_KEY trong .env (production bắt buộc đổi khỏi default). */
const API_KEY = process.env.TRACKING_API_KEY || 'default_secret_key';
const IS_PROD = process.env.NODE_ENV === 'production';
const API_PUBLIC_BASE = (process.env.API_PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const DB_BACKUP_MAX_SIZE_MB = Math.max(1, parseInt(process.env.DB_BACKUP_MAX_SIZE_MB || '100', 10) || 100);
const DB_BACKUP_MAX_SIZE_BYTES = DB_BACKUP_MAX_SIZE_MB * 1024 * 1024;
/** Mặc định chỉ tải phiên trong N ngày gần đây (tránh OOM). */
const ANALYTICS_DEFAULT_DAYS = Math.min(Math.max(parseInt(process.env.ANALYTICS_DEFAULT_DAYS || '30', 10) || 30, 1), 365);
const ANALYTICS_MAX_LIMIT = Math.min(Math.max(parseInt(process.env.ANALYTICS_MAX_LIMIT || '8000', 10) || 8000, 100), 50000);
const ANALYTICS_MAX_EVENTS_PER_SESSION = Math.min(Math.max(parseInt(process.env.ANALYTICS_MAX_EVENTS_PER_SESSION || '4000', 10) || 4000, 100), 50000);
/** TTL cache JSON tổng hợp dimension (giây). 0 = không cache. */
const ANALYTICS_DIMENSION_CACHE_TTL_SEC = Math.max(0, parseInt(process.env.ANALYTICS_DIMENSION_CACHE_TTL_SEC || '90', 10) || 0);
const isMissingAnalyticsDimensionCacheTable = (error) => {
    const msg = error instanceof Error ? error.message : String(error || '');
    return msg.includes('AnalyticsDimensionCache') && msg.includes('does not exist');
};
/** Tối đa số dòng dimension trả về mỗi request khi dùng rowsPageSize (tránh payload quá lớn). */
const DIMENSION_ROWS_PAGE_MAX = Math.min(5000, ANALYTICS_MAX_LIMIT);
/**
 * Giới hạn số phiên quét cho dashboardKpis trong GET /active-users (giảm RAM/CPU).
 * Không đặt = chỉ bị giới hạn bởi `limit` query (mặc định như analytics).
 */
function parseActiveUsersKpiEnvCap() {
    const raw = process.env.ACTIVE_USERS_KPI_MAX_SESSIONS;
    if (raw == null || String(raw).trim() === '')
        return null;
    const v = parseInt(String(raw), 10);
    if (Number.isNaN(v) || v < 1)
        return null;
    return Math.min(v, ANALYTICS_MAX_LIMIT);
}
const ACTIVE_USERS_KPI_ENV_CAP = parseActiveUsersKpiEnvCap();
function resolveActiveUsersKpiSessionTake(req, sessionLimitFromQuery) {
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
function parseDimensionRowsPagination(req) {
    const pnRaw = req.query.rowsPageNumber;
    const psRaw = req.query.rowsPageSize;
    const hasPaged = (pnRaw != null && String(pnRaw).trim() !== '') || (psRaw != null && String(psRaw).trim() !== '');
    if (!hasPaged)
        return null;
    let pageNumber = parseInt(String(pnRaw ?? '1'), 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1)
        pageNumber = 1;
    let pageSize = parseInt(String(psRaw ?? '50'), 10);
    if (Number.isNaN(pageSize) || pageSize < 1)
        pageSize = 50;
    pageSize = Math.min(pageSize, DIMENSION_ROWS_PAGE_MAX);
    return { pageNumber, pageSize };
}
function applyDimensionRowsPage(fullRows, page) {
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
function parseAnalyticsSince(req) {
    if (req.query.since != null && String(req.query.since).trim() !== '') {
        const since = new Date(String(req.query.since));
        if (Number.isNaN(since.getTime())) {
            return new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
        }
        return since;
    }
    return new Date(Date.now() - ANALYTICS_DEFAULT_DAYS * 86400000);
}
function parseAnalyticsSinceLimit(req) {
    let limit = parseInt(String(req.query.limit ?? ''), 10);
    if (Number.isNaN(limit) || limit < 1)
        limit = Math.min(5000, ANALYTICS_MAX_LIMIT);
    limit = Math.min(limit, ANALYTICS_MAX_LIMIT);
    return { since: parseAnalyticsSince(req), limit };
}
/**
 * Không gửi pageNumber/pageSize → legacy: trả mảng Session[], dùng `limit`.
 * Có pageNumber hoặc pageSize → phân trang: trả { items, meta }.
 */
function parseAnalyticsSessionsListQuery(req) {
    const since = parseAnalyticsSince(req);
    const pnRaw = req.query.pageNumber;
    const psRaw = req.query.pageSize;
    const hasPaged = (pnRaw != null && String(pnRaw).trim() !== '') || (psRaw != null && String(psRaw).trim() !== '');
    if (hasPaged) {
        let pageNumber = parseInt(String(pnRaw ?? '1'), 10);
        if (Number.isNaN(pageNumber) || pageNumber < 1)
            pageNumber = 1;
        let pageSize = parseInt(String(psRaw ?? '50'), 10);
        if (Number.isNaN(pageSize) || pageSize < 1)
            pageSize = 50;
        pageSize = Math.min(pageSize, ANALYTICS_MAX_LIMIT);
        return { kind: 'paged', since, pageNumber, pageSize };
    }
    let limit = parseInt(String(req.query.limit ?? ''), 10);
    if (Number.isNaN(limit) || limit < 1)
        limit = Math.min(5000, ANALYTICS_MAX_LIMIT);
    limit = Math.min(limit, ANALYTICS_MAX_LIMIT);
    return { kind: 'legacy', since, limit };
}
function toSessionAggList(rows) {
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
            properties: e.properties,
        })),
    }));
}
if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
}));
app.use(express_1.default.json({ limit: process.env.JSON_BODY_LIMIT || '256kb' }));
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
const snippetStaticDir = process.env.SNIPPET_DIR != null && process.env.SNIPPET_DIR !== ''
    ? path_1.default.resolve(process.env.SNIPPET_DIR)
    : path_1.default.join(__dirname, '../../snippet');
app.use('/snippet', express_1.default.static(snippetStaticDir));
if (IS_PROD && API_KEY === 'default_secret_key') {
    console.warn('[security] TRACKING_API_KEY đang là default — hãy đặt khóa mạnh trong production.');
}
const openApiDocument = (0, openapi_spec_1.buildOpenApiDocument)(API_PUBLIC_BASE);
if (process.env.ENABLE_SWAGGER !== '0') {
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(openApiDocument, { swaggerOptions: { persistAuthorization: true } }));
    app.get('/openapi.json', (_req, res) => {
        res.json(openApiDocument);
    });
}
const apiKeyMiddleware = (req, res, next) => {
    const raw = req.headers['x-api-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (key !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
};
function resolveDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !databaseUrl.trim()) {
        throw new Error('DATABASE_URL is missing.');
    }
    return databaseUrl;
}
function buildBackupFileName() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `tracking-backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.sql`;
}
app.get('/api/v1/db/backup', apiKeyMiddleware, async (_req, res) => {
    try {
        const databaseUrl = resolveDatabaseUrl();
        const backupFileName = buildBackupFileName();
        const args = ['--dbname', databaseUrl, '--clean', '--if-exists', '--no-owner', '--no-privileges'];
        const { stdout } = await execFileAsync('pg_dump', args, {
            env: { ...process.env, PGPASSWORD: '' },
            maxBuffer: Math.max(DB_BACKUP_MAX_SIZE_BYTES, 5 * 1024 * 1024),
        });
        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${backupFileName}"`);
        res.status(200).send(stdout);
    }
    catch (error) {
        const message = error?.stderr || error?.message || 'Failed to create DB backup';
        res.status(500).json({ error: String(message).trim() });
    }
});
app.post('/api/v1/db/backup/restore', apiKeyMiddleware, express_1.default.text({ type: '*/*', limit: `${DB_BACKUP_MAX_SIZE_MB}mb` }), async (req, res) => {
    const sql = typeof req.body === 'string' ? req.body : '';
    if (!sql.trim()) {
        return res.status(400).json({ error: 'Backup content is empty' });
    }
    const tempFilePath = path_1.default.join((0, node_os_1.tmpdir)(), `tracking-restore-${Date.now()}.sql`);
    try {
        const databaseUrl = resolveDatabaseUrl();
        await prisma.$disconnect();
        await node_fs_1.promises.writeFile(tempFilePath, sql, 'utf8');
        await execFileAsync('psql', ['--dbname', databaseUrl, '--set', 'ON_ERROR_STOP=1', '--file', tempFilePath], {
            env: { ...process.env, PGPASSWORD: '' },
            maxBuffer: Math.max(DB_BACKUP_MAX_SIZE_BYTES, 5 * 1024 * 1024),
        });
        await prisma.$connect();
        return res.json({ success: true });
    }
    catch (error) {
        const message = error?.stderr || error?.message || 'Failed to restore DB backup';
        return res.status(500).json({ error: String(message).trim() });
    }
    finally {
        try {
            await node_fs_1.promises.unlink(tempFilePath);
        }
        catch {
            /* ignore cleanup error */
        }
        try {
            await prisma.$connect();
        }
        catch {
            /* ignore reconnect error */
        }
    }
});
function resolveLocationForNewSession(req, context) {
    const ipRaw = (req.headers['x-forwarded-for'] || req.ip || context?.ip);
    const ip = (ipRaw || '').split(',')[0].trim();
    let locationStr = context?.location;
    if (!locationStr) {
        if (ip === '::1' || ip === '127.0.0.1') {
            locationStr = JSON.stringify({
                country: 'VN',
                region: 'VN-SG',
                city: 'Ho Chi Minh City',
                timezone: 'Asia/Ho_Chi_Minh',
            });
        }
        else {
            const geo = geoip_lite_1.default.lookup(ip);
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
app.post('/api/v1/track', apiKeyMiddleware, async (req, res) => {
    const { visitorId, sessionId, name, properties, context } = req.body;
    if (!visitorId || !sessionId || !name)
        return res.status(400).json({ error: 'Missing required fields' });
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
    const ipRaw = (req.headers['x-forwarded-for'] || req.ip || context?.ip);
    const ip = (ipRaw || '').split(',')[0].trim();
    const ua = (req.headers['user-agent'] || context?.userAgent);
    const device = context?.device;
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/v1/identify', apiKeyMiddleware, async (req, res) => {
    let { visitorId, userId, traits } = req.body;
    if (!visitorId || !userId)
        return res.status(400).json({ error: 'Missing visitorId or userId' });
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
        if (!traits)
            traits = {};
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
            }
            catch {
                /* ignore */
            }
        }
        res.json({ success: true, mapping });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/v1/analytics/sessions', apiKeyMiddleware, async (req, res) => {
    try {
        const parsed = parseAnalyticsSessionsListQuery(req);
        const where = { startedAt: { gte: parsed.since } };
        const includeBlock = {
            events: {
                orderBy: { timestamp: 'desc' },
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * Thương mại: preview giỏ (checkout_preview) + đơn thành công (checkout_success),
 * kèm bảng xếp hạng sản phẩm — phân trang độc lập cho 2 danh sách.
 */
app.get('/api/v1/analytics/commerce', apiKeyMiddleware, async (req, res) => {
    try {
        const since = parseAnalyticsSince(req);
        const previewPage = (0, commerce_analytics_1.parseCommercePageParams)(req, 'preview');
        const successPage = (0, commerce_analytics_1.parseCommercePageParams)(req, 'success');
        const rankLimit = (0, commerce_analytics_1.parseRankEventsLimit)(req);
        const previewWhere = {
            name: 'checkout_preview',
            session: { startedAt: { gte: since } },
        };
        const successWhere = {
            name: 'checkout_success',
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
        const [previewTotal, previewEvents, successTotal, successEvents, rankPreviewRows, rankSuccessRows,] = await prisma.$transaction([
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
        const productWantRank = (0, commerce_analytics_1.tallyProductNamesFromPropertiesRows)(rankPreviewRows, 'productNames');
        const productPurchasedRank = (0, commerce_analytics_1.tallyProductNamesFromPropertiesRows)(rankSuccessRows, 'productNames');
        const previewTotalPages = previewTotal === 0 ? 0 : Math.ceil(previewTotal / previewPage.pageSize);
        const successTotalPages = successTotal === 0 ? 0 : Math.ceil(successTotal / successPage.pageSize);
        res.setHeader('X-Analytics-Since', since.toISOString());
        res.json({
            since: since.toISOString(),
            checkoutPreview: {
                items: previewEvents.map(commerce_analytics_1.mapCheckoutPreviewEvent),
                total: previewTotal,
                pageNumber: previewPage.pageNumber,
                pageSize: previewPage.pageSize,
                totalPages: previewTotalPages,
            },
            checkoutSuccess: {
                items: successEvents.map(commerce_analytics_1.mapCheckoutSuccessEvent),
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * Ma trận Traffic Peak Hours (7 ngày × 24 giờ, GMT+7) — đếm phiên theo startedAt.
 */
app.get('/api/v1/analytics/traffic-peak-hours', apiKeyMiddleware, async (req, res) => {
    try {
        const { since, limit } = parseAnalyticsSinceLimit(req);
        const sessions = await prisma.session.findMany({
            where: { startedAt: { gte: since } },
            select: { startedAt: true },
            orderBy: { startedAt: 'desc' },
            take: limit,
        });
        const startedAts = sessions.map((s) => s.startedAt);
        const matrix = (0, traffic_peak_hours_1.buildTrafficPeakMatrix)(startedAts);
        const maxCount = (0, traffic_peak_hours_1.matrixMaxCount)(matrix);
        res.setHeader('X-Analytics-Since', since.toISOString());
        res.setHeader('X-Analytics-Limit', String(limit));
        res.json({
            timeZone: traffic_peak_hours_1.TRAFFIC_PEAK_TIMEZONE,
            dayLabels: (0, traffic_peak_hours_1.trafficPeakDayLabelsVi)(),
            matrix,
            maxCount,
            since: since.toISOString(),
            sessionsScanned: sessions.length,
            sessionLimit: limit,
            note: 'Mỗi phiên cộng 1 vào ô (hàng = Thứ 2..CN, cột = giờ 0–23) theo startedAt tại timeZone. Chỉ gồm tối đa sessionLimit phiên mới nhất trong cửa sổ since.',
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * Tổng hợp bảng Phân tích chi tiết (Khách / Lượt xem / Phiên / Thoát / Thời gian TB).
 * Lưu snapshot JSON trong AnalyticsDimensionCache (TTL ANALYTICS_DIMENSION_CACHE_TTL_SEC).
 */
app.get('/api/v1/analytics/dimension-stats', apiKeyMiddleware, async (req, res) => {
    try {
        const dimension = (0, dimension_analytics_1.parseDimensionParam)(req.query.dimension);
        if (!dimension) {
            return res.status(400).json({
                error: 'Invalid dimension. Use: path, title, country, city, browser, os, device, language, entry, exit, referrer',
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
        const cacheKey = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(cachePayload)).digest('hex');
        const sendDimensionPayload = (fullRows, baseMeta, fromCache) => {
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
            try {
                const hit = await prisma.analyticsDimensionCache.findUnique({ where: { cacheKey } });
                if (hit && Date.now() - hit.computedAt.getTime() < ANALYTICS_DIMENSION_CACHE_TTL_SEC * 1000) {
                    const payload = hit.payload;
                    const fullRows = Array.isArray(payload.rows) ? payload.rows : [];
                    const baseMeta = payload.meta && typeof payload.meta === 'object' ? { ...payload.meta } : {};
                    return sendDimensionPayload(fullRows, baseMeta, true);
                }
            }
            catch (error) {
                if (!isMissingAnalyticsDimensionCacheTable(error))
                    throw error;
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
        const rows = (0, dimension_analytics_1.aggregateDimensionStats)(dimension, sessionsAgg, search);
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
            try {
                const payloadJson = JSON.parse(JSON.stringify(body));
                await prisma.analyticsDimensionCache.upsert({
                    where: { cacheKey },
                    create: { cacheKey, payload: payloadJson },
                    update: { payload: payloadJson, computedAt: new Date() },
                });
            }
            catch (error) {
                if (!isMissingAnalyticsDimensionCacheTable(error))
                    throw error;
            }
        }
        return sendDimensionPayload(body.rows, body.meta, false);
    }
    catch (error) {
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
        const dashboardKpis = (0, dashboard_summary_1.computeDashboardSummaryFromSessions)(slimForKpis);
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch active users' });
    }
});
app.post('/api/v1/ping', apiKeyMiddleware, async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId)
        return res.status(400).json({ error: 'Session ID required' });
    try {
        await prisma.session.update({
            where: { id: sessionId },
            data: { updatedAt: new Date(), endedAt: null },
        });
        res.json({ success: true });
    }
    catch {
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
    }
    catch (error) {
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
