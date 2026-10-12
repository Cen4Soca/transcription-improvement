import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AuthUser } from '../utils/auth-middleware.js';

vi.mock('./audit-service.js', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/team-repository.js', () => ({
  getTeamById: vi.fn(),
}));

vi.mock('./access-control-service.js', () => ({
  checkSessionAccess: vi.fn(),
  checkLanguageModelAccess: vi.fn(),
  isTeamMember: vi.fn(),
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repositories/language-model-repository.js', () => ({
  putModel: vi.fn().mockResolvedValue(undefined),
  getModel: vi.fn().mockResolvedValue(null),
  findByDisplayName: vi.fn().mockResolvedValue(null),
  updateDisplayName: vi.fn().mockResolvedValue(undefined),
  setDeletionStatus: vi.fn().mockResolvedValue(undefined),
  hardDelete: vi.fn().mockResolvedValue(undefined),
  queryByTeam: vi.fn().mockResolvedValue([]),
  queryAll: vi.fn().mockResolvedValue([]),
}));

import {
  createModel,
  listModels,
  renameModelDisplayName,
  deleteModel,
  setTranscribeClient,
  setS3Client,
  setDeleteBackoffBaseMs,
  type CreateModelParams,
} from './language-model-service.js';
import { notFoundError } from '../utils/error-handler.js';
import { recordAuditLog } from './audit-service.js';
import { getTeamById } from '../repositories/team-repository.js';
import {
  checkSessionAccess,
  checkLanguageModelAccess,
  isTeamMember,
  getUserTeamIds,
} from './access-control-service.js';
import {
  putModel,
  getModel,
  findByDisplayName,
  updateDisplayName,
  setDeletionStatus,
  hardDelete,
  queryByTeam,
  queryAll,
} from '../repositories/language-model-repository.js';
import type { LanguageModelMetadata } from '../types/index.js';

const mockedGetTeamById = vi.mocked(getTeamById);
const mockedCheckSessionAccess = vi.mocked(checkSessionAccess);
const mockedCheckLanguageModelAccess = vi.mocked(checkLanguageModelAccess);
const mockedIsTeamMember = vi.mocked(isTeamMember);
const mockedGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockedPutModel = vi.mocked(putModel);
const mockedFindByDisplayName = vi.mocked(findByDisplayName);
const mockedUpdateDisplayName = vi.mocked(updateDisplayName);
const mockedQueryByTeam = vi.mocked(queryByTeam);
const mockedQueryAll = vi.mocked(queryAll);
const mockedGetModel = vi.mocked(getModel);
const mockedSetDeletionStatus = vi.mocked(setDeletionStatus);
const mockedHardDelete = vi.mocked(hardDelete);
const mockedRecordAuditLog = vi.mocked(recordAuditLog);

const adminUser: AuthUser = {
  userId: 'admin-001',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'ADMIN',
};

const mockTranscribeSend = vi.fn();
const mockS3Send = vi.fn();

/**
 * Reset mocks + clients to a baseline "happy path": team exists, caller is a
 * member, every session is accessible, no displayName collision, Transcribe
 * calls succeed.
 */
