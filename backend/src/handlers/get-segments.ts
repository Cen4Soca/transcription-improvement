import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

export interface SegmentResponse {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';
  consensusText?: string;
}

/**
 * GET /sessions/{sessionId}/segments
 * Retrieves all segments for a session, sorted by startTime ascending.
 * Access control: user must have access to the session (via team or direct assignment).
 *
 * Response:
 *   { data: { segments: SegmentResponse[] } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パラメータが必要です。');
    }

    // Verify user has access to this session
    await checkSessionAccess(user, sessionId);

    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}`,
            ':prefix': 'SEGMENT#',
          },
          ScanIndexForward: true,
        })
      );

      const segments: SegmentResponse[] = (result.Items ?? []).map((item) => ({
        segmentId: item['segmentId'] as string,
        sessionId: item['sessionId'] as string,
        startTime: item['startTime'] as number,
        endTime: item['endTime'] as number,
        originalText: item['originalText'] as string,
        speakerLabel: item['speakerLabel'] as string | undefined,
        consensusStatus:
          (item['consensusStatus'] as 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT') ?? 'UNDECIDED',
        consensusText: item['consensusText'] as string | undefined,
      }));

      return successResponse({ data: { segments } });
    } catch (queryError: unknown) {
      throw internalError(
        'セグメントの取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
