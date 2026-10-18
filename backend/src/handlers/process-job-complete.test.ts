import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranscribeJobEvent, TranscribeOutput } from './process-job-complete.js';

// Mock dependencies
vi.mock('../repositories/transcription-job-repository.js', () => ({
  getByTranscribeJobName: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../repositories/media-file-repository.js', () => ({
  updateStatus: vi.fn(),
}));

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'TestTable',
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn().mockImplementation((params) => params),
}));

import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import { docClient } from '../utils/dynamodb-client.js';
import {
  handler,
  setS3Client,
  parseTranscribeOutput,
  formatStartTimeForSK,
  isSpaceDelimitedLanguage,
} from './process-job-complete.js';

const mockedGetByTranscribeJobName = vi.mocked(transcriptionJobRepository.getByTranscribeJobName);
const mockedUpdateStatus = vi.mocked(transcriptionJobRepository.updateStatus);
const mockedMediaUpdateStatus = vi.mocked(mediaFileRepository.updateStatus);
const mockedDocClientSend = vi.mocked(docClient.send);

function createEvent(overrides: Partial<TranscribeJobEvent['detail']> = {}): TranscribeJobEvent {
  return {
    source: 'aws.transcribe',
    'detail-type': 'Transcribe Job State Change',
    detail: {
      TranscriptionJobName: 'tr-test-job-001',
      TranscriptionJobStatus: 'COMPLETED',
      ...overrides,
    },
  };
}

function createTranscribeOutput(): TranscribeOutput {
  return {
    results: {
      transcripts: [{ transcript: 'Hello world. How are you?' }],
      speaker_labels: {
        speakers: 2,
        segments: [
          {
            start_time: '0.0',
            end_time: '2.5',
            speaker_label: 'spk_0',
            items: [
              { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' },
              { start_time: '0.6', end_time: '1.2', speaker_label: 'spk_0' },
            ],
          },
          {
            start_time: '3.0',
            end_time: '5.0',
            speaker_label: 'spk_1',
            items: [
              { start_time: '3.0', end_time: '3.5', speaker_label: 'spk_1' },
              { start_time: '3.6', end_time: '4.0', speaker_label: 'spk_1' },
              { start_time: '4.1', end_time: '4.8', speaker_label: 'spk_1' },
            ],
          },
        ],
      },
      items: [
        { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'Hello' }] },
        { start_time: '0.6', end_time: '1.2', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'world' }] },
        { type: 'punctuation', alternatives: [{ confidence: '0.0', content: '.' }] },
        { start_time: '3.0', end_time: '3.5', type: 'pronunciation', alternatives: [{ confidence: '0.98', content: 'How' }] },
        { start_time: '3.6', end_time: '4.0', type: 'pronunciation', alternatives: [{ confidence: '0.97', content: 'are' }] },
        { start_time: '4.1', end_time: '4.8', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'you' }] },
        { type: 'punctuation', alternatives: [{ confidence: '0.0', content: '?' }] },
      ],
    },
  };
}

const mockJob = {
  jobId: 'job-001',
  transcribeJobName: 'tr-test-job-001',
  mediaFileId: 'media-001',
  status: 'IN_PROGRESS' as const,
  languageCode: 'en-US',
  maxSpeakerLabels: 2,
  outputS3Key: 'transcriptions/job-001/output.json',
  startedBy: 'user-001',
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
};

