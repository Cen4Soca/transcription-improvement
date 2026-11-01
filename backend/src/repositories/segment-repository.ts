import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client.js';

/**
 * Lightweight projection of a transcription Segment used when building the
 * surrounding-context prompt for suggestion generation. Only the fields the
 * prompt builder needs are included (id, ordering, text, speaker).
 */
export interface SegmentSummary {
  segmentId: string;
  startTime: number;
  originalText: string;
  speakerLabel?: string;
}

/**
 * Fetch all segments of a session ordered by startTime (ascending).
 *
 * Uses the single-table access pattern PK = SESSION#{sessionId},
 * SK begins_with SEGMENT# with ScanIndexForward: true — the same pattern as
 * getTranscriptTextForSession (session-name-suggestion-service) and
 * getSegmentSpeakerLabels (session-repository). The DynamoDB sort key is laid
 * out so this scan returns segments in startTime order.
 *
 * @param sessionId - The session whose segments to retrieve.
 * @returns The session's segments as lightweight summaries (possibly empty).
 */
export async function getSessionSegments(
  sessionId: string
): Promise<SegmentSummary[]> {
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

  return (result.Items ?? []).map((item) => {
    const speakerLabel = item['speakerLabel'] as string | undefined;
    return {
      segmentId: (item['segmentId'] as string) ?? '',
      startTime: (item['startTime'] as number) ?? 0,
      originalText: (item['originalText'] as string) ?? '',
      // Preserve the optional nature of speakerLabel: omit when absent/empty.
      ...(speakerLabel ? { speakerLabel } : {}),
    };
  });
}
