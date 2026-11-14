import { test, expect } from '../../fixtures/auth.js';
import type { Page } from '@playwright/test';
import {
  seedUploadOriginSession,
  linkMediaFileToSession,
  getMediaBucketName,
  getUserIdByEmail,
} from '../../helpers/dynamodb-helper.js';
import { SEEDED_MEDIA_SESSION_IDS } from '../../helpers/ui-helper.js';
import { expectNoAxeViolations } from '../../helpers/axe-helper.js';

/**
 * E2E 検証: reviewer-uploaded-session-not-visible（bugfix spec, task 9）
 *
 * 目的
 * ----
 * デプロイ済み環境に対し、修正後のフルフロー（可視性 + メディア取得）を検証する。
 * 本 bugfix は 2 つの独立した欠陥が重なっていた:
 *   1. 可視性: アップロード由来セッションに ReviewAssignment が作られず、
 *      getAccessibleSessionIds（GET /sessions の依存）が返さないため一覧に出ない。
 *   2. メディアリンク: startJob の空 catch で MediaFile→sessionId リンクが欠落し、
 *      GET /sessions/{id}/media-url が MEDIA_FILE_NOT_FOUND(404) になる。
 *
 * 検証シナリオ（_Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_）
 *   1. Reviewer アップロード由来セッション → セッション一覧に出る。
 *   2. TeamLeader アップロード由来セッション → セッション一覧に出る。
 *   3. 校閲画面を開くとメディア取得（署名付き URL）が成功し、
 *      「メディアファイルが見つかりません」「データの取得に失敗しました」
 *      「リソースが見つかりません」のエラーが表示されない。
 *   4. 分離（isolation, _Requirements: 3.6_）: reviewer アップロード由来の
 *      no-team セッション（ReviewAssignment が reviewer 本人にのみ付与）が、
 *      無関係な TeamLeader の一覧に出ない（toHaveCount(0)）。可視性修正が
 *      「見えすぎる」逆方向リグレッションを生んでいないことを確認する。
 *   5. Admin 全件パスの回帰（_Requirements: 3.2, 2.1_）: Admin アップロード由来
 *      セッションが loginAsAdmin の一覧に出続ける。ADMIN は getAccessibleSessionIds
 *      が null（＝全件）を返すため、ReviewAssignment / TeamAssignment の有無に
 *      関わらず一覧に現れる。本 bugfix（ReviewAssignment 追加に限定）が ADMIN の
 *      全件パスを壊していないことの退行検出（bugfix 3.2）。
 *
 * データ戦略（既存 E2E の流儀に準拠）
 * ----------------------------------
 * 既存 E2E は実トランスクリプションジョブ完了を待たず、DynamoDB へ直接投入した
 * COMPLETED セッション + リンク済み MediaFile（scanStatus=CLEAN）で検証する
 * （seed/seed-data.ts, seed/seed-media-files.ts, tests/sessions/review-page.spec.ts）。
 * 本 spec も同じ方針で、「修正後のバックエンドが生成するレイアウト」
 * （ReviewSession + SessionParticipant(アップローダー) + ReviewAssignment）を
 * beforeAll で投入する（helpers/dynamodb-helper.ts の seedUploadOriginSession）。
 * ReviewAssignment は task 5.1 の修正 / task 8 のバックフィルが作るアイテムそのもの
 * なので、正しく修正・バックフィルされた環境で一覧可視性が通り、退行すれば失敗する。
 *
 * メディア取得（シナリオ 3）は CloudFront 署名付き URL の実フェッチが成功する必要が
 * あるため、既に S3 実体 + CLEAN スキャンが揃っている seed 済みメディアセッション
 * （e2e-session-001）を使う（review-page.spec.ts と同じ前提）。アップロード由来
 * セッション側では「校閲画面に 3 つのエラー文言が出ない」ことも併せて確認する。
 *
 * 前提・実行（CI 非前提 / ローカル運用、e2e/SETUP.md 準拠）
 * ------------------------------------------------------
 *   1. デプロイ済み dev 環境 + e2e/.env（BASE_URL, API_ENDPOINT, COGNITO_*,
 *      ADMIN_EMAIL/PASSWORD, TEST_USER_PASSWORD, AWS_REGION, DYNAMODB_TABLE_NAME）。
 *   2. シード投入: `cd e2e && npm run seed && npm run seed:media`
 *      （seed:media は MEDIA_BUCKET_NAME を要求。e2e-session-001 の S3 実体 + CLEAN を用意）。
 *   3. 実行: `cd e2e && npx playwright test tests/sessions/reviewer-uploaded-session-visibility.spec.ts`
 *   収集確認のみ: `... --list`
 *
 * フィクスチャ/ヘルパ: fixtures/auth.ts（loginAsReviewer / loginAsTeamLeader /
 * loginAsAdmin, testUsers）, helpers/dynamodb-helper.ts, helpers/ui-helper.ts,
 * helpers/axe-helper.ts を再利用（auth.ts への追加は不要）。
 */