function resetHappyPath(): void {
  vi.clearAllMocks();
  vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
  vi.stubEnv(
    'TRANSCRIBE_DATA_ACCESS_ROLE_ARN',
    'arn:aws:iam::123456789012:role/TranscribeDataAccess'
  );
  setTranscribeClient({ send: mockTranscribeSend } as any);
  setS3Client({ send: mockS3Send } as any);
  mockTranscribeSend.mockResolvedValue({ Models: [] });
  mockS3Send.mockResolvedValue({});
  mockedGetTeamById.mockResolvedValue({
    teamId: 'team-001',
    name: 'Team 1',
    createdBy: 'admin-001',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  mockedCheckSessionAccess.mockResolvedValue(undefined);
  mockedIsTeamMember.mockResolvedValue(true);
  mockedFindByDisplayName.mockResolvedValue(null);
  mockedPutModel.mockResolvedValue(undefined);
}

function buildParams(overrides: Partial<CreateModelParams> = {}): CreateModelParams {
  return {
    modelName: 'model-001',
    baseModelName: 'WideBand',
    displayName: '会議モデル',
    teamId: 'team-001',
    segments: [{ text: 'テスト文章', confirmed: true }],
    sessionIds: ['session-001'],
    user: adminUser,
    ...overrides,
  };
}

const sessionIdArb = fc.stringMatching(/^session-[a-z0-9]{1,8}$/);
const sessionIdsArb = fc.uniqueArray(sessionIdArb, { minLength: 1, maxLength: 6 });

describe('Feature: language-model-team-isolation, Property 1: session ownership on create', () => {
  /**
   * **Validates: Requirements 20 (作成時のセッション所有チェック)**
   * createModel must verify the caller can access every source session. If any
   * provided sessionId is inaccessible (checkSessionAccess throws 404), creation
   * is rejected and no Transcribe model / metadata is written. Only when every
   * session is accessible does creation proceed.
   */
  beforeEach(() => {
    resetHappyPath();
  });

  it('rejects when any sessionId is not accessible to the caller', async () => {
    await fc.assert(
      fc.asyncProperty(
        sessionIdsArb,
        fc.nat(),
        async (sessionIds, pickSeed) => {
          resetHappyPath();
          const inaccessibleIndex = pickSeed % sessionIds.length;
          const inaccessibleId = sessionIds[inaccessibleIndex];

          mockedCheckSessionAccess.mockImplementation(async (_user, sessionId) => {
            if (sessionId === inaccessibleId) {
              // denyResourceAccess() returns a 404 AppError; throw it to deny access
              throw notFoundError('リソースが見つかりません。');
            }
            return undefined;
          });

          await expect(
            createModel(buildParams({ sessionIds }))
          ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

          // No model should have been created or persisted
          expect(mockedPutModel).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('proceeds only when every sessionId is accessible', async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdsArb, async (sessionIds) => {
        resetHappyPath();
        mockedCheckSessionAccess.mockResolvedValue(undefined);

        const result = await createModel(buildParams({ sessionIds }));

        expect(result.status).toBe('IN_PROGRESS');
        expect(mockedCheckSessionAccess).toHaveBeenCalledTimes(sessionIds.length);
        expect(mockedPutModel).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: language-model-team-isolation, Property 2: within-team displayName uniqueness on create', () => {
  /**
   * **Validates: Requirements 20 (displayName チーム内一意)**
   * If another model in the same team already uses the given displayName
   * (case-insensitive), creation is rejected with VALIDATION_ERROR. When no
   * collision exists, creation proceeds and persists metadata.
   */
  const displayNameArb = fc.string({ minLength: 1, maxLength: 100 }).map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= 100);

  beforeEach(() => {
    resetHappyPath();
  });

  it('rejects when a model with the same displayName exists in the team', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameArb, async (displayName) => {
        resetHappyPath();
        mockedFindByDisplayName.mockResolvedValue({
          modelName: 'existing',
          teamId: 'team-001',
          displayName,
          displayNameLower: displayName.toLowerCase(),
          baseModelName: 'WideBand',
          createdBy: 'user-002',
          createdAt: '2024-01-01T00:00:00.000Z',
          sessionIds: [],
          s3Key: 'training-data/existing/training.txt',
          deletionStatus: 'ACTIVE',
        });

        await expect(
          createModel(buildParams({ displayName }))
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

        expect(mockedPutModel).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('proceeds and persists metadata when displayName is unique in the team', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameArb, async (displayName) => {
        resetHappyPath();
        mockedFindByDisplayName.mockResolvedValue(null);

        const result = await createModel(buildParams({ displayName }));

        expect(result.displayName).toBe(displayName);
        expect(mockedFindByDisplayName).toHaveBeenCalledWith(
          'team-001',
          displayName.toLowerCase()
        );
        expect(mockedPutModel).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: language-model-team-isolation, Property 3: quota-exceeded handling on create', () => {
  /**
   * **Validates: Requirements 20 (モデル数上限クォータ超過エラー)**
   * When Transcribe CreateLanguageModel fails with a quota / LimitExceeded
   * condition (SDK LimitExceededException or HTTP 429), createModel surfaces it
   * as an AppError with code QUOTA_EXCEEDED and statusCode 429.
   */
  const quotaErrorArb = fc.oneof(
    fc.constant(Object.assign(new Error('limit exceeded'), { name: 'LimitExceededException' })),
    fc.constant(Object.assign(new Error('throttled'), { name: 'ThrottlingException' })),
    fc.constant(Object.assign(new Error('too many'), { name: 'TooManyRequestsException' })),
    fc.constant(Object.assign(new Error('http 429'), { $metadata: { httpStatusCode: 429 } })),
    fc.constant(Object.assign(new Error('status 429'), { statusCode: 429 }))
  );

  beforeEach(() => {
    resetHappyPath();
  });

  it('maps Transcribe quota/LimitExceeded errors to QUOTA_EXCEEDED 429', async () => {
    await fc.assert(
      fc.asyncProperty(quotaErrorArb, async (quotaError) => {
        resetHappyPath();
        // 1st send: ListLanguageModels (duplicate check) -> ok
        // 2nd send: CreateLanguageModel -> quota error
        mockTranscribeSend
          .mockResolvedValueOnce({ Models: [] })
          .mockRejectedValueOnce(quotaError);

        await expect(
          createModel(buildParams())
        ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', statusCode: 429 });

        // Quota failure happens before metadata persistence
        expect(mockedPutModel).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: language-model-team-isolation, Property 4: team-scoped list filtering', () => {
  /**
   * **Validates: Requirements 18.4**
   * listModels returns exactly the intersection of the caller-visible metadata
   * set and the Transcribe COMPLETED set:
   * - A non-ADMIN sees only models whose teamId is one of the caller's teams
   *   AND which are COMPLETED in Transcribe, and never a PENDING (soft-deleted)
   *   model.
   * - An ADMIN sees every COMPLETED model that has metadata, regardless of team.
   */

  const mockTranscribeSendLocal = vi.fn();

  type ModelFixture = {
    modelName: string;
    teamId: string;
    deletionStatus: 'ACTIVE' | 'PENDING';
    transcribeStatus: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED';
  };

  const modelFixtureArb = fc.record({
    modelName: fc.stringMatching(/^model-[a-z0-9]{1,8}$/),
    teamId: fc.constantFrom('team-A', 'team-B', 'team-C'),
    deletionStatus: fc.constantFrom('ACTIVE' as const, 'PENDING' as const),
    transcribeStatus: fc.constantFrom(
      'COMPLETED' as const,
      'IN_PROGRESS' as const,
      'FAILED' as const
    ),
  });

  const modelsArb = fc.uniqueArray(modelFixtureArb, {
    minLength: 0,
    maxLength: 12,
    selector: (m) => m.modelName,
  });

  const callerTeamsArb = fc.subarray(['team-A', 'team-B', 'team-C'], {
    minLength: 0,
    maxLength: 3,
  });

  function metadataFor(models: ModelFixture[]): LanguageModelMetadata[] {
    return models.map((m) => ({
      modelName: m.modelName,
      teamId: m.teamId,
      displayName: m.modelName,
      displayNameLower: m.modelName.toLowerCase(),
      baseModelName: 'WideBand',
      createdBy: 'user-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      sessionIds: [],
      s3Key: `training-data/${m.modelName}/training.txt`,
      deletionStatus: m.deletionStatus,
    }));
  }

  function transcribeResponseFor(models: ModelFixture[]): {
    Models: { ModelName: string; ModelStatus: string; BaseModelName: string }[];
  } {
    return {
      Models: models.map((m) => ({
        ModelName: m.modelName,
        ModelStatus: m.transcribeStatus,
        BaseModelName: 'WideBand',
      })),
    };
  }

  function setup(): void {
    vi.clearAllMocks();
    setTranscribeClient({ send: mockTranscribeSendLocal } as any);
    mockedGetUserTeamIds.mockResolvedValue([]);
    mockedQueryAll.mockResolvedValue([]);
    mockedQueryByTeam.mockResolvedValue([]);
  }

  beforeEach(() => {
    setup();
  });

  const reviewer: AuthUser = {
    userId: 'reviewer-001',
    email: 'reviewer@example.com',
    displayName: 'Reviewer',
    role: 'REVIEWER',
  };

  it('non-ADMIN sees exactly (teamId in caller teams) ∩ COMPLETED and never a PENDING model', async () => {
    await fc.assert(
      fc.asyncProperty(modelsArb, callerTeamsArb, async (models, callerTeams) => {
        setup();

        const metadata = metadataFor(models);
        const callerTeamSet = new Set(callerTeams);

        // Non-ADMIN: queryByTeam returns the metadata for each caller team.
        mockedGetUserTeamIds.mockResolvedValue(callerTeams);
        mockedQueryByTeam.mockImplementation(async (teamId: string) =>
          metadata.filter((m) => m.teamId === teamId)
        );
        mockTranscribeSendLocal.mockResolvedValue(transcribeResponseFor(models));

        const result = await listModels(reviewer);
        const resultNames = new Set(result.map((r) => r.modelName));

        const expected = models.filter(
          (m) =>
            callerTeamSet.has(m.teamId) &&
            m.deletionStatus === 'ACTIVE' &&
            m.transcribeStatus === 'COMPLETED'
        );
        const expectedNames = new Set(expected.map((m) => m.modelName));

        expect(resultNames).toEqual(expectedNames);
        // Never a PENDING model.
        for (const r of result) {
          const fixture = models.find((m) => m.modelName === r.modelName)!;
          expect(fixture.deletionStatus).toBe('ACTIVE');
          expect(fixture.transcribeStatus).toBe('COMPLETED');
          expect(callerTeamSet.has(fixture.teamId)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('ADMIN sees exactly the ACTIVE metadata models that are COMPLETED in Transcribe', async () => {
    await fc.assert(
      fc.asyncProperty(modelsArb, async (models) => {
        setup();

        mockedQueryAll.mockResolvedValue(metadataFor(models));
        mockTranscribeSendLocal.mockResolvedValue(transcribeResponseFor(models));

        const result = await listModels(adminUser);
        const resultNames = new Set(result.map((r) => r.modelName));

        const expectedNames = new Set(
          models
            .filter(
              (m) =>
                m.deletionStatus === 'ACTIVE' &&
                m.transcribeStatus === 'COMPLETED'
            )
            .map((m) => m.modelName)
        );

        expect(resultNames).toEqual(expectedNames);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: language-model-team-isolation, Property 5: within-team displayName uniqueness on rename', () => {
  /**
   * **Validates: 新規要件 — カスタム言語モデルの表示名編集**
   * (design.md「表示名編集: ADMIN / 自チーム TEAM_LEADER。trim 後 1〜100 文字。
   *  displayName 一意性: チーム内一意」)
   *
   * renameModelDisplayName must preserve within-team displayName uniqueness:
   * - Reject (VALIDATION_ERROR 400) when a DIFFERENT model in the same team
   *   already uses the requested name (case-insensitive), and never persist.
   * - Allow renaming to the model's OWN current name (self is excluded from the
   *   uniqueness check) and persist via updateDisplayName.
   * - Allow a name that is used only in OTHER teams: the uniqueness lookup is
   *   scoped to the model's own team (findByDisplayName(model.teamId, ...)), so a
   *   collision in a different team never blocks the rename.
   */

  const adminActor: AuthUser = {
    userId: 'admin-002',
    email: 'admin2@example.com',
    displayName: 'Admin 2',
    role: 'ADMIN',
  };

  function baseModel(
    overrides: Partial<LanguageModelMetadata> = {}
  ): LanguageModelMetadata {
    return {
      modelName: 'model-self',
      teamId: 'team-001',
      displayName: '現在の名前',
      displayNameLower: '現在の名前',
      baseModelName: 'WideBand',
      createdBy: 'user-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      sessionIds: [],
      s3Key: 'training-data/model-self/training.txt',
      deletionStatus: 'ACTIVE',
      ...overrides,
    };
  }

  // Trimmed, in-range display names.
  const displayNameArb = fc
    .string({ minLength: 1, maxLength: 100 })
    .map((s) => s.trim())
    .filter((s) => s.length >= 1 && s.length <= 100);

  function setup(): void {
    vi.clearAllMocks();
    mockedUpdateDisplayName.mockResolvedValue(undefined);
  }

  beforeEach(() => {
    setup();
  });

  it('rejects a rename to a name used by ANOTHER model in the same team', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameArb, async (newName) => {
        setup();
        const model = baseModel();
        mockedCheckLanguageModelAccess.mockResolvedValue(model);
        // A DIFFERENT model in the same team already holds the requested name.
        mockedFindByDisplayName.mockResolvedValue(
          baseModel({
            modelName: 'other-model',
            displayName: newName,
            displayNameLower: newName.toLowerCase(),
          })
        );

        await expect(
          renameModelDisplayName(adminActor, model.modelName, newName)
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

        // The uniqueness lookup is scoped to the model's own team.
        expect(mockedFindByDisplayName).toHaveBeenCalledWith(
          model.teamId,
          newName.toLowerCase()
        );
        expect(mockedUpdateDisplayName).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('allows renaming to the model OWN current name (self excluded)', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameArb, async (name) => {
        setup();
        const model = baseModel({
          displayName: name,
          displayNameLower: name.toLowerCase(),
        });
        mockedCheckLanguageModelAccess.mockResolvedValue(model);
        // The only match for the name is the model itself.
        mockedFindByDisplayName.mockResolvedValue(model);

        const result = await renameModelDisplayName(
          adminActor,
          model.modelName,
          name
        );

        expect(result.displayName).toBe(name);
        expect(mockedUpdateDisplayName).toHaveBeenCalledWith(
          model.modelName,
          name,
          name.toLowerCase()
        );
      }),
      { numRuns: 100 }
    );
  });

  it('allows a name that is used only in OTHER teams (no collision in own team)', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameArb, async (newName) => {
        setup();
        const model = baseModel({ teamId: 'team-001' });
        mockedCheckLanguageModelAccess.mockResolvedValue(model);
        // Scoped lookup for the model's own team finds nothing, even though the
        // name may be in use within some other team.
        mockedFindByDisplayName.mockResolvedValue(null);

        const result = await renameModelDisplayName(
          adminActor,
          model.modelName,
          newName
        );

        expect(result.displayName).toBe(newName);
        expect(mockedFindByDisplayName).toHaveBeenCalledWith(
          'team-001',
          newName.toLowerCase()
        );
        expect(mockedUpdateDisplayName).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: language-model-team-isolation, Property 6: delete order and idempotency', () => {
  /**
   * **Validates: 新規要件 — カスタム言語モデルの削除**
   * (design.md「削除順序: ソフト削除(PENDING) → Transcribe → S3 → メタデータ物理削除。
   *  各ステップ冪等・失敗時リトライ・再実行で復旧」)
   *
   * deleteModel must enforce a strict teardown order and be idempotent/re-runnable:
   * - On a single successful run the steps always occur in the order
   *   soft-delete (PENDING) -> Transcribe DeleteLanguageModel -> S3 DeleteObject
   *   -> hard-delete, with the soft-delete FIRST.
   * - When a later step fails partway, the record is left PENDING (never
   *   hard-deleted, no audit) and the error is rethrown; re-invoking the same
   *   DELETE never performs the Transcribe/S3/hard-delete steps before the
   *   soft-delete, and (once the previously-failing steps succeed or report the
   *   resource already-absent) converges to a hard-deleted model without error.
   */

  const adminActor: AuthUser = {
    userId: 'admin-del',
    email: 'admin-del@example.com',
    displayName: 'Admin Del',
    role: 'ADMIN',
  };

  function baseModel(
    overrides: Partial<LanguageModelMetadata> = {}
  ): LanguageModelMetadata {
    return {
      modelName: 'model-del',
      teamId: 'team-001',
      displayName: 'Del Model',
      displayNameLower: 'del model',
      baseModelName: 'WideBand',
      createdBy: 'user-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      sessionIds: [],
      s3Key: 'training-data/model-del/training.txt',
      deletionStatus: 'ACTIVE',
      ...overrides,
    };
  }

  const mockTranscribeSendLocal = vi.fn();
  const mockS3SendLocal = vi.fn();

  // Fail-point generator: 0 = never fail (clean run), 1..3 = fail the Transcribe
  // delete / S3 delete / hard-delete on the FIRST attempt only, then succeed.
  const failPointArb = fc.integer({ min: 0, max: 3 });
  // Whether a given teardown step encounters an already-absent resource.
  const absenceArb = fc.record({
    transcribeAbsent: fc.boolean(),
    s3Absent: fc.boolean(),
  });

  function setup(): void {
    vi.clearAllMocks();
    setDeleteBackoffBaseMs(0);
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
    setTranscribeClient({ send: mockTranscribeSendLocal } as any);
    setS3Client({ send: mockS3SendLocal } as any);
    mockedGetUserTeamIds.mockResolvedValue(['team-001']);
    mockedSetDeletionStatus.mockResolvedValue(undefined);
    mockedHardDelete.mockResolvedValue(undefined);
  }

  beforeEach(() => {
    setup();
  });

  it('always soft-deletes first, keeps the ordered teardown, and converges idempotently on re-run', async () => {
    await fc.assert(
      fc.asyncProperty(failPointArb, absenceArb, async (failPoint, absence) => {
        setup();

        const order: string[] = [];
        mockedSetDeletionStatus.mockImplementation(async () => {
          order.push('soft-delete');
        });
        mockedHardDelete.mockImplementation(async () => {
          order.push('hard-delete');
        });

        // First invocation starts from an ACTIVE record.
        mockedGetModel.mockResolvedValue(baseModel({ deletionStatus: 'ACTIVE' }));

        const notFound = (): never => {
          throw Object.assign(new Error('absent'), { name: 'BadRequestException' });
        };
        const s3NotFound = (): never => {
          throw Object.assign(new Error('no such key'), { name: 'NoSuchKey' });
        };

        // Transcribe dispatcher: eligibility is COMPLETED + no in-progress jobs.
        // DeleteLanguageModel fails once if failPoint===1, else absent/ok.
        let transcribeDeleteFailed = false;
        mockTranscribeSendLocal.mockImplementation(async (command: any) => {
          const name = command?.constructor?.name as string;
          if (name === 'DescribeLanguageModelCommand') {
            return { LanguageModel: { ModelStatus: 'COMPLETED' } };
          }
          if (name === 'ListTranscriptionJobsCommand') {
            return { TranscriptionJobSummaries: [] };
          }
          if (name === 'DeleteLanguageModelCommand') {
            order.push('transcribe-delete');
            if (failPoint === 1 && !transcribeDeleteFailed) {
              transcribeDeleteFailed = true;
              throw new Error('transient transcribe failure');
            }
            if (absence.transcribeAbsent) {
              return notFound();
            }
            return {};
          }
          return {};
        });

        let s3DeleteFailed = false;
        mockS3SendLocal.mockImplementation(async () => {
          order.push('s3-delete');
          if (failPoint === 2 && !s3DeleteFailed) {
            s3DeleteFailed = true;
            throw new Error('transient s3 failure');
          }
          if (absence.s3Absent) {
            return s3NotFound();
          }
          return {};
        });

        let hardDeleteFailed = false;
        mockedHardDelete.mockImplementation(async () => {
          order.push('hard-delete');
          if (failPoint === 3 && !hardDeleteFailed) {
            hardDeleteFailed = true;
            throw new Error('transient hard-delete failure');
          }
        });

        // withRetry retries each step up to 3 times, so a single transient
        // failure (failPoint 1/2/3) is absorbed within one invocation. When
        // failPoint===0 there is no failure at all. Either way the invocation
        // succeeds; failPoint drives the retry path.
        await deleteModel(adminActor, 'model-del');

        // Soft-delete is always the FIRST teardown action.
        expect(order[0]).toBe('soft-delete');

        // The ordered milestones (deduped) must respect the sequence.
        const milestones = order.filter(
          (step, idx) => order.indexOf(step) === idx
        );
        expect(milestones).toEqual([
          'soft-delete',
          'transcribe-delete',
          's3-delete',
          'hard-delete',
        ]);

        // No teardown action ever precedes the soft-delete.
        const firstSoft = order.indexOf('soft-delete');
        const firstTranscribe = order.indexOf('transcribe-delete');
        const firstS3 = order.indexOf('s3-delete');
        const firstHard = order.indexOf('hard-delete');
        expect(firstSoft).toBeLessThan(firstTranscribe);
        expect(firstTranscribe).toBeLessThan(firstS3);
        expect(firstS3).toBeLessThan(firstHard);

        // Converged: hard-delete executed and the success audit was recorded.
        expect(mockedHardDelete).toHaveBeenCalledWith('model-del');
        expect(mockedRecordAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({ operationType: 'LANGUAGE_MODEL_DELETED' })
        );
      }),
      { numRuns: 100 }
    );
  });

  it('re-invocation after a mid-sequence failure resumes from a PENDING record and converges without re-running before soft-delete', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('transcribe' as const, 's3' as const, 'hard' as const),
        async (failStep) => {
          setup();

          // --- Invocation 1: starts ACTIVE, fails hard (exhausts retries). ---
          mockedGetModel.mockResolvedValue(baseModel({ deletionStatus: 'ACTIVE' }));

          const order1: string[] = [];
          mockedSetDeletionStatus.mockImplementation(async () => {
            order1.push('soft-delete');
          });
          mockedHardDelete.mockImplementation(async () => {
            order1.push('hard-delete');
            if (failStep === 'hard') {
              throw new Error('persistent hard-delete failure');
            }
          });
          mockTranscribeSendLocal.mockImplementation(async (command: any) => {
            const name = command?.constructor?.name as string;
            if (name === 'DescribeLanguageModelCommand') {
              return { LanguageModel: { ModelStatus: 'COMPLETED' } };
            }
            if (name === 'ListTranscriptionJobsCommand') {
              return { TranscriptionJobSummaries: [] };
            }
            if (name === 'DeleteLanguageModelCommand') {
              order1.push('transcribe-delete');
              if (failStep === 'transcribe') {
                throw new Error('persistent transcribe failure');
              }
              return {};
            }
            return {};
          });
          mockS3SendLocal.mockImplementation(async () => {
            order1.push('s3-delete');
            if (failStep === 's3') {
              throw new Error('persistent s3 failure');
            }
            return {};
          });

          await expect(deleteModel(adminActor, 'model-del')).rejects.toThrow();

          // Soft-delete happened first; the run never hard-deleted / audited
          // (unless the failing step itself is hard-delete, in which case
          // hard-delete was attempted but the metadata record remains).
          expect(order1[0]).toBe('soft-delete');
          expect(mockedRecordAuditLog).not.toHaveBeenCalled();

          // --- Invocation 2: record is now PENDING; steps succeed. ---
          mockedGetModel.mockResolvedValue(
            baseModel({ deletionStatus: 'PENDING' })
          );

          const order2: string[] = [];
          let describeCalled = false;
          let listCalled = false;
          mockedSetDeletionStatus.mockImplementation(async () => {
            order2.push('soft-delete');
          });
          mockedHardDelete.mockImplementation(async () => {
            order2.push('hard-delete');
          });
          mockTranscribeSendLocal.mockImplementation(async (command: any) => {
            const name = command?.constructor?.name as string;
            if (name === 'DescribeLanguageModelCommand') {
              describeCalled = true;
              return { LanguageModel: { ModelStatus: 'COMPLETED' } };
            }
            if (name === 'ListTranscriptionJobsCommand') {
              listCalled = true;
              return { TranscriptionJobSummaries: [] };
            }
            if (name === 'DeleteLanguageModelCommand') {
              order2.push('transcribe-delete');
              return {};
            }
            return {};
          });
          mockS3SendLocal.mockImplementation(async () => {
            order2.push('s3-delete');
            return {};
          });
          mockedRecordAuditLog.mockClear();

          await deleteModel(adminActor, 'model-del');

          // A PENDING resume skips the eligibility gates entirely.
          expect(describeCalled).toBe(false);
          expect(listCalled).toBe(false);

          // Nothing ran before the (idempotent) soft-delete on resume.
          expect(order2[0]).toBe('soft-delete');
          const milestones2 = order2.filter(
            (step, idx) => order2.indexOf(step) === idx
          );
          expect(milestones2).toEqual([
            'soft-delete',
            'transcribe-delete',
            's3-delete',
            'hard-delete',
          ]);

          // Converged to hard-deleted with a success audit.
          expect(mockedHardDelete).toHaveBeenCalledWith('model-del');
          expect(mockedRecordAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ operationType: 'LANGUAGE_MODEL_DELETED' })
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
