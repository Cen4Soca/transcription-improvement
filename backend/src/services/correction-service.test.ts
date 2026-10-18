import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCorrectionInput, createCorrection } from './correction-service.js';
import type { AuthUser } from '../utils/auth-middleware.js';

vi.mock('../repositories/session-repository.js', () => ({
  addParticipant: vi.fn().mockResolvedValue(true),
  getSessionById: vi.fn(),
}));

vi.mock('../repositories/correction-repository.js', () => ({
  saveCorrection: vi.fn(),
  updateSessionStatusToInProgress: vi.fn(),
}));

import {
  saveCorrection,
  updateSessionStatusToInProgress,
} from '../repositories/correction-repository.js';
import { getSessionById } from '../repositories/session-repository.js';
import type { SessionRecord } from '../repositories/session-repository.js';

const mockSaveCorrection = vi.mocked(saveCorrection);
const mockUpdateSessionStatus = vi.mocked(updateSessionStatusToInProgress);
const mockGetSessionById = vi.mocked(getSessionById);

function makeSession(status: SessionRecord['status']): SessionRecord {
  return {
    sessionId: 'session-001',
    name: 'Sample',
    status,
    assignedReviewerCount: 0,
    consensusThreshold: 67,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('correction-service', () => {
  describe('validateCorrectionInput', () => {
    const validInput = {
      correctionId: 'corr-001',
      segmentId: 'seg-001',
      correctionType: 'TEXT',
      beforeText: 'original text',
      afterText: 'corrected text',
    };

    it('should accept valid TEXT correction input', () => {
      const result = validateCorrectionInput(validInput);
      expect(result).toEqual({
        correctionId: 'corr-001',
        segmentId: 'seg-001',
        correctionType: 'TEXT',
        beforeText: 'original text',
        afterText: 'corrected text',
        beforeSpeaker: undefined,
        afterSpeaker: undefined,
        affectedSegmentCount: undefined,
      });
    });

    it('should accept valid SPEAKER correction input with optional fields', () => {
      const input = {
        ...validInput,
        correctionType: 'SPEAKER',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'spk_1',
      };
      const result = validateCorrectionInput(input);
      expect(result.correctionType).toBe('SPEAKER');
      expect(result.beforeSpeaker).toBe('spk_0');
      expect(result.afterSpeaker).toBe('spk_1');
    });

    it('should accept valid SPEAKER_RENAME correction input', () => {
      const input = {
        ...validInput,
        correctionType: 'SPEAKER_RENAME',
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'Tanaka',
        affectedSegmentCount: 5,
      };
      const result = validateCorrectionInput(input);
      expect(result.correctionType).toBe('SPEAKER_RENAME');
      expect(result.affectedSegmentCount).toBe(5);
    });

    it('should throw validation error when body is null', () => {
      expect(() => validateCorrectionInput(null)).toThrow('リクエストボディが不正です。');
    });

    it('should throw validation error when body is not an object', () => {
      expect(() => validateCorrectionInput('string')).toThrow('リクエストボディが不正です。');
    });

    it('should throw validation error when correctionId is missing', () => {
      const { correctionId, ...input } = validInput;
      expect(() => validateCorrectionInput(input)).toThrow('correctionId は必須です。');
    });

    it('should throw validation error when segmentId is missing', () => {
      const { segmentId, ...input } = validInput;
      expect(() => validateCorrectionInput(input)).toThrow('segmentId は必須です。');
    });

    it('should throw validation error when correctionType is invalid', () => {
      const input = { ...validInput, correctionType: 'INVALID' };
      expect(() => validateCorrectionInput(input)).toThrow(
        'correctionType は TEXT, SPEAKER, SPEAKER_RENAME のいずれかである必要があります。'
      );
    });

    it('should throw validation error when beforeText is missing', () => {
      const { beforeText, ...input } = validInput;
      expect(() => validateCorrectionInput(input)).toThrow('beforeText は必須です。');
    });

    it('should throw validation error when afterText is missing', () => {
      const { afterText, ...input } = validInput;
      expect(() => validateCorrectionInput(input)).toThrow('afterText は必須です。');
    });

    it('should accept empty string for beforeText and afterText', () => {
      const input = { ...validInput, beforeText: '', afterText: '' };
      const result = validateCorrectionInput(input);
      expect(result.beforeText).toBe('');
      expect(result.afterText).toBe('');
    });
  });

  describe('createCorrection', () => {
    const mockUser: AuthUser = {
      userId: 'user-001',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'REVIEWER',
    };

    const validInput = {
      correctionId: 'corr-001',
      segmentId: 'seg-001',
      correctionType: 'TEXT' as const,
      beforeText: 'original',
      afterText: 'corrected',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      // Default: an editable (IN_PROGRESS) session exists.
      mockGetSessionById.mockResolvedValue(makeSession('IN_PROGRESS'));
    });

    it('should reject a correction on a COMPLETED session with 400 and not save', async () => {
      mockGetSessionById.mockResolvedValue(makeSession('COMPLETED'));

      await expect(
        createCorrection('session-001', mockUser, validInput)
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

      expect(mockSaveCorrection).not.toHaveBeenCalled();
    });

    it('should save correction and update session status on success', async () => {
      mockSaveCorrection.mockResolvedValue({ saved: true, duplicate: false });
      mockUpdateSessionStatus.mockResolvedValue(undefined);

      const result = await createCorrection('session-001', mockUser, validInput);

      expect(result.isDuplicate).toBe(false);
      expect(result.correction.correctionId).toBe('corr-001');
      expect(result.correction.sessionId).toBe('session-001');
      expect(result.correction.userId).toBe('user-001');
      expect(result.correction.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
      expect(mockSaveCorrection).toHaveBeenCalledOnce();
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('session-001');
    });

    it('should return isDuplicate true when correction already exists', async () => {
      mockSaveCorrection.mockResolvedValue({ saved: false, duplicate: true });

      const result = await createCorrection('session-001', mockUser, validInput);

      expect(result.isDuplicate).toBe(true);
      expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
    });

    it('should throw internal error on DynamoDB failure', async () => {
      mockSaveCorrection.mockRejectedValue(new Error('DynamoDB timeout'));

      await expect(
        createCorrection('session-001', mockUser, validInput)
      ).rejects.toThrow('修正内容の保存に失敗しました。');
    });

    it('should include optional fields in the correction record', async () => {
      mockSaveCorrection.mockResolvedValue({ saved: true, duplicate: false });
      mockUpdateSessionStatus.mockResolvedValue(undefined);

      const inputWithOptional = {
        ...validInput,
        correctionType: 'SPEAKER_RENAME' as const,
        beforeSpeaker: 'spk_0',
        afterSpeaker: 'Tanaka',
        affectedSegmentCount: 3,
      };

      const result = await createCorrection('session-001', mockUser, inputWithOptional);

      expect(result.correction.beforeSpeaker).toBe('spk_0');
      expect(result.correction.afterSpeaker).toBe('Tanaka');
      expect(result.correction.affectedSegmentCount).toBe(3);
    });
  });
});
