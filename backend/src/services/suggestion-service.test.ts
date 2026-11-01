import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mergeSuggestions,
  limitSuggestions,
  generateSuggestions,
  unionSpeakerLabels,
  selectSurroundingSegments,
  buildSegmentContext,
  getSuggestionContext,
  defaultBedrockProvider,
  type SuggestionCandidate,
  type BedrockSuggestionProvider,
  type ComprehendSuggestionProvider,
} from './suggestion-service.js';
import type { SegmentSummary } from '../repositories/segment-repository.js';

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
}));

// generateSuggestions builds surrounding context via the segment/session
// repositories. Mock them so these tests exercise suggestion logic in isolation
// (dedicated repository behavior is covered by their own tests). The context
// path defaults to "no context" unless a test overrides it.
vi.mock('../repositories/segment-repository.js', () => ({
  getSessionSegments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn().mockResolvedValue(null),
}));

// Mock the Bedrock SDK so defaultBedrockProvider can be exercised without a
// real AWS call. The mock captures the InvokeModel request body so we can
// assert the prompt carries the surrounding context.
const bedrockSendMock = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: bedrockSendMock })),
  InvokeModelCommand: vi.fn((input) => ({ input })),
}));

describe('mergeSuggestions', () => {
  it('should merge candidates in priority order: history → bedrock → comprehend', () => {
    const history: SuggestionCandidate[] = [
      { text: 'history candidate', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [
      { text: 'bedrock candidate', source: 'bedrock' },
    ];
    const comprehend: SuggestionCandidate[] = [
      { text: 'comprehend candidate', source: 'comprehend' },
    ];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toEqual([
      { text: 'history candidate', source: 'history' },
      { text: 'bedrock candidate', source: 'bedrock' },
      { text: 'comprehend candidate', source: 'comprehend' },
    ]);
  });

  it('should deduplicate by text content', () => {
    const history: SuggestionCandidate[] = [
      { text: 'same text', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [
      { text: 'same text', source: 'bedrock' },
      { text: 'different text', source: 'bedrock' },
    ];
    const comprehend: SuggestionCandidate[] = [
      { text: 'same text', source: 'comprehend' },
    ];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toEqual([
      { text: 'same text', source: 'history' },
      { text: 'different text', source: 'bedrock' },
    ]);
  });

  it('should keep the first occurrence when duplicates exist (history wins)', () => {
    const history: SuggestionCandidate[] = [
      { text: 'duplicate', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [
      { text: 'duplicate', source: 'bedrock' },
    ];
    const comprehend: SuggestionCandidate[] = [];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('history');
  });

  it('should skip empty text candidates', () => {
    const history: SuggestionCandidate[] = [
      { text: '', source: 'history' },
      { text: '  ', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [
      { text: 'valid', source: 'bedrock' },
    ];
    const comprehend: SuggestionCandidate[] = [];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toEqual([{ text: 'valid', source: 'bedrock' }]);
  });

  it('should trim whitespace from candidates', () => {
    const history: SuggestionCandidate[] = [
      { text: '  trimmed  ', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [];
    const comprehend: SuggestionCandidate[] = [];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toEqual([{ text: 'trimmed', source: 'history' }]);
  });

  it('should handle all empty arrays', () => {
    const result = mergeSuggestions([], [], []);
    expect(result).toEqual([]);
  });

  it('should handle only history candidates', () => {
    const history: SuggestionCandidate[] = [
      { text: 'a', source: 'history' },
      { text: 'b', source: 'history' },
    ];

    const result = mergeSuggestions(history, [], []);

    expect(result).toEqual([
      { text: 'a', source: 'history' },
      { text: 'b', source: 'history' },
    ]);
  });

  it('should deduplicate trimmed text that becomes the same', () => {
    const history: SuggestionCandidate[] = [
      { text: 'hello', source: 'history' },
    ];
    const bedrock: SuggestionCandidate[] = [
      { text: '  hello  ', source: 'bedrock' },
    ];
    const comprehend: SuggestionCandidate[] = [];

    const result = mergeSuggestions(history, bedrock, comprehend);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('history');
  });
});

describe('limitSuggestions', () => {
  it('should return at most max candidates', () => {
    const candidates: SuggestionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      text: `candidate ${i}`,
      source: 'history' as const,
    }));

    const result = limitSuggestions(candidates, 5);

    expect(result).toHaveLength(5);
  });

  it('should return all candidates when fewer than max', () => {
    const candidates: SuggestionCandidate[] = [
      { text: 'a', source: 'history' },
      { text: 'b', source: 'bedrock' },
    ];

    const result = limitSuggestions(candidates, 5);

    expect(result).toHaveLength(2);
  });

  it('should return empty array for empty input', () => {
    const result = limitSuggestions([], 5);
    expect(result).toEqual([]);
  });

  it('should default to max 5 when no max specified', () => {
    const candidates: SuggestionCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      text: `candidate ${i}`,
      source: 'bedrock' as const,
    }));

    const result = limitSuggestions(candidates);

    expect(result).toHaveLength(5);
  });

  it('should preserve order when limiting', () => {
    const candidates: SuggestionCandidate[] = [
      { text: 'first', source: 'history' },
      { text: 'second', source: 'bedrock' },
      { text: 'third', source: 'comprehend' },
      { text: 'fourth', source: 'history' },
      { text: 'fifth', source: 'bedrock' },
      { text: 'sixth', source: 'comprehend' },
    ];

    const result = limitSuggestions(candidates, 3);

    expect(result).toEqual([
      { text: 'first', source: 'history' },
      { text: 'second', source: 'bedrock' },
      { text: 'third', source: 'comprehend' },
    ]);
  });
});

describe('generateSuggestions', () => {
  it('should return suggestions from all sources when all succeed', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'history fix', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
      ],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'bedrock fix', source: 'bedrock' },
      ]),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'comprehend fix', source: 'comprehend' },
      ]),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.hasExternalApiError).toBe(false);
    expect(result.suggestions).toEqual([
      { text: 'history fix', source: 'history' },
      { text: 'bedrock fix', source: 'bedrock' },
      { text: 'comprehend fix', source: 'comprehend' },
    ]);
  });

  it('should set hasExternalApiError when Bedrock fails', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'history fix', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
      ],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockRejectedValue(new Error('Bedrock timeout')),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'comprehend fix', source: 'comprehend' },
      ]),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.hasExternalApiError).toBe(true);
    expect(result.suggestions).toEqual([
      { text: 'history fix', source: 'history' },
      { text: 'comprehend fix', source: 'comprehend' },
    ]);
  });

  it('should log the real failure reason to CloudWatch when an external API fails', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'history fix', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
      ],
    } as never);

    const bedrockError = new Error('AccessDeniedException: model not enabled');
    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockRejectedValue(bedrockError),
    };
    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await generateSuggestions('session1', 'seg1', 'original text', bedrockProvider, comprehendProvider);

      // The failure reason must be logged with the segment id so the root cause
      // is diagnosable from CloudWatch (not just the opaque hasExternalApiError flag).
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Bedrock getSuggestions failed for segment seg1'),
        bedrockError
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('should set hasExternalApiError when Comprehend fails', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'history fix', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
      ],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'bedrock fix', source: 'bedrock' },
      ]),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockRejectedValue(new Error('Comprehend error')),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.hasExternalApiError).toBe(true);
    expect(result.suggestions).toEqual([
      { text: 'history fix', source: 'history' },
      { text: 'bedrock fix', source: 'bedrock' },
    ]);
  });

  it('should set hasExternalApiError when both external APIs fail', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'history fix', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
      ],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockRejectedValue(new Error('Bedrock error')),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockRejectedValue(new Error('Comprehend error')),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.hasExternalApiError).toBe(true);
    expect(result.suggestions).toEqual([
      { text: 'history fix', source: 'history' },
    ]);
  });

  it('should return empty suggestions when no candidates from any source', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.hasExternalApiError).toBe(false);
    expect(result.suggestions).toEqual([]);
  });

  it('should limit total suggestions to 5', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { afterText: 'h1', segmentId: 'seg1', createdAt: '2024-01-01T00:00:00Z' },
        { afterText: 'h2', segmentId: 'seg1', createdAt: '2024-01-02T00:00:00Z' },
        { afterText: 'h3', segmentId: 'seg1', createdAt: '2024-01-03T00:00:00Z' },
      ],
    } as never);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'b1', source: 'bedrock' },
        { text: 'b2', source: 'bedrock' },
      ]),
    };

    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([
        { text: 'c1', source: 'comprehend' },
        { text: 'c2', source: 'comprehend' },
      ]),
    };

    const result = await generateSuggestions(
      'session1',
      'seg1',
      'original text',
      bedrockProvider,
      comprehendProvider
    );

    expect(result.suggestions).toHaveLength(5);
    // History candidates should come first
    expect(result.suggestions[0].source).toBe('history');
    expect(result.suggestions[1].source).toBe('history');
    expect(result.suggestions[2].source).toBe('history');
  });
});

