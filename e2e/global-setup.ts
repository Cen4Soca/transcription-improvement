import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { adminAuth, setUserPassword } from './helpers/cognito-helper.js';
import { createUser, createTeam, addTeamMember } from './helpers/api-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const AUTH_DIR = path.resolve(__dirname, '.auth');
const TEST_USERS_FILE = path.resolve(AUTH_DIR, 'test-users.json');

export default async function globalSetup() {
  console.log('\n🔧 Global Setup: テストユーザーを作成中...');

  const timestamp = Date.now();
  const leaderEmail = `e2e-leader-${timestamp}@test.example.com`;
  const reviewerEmail = `e2e-reviewer-${timestamp}@test.example.com`;
  const testPassword = process.env.TEST_USER_PASSWORD!;

  // 1. Admin でログイン
  const { idToken } = await adminAuth(
    process.env.ADMIN_EMAIL!,
    process.env.ADMIN_PASSWORD!
  );
  console.log('  ✓ Admin ログイン成功');

  // 2. TeamLeader ユーザーを作成
  const leaderRes = await createUser(idToken, {
    email: leaderEmail,
    displayName: 'E2E テストリーダー',
    role: 'TEAM_LEADER',
  });
  console.log(`  ✓ TeamLeader 作成: ${leaderEmail}`);

  // 3. Reviewer ユーザーを作成
  const reviewerRes = await createUser(idToken, {
    email: reviewerEmail,
    displayName: 'E2E テストレビュアー',
    role: 'REVIEWER',
  });
  console.log(`  ✓ Reviewer 作成: ${reviewerEmail}`);

  // 4. Cognito でパスワードを確定（FORCE_CHANGE_PASSWORD 解除）
  await setUserPassword(leaderEmail, testPassword);
  await setUserPassword(reviewerEmail, testPassword);
  console.log('  ✓ パスワード確定完了');

  // 5. チーム作成 + メンバー割り当て
  const teamRes = await createTeam(idToken, `e2e-team-${timestamp}`);
  const teamId = teamRes.data.teamId;
  await addTeamMember(idToken, teamId, leaderRes.data.userId);
  await addTeamMember(idToken, teamId, reviewerRes.data.userId);
  console.log(`  ✓ チーム作成・メンバー割り当て完了: ${teamId}`);

  // 6. ユーザー情報を保存
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const testUsers = {
    createdAt: new Date().toISOString(),
    teamLeader: {
      userId: leaderRes.data.userId,
      email: leaderEmail,
      displayName: 'E2E テストリーダー',
      role: 'TEAM_LEADER',
      password: testPassword,
    },
    reviewer: {
      userId: reviewerRes.data.userId,
      email: reviewerEmail,
      displayName: 'E2E テストレビュアー',
      role: 'REVIEWER',
      password: testPassword,
    },
    teamId,
  };

  fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));
  console.log('  ✓ テストユーザー情報を .auth/test-users.json に保存');
  console.log('🔧 Global Setup 完了\n');
}
