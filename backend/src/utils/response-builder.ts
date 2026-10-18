import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { AppError } from './error-handler.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

export function successResponse<T>(body: T, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(error: unknown): APIGatewayProxyResultV2 {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
      body: JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      }),
    };
  }

  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';

  // Unexpected (non-AppError) failures surface to the client only as a generic
  // "予期しないエラーが発生しました。" message, so log the real error server-side
  // (CloudWatch) to make the root cause diagnosable.
  console.error('Unhandled error in Lambda handler:', error);

  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
    body: JSON.stringify({
      error: {
        code: 'INTERNAL_ERROR',
        message: '予期しないエラーが発生しました。',
        details: message,
      },
    }),
  };
}
