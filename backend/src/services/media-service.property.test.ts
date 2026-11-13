import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { MediaFile, ScanStatus } from '../types/media-file.js';
import { MEDIA_FILE_KEYS, MEDIA_FILE_ENTITY_TYPE } from '../types/media-file.js';
import { TRANSCRIPTION_JOB_KEYS } from '../types/transcription-job.js';

process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
process.env.AWS_REGION = 'ap-northeast-1';

// ----------------------------------------------------------------------------
// In-memory DynamoDB table backing docClient.
//
// The real repositories (media-file-repository / session-repository /
// transcription-job-repository) READ and WRITE items here. Using the real data
// model — rather than stubbed return values — lets the media-link bug and its
// fallback-compensation fix be exercised end to end:
//
//   getMediaFileForSession(sessionId)
//     → media-file-repository.getBySessionId(sessionId)            [Scan on sessionId]
//     → (FIX fallback) session-repository.getSessionById(sessionId) [transcriptionJobId]
//     → transcription-job-repository.getById(jobId)                [mediaFileId]
//     → media-file-repository.getById(mediaFileId)                 [MediaFile]
//     → media-file-repository.updateSessionId(mediaFileId, sessionId) [self-heal]
//
// The UNFIXED code only calls getBySessionId; when the MediaFile has no
// sessionId attribute (the bug condition isBugCondition_mediaLink), the Scan
// returns null and getMediaFileForSession throws MEDIA_FILE_NOT_FOUND (404).
// This store is wired so the fallback CAN resolve the MediaFile (session → job →
// mediaFileId all present), so the exploration test is a valid fix-checker:
// it FAILS on the unfixed code and PASSES once the fallback compensation lands.
// ----------------------------------------------------------------------------

interface TableItem extends Record<string, unknown> {
  PK: string;
  SK: string;
}

const store = new Map<string, TableItem>();

function keyOf(pk: string, sk: string): string {
  return `${pk}\u0000${sk}`;
}

function resolveValue(expr: string, values: Record<string, unknown>): unknown {
  return values[expr];
}

/**
 * Minimal DynamoDB engine supporting exactly the command shapes the functions
 * under test use: PutCommand, GetCommand, UpdateCommand (SET of named attrs),
 * ScanCommand with a FilterExpression on entityType (+ optional sessionId / SK),
 * and QueryCommand on GSI1/GSI2 with begins_with.
 */
