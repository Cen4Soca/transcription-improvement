/**
 * アップロード生成経路の統合テスト（LocalStack）
 *
 * テスト内容:
 * - transcription-job-service.startJob が実際の生成経路（モックせず）で
 *   createSessionForJob -> ReviewAssignment 生成 -> MediaFile.sessionId リンク
 *   までを実行することを LocalStack の実テーブルに対して検証する。
 * - 既存の 4 層テスト（media-upload E2E / session-list・review-page E2E /
 *   本 spec の可視性 E2E / backend 単体・プロパティ）はいずれも生成経路を
 *   モック or seed で肩代わりしており、本バグを「生成時点」で捕捉できなかった。
 *   本テストはその盲点を埋め、生成経路の退行を検出する。
 *
 * 検証方針:
 * - Transcribe クライアントは setTranscribeClient でモックする（実ジョブは起動しない）。
 * - createSessionForJob / session-repository / team-repository.createReviewAssignment /
 *   media-file-repository の DynamoDB 書き込みは LocalStack の実テーブルに対して行う
 *   （モックしない）。shared docClient は vi.mock で LocalStack に向ける。
 *
 * アサーション（startJob 実行後）:
 *   1. ReviewAssignment（PK=USER#{uploaderId}, SK=ASSIGNMENT#{sessionId}）が
 *      実テーブルに作られ、getAccessibleSessionIds(uploader) が当該 sessionId を含む
 *      （ADMIN は null=全件を返す切り分けを明示）。
 *   2. MediaFile の sessionId が張られ、getBySessionId(sessionId) で解決できる。
 *
 * ロール網羅: uploader role を REVIEWER / TEAM_LEADER / ADMIN で網羅する
 * （TEAM_LEADER は teamId 設定済みケースも含む）。
 *
 * 前提条件:
 * - LocalStack が起動していること (http://localhost:4566)
 * - 環境変数 INTEGRATION_TEST=true が設定されていること
 *   LocalStack 未起動 / INTEGRATION_TEST 未設定時は describe.skip で収集のみ。
 *
 * 実行方法:
 * cd backend && INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts reviewer-uploaded-session
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import type { S3Client } from '@aws-sdk/client-s3';

const ENDPOINT = 'http://localhost:4566';
const REGION = 'ap-northeast-1';
const TABLE_NAME = 'TranscriptionReviewApp';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };

// Point the shared docClient (used by every service/repository under test) at
// LocalStack. The production utils/dynamodb-client.ts only configures a region,
// so without this the real DynamoDB writes would target AWS, not LocalStack.
// The mock factory is hoisted to the top of the file, so it cannot reference
// the module-level constants above — the literals are inlined here instead.
vi.mock('../../utils/dynamodb-client.js', () => {
  const ddb = new DynamoDBClient({
    region: 'ap-northeast-1',
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    docClient: doc,
    TABLE_NAME: 'TranscriptionReviewApp',
  };
});

// Imports below resolve the mocked docClient. ESM .js extensions per project rules.
import { startJob, setTranscribeClient } from '../../services/transcription-job-service.js';
import { getAccessibleSessionIds } from '../../services/access-control-service.js';
import * as mediaFileRepository from '../../repositories/media-file-repository.js';
import * as transcriptionJobRepository from '../../repositories/transcription-job-repository.js';
import {
  handler as processJobComplete,
  setS3Client,
  type TranscribeJobEvent,
  type TranscribeOutput,
} from '../../handlers/process-job-complete.js';
import type { MediaFile } from '../../types/media-file.js';
import type { AuthUser, UserRole } from '../../utils/auth-middleware.js';

const SHOULD_RUN = process.env.INTEGRATION_TEST === 'true';

const describeIntegration = SHOULD_RUN ? describe : describe.skip;

describeIntegration('アップロード生成経路（startJob -> ReviewAssignment / MediaFile リンク）', () => {
  let ddbClient: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;

  beforeAll(async () => {
    ddbClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
    });

    docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    // Same key schema as dynamodb-crud.integration.test.ts: PK/SK + GSI1 + GSI2.
    await ddbClient.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      })
    );

    // Buckets are only needed so startJob passes its configuration check; the
    // Transcribe call is stubbed so no real S3/Transcribe access occurs.
    process.env['MEDIA_BUCKET_NAME'] = 'test-media-bucket';
    process.env['DATA_BUCKET_NAME'] = 'test-data-bucket';

    // Stub Transcribe so StartTranscriptionJobCommand "succeeds" without a real job.
    const transcribeStub = {
      send: async () => ({ TranscriptionJob: { TranscriptionJobName: 'tr-stub' } }),
    } as unknown as TranscribeClient;
    setTranscribeClient(transcribeStub);
  });

  afterAll(async () => {
    await ddbClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
    ddbClient.destroy();
  });

  /**
   * Seed a CLEAN, uploaded MediaFile owned by the uploader into the real table.
   * teamId is set only when provided (REVIEWER uploads typically have none).
   */
  async function seedMediaFile(params: {
    mediaFileId: string;
    uploaderId: string;
    teamId?: string;
  }): Promise<MediaFile> {
    const now = new Date().toISOString();
    const record: MediaFile = {
      mediaFileId: params.mediaFileId,
      filename: 'audio.mp3',
      s3Key: `media/${params.mediaFileId}/audio.mp3`,
      contentType: 'audio/mpeg',
      fileSize: 1024,
      uploadedBy: params.uploaderId,
      teamId: params.teamId,
      status: 'UPLOADED',
      scanStatus: 'CLEAN',
      createdAt: now,
      updatedAt: now,
    };
    await mediaFileRepository.save(record);
    return record;
  }

  function makeUser(userId: string, role: UserRole): AuthUser {
    return {
      userId,
      email: `${userId}@example.com`,
      displayName: userId,
      role,
    };
  }

  /**
   * Shared assertions for the generation path. Runs startJob through the real
   * createSessionForJob / repositories (LocalStack) and verifies both defects
   * are closed at generation time.
   */
  async function runGenerationPathAssertions(params: {
    uploaderId: string;
    role: UserRole;
    teamId?: string;
  }): Promise<void> {
    const mediaFileId = `media-${params.uploaderId}`;
    await seedMediaFile({
      mediaFileId,
      uploaderId: params.uploaderId,
      teamId: params.teamId,
    });

    const uploader = makeUser(params.uploaderId, params.role);

    // Real generation path: startJob -> createSessionForJob -> createSession +
    // createReviewAssignment -> updateSessionId. Only Transcribe is stubbed.
    const job = await startJob({ mediaFileId, user: uploader });

    expect(job.sessionId).toBeDefined();
    const sessionId = job.sessionId!;

    // --- Assertion 1: ReviewAssignment created + visibility via getAccessibleSessionIds ---
    const assignment = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${params.uploaderId}`, SK: `ASSIGNMENT#${sessionId}` },
      })
    );
    expect(assignment.Item).toBeDefined();
    expect(assignment.Item!['entityType']).toBe('ReviewAssignment');
    expect(assignment.Item!['userId']).toBe(params.uploaderId);
    expect(assignment.Item!['sessionId']).toBe(sessionId);

    const accessible = await getAccessibleSessionIds(uploader);
    if (params.role === 'ADMIN') {
      // ADMIN: getAccessibleSessionIds returns null (= all sessions / no filter).
      expect(accessible).toBeNull();
    } else {
      // REVIEWER / TEAM_LEADER: the upload-generated session must be reachable
      // via the direct ReviewAssignment path.
      expect(accessible).not.toBeNull();
      expect(accessible).toContain(sessionId);
    }

    // --- Assertion 2: MediaFile.sessionId linked + resolvable via getBySessionId ---
    const linked = await mediaFileRepository.getById(mediaFileId);
    expect(linked?.sessionId).toBe(sessionId);

    const bySession = await mediaFileRepository.getBySessionId(sessionId);
    expect(bySession).not.toBeNull();
    expect(bySession!.mediaFileId).toBe(mediaFileId);
  }

  it('REVIEWER アップロード（teamId 未設定）: ReviewAssignment 生成・一覧可視・メディアリンク', async () => {
    await runGenerationPathAssertions({
      uploaderId: 'reviewer-upload-001',
      role: 'REVIEWER',
    });
  });

  it('TEAM_LEADER アップロード（teamId 設定済み）: ReviewAssignment 生成・一覧可視・メディアリンク', async () => {
    await runGenerationPathAssertions({
      uploaderId: 'teamleader-upload-001',
      role: 'TEAM_LEADER',
      teamId: 'team-upload-001',
    });
  });

  it('ADMIN アップロード: ReviewAssignment 生成・getAccessibleSessionIds=null（全件）・メディアリンク', async () => {
    await runGenerationPathAssertions({
      uploaderId: 'admin-upload-001',
      role: 'ADMIN',
    });
  });
});