/** メディア取得失敗を示す 3 つのユーザー可視文言（校閲画面に出てはいけない）。 */
const MEDIA_ERROR_MESSAGES = [
  'メディアファイルが見つかりません', // MEDIA_FILE_NOT_FOUND / review mediaUrlError.notFound
  'データの取得に失敗しました', //         generic fetch failure
  'リソースが見つかりません', //           RESOURCE_NOT_FOUND
] as const;

/** seed 済み（S3 実体 + CLEAN）のメディア紐付きセッション。review-page.spec.ts と同じ前提。 */
const MEDIA_SESSION = SEEDED_MEDIA_SESSION_IDS[0]; // e2e-session-001

/** このテスト専用のアップロード由来セッション（createdAt=now で一覧先頭に来る）。 */
const REVIEWER_SESSION = {
  sessionId: 'e2e-uploaded-reviewer-vis-001',
  transcriptionJobId: 'e2e-uploaded-reviewer-job-001',
  name: 'E2E Reviewer アップロード可視性セッション',
};
const TEAMLEADER_SESSION = {
  sessionId: 'e2e-uploaded-leader-vis-001',
  transcriptionJobId: 'e2e-uploaded-leader-job-001',
  name: 'E2E TeamLeader アップロード可視性セッション',
};
const ADMIN_SESSION = {
  sessionId: 'e2e-uploaded-admin-vis-001',
  transcriptionJobId: 'e2e-uploaded-admin-job-001',
  name: 'E2E Admin アップロード可視性セッション',
};

/**
 * Admin のアップローダー userId を解決する。testUsers（.auth/test-users.json）には
 * admin が含まれず（teamLeader / reviewer のみ）、Admin は Cognito の
 * ADMIN_EMAIL/PASSWORD でログインするため、seed-data.ts と同じ流儀で解決する:
 *   1. ADMIN_EMAIL の実ユーザーレコード（extractUser が参照する正）を GSI1 で引く
 *   2. 無ければ ADMIN_USER_ID 環境変数（seed と同じ上書き手段）
 *   3. それも無ければ seed 既定値 e2e-admin-user-001
 * ADMIN は getAccessibleSessionIds が null（全件）を返すため、一覧可視性自体は
 * uploaderId の厳密一致に依存しないが、「Admin アップロード由来」を正しく表すため
 * 実 Admin の userId に合わせる。
 */
async function resolveAdminUserId(): Promise<string> {
  const email = process.env.ADMIN_EMAIL;
  if (email) {
    const byEmail = await getUserIdByEmail(email);
    if (byEmail) return byEmail;
  }
  return process.env.ADMIN_USER_ID || 'e2e-admin-user-001';
}

/**
 * seed:media が投入する S3 実体付きメディア（sample-audio-for-delete.mp3, CLEAN）。
 * どの校閲 spec も e2e-session-004 の校閲画面には遷移しないため、本 spec で
 * Reviewer アップロード由来セッションへ付け替えて「修正後にメディアが解決される」
 * フルフロー（署名付き URL 取得成功）を検証する。MEDIA_BUCKET_NAME 未設定時は
 * メディア依存の検証をスキップする。
 */
const REUSABLE_MEDIA = {
  mediaFileId: 'e2e-media-004',
  filename: 'sample-audio-for-delete.mp3',
  contentType: 'audio/mpeg',
};

/**
 * 一覧（一番上のページ = 最新順）に、指定した名前のセッションの
 * 「校閲画面を開く」ボタンが存在することを確認する。
 * 新規投入セッションは createdAt=now なので降順先頭ページに現れる。
 */
