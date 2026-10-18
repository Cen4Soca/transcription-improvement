import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler, type CorrectionConfirmedEvent } from './consensus-aggregation.js';

const mockSend = vi.hoisted(() => vi.fn());
const mockEventBridgeSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn().mockImplementation((params) => params),
  QueryCommand: vi.fn().mockImplementation((params) => params),
  UpdateCommand: vi.fn().mockImplementation((params) => params),
}));

vi.mock('@aws-sdk/client-eventbridge', () => {
  return {
    EventBridgeClient: class {
      send = mockEventBridgeSend;
    },
    PutEventsCommand: vi.fn().mockImplementation((params) => params),
  };
});

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

function createEvent(overrides: Partial<{
  sessionId: string;
  segmentId: string;
  userId: string;
}> = {}): CorrectionConfirmedEvent {
  return {
    source: 'transcription-review-app',
    'detail-type': 'CorrectionConfirmed',
    detail: {
      sessionId: overrides.sessionId ?? 'session-123',
      segmentId: overrides.segmentId ?? 'seg-001',
      userId: overrides.userId ?? 'user-1',
      correctionId: 'corr-001',
    },
  };
}

describe('consensus-aggregation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when session is not found', async () => {
    // getSessionMetadata returns no items
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(createEvent());

    // Only 1 call (getSessionMetadata), no further processing
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('does nothing when not all reviewers have submitted and partial aggregation is disabled', async () => {
    // getSessionMetadata
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 3,
        consensusThreshold: 66,
        partialAggregationEnabled: false,
      }],
    });
    // getSegmentCorrections - only 1 reviewer submitted
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
      ],
    });

    await handler(createEvent());

    // 2 calls: getSessionMetadata + getSegmentCorrections, no consensus computation
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('triggers partial aggregation when enabled and majority threshold met', async () => {
    // getSessionMetadata - 5 reviewers, partial enabled
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 5,
        consensusThreshold: 60,
        partialAggregationEnabled: true,
      }],
    });
    // getSegmentCorrections - 3 out of 5 submitted (ceil(5/2) = 3)
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
        { userId: 'user-2', afterText: 'answer A' },
        { userId: 'user-3', afterText: 'answer A' },
      ],
    });
    // saveConsensusResult (PutCommand)
    mockSend.mockResolvedValueOnce({});
    // updateSegmentConsensusStatus - query for segment SK
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'SESSION#session-123', SK: 'SEGMENT#00001.000#seg-001' }],
    });
    // updateSegmentConsensusStatus - update
    mockSend.mockResolvedValueOnce({});

    await handler(createEvent());

    // 3/5 = 60% >= 60% threshold → CONFIRMED
    // Calls: getSession + getCorrections + saveConsensus + querySegment + updateSegment = 5
    expect(mockSend).toHaveBeenCalledTimes(5);
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1); // ConsensusResultConfirmed event
  });

  it('does not trigger partial aggregation when below majority threshold', async () => {
    // getSessionMetadata - 5 reviewers, partial enabled
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 5,
        consensusThreshold: 60,
        partialAggregationEnabled: true,
      }],
    });
    // getSegmentCorrections - only 2 out of 5 submitted (below ceil(5/2) = 3)
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
        { userId: 'user-2', afterText: 'answer A' },
      ],
    });

    await handler(createEvent());

    // Only 2 calls: getSessionMetadata + getSegmentCorrections
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('marks as CONFLICT when all reviewers submitted but threshold not met', async () => {
    // getSessionMetadata
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 3,
        consensusThreshold: 80,
        partialAggregationEnabled: false,
      }],
    });
    // getSegmentCorrections - all 3 submitted, all different
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
        { userId: 'user-2', afterText: 'answer B' },
        { userId: 'user-3', afterText: 'answer C' },
      ],
    });
    // updateSegmentConsensusStatus - query for segment SK
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'SESSION#session-123', SK: 'SEGMENT#00001.000#seg-001' }],
    });
    // updateSegmentConsensusStatus - update
    mockSend.mockResolvedValueOnce({});

    await handler(createEvent());

    // Calls: getSession + getCorrections + querySegment + updateSegment = 4
    expect(mockSend).toHaveBeenCalledTimes(4);
    // ConflictDetected event emitted
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
  });

  it('does NOT mark as CONFLICT during partial aggregation when threshold not met', async () => {
    // getSessionMetadata - 5 reviewers, partial enabled
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 5,
        consensusThreshold: 80,
        partialAggregationEnabled: true,
      }],
    });
    // getSegmentCorrections - 3 out of 5 submitted, all different
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
        { userId: 'user-2', afterText: 'answer B' },
        { userId: 'user-3', afterText: 'answer C' },
      ],
    });

    await handler(createEvent());

    // Partial aggregation triggered (3 >= ceil(5/2)=3), but threshold not met (33% < 80%)
    // Since not all reviewers completed, should NOT mark as CONFLICT — just do nothing
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('confirms consensus when all reviewers agree', async () => {
    // getSessionMetadata
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 3,
        consensusThreshold: 66,
        partialAggregationEnabled: false,
      }],
    });
    // getSegmentCorrections - all 3 agree
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'correct text' },
        { userId: 'user-2', afterText: 'correct text' },
        { userId: 'user-3', afterText: 'correct text' },
      ],
    });
    // saveConsensusResult
    mockSend.mockResolvedValueOnce({});
    // updateSegmentConsensusStatus - query
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'SESSION#session-123', SK: 'SEGMENT#00001.000#seg-001' }],
    });
    // updateSegmentConsensusStatus - update
    mockSend.mockResolvedValueOnce({});

    await handler(createEvent());

    // 100% >= 66% → CONFIRMED
    expect(mockSend).toHaveBeenCalledTimes(5);
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
  });

  it('defaults partialAggregationEnabled to false when not set in session', async () => {
    // getSessionMetadata - no partialAggregationEnabled field
    mockSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 'session-123',
        assignedReviewerCount: 5,
        consensusThreshold: 60,
      }],
    });
    // getSegmentCorrections - 3 out of 5 submitted
    mockSend.mockResolvedValueOnce({
      Items: [
        { userId: 'user-1', afterText: 'answer A' },
        { userId: 'user-2', afterText: 'answer A' },
        { userId: 'user-3', afterText: 'answer A' },
      ],
    });

    await handler(createEvent());

    // partialAggregationEnabled defaults to false, so no partial trigger
    // 3 < 5 total reviewers, so wait
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
