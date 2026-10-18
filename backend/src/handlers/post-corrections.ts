import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError } from '../utils/error-handler.js';
import { checkSessionAccess } from '../services/access-control-service.js';
import {
  validateCorrectionInput,
  createCorrection,
} from '../services/correction-service.js';
import { recordAuditLog } from '../services/audit-service.js';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const EVENT_SOURCE = 'transcription-review-app';

const eventBridgeClient = new EventBridgeClient({ region: REGION });

/**
 * Publish a CorrectionConfirmed event so the consensus-aggregation Lambda can
 * evaluate whether the segment now meets the consensus threshold.
 *
 * The EventBridge rule (CorrectionConfirmed-ConsensusAggregation) matches on
 * source `transcription-review-app` and detailType `CorrectionConfirmed`.
 */
async function publishCorrectionConfirmedEvent(detail: {
  sessionId: string;
  segmentId: string;
  userId: string;
  correctionId: string;
}): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: EVENT_SOURCE,
          DetailType: 'CorrectionConfirmed',
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );
}

/**
 * POST /sessions/{sessionId}/corrections
 *
 * Creates a new Correction for the specified session.
 * - Validates JWT and extracts user
 * - Validates request body
 * - Checks session access (team-based)
 * - Saves correction with idempotency (correctionId as idempotent key)
 * - Updates session status PENDING → IN_PROGRESS on first correction
 * - Returns 201 on new save, 200 on duplicate (idempotent success)
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パスパラメータが必要です。');
    }

    await checkSessionAccess(user, sessionId);

    const body = event.body ? JSON.parse(event.body) : null;
    const input = validateCorrectionInput(body);

    const result = await createCorrection(sessionId, user, input);

    if (result.isDuplicate) {
      return successResponse(result.correction, 200);
    }

    // Record audit log for new correction
    const operationType = input.correctionType === 'SPEAKER_RENAME'
      ? 'SPEAKER_LABEL_CHANGED' as const
      : 'CORRECTION_CONFIRMED' as const;

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType,
      resourceId: result.correction.correctionId,
      resourceType: 'Correction',
    });

    // Kick off the async consensus-aggregation flow for this segment.
    // Without this event the CorrectionConfirmed-ConsensusAggregation rule
    // never fires and consensus is never computed automatically.
    await publishCorrectionConfirmedEvent({
      sessionId,
      segmentId: result.correction.segmentId,
      userId: user.userId,
      correctionId: result.correction.correctionId,
    });

    return successResponse(result.correction, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