async function fakeSend(command: unknown): Promise<unknown> {
  if (command instanceof PutCommand) {
    const item = command.input.Item as TableItem;
    store.set(keyOf(item.PK, item.SK), item);
    return {};
  }

  if (command instanceof GetCommand) {
    const key = command.input.Key as { PK: string; SK: string };
    return { Item: store.get(keyOf(key.PK, key.SK)) };
  }

  if (command instanceof UpdateCommand) {
    const key = command.input.Key as { PK: string; SK: string };
    const existing = store.get(keyOf(key.PK, key.SK));
    if (!existing) {
      // DynamoDB UpdateCommand upserts, but the code only updates existing items.
      return {};
    }
    const values = (command.input.ExpressionAttributeValues ?? {}) as Record<
      string,
      unknown
    >;
    const names = (command.input.ExpressionAttributeNames ?? {}) as Record<
      string,
      string
    >;
    const updateExpr = command.input.UpdateExpression ?? '';
    // Parse "SET a = :x, #b = :y" assignments.
    const setMatch = updateExpr.replace(/^SET\s+/i, '');
    for (const assignment of setMatch.split(',')) {
      const [lhsRaw, rhsRaw] = assignment.split('=');
      if (!lhsRaw || !rhsRaw) {
        continue;
      }
      const lhs = lhsRaw.trim();
      const rhs = rhsRaw.trim();
      const attrName = lhs.startsWith('#') ? names[lhs] ?? lhs : lhs;
      existing[attrName] = values[rhs];
    }
    store.set(keyOf(key.PK, key.SK), existing);
    return {};
  }

  if (command instanceof ScanCommand) {
    const input = command.input;
    const filterExpr = input.FilterExpression ?? '';
    const values = (input.ExpressionAttributeValues ?? {}) as Record<
      string,
      unknown
    >;

    const wantEntityMatch = filterExpr.match(
      /entityType\s*=\s*(:[A-Za-z0-9_]+)/
    );
    const wantEntity = wantEntityMatch
      ? resolveValue(wantEntityMatch[1], values)
      : undefined;

    const wantSessionMatch = filterExpr.match(
      /sessionId\s*=\s*(:[A-Za-z0-9_]+)/
    );
    const wantSession = wantSessionMatch
      ? resolveValue(wantSessionMatch[1], values)
      : undefined;

    const wantSkMatch = filterExpr.match(/SK\s*=\s*(:[A-Za-z0-9_]+)/);
    const wantSk = wantSkMatch
      ? resolveValue(wantSkMatch[1], values)
      : undefined;

    const items: TableItem[] = [];
    for (const item of store.values()) {
      if (wantEntity !== undefined && item['entityType'] !== wantEntity) {
        continue;
      }
      if (wantSession !== undefined && item['sessionId'] !== wantSession) {
        continue;
      }
      if (wantSk !== undefined && item['SK'] !== wantSk) {
        continue;
      }
      items.push(item);
    }
    return { Items: items };
  }

  if (command instanceof QueryCommand) {
    const input = command.input;
    const keyExpr = input.KeyConditionExpression ?? '';
    const values = (input.ExpressionAttributeValues ?? {}) as Record<
      string,
      unknown
    >;
    const indexName = input.IndexName;
    const pkAttr = indexName ? `${indexName}PK` : 'PK';
    const skAttr = indexName ? `${indexName}SK` : 'SK';

    const pkMatch = keyExpr.match(/=\s*(:[A-Za-z0-9_]+)/);
    const pkValue = pkMatch ? resolveValue(pkMatch[1], values) : undefined;

    const beginsMatch = keyExpr.match(
      /begins_with\([^,]+,\s*(:[A-Za-z0-9_]+)\)/
    );
    const prefix = beginsMatch
      ? (resolveValue(beginsMatch[1], values) as string)
      : undefined;

    const items: TableItem[] = [];
    for (const item of store.values()) {
      if (item[pkAttr] !== pkValue) {
        continue;
      }
      const skVal = item[skAttr] as string | undefined;
      if (prefix !== undefined && (skVal === undefined || !skVal.startsWith(prefix))) {
        continue;
      }
      items.push(item);
    }
    return { Items: items };
  }

  throw new Error(
    `fakeSend: unsupported command ${
      (command as { constructor?: { name?: string } })?.constructor?.name ??
      'unknown'
    }`
  );
}

vi.mock('../utils/dynamodb-client.js', () => ({
  docClient: { send: (command: unknown) => fakeSend(command) },
  TABLE_NAME: 'TestTable',
}));

// S3 pre-signed URL generator (host: s3.<region>.amazonaws.com) so playback stays
// within the co-host CloudFront distribution's CSP (media-src https://*.amazonaws.com).
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (
      _client: unknown,
      command: { input: { Bucket: string; Key: string } }
    ) =>
      `https://s3.ap-northeast-1.amazonaws.com/${command.input.Bucket}/${command.input.Key}?X-Amz-Signature=abc&X-Amz-Expires=300`
  ),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { getMediaUrl, getMediaFileForSession } from './media-service.js';
import {
  handler as processJobCompleteHandler,
  setS3Client as setProcessJobCompleteS3Client,
  type TranscribeJobEvent,
  type TranscribeOutput,
} from '../handlers/process-job-complete.js';

// ----------------------------------------------------------------------------
// Store seeding helpers (real DynamoDB item layouts).
// ----------------------------------------------------------------------------

/**
 * Seed a MediaFile item. When `sessionId` is omitted, the item has NO sessionId
 * attribute — exactly the media-link bug condition where getBySessionId cannot
 * find it via its sessionId scan.
 */