/**
 * 準エンドツーエンド縦貫テスト（アップロード → ジョブ完了 → 一覧表示 / メディア解決）
 *
 * テスト内容:
 * - 生成経路（startJob -> createSessionForJob -> ReviewAssignment / MediaFile リンク）に加え、
 *   ジョブ完了ハンドラ（process-job-complete）を完了イベント注入で短絡させ、
 *   アップロード〜ジョブ完了〜一覧表示を **実経路で縦貫** する。
 * - Transcribe の実時間（実ジョブの完了待ち）を避けるため、Transcribe クライアントは
 *   setTranscribeClient でモックし、process-job-complete が参照する S3 出力は setS3Client で
 *   最小の transcript JSON を返すスタブに差し替える（S3 読み取りが重いため）。
 * - DynamoDB 書き込み（createSessionForJob / session-repository /
 *   team-repository.createReviewAssignment / media-file-repository / transcription-job-repository /
 *   process-job-complete の Segment / Session / Job 更新）は LocalStack の実テーブルに対して行う。
 *   shared docClient はファイル先頭の vi.mock で LocalStack に向けている。
 *
 * 検証内容（縦貫）:
 *   1. MediaFile（uploadedBy=uploader, scanStatus=CLEAN, s3Key あり）を LocalStack に用意。
 *   2. startJob({ mediaFileId, user }) を実行（Transcribe はモック）→ job 作成、
 *      createSessionForJob で ReviewSession + SessionParticipant + ReviewAssignment 生成、
 *      MediaFile.sessionId リンク。
 *   3. process-job-complete.handler に Transcribe 完了イベントを注入して実行。
 *      （S3 出力はスタブで最小 transcript JSON を返す。）
 *   4. アサート:
 *      (a) 生成されたセッションが getAccessibleSessionIds(uploader) に含まれる（REVIEWER / TEAM_LEADER）。
 *      (b) media-file-repository.getBySessionId(sessionId) が解決する。
 *      (c) process-job-complete が job.sessionId を持つ job を処理した際、既存セッションを再利用し、
 *          重複した空セッション（SK=METADATA）を作らない（bugfix 3.7）。
 *
 * 前提条件:
 * - LocalStack が起動していること (http://localhost:4566)
 * - 環境変数 INTEGRATION_TEST=true が設定されていること
 *   LocalStack 未起動 / INTEGRATION_TEST 未設定時は describe.skip で収集のみ。
 *
 * 実行方法:
 * cd backend && INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts reviewer-uploaded-session
 *
 * Validates: Requirements 2.1, 2.5, 3.7
 */
