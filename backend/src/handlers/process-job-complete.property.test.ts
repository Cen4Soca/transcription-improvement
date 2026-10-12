import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseTranscribeOutput } from './process-job-complete.js';
import type { TranscribeOutput } from './process-job-complete.js';

/**
 * Arbitrary for generating a valid Amazon Transcribe output JSON structure
 * with speaker_labels.segments and matching items.
 */
function transcribeOutputArb(): fc.Arbitrary<TranscribeOutput> {
  // Generate 1-5 speaker segments with non-overlapping time ranges
  return fc
    .integer({ min: 1, max: 5 })
    .chain((numSegments) => {
      // Generate sorted start times to ensure non-overlapping segments
      return fc
        .array(
          fc.float({ min: 0.0, max: 100.0, noNaN: true, noDefaultInfinity: true }),
          { minLength: numSegments * 2, maxLength: numSegments * 2 }
        )
        .map((times) => times.sort((a, b) => a - b))
        .chain((sortedTimes) => {
          const segments: Array<{
            start_time: string;
            end_time: string;
            speaker_label: string;
            items: Array<{ start_time: string; end_time: string; speaker_label: string }>;
          }> = [];

          for (let i = 0; i < numSegments; i++) {
            const startTime = sortedTimes[i * 2];
            const endTime = sortedTimes[i * 2 + 1];
            // Ensure end > start
            if (endTime <= startTime) continue;
            segments.push({
              start_time: startTime.toFixed(3),
              end_time: endTime.toFixed(3),
              speaker_label: `spk_${i % 3}`,
              items: [],
            });
          }

          // If no valid segments, create at least one
          if (segments.length === 0) {
            segments.push({
              start_time: '0.000',
              end_time: '1.000',
              speaker_label: 'spk_0',
              items: [],
            });
          }

          // Generate items (pronunciations and punctuations) for each segment
          return fc
            .array(
              fc.record({
                wordsPerSegment: fc.integer({ min: 1, max: 4 }),
                hasPunctuation: fc.boolean(),
              }),
              { minLength: segments.length, maxLength: segments.length }
            )
            .chain((segmentConfigs) => {
              return fc
                .tuple(
                  ...segmentConfigs.map((config, segIdx) => {
                    const seg = segments[segIdx];
                    const segStart = parseFloat(seg.start_time);
                    const segEnd = parseFloat(seg.end_time);
                    const duration = segEnd - segStart;

                    return fc
                      .array(
                        fc.stringMatching(/^[a-z]{2,8}$/),
                        { minLength: config.wordsPerSegment, maxLength: config.wordsPerSegment }
                      )
                      .map((words) => {
                        const items: Array<{
                          start_time?: string;
                          end_time?: string;
                          type: 'pronunciation' | 'punctuation';
                          alternatives: Array<{ confidence: string; content: string }>;
                        }> = [];

                        words.forEach((word, wordIdx) => {
                          const wordStart = segStart + (duration * wordIdx) / words.length;
                          const wordEnd = segStart + (duration * (wordIdx + 1)) / words.length;
                          items.push({
                            start_time: wordStart.toFixed(3),
                            end_time: wordEnd.toFixed(3),
                            type: 'pronunciation',
                            alternatives: [{ confidence: '0.99', content: word }],
                          });
                        });

                        // Optionally add punctuation after the last word
                        if (config.hasPunctuation && items.length > 0) {
                          items.push({
                            type: 'punctuation',
                            alternatives: [{ confidence: '0.00', content: '.' }],
                          });
                        }

                        return items;
                      });
                  })
                )
                .map((allSegmentItems) => {
                  // Flatten all items into a single array (as Transcribe output does)
                  const flatItems = (allSegmentItems as Array<typeof allSegmentItems[number]>).flat();

                  // Also populate speaker segment items (metadata only)
                  segments.forEach((seg, idx) => {
                    const segItems = allSegmentItems[idx] as Array<{
                      start_time?: string;
                      end_time?: string;
                      type: 'pronunciation' | 'punctuation';
                      alternatives: Array<{ confidence: string; content: string }>;
                    }>;
                    seg.items = segItems
                      .filter((item) => item.type === 'pronunciation')
                      .map((item) => ({
                        start_time: item.start_time!,
                        end_time: item.end_time!,
                        speaker_label: seg.speaker_label,
                      }));
                  });

                  const output: TranscribeOutput = {
                    results: {
                      transcripts: [{ transcript: '' }],
                      speaker_labels: {
                        speakers: 3,
                        segments,
                      },
                      items: flatItems,
                    },
                  };

                  return output;
                });
            });
        });
    });
}

