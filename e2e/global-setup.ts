import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ensureCognitoUser } from './helpers/cognito-helper.js';
import { ensureUserRecord } from './helpers/dynamodb-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const AUTH_DIR = path.resolve(__dirname, '.auth');
const TEST_USERS_FILE = path.resolve(AUTH_DIR, 'test-users.json');

/**
 * Global setup — provision REUSABLE fixed E2E users without sending any email.
 *
 * Previous design created timestamped users every run via the Admin API, which
 * sent a Cognito welcome email each time and eventually hit the Cognito daily
 * email quota ("Exceeded daily email limit"). We now use fixed emails and
 * create them email-free (AdminCreateUser MessageAction: SUPPRESS) + a direct
 * DynamoDB user record, and we do NOT delete them in teardown — they are reused
 * across runs. `workers: 1` (see playwright.config.ts) means there is no
 * parallel-collision risk that the old timestamped emails guarded against.
 *
 * The user-creation FEATURE is still covered by admin tests (8.2.2), which
 * create a unique user within the test; only the fixture users are fixed here.
 */

// Fixed reusable test users (no timestamp).
const LEADER_EMAIL = 'e2e-leader@test.example.com';
const REVIEWER_EMAIL = 'e2e-reviewer@test.example.com';
// Fixed team already present in seed data (e2e/seed/seed-data.ts).
const TEAM_ID = 'e2e-team-001';

export default async function globalSetup() {
  console.log('\n🔧 Global Setup: 固定テストユーザーを準備中（メール送信なし・再利用）...');

  const testPassword = process.env.TEST_USER_PASSWORD!;

  // 最適化: 固定ユーザーは一度作れば使い回せるため、.auth/test-users.json が既に
  // 存在すれば AWS SDK（Cognito/DynamoDB）の事前確認をスキップして再利用する。
  // マニュアル生成など繰り返し実行時に AWS 認証切れの影響を受けにくくするため。
  // （アプリへのログインはブラウザ経由で Cognito を使うため、この最適化の対象外。）
  // E2E_FORCE_USER_PROVISION=1 で強制的に再プロビジョニングできる。
  const forceProvision = process.env.E2E_FORCE_USER_PROVISION === '1';
  if (!forceProvision && fs.existsSync(TEST_USERS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(TEST_USERS_FILE, 'utf-8'));
      if (existing?.teamLeader?.email && existing?.reviewer?.email) {
        console.log('  ✓ 既存の .auth/test-users.json を再利用（AWS 事前確認をスキップ）');
        console.log('🔧 Global Setup 完了\n');
        return;
      }
    } catch {
      // 壊れている場合は通常のプロビジョニングにフォールバック
    }
  }

  // TeamLeader — ensure Cognito user (email-free) + DynamoDB record.
  const leaderUserId = crypto.randomUUID();
  const leaderResolvedId = await ensureDualUser({
    email: LEADER_EMAIL,
    password: testPassword,
    role: 'TEAM_LEADER',
    displayName: 'E2E テストリーダー',
    candidateUserId: leaderUserId,
  });
  console.log(`  ✓ TeamLeader 準備完了: ${LEADER_EMAIL}`);

  // Reviewer — ensure Cognito user (email-free) + DynamoDB record.
  const reviewerUserId = crypto.randomUUID();
  const reviewerResolvedId = await ensureDualUser({
    email: REVIEWER_EMAIL,
    password: testPassword,
    role: 'REVIEWER',
    displayName: 'E2E テストレビュアー',
    candidateUserId: reviewerUserId,
  });
  console.log(`  ✓ Reviewer 準備完了: ${REVIEWER_EMAIL}`);

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const testUsers = {
    createdAt: new Date().toISOString(),
    teamLeader: {
      userId: leaderResolvedId,
      email: LEADER_EMAIL,
      displayName: 'E2E テストリーダー',
      role: 'TEAM_LEADER',
      password: testPassword,
    },
    reviewer: {
      userId: reviewerResolvedId,
      email: REVIEWER_EMAIL,
      displayName: 'E2E テストレビュアー',
      role: 'REVIEWER',
      password: testPassword,
    },
    teamId: TEAM_ID,
  };

  fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));
  console.log('  ✓ テストユーザー情報を .auth/test-users.json に保存');
  console.log('🔧 Global Setup 完了\n');
}

/**
 * Ensure both the Cognito user (email-free) and the DynamoDB user record exist
 * for an email, returning the canonical DynamoDB userId (the one extractUser
 * resolves by email). Idempotent and reuse-friendly.
 */
async function ensureDualUser(params: {
  email: string;
  password: string;
  role: 'TEAM_LEADER' | 'REVIEWER' | 'ADMIN';
  displayName: string;
  candidateUserId: string;
}): Promise<string> {
  await ensureCognitoUser({
    email: params.email,
    password: params.password,
    role: params.role,
    displayName: params.displayName,
  });
  // The canonical userId is the DynamoDB record's userId (extractUser resolves
  // by email, not by Cognito sub). Create the record if missing.
  const resolvedId = await ensureUserRecord({
    userId: params.candidateUserId,
    email: params.email,
    displayName: params.displayName,
    role: params.role,
  });
  return resolvedId;
}