function seedMediaFile(input: {
  mediaFileId: string;
  s3Key: string;
  scanStatus?: ScanStatus;
  sessionId?: string;
  teamId?: string;
  uploadedBy: string;
}): void {
  const now = '2024-01-01T00:00:00.000Z';
  const item: TableItem = {
    PK: MEDIA_FILE_KEYS.pk(input.mediaFileId),
    SK: MEDIA_FILE_KEYS.sk,
    entityType: MEDIA_FILE_ENTITY_TYPE,
    mediaFileId: input.mediaFileId,
    filename: 'audio.mp3',
    s3Key: input.s3Key,
    contentType: 'audio/mpeg',
    fileSize: 1024,
    uploadedBy: input.uploadedBy,
    teamId: input.teamId,
    status: 'COMPLETED',
    scanStatus: input.scanStatus,
    createdAt: now,
    updatedAt: now,
  };
  if (input.sessionId !== undefined) {
    item['sessionId'] = input.sessionId;
  }
  store.set(keyOf(item.PK, item.SK), item);
}

/** Seed a TranscriptionJob item linking a jobId to a mediaFileId. */
function seedJob(input: {
  jobId: string;
  mediaFileId: string;
  sessionId?: string;
}): void {
  const now = '2024-01-01T00:00:00.000Z';
  store.set(
    keyOf(TRANSCRIPTION_JOB_KEYS.pk(input.jobId), TRANSCRIPTION_JOB_KEYS.sk),
    {
      PK: TRANSCRIPTION_JOB_KEYS.pk(input.jobId),
      SK: TRANSCRIPTION_JOB_KEYS.sk,
      GSI1PK: TRANSCRIPTION_JOB_KEYS.gsi1pk(input.mediaFileId),
      GSI1SK: TRANSCRIPTION_JOB_KEYS.gsi1sk(now, input.jobId),
      GSI2PK: TRANSCRIPTION_JOB_KEYS.gsi2pk(`tr-${input.jobId}`),
      GSI2SK: TRANSCRIPTION_JOB_KEYS.gsi2sk(now),
      entityType: 'TranscriptionJob',
      jobId: input.jobId,
      transcribeJobName: `tr-${input.jobId}`,
      mediaFileId: input.mediaFileId,
      status: 'COMPLETED',
      languageCode: 'ja-JP',
      maxSpeakerLabels: 2,
      outputS3Key: `transcriptions/${input.jobId}/output.json`,
      sessionId: input.sessionId,
      startedBy: 'uploader',
      createdAt: now,
      updatedAt: now,
    }
  );
}

/**
 * Seed a ReviewSession item (METADATA) carrying the transcriptionJobId link the
 * fallback walks from. Mirrors session-repository.createSession's item layout.
 */
function seedSession(input: {
  sessionId: string;
  transcriptionJobId: string;
  teamId?: string;
  assignedUserId?: string;
}): void {
  const now = '2024-01-01T00:00:00.000Z';
  const item: TableItem = {
    PK: `SESSION#${input.sessionId}`,
    SK: 'METADATA',
    entityType: 'ReviewSession',
    sessionId: input.sessionId,
    transcriptionJobId: input.transcriptionJobId,
    name: 'Session',
    status: 'PENDING',
    assignedReviewerCount: input.assignedUserId ? 1 : 0,
    consensusThreshold: 67,
    createdAt: now,
    updatedAt: now,
  };
  if (input.teamId) {
    item['assignedTeamId'] = input.teamId;
    item['GSI1PK'] = `TEAM#${input.teamId}`;
    item['GSI1SK'] = `SESSION#${now}#${input.sessionId}`;
  }
  store.set(keyOf(item.PK, item.SK), item);
}

/** True when a MediaFile item is resolvable by its sessionId scan. */
function mediaFileResolvableBySessionId(sessionId: string): boolean {
  for (const item of store.values()) {
    if (
      item['entityType'] === MEDIA_FILE_ENTITY_TYPE &&
      item['sessionId'] === sessionId
    ) {
      return true;
    }
  }
  return false;
}