function seg(
  segmentId: string,
  startTime: number,
  originalText: string,
  speakerLabel?: string
): SegmentSummary {
  return speakerLabel !== undefined
    ? { segmentId, startTime, originalText, speakerLabel }
    : { segmentId, startTime, originalText };
}

describe('unionSpeakerLabels', () => {
  it('merges master labels and segment labels in first-appearance order without duplicates', () => {
    const segments = [
      seg('s1', 0, 'a', 'SpeakerB'),
      seg('s2', 1, 'b', 'SpeakerC'),
      seg('s3', 2, 'c', 'SpeakerB'),
    ];

    const result = unionSpeakerLabels(['SpeakerA', 'SpeakerB'], segments);

    expect(result).toEqual(['SpeakerA', 'SpeakerB', 'SpeakerC']);
  });

  it('ignores empty/whitespace labels and handles undefined master list', () => {
    const segments = [seg('s1', 0, 'a', '  '), seg('s2', 1, 'b', 'SpeakerX')];

    const result = unionSpeakerLabels(undefined, segments);

    expect(result).toEqual(['SpeakerX']);
  });

  it('returns an empty array when no labels exist anywhere', () => {
    expect(unionSpeakerLabels(undefined, [seg('s1', 0, 'a')])).toEqual([]);
  });
});

