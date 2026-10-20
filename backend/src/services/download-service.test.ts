import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  filterConfirmedSegments,
  generateTranscriptionJson,
  generateTranscriptionSrt,
  generateDownloadFilename,
  formatSrtTimecode,
  generateJson,
  generateSrt,
  applySpeakerCorrections,
  type DownloadSegment,
} from './download-service.js';

// Mock DynamoDB client
vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'TestTable',
}));

// Mock session repository
vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
}));

import { docClient } from '../utils/dynamodb-client.js';
import * as sessionRepository from '../repositories/session-repository.js';

const mockedDocClientSend = vi.mocked(docClient.send);
const mockedGetSessionById = vi.mocked(sessionRepository.getSessionById);

describe('filterConfirmedSegments', () => {
  test('returns only CONFIRMED segments', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0, endTime: 3.5, text: 'hello', consensusStatus: 'CONFIRMED' },
      { segmentId: '2', startTime: 4, endTime: 7, text: 'world', consensusStatus: 'UNDECIDED' },
      { segmentId: '3', startTime: 8, endTime: 10, text: 'foo', consensusStatus: 'CONFLICT' },
      { segmentId: '4', startTime: 11, endTime: 14, text: 'bar', consensusStatus: 'CONFIRMED', speakerLabel: 'spk_0' },
    ];

    const result = filterConfirmedSegments(segments);

    expect(result).toHaveLength(2);
    expect(result[0].segmentId).toBe('1');
    expect(result[1].segmentId).toBe('4');
  });

  test('returns empty array when no segments are confirmed', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0, endTime: 3, text: 'hello', consensusStatus: 'UNDECIDED' },
      { segmentId: '2', startTime: 4, endTime: 7, text: 'world', consensusStatus: 'CONFLICT' },
    ];

    const result = filterConfirmedSegments(segments);
    expect(result).toHaveLength(0);
  });

  test('returns empty array for empty input', () => {
    const result = filterConfirmedSegments([]);
    expect(result).toHaveLength(0);
  });
});

describe('generateTranscriptionJson', () => {
  test('generates valid JSON structure with all fields', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0.0, endTime: 3.5, text: '本日はお集まりいただきありがとうございます。', speakerLabel: 'spk_0', consensusStatus: 'CONFIRMED' },
      { segmentId: '2', startTime: 4.0, endTime: 7.2, text: 'こちらこそよろしくお願いします。', speakerLabel: 'spk_1', consensusStatus: 'CONFIRMED' },
    ];

    const result = generateTranscriptionJson('会議録_20240101', segments, '2024-01-15T10:30:00.000Z');

    expect(result.sessionName).toBe('会議録_20240101');
    expect(result.exportedAt).toBe('2024-01-15T10:30:00.000Z');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual({
      startTime: 0.0,
      endTime: 3.5,
      text: '本日はお集まりいただきありがとうございます。',
      speakerLabel: 'spk_0',
    });
    expect(result.segments[1]).toEqual({
      startTime: 4.0,
      endTime: 7.2,
      text: 'こちらこそよろしくお願いします。',
      speakerLabel: 'spk_1',
    });
  });

  test('omits speakerLabel when not present', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0, endTime: 3, text: 'hello', consensusStatus: 'CONFIRMED' },
    ];

    const result = generateTranscriptionJson('test', segments, '2024-01-01T00:00:00.000Z');

    expect(result.segments[0]).toEqual({
      startTime: 0,
      endTime: 3,
      text: 'hello',
    });
    expect('speakerLabel' in result.segments[0]).toBe(false);
  });
});

describe('generateTranscriptionSrt', () => {
  test('generates valid SRT format with speaker labels', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0.0, endTime: 3.5, text: '本日はお集まりいただきありがとうございます。', speakerLabel: 'spk_0', consensusStatus: 'CONFIRMED' },
      { segmentId: '2', startTime: 4.0, endTime: 7.2, text: 'こちらこそよろしくお願いします。', speakerLabel: 'spk_1', consensusStatus: 'CONFIRMED' },
    ];

    const result = generateTranscriptionSrt(segments);

    const expected = [
      '1',
      '00:00:00,000 --> 00:00:03,500',
      '[spk_0] 本日はお集まりいただきありがとうございます。',
      '',
      '2',
      '00:00:04,000 --> 00:00:07,200',
      '[spk_1] こちらこそよろしくお願いします。',
    ].join('\n');

    expect(result).toBe(expected);
  });

  test('generates SRT without speaker label prefix when speakerLabel is absent', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0, endTime: 5, text: 'テキストのみ', consensusStatus: 'CONFIRMED' },
    ];

    const result = generateTranscriptionSrt(segments);

    expect(result).toBe('1\n00:00:00,000 --> 00:00:05,000\nテキストのみ');
  });

  test('handles mixed segments with and without speaker labels', () => {
    const segments: DownloadSegment[] = [
      { segmentId: '1', startTime: 0, endTime: 3, text: 'with label', speakerLabel: 'spk_0', consensusStatus: 'CONFIRMED' },
      { segmentId: '2', startTime: 4, endTime: 7, text: 'without label', consensusStatus: 'CONFIRMED' },
    ];

    const result = generateTranscriptionSrt(segments);
    const entries = result.split('\n\n');

    expect(entries[0]).toContain('[spk_0] with label');
    expect(entries[1]).toContain('without label');
    expect(entries[1]).not.toContain('[');
  });
});

