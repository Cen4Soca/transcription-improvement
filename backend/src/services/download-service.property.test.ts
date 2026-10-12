import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  filterConfirmedSegments,
  generateDownloadFilename,
  generateTranscriptionJson,
  generateTranscriptionSrt,
  DownloadSegment,
} from './download-service.js';

/**
 * Feature: download-transcription, Property 26: ダウンロード対象の確定済み Segment フィルタリング
 *
 * **Validates: Requirements 19.1**
 *
 * For any set of segments (each with consensusStatus of UNDECIDED, CONFIRMED, or CONFLICT),
 * only segments with consensusStatus === 'CONFIRMED' are included in the download target,
 * and segments with UNDECIDED or CONFLICT are excluded.
 */
describe('Feature: download-transcription, Property 26: ダウンロード対象の確定済み Segment フィルタリング', () => {
  const consensusStatusArb = fc.constantFrom<'UNDECIDED' | 'CONFIRMED' | 'CONFLICT'>(
    'UNDECIDED',
    'CONFIRMED',
    'CONFLICT',
  );

  const downloadSegmentArb: fc.Arbitrary<DownloadSegment> = fc.record({
    segmentId: fc.uuid(),
    startTime: fc.float({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
    endTime: fc.float({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
    text: fc.string({ minLength: 1, maxLength: 200 }),
    speakerLabel: fc.option(fc.stringMatching(/^spk_[0-9]$/), { nil: undefined }),
    consensusStatus: consensusStatusArb,
  });

  const segmentsArb = fc.array(downloadSegmentArb, { minLength: 0, maxLength: 30 });

  it('all returned segments have consensusStatus === CONFIRMED', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const result = filterConfirmedSegments(segments);
        for (const segment of result) {
          expect(segment.consensusStatus).toBe('CONFIRMED');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('no segments with non-CONFIRMED status are in the result', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const result = filterConfirmedSegments(segments);
        const nonConfirmed = result.filter((s) => s.consensusStatus !== 'CONFIRMED');
        expect(nonConfirmed).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('all CONFIRMED segments from the input are present in the output (no loss)', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const result = filterConfirmedSegments(segments);
        const inputConfirmed = segments.filter((s) => s.consensusStatus === 'CONFIRMED');
        expect(result).toHaveLength(inputConfirmed.length);
        for (const confirmedSegment of inputConfirmed) {
          expect(result).toContainEqual(confirmedSegment);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('the count of returned segments equals the count of CONFIRMED segments in the input', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const result = filterConfirmedSegments(segments);
        const confirmedCount = segments.filter((s) => s.consensusStatus === 'CONFIRMED').length;
        expect(result).toHaveLength(confirmedCount);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: download-transcription, Property 27: JSON 形式ダウンロードの構造的正確性
 *
 * **Validates: Requirements 19.2, 19.4**
 *
 * For any set of confirmed segments (each with startTime, endTime, text, speakerLabel),
 * the generated JSON must be valid and each segment entry must contain startTime, endTime,
 * text, and speakerLabel fields that match the original segment data.
 */
describe('Feature: download-transcription, Property 27: JSON 形式ダウンロードの構造的正確性', () => {
  const segmentWithSpeakerArb: fc.Arbitrary<DownloadSegment> = fc
    .record({
      segmentId: fc.uuid(),
      startTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      endTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      text: fc.string({ minLength: 1, maxLength: 200 }),
      speakerLabel: fc.stringMatching(/^spk_[0-9]$/),
      consensusStatus: fc.constant('CONFIRMED' as const),
    })
    .filter((s) => s.endTime > s.startTime);

  const segmentWithoutSpeakerArb: fc.Arbitrary<DownloadSegment> = fc
    .record({
      segmentId: fc.uuid(),
      startTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      endTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      text: fc.string({ minLength: 1, maxLength: 200 }),
      consensusStatus: fc.constant('CONFIRMED' as const),
    })
    .filter((s) => s.endTime > s.startTime)
    .map((s) => ({
      ...s,
      speakerLabel: undefined,
    }));

  const segmentArb: fc.Arbitrary<DownloadSegment> = fc.oneof(
    segmentWithSpeakerArb,
    segmentWithoutSpeakerArb,
  );

  const segmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 20 });

  const sessionNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => s.trim().length > 0,
  );

  const exportedAtArb = fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
  }).map((d) => d.toISOString());

  it('generated JSON contains sessionName matching input', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);
        expect(result.sessionName).toBe(sessionName);
      }),
      { numRuns: 100 },
    );
  });

  it('generated JSON contains exportedAt matching input', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);
        expect(result.exportedAt).toBe(exportedAt);
      }),
      { numRuns: 100 },
    );
  });

  it('generated JSON segments count matches input segments count', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);
        expect(result.segments).toHaveLength(segments.length);
      }),
      { numRuns: 100 },
    );
  });

  it('each JSON segment contains startTime, endTime, and text matching input', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);

        result.segments.forEach((jsonSegment, index) => {
          const inputSegment = segments[index];
          expect(jsonSegment.startTime).toBe(inputSegment.startTime);
          expect(jsonSegment.endTime).toBe(inputSegment.endTime);
          expect(jsonSegment.text).toBe(inputSegment.text);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('speakerLabel is included when present and omitted when absent', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);

        result.segments.forEach((jsonSegment, index) => {
          const inputSegment = segments[index];
          if (inputSegment.speakerLabel) {
            expect(jsonSegment.speakerLabel).toBe(inputSegment.speakerLabel);
          } else {
            expect('speakerLabel' in jsonSegment).toBe(false);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  it('generated JSON is serializable to valid JSON string', () => {
    fc.assert(
      fc.property(sessionNameArb, segmentsArb, exportedAtArb, (sessionName, segments, exportedAt) => {
        const result = generateTranscriptionJson(sessionName, segments, exportedAt);
        const jsonString = JSON.stringify(result);
        const parsed = JSON.parse(jsonString);
        expect(parsed.sessionName).toBe(sessionName);
        expect(parsed.segments).toHaveLength(segments.length);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: download-transcription, Property 28: SRT 形式ダウンロードの構造的正確性
 *
 * **Validates: Requirements 19.3, 19.5, 19.6**
 *
 * For any set of confirmed segments, the generated SRT must satisfy:
 * (1) Each entry has a sequential number starting from 1
 * (2) Timecodes match format HH:MM:SS,mmm --> HH:MM:SS,mmm
 * (3) Text is present in each entry
 * (4) When speakerLabel exists, text starts with [speakerLabel]
 * (5) When speakerLabel is absent, text does NOT start with [
 */
describe('Feature: download-transcription, Property 28: SRT 形式ダウンロードの構造的正確性', () => {
  const segmentWithSpeakerArb: fc.Arbitrary<DownloadSegment> = fc
    .record({
      segmentId: fc.uuid(),
      startTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      endTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      text: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
      speakerLabel: fc.stringMatching(/^spk_[0-9]$/),
      consensusStatus: fc.constant('CONFIRMED' as const),
    })
    .filter((s) => s.endTime > s.startTime);

  const segmentWithoutSpeakerArb: fc.Arbitrary<DownloadSegment> = fc
    .record({
      segmentId: fc.uuid(),
      startTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      endTime: fc.double({ min: 0, max: 7200, noNaN: true, noDefaultInfinity: true }),
      text: fc
        .string({ minLength: 1, maxLength: 200 })
        .filter((s) => s.trim().length > 0 && !s.startsWith('[')),
      consensusStatus: fc.constant('CONFIRMED' as const),
    })
    .filter((s) => s.endTime > s.startTime)
    .map((s) => ({
      ...s,
      speakerLabel: undefined,
    }));

  const segmentArb: fc.Arbitrary<DownloadSegment> = fc.oneof(
    segmentWithSpeakerArb,
    segmentWithoutSpeakerArb,
  );

  const segmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 20 });

  it('each entry has a sequential number starting from 1', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const srt = generateTranscriptionSrt(segments);
        const entries = srt.trim().split('\n\n');

        expect(entries).toHaveLength(segments.length);

        entries.forEach((entry, index) => {
          const lines = entry.split('\n');
          const sequenceNumber = parseInt(lines[0], 10);
          expect(sequenceNumber).toBe(index + 1);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('timecodes match format HH:MM:SS,mmm --> HH:MM:SS,mmm', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const srt = generateTranscriptionSrt(segments);
        const entries = srt.trim().split('\n\n');

        const timecodeRegex = /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/;

        entries.forEach((entry) => {
          const lines = entry.split('\n');
          expect(lines[1]).toMatch(timecodeRegex);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('text is present in each entry', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const srt = generateTranscriptionSrt(segments);
        const entries = srt.trim().split('\n\n');

        entries.forEach((entry) => {
          const lines = entry.split('\n');
          expect(lines.length).toBeGreaterThanOrEqual(3);
          expect(lines[2].length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('when speakerLabel exists, text starts with [speakerLabel] ', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const srt = generateTranscriptionSrt(segments);
        const entries = srt.trim().split('\n\n');

        entries.forEach((entry, index) => {
          const lines = entry.split('\n');
          const segment = segments[index];

          if (segment.speakerLabel) {
            expect(lines[2]).toMatch(new RegExp(`^\\[${segment.speakerLabel}\\] `));
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  it('when speakerLabel is absent, text does NOT start with [', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const srt = generateTranscriptionSrt(segments);
        const entries = srt.trim().split('\n\n');

        entries.forEach((entry, index) => {
          const lines = entry.split('\n');
          const segment = segments[index];

          if (!segment.speakerLabel) {
            expect(lines[2]).not.toMatch(/^\[/);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: download-transcription, Property 29: ダウンロードファイル名の形式
 *
 * **Validates: Requirements 19.9**
 *
 * For any session name, date, and extension, the generated filename must match
 * the pattern: {sessionName}_{YYYYMMDD}.{extension}
 */
describe('Feature: download-transcription, Property 29: ダウンロードファイル名の形式', () => {
  const sessionNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
    (s) => !s.includes('_') && !s.includes('.') && !s.includes('\n') && !s.includes('\r'),
  );
  const extensionArb = fc.constantFrom('json', 'srt', 'txt', 'csv');
  const dateArb = fc.date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
  });

  it('filename matches pattern {sessionName}_{YYYYMMDD}.{extension}', () => {
    fc.assert(
      fc.property(sessionNameArb, dateArb, extensionArb, (sessionName, date, extension) => {
        const filename = generateDownloadFilename(sessionName, date, extension);
        const pattern = /^.+_\d{8}\..+$/;
        expect(filename).toMatch(pattern);
      }),
      { numRuns: 100 },
    );
  });

  it('date portion is exactly 8 digits (YYYYMMDD)', () => {
    fc.assert(
      fc.property(sessionNameArb, dateArb, extensionArb, (sessionName, date, extension) => {
        const filename = generateDownloadFilename(sessionName, date, extension);
        const lastUnderscoreIdx = filename.lastIndexOf('_');
        const dotIdx = filename.lastIndexOf('.');
        const datePortion = filename.substring(lastUnderscoreIdx + 1, dotIdx);
        expect(datePortion).toMatch(/^\d{8}$/);
      }),
      { numRuns: 100 },
    );
  });

  it('extension matches the input extension', () => {
    fc.assert(
      fc.property(sessionNameArb, dateArb, extensionArb, (sessionName, date, extension) => {
        const filename = generateDownloadFilename(sessionName, date, extension);
        expect(filename.endsWith(`.${extension}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('session name is preserved in the output', () => {
    fc.assert(
      fc.property(sessionNameArb, dateArb, extensionArb, (sessionName, date, extension) => {
        const filename = generateDownloadFilename(sessionName, date, extension);
        expect(filename.startsWith(`${sessionName}_`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('underscore separates session name from date', () => {
    fc.assert(
      fc.property(sessionNameArb, dateArb, extensionArb, (sessionName, date, extension) => {
        const filename = generateDownloadFilename(sessionName, date, extension);
        const expectedYear = date.getFullYear();
        const expectedMonth = String(date.getMonth() + 1).padStart(2, '0');
        const expectedDay = String(date.getDate()).padStart(2, '0');
        const expectedDateStr = `${expectedYear}${expectedMonth}${expectedDay}`;
        const expectedFilename = `${sessionName}_${expectedDateStr}.${extension}`;
        expect(filename).toBe(expectedFilename);
      }),
      { numRuns: 100 },
    );
  });
});
