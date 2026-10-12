import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler } from './get-suggestions.js';

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
}));

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/suggestion-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/suggestion-service.js')>();
  return {
    ...actual,
    generateSuggestions: vi.fn(),
  };
});

function createEvent(
  overrides: Partial<{
    sessionId: string;
    segmentId: string;
    text: string;
    claims: Record<string, string>;
  }> = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /sessions/{sessionId}/suggestions',
    rawPath: '/sessions/session-1/suggestions',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: 'user-1',
            email: 'test@example.com',
            'custom:displayName': 'Test User',
            'custom:role': 'REVIEWER',
            ...overrides.claims,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: '/sessions/session-1/suggestions',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-1',
      routeKey: 'GET /sessions/{sessionId}/suggestions',
      stage: '$default',
      time: '2024-01-01T00:00:00Z',
      timeEpoch: 0,
    },
    pathParameters: {
      sessionId: overrides.sessionId ?? 'session-1',
    },
    queryStringParameters: {
      segmentId: overrides.segmentId ?? 'segment-1',
      ...(overrides.text !== undefined ? { text: overrides.text } : { text: 'original text' }),
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('GET /sessions/{sessionId}/suggestions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent();
    event.pathParameters = {};

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('sessionId');
  });

  it('should return 400 when segmentId query parameter is missing', async () => {
    const event = createEvent();
    event.queryStringParameters = {};

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body as string);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('segmentId');
  });

  it('should return suggestions on success', async () => {
    const { generateSuggestions } = await import('../services/suggestion-service.js');
    vi.mocked(generateSuggestions).mockResolvedValue({
      suggestions: [
        { text: 'suggestion 1', source: 'history' },
        { text: 'suggestion 2', source: 'bedrock' },
      ],
      hasExternalApiError: false,
    });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.suggestions).toHaveLength(2);
    expect(body.hasExternalApiError).toBe(false);
  });

  it('should return hasExternalApiError flag when external APIs fail', async () => {
    const { generateSuggestions } = await import('../services/suggestion-service.js');
    vi.mocked(generateSuggestions).mockResolvedValue({
      suggestions: [{ text: 'history only', source: 'history' }],
      hasExternalApiError: true,
    });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body as string);
    expect(body.hasExternalApiError).toBe(true);
  });

  it('should return 500 when generateSuggestions throws', async () => {
    const { generateSuggestions } = await import('../services/suggestion-service.js');
    vi.mocked(generateSuggestions).mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('修正候補の取得に失敗しました');
  });

  it('should check session access before generating suggestions', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { AppError } = await import('../utils/error-handler.js');

    vi.mocked(checkSessionAccess).mockRejectedValue(
      new AppError({ code: 'NOT_FOUND', message: 'リソースが見つかりません。', statusCode: 404 })
    );

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
  });

  it('should pass text query parameter to generateSuggestions', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { generateSuggestions } = await import('../services/suggestion-service.js');
    vi.mocked(checkSessionAccess).mockResolvedValue(undefined);
    vi.mocked(generateSuggestions).mockResolvedValue({
      suggestions: [],
      hasExternalApiError: false,
    });

    const event = createEvent({ text: 'custom text' });
    await handler(event);

    expect(generateSuggestions).toHaveBeenCalledWith('segment-1', 'custom text');
  });

  it('should default text to empty string when not provided', async () => {
    const { checkSessionAccess } = await import('../services/access-control-service.js');
    const { generateSuggestions } = await import('../services/suggestion-service.js');
    vi.mocked(checkSessionAccess).mockResolvedValue(undefined);
    vi.mocked(generateSuggestions).mockResolvedValue({
      suggestions: [],
      hasExternalApiError: false,
    });

    const event = createEvent();
    event.queryStringParameters = { segmentId: 'segment-1' };
    await handler(event);

    expect(generateSuggestions).toHaveBeenCalledWith('segment-1', '');
  });
});
