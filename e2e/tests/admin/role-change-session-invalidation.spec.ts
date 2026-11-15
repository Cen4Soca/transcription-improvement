import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { adminAuth, deleteUser, ensureCognitoUser } from '../../helpers/cognito-helper.js';
import { apiRequest } from '../../helpers/api-helper.js';
import { ensureUserRecord, getUserIdByEmail } from '../../helpers/dynamodb-helper.js';

/**
 * E2E 実機確認: role-change-session-invalidation（bugfix spec, task 6.1）
 *
 * 目的
 * ----
 * 方針Bの修正により、管理者が `PATCH /admin/users/{userId}` でロールを変更
 * （`roleChanged && body.isActive !== false`）したとき、監査ログ
 * （`operationType = USER_MANAGEMENT`）の `metadata` に `sessionInvalidated: true`
 * が `previousValue` / `newValue`（変更前後ロール）と併記されることを、デプロイ済み
 * dev 環境（Cognito + 実 DynamoDB + API Gateway）で実機確認する。LocalStack 不要。
 *
 * スコープ
 * --------
 * 本 spec の確認対象は **監査ログに `sessionInvalidated: true` が出ること** に限定する。
 * 既存 JWT セッションの強制サインアウトの実体（対象ユーザーが再ログインを求められる /
 * 401）は UI 操作だけでは観測しにくく 2 ブラウザコンテキストの 401 再現が E2E として
 * 不安定なため、手動確認（tasks.md 6.2）の担当とする（design.md「実機確認」節に準拠）。
 *
 * 監査ログへの反映経路（実コード）
 * --------------------------------
 * `updateUserHandler`（backend/src/handlers/admin-users.ts）がロール変更時に
 * `recordAuditLog({ operationType: 'USER_MANAGEMENT', metadata: { previousValue,
 * newValue, sessionInvalidated: true } })` を記録する。`recordAuditLog`
 * （audit-service.ts）は `sanitizeMetadata`（utils/metadata-sanitizer.ts）を通し、
 * allowlist に含まれる `previousValue` / `newValue` / `sessionInvalidated` を
 * 文字列化して保存する（boolean `true` → 文字列 `'true'`）。よって
 * `GET /admin/audit-logs` のレスポンス `data[].metadata` では `sessionInvalidated`
 * は **文字列 `'true'`** として観測される。
 *
 * 固定ユーザー保護（必須）
 * ------------------------
 * 固定ユーザー（global-setup.ts の teamLeader = e2e-leader@test.example.com /
 * reviewer = e2e-reviewer@test.example.com）のロールを変更するとそのロール前提が
 * 壊れ、他テストや global-setup に影響する。そこで本 spec は **テスト専用の
 * 使い捨てユーザー** を作成し、そのユーザーのロールのみを変更する。固定ユーザーの
 * ロールは一切触らない。使い捨てユーザーは `afterAll` で Cognito から削除する。
 *
 * 使い捨てユーザーの作成はメール送信なし（`ensureCognitoUser` = AdminCreateUser
 * MessageAction: SUPPRESS）+ 直接 DynamoDB レコード（`ensureUserRecord`）で行う。
 * これは global-setup.ts と同じ email-free 流儀で、Cognito の 1 日あたりメール
 * 送信上限を消費しない（Admin API の POST /admin/users は招待メールを送るため避ける）。
 *
 * 実行手順（CI 非前提 / ローカル運用、e2e/SETUP.md 準拠）
 * ------------------------------------------------------
 *   前提: デプロイ済み dev 環境 + e2e/.env（API_ENDPOINT, COGNITO_*,
 *         ADMIN_EMAIL/PASSWORD, TEST_USER_PASSWORD, AWS_REGION, DYNAMODB_TABLE_NAME）。
 *   収集確認のみ: `cd e2e && npx playwright test tests/admin/role-change-session-invalidation.spec.ts --list`
 *   実行:         `cd e2e && npx playwright test tests/admin/role-change-session-invalidation.spec.ts`
 *
 * _Requirements: 2.1, 2.4_
 */

