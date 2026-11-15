import { test, expect } from '../../fixtures/auth.js';
import type { Page } from '@playwright/test';
import { seedUploadOriginSession } from '../../helpers/dynamodb-helper.js';
import { adminAuth } from '../../helpers/cognito-helper.js';
import {
  apiRequest,
  createTeam,
  addTeamMember,
  deleteTeam,
  removeTeamMember,
  createTeamAssignment,
} from '../../helpers/api-helper.js';

/**
 * E2E 検証: team-departure-revokes-uploaded-session-visibility（bugfix spec, task 6）
 *
 * 目的
 * ----
 * 所有権移転モデル（案A'）の revoke 保護（backend task 3）が、デプロイ済み dev 環境
 * （Cognito + 実 DynamoDB + API Gateway + CloudFront）において、UI から観測可能な
 * セッション一覧の可視性として正しく反映されることを実機確認する。LocalStack 不要。
 *
 * 本 bugfix の中心は `revokeReviewAssignmentsIfOrphaned`（team-service.ts）。全チーム
 * 離脱時に ReviewAssignment を revoke する際、「本人所有かつチーム未アサイン」
 * （createdBy === userId かつ TeamAssignment 不在）のみを保持し、それ以外（チーム経由 /
 * 本人所有だがチームへ移管済み）は削除する。所有権移転モデルでは、セッションがチームに
 * アサインされた時点で所有権がチームへ移り、離脱で可視性を失うのが正しい挙動。
 *
 * 検証シナリオ（_Requirements: 2.1, 2.2, 2.3, 3.6_）
 *   1. 所有権保持（owner-retained, Property 1 / bugfix 2.1, 2.2, 2.3）
 *      Reviewer アップロード由来セッション（TeamAssignment 無し＝未アサイン）が一覧に出る
 *      → 管理者がその Reviewer を最後のチームから外す（全チーム離脱 = orphan）
 *      → 離脱後も一覧に出続ける（toBeVisible）。createdBy === userId かつ
 *      TeamAssignment 不在のため revoke 対象外 = 保持。
 *   2. 所有権移転（ownership transfer, Property 3 / bugfix 3.6）
 *      Reviewer アップロード由来セッションを管理者がテスト専用チームにアサイン
 *      （TeamAssignment を付与）→ その Reviewer を最後のチームから外す
 *      → 離脱後は一覧から消える（toHaveCount(0)）。createdBy === userId でも
 *      TeamAssignment ありのため離脱で revoke = 可視性喪失（所有権がチームへ移転）。
 *
 * チーム離脱の起こし方（実コード経路に一致）
 * ----------------------------------------
 * `DELETE /admin/teams/{teamId}/members/{userId}`
 *   → removeTeamMemberHandler → removeMemberFromTeam → revokeReviewAssignmentsIfOrphaned。
 * 管理者トークンは adminAuth(ADMIN_EMAIL, ADMIN_PASSWORD) の idToken を使う
 * （loginAsAdmin はブラウザ UI 用のため、API 操作にはトークンを別途取得する）。
 *
 * orphan 状態の確実な作成（固定ユーザー・他テストと非干渉）
 * ------------------------------------------------------
 * 固定 Reviewer（testUsers.reviewer）は seed チーム e2e-team-001（メンバーは seed
 * ユーザー e2e-reviewer-001/002/003 のみ）には属さない。ただし他テストの残存
 * メンバーシップに依存しないよう、テスト開始時に Reviewer の既存チーム所属を
 * `GET /admin/teams` → 各チームのメンバーで確認し、残っていれば全て外して確実に
 * orphan から始める（ensureReviewerHasNoTeams）。そのうえで各シナリオごとに
 * テスト専用チームを 1 つだけ作成して Reviewer を追加し、そのチームからのみ外す
 * ことで「最後のチームから外す＝全チーム離脱」を確実に再現する。
 *
 * テスト専用チーム名は `e2e-td-vis-team-*`（既存 UI チーム e2e-ui-team- / seed チーム
 * e2e-team-001 と非衝突）。テスト専用セッション ID は `e2e-td-vis-*`
 * （reviewer-uploaded-session-visibility.spec.ts の e2e-uploaded-* と別系統）。
 * afterEach でテスト専用チームを削除し、固定ユーザー / seed チームは改変しない
 * （global-teardown.ts の方針に従い固定ユーザーは保持）。
 *
 * 実行手順（CI 非前提 / ローカル運用、e2e/SETUP.md 準拠）
 * ------------------------------------------------------
 *   前提: デプロイ済み dev 環境 + e2e/.env（BASE_URL, API_ENDPOINT, COGNITO_*,
 *         ADMIN_EMAIL/PASSWORD, TEST_USER_PASSWORD, AWS_REGION, DYNAMODB_TABLE_NAME）。
 *   シード: `cd e2e && npm run seed`（固定ユーザー・seed チームを用意。メディア実体は不要）。
 *   実行: `cd e2e && npx playwright test tests/sessions/team-departure-visibility.spec.ts`
 *   収集確認のみ: `... --list`
 */