describe('selectSurroundingSegments', () => {
  it('always includes the target segment', () => {
    const segments = [seg('s1', 0, 'a'), seg('s2', 1, 'target'), seg('s3', 2, 'c')];

    const result = selectSurroundingSegments(segments, 's2');

    expect(result.some((s) => s.segmentId === 's2')).toBe(true);
  });

  it('returns an empty array when the target id is not present', () => {
    const segments = [seg('s1', 0, 'a'), seg('s2', 1, 'b')];

    expect(selectSurroundingSegments(segments, 'missing')).toEqual([]);
  });

  it('preserves startTime (input) order in the output', () => {
    const segments = [
      seg('s1', 0, 'a'),
      seg('s2', 1, 'b'),
      seg('s3', 2, 'target'),
      seg('s4', 3, 'd'),
      seg('s5', 4, 'e'),
    ];

    const result = selectSurroundingSegments(segments, 's3', 1000);
    const ids = result.map((s) => s.segmentId);

    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('stops expanding once the character budget would be exceeded', () => {
    const long = 'x'.repeat(100);
    const segments = [
      seg('s1', 0, long),
      seg('s2', 1, 'target'),
      seg('s3', 2, long),
    ];

    // Budget large enough for the target but not for a 100-char neighbor.
    const result = selectSurroundingSegments(segments, 's2', 50);

    expect(result.map((s) => s.segmentId)).toEqual(['s2']);
  });
});

describe('buildSegmentContext', () => {
  it('builds a speaker line and a context block with the target marked', () => {
    const surrounding = [
      seg('s1', 0, 'intro', 'SpeakerA'),
      seg('s2', 1, 'target text', 'SpeakerB'),
    ];

    const result = buildSegmentContext({
      speakerLabels: ['SpeakerA', 'SpeakerB'],
      surroundingSegments: surrounding,
      targetSegmentId: 's2',
    });

    expect(result).toContain('このセッションの話者: SpeakerA, SpeakerB');
    expect(result).toContain('前後の文脈:');
    expect(result).toContain('[SpeakerA] intro');
    expect(result).toContain('[SpeakerB] target text  ← 修正対象のセグメント');
    // Only the target line carries the marker.
    expect(result.match(/← 修正対象のセグメント/g)).toHaveLength(1);
  });

  it('omits the speaker line when there are no labels', () => {
    const result = buildSegmentContext({
      speakerLabels: [],
      surroundingSegments: [seg('s1', 0, 'only text')],
      targetSegmentId: 's1',
    });

    expect(result).not.toContain('このセッションの話者');
    expect(result).toContain('前後の文脈:');
    expect(result).toContain('only text');
  });

  it('renders lines without a bracket prefix when a segment has no speaker', () => {
    const result = buildSegmentContext({
      speakerLabels: [],
      surroundingSegments: [seg('s1', 0, 'no speaker here')],
      targetSegmentId: 'other',
    });

    expect(result).toContain('no speaker here');
    expect(result).not.toContain('[');
  });

  it('returns an empty string when nothing to show', () => {
    expect(
      buildSegmentContext({ speakerLabels: [], surroundingSegments: [], targetSegmentId: 's1' })
    ).toBe('');
  });
});

describe('getSuggestionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles context from the session speaker list and segments', async () => {
    const { getSessionById } = await import('../repositories/session-repository.js');
    const { getSessionSegments } = await import('../repositories/segment-repository.js');

    vi.mocked(getSessionById).mockResolvedValue({
      sessionId: 'session1',
      name: 'S',
      status: 'IN_PROGRESS',
      assignedReviewerCount: 1,
      consensusThreshold: 3,
      speakerLabels: ['SpeakerA'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as never);
    vi.mocked(getSessionSegments).mockResolvedValue([
      seg('seg1', 0, 'hello', 'SpeakerA'),
      seg('seg2', 1, 'target', 'SpeakerB'),
    ]);

    const context = await getSuggestionContext('session1', 'seg2');

    expect(context).toContain('このセッションの話者: SpeakerA, SpeakerB');
    expect(context).toContain('[SpeakerB] target  ← 修正対象のセグメント');
  });

  it('falls back to an empty string and logs when a repository fails', async () => {
    const { getSessionById } = await import('../repositories/session-repository.js');
    const { getSessionSegments } = await import('../repositories/segment-repository.js');

    const failure = new Error('DynamoDB unavailable');
    vi.mocked(getSessionById).mockResolvedValue(null as never);
    vi.mocked(getSessionSegments).mockRejectedValue(failure);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const context = await getSuggestionContext('session1', 'seg2');

      expect(context).toBe('');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('getSuggestionContext failed for session session1 segment seg2'),
        failure
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('generateSuggestions context wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the assembled context to the Bedrock provider', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    const { getSessionById } = await import('../repositories/session-repository.js');
    const { getSessionSegments } = await import('../repositories/segment-repository.js');

    // History query (first docClient.send) returns no history.
    vi.mocked(docClient.send).mockResolvedValue({ Items: [] } as never);
    vi.mocked(getSessionById).mockResolvedValue({
      sessionId: 'session1',
      name: 'S',
      status: 'IN_PROGRESS',
      assignedReviewerCount: 1,
      consensusThreshold: 3,
      speakerLabels: ['SpeakerA'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as never);
    vi.mocked(getSessionSegments).mockResolvedValue([
      seg('seg1', 0, 'before text', 'SpeakerA'),
      seg('seg2', 1, 'target text', 'SpeakerB'),
    ]);

    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };
    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };

    await generateSuggestions('session1', 'seg2', 'target text', bedrockProvider, comprehendProvider);

    const call = vi.mocked(bedrockProvider.getSuggestions).mock.calls[0];
    expect(call[0]).toBe('target text');
    expect(call[1]).toContain('このセッションの話者: SpeakerA, SpeakerB');
    expect(call[1]).toContain('[SpeakerB] target text  ← 修正対象のセグメント');
  });

  it('calls Bedrock with undefined context and still succeeds when context assembly fails', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    const { getSessionById } = await import('../repositories/session-repository.js');
    const { getSessionSegments } = await import('../repositories/segment-repository.js');

    vi.mocked(docClient.send).mockResolvedValue({ Items: [] } as never);
    vi.mocked(getSessionById).mockResolvedValue(null as never);
    vi.mocked(getSessionSegments).mockRejectedValue(new Error('boom'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bedrockProvider: BedrockSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([{ text: 'fix', source: 'bedrock' }]),
    };
    const comprehendProvider: ComprehendSuggestionProvider = {
      getSuggestions: vi.fn().mockResolvedValue([]),
    };

    try {
      const result = await generateSuggestions(
        'session1',
        'seg2',
        'target text',
        bedrockProvider,
        comprehendProvider
      );

      // Context failure must NOT mark hasExternalApiError (it's best-effort),
      // and Bedrock is called with no context.
      expect(result.hasExternalApiError).toBe(false);
      expect(result.suggestions).toEqual([{ text: 'fix', source: 'bedrock' }]);
      const call = vi.mocked(bedrockProvider.getSuggestions).mock.calls[0];
      expect(call[1]).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('defaultBedrockProvider prompt', () => {
  beforeEach(() => {
    bedrockSendMock.mockReset();
  });

  it('embeds the surrounding context into the Bedrock prompt', async () => {
    const claudeBody = JSON.stringify({ content: [{ type: 'text', text: '修正候補1' }] });
    bedrockSendMock.mockResolvedValue({ body: new TextEncoder().encode(claudeBody) });

    const context =
      'このセッションの話者: SpeakerA, SpeakerB\n\n前後の文脈:\n[SpeakerA] こんにちは\n[SpeakerB] 議題の一点目  ← 修正対象のセグメント';

    const result = await defaultBedrockProvider.getSuggestions('議題の一点目', context);

    expect(result).toEqual([{ text: '修正候補1', source: 'bedrock' }]);

    // Inspect the request body sent to InvokeModel.
    const sentCommand = bedrockSendMock.mock.calls[0][0] as { input: { body: string } };
    const requestBody = JSON.parse(sentCommand.input.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = requestBody.messages[0].content;

    expect(prompt).toContain('文字起こしテキスト: 議題の一点目');
    expect(prompt).toContain('周辺の文脈:');
    expect(prompt).toContain('このセッションの話者: SpeakerA, SpeakerB');
    expect(prompt).toContain('[SpeakerB] 議題の一点目  ← 修正対象のセグメント');
  });

  it('omits the context line when no context is provided', async () => {
    const claudeBody = JSON.stringify({ content: [{ type: 'text', text: 'x' }] });
    bedrockSendMock.mockResolvedValue({ body: new TextEncoder().encode(claudeBody) });

    await defaultBedrockProvider.getSuggestions('テキスト');

    const sentCommand = bedrockSendMock.mock.calls[0][0] as { input: { body: string } };
    const requestBody = JSON.parse(sentCommand.input.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages[0].content).not.toContain('周辺の文脈:');
  });
});
