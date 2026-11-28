import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export interface ApiEventOptions {
  method?: string;
  path?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}

/** Build a minimal API Gateway HTTP API (JWT authorizer) event for handler tests. */
export function createApiEvent(
  options: ApiEventOptions = {}
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = options.method ?? 'GET';
  const path = options.path ?? '/';
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    pathParameters: options.pathParameters,
    queryStringParameters: options.queryStringParameters,
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'sub-1', email: 'u@example.com' }, scopes: [] } },
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