/** テスト専用チーム名プレフィックス（既存チームと衝突させない）。 */
const TEST_TEAM_PREFIX = 'e2e-td-vis-team';

/** シナリオ 1: 所有権保持を検証するアップロード由来セッション（TeamAssignment 無し）。 */
const OWNER_RETAINED_SESSION = {
  sessionId: 'e2e-td-vis-owner-retained-001',
  transcriptionJobId: 'e2e-td-vis-owner-retained-job-001',
  name: 'E2E 離脱後保持セッション（owner-retained）',
};

/** シナリオ 2: 所有権移転を検証するアップロード由来セッション（後で TeamAssignment を付与）。 */
const OWNERSHIP_TRANSFER_SESSION = {
  sessionId: 'e2e-td-vis-transfer-001',
  transcriptionJobId: 'e2e-td-vis-transfer-job-001',
  name: 'E2E 離脱後喪失セッション（ownership-transfer）',
};

interface TeamRecord {
  teamId: string;
  name: string;
}

interface TeamMembershipRecord {
  teamId: string;
  userId: string;
}

/**
 * 一覧（降順先頭ページ = 最新順）に、指定した名前のセッションの
 * 「校閲画面を開く」ボタンの Locator を返す。新規投入セッションは createdAt=now
 * なので先頭ページに現れる。reviewer-uploaded-session-visibility.spec.ts と同等。
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

/**
 * セッション一覧を再取得する（サーバー側のアクセス変更を反映するため）。
 *
 * 離脱操作（removeTeamMember）はサーバー側の DynamoDB を更新する。可視性は
 * `GET /sessions` の `getAccessibleSessionIds` で評価されるため、同一ログイン
 * セッションのまま一覧ページへ遷移して再フェッチを待てば最新の可視性が反映される。
 * 既にログイン済みのため再ログイン（loginForm）はせず、一覧ルート（/）へ遷移して
 * `GET /sessions` の完了と一覧 main の表示を待つ。
 */
async function reloadSessionList(page: Page): Promise<void> {
  await Promise.all([
    page
      .waitForResponse(
        (r) =>
          /\/sessions(\?.*)?$/.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.request().resourceType() !== 'document'
      )
      .catch(() => {}),
    page.goto('./'),
  ]);
  await expect(
    page.getByRole('main', { name: '校閲セッション一覧' })
  ).toBeVisible();
}

interface TeamAssignmentRecord {
  teamId: string;
  sessionId: string;
}

/**
 * TeamAssignment がインデックス反映され読み取り可能になるまで待つ。
 *
 * `createTeamAssignment`（POST）は書き込み完了で 201 を返すが、GSI1
 * （SESSION#{sessionId} + begins_with 'TEAM#'）への反映は結果整合であり、直後に
 * `removeTeamMember` → `revokeReviewAssignmentsIfOrphaned` → `hasAnyTeamAssignment`
 * が走ると、GSI がまだ TeamAssignment を返さず owner-retained と誤判定して
 * ReviewAssignment を保持してしまう（＝所有権移転が観測できない）レースがある。
 * `GET /admin/teams/{teamId}/assignments` で当該 sessionId が見えるまでポーリング
 * して、所有権移転が確実に成立した状態で離脱操作へ進む。
 */
