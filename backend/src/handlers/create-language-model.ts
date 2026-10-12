import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { createModel, type ConfirmedSegment } from '../services/language-model-service.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

/**
 * POST /language-models
 *
 * Creates a custom language model using confirmed segments from specified sessions.
 * - Validates JWT and extracts user (Admin/TeamLeader only)
 * - Parses request body (modelName, baseModelName, sessionIds)
 * - Fetches confirmed segments from specified sessions
 * - Calls LanguageModelService.createModel()
 * - Records AuditLog on success
 * - Returns the created model record
 *
 * Requirements: 6.1, 6.2, 6.4, 6.7, 6.8, 6.9, 6.12
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    // Role check: Admin/TeamLeader only
    requireRole(user, 'TEAM_LEADER');

    // Parse and validate request body
    const body = parseRequestBody(event.body);

    // Fetch confirmed segments from specified sessions
    const segments = await fetchConfirmedSegments(body.sessionIds);

    // Call LanguageModelService.createModel()
    const modelRecord = await createModel({
      modelName: body.modelName,
      baseModelName: body.baseModelName,
      segments,
      sessionIds: body.sessionIds,
      userId: user.userId,
      userRole: user.role,
    });

    return successResponse(modelRecord);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

interface CreateLanguageModelRequestBody {
  modelName: string;
  baseModelName: 'NarrowBand' | 'WideBand';
  sessionIds: string[];
}

function parseRequestBody(rawBody: string | undefined): CreateLanguageModelRequestBody {
  if (!rawBody) {
    throw validationError('リクエストボディが必要です。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw validationError('リクエストボディのJSON形式が不正です。');
  }

  const body = parsed as Record<string, unknown>;

  if (!body.modelName || typeof body.modelName !== 'string') {
    throw validationError('modelName は必須です。');
  }

  if (!body.baseModelName || typeof body.baseModelName !== 'string') {
    throw validationError('baseModelName は必須です。');
  }

  if (body.baseModelName !== 'NarrowBand' && body.baseModelName !== 'WideBand') {
    throw validationError(
      'baseModelName は "NarrowBand" または "WideBand" を指定してください。'
    );
  }

  if (!body.sessionIds || !Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
    throw validationError('sessionIds は1つ以上のセッションIDを含む配列で指定してください。');
  }

  for (const id of body.sessionIds) {
    if (typeof id !== 'string') {
      throw validationError('sessionIds の各要素は文字列で指定してください。');
    }
  }

  return {
    modelName: body.modelName,
    baseModelName: body.baseModelName as 'NarrowBand' | 'WideBand',
    sessionIds: body.sessionIds as string[],
  };
}

/**
 * Fetch confirmed segments from the specified sessions.
 * Queries DynamoDB for segments with consensusStatus=CONFIRMED.
 */
async function fetchConfirmedSegments(sessionIds: string[]): Promise<ConfirmedSegment[]> {
  const allSegments: ConfirmedSegment[] = [];

  for (const sessionId of sessionIds) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'consensusStatus = :status',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':prefix': 'SEGMENT#',
          ':status': 'CONFIRMED',
        },
        ScanIndexForward: true,
      })
    );

    for (const item of result.Items ?? []) {
      const text = (item['consensusText'] as string) || (item['originalText'] as string);
      if (text) {
        allSegments.push({ text, confirmed: true });
      }
    }
  }

  return allSegments;
}