describe('formatSrtTimecode', () => {
  test('formats 0 seconds correctly', () => {
    expect(formatSrtTimecode(0)).toBe('00:00:00,000');
  });

  test('formats seconds with milliseconds', () => {
    expect(formatSrtTimecode(3.5)).toBe('00:00:03,500');
  });

  test('formats minutes correctly', () => {
    expect(formatSrtTimecode(65.123)).toBe('00:01:05,123');
  });

  test('formats hours correctly', () => {
    expect(formatSrtTimecode(3661.5)).toBe('01:01:01,500');
  });

  test('formats large values correctly', () => {
    expect(formatSrtTimecode(7200)).toBe('02:00:00,000');
  });
});

describe('generateDownloadFilename', () => {
  test('generates filename with correct format', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    const result = generateDownloadFilename('会議録_20240101', date, 'json');

    expect(result).toBe('会議録_20240101_20240115.json');
  });

  test('generates SRT filename', () => {
    const date = new Date('2024-03-05T00:00:00.000Z');
    const result = generateDownloadFilename('テスト会議', date, 'srt');

    expect(result).toBe('テスト会議_20240305.srt');
  });

  test('pads month and day with zeros', () => {
    const date = new Date('2024-01-05T00:00:00.000Z');
    const result = generateDownloadFilename('session', date, 'json');

    expect(result).toBe('session_20240105.json');
  });
});


