import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  mergeSuggestions,
  limitSuggestions,
  generateSuggestions,
  type SuggestionCandidate,
  type SuggestionSource,
  type BedrockSuggestionProvider,
  type ComprehendSuggestionProvider,
} from './suggestion-service.js';

/**
 * Arbitrary for generating a SuggestionCandidate with a specific source.
 */
function arbCandidate(source: SuggestionSource): fc.Arbitrary<SuggestionCandidate> {
  return fc.record({
    text: fc.string({ minLength: 0, maxLength: 30 }),
    source: fc.constant(source),
  });
}

// Mock DynamoDB for generateSuggestions tests
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: {
    send: vi.fn().mockResolvedValue({ Items: [] }),
  },
  TABLE_NAME: 'TestTable',
}));

describe('Feature: transcription-review-app, Property 13: 修正候補の最大件数制限', () => {
  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * Property 13: 修正候補の最大件数制限
   * limitSuggestions() は入力サイズに関わらず最大5件までの候補しか返さない。
   */

  it('limitSuggestions() never returns more than 5 candidates regardless of input size', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 50 }),
            source: fc.constantFrom('history', 'bedrock', 'comprehend') as fc.Arbitrary<SuggestionSource>,
          }),
          { minLength: 0, maxLength: 50 }
        ),
        (candidates) => {
          const result = limitSuggestions(candidates);
          expect(result.length).toBeLessThanOrEqual(5);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * generateSuggestions() は全ソースが多数の結果を返しても最大5件までの候補しか返さない。
   */
  it('generateSuggestions() returns at most 5 candidates even when all sources provide many results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 30 }),
            source: fc.constant('history' as SuggestionSource),
          }),
          { minLength: 0, maxLength: 15 }
        ),
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 30 }),
            source: fc.constant('bedrock' as SuggestionSource),
          }),
          { minLength: 0, maxLength: 15 }
        ),
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 30 }),
            source: fc.constant('comprehend' as SuggestionSource),
          }),
          { minLength: 0, maxLength: 15 }
        ),
        async (historyCandidates, bedrockCandidates, comprehendCandidates) => {
          // Mock DynamoDB to return history candidates
          const { docClient } = await import('../utils/dynamodb-client.js');
          vi.mocked(docClient.send).mockResolvedValue({
            Items: historyCandidates.map((c) => ({ afterText: c.text })),
          } as never);

          const mockBedrockProvider: BedrockSuggestionProvider = {
            getSuggestions: async () => bedrockCandidates,
          };
          const mockComprehendProvider: ComprehendSuggestionProvider = {
            getSuggestions: async () => comprehendCandidates,
          };

          const result = await generateSuggestions(
            'test-segment-id',
            'original text',
            mockBedrockProvider,
            mockComprehendProvider
          );

          expect(result.suggestions.length).toBeLessThanOrEqual(5);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: transcription-review-app, Property 14: 修正候補のマージ・優先順位・重複除去', () => {
  /**
   * Validates: Requirements 8.3
   *
   * Property 14: 修正候補のマージ・優先順位・重複除去
   * For any CorrectionHistory由来の候補リストと外部API由来の候補リストを与えたとき、
   * マージ結果はCorrectionHistory由来の候補が先頭に並び、重複するテキストは除去され、
   * 全体の件数は入力のユニークテキスト数以下でなければならない。
   */

  it('history candidates appear before bedrock candidates, which appear before comprehend candidates', () => {
    fc.assert(
      fc.property(
        fc.array(arbCandidate('history'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('bedrock'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('comprehend'), { minLength: 0, maxLength: 10 }),
        (historyCandidates, bedrockCandidates, comprehendCandidates) => {
          const result = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

          // Find the last index of each source type in the result
          let lastHistoryIndex = -1;
          let firstBedrockIndex = result.length;
          let lastBedrockIndex = -1;
          let firstComprehendIndex = result.length;

          for (let i = 0; i < result.length; i++) {
            if (result[i].source === 'history') {
              lastHistoryIndex = i;
            }
            if (result[i].source === 'bedrock') {
              if (firstBedrockIndex === result.length) firstBedrockIndex = i;
              lastBedrockIndex = i;
            }
            if (result[i].source === 'comprehend') {
              if (firstComprehendIndex === result.length) firstComprehendIndex = i;
            }
          }

          // All history candidates must come before any bedrock candidate
          if (lastHistoryIndex >= 0 && firstBedrockIndex < result.length) {
            expect(lastHistoryIndex).toBeLessThan(firstBedrockIndex);
          }

          // All history candidates must come before any comprehend candidate
          if (lastHistoryIndex >= 0 && firstComprehendIndex < result.length) {
            expect(lastHistoryIndex).toBeLessThan(firstComprehendIndex);
          }

          // All bedrock candidates must come before any comprehend candidate
          if (lastBedrockIndex >= 0 && firstComprehendIndex < result.length) {
            expect(lastBedrockIndex).toBeLessThan(firstComprehendIndex);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no duplicate text values exist in the result (after trimming)', () => {
    fc.assert(
      fc.property(
        fc.array(arbCandidate('history'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('bedrock'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('comprehend'), { minLength: 0, maxLength: 10 }),
        (historyCandidates, bedrockCandidates, comprehendCandidates) => {
          const result = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

          const texts = result.map((c) => c.text.trim());
          const uniqueTexts = new Set(texts);

          expect(texts.length).toBe(uniqueTexts.size);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('total result count is at most the sum of unique texts across all inputs', () => {
    fc.assert(
      fc.property(
        fc.array(arbCandidate('history'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('bedrock'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('comprehend'), { minLength: 0, maxLength: 10 }),
        (historyCandidates, bedrockCandidates, comprehendCandidates) => {
          const result = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

          // Collect all unique non-empty trimmed texts from all inputs
          const allTexts = new Set<string>();
          for (const c of [...historyCandidates, ...bedrockCandidates, ...comprehendCandidates]) {
            const trimmed = c.text.trim();
            if (trimmed !== '') {
              allTexts.add(trimmed);
            }
          }

          expect(result.length).toBeLessThanOrEqual(allTexts.size);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty or whitespace-only texts are excluded from results', () => {
    fc.assert(
      fc.property(
        fc.array(arbCandidate('history'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('bedrock'), { minLength: 0, maxLength: 10 }),
        fc.array(arbCandidate('comprehend'), { minLength: 0, maxLength: 10 }),
        (historyCandidates, bedrockCandidates, comprehendCandidates) => {
          const result = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

          // No result entry should have empty or whitespace-only text
          for (const candidate of result) {
            expect(candidate.text.trim()).not.toBe('');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('duplicate texts keep only the first occurrence from the highest priority source', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        (sharedText) => {
          // Create the same text in all three sources
          const historyCandidates: SuggestionCandidate[] = [{ text: sharedText, source: 'history' }];
          const bedrockCandidates: SuggestionCandidate[] = [{ text: sharedText, source: 'bedrock' }];
          const comprehendCandidates: SuggestionCandidate[] = [{ text: sharedText, source: 'comprehend' }];

          const result = mergeSuggestions(historyCandidates, bedrockCandidates, comprehendCandidates);

          // Only one entry should exist for the shared text
          const matchingEntries = result.filter((c) => c.text === sharedText.trim());
          expect(matchingEntries.length).toBe(1);

          // The kept entry should be from the highest priority source (history)
          expect(matchingEntries[0].source).toBe('history');
        }
      ),
      { numRuns: 100 }
    );
  });
});
