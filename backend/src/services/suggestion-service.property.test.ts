import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  mergeSuggestions,
  limitSuggestions,
  generateSuggestions,
  selectSurroundingSegments,
  type SuggestionCandidate,
  type SuggestionSource,
  type BedrockSuggestionProvider,
  type ComprehendSuggestionProvider,
} from './suggestion-service.js';
import type { SegmentSummary } from '../repositories/segment-repository.js';

/**
 * Character budget mirrored from the implementation's MAX_CONTEXT_LENGTH.
 * Kept in sync here so the property can assert the output stays within budget.
 */
const MAX_CONTEXT_LENGTH = 2000;

/** Target marker mirrored from the implementation (TARGET_SEGMENT_MARKER). */
const TARGET_SEGMENT_MARKER = '  ← 修正対象のセグメント';

/**
 * Reproduce the implementation's formatted-line length so the property can
 * compute the total context size independently of internals.
 */
function formattedLineLength(segment: SegmentSummary, isTarget: boolean): number {
  const label = segment.speakerLabel?.trim();
  const text = segment.originalText.trim();
  const line = label ? `[${label}] ${text}` : text;
  return line.length + (isTarget ? TARGET_SEGMENT_MARKER.length : 0);
}

/** Arbitrary for a SegmentSummary with a stable, unique segmentId per index. */
function arbSegments(): fc.Arbitrary<SegmentSummary[]> {
  return fc
    .array(
      fc.record({
        startTime: fc.double({ min: 0, max: 10000, noNaN: true }),
        originalText: fc.string({ minLength: 0, maxLength: 60 }),
        speakerLabel: fc.option(fc.string({ minLength: 0, maxLength: 10 }), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 20 }
    )
    .map((items) =>
      items.map((item, index) => ({
        segmentId: `seg-${index}`,
        startTime: item.startTime,
        originalText: item.originalText,
        ...(item.speakerLabel !== undefined ? { speakerLabel: item.speakerLabel } : {}),
      }))
    );
}

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

// generateSuggestions now assembles surrounding context via the segment/session
// repositories. Mock them to "no context" so these properties focus on the
// merge/limit behavior (context assembly is covered in the unit tests).
vi.mock('../repositories/segment-repository.js', () => ({
  getSessionSegments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn().mockResolvedValue(null),
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
            'test-session-id',
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

describe('Feature: suggestion-context-injection, Property 15: 周辺セグメント選定の文字数バジェット・対象包含・順序保持', () => {
  /**
   * **Validates: Requirements 8.1 (周辺コンテキスト注入 — 合計2000文字まで)**
   *
   * selectSurroundingSegments() が返す周辺セグメント群は、整形後の合計文字数が
   * 常に MAX_CONTEXT_LENGTH(2000) 以下である。ただし対象セグメント単体が予算を超える
   * 場合は、対象のみを必ず含める（この唯一の例外を許容）。
   */
  it('keeps the formatted total within the budget (target may exceed alone)', () => {
    fc.assert(
      fc.property(arbSegments(), fc.nat(), (segments, targetSeed) => {
        const target = segments[targetSeed % segments.length];
        const selected = selectSurroundingSegments(segments, target.segmentId, MAX_CONTEXT_LENGTH);

        const total = selected.reduce(
          (sum, s) => sum + formattedLineLength(s, s.segmentId === target.segmentId),
          0
        );

        const targetAloneCost = formattedLineLength(target, true);
        if (targetAloneCost > MAX_CONTEXT_LENGTH) {
          // Only the target is included when it alone exceeds the budget.
          expect(selected.map((s) => s.segmentId)).toEqual([target.segmentId]);
        } else {
          expect(total).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * 対象セグメントは常に出力へ含まれる。
   */
  it('always includes the target segment', () => {
    fc.assert(
      fc.property(arbSegments(), fc.nat(), (segments, targetSeed) => {
        const target = segments[targetSeed % segments.length];
        const selected = selectSurroundingSegments(segments, target.segmentId, MAX_CONTEXT_LENGTH);

        expect(selected.some((s) => s.segmentId === target.segmentId)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * 出力は入力（startTime 昇順）の並びを保持する。segmentId は index 順に
   * 採番しているため、出力の segmentId 列は入力の相対順序と一致する。
   */
  it('preserves the input order of the selected segments', () => {
    fc.assert(
      fc.property(arbSegments(), fc.nat(), (segments, targetSeed) => {
        const target = segments[targetSeed % segments.length];
        const selected = selectSurroundingSegments(segments, target.segmentId, MAX_CONTEXT_LENGTH);

        const inputOrder = segments.map((s) => s.segmentId);
        const selectedOrder = selected.map((s) => s.segmentId);
        const expectedOrder = inputOrder.filter((id) => selectedOrder.includes(id));

        expect(selectedOrder).toEqual(expectedOrder);
      }),
      { numRuns: 100 }
    );
  });
});