describe('generateJson (service function)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns valid JSON with session name and segments', async () => {
    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockedDocClientSend.mockResolvedValue({
      Items: [
        {
          segmentId: 'seg-001',
          startTime: 0.0,
          endTime: 3.5,
          originalText: '本日はお集まりいただきありがとうございます。',
          consensusText: '本日はお集まりいただきありがとうございます。',
          speakerLabel: 'spk_0',
          consensusStatus: 'CONFIRMED',
        },
        {
          segmentId: 'seg-002',
          startTime: 4.0,
          endTime: 7.2,
          originalText: 'こちらこそよろしくお願いします。',
          consensusText: 'こちらこそよろしくお願いします。',
          speakerLabel: 'spk_1',
          consensusStatus: 'CONFIRMED',
        },
      ],
    } as never);

    const result = await generateJson('session-001');

    expect(result.sessionName).toBe('会議録_20240101');
    expect(result.exportedAt).toBeDefined();
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      startTime: 0.0,
      endTime: 3.5,
      text: '本日はお集まりいただきありがとうございます。',
      speakerLabel: 'spk_0',
    });
    expect(result.segments[1]).toMatchObject({
      startTime: 4.0,
      endTime: 7.2,
      text: 'こちらこそよろしくお願いします。',
      speakerLabel: 'spk_1',
    });
  });

  test('includes non-confirmed segments using original text (no throw)', async () => {
    // Regression (download-missing-unedited-segments-fix): unedited (UNDECIDED)
    // and conflicting (CONFLICT) segments must be included with their original
    // text, and a session with no CONFIRMED segments must not throw.
    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockedDocClientSend.mockResolvedValue({
      Items: [
        {
          segmentId: 'seg-001',
          startTime: 0.0,
          endTime: 3.5,
          originalText: 'テスト',
          speakerLabel: 'spk_0',
          consensusStatus: 'UNDECIDED',
        },
        {
          segmentId: 'seg-002',
          startTime: 4.0,
          endTime: 7.0,
          originalText: 'テスト2',
          speakerLabel: 'spk_1',
          consensusStatus: 'CONFLICT',
        },
      ],
    } as never);

    const result = await generateJson('session-001');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe('テスト');
    expect(result.segments[1].text).toBe('テスト2');
  });

  test('mixes confirmed (consensusText) and non-confirmed (originalText) segments', async () => {
    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockedDocClientSend.mockResolvedValue({
      Items: [
        { segmentId: 'seg-001', startTime: 0, endTime: 3, originalText: '元1', consensusStatus: 'UNDECIDED' },
        { segmentId: 'seg-002', startTime: 3, endTime: 6, originalText: '元2', consensusText: '確定2', consensusStatus: 'CONFIRMED' },
        { segmentId: 'seg-003', startTime: 6, endTime: 9, originalText: '元3', consensusStatus: 'CONFLICT' },
      ],
    } as never);

    const result = await generateJson('session-001');
    expect(result.segments.map((x) => x.text)).toEqual(['元1', '確定2', '元3']);
  });

  test('throws NOT_FOUND when session does not exist', async () => {
    mockedGetSessionById.mockResolvedValue(null);

    await expect(generateJson('nonexistent-session')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('generateSrt (service function)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns valid SRT format', async () => {
    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockedDocClientSend.mockResolvedValue({
      Items: [
        {
          segmentId: 'seg-001',
          startTime: 0.0,
          endTime: 3.5,
          originalText: '本日はお集まりいただきありがとうございます。',
          consensusText: '本日はお集まりいただきありがとうございます。',
          speakerLabel: 'spk_0',
          consensusStatus: 'CONFIRMED',
        },
        {
          segmentId: 'seg-002',
          startTime: 4.0,
          endTime: 7.2,
          originalText: 'こちらこそよろしくお願いします。',
          consensusText: 'こちらこそよろしくお願いします。',
          speakerLabel: 'spk_1',
          consensusStatus: 'CONFIRMED',
        },
      ],
    } as never);

    const result = await generateSrt('session-001');

    expect(result).toContain('1\n00:00:00,000 --> 00:00:03,500\n[spk_0] 本日はお集まりいただきありがとうございます。');
    expect(result).toContain('2\n00:00:04,000 --> 00:00:07,200\n[spk_1] こちらこそよろしくお願いします。');
  });

  test('includes non-confirmed segments using original text (no throw)', async () => {
    mockedGetSessionById.mockResolvedValue({
      sessionId: 'session-001',
      name: '会議録_20240101',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockedDocClientSend.mockResolvedValue({
      Items: [
        {
          segmentId: 'seg-001',
          startTime: 0.0,
          endTime: 3.5,
          originalText: 'テスト',
          consensusStatus: 'UNDECIDED',
        },
      ],
    } as never);

    const result = await generateSrt('session-001');
    expect(result).toContain('1\n00:00:00,000 --> 00:00:03,500\nテスト');
  });

  test('throws NOT_FOUND when session does not exist', async () => {
    mockedGetSessionById.mockResolvedValue(null);

    await expect(generateSrt('nonexistent-session')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('applySpeakerCorrections', () => {
  const baseSegments: DownloadSegment[] = [
    { segmentId: 's1', startTime: 0, endTime: 3, text: 'a', consensusStatus: 'CONFIRMED', speakerLabel: 'spk_0' },
    { segmentId: 's2', startTime: 3, endTime: 6, text: 'b', consensusStatus: 'CONFIRMED', speakerLabel: 'spk_1' },
    { segmentId: 's3', startTime: 6, endTime: 9, text: 'c', consensusStatus: 'CONFIRMED', speakerLabel: 'spk_0' },
  ];

  test('returns the same array reference-wise unchanged when no corrections', () => {
    const result = applySpeakerCorrections(baseSegments, []);
    expect(result).toBe(baseSegments);
  });

  test('bulk rename (SPEAKER_RENAME) updates all segments with the old label', () => {
    const result = applySpeakerCorrections(baseSegments, [
      { correctionType: 'SPEAKER_RENAME', beforeSpeaker: 'spk_0', afterSpeaker: '田中' },
    ]);
    expect(result[0].speakerLabel).toBe('田中');
    expect(result[1].speakerLabel).toBe('spk_1');
    expect(result[2].speakerLabel).toBe('田中');
  });

  test('per-segment change (SPEAKER) updates only the target segment', () => {
    const result = applySpeakerCorrections(baseSegments, [
      { correctionType: 'SPEAKER', segmentId: 's2', afterSpeaker: '佐藤' },
    ]);
    expect(result[0].speakerLabel).toBe('spk_0');
    expect(result[1].speakerLabel).toBe('佐藤');
    expect(result[2].speakerLabel).toBe('spk_0');
  });

  test('per-segment change takes precedence over bulk rename', () => {
    const result = applySpeakerCorrections(baseSegments, [
      { correctionType: 'SPEAKER_RENAME', beforeSpeaker: 'spk_0', afterSpeaker: '田中' },
      { correctionType: 'SPEAKER', segmentId: 's1', afterSpeaker: '個別' },
    ]);
    expect(result[0].speakerLabel).toBe('個別');
    expect(result[2].speakerLabel).toBe('田中');
  });

  test('follows rename chains (A -> B -> C)', () => {
    const result = applySpeakerCorrections(baseSegments, [
      { correctionType: 'SPEAKER_RENAME', beforeSpeaker: 'spk_0', afterSpeaker: 'B' },
      { correctionType: 'SPEAKER_RENAME', beforeSpeaker: 'B', afterSpeaker: 'C' },
    ]);
    expect(result[0].speakerLabel).toBe('C');
    expect(result[2].speakerLabel).toBe('C');
  });

  test('does not mutate the input segments', () => {
    const copy = JSON.parse(JSON.stringify(baseSegments));
    applySpeakerCorrections(baseSegments, [
      { correctionType: 'SPEAKER_RENAME', beforeSpeaker: 'spk_0', afterSpeaker: 'X' },
    ]);
    expect(baseSegments).toEqual(copy);
  });
});
