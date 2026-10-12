import { describe, it, expect, vi } from 'vitest';
import {
  mergeSuggestions,
  limitSuggestions,
  generateSuggestions,
  type SuggestionCandidate,
  type BedrockSuggestionProvider,
  type ComprehendSuggestionProvider,
} from './suggestion-service.js';

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
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
      await generateSuggestions('seg1', 'original text', bedrockProvider, comprehendProvider);

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
