import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  suggestSessionName,
  type SessionNameProvider,
} from './session-name-suggestion-service.js';

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'TestTable',
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: vi.fn() })),
  InvokeModelCommand: vi.fn(),
}));

describe('suggestSessionName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should concatenate segment text and pass it to the provider', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { originalText: 'こんにちは' },
        { originalText: '今日の会議' },
      ],
    } as never);

    const provider: SessionNameProvider = {
      suggestName: vi.fn().mockResolvedValue('会議の挨拶'),
    };

    const result = await suggestSessionName('session-1', provider);

    expect(provider.suggestName).toHaveBeenCalledWith('こんにちは 今日の会議');
    expect(result).toEqual({ suggestion: '会議の挨拶', hasExternalApiError: false });
  });

  it('should truncate a suggestion longer than 100 characters to 100 characters', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{ originalText: 'some transcript' }],
    } as never);

    const longName = 'あ'.repeat(150);
    const provider: SessionNameProvider = {
      suggestName: vi.fn().mockResolvedValue(longName),
    };

    const result = await suggestSessionName('session-1', provider);

    expect(result.hasExternalApiError).toBe(false);
    expect(result.suggestion).not.toBeNull();
    expect(result.suggestion!.length).toBe(100);
  });

  it('should return hasExternalApiError:true and suggestion:null when the provider throws', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{ originalText: 'some transcript' }],
    } as never);

    const provider: SessionNameProvider = {
      suggestName: vi.fn().mockRejectedValue(new Error('Bedrock timeout')),
    };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await suggestSessionName('session-1', provider);

      expect(result).toEqual({ suggestion: null, hasExternalApiError: true });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('should return suggestion:null without calling the provider when there are no segments', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
    } as never);

    const provider: SessionNameProvider = {
      suggestName: vi.fn(),
    };

    const result = await suggestSessionName('session-1', provider);

    expect(result).toEqual({ suggestion: null, hasExternalApiError: false });
    expect(provider.suggestName).not.toHaveBeenCalled();
  });

  it('should return suggestion:null when the provider returns only whitespace', async () => {
    const { docClient } = await import('../utils/dynamodb-client.js');
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{ originalText: 'some transcript' }],
    } as never);

    const provider: SessionNameProvider = {
      suggestName: vi.fn().mockResolvedValue('   '),
    };

    const result = await suggestSessionName('session-1', provider);

    expect(result).toEqual({ suggestion: null, hasExternalApiError: false });
  });
});
