import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { adminAuth } from './helpers/cognito-helper.js';
import { disableUser, deleteTeam } from './helpers/api-helper.js';
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TEST_USERS_FILE = path.resolve(__dirname, '.auth', 'test-users.json');

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || 'ap-northeast-1',
});

export default async function globalTeardown() {
  console.log('\n🧹 Global Teardown: テストユーザーを削除中...');

  if (!fs.existsSync(TEST_USERS_FILE)) {
    console.log('  ⚠ test-users.json が見つかりません。スキップします。');
    return;
  }

  const testUsers = JSON.parse(fs.readFileSync(TEST_USERS_FILE, 'utf-8'));

  let idToken: string;
  try {
    const auth = await adminAuth(
      process.env.ADMIN_EMAIL!,
      process.env.ADMIN_PASSWORD!
    );
    idToken = auth.idToken;
    console.log('  ✓ Admin ログイン成功');
  } catch (err) {
    console.error('  ✗ Admin ログイン失敗。手動クリーンアップが必要です。', err);
    return;
  }

  // Reviewer を無効化
  try {
    await disableUser(idToken, testUsers.reviewer.userId);
    console.log(`  ✓ Reviewer 無効化: ${testUsers.reviewer.email}`);
  } catch (err) {
    console.warn(`  ⚠ Reviewer 無効化失敗:`, err);
  }

  // TeamLeader を無効化
  try {
    await disableUser(idToken, testUsers.teamLeader.userId);
    console.log(`  ✓ TeamLeader 無効化: ${testUsers.teamLeader.email}`);
  } catch (err) {
    console.warn(`  ⚠ TeamLeader 無効化失敗:`, err);
  }

  // Cognito からユーザーを完全削除
  for (const user of [testUsers.reviewer, testUsers.teamLeader]) {
    try {
      await cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID!,
          Username: user.email,
        })
      );
      console.log(`  ✓ Cognito 削除: ${user.email}`);
    } catch (err) {
      console.warn(`  ⚠ Cognito 削除失敗 (${user.email}):`, err);
    }
  }

  // チーム削除
  if (testUsers.teamId) {
    try {
      await deleteTeam(idToken, testUsers.teamId);
      console.log(`  ✓ チーム削除: ${testUsers.teamId}`);
    } catch (err) {
      console.warn(`  ⚠ チーム削除失敗:`, err);
    }
  }

  // test-users.json を削除
  try {
    fs.unlinkSync(TEST_USERS_FILE);
    console.log('  ✓ test-users.json 削除');
  } catch {
    // ignore
  }

  console.log('🧹 Global Teardown 完了\n');
}
