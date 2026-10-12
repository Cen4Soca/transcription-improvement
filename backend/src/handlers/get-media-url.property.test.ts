import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

vi.mock('../services/access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
}));

vi.mock('../services/media-service.js', () => ({
  getMediaUrl: vi.fn(),
}));

import { handler } from './get-media-url.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { getMediaUrl } from '../services/media-service.js';
import { AppError } from '../utils/error-handler.js';

const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedGetMediaUrl = vi.mocked(getMediaUrl);

/**
 * Arbitrary for generating a valid API Gateway event with JWT claims.
 */
function apiEventArb(sessionId: string): fc.Arbitrary<APIGatewayProxyEventV2WithJWTAuthorizer> {
  return fc.record({
    userId: fc.uuid(),
    email: fc.emailAddress(),
    role: fc.constantFrom('REVIEWER', 'TEAM_LEADER', 'ADMIN'),
    displayName: fc.string({ minLength: 1, maxLength: 30 }),
  }).map(({ userId, email, role, displayName }) => ({
    version: '2.0',
    routeKey: 'GET /sessions/{sessionId}/media-url',
    rawPath: `/sessions/${sessionId}/media-url`,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email,
            'custom:role': role,
            'custom:displayName': displayName,
          },
          scopes: [],
        },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'GET',
        path: `/sessions/${sessionId}/media-url`,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-id',
      routeKey: 'GET /sessions/{sessionId}/media-url',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    pathParameters: { sessionId },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer));
}

describe('Feature: get-media-url, Property 39: マルウェアスキャン結果によるファイルアクセス制御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCheckSessionAccess.mockResolvedValue(undefined);
  });

  /**
   * **Validates: Requirements 16.10**
   * Files with scanStatus 'PENDING' cannot have signed URLs generated (access denied).
   * The handler returns 403 FORBIDDEN when the media service rejects PENDING files.
   */
  it('scanStatus が PENDING のファイルに対して Signed URL 生成を拒否する（403）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sessionId) => {
          const event = await fc.sample(apiEventArb(sessionId), 1)[0];

          mockedGetMediaUrl.mockRejectedValue(
            new AppError({
              code: 'FORBIDDEN',
              message: 'マルウェアスキャン完了前のファイルにはアクセスできません',
              statusCode: 403,
            })
          );

          const result = await handler(event);

          expect(result.statusCode).toBe(403);
          const body = JSON.parse(result.body as string);
          expect(body.error.code).toBe('FORBIDDEN');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.10**
   * Files with scanStatus 'CLEAN' can have signed URLs generated (access allowed).
   * The handler returns 200 with a valid signed URL when the media file is clean.
   */
  it('scanStatus が CLEAN のファイルに対して Signed URL 生成を許可する（200）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid().map((id) => `media/${id}/audio.mp3`),
        async (sessionId, s3Key) => {
          const event = await fc.sample(apiEventArb(sessionId), 1)[0];
          const signedUrl = `https://d1234.cloudfront.net/${s3Key}?Expires=9999&Signature=abc`;
          const expiresAt = new Date(Date.now() + 300_000).toISOString();

          mockedGetMediaUrl.mockResolvedValue({
            data: { url: signedUrl, expiresAt },
          });

          const result = await handler(event);

          expect(result.statusCode).toBe(200);
          const body = JSON.parse(result.body as string);
          expect(body.data.url).toBe(signedUrl);
          expect(body.data.expiresAt).toBe(expiresAt);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 16.10**
   * Files with scanStatus 'INFECTED' cannot have signed URLs generated (access denied).
   * The handler returns 403 FORBIDDEN when the media service rejects INFECTED files.
   */
  it('scanStatus が INFECTED のファイルに対して Signed URL 生成を拒否する（403）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sessionId) => {
          const event = await fc.sample(apiEventArb(sessionId), 1)[0];

          mockedGetMediaUrl.mockRejectedValue(
            new AppError({
              code: 'FORBIDDEN',
              message: 'マルウェアが検出されたファイルにはアクセスできません',
              statusCode: 403,
            })
          );

          const result = await handler(event);

          expect(result.statusCode).toBe(403);
          const body = JSON.parse(result.body as string);
          expect(body.error.code).toBe('FORBIDDEN');
        }
      ),
      { numRuns: 100 }
    );
  });
});