describeIntegration(
  '準エンドツーエンド縦貫（startJob -> process-job-complete -> 一覧 / メディア解決）',
  () => {
    let ddbClient: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;

    beforeAll(async () => {
      ddbClient = new DynamoDBClient({
        region: REGION,
        endpoint: ENDPOINT,
        credentials: CREDENTIALS,
      });

      docClient = DynamoDBDocumentClient.from(ddbClient, {
        marshallOptions: { removeUndefinedValues: true },
      });

      // Same key schema as the generation-path block above / dynamodb-crud:
      // PK/SK + GSI1 + GSI2.
      await ddbClient.send(
        new CreateTableCommand({
          TableName: TABLE_NAME,
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
            { AttributeName: 'GSI1PK', AttributeType: 'S' },
            { AttributeName: 'GSI1SK', AttributeType: 'S' },
            { AttributeName: 'GSI2PK', AttributeType: 'S' },
            { AttributeName: 'GSI2SK', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'GSI1',
              KeySchema: [
                { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
            {
              IndexName: 'GSI2',
              KeySchema: [
                { AttributeName: 'GSI2PK', KeyType: 'HASH' },
                { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      );

      // Buckets only need to be set so startJob passes its configuration check.
      // process-job-complete reads DATA_BUCKET_NAME before fetching S3; the S3
      // read itself is stubbed below, so no real bucket is contacted.
      process.env['MEDIA_BUCKET_NAME'] = 'test-media-bucket';
      process.env['DATA_BUCKET_NAME'] = 'test-data-bucket';

      // Stub Transcribe so StartTranscriptionJobCommand "succeeds" without a real job.
      const transcribeStub = {
        send: async () => ({ TranscriptionJob: { TranscriptionJobName: 'tr-stub' } }),
      } as unknown as TranscribeClient;
      setTranscribeClient(transcribeStub);

      // Stub S3 so process-job-complete's GetObjectCommand returns a minimal
      // Transcribe output JSON (one speaker segment, one pronunciation item)
      // instead of reading from a real bucket. The handler calls
      // s3Response.Body?.transformToString(), so Body exposes that method.
      const minimalOutput: TranscribeOutput = {
        results: {
          transcripts: [{ transcript: 'hello' }],
          speaker_labels: {
            speakers: 1,
            segments: [
              {
                start_time: '0.000',
                end_time: '1.000',
                speaker_label: 'spk_0',
                items: [{ start_time: '0.000', end_time: '1.000', speaker_label: 'spk_0' }],
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
      const s3Stub = {
        send: async () => ({
          Body: { transformToString: async () => JSON.stringify(minimalOutput) },
        }),
      } as unknown as S3Client;
      setS3Client(s3Stub);
    });

    afterAll(async () => {
      await ddbClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
      ddbClient.destroy();
    });

    /**
     * Seed a CLEAN, uploaded MediaFile owned by the uploader into the real table.
     * teamId is set only when provided.
     */
    async function seedMediaFile(params: {
      mediaFileId: string;
      uploaderId: string;
      teamId?: string;
    }): Promise<void> {
      const now = new Date().toISOString();
      const record: MediaFile = {
        mediaFileId: params.mediaFileId,
        filename: 'audio.mp3',
        s3Key: `media/${params.mediaFileId}/audio.mp3`,
        contentType: 'audio/mpeg',
        fileSize: 1024,
        uploadedBy: params.uploaderId,
        teamId: params.teamId,
        status: 'UPLOADED',
        scanStatus: 'CLEAN',
        createdAt: now,
        updatedAt: now,
      };
      await mediaFileRepository.save(record);
    }

    function makeUser(userId: string, role: UserRole): AuthUser {
      return {
        userId,
        email: `${userId}@example.com`,
        displayName: userId,
        role,
      };
    }

    /**
     * Count ReviewSession METADATA items for a given sessionId. Used to prove
     * process-job-complete reuses the session created at job start (bugfix 3.7)
     * rather than minting a second, empty session.
     */
    async function countSessionMetadata(sessionId: string): Promise<number> {
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression:
            'entityType = :entityType AND SK = :sk AND sessionId = :sessionId',
          ExpressionAttributeValues: {
            ':entityType': 'ReviewSession',
            ':sk': 'METADATA',
            ':sessionId': sessionId,
          },
        })
      );
      return result.Items?.length ?? 0;
    }

    /**
     * Run the full vertical flow: startJob (real generation path, Transcribe
     * stubbed) -> process-job-complete (completion event injected, S3 stubbed)
     * -> assert list visibility, media resolution, and session reuse.
     */
    async function runVerticalFlow(params: {
      uploaderId: string;
      role: UserRole;
      teamId?: string;
    }): Promise<void> {
      const mediaFileId = `media-e2e-${params.uploaderId}`;
      await seedMediaFile({
        mediaFileId,
        uploaderId: params.uploaderId,
        teamId: params.teamId,
      });

      const uploader = makeUser(params.uploaderId, params.role);

      // --- Step 1: start the job (real createSessionForJob + ReviewAssignment +
      // MediaFile link). Only Transcribe is stubbed. ---
      const job = await startJob({ mediaFileId, user: uploader });
      expect(job.sessionId).toBeDefined();
      const sessionId = job.sessionId!;

      // Exactly one ReviewSession METADATA exists right after startJob.
      expect(await countSessionMetadata(sessionId)).toBe(1);

      // --- Step 2: inject a COMPLETED Transcribe event to short-circuit the
      // completion handler (no real Transcribe wait, S3 output stubbed). ---
      const completionEvent: TranscribeJobEvent = {
        source: 'aws.transcribe',
        'detail-type': 'Transcribe Job State Change',
        detail: {
          TranscriptionJobName: job.transcribeJobName,
          TranscriptionJobStatus: 'COMPLETED',
        },
      };
      await processJobComplete(completionEvent);

      // --- Assertion (c): session reuse (bugfix 3.7) ---
      // process-job-complete saw job.sessionId set, so it must reuse the
      // existing session and NOT create a duplicate empty METADATA.
      expect(await countSessionMetadata(sessionId)).toBe(1);

      const completedJob = await transcriptionJobRepository.getById(job.jobId);
      expect(completedJob?.status).toBe('COMPLETED');
      expect(completedJob?.sessionId).toBe(sessionId);

      // --- Assertion (a): list-path visibility via getAccessibleSessionIds ---
      const accessible = await getAccessibleSessionIds(uploader);
      if (params.role === 'ADMIN') {
        // ADMIN: null (= all sessions / no filter). Visibility defect does not
        // apply to ADMIN; the ADMIN null path must be preserved.
        expect(accessible).toBeNull();
      } else {
        // REVIEWER / TEAM_LEADER: the upload-generated session is reachable via
        // the direct ReviewAssignment created at job start.
        expect(accessible).not.toBeNull();
        expect(accessible).toContain(sessionId);
      }

      // --- Assertion (b): MediaFile resolves via getBySessionId ---
      const bySession = await mediaFileRepository.getBySessionId(sessionId);
      expect(bySession).not.toBeNull();
      expect(bySession!.mediaFileId).toBe(mediaFileId);
    }

    it('REVIEWER 縦貫: アップロード→ジョブ完了→一覧可視・メディア解決・セッション再利用', async () => {
      await runVerticalFlow({
        uploaderId: 'reviewer-e2e-001',
        role: 'REVIEWER',
      });
    });

    it('TEAM_LEADER 縦貫（teamId 設定済み）: アップロード→ジョブ完了→一覧可視・メディア解決・セッション再利用', async () => {
      await runVerticalFlow({
        uploaderId: 'teamleader-e2e-001',
        role: 'TEAM_LEADER',
        teamId: 'team-e2e-001',
      });
    });
  }
);
