import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
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

describe('Feature: session-name-edit, Property 2: suggestion length cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: 要件2（提案は100文字以内）**
   *
   * No matter what string length a provider returns, the suggestion returned by
   * suggestSessionName is either null or at most 100 characters long.
   */
  it('returns a suggestion that is null or at most 100 characters', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (providerOutput) => {
        const { docClient } = await import('../utils/dynamodb-client.js');
        vi.mocked(docClient.send).mockResolvedValue({
          Items: [{ originalText: 'non-empty transcript text' }],
        } as never);

        const provider: SessionNameProvider = {
          suggestName: vi.fn().mockResolvedValue(providerOutput),
        };

        const result = await suggestSessionName('session-1', provider);

        expect(
          result.suggestion === null || result.suggestion.length <= 100
        ).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