function sessionOpenButtonByName(page: Page, name: string) {
  return page
    .getByRole('list', { name: 'セッション一覧' })
    .getByRole('button', {
      name: new RegExp(`^校閲画面を開く（${escapeRegExp(name)} - (未着手|進行中|完了)）$`),
    });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 校閲画面に 3 つのメディア取得エラー文言が出ていないことをアサートする。 */
async function expectNoMediaErrors(page: Page): Promise<void> {
  for (const msg of MEDIA_ERROR_MESSAGES) {
    await expect(
      page.getByText(msg),
      `校閲画面にメディア取得エラー「${msg}」が表示されてはいけない`
    ).toHaveCount(0);
  }
}

/** MEDIA_BUCKET_NAME が設定されていればメディア実体付きの検証を行う。 */
const mediaBucket = getMediaBucketName();

test.describe('アップロード由来セッションの可視性・メディア取得（bugfix: reviewer-uploaded-session-not-visible）', () => {
  // 修正後のバックエンドが生成するレイアウト（+ バックフィル結果）を直接投入する。
  test.beforeAll(async ({ testUsers }) => {
    // シナリオ 1: Reviewer アップロード（teamId 未設定 = mediaFile.teamId なしの再現）。
    await seedUploadOriginSession({
      ...REVIEWER_SESSION,
      uploaderId: testUsers.reviewer.userId,
      status: 'COMPLETED',
    });

    // シナリオ 2: TeamLeader アップロード（teamId 設定済み。GSI1 SESSION# だけでは
    // 一覧に出ず、ReviewAssignment で初めて出る、というケースを修正後として投入）。
    await seedUploadOriginSession({
      ...TEAMLEADER_SESSION,
      uploaderId: testUsers.teamLeader.userId,
      teamId: testUsers.teamId,
      status: 'COMPLETED',
    });

    // シナリオ 5: Admin アップロード（ADMIN 全件パスの回帰検出）。uploaderId を
    // 実 Admin の userId に合わせる。teamId は付けない（TeamAssignment なし）。
    // ADMIN は getAccessibleSessionIds が null（全件）を返すため、Assignment の
    // 有無に関わらず一覧に出続けることを検証する。
    const adminUserId = await resolveAdminUserId();
    await seedUploadOriginSession({
      ...ADMIN_SESSION,
      uploaderId: adminUserId,
      status: 'COMPLETED',
    });

    // シナリオ 3（メディア実体あり）: Reviewer アップロード由来セッションに
    // S3 実体付き MediaFile（CLEAN）を sessionId リンクし、署名付き URL 取得が
    // 成功する「修正後」の状態を用意する。MEDIA_BUCKET_NAME 未設定時はスキップ。
    if (mediaBucket) {
      await linkMediaFileToSession({
        ...REUSABLE_MEDIA,
        sessionId: REVIEWER_SESSION.sessionId,
        s3Bucket: mediaBucket,
        uploaderId: testUsers.reviewer.userId,
      });
    }
  });

  test.describe('シナリオ 1: Reviewer アップロード由来セッションが一覧に出る', () => {
    // _Requirements: 2.1, 2.2, 2.3_
    test('Reviewer のセッション一覧にアップロード由来セッションが表示される', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();

      // getAccessibleSessionIds が ReviewAssignment 経由で sessionId を含むため、
      // アップローダー本人（Reviewer）の一覧にセッションが現れる。
      await expect(
        sessionOpenButtonByName(page, REVIEWER_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('シナリオ 2: TeamLeader アップロード由来セッションが一覧に出る', () => {
    // _Requirements: 2.1, 2.2, 2.3_
    test('TeamLeader のセッション一覧にアップロード由来セッションが表示される', async ({
      page,
      loginAsTeamLeader,
    }) => {
      await loginAsTeamLeader(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();

      // teamId 設定済みでも、修正で付与された ReviewAssignment により一覧に出る。
      await expect(
        sessionOpenButtonByName(page, TEAMLEADER_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('シナリオ 4: 分離（isolation）— 無関係ユーザーの一覧に他人のアップロード由来セッションが出ない', () => {
    // _Requirements: 3.6, 2.1, 2.2_
    //
    // 可視性修正が「見えすぎる」逆方向リグレッションを生んでいないことを確認する。
    // REVIEWER_SESSION は teamId 未設定（TeamAssignment なし）で、アップローダー
    // 本人（reviewer）の ReviewAssignment だけが到達経路。修正は ReviewAssignment を
    // アップローダー本人にのみ付与するため、TeamLeader は（reviewer の no-team
    // セッションへの ReviewAssignment を持たず、当該セッションに TeamAssignment も
    // 無いので）このセッションに到達できない。team を共有していても no-team
    // セッションには TeamAssignment が無いため経路にならない点が本検証の肝。
    // Preservation（bugfix 3.6）: 他人のアップロード由来セッションへのアクセスは
    // 従来どおり与えられない（checkSessionAccess / denyResourceAccess の 404 維持）。
    test('TeamLeader の一覧に reviewer アップロード由来（teamId なし）セッションが出ない', async ({
      page,
      loginAsTeamLeader,
    }) => {
      await loginAsTeamLeader(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();

      // reviewer の no-team アップロードセッションは ReviewAssignment が reviewer
      // 本人にしか無く、TeamLeader への可視経路（ReviewAssignment / TeamAssignment）が
      // 存在しないため、TeamLeader の一覧に現れてはいけない。
      await expect(
        sessionOpenButtonByName(page, REVIEWER_SESSION.name)
      ).toHaveCount(0);
    });
  });

  test.describe('シナリオ 5: Admin アップロード由来セッションが一覧に出続ける（ADMIN 全件パスの回帰）', () => {
    // _Requirements: 3.2, 2.1_
    //
    // ADMIN は getAccessibleSessionIds が null（＝全件）を返すため、
    // ReviewAssignment / TeamAssignment の有無に関わらずセッション一覧に出る。
    // 本 bugfix は ReviewAssignment 追加に限定され ADMIN パスを変えていないので、
    // Admin アップロード由来セッションは従来どおり一覧に出続ける（bugfix 3.2）。
    // このシナリオはその「ADMIN 全件パス」が退行していないことを検出する。
    test('Admin のセッション一覧に Admin アップロード由来セッションが表示される', async ({
      page,
      loginAsAdmin,
    }) => {
      await loginAsAdmin(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();

      // ADMIN=null（全件）パスにより、Admin アップロード由来セッションが
      // 一覧先頭ページ（createdAt=now で降順先頭）に現れる。
      await expect(
        sessionOpenButtonByName(page, ADMIN_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('シナリオ 3: 校閲画面でメディア取得が成功しエラー文言が出ない', () => {
    // _Requirements: 2.5, 2.6_
    test('メディア紐付きセッションの校閲画面でメディアパネルが表示され、取得エラーが出ない', async ({
      page,
      loginAsAdmin,
    }) => {
      // seed 済み（S3 実体 + CLEAN）のメディアセッションへ直接遷移する。
      // 署名付き URL のフェッチが成功し、校閲画面にメディアパネルが描画される。
      await loginAsAdmin(page);
      await page.goto(`./sessions/${MEDIA_SESSION}`);
      await expect(page.getByRole('main', { name: '校閲画面' })).toBeVisible();

      // メディアパネルが表示される = media-url 取得が成功して再生 UI が出る。
      await expect(page.getByLabel('メディアパネル')).toBeVisible({ timeout: 15_000 });

      // 3 つのメディア取得エラー文言のいずれも出ていないこと。
      await expectNoMediaErrors(page);

      // 校閲画面はアクセシビリティ違反ゼロ（既存 spec の axe 方針に合わせる）。
      await expectNoAxeViolations(page);
    });

    // _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_
    test('Reviewer アップロード由来セッションの校閲画面でメディアが解決されエラーが出ない', async ({
      page,
      loginAsReviewer,
    }) => {
      // MEDIA_BUCKET_NAME 未設定の環境では S3 実体リンクを張れないため、
      // 取得成功までは検証できない。環境準備（SETUP.md の seed:media）が前提。
      test.skip(
        !mediaBucket,
        'MEDIA_BUCKET_NAME 未設定のためメディア実体付きの検証をスキップ（SETUP.md の seed:media 前提）'
      );

      // 修正後はアップローダー本人（Reviewer）が自分の一覧からセッションに到達でき、
      // 校閲画面を開くとリンク済みメディア（CLEAN）の署名付き URL 取得が成功する。
      await loginAsReviewer(page);
      await page.goto(`./sessions/${REVIEWER_SESSION.sessionId}`);
      await expect(page.getByRole('main', { name: '校閲画面' })).toBeVisible();

      // メディアパネルが表示される = media-url 取得が成功している。
      await expect(page.getByLabel('メディアパネル')).toBeVisible({ timeout: 15_000 });

      // 3 つのメディア取得エラー文言のいずれも出ていないこと（本 bugfix の症状）。
      await expectNoMediaErrors(page);
    });
  });
});
