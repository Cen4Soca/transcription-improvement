import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSessionSegments } from './segment-repository.js';

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
}));

describe('getSessionSegments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps DynamoDB items to SegmentSummary in returned order', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        {
          segmentId: 'seg1',
          startTime: 0,
          originalText: 'first',
          speakerLabel: 'SpeakerA',
        },
        {
          segmentId: 'seg2',
          startTime: 1.5,
          originalText: 'second',
          speakerLabel: 'SpeakerB',
        },
      ],
    } as never);

    const result = await getSessionSegments('session-1');

    expect(result).toEqual([
      { segmentId: 'seg1', startTime: 0, originalText: 'first', speakerLabel: 'SpeakerA' },
      { segmentId: 'seg2', startTime: 1.5, originalText: 'second', speakerLabel: 'SpeakerB' },
    ]);
  });

  it('omits speakerLabel when absent or empty', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { segmentId: 'seg1', startTime: 0, originalText: 'no speaker' },
        { segmentId: 'seg2', startTime: 1, originalText: 'empty speaker', speakerLabel: '' },
      ],
    } as never);

    const result = await getSessionSegments('session-1');

    expect(result[0]).not.toHaveProperty('speakerLabel');
    expect(result[1]).not.toHaveProperty('speakerLabel');
  });

  it('returns an empty array when there are no segments', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({ Items: [] } as never);

    const result = await getSessionSegments('session-1');

    expect(result).toEqual([]);
  });

  it('returns an empty array when Items is undefined', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({} as never);

    const result = await getSessionSegments('session-1');

    expect(result).toEqual([]);
  });

  it('queries with the SESSION#/SEGMENT# access pattern in ascending order', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({ Items: [] } as never);

    await getSessionSegments('session-xyz');

    const sentCommand = vi.mocked(docClient.send).mock.calls[0][0] as unknown as {
      input: {
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
        ScanIndexForward: boolean;
      };
    };
    expect(sentCommand.input.ExpressionAttributeValues[':pk']).toBe('SESSION#session-xyz');
    expect(sentCommand.input.ExpressionAttributeValues[':prefix']).toBe('SEGMENT#');
    expect(sentCommand.input.ScanIndexForward).toBe(true);
  });
});
