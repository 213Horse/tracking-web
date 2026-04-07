/**
 * OpenAPI 3 — Tracking API (x-api-key trên mọi endpoint).
 * `servers[0].url` được gán động trong index từ API_PUBLIC_URL.
 */
export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
  const root = baseUrl.replace(/\/$/, '');
  return {
    openapi: '3.0.3',
    info: {
      title: 'TrackFlow Tracking API',
      version: '1.0.0',
      description:
        'API ghi nhận hành vi, nhận diện user và đọc analytics. **Mọi endpoint đều cần header `x-api-key`** trùng với biến môi trường `TRACKING_API_KEY` trên server.',
    },
    servers: [{ url: root, description: 'Máy chủ tracking' }],
    tags: [
      { name: 'Ingest', description: 'Ghi event, ping, identify (từ snippet hoặc server khác)' },
      { name: 'Analytics', description: 'Đọc dữ liệu dashboard / báo cáo' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Khóa cố định do bạn cấu hình (TRACKING_API_KEY).',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/api/v1/track': {
        post: {
          tags: ['Ingest'],
          summary: 'Ghi một event',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['visitorId', 'sessionId', 'name'],
                  properties: {
                    visitorId: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
                    sessionId: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
                    name: { type: 'string', example: 'pageview' },
                    properties: { type: 'object', additionalProperties: true },
                    context: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Đã lưu', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { description: 'Thiếu trường bắt buộc' },
            '401': { description: 'Sai hoặc thiếu API key' },
          },
        },
      },
      '/api/v1/identify': {
        post: {
          tags: ['Ingest'],
          summary: 'Gắn visitor với user (ERP / email / tên)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['visitorId', 'userId'],
                  properties: {
                    visitorId: { type: 'string' },
                    userId: { type: 'string' },
                    traits: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'OK' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/ping': {
        post: {
          tags: ['Ingest'],
          summary: 'Cập nhật phiên đang hoạt động (heartbeat nhẹ)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId'],
                  properties: { sessionId: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'OK' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/session-end': {
        post: {
          tags: ['Ingest'],
          summary: 'Đánh dấu kết thúc phiên',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sessionId: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'OK' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/analytics/sessions': {
        get: {
          tags: ['Analytics'],
          summary:
            'Danh sách phiên + events — legacy `limit` hoặc phân trang `pageNumber` + `pageSize`',
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'Chỉ lấy phiên có startedAt >= since (ISO 8601). Mặc định theo ANALYTICS_DEFAULT_DAYS trên server.',
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Chế độ legacy (không dùng pageNumber/pageSize): số phiên tối đa, trả về mảng JSON. Bị cap bởi ANALYTICS_MAX_LIMIT.',
            },
            {
              name: 'pageNumber',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Phân trang: trang bắt đầu từ 1. Nếu có pageNumber hoặc pageSize → response là object { items, meta }, không phải mảng.',
            },
            {
              name: 'pageSize',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Số phiên mỗi trang (mặc định 50 nếu chỉ gửi pageNumber). Tối đa ANALYTICS_MAX_LIMIT.',
            },
          ],
          responses: {
            '200': {
              description:
                'Không phân trang: mảng Session[]. Có pageNumber/pageSize: { items: Session[], meta: { total, pageNumber, pageSize, totalPages, since, eventsCapPerSession } }',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
                'X-Analytics-Events-Cap': { schema: { type: 'string' } },
                'X-Analytics-Limit': {
                  schema: { type: 'string' },
                  description: 'Chỉ khi chế độ legacy (limit)',
                },
                'X-Analytics-Total': {
                  schema: { type: 'string' },
                  description: 'Chỉ khi phân trang',
                },
                'X-Analytics-Page': { schema: { type: 'string' } },
                'X-Analytics-Page-Size': { schema: { type: 'string' } },
                'X-Analytics-Page-Count': { schema: { type: 'string' } },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/analytics/commerce': {
        get: {
          tags: ['Analytics'],
          summary:
            'Thương mại: checkout_preview + checkout_success (2 danh sách phân trang độc lập) + xếp hạng sản phẩm',
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'Lọc theo session.startedAt >= since (giống analytics khác).',
            },
            { name: 'previewPageNumber', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Trang preview giỏ, mặc định 1' },
            { name: 'previewPageSize', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Mặc định 25, tối đa 500' },
            { name: 'successPageNumber', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Trang đơn thành công, mặc định 1' },
            { name: 'successPageSize', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Mặc định 25, tối đa 500' },
            {
              name: 'rankEventsLimit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Số event mới nhất dùng tính productWantRank / productPurchasedRank (mặc định 25000, tối đa 100000)',
            },
          ],
          responses: {
            '200': {
              description:
                '{ checkoutPreview, checkoutSuccess, productWantRank, productPurchasedRank, meta } — mỗi block list có items + total + pageNumber + pageSize + totalPages',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/analytics/traffic-peak-hours': {
        get: {
          tags: ['Analytics'],
          summary: 'Traffic Peak Hours — ma trận 7×24 (phiên / giờ, GMT+7) theo startedAt',
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'Phiên có startedAt >= since (mặc định N ngày gần đây).',
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description: 'Tối đa số phiên lấy vào ma trận (mới nhất trước), cap ANALYTICS_MAX_LIMIT.',
            },
          ],
          responses: {
            '200': {
              description:
                '{ timeZone, dayLabels, matrix[7][24], maxCount, since, sessionsScanned, sessionLimit, note }',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
                'X-Analytics-Limit': { schema: { type: 'string' } },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/analytics/dimension-stats': {
        get: {
          tags: ['Analytics'],
          summary:
            'Tổng hợp Phân tích chi tiết (Khách, Lượt xem, Phiên, Thoát, Thời gian TB) theo dimension — tính trên server, có cache DB',
          parameters: [
            {
              name: 'dimension',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
                enum: [
                  'path',
                  'title',
                  'country',
                  'city',
                  'browser',
                  'os',
                  'device',
                  'language',
                  'entry',
                  'exit',
                  'referrer',
                ],
              },
              description:
                'path=Đường dẫn, title=Tiêu đề, country, city, browser, os, device, language, entry=Trang vào, exit=Trang thoát, referrer=Nguồn giới thiệu',
            },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Lọc theo chuỗi con (không phân biệt hoa thường)' },
            {
              name: 'rowsPageNumber',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Phân trang mảng `rows` sau khi tổng hợp (giảm payload HTTP). DB vẫn đọc tối đa `limit` phiên. Kết hợp rowsPageSize.',
            },
            {
              name: 'rowsPageSize',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description: 'Số dòng dimension mỗi trang (mặc định 50 nếu chỉ gửi rowsPageNumber).',
            },
          ],
          responses: {
            '200': {
              description:
                '{ rows, meta } — meta có thể gồm rowsTotal, rowsPageNumber, rowsPageSize, rowsTotalPages khi phân trang. Cache lưu full rows; mỗi trang chỉ trả slice.',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
                'X-Analytics-Limit': { schema: { type: 'string' } },
                'X-Analytics-Events-Cap': { schema: { type: 'string' } },
                'X-Analytics-Rows-Total': { schema: { type: 'string' } },
                'X-Analytics-Rows-Page': { schema: { type: 'string' } },
                'X-Analytics-Rows-Page-Size': { schema: { type: 'string' } },
                'X-Analytics-Rows-Page-Count': { schema: { type: 'string' } },
              },
            },
            '400': { description: 'Thiếu/sai dimension' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/active-users': {
        get: {
          tags: ['Analytics'],
          summary:
            'Đang truy cập (~60s) + KPI dashboard (lượt xem, khách, phiên, thời gian TB, bounce, trend %) trong cửa sổ since/limit',
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'Giống GET /analytics/sessions — mặc định N ngày gần đây',
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description: 'Trần số phiên (cap server); KPI thực tế quét tối đa min(limit, kpiSessionLimit, ACTIVE_USERS_KPI_MAX_SESSIONS)',
            },
            {
              name: 'kpiSessionLimit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description:
                'Tuỳ chọn: giới hạn nhỏ hơn số phiên dùng tính dashboardKpis (giảm tải server). Nếu < sessionsInWindow thì kpiApproximate=true.',
            },
          ],
          responses: {
            '200': {
              description:
                'count = phiên hoạt động gần đây; dashboardKpis tính trên tối đa kpiSessionsScanned phiên mới nhất trong cửa sổ since',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
                'X-Analytics-Limit': { schema: { type: 'string' } },
                'X-Analytics-Events-Cap': { schema: { type: 'string' } },
                'X-Analytics-Kpi-Sessions-Scanned': { schema: { type: 'string' } },
              },
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'count',
                      'since',
                      'sessionLimit',
                      'kpiSessionsScanned',
                      'sessionsInWindow',
                      'kpiApproximate',
                      'eventsCapPerSession',
                      'dashboardKpis',
                    ],
                    properties: {
                      count: { type: 'integer', description: 'Phiên có hoạt động trong ~60s, endedAt null' },
                      since: { type: 'string', format: 'date-time' },
                      sessionLimit: { type: 'integer' },
                      kpiSessionsScanned: { type: 'integer' },
                      sessionsInWindow: {
                        type: 'integer',
                        description: 'Tổng phiên có startedAt >= since (ước lượng cỡ cửa sổ)',
                      },
                      kpiApproximate: {
                        type: 'boolean',
                        description: 'true nếu KPI chỉ dựa trên kpiSessionsScanned phiên đầu, chưa hết cửa sổ',
                      },
                      eventsCapPerSession: { type: 'integer' },
                      dashboardKpis: {
                        type: 'object',
                        properties: {
                          pageviewsCount: { type: 'integer' },
                          uniqueVisitorsCount: { type: 'integer' },
                          sessionsCount: { type: 'integer' },
                          avgDurationSec: { type: 'number' },
                          avgDurationFormatted: { type: 'string', example: '12m 34s' },
                          bounces: { type: 'integer' },
                          bounceRatePct: { type: 'number' },
                          trendsPct: {
                            type: 'object',
                            properties: {
                              pageviews: { type: 'number' },
                              uniqueVisitors: { type: 'number' },
                              sessions: { type: 'number' },
                              avgDurationSec: { type: 'number' },
                              bounceRate: { type: 'number' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
    },
  };
}