// Arbitrary for the uploader role. The media-link defect is role-independent:
// the empty catch in startJob drops the link regardless of who uploaded.
const roleArb = fc.constantFrom<'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'>(
  'REVIEWER',
  'TEAM_LEADER',
  'ADMIN'
);

// ----------------------------------------------------------------------------
// Property 3: Bug Condition — media link missing -> media resolves (post-fix).
// ----------------------------------------------------------------------------

describe('Feature: reviewer-uploaded-session-not-visible, Property 3: メディアリンクの欠落（メディアが解決できる）', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.4, 2.5, 2.6**
   *
   * Bug condition isBugCondition_mediaLink(X): an upload-derived session
   * (generatedFromUpload=true) for which getMediaFileBySessionId(sessionId) is
   * null — the sessionId link on the MediaFile was lost (startJob's empty catch
   * swallowed the updateSessionId failure).
   *
   * For every such input the session, its TranscriptionJob, and the MediaFile
   * all exist and are reachable via session.transcriptionJobId -> job.mediaFileId
   * -> MediaFile; only the direct MediaFile.sessionId attribute is missing. The
   * defect is role-independent, so the uploader role is drawn from all three of
   * REVIEWER / TEAM_LEADER / ADMIN.
   *
   * This test ENCODES the expected (post-fix) behaviour and must FAIL on the
   * unfixed code (the failure proves the bug): the unfixed getMediaFileForSession
   * only calls getBySessionId, which returns null, so it throws
   * MEDIA_FILE_NOT_FOUND (404). After the adopted fix (approach D) the fallback
   * resolves the MediaFile via session -> job -> mediaFileId, compensates the
   * link via updateSessionId, and (for scanStatus CLEAN) returns a signed URL.
   */
  it('リンク欠落のアップロード由来セッションでもメディアが解決され、CLEAN なら署名付き URL を返す（REVIEWER / TEAM_LEADER / ADMIN、ロール非依存）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sessionId: fc.string({ minLength: 1, maxLength: 12 }),
          jobId: fc.string({ minLength: 1, maxLength: 12 }),
          mediaFileId: fc.string({ minLength: 1, maxLength: 12 }),
          uploaderUserId: fc.string({ minLength: 1, maxLength: 12 }),
          role: roleArb,
          // scanStatus of the (resolved) MediaFile. CLEAN -> signed URL,
          // PENDING/undefined -> 403 pending, INFECTED -> 403 malware.
          scanStatus: fc.constantFrom<ScanStatus | undefined>(
            'CLEAN',
            'PENDING',
            'INFECTED',
            undefined
          ),
          teamId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
            nil: undefined,
          }),
        }),
        async ({
          sessionId,
          jobId,
          mediaFileId,
          uploaderUserId,
          scanStatus,
          teamId,
        }) => {
          store.clear();

          // Media-link bug condition: the MediaFile exists but has NO sessionId
          // attribute, so getBySessionId(sessionId) returns null. The session
          // and job exist so the fallback can walk session -> job -> mediaFileId.
          const s3Key = `media/${mediaFileId}/audio.mp3`;
          seedMediaFile({
            mediaFileId,
            s3Key,
            scanStatus,
            uploadedBy: uploaderUserId,
            teamId: teamId ?? undefined,
            // sessionId intentionally omitted (the dropped link).
          });
          seedJob({ jobId, mediaFileId });
          seedSession({
            sessionId,
            transcriptionJobId: jobId,
            teamId: teamId ?? undefined,
            assignedUserId: uploaderUserId,
          });

          // Precondition: the bug condition holds (link is absent).
          expect(mediaFileResolvableBySessionId(sessionId)).toBe(false);

          if (scanStatus === 'CLEAN') {
            // Expected (post-fix): fallback resolves + compensates, CLEAN -> URL.
            const result = await getMediaUrl(sessionId);
            expect(result.data.url).toContain('amazonaws.com');
            expect(result.data.url).toContain(s3Key);
            expect(result.data.expiresAt).toBeDefined();
            // The link must have been compensated (self-heal) so a later
            // getBySessionId succeeds — no longer MEDIA_FILE_NOT_FOUND.
            expect(mediaFileResolvableBySessionId(sessionId)).toBe(true);
          } else if (scanStatus === 'INFECTED') {
            // scanStatus check applies to the resolved MediaFile: 403 malware
            // (NOT 404 MEDIA_FILE_NOT_FOUND).
            await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject(
              {
                statusCode: 403,
                errorCode: 'MEDIA_MALWARE_DETECTED',
              }
            );
          } else {
            // PENDING or undefined -> 403 scan pending (NOT 404).
            await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject(
              {
                statusCode: 403,
                errorCode: 'MEDIA_SCAN_PENDING',
              }
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 2.5, 2.6**
   *
   * Admin late-assignment edge (bugfix 1.6 / 2.6): even after an Admin adds a
   * TeamAssignment to the session, the MediaFile.sessionId link stays null, so
   * getBySessionId still returns null. The adopted fallback compensation (fix)
   * must still resolve the media (session -> job -> mediaFileId) and return a
   * signed URL for a CLEAN file. On the unfixed code this still throws
   * MEDIA_FILE_NOT_FOUND (404), so the single-case assertion FAILS pre-fix.
   */
  it('Admin 後付け割り当て（TeamAssignment 追加後も getBySessionId は null）でもフォールバックでメディア取得が成功する', async () => {
    store.clear();

    const sessionId = 'sess-admin-edge';
    const jobId = 'job-admin-edge';
    const mediaFileId = 'media-admin-edge';
    const teamId = 'team-x';
    const s3Key = `media/${mediaFileId}/audio.mp3`;

    // Link-missing MediaFile (CLEAN), job, and session.
    seedMediaFile({
      mediaFileId,
      s3Key,
      scanStatus: 'CLEAN',
      uploadedBy: 'uploader-admin',
      teamId,
    });
    seedJob({ jobId, mediaFileId });
    seedSession({
      sessionId,
      transcriptionJobId: jobId,
      teamId,
      assignedUserId: 'uploader-admin',
    });

    // Admin's later assignment adds a TeamAssignment item; it does NOT set the
    // MediaFile.sessionId link, so the media-link bug condition persists.
    store.set(keyOf(`TEAM#${teamId}`, `ASSIGNMENT#${sessionId}`), {
      PK: `TEAM#${teamId}`,
      SK: `ASSIGNMENT#${sessionId}`,
      entityType: 'TeamAssignment',
      teamId,
      sessionId,
      createdBy: 'admin-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    });

    // Bug condition still holds after the assignment.
    expect(mediaFileResolvableBySessionId(sessionId)).toBe(false);

    // Expected (post-fix): media resolves via fallback and a URL is returned.
    const result = await getMediaUrl(sessionId);
    expect(result.data.url).toContain('amazonaws.com');
    expect(result.data.url).toContain(s3Key);
    expect(mediaFileResolvableBySessionId(sessionId)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Property 47 (preserved): scan-status gating on a correctly linked MediaFile.
//
// These exercise getMediaFileForSession / getMediaUrl on the NON-bug path
// (MediaFile already linked via its sessionId attribute, so getBySessionId
// resolves it directly without the fallback). Kept here so the existing scan
// gating coverage is retained under the in-memory data model.
// ----------------------------------------------------------------------------

describe('Feature: media-service, Property 47: スキャン前ファイルアクセスの拒否', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is PENDING, the system refuses to generate signed media URLs
   * by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が PENDING のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sessionId, mediaFileId) => {
          store.clear();
          seedMediaFile({
            mediaFileId,
            s3Key: `media/${mediaFileId}/audio.mp3`,
            scanStatus: 'PENDING',
            sessionId,
            uploadedBy: 'user-1',
          });

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is undefined (treated as PENDING), the system refuses to
   * generate signed media URLs by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が undefined のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sessionId, mediaFileId) => {
          store.clear();
          seedMediaFile({
            mediaFileId,
            s3Key: `media/${mediaFileId}/audio.mp3`,
            scanStatus: undefined,
            sessionId,
            uploadedBy: 'user-1',
          });

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is CLEAN, the system allows URL generation and returns
   * a valid S3 pre-signed URL (amazonaws.com host) with an expiration time.
   */
  it('scanStatus が CLEAN のとき Signed URL 生成を許可する', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sessionId, mediaFileId) => {
          store.clear();
          const s3Key = `media/${mediaFileId}/audio.mp3`;
          seedMediaFile({
            mediaFileId,
            s3Key,
            scanStatus: 'CLEAN',
            sessionId,
            uploadedBy: 'user-1',
          });

          const result = await getMediaUrl(sessionId);

          // Host must be *.amazonaws.com to satisfy the co-host CloudFront CSP.
          expect(result.data.url).toContain('amazonaws.com');
          expect(result.data.url).toContain(s3Key);
          expect(result.data.expiresAt).toBeDefined();
          const expiresAt = new Date(result.data.expiresAt).getTime();
          expect(expiresAt).toBeGreaterThan(Date.now());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.24**
   * When scanStatus is INFECTED, the system refuses to generate signed media URLs
   * by throwing a 403 FORBIDDEN error.
   */
  it('scanStatus が INFECTED のとき Signed URL 生成を拒否する', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sessionId, mediaFileId) => {
          store.clear();
          seedMediaFile({
            mediaFileId,
            s3Key: `media/${mediaFileId}/audio.mp3`,
            scanStatus: 'INFECTED',
            sessionId,
            uploadedBy: 'user-1',
          });

          await expect(getMediaFileForSession(sessionId)).rejects.toMatchObject({
            statusCode: 403,
            code: 'FORBIDDEN',
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------------------
// Property 4: Preservation — linked MediaFile + scanStatus gating is invariant.
//
// Observation-first: on the NON-bug path (isBugCondition_mediaLink is false,
// i.e. the MediaFile is already linked via its sessionId attribute so
// getBySessionId resolves it directly), the observed baseline behaviour of
// getMediaFileForSession / getMediaUrl is:
//   - scanStatus=CLEAN    -> signed URL + expiresAt (NO fallback used)       (bugfix 3.4)
//   - scanStatus=PENDING  -> 403 MEDIA_SCAN_PENDING                           (bugfix 3.5)
//   - scanStatus=INFECTED -> 403 MEDIA_MALWARE_DETECTED                       (bugfix 3.5)
//   - scanStatus=undefined-> 403 MEDIA_SCAN_PENDING (treated as PENDING)      (bugfix 3.5)
//
// This locks that baseline. It PASSES on the unfixed code and must keep PASSING
// after the fix: the adopted fallback (approach D) only runs when getBySessionId
// returns null, so the linked path here is never touched by the change.
// ----------------------------------------------------------------------------

describe('Feature: reviewer-uploaded-session-not-visible, Property 4: メディア取得・スキャン状態チェックの不変', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.4, 3.5, 3.7**
   *
   * Preservation on the non-bug media path: for a MediaFile that IS correctly
   * linked to the session (its sessionId attribute is set, so getBySessionId
   * resolves it and isBugCondition_mediaLink is false), the result is fully
   * determined by scanStatus and does not use the fallback:
   *   CLEAN    -> getMediaUrl returns a signed amazonaws.com URL with a future
   *               expiresAt (bugfix 3.4);
   *   PENDING  -> getMediaFileForSession throws 403 MEDIA_SCAN_PENDING;
   *   INFECTED -> throws 403 MEDIA_MALWARE_DETECTED;
   *   undefined-> treated as PENDING -> 403 MEDIA_SCAN_PENDING (bugfix 3.5).
   *
   * No session/job records are seeded, so the only way to resolve the MediaFile
   * is the direct getBySessionId lookup — proving the fallback is not relied on.
   * Observed on the unfixed code; must stay identical after the fix.
   */
  it('リンク済み MediaFile の scanStatus 分岐（CLEAN→URL+expiresAt / PENDING / INFECTED / undefined→403）が不変（フォールバック不使用）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sessionId: fc.string({ minLength: 1, maxLength: 12 }),
          mediaFileId: fc.string({ minLength: 1, maxLength: 12 }),
          uploaderUserId: fc.string({ minLength: 1, maxLength: 12 }),
          scanStatus: fc.constantFrom<ScanStatus | undefined>(
            'CLEAN',
            'PENDING',
            'INFECTED',
            undefined
          ),
          teamId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
            nil: undefined,
          }),
        }),
        async ({ sessionId, mediaFileId, uploaderUserId, scanStatus, teamId }) => {
          store.clear();

          const s3Key = `media/${mediaFileId}/audio.mp3`;
          // Non-bug path: the MediaFile carries its sessionId attribute, so
          // getBySessionId resolves it directly (no session/job seeded).
          seedMediaFile({
            mediaFileId,
            s3Key,
            scanStatus,
            sessionId,
            uploadedBy: uploaderUserId,
            teamId: teamId ?? undefined,
          });

          // Precondition: NOT isBugCondition_mediaLink — media is resolvable by
          // its sessionId directly.
          expect(mediaFileResolvableBySessionId(sessionId)).toBe(true);

          if (scanStatus === 'CLEAN') {
            const result = await getMediaUrl(sessionId);
            expect(result.data.url).toContain('amazonaws.com');
            expect(result.data.url).toContain(s3Key);
            expect(result.data.expiresAt).toBeDefined();
            expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(
              Date.now()
            );
          } else if (scanStatus === 'INFECTED') {
            await expect(
              getMediaFileForSession(sessionId)
            ).rejects.toMatchObject({
              statusCode: 403,
              code: 'FORBIDDEN',
              errorCode: 'MEDIA_MALWARE_DETECTED',
            });
          } else {
            // PENDING or undefined -> scan pending.
            await expect(
              getMediaFileForSession(sessionId)
            ).rejects.toMatchObject({
              statusCode: 403,
              code: 'FORBIDDEN',
              errorCode: 'MEDIA_SCAN_PENDING',
            });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------------------
// Property 5: Preservation — process-job-complete reuses the session created by
// startJob when job.sessionId is set, and does NOT mint a duplicate empty
// session (SK=METADATA). (bugfix 3.7)
//
// The handler reads the Transcribe output from S3; we inject a fake S3 client
// (via the handler's setS3Client) returning a minimal valid output so the
// COMPLETED path runs. The in-memory DynamoDB mock (docClient) backs all
// reads/writes, so we can assert exactly how many ReviewSession METADATA items
// exist for the reused sessionId before and after processing.
// ----------------------------------------------------------------------------

/** Minimal valid Amazon Transcribe output JSON with one speaker segment. */
function minimalTranscribeOutput(): TranscribeOutput {
  return {
    results: {
      transcripts: [{ transcript: 'hello' }],
      speaker_labels: {
        speakers: 1,
        segments: [
          {
            start_time: '0.000',
            end_time: '1.000',
            speaker_label: 'spk_0',
            items: [
              { start_time: '0.000', end_time: '1.000', speaker_label: 'spk_0' },
            ],
          },
        ],
      },
      items: [
        {
          start_time: '0.000',
          end_time: '1.000',
          type: 'pronunciation',
          alternatives: [{ confidence: '0.99', content: 'hello' }],
        },
      ],
    },
  };
}

/** Count ReviewSession METADATA items in the store for a given sessionId. */
function countSessionMetadata(sessionId: string): number {
  let count = 0;
  for (const item of store.values()) {
    if (
      item['entityType'] === 'ReviewSession' &&
      item['SK'] === 'METADATA' &&
      item['sessionId'] === sessionId
    ) {
      count += 1;
    }
  }
  return count;
}

describe('Feature: reviewer-uploaded-session-not-visible, Property 5: process-job-complete のセッション再利用', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    process.env.DATA_BUCKET_NAME = 'test-data-bucket';
    // Inject a fake S3 client returning a minimal Transcribe output so the
    // COMPLETED branch of the handler runs deterministically.
    setProcessJobCompleteS3Client({
      send: async () => ({
        Body: {
          transformToString: async () =>
            JSON.stringify(minimalTranscribeOutput()),
        },
      }),
    } as never);
  });

  /**
   * **Validates: Requirements 3.4, 3.5, 3.7**
   *
   * Preservation: when startJob already created a session and recorded it on
   * the job (job.sessionId set, job still IN_PROGRESS), process-job-complete
   * SHALL reuse that existing session and NOT create a duplicate empty session.
   *
   * We seed the pre-existing ReviewSession METADATA (as startJob/createSession
   * would) and an IN_PROGRESS job whose sessionId points at it, then run the
   * handler for a COMPLETED Transcribe event. Afterwards exactly one
   * ReviewSession METADATA item must exist for that sessionId (reused, not
   * duplicated), and the job's sessionId must be unchanged.
   */
  it('job.sessionId 設定済みの job を処理しても既存セッションを再利用し、重複した空セッション（SK=METADATA）を作らない', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sessionId: fc.string({ minLength: 1, maxLength: 12 }),
          jobId: fc.string({ minLength: 1, maxLength: 12 }),
          mediaFileId: fc.string({ minLength: 1, maxLength: 12 }),
          transcribeJobName: fc.string({ minLength: 1, maxLength: 16 }),
          uploaderUserId: fc.string({ minLength: 1, maxLength: 12 }),
        }),
        async ({
          sessionId,
          jobId,
          mediaFileId,
          transcribeJobName,
          uploaderUserId,
        }) => {
          store.clear();

          // The session startJob already created + linked at job start.
          seedSession({
            sessionId,
            transcriptionJobId: jobId,
            assignedUserId: uploaderUserId,
          });
          // IN_PROGRESS job carrying the existing sessionId (set by startJob).
          seedJob({ jobId, mediaFileId, sessionId });
          // Mark the job IN_PROGRESS and give it a Transcribe job name + output
          // key so the handler resolves it and runs the COMPLETED branch.
          const jobKey = keyOf(
            TRANSCRIPTION_JOB_KEYS.pk(jobId),
            TRANSCRIPTION_JOB_KEYS.sk
          );
          const jobItem = store.get(jobKey)!;
          jobItem['status'] = 'IN_PROGRESS';
          jobItem['transcribeJobName'] = transcribeJobName;
          jobItem['GSI2PK'] = TRANSCRIPTION_JOB_KEYS.gsi2pk(transcribeJobName);
          jobItem['GSI2SK'] = TRANSCRIPTION_JOB_KEYS.gsi2sk(
            '2024-01-01T00:00:00.000Z'
          );
          jobItem['outputS3Key'] = `transcriptions/${jobId}/output.json`;
          store.set(jobKey, jobItem);
          // The MediaFile the job points at (so status updates succeed).
          seedMediaFile({
            mediaFileId,
            s3Key: `media/${mediaFileId}/audio.mp3`,
            scanStatus: 'CLEAN',
            sessionId,
            uploadedBy: uploaderUserId,
          });

          // Baseline: exactly one session METADATA exists pre-processing.
          expect(countSessionMetadata(sessionId)).toBe(1);

          const event: TranscribeJobEvent = {
            source: 'aws.transcribe',
            'detail-type': 'Transcribe Job State Change',
            detail: {
              TranscriptionJobName: transcribeJobName,
              TranscriptionJobStatus: 'COMPLETED',
            },
          };

          await processJobCompleteHandler(event);

          // Preserved behaviour: the existing session is reused — still exactly
          // one METADATA item (no duplicate empty session minted).
          expect(countSessionMetadata(sessionId)).toBe(1);
          // The job's sessionId is unchanged (the same session is reused).
          const updatedJob = store.get(jobKey)!;
          expect(updatedJob['sessionId']).toBe(sessionId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