/** 使い捨てユーザーのメール（固定ユーザー・seed ユーザーと非衝突のプレフィックス）。 */
const DISPOSABLE_EMAIL = `e2e-rcsi-${crypto.randomUUID()}@test.example.com`;
const DISPOSABLE_DISPLAY_NAME = 'E2E ロール変更検証ユーザー（使い捨て）';
const INITIAL_ROLE = 'REVIEWER' as const;
const CHANGED_ROLE = 'TEAM_LEADER' as const;

/** USER_MANAGEMENT 監査ログ 1 件の形（GET /admin/audit-logs のレスポンス items）。 */
interface AuditLogItem {
  logId: string;
  createdAt: string;
  actorUserId: string;
  actorRole: string;
  operationType: string;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, string>;
}

interface AuditLogsResponse {
  data: AuditLogItem[];
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

/** 管理者トークン（idToken）を取得する。loginAsAdmin はブラウザ UI 用のため API には別途取得。 */
async function getAdminToken(): Promise<string> {
  const { idToken } = await adminAuth(
    process.env.ADMIN_EMAIL!,
    process.env.ADMIN_PASSWORD!
  );
  return idToken;
}

/**
 * 対象ユーザー（resourceId）の最新 USER_MANAGEMENT 監査ログを、結果整合の遅延を
 * 見込んで短くポーリングして取得する。見つからなければ null。
 */
async function findRoleChangeAuditLog(
  token: string,
  targetUserId: string
): Promise<AuditLogItem | null> {
  const maxAttempts = 10;
  const intervalMs = 1500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await apiRequest<AuditLogsResponse>({
      method: 'GET',
      path: '/admin/audit-logs?operationType=USER_MANAGEMENT&page=1',
      token,
    });
    const match = res.data.find((item) => item.resourceId === targetUserId);
    if (match) return match;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}

test.describe('管理画面 - ロール変更時セッション無効化の監査ログ', () => {
  let disposableUserId: string;

  test.beforeAll(async () => {
    // テスト専用の使い捨てユーザーを email-free で用意（固定ユーザーには触れない）。
    const password = process.env.TEST_USER_PASSWORD!;
    await ensureCognitoUser({
      email: DISPOSABLE_EMAIL,
      password,
      role: INITIAL_ROLE,
      displayName: DISPOSABLE_DISPLAY_NAME,
    });
    // extractUser / PATCH /admin/users/{userId} が参照する正の userId は DynamoDB 側。
    disposableUserId = await ensureUserRecord({
      userId: crypto.randomUUID(),
      email: DISPOSABLE_EMAIL,
      displayName: DISPOSABLE_DISPLAY_NAME,
      role: INITIAL_ROLE,
    });
  });

  test.afterAll(async () => {
    // 使い捨て Cognito ユーザーを削除（deleteUser はエラーを握りつぶす）。
    // DynamoDB レコードは固定ユーザー保持方針（global-teardown）に合わせ残置して問題ない
    // （一意メールのため他テストに干渉しない）。
    await deleteUser(DISPOSABLE_EMAIL);
  });

  test('6.1 ロール変更時に監査ログ metadata へ sessionInvalidated: true が記録される', async () => {
    const token = await getAdminToken();

    // 事前条件: DynamoDB の現ロールが INITIAL_ROLE であること（roleChanged を確実にする）。
    const resolved = await getUserIdByEmail(DISPOSABLE_EMAIL);
    expect(resolved).toBe(disposableUserId);

    // ロール変更（REVIEWER → TEAM_LEADER、isActive は指定しない = 強制サインアウト発火条件）。
    await apiRequest({
      method: 'PATCH',
      path: `/admin/users/${disposableUserId}`,
      token,
      body: { role: CHANGED_ROLE },
    });

    // 監査ログに当該ユーザーの USER_MANAGEMENT エントリが反映されるのを待つ。
    const auditLog = await findRoleChangeAuditLog(token, disposableUserId);
    expect(
      auditLog,
      `USER_MANAGEMENT audit log for user ${disposableUserId} not found within the polling window`
    ).not.toBeNull();

    // metadata に sessionInvalidated（文字列 'true'）と変更前後ロールが含まれること。
    // sanitizeMetadata が boolean → 文字列化するため 'true' で比較する。
    expect(auditLog!.metadata).toBeDefined();
    expect(auditLog!.metadata).toMatchObject({
      sessionInvalidated: 'true',
      previousValue: INITIAL_ROLE,
      newValue: CHANGED_ROLE,
    });
  });
});
