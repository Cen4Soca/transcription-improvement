import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockSend = vi.fn();

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  TABLE_NAME: 'TestTable',
}));

vi.mock('../repositories/session-repository.js', () => ({
  getSessionById: vi.fn(),
}));

vi.mock('../repositories/media-file-repository.js', () => ({
  getById: vi.fn(),
  deleteById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/transcription-job-repository.js', () => ({
  listByMediaFileId: vi.fn().mockResolvedValue([]),
  deleteById: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./access-control-service.js', () => ({
  canAccessMediaFile: vi.fn().mockResolvedValue(true),
}));

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { deleteTranscription, deleteMediaFile, setS3Client, checkTeamDeleteAccess, checkRoleAccess } from './deletion-service.js';
import * as sessionRepository from '../repositories/session-repository.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import * as transcriptionJobRepository from '../repositories/transcription-job-repository.js';
import { canAccessMediaFile } from './access-control-service.js';

// --- Property 11 (Role-based access control) ---

describe('Feature: deletion, Property 11: ロールベースアクセス制御（Admin/TeamLeader 限定機能）', () => {
  /**
   * **Validates: Requirements 21.1, 21.2**
   */

  it('ADMIN role always returns true', () => {
    fc.assert(
      fc.property(fc.constant('ADMIN'), (role) => {
        expect(checkRoleAccess(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('TEAM_LEADER role always returns true', () => {
    fc.assert(
      fc.property(fc.constant('TEAM_LEADER'), (role) => {
        expect(checkRoleAccess(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('REVIEWER role always returns false', () => {
    fc.assert(
      fc.property(fc.constant('REVIEWER'), (role) => {
        expect(checkRoleAccess(role)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('any random string that is not ADMIN or TEAM_LEADER returns false', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (s) => s !== 'ADMIN' && s !== 'TEAM_LEADER',
        ),
        (role) => {
          expect(checkRoleAccess(role)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 33 ---

describe('Feature: deletion, Property 33: カスケード削除の完全性', () => {
  /**
   * **Validates: Requirements 21.6**
   *
   * For any ReviewSession with related records (SESSION#, SEGMENT#, CORRECTION#, CONSENSUS#),
   * after deleteTranscription executes, all related records are included in BatchWriteCommand
   * delete requests. No records with these prefixes should remain undeleted.
   */

  const sessionId = 'test-session-id';
  const jobId = 'test-job-id';

  // Generate a random set of related DynamoDB items for the session
  const relatedItemsArb = fc.array(
    fc.oneof(
      fc.constant('METADATA'),
      fc.uuid().map((id) => `SEGMENT#${id}`),
      fc.uuid().map((id) => `CORRECTION#${id}`),
      fc.uuid().map((id) => `CONSENSUS#${id}`),
    ),
    { minLength: 1, maxLength: 50 },
  ).map((sks) => {
    // Deduplicate and ensure METADATA is present
    const seen = new Set<string>();
    const unique = sks.filter((sk) => {
      if (seen.has(sk)) return false;
      seen.add(sk);
      return true;
    });
    if (!unique.includes('METADATA')) {
      unique.unshift('METADATA');
    }
    return unique.map((sk) => ({ PK: `SESSION#${sessionId}`, SK: sk }));
  });

  function setupMocks(relatedItems: Array<{ PK: string; SK: string }>) {
    const deletedKeys: Array<{ PK: string; SK: string }> = [];

    vi.clearAllMocks();
    const mockS3Send = vi.fn().mockResolvedValue({});
    setS3Client({ send: mockS3Send } as any);

    vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
      sessionId,
      name: 'Test Session',
      status: 'COMPLETED',
      assignedReviewerCount: 3,
      consensusThreshold: 67,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
      const input = command.input;

      if (input['Key'] !== undefined) {
        const key = input['Key'] as { PK: string; SK: string };
        if (key.PK === `SESSION#${sessionId}` && key.SK === 'METADATA') {
          const projection = input['ProjectionExpression'] as string | undefined;
          if (projection?.includes('GSI1PK')) {
            return Promise.resolve({ Item: { GSI1PK: 'TEAM#team-1' } });
          }
          if (projection?.includes('transcriptionJobId')) {
            return Promise.resolve({ Item: { transcriptionJobId: jobId } });
          }
          return Promise.resolve({ Item: { GSI1PK: 'TEAM#team-1', transcriptionJobId: jobId } });
        }
        return Promise.resolve({ Item: undefined });
      }

      if (input['KeyConditionExpression'] !== undefined) {
        return Promise.resolve({ Items: relatedItems });
      }

      if (input['RequestItems'] !== undefined) {
        const requestItems = input['RequestItems'] as Record<string, Array<{ DeleteRequest?: { Key: { PK: string; SK: string } } }>>;
        const tableRequests = requestItems['TestTable'] ?? [];
        for (const req of tableRequests) {
          if (req.DeleteRequest) {
            deletedKeys.push(req.DeleteRequest.Key);
          }
        }
        return Promise.resolve({});
      }

      return Promise.resolve({});
    });

    return deletedKeys;
  }

  it('all related records are included in BatchWriteCommand delete requests', async () => {
    await fc.assert(
      fc.asyncProperty(relatedItemsArb, async (relatedItems) => {
        const deletedKeys = setupMocks(relatedItems);

        await deleteTranscription({
          sessionId,
          userId: 'admin-user',
          userRole: 'ADMIN',
          userTeamId: 'team-1',
        });

        // Verify: all related items must be included in delete requests
        for (const item of relatedItems) {
          const found = deletedKeys.some(
            (key) => key.PK === item.PK && key.SK === item.SK,
          );
          expect(found).toBe(true);
        }

        // Verify: the number of deleted keys equals the number of related items
        expect(deletedKeys.length).toBe(relatedItems.length);
      }),
      { numRuns: 100 },
    );
  });

  it('records are batched in groups of 25 or fewer for BatchWriteCommand', async () => {
    await fc.assert(
      fc.asyncProperty(relatedItemsArb, async (relatedItems) => {
        const batchSizes: number[] = [];

        vi.clearAllMocks();
        const mockS3Send = vi.fn().mockResolvedValue({});
        setS3Client({ send: mockS3Send } as any);

        vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
          sessionId,
          name: 'Test Session',
          status: 'COMPLETED',
          assignedReviewerCount: 3,
          consensusThreshold: 67,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

        mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
          const input = command.input;

          if (input['Key'] !== undefined) {
            const key = input['Key'] as { PK: string; SK: string };
            if (key.PK === `SESSION#${sessionId}` && key.SK === 'METADATA') {
              const projection = input['ProjectionExpression'] as string | undefined;
              if (projection?.includes('GSI1PK')) {
                return Promise.resolve({ Item: { GSI1PK: 'TEAM#team-1' } });
              }
              if (projection?.includes('transcriptionJobId')) {
                return Promise.resolve({ Item: { transcriptionJobId: jobId } });
              }
              return Promise.resolve({ Item: { GSI1PK: 'TEAM#team-1', transcriptionJobId: jobId } });
            }
            return Promise.resolve({ Item: undefined });
          }

          if (input['KeyConditionExpression'] !== undefined) {
            return Promise.resolve({ Items: relatedItems });
          }

          if (input['RequestItems'] !== undefined) {
            const requestItems = input['RequestItems'] as Record<string, Array<unknown>>;
            const tableRequests = requestItems['TestTable'] ?? [];
            batchSizes.push(tableRequests.length);
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        await deleteTranscription({
          sessionId,
          userId: 'admin-user',
          userRole: 'ADMIN',
          userTeamId: 'team-1',
        });

        // Verify: each batch has at most 25 items
        for (const size of batchSizes) {
          expect(size).toBeLessThanOrEqual(25);
        }

        // Verify: total items across all batches equals the number of related items
        const totalDeleted = batchSizes.reduce((sum, s) => sum + s, 0);
        expect(totalDeleted).toBe(relatedItems.length);
      }),
      { numRuns: 100 },
    );
  });

  it('all SK prefixes (METADATA, SEGMENT#, CORRECTION#, CONSENSUS#) are deleted when present', async () => {
    // Generate items that always include at least one of each type
    const allTypesItemsArb = fc.tuple(
      fc.array(fc.uuid().map((id) => `SEGMENT#${id}`), { minLength: 1, maxLength: 10 }),
      fc.array(fc.uuid().map((id) => `CORRECTION#${id}`), { minLength: 1, maxLength: 10 }),
      fc.array(fc.uuid().map((id) => `CONSENSUS#${id}`), { minLength: 1, maxLength: 10 }),
    ).map(([segments, corrections, consensus]) => {
      const items = [
        { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        ...segments.map((sk) => ({ PK: `SESSION#${sessionId}`, SK: sk })),
        ...corrections.map((sk) => ({ PK: `SESSION#${sessionId}`, SK: sk })),
        ...consensus.map((sk) => ({ PK: `SESSION#${sessionId}`, SK: sk })),
      ];
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.SK)) return false;
        seen.add(item.SK);
        return true;
      });
    });

    await fc.assert(
      fc.asyncProperty(allTypesItemsArb, async (relatedItems) => {
        const deletedKeys = setupMocks(relatedItems);

        await deleteTranscription({
          sessionId,
          userId: 'admin-user',
          userRole: 'ADMIN',
          userTeamId: 'team-1',
        });

        // Verify: METADATA record is deleted
        expect(deletedKeys.some((k) => k.SK === 'METADATA')).toBe(true);

        // Verify: all SEGMENT# records are deleted
        const segmentItems = relatedItems.filter((i) => i.SK.startsWith('SEGMENT#'));
        for (const item of segmentItems) {
          expect(deletedKeys.some((k) => k.SK === item.SK)).toBe(true);
        }

        // Verify: all CORRECTION# records are deleted
        const correctionItems = relatedItems.filter((i) => i.SK.startsWith('CORRECTION#'));
        for (const item of correctionItems) {
          expect(deletedKeys.some((k) => k.SK === item.SK)).toBe(true);
        }

        // Verify: all CONSENSUS# records are deleted
        const consensusItems = relatedItems.filter((i) => i.SK.startsWith('CONSENSUS#'));
        for (const item of consensusItems) {
          expect(deletedKeys.some((k) => k.SK === item.SK)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 34 ---

describe('Feature: deletion, Property 34: チームアクセス制御による削除制限', () => {
  /**
   * **Validates: Requirements 21.9**
   *
   * For any TeamLeader user and ReviewSession, deletion is permitted only when
   * the ReviewSession belongs to the TeamLeader's team. ADMIN always has access.
   * TEAM_LEADER without a team assignment is denied. Resources without a team
   * are denied for non-ADMIN users.
   */

  const teamIdArb = fc.uuid();

  it('ADMIN role always returns true regardless of team IDs', () => {
    fc.assert(
      fc.property(
        fc.option(teamIdArb, { nil: undefined }),
        fc.option(teamIdArb, { nil: undefined }),
        (userTeamId, resourceTeamId) => {
          const result = checkTeamDeleteAccess('ADMIN', userTeamId, resourceTeamId);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('TEAM_LEADER with matching team ID returns true', () => {
    fc.assert(
      fc.property(teamIdArb, (teamId) => {
        const result = checkTeamDeleteAccess('TEAM_LEADER', teamId, teamId);
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('TEAM_LEADER with non-matching team ID returns false', () => {
    fc.assert(
      fc.property(teamIdArb, teamIdArb, (userTeamId, resourceTeamId) => {
        fc.pre(userTeamId !== resourceTeamId);
        const result = checkTeamDeleteAccess('TEAM_LEADER', userTeamId, resourceTeamId);
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('TEAM_LEADER with no team ID returns false', () => {
    fc.assert(
      fc.property(fc.option(teamIdArb, { nil: undefined }), (resourceTeamId) => {
        const result = checkTeamDeleteAccess('TEAM_LEADER', undefined, resourceTeamId);
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Resource with no team ID returns false for non-ADMIN', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('TEAM_LEADER', 'REVIEWER'),
        fc.option(teamIdArb, { nil: undefined }),
        (role, userTeamId) => {
          const result = checkTeamDeleteAccess(role, userTeamId, undefined);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 40 ---

describe('Feature: deletion, Property 40: 部分削除の監査ログ記録', () => {
  /**
   * **Validates: Requirements 21.9**
   *
   * For any deletion operation that partially completes (some steps succeed, some fail),
   * the system MUST record a PARTIAL_DELETION_FAILURE entry in the AuditLog containing:
   * - The actor's userId
   * - The resource ID being deleted
   * - The resource type
   * - A reason describing what succeeded and what failed
   */

  const sessionId = 'partial-delete-session';
  const jobId = 'partial-delete-job';

  // Arbitrary for generating different failure scenarios
  const failureScenarioArb = fc.record({
    userId: fc.uuid(),
    userRole: fc.constantFrom('ADMIN', 'TEAM_LEADER') as fc.Arbitrary<'ADMIN' | 'TEAM_LEADER'>,
    userTeamId: fc.uuid(),
    sessionName: fc.string({ minLength: 1, maxLength: 50 }),
    failAtStep: fc.constantFrom('cascade_delete') as fc.Arbitrary<'cascade_delete'>,
  });

  it('records PARTIAL_DELETION_FAILURE in AuditLog when cascade delete fails after S3 delete', async () => {
    const { recordAuditLog } = await import('./audit-service.js');
    const mockedRecordAuditLog = vi.mocked(recordAuditLog);

    await fc.assert(
      fc.asyncProperty(failureScenarioArb, async (scenario) => {
        vi.clearAllMocks();

        const mockS3Send = vi.fn().mockResolvedValue({});
        setS3Client({ send: mockS3Send } as any);

        vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
          sessionId,
          name: scenario.sessionName,
          status: 'COMPLETED',
          assignedReviewerCount: 3,
          consensusThreshold: 67,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

        mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
          const input = command.input;

          if (input['Key'] !== undefined) {
            const key = input['Key'] as { PK: string; SK: string };
            if (key.PK === `SESSION#${sessionId}` && key.SK === 'METADATA') {
              const projection = input['ProjectionExpression'] as string | undefined;
              if (projection?.includes('GSI1PK')) {
                return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}` } });
              }
              if (projection?.includes('transcriptionJobId')) {
                return Promise.resolve({ Item: { transcriptionJobId: jobId } });
              }
              return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}`, transcriptionJobId: jobId } });
            }
            return Promise.resolve({ Item: undefined });
          }

          if (input['KeyConditionExpression'] !== undefined) {
            return Promise.resolve({
              Items: [
                { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
                { PK: `SESSION#${sessionId}`, SK: 'SEGMENT#seg-1' },
              ],
            });
          }

          // BatchWriteCommand - simulate failure
          if (input['RequestItems'] !== undefined) {
            return Promise.reject(new Error('DynamoDB BatchWrite failed'));
          }

          return Promise.resolve({});
        });

        // The deletion should throw
        await expect(
          deleteTranscription({
            sessionId,
            userId: scenario.userId,
            userRole: scenario.userRole,
            userTeamId: scenario.userTeamId,
          }),
        ).rejects.toThrow();

        // Verify: PARTIAL_DELETION_FAILURE was recorded
        expect(mockedRecordAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            actorUserId: scenario.userId,
            actorRole: scenario.userRole,
            operationType: 'PARTIAL_DELETION_FAILURE',
            resourceId: sessionId,
            resourceType: 'ReviewSession',
            metadata: expect.objectContaining({
              resourceName: scenario.sessionName,
              reason: expect.stringContaining('Partial deletion failure'),
            }),
          }),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('PARTIAL_DELETION_FAILURE audit log contains S3 and DynamoDB status', async () => {
    const { recordAuditLog } = await import('./audit-service.js');
    const mockedRecordAuditLog = vi.mocked(recordAuditLog);

    await fc.assert(
      fc.asyncProperty(failureScenarioArb, async (scenario) => {
        vi.clearAllMocks();

        const mockS3Send = vi.fn().mockResolvedValue({});
        setS3Client({ send: mockS3Send } as any);

        vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
          sessionId,
          name: scenario.sessionName,
          status: 'COMPLETED',
          assignedReviewerCount: 3,
          consensusThreshold: 67,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

        mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
          const input = command.input;

          if (input['Key'] !== undefined) {
            const key = input['Key'] as { PK: string; SK: string };
            if (key.PK === `SESSION#${sessionId}` && key.SK === 'METADATA') {
              const projection = input['ProjectionExpression'] as string | undefined;
              if (projection?.includes('GSI1PK')) {
                return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}` } });
              }
              if (projection?.includes('transcriptionJobId')) {
                return Promise.resolve({ Item: { transcriptionJobId: jobId } });
              }
              return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}`, transcriptionJobId: jobId } });
            }
            return Promise.resolve({ Item: undefined });
          }

          if (input['KeyConditionExpression'] !== undefined) {
            return Promise.resolve({
              Items: [{ PK: `SESSION#${sessionId}`, SK: 'METADATA' }],
            });
          }

          // BatchWriteCommand - simulate failure
          if (input['RequestItems'] !== undefined) {
            return Promise.reject(new Error('DynamoDB timeout'));
          }

          return Promise.resolve({});
        });

        await expect(
          deleteTranscription({
            sessionId,
            userId: scenario.userId,
            userRole: scenario.userRole,
            userTeamId: scenario.userTeamId,
          }),
        ).rejects.toThrow();

        // Verify: the reason field contains both S3 and DynamoDB status
        const auditCall = mockedRecordAuditLog.mock.calls.find(
          (call) => call[0].operationType === 'PARTIAL_DELETION_FAILURE',
        );
        expect(auditCall).toBeDefined();

        const reason = (auditCall![0].metadata as Record<string, string>).reason;
        // S3 was deleted (succeeded before DynamoDB failed)
        expect(reason).toContain('S3=deleted');
        // DynamoDB was pending (failed)
        expect(reason).toContain('DynamoDB=pending');
      }),
      { numRuns: 100 },
    );
  });

  it('no PARTIAL_DELETION_FAILURE is recorded when deletion succeeds completely', async () => {
    const { recordAuditLog } = await import('./audit-service.js');
    const mockedRecordAuditLog = vi.mocked(recordAuditLog);

    await fc.assert(
      fc.asyncProperty(failureScenarioArb, async (scenario) => {
        vi.clearAllMocks();

        const mockS3Send = vi.fn().mockResolvedValue({});
        setS3Client({ send: mockS3Send } as any);

        vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
          sessionId,
          name: scenario.sessionName,
          status: 'COMPLETED',
          assignedReviewerCount: 3,
          consensusThreshold: 67,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

        mockSend.mockImplementation((command: { input: Record<string, unknown> }) => {
          const input = command.input;

          if (input['Key'] !== undefined) {
            const key = input['Key'] as { PK: string; SK: string };
            if (key.PK === `SESSION#${sessionId}` && key.SK === 'METADATA') {
              const projection = input['ProjectionExpression'] as string | undefined;
              if (projection?.includes('GSI1PK')) {
                return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}` } });
              }
              if (projection?.includes('transcriptionJobId')) {
                return Promise.resolve({ Item: { transcriptionJobId: jobId } });
              }
              return Promise.resolve({ Item: { GSI1PK: `TEAM#${scenario.userTeamId}`, transcriptionJobId: jobId } });
            }
            return Promise.resolve({ Item: undefined });
          }

          if (input['KeyConditionExpression'] !== undefined) {
            return Promise.resolve({
              Items: [{ PK: `SESSION#${sessionId}`, SK: 'METADATA' }],
            });
          }

          // BatchWriteCommand - succeeds
          if (input['RequestItems'] !== undefined) {
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        await deleteTranscription({
          sessionId,
          userId: scenario.userId,
          userRole: scenario.userRole,
          userTeamId: scenario.userTeamId,
        });

        // Verify: no PARTIAL_DELETION_FAILURE was recorded
        const partialFailureCalls = mockedRecordAuditLog.mock.calls.filter(
          (call) => call[0].operationType === 'PARTIAL_DELETION_FAILURE',
        );
        expect(partialFailureCalls.length).toBe(0);

        // Verify: TRANSCRIPTION_DELETED was recorded instead
        const successCalls = mockedRecordAuditLog.mock.calls.filter(
          (call) => call[0].operationType === 'TRANSCRIPTION_DELETED',
        );
        expect(successCalls.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 33 (cascade resilience): the job cascade attempts every job ---

describe('Feature: deletion, Property 33: カスケード削除の完全性（ジョブ削除は 1 件失敗しても他を継続）', () => {
  /**
   * **Validates: Requirements 21.6**
   *
   * When a media file is deleted, its transcription jobs are cascade-deleted
   * (S3 output + DynamoDB record per job). If one job's S3 output delete fails
   * mid-cascade, every OTHER job must still have its S3 output delete attempted
   * and its DynamoDB record deleted (the cascade must not abort on first
   * failure). deleteMediaFile must still reject, and exactly one
   * PARTIAL_DELETION_FAILURE audit log must be recorded.
   */

  const mediaFileId = 'cascade-media';

  const scenarioArb = fc
    .array(fc.uuid(), { minLength: 1, maxLength: 10 })
    .chain((rawIds) => {
      // Ensure job IDs are unique so per-job key assertions are unambiguous.
      const jobIds = Array.from(new Set(rawIds));
      return fc
        .integer({ min: 0, max: jobIds.length - 1 })
        .map((failingIndex) => ({ jobIds, failingIndex }));
    });

  it('every non-failing job is still fully deleted when one job S3 delete fails', async () => {
    const mockedListJobsByMedia = vi.mocked(transcriptionJobRepository.listByMediaFileId);
    const mockedDeleteJobById = vi.mocked(transcriptionJobRepository.deleteById);
    const mockedGetById = vi.mocked(mediaFileRepository.getById);
    const mockedCanAccess = vi.mocked(canAccessMediaFile);
    const { recordAuditLog } = await import('./audit-service.js');
    const mockedRecordAuditLog = vi.mocked(recordAuditLog);

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ jobIds, failingIndex }) => {
        vi.clearAllMocks();
        process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
        process.env.DATA_BUCKET_NAME = 'test-data-bucket';

        const failingJobId = jobIds[failingIndex];
        const failingKey = `transcriptions/${failingJobId}/output.json`;

        const mockS3Send = vi.fn().mockImplementation((command: { input?: { Key?: string } }) => {
          if (command.input?.Key === failingKey) {
            return Promise.reject(new Error('S3 throttled'));
          }
          return Promise.resolve({});
        });
        setS3Client({ send: mockS3Send } as any);

        mockedCanAccess.mockResolvedValue(true);
        mockedGetById.mockResolvedValue({
          mediaFileId,
          filename: 'cascade.mp3',
          s3Key: `media/${mediaFileId}/cascade.mp3`,
          contentType: 'audio/mpeg',
          fileSize: 1024,
          uploadedBy: 'user-002',
          teamId: 'team-001',
          status: 'UPLOADED',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        } as any);
        vi.mocked(sessionRepository.getSessionById).mockResolvedValue(null as any);
        mockedListJobsByMedia.mockResolvedValue(
          jobIds.map((jobId) => ({
            jobId,
            transcribeJobName: `tr-${jobId}`,
            mediaFileId,
            status: 'IN_PROGRESS',
            languageCode: 'ja-JP',
            maxSpeakerLabels: 2,
            outputS3Key: `transcriptions/${jobId}/output.json`,
            startedBy: 'user-002',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          })) as any,
        );
        mockedDeleteJobById.mockResolvedValue(undefined);
        mockSend.mockResolvedValue({});

        // deleteMediaFile must reject (aggregated error propagates).
        await expect(
          deleteMediaFile({
            mediaFileId,
            user: {
              userId: 'admin-user',
              email: 'admin@example.com',
              displayName: 'Admin',
              role: 'ADMIN',
            },
          }),
        ).rejects.toThrow();

        const s3Keys = mockS3Send.mock.calls
          .map((call) => (call[0] as { input?: { Key?: string } }).input?.Key)
          .filter((k): k is string => typeof k === 'string');
        const deletedJobIds = mockedDeleteJobById.mock.calls.map((call) => call[0] as string);

        for (const jobId of jobIds) {
          // Every job's S3 output delete is attempted (including the failing one).
          expect(s3Keys).toContain(`transcriptions/${jobId}/output.json`);
          if (jobId !== failingJobId) {
            // Every non-failing job's DynamoDB record is still deleted.
            expect(deletedJobIds).toContain(jobId);
          } else {
            // The failing job's record delete is skipped (S3 came first and threw).
            expect(deletedJobIds).not.toContain(jobId);
          }
        }

        // Exactly one PARTIAL_DELETION_FAILURE audit log is recorded.
        const partialFailureCalls = mockedRecordAuditLog.mock.calls.filter(
          (call) => call[0].operationType === 'PARTIAL_DELETION_FAILURE',
        );
        expect(partialFailureCalls.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