describe('Feature: process-job-complete, Property 24: Transcribe 出力パースの完全性', () => {
  /**
   * **Validates: Requirements 17.7**
   * parseTranscribeOutput produces one Segment per speaker_labels.segment that has matching items.
   */
  it('speaker_labels.segment ごとに1つの Segment を生成する（マッチするアイテムがある場合）', async () => {
    await fc.assert(
      fc.asyncProperty(transcribeOutputArb(), async (output) => {
        const result = parseTranscribeOutput(output);
        const speakerSegments = output.results.speaker_labels.segments;
        const items = output.results.items;

        // Count segments that have at least one matching pronunciation item
        const segmentsWithItems = speakerSegments.filter((seg) => {
          const segStart = parseFloat(seg.start_time);
          const segEnd = parseFloat(seg.end_time);
          return items.some(
            (item) =>
              item.start_time !== undefined &&
              parseFloat(item.start_time) >= segStart &&
              parseFloat(item.start_time) <= segEnd
          );
        });

        expect(result.length).toBe(segmentsWithItems.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 17.7**
   * Each Segment's startTime/endTime matches the speaker segment boundaries.
   */
  it('各 Segment の startTime/endTime が speaker segment の境界と一致する', async () => {
    await fc.assert(
      fc.asyncProperty(transcribeOutputArb(), async (output) => {
        const result = parseTranscribeOutput(output);
        const speakerSegments = output.results.speaker_labels.segments;
        const items = output.results.items;

        // Filter to segments that have matching items (same logic as parseTranscribeOutput)
        const segmentsWithItems = speakerSegments.filter((seg) => {
          const segStart = parseFloat(seg.start_time);
          const segEnd = parseFloat(seg.end_time);
          return items.some(
            (item) =>
              item.start_time !== undefined &&
              parseFloat(item.start_time) >= segStart &&
              parseFloat(item.start_time) <= segEnd
          );
        });

        for (let i = 0; i < result.length; i++) {
          const parsed = result[i];
          const source = segmentsWithItems[i];
          expect(parsed.startTime).toBeCloseTo(parseFloat(source.start_time), 2);
          expect(parsed.endTime).toBeCloseTo(parseFloat(source.end_time), 2);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 17.7**
   * Each Segment's speakerLabel matches the speaker segment's speaker_label.
   */
  it('各 Segment の speakerLabel が speaker segment の speaker_label と一致する', async () => {
    await fc.assert(
      fc.asyncProperty(transcribeOutputArb(), async (output) => {
        const result = parseTranscribeOutput(output);
        const speakerSegments = output.results.speaker_labels.segments;
        const items = output.results.items;

        const segmentsWithItems = speakerSegments.filter((seg) => {
          const segStart = parseFloat(seg.start_time);
          const segEnd = parseFloat(seg.end_time);
          return items.some(
            (item) =>
              item.start_time !== undefined &&
              parseFloat(item.start_time) >= segStart &&
              parseFloat(item.start_time) <= segEnd
          );
        });

        for (let i = 0; i < result.length; i++) {
          expect(result[i].speakerLabel).toBe(segmentsWithItems[i].speaker_label);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 17.7**
   * Text is correctly assembled from items: space between pronunciations, no space before punctuation.
   */
  it('テキストが正しく組み立てられる（pronunciation 間にスペース、punctuation 前にスペースなし）', async () => {
    await fc.assert(
      fc.asyncProperty(transcribeOutputArb(), async (output) => {
        const result = parseTranscribeOutput(output);

        for (const segment of result) {
          const text = segment.originalText;

          // Text should not start or end with a space
          if (text.length > 0) {
            expect(text).not.toMatch(/^\s/);
            expect(text).not.toMatch(/\s$/);
          }

          // No double spaces (space between pronunciations, no space before punctuation)
          expect(text).not.toContain('  ');

          // Punctuation should not be preceded by a space
          // (punctuation in our generator is always '.')
          if (text.includes('.')) {
            expect(text).not.toMatch(/\s\./);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
