import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  checkRoleAccess,
  filterCompletedModels,
  generateTrainingData,
  checkModelNameDuplicate,
  setTranscribeClient,
  ConfirmedSegment,
  LanguageModelSummary,
} from './language-model-service.js';

// --- Property 6 ---

const MODEL_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'FAILED'] as const;

const languageModelSummaryArb: fc.Arbitrary<LanguageModelSummary> = fc.record({
  modelName: fc.string({ minLength: 1, maxLength: 50 }),
  modelStatus: fc.constantFrom(...MODEL_STATUSES),
  baseModelName: fc.option(fc.constantFrom('NarrowBand', 'WideBand'), { nil: undefined }),
  createTime: fc.option(
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
    { nil: undefined }
  ),
});

describe('Feature: transcription-workflow-enhancements, Property 6: カスタム言語モデルのステータスフィルタリング', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any list of language models (each with status IN_PROGRESS, COMPLETED, or FAILED),
   * filterCompletedModels returns only models with status COMPLETED.
   * No models with non-COMPLETED status are included, and no COMPLETED models are lost.
   */

  it('all returned models have status COMPLETED', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          for (const model of result) {
            expect(model.modelStatus).toBe('COMPLETED');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no models with non-COMPLETED status are in the result', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          const nonCompleted = result.filter((m) => m.modelStatus !== 'COMPLETED');
          expect(nonCompleted).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all COMPLETED models from the input are present in the output (no loss)', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          const completedInInput = models.filter((m) => m.modelStatus === 'COMPLETED');
          expect(result).toEqual(completedInInput);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the count of returned models equals the count of COMPLETED models in the input', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          const completedCount = models.filter((m) => m.modelStatus === 'COMPLETED').length;
          expect(result).toHaveLength(completedCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 25 ---

describe('Feature: transcription-review-app, Property 25: カスタム言語モデルのステータスフィルタリング', () => {
  /**
   * **Validates: Requirements 18.4**
   *
   * When filtering language models for display:
   * 1. Only models with status 'COMPLETED' are included in the result
   * 2. Models with status 'IN_PROGRESS' or 'FAILED' are excluded
   * 3. The filter preserves all COMPLETED models (no false negatives)
   */

  it('only models with status COMPLETED are included in the result', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          for (const model of result) {
            expect(model.modelStatus).toBe('COMPLETED');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('models with status IN_PROGRESS or FAILED are excluded', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          const excluded = result.filter(
            (m) => m.modelStatus === 'IN_PROGRESS' || m.modelStatus === 'FAILED'
          );
          expect(excluded).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the filter preserves all COMPLETED models (no false negatives)', () => {
    fc.assert(
      fc.property(
        fc.array(languageModelSummaryArb, { minLength: 0, maxLength: 30 }),
        (models) => {
          const result = filterCompletedModels(models);
          const completedInInput = models.filter((m) => m.modelStatus === 'COMPLETED');
          expect(result).toHaveLength(completedInInput.length);
          expect(result).toEqual(completedInInput);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 12 ---

describe('Feature: transcription-workflow-enhancements, Property 12: トレーニングデータ生成の完全性', () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any set of confirmed segment texts, the generated training data file must contain
   * all confirmed segment texts and must not contain any unconfirmed segment texts.
   */

  const segmentArb: fc.Arbitrary<ConfirmedSegment> = fc.record({
    text: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes('\n')),
    confirmed: fc.boolean(),
  });

  it('all confirmed segment texts appear in the training data', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArb, { minLength: 1, maxLength: 50 }),
        (segments) => {
          const result = generateTrainingData(segments);
          const confirmedSegments = segments.filter((s) => s.confirmed);

          for (const segment of confirmedSegments) {
            expect(result).toContain(segment.text);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no unconfirmed segment texts appear in the training data', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArb, { minLength: 1, maxLength: 50 }).filter(
          (segments) =>
            segments.some((s) => !s.confirmed) && segments.some((s) => s.confirmed),
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          const resultLines = result.split('\n');
          const unconfirmedSegments = segments.filter((s) => !s.confirmed);
          const confirmedTexts = segments.filter((s) => s.confirmed).map((s) => s.text);

          for (const segment of unconfirmedSegments) {
            // Only check if the unconfirmed text is not also present as a confirmed text
            // (since the same text could appear in both confirmed and unconfirmed segments)
            if (!confirmedTexts.includes(segment.text)) {
              // Check that the unconfirmed text does not appear as its own line
              // (not substring check, since confirmed texts may contain unconfirmed text as substring)
              expect(resultLines).not.toContain(segment.text);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the number of lines in the output equals the number of confirmed segments', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArb, { minLength: 1, maxLength: 50 }).filter(
          (segments) => segments.some((s) => s.confirmed),
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          const confirmedCount = segments.filter((s) => s.confirmed).length;
          const lineCount = result.split('\n').length;

          expect(lineCount).toBe(confirmedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty confirmed segments list produces empty string', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes('\n')),
            confirmed: fc.constant(false),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          expect(result).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 31 ---

describe('Feature: transcription-review-app, Property 31: トレーニングデータ生成の完全性', () => {
  /**
   * **Validates: Requirements 20.3**
   *
   * When generating training data from segments:
   * 1. Only includes text from segments where confirmed === true
   * 2. Excludes text from segments where confirmed === false
   * 3. Joins confirmed texts with newline characters
   * 4. Returns empty string when no confirmed segments exist
   */

  const confirmedSegmentArb: fc.Arbitrary<ConfirmedSegment> = fc.record({
    text: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes('\n')),
    confirmed: fc.boolean(),
  });

  it('only includes text from segments where confirmed === true', () => {
    fc.assert(
      fc.property(
        fc.array(confirmedSegmentArb, { minLength: 1, maxLength: 50 }).filter(
          (segments) => segments.some((s) => s.confirmed),
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          const resultLines = result.split('\n');
          const confirmedTexts = segments.filter((s) => s.confirmed).map((s) => s.text);

          expect(resultLines).toEqual(confirmedTexts);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('excludes text from segments where confirmed === false', () => {
    fc.assert(
      fc.property(
        fc.array(confirmedSegmentArb, { minLength: 1, maxLength: 50 }).filter(
          (segments) =>
            segments.some((s) => !s.confirmed) && segments.some((s) => s.confirmed),
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          const resultLines = result.split('\n');
          const unconfirmedTexts = segments.filter((s) => !s.confirmed).map((s) => s.text);
          const confirmedTexts = new Set(segments.filter((s) => s.confirmed).map((s) => s.text));

          for (const text of unconfirmedTexts) {
            // Only assert exclusion if the text is not also present in a confirmed segment
            if (!confirmedTexts.has(text)) {
              expect(resultLines).not.toContain(text);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('joins confirmed texts with newline characters', () => {
    fc.assert(
      fc.property(
        fc.array(confirmedSegmentArb, { minLength: 1, maxLength: 50 }).filter(
          (segments) => segments.filter((s) => s.confirmed).length >= 2,
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          const confirmedTexts = segments.filter((s) => s.confirmed).map((s) => s.text);
          const expected = confirmedTexts.join('\n');

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns empty string when no confirmed segments exist', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes('\n')),
            confirmed: fc.constant(false),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (segments) => {
          const result = generateTrainingData(segments);
          expect(result).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 32 ---

describe('Feature: transcription-review-app, Property 32: カスタム言語モデル名の重複チェック', () => {
  /**
   * **Validates: Requirements 20.11**
   *
   * For any model name and list of existing model names, the duplicate check must:
   * 1. Return true (reject creation) when the model name exactly matches an existing model (case-sensitive)
   * 2. Return false (allow creation) when the model name does NOT match any existing model
   * 3. Case-sensitive: 'MyModel' and 'mymodel' are different names
   */

  // Generator for valid model names (alphanumeric + hyphens + underscores)
  const modelNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => /^[a-zA-Z0-9_-]+$/.test(s),
  );

  // Helper to create a mock Transcribe client that returns a given list of model names
  function createMockTranscribeClient(existingModelNames: string[]) {
    return {
      send: async () => ({
        Models: existingModelNames.map((name) => ({ ModelName: name })),
      }),
    } as any;
  }

  afterEach(() => {
    // Reset the client after each test
    setTranscribeClient(undefined as any);
  });

  it('returns true when modelName exists in the existing models list', () => {
    return fc.assert(
      fc.asyncProperty(
        modelNameArb,
        fc.array(modelNameArb, { minLength: 0, maxLength: 20 }),
        async (targetName, otherNames) => {
          // Ensure the target name is in the list
          const existingNames = [...otherNames, targetName];
          setTranscribeClient(createMockTranscribeClient(existingNames));

          const result = await checkModelNameDuplicate(targetName);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false when modelName does NOT exist in the existing models list', () => {
    return fc.assert(
      fc.asyncProperty(
        modelNameArb,
        fc.array(modelNameArb, { minLength: 0, maxLength: 20 }),
        async (targetName, existingNames) => {
          // Filter out the target name from the existing list to ensure it's not present
          const filteredNames = existingNames.filter((name) => name !== targetName);
          setTranscribeClient(createMockTranscribeClient(filteredNames));

          const result = await checkModelNameDuplicate(targetName);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses case-sensitive comparison (exact match only)', () => {
    return fc.assert(
      fc.asyncProperty(
        modelNameArb.filter((s) => s.toLowerCase() !== s.toUpperCase()),
        async (targetName) => {
          // Create a list with the name in different case variations
          const variations = [
            targetName.toLowerCase(),
            targetName.toUpperCase(),
            targetName.charAt(0).toUpperCase() + targetName.slice(1).toLowerCase(),
          ].filter((v) => v !== targetName);

          // Only test if we actually have case variations different from the target
          if (variations.length === 0) return;

          setTranscribeClient(createMockTranscribeClient(variations));

          const result = await checkModelNameDuplicate(targetName);
          // Since none of the variations are an exact match, result should be false
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// --- Property 30 ---

describe('Feature: transcription-review-app, Property 30: ロールベースアクセス制御（Admin/TeamLeader 限定機能）', () => {
  /**
   * **Validates: Requirements 20.1, 20.2, 21.1, 21.2**
   *
   * checkRoleAccess() must:
   * 1. Return true for 'ADMIN' and 'TEAM_LEADER' roles
   * 2. Return false for 'REVIEWER' role
   * 3. Return false for any other arbitrary string
   */

  it('returns true for ADMIN and TEAM_LEADER roles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ADMIN', 'TEAM_LEADER'),
        (role) => {
          expect(checkRoleAccess(role)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false for REVIEWER role', () => {
    fc.assert(
      fc.property(
        fc.constant('REVIEWER'),
        (role) => {
          expect(checkRoleAccess(role)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false for any other arbitrary string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }).filter(
          (s) => s !== 'ADMIN' && s !== 'TEAM_LEADER'
        ),
        (role) => {
          expect(checkRoleAccess(role)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
