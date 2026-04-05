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
          summary: 'Danh sách phiên + events (có giới hạn thời gian và số lượng)',
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
              description: 'Số phiên tối đa (bị giới hạn bởi ANALYTICS_MAX_LIMIT).',
            },
          ],
          responses: {
            '200': {
              description: 'Mảng Session (kèm events, visitor…)',
              headers: {
                'X-Analytics-Since': { schema: { type: 'string' } },
                'X-Analytics-Limit': { schema: { type: 'string' } },
                'X-Analytics-Events-Cap': { schema: { type: 'string' } },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/active-users': {
        get: {
          tags: ['Analytics'],
          summary: 'Số phiên hoạt động trong ~1 phút gần nhất',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { count: { type: 'integer' } },
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