describe('process-job-complete handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BUCKET_NAME = 'test-data-bucket';

    // Mock S3 client
    const mockS3Send = vi.fn().mockResolvedValue({
      Body: {
        transformToString: () => Promise.resolve(JSON.stringify(createTranscribeOutput())),
      },
    });
    setS3Client({ send: mockS3Send } as any);

    // Default: job found and in progress
    mockedGetByTranscribeJobName.mockResolvedValue(mockJob);
    mockedUpdateStatus.mockResolvedValue(undefined);
    mockedMediaUpdateStatus.mockResolvedValue(undefined);
    mockedDocClientSend.mockResolvedValue({} as any);
  });

  it('returns early when job is not found', async () => {
    mockedGetByTranscribeJobName.mockResolvedValue(null);

    await handler(createEvent());

    expect(mockedUpdateStatus).not.toHaveBeenCalled();
    expect(mockedDocClientSend).not.toHaveBeenCalled();
  });

  it('returns early when job status is not IN_PROGRESS (idempotency)', async () => {
    mockedGetByTranscribeJobName.mockResolvedValue({
      ...mockJob,
      status: 'COMPLETED',
    });

    await handler(createEvent());

    expect(mockedUpdateStatus).not.toHaveBeenCalled();
    expect(mockedDocClientSend).not.toHaveBeenCalled();
  });

  it('updates status to FAILED when event status is FAILED', async () => {
    const event = createEvent({
      TranscriptionJobStatus: 'FAILED',
      FailureReason: 'Audio quality too low',
    });

    await handler(event);

    expect(mockedUpdateStatus).toHaveBeenCalledWith('job-001', 'FAILED', 'Audio quality too low');
    expect(mockedDocClientSend).not.toHaveBeenCalled();
    // The media file is marked FAILED so the media list shows "失敗"
    // instead of remaining stuck at "処理中".
    expect(mockedMediaUpdateStatus).toHaveBeenCalledWith('media-001', 'FAILED');
  });

  it('processes COMPLETED event: fetches S3, saves segments, creates session, updates job', async () => {
    await handler(createEvent());

    // Should have called docClient.send multiple times:
    // 2 segments + 1 ReviewSession + 1 UpdateCommand for job status
    expect(mockedDocClientSend).toHaveBeenCalledTimes(4);

    // Verify segment SK format includes startTime padding
    const firstSegmentCall = mockedDocClientSend.mock.calls[0][0];
    const firstItem = (firstSegmentCall as any).input?.Item;
    expect(firstItem.PK).toMatch(/^SESSION#/);
    expect(firstItem.SK).toMatch(/^SEGMENT#00000\.000#/);
    expect(firstItem.entityType).toBe('Segment');
    expect(firstItem.consensusStatus).toBe('UNDECIDED');
    expect(firstItem.startTime).toBe(0.0);
    expect(firstItem.endTime).toBe(2.5);
    expect(firstItem.originalText).toBe('Hello world.');
    expect(firstItem.speakerLabel).toBe('spk_0');

    // Verify ReviewSession includes name and transcriptionJobId
    const sessionCall = mockedDocClientSend.mock.calls[2][0];
    const sessionItem = (sessionCall as any).input?.Item;
    expect(sessionItem.PK).toMatch(/^SESSION#/);
    expect(sessionItem.SK).toBe('METADATA');
    expect(sessionItem.entityType).toBe('ReviewSession');
    expect(sessionItem.status).toBe('PENDING');
    expect(sessionItem.name).toBe('tr-test-job-001');
    expect(sessionItem.transcriptionJobId).toBe('job-001');
    expect(sessionItem.assignedReviewerCount).toBe(0);
    expect(sessionItem.consensusThreshold).toBe(67);

    // The media file is advanced to COMPLETED so the media list reflects
    // that transcription finished (previously it stayed at UPLOADED).
    expect(mockedMediaUpdateStatus).toHaveBeenCalledWith('media-001', 'COMPLETED');
  });

  it('reuses the session created at job start and does NOT create a duplicate', async () => {
    // Normal flow: startJob() already created a session and linked the media
    // file to it (job.sessionId is set). The completion handler must reuse that
    // sessionId for the segments and must NOT create a second ReviewSession.
    mockedGetByTranscribeJobName.mockResolvedValue({
      ...mockJob,
      sessionId: 'existing-session-123',
    });

    await handler(createEvent());

    // 2 segments + 1 UpdateCommand (job status). NO ReviewSession PutCommand.
    expect(mockedDocClientSend).toHaveBeenCalledTimes(3);

    // All segment writes go under the pre-existing session PK.
    const firstSegmentItem = (mockedDocClientSend.mock.calls[0][0] as any).input?.Item;
    expect(firstSegmentItem.PK).toBe('SESSION#existing-session-123');
    expect(firstSegmentItem.sessionId).toBe('existing-session-123');

    // No PutCommand ever creates a ReviewSession METADATA record.
    const createdSession = mockedDocClientSend.mock.calls.find((call) => {
      const item = (call[0] as any).input?.Item;
      return item?.SK === 'METADATA' && item?.entityType === 'ReviewSession';
    });
    expect(createdSession).toBeUndefined();

    // Job is completed and points at the reused session.
    const updateCall = mockedDocClientSend.mock.calls[2][0] as any;
    expect(updateCall.input?.ExpressionAttributeValues[':sessionId']).toBe('existing-session-123');
    expect(updateCall.input?.ExpressionAttributeValues[':status']).toBe('COMPLETED');
  });

  it('throws when DATA_BUCKET_NAME is not set', async () => {
    delete process.env.DATA_BUCKET_NAME;

    await expect(handler(createEvent())).rejects.toThrow('DATA_BUCKET_NAME environment variable is not set');
  });

  it('throws when job has no outputS3Key', async () => {
    mockedGetByTranscribeJobName.mockResolvedValue({
      ...mockJob,
      outputS3Key: undefined,
    });

    await expect(handler(createEvent())).rejects.toThrow('has no outputS3Key');
  });

  it('handles ConditionalCheckFailedException for segments gracefully', async () => {
    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';

    // First two calls (segments) throw conditional error, rest succeed
    mockedDocClientSend
      .mockRejectedValueOnce(conditionalError)
      .mockRejectedValueOnce(conditionalError)
      .mockResolvedValueOnce({} as any) // ReviewSession
      .mockResolvedValueOnce({} as any); // UpdateCommand

    await handler(createEvent());

    // Should still complete without throwing
    expect(mockedDocClientSend).toHaveBeenCalledTimes(4);
  });
});

describe('parseTranscribeOutput', () => {
  it('parses segments with correct speaker labels and text', () => {
    const output = createTranscribeOutput();
    const segments = parseTranscribeOutput(output);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      startTime: 0.0,
      endTime: 2.5,
      originalText: 'Hello world.',
      speakerLabel: 'spk_0',
    });
    expect(segments[1]).toEqual({
      startTime: 3.0,
      endTime: 5.0,
      originalText: 'How are you?',
      speakerLabel: 'spk_1',
    });
  });

  it('handles punctuation without space before it', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: 'Yes.' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '0.0',
              end_time: '1.0',
              speaker_label: 'spk_0',
              items: [{ start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' }],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'Yes' }] },
          { type: 'punctuation', alternatives: [{ confidence: '0.0', content: '.' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output);

    expect(segments).toHaveLength(1);
    expect(segments[0].originalText).toBe('Yes.');
  });

  it('returns empty array when no items match any segment', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: '' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '10.0',
              end_time: '12.0',
              speaker_label: 'spk_0',
              items: [],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'Hello' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output);

    // The segment at 10-12 has no matching items (items are at 0.0-0.5), so empty text → skipped
    expect(segments).toHaveLength(0);
  });

  it('handles multiple words with spaces between pronunciations', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: 'one two three' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '0.0',
              end_time: '3.0',
              speaker_label: 'spk_0',
              items: [
                { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' },
                { start_time: '1.0', end_time: '1.5', speaker_label: 'spk_0' },
                { start_time: '2.0', end_time: '2.5', speaker_label: 'spk_0' },
              ],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'one' }] },
          { start_time: '1.0', end_time: '1.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'two' }] },
          { start_time: '2.0', end_time: '2.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'three' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output);

    expect(segments).toHaveLength(1);
    expect(segments[0].originalText).toBe('one two three');
  });

  it('joins Japanese pronunciations WITHOUT spaces when languageCode is ja-JP', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: '今日 は 良い 天気 です' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '0.0',
              end_time: '5.0',
              speaker_label: 'spk_0',
              items: [
                { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' },
                { start_time: '1.0', end_time: '1.5', speaker_label: 'spk_0' },
                { start_time: '2.0', end_time: '2.5', speaker_label: 'spk_0' },
                { start_time: '3.0', end_time: '3.5', speaker_label: 'spk_0' },
                { start_time: '4.0', end_time: '4.5', speaker_label: 'spk_0' },
              ],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: '今日' }] },
          { start_time: '1.0', end_time: '1.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'は' }] },
          { start_time: '2.0', end_time: '2.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: '良い' }] },
          { start_time: '3.0', end_time: '3.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: '天気' }] },
          { start_time: '4.0', end_time: '4.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'です' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output, 'ja-JP');

    expect(segments).toHaveLength(1);
    expect(segments[0].originalText).toBe('今日は良い天気です');
  });

  it('keeps no space before Japanese punctuation and after it', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: 'はい、そうです。' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '0.0',
              end_time: '3.0',
              speaker_label: 'spk_0',
              items: [
                { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' },
                { start_time: '1.0', end_time: '1.5', speaker_label: 'spk_0' },
              ],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'はい' }] },
          { type: 'punctuation', alternatives: [{ confidence: '0.0', content: '、' }] },
          { start_time: '1.0', end_time: '1.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'そうです' }] },
          { type: 'punctuation', alternatives: [{ confidence: '0.0', content: '。' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output, 'ja-JP');

    expect(segments).toHaveLength(1);
    expect(segments[0].originalText).toBe('はい、そうです。');
  });

  it('keeps spaces between embedded ASCII words within Japanese text', () => {
    const output: TranscribeOutput = {
      results: {
        transcripts: [{ transcript: 'AWS SDK を 使う' }],
        speaker_labels: {
          speakers: 1,
          segments: [
            {
              start_time: '0.0',
              end_time: '4.0',
              speaker_label: 'spk_0',
              items: [
                { start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0' },
                { start_time: '1.0', end_time: '1.5', speaker_label: 'spk_0' },
                { start_time: '2.0', end_time: '2.5', speaker_label: 'spk_0' },
                { start_time: '3.0', end_time: '3.5', speaker_label: 'spk_0' },
              ],
            },
          ],
        },
        items: [
          { start_time: '0.0', end_time: '0.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'AWS' }] },
          { start_time: '1.0', end_time: '1.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'SDK' }] },
          { start_time: '2.0', end_time: '2.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: 'を' }] },
          { start_time: '3.0', end_time: '3.5', type: 'pronunciation', alternatives: [{ confidence: '0.99', content: '使う' }] },
        ],
      },
    };

    const segments = parseTranscribeOutput(output, 'ja-JP');

    expect(segments).toHaveLength(1);
    // "AWS SDK" keeps its space (both sides ASCII); "SDK を 使う" is joined tightly.
    expect(segments[0].originalText).toBe('AWS SDKを使う');
  });

  it('still joins English with spaces when languageCode is en-US', () => {
    const output = createTranscribeOutput();
    const segments = parseTranscribeOutput(output, 'en-US');

    expect(segments[0].originalText).toBe('Hello world.');
    expect(segments[1].originalText).toBe('How are you?');
  });
});

describe('isSpaceDelimitedLanguage', () => {
  it('treats undefined/unknown language as space-delimited', () => {
    expect(isSpaceDelimitedLanguage(undefined)).toBe(true);
    expect(isSpaceDelimitedLanguage('en-US')).toBe(true);
    expect(isSpaceDelimitedLanguage('fr-FR')).toBe(true);
  });

  it('treats Japanese and other CJK languages as non space-delimited', () => {
    expect(isSpaceDelimitedLanguage('ja-JP')).toBe(false);
    expect(isSpaceDelimitedLanguage('ja')).toBe(false);
    expect(isSpaceDelimitedLanguage('zh-CN')).toBe(false);
    expect(isSpaceDelimitedLanguage('th-TH')).toBe(false);
  });
});

describe('formatStartTimeForSK', () => {
  it('pads integer part to 5 digits and fractional part to 3 digits', () => {
    expect(formatStartTimeForSK(0.0)).toBe('00000.000');
    expect(formatStartTimeForSK(1.5)).toBe('00001.500');
    expect(formatStartTimeForSK(123.456)).toBe('00123.456');
    expect(formatStartTimeForSK(99999.999)).toBe('99999.999');
  });

  it('ensures lexicographic ordering matches numeric ordering', () => {
    const times = [0.0, 0.5, 1.0, 2.5, 10.0, 100.123, 999.999];
    const formatted = times.map(formatStartTimeForSK);
    const sorted = [...formatted].sort();
    expect(formatted).toEqual(sorted);
  });
});
