/**
 * Global teardown.
 *
 * The fixed E2E users (e2e-leader@ / e2e-reviewer@) are intentionally REUSED
 * across runs, so teardown does NOT delete them or their DynamoDB records, and
 * does NOT touch the shared seed team (e2e-team-001). This avoids re-creating
 * users every run (which previously sent Cognito emails and hit the daily
 * quota). We keep `.auth/test-users.json` so the next run can reuse the same
 * identities without any Cognito/DynamoDB round-trips if they already exist.
 *
 * Per-test resources created DURING a test (e.g. the unique user in admin test
 * 8.2.2, or temporary teams/IP entries) are cleaned up within those tests, not
 * here.
 */
export default async function globalTeardown() {
  console.log('\n🧹 Global Teardown: 固定テストユーザーは再利用のため保持します（削除なし）。\n');
}
