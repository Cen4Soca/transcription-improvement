import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { AppError } from '../utils/error-handler.js';
import { getJobStatusFromTranscribe } from '../services/transcription-job-service.js';

/**
 * GET /transcription-jobs/{jobId}
 *
 * Retrieves the real-time status of a transcription job by polling Amazon Transcribe.
 * - Validates JWT and extracts user
 * - Extracts jobId from path parameters
 * - Calls TranscriptionJobService.getJobStatusFromTranscribe() for real-time polling
 * - Returns the TranscriptionJob record with current status
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    // Validate user authentication
    await extractUser(event);

    // Extract jobId from path parameters
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'jobId パスパラメータは必須です。',
        statusCode: 400,
      });
    }

    // Get job status (polls Transcribe API for real-time status)
    const job = await getJobStatusFromTranscribe(jobId);

    return successResponse(job);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
