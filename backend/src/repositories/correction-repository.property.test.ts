import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { saveCorrection, getCorrections, type CorrectionRecord } from './correction-repository.js';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

/**
 * Arbitrary that generates valid CorrectionRecord values including optional fields.
 */
const correctionRecordArb: fc.Arbitrary<CorrectionRecord> = fc.record({
  correctionId: fc.uuid(),
  sessionId: fc.uuid(),
  segmentId: fc.uuid(),
  userId: fc.uuid(),
  correctionType: fc.constantFrom('TEXT' as const, 'SPEAKER' as const, 'SPEAKER_RENAME' as const),
  beforeText: fc.string({ minLength: 0, maxLength: 200 }),
  afterText: fc.string({ minLength: 0, maxLength: 200 }),
  beforeSpeaker: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  afterSpeaker: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  affectedSegmentCount: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  createdAt: fc.date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T23:59:59.999Z'),
  }).map((d) => d.toISOString()),
});

describe('Feature: correction-repository, Property 9: Correctionの保存・復元ラウンドトリップ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * For any valid CorrectionRecord, after saving via saveCorrection() and then
   * retrieving via getCorrections(), all fields are preserved exactly (round-trip integrity).
   * Fields verified: correctionId, sessionId, segmentId, userId, correctionType,
   * beforeText, afterText, beforeSpeaker, afterSpeaker, affectedSegmentCount, createdAt.
   */
  it('all fields of a CorrectionRecord are preserved through save and retrieve round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(correctionRecordArb, async (record: CorrectionRecord) => {
        // In-memory store simulating DynamoDB
        const store = new Map<string, Record<string, unknown>>();

        mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
          const input = command.input;

          // PutCommand: store the item keyed by PK+SK
          if (input['Item'] !== undefined) {
            const item = input['Item'] as Record<string, unknown>;
            const key = `${item['PK']}|${item['SK']}`;
            store.set(key, item);
            return Promise.resolve({});
          }

          // QueryCommand: return items matching the PK prefix
          if (input['KeyConditionExpression'] !== undefined) {
            const pkValue = (input['ExpressionAttributeValues'] as Record<string, string>)[':pk'];
            const items = Array.from(store.values()).filter(
              (item) => item['PK'] === pkValue && (item['SK'] as string).startsWith('CORRECTION#')
            );
            return Promise.resolve({ Items: items });
          }

          return Promise.resolve({});
        });

        // Save the correction
        const saveResult = await saveCorrection(record);
        expect(saveResult.saved).toBe(true);

        // Retrieve corrections for the same session and user
        const retrieved = await getCorrections(record.sessionId, record.userId);

        // Verify exactly one record was retrieved
        expect(retrieved.length).toBe(1);

        const restored = retrieved[0];

        // Verify all fields are preserved exactly
        expect(restored.correctionId).toBe(record.correctionId);
        expect(restored.sessionId).toBe(record.sessionId);
        expect(restored.segmentId).toBe(record.segmentId);
        expect(restored.userId).toBe(record.userId);
        expect(restored.correctionType).toBe(record.correctionType);
        expect(restored.beforeText).toBe(record.beforeText);
        expect(restored.afterText).toBe(record.afterText);
        expect(restored.beforeSpeaker).toBe(record.beforeSpeaker);
        expect(restored.afterSpeaker).toBe(record.afterSpeaker);
        expect(restored.affectedSegmentCount).toBe(record.affectedSegmentCount);
        expect(restored.createdAt).toBe(record.createdAt);
      }),
      { numRuns: 100 }
    );
  });
});