async function waitForTeamAssignmentVisible(
  token: string,
  teamId: string,
  sessionId: string
): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const res = await apiRequest<{ data: TeamAssignmentRecord[] }>({
      method: 'GET',
      path: `/admin/teams/${teamId}/assignments`,
      token,
    });
    if (res.data.some((a) => a.sessionId === sessionId)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `TeamAssignment for session ${sessionId} on team ${teamId} did not become visible within 10s`
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** 管理者トークン（idToken）を取得する。 */
async function getAdminToken(): Promise<string> {
  const { idToken } = await adminAuth(
    process.env.ADMIN_EMAIL!,
    process.env.ADMIN_PASSWORD!
  );
  return idToken;
}

/**
 * 対象ユーザーを全チームから外し、確実に orphan（全チーム離脱）状態から始める。
 * `GET /admin/teams`（admin は全チーム）→ 各チームの members を確認し、対象ユーザーが
 * 属するチームからは removeTeamMember で外す。前回の失敗で残ったテスト専用チームや
 * 想定外の所属があっても、本テストの前提（唯一のテスト専用チームのみ所属）を保証する。
 * 固定 Reviewer は seed チームには属さない前提だが、確実性のため明示的に掃除する。
 */
async function ensureUserHasNoTeams(token: string, userId: string): Promise<void> {
  const res = await apiRequest<{ data: TeamRecord[] }>({
    method: 'GET',
    path: '/admin/teams',
    token,
  });
  for (const team of res.data) {
    const membersRes = await apiRequest<{ data: TeamMembershipRecord[] }>({
      method: 'GET',
      path: `/admin/teams/${team.teamId}/members`,
      token,
    });
    const isMember = membersRes.data.some((m) => m.userId === userId);
    if (isMember) {
      await removeTeamMember(token, team.teamId, userId);
    }
  }
}

test.describe('チーム離脱時のアップロード由来セッション可視性（bugfix: team-departure-revokes-uploaded-session-visibility）', () => {
  let adminToken: string;

  test.beforeAll(async ({ testUsers }) => {
    adminToken = await getAdminToken();

    // シナリオ 1 / 2 のアップロード由来セッションを Reviewer 本人所有で投入する
    // （createdBy === uploaderId の ReviewAssignment、TeamAssignment はこの時点で無し）。
    // 冪等（固定キー PUT）なので再実行安全。
    await seedUploadOriginSession({
      ...OWNER_RETAINED_SESSION,
      uploaderId: testUsers.reviewer.userId,
      status: 'COMPLETED',
    });
    await seedUploadOriginSession({
      ...OWNERSHIP_TRANSFER_SESSION,
      uploaderId: testUsers.reviewer.userId,
      status: 'COMPLETED',
    });
  });

  test.describe('シナリオ 1: 離脱後も本人所有（チーム未アサイン）セッションは一覧に出続ける', () => {
    // _Requirements: 2.1, 2.2, 2.3_（design Correctness Properties Property 1）
    let teamId: string;

    test.beforeEach(async ({ testUsers }) => {
      // 確実に orphan から始め、テスト専用チームを 1 つだけ作って Reviewer を所属させる。
      await ensureUserHasNoTeams(adminToken, testUsers.reviewer.userId);
      const created = await createTeam(adminToken, `${TEST_TEAM_PREFIX}-s1-${Date.now()}`);
      teamId = created.data.teamId;
      await addTeamMember(adminToken, teamId, testUsers.reviewer.userId);
    });

    test.afterEach(async () => {
      // テスト専用チームを削除（存在する場合のみ）。固定ユーザー・seed チームは非改変。
      if (teamId) {
        await deleteTeam(adminToken, teamId).catch(() => {});
      }
    });

    test('最後のチームから外しても owner-retained セッションが一覧に表示される', async ({
      page,
      loginAsReviewer,
      testUsers,
    }) => {
      // 前提: 離脱前は Reviewer の一覧に owner-retained セッションが出ている。
      await loginAsReviewer(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();
      await expect(
        sessionOpenButtonByName(page, OWNER_RETAINED_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });

      // 管理者が Reviewer を最後の（唯一の）チームから外す → 全チーム離脱 = orphan。
      // revokeReviewAssignmentsIfOrphaned が走るが、createdBy === userId かつ
      // TeamAssignment 不在のため当該 ReviewAssignment は保持される。
      await removeTeamMember(adminToken, teamId, testUsers.reviewer.userId);

      // 離脱後に一覧を再取得すると、owner-retained セッションは出続ける。
      await reloadSessionList(page);
      await expect(
        sessionOpenButtonByName(page, OWNER_RETAINED_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('シナリオ 2: チームへ移管済みセッションは離脱で一覧から消える', () => {
    // _Requirements: 3.6_（design Correctness Properties Property 3）
    let teamId: string;

    test.beforeEach(async ({ testUsers }) => {
      await ensureUserHasNoTeams(adminToken, testUsers.reviewer.userId);
      const created = await createTeam(adminToken, `${TEST_TEAM_PREFIX}-s2-${Date.now()}`);
      teamId = created.data.teamId;
      await addTeamMember(adminToken, teamId, testUsers.reviewer.userId);
    });

    test.afterEach(async () => {
      if (teamId) {
        // チーム削除カスケードで TeamAssignment / TeamMembership も掃除される。
        await deleteTeam(adminToken, teamId).catch(() => {});
      }
    });

    test('チームにアサイン後に最後のチームから外すと移管済みセッションが一覧から消える', async ({
      page,
      loginAsReviewer,
      testUsers,
    }) => {
      // 前提: 離脱前は Reviewer の一覧に当該セッションが出ている。
      await loginAsReviewer(page);
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();
      await expect(
        sessionOpenButtonByName(page, OWNERSHIP_TRANSFER_SESSION.name).first()
      ).toBeVisible({ timeout: 15_000 });

      // 管理者がセッションをテスト専用チームにアサイン（TeamAssignment を付与）。
      // これで所有権がチームへ移る（createAssignment → createTeamAssignment）。
      await createTeamAssignment(
        adminToken,
        teamId,
        OWNERSHIP_TRANSFER_SESSION.sessionId
      );

      // TeamAssignment が GSI に反映され読み取り可能になるまで待つ（結果整合レース対策）。
      // これにより revoke 時の hasAnyTeamAssignment が確実に真となり所有権移転が成立する。
      await waitForTeamAssignmentVisible(
        adminToken,
        teamId,
        OWNERSHIP_TRANSFER_SESSION.sessionId
      );

      // 管理者が Reviewer を最後のチームから外す → 全チーム離脱。
      // createdBy === userId でも TeamAssignment ありのため revoke = 可視性喪失。
      await removeTeamMember(adminToken, teamId, testUsers.reviewer.userId);

      // 離脱後に一覧を再取得すると、移管済みセッションは一覧から消える。
      await reloadSessionList(page);
      await expect(
        sessionOpenButtonByName(page, OWNERSHIP_TRANSFER_SESSION.name)
      ).toHaveCount(0);
    });
  });
});
