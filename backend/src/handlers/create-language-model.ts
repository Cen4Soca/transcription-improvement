import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractUser, requireRole } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { ERROR_CODES } from '../utils/error-codes.js';
import { createModel, type ConfirmedSegment } from '../services/language-model-service.js';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

/**
 * POST /language-models
 *
 * Creates a custom language model using confirmed segments from specified sessions.
 * - Validates JWT and extracts user (Admin/TeamLeader only)
 * - Parses request body (modelName, baseModelName, displayName, teamId, sessionIds)
 * - Fetches confirmed segments from specified sessions
 * - Calls LanguageModelService.createModel() (team isolation + metadata)
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
      displayName: body.displayName,
      teamId: body.teamId,
      segments,
      sessionIds: body.sessionIds,
      user,
    });

    return successResponse(modelRecord);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

interface CreateLanguageModelRequestBody {
  modelName: string;
  baseModelName: 'NarrowBand' | 'WideBand';
  displayName: string;
  teamId: string;
  sessionIds: string[];
}

function parseRequestBody(rawBody: string | undefined): CreateLanguageModelRequestBody {
  if (!rawBody) {
    throw validationError(
      'A request body is required.',
      undefined,
      ERROR_CODES.REQUEST_BODY_REQUIRED
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw validationError(
      'The request body is not valid JSON.',
      undefined,
      ERROR_CODES.REQUEST_BODY_INVALID
    );
  }

  const body = parsed as Record<string, unknown>;

  if (!body.modelName || typeof body.modelName !== 'string') {
    throw validationError(
      'modelName is required.',
      undefined,
      ERROR_CODES.MODEL_NAME_REQUIRED
    );
  }

  if (!body.baseModelName || typeof body.baseModelName !== 'string') {
    throw validationError(
      'baseModelName is required.',
      undefined,
      ERROR_CODES.BASE_MODEL_NAME_REQUIRED
    );
  }

  if (body.baseModelName !== 'NarrowBand' && body.baseModelName !== 'WideBand') {
    throw validationError(
      'baseModelName must be "NarrowBand" or "WideBand".',
      undefined,
      ERROR_CODES.BASE_MODEL_NAME_INVALID
    );
  }

  if (!body.displayName || typeof body.displayName !== 'string') {
    throw validationError(
      'displayName is required.',
      undefined,
      ERROR_CODES.DISPLAY_NAME_FIELD_REQUIRED
    );
  }

  if (!body.teamId || typeof body.teamId !== 'string') {
    throw validationError(
      'teamId is required.',
      undefined,
      ERROR_CODES.TEAM_ID_FIELD_REQUIRED
    );
  }

  if (!body.sessionIds || !Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
    throw validationError(
      'sessionIds must be an array containing at least one session ID.',
      undefined,
      ERROR_CODES.SESSION_IDS_INVALID
    );
  }

  for (const id of body.sessionIds) {
    if (typeof id !== 'string') {
      throw validationError(
        'Each element of sessionIds must be a string.',
        undefined,
        ERROR_CODES.SESSION_IDS_ELEMENT_INVALID
      );
    }
  }

  return {
    modelName: body.modelName,
    baseModelName: body.baseModelName as 'NarrowBand' | 'WideBand',
    displayName: body.displayName,
    teamId: body.teamId,
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
