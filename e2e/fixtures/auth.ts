import { test as base, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TestUserInfo {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  password: string;
}

interface TestUsers {
  createdAt: string;
  teamLeader: TestUserInfo;
  reviewer: TestUserInfo;
  teamId: string;
}

function loadTestUsers(): TestUsers {
  const filePath = path.resolve(__dirname, '../.auth/test-users.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * ログインフォームを使って認証する共通処理
 */
async function loginWithForm(page: Page, email: string, password: string, expectAdminMenu = false) {
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  // セッション一覧ページへの遷移を待つ
  await page.waitForSelector('[aria-label="校閲セッション一覧"], [aria-label="メインナビゲーション"]', {
    timeout: 30_000,
  });
  // Admin/TeamLeaderの場合、ロール情報の反映を待つ（/me API完了後にナビが更新される）
  if (expectAdminMenu) {
    await page.getByRole('menuitem', { name: '管理', exact: true }).waitFor({ timeout: 10_000 });
  }
}

type AuthFixtures = {
  loginAsAdmin: (page: Page) => Promise<void>;
  loginAsTeamLeader: (page: Page) => Promise<void>;
  loginAsReviewer: (page: Page) => Promise<void>;
  testUsers: TestUsers;
};

export const test = base.extend<AuthFixtures>({
  loginAsAdmin: async ({}, use) => {
    const login = async (page: Page) => {
      await page.goto('./');
      await loginWithForm(
        page,
        process.env.ADMIN_EMAIL!,
        process.env.ADMIN_PASSWORD!,
        true
      );
    };
    await use(login);
  },

  loginAsTeamLeader: async ({}, use) => {
    const users = loadTestUsers();
    const login = async (page: Page) => {
      await page.goto('./');
      await loginWithForm(page, users.teamLeader.email, users.teamLeader.password);
      // TeamLeader role の反映を待つ
      await page.getByRole('menuitem', { name: '言語モデル管理' }).waitFor({ timeout: 10_000 });
    };
    await use(login);
  },

  loginAsReviewer: async ({}, use) => {
    const users = loadTestUsers();
    const login = async (page: Page) => {
      await page.goto('./');
      await loginWithForm(page, users.reviewer.email, users.reviewer.password);
    };
    await use(login);
  },

  testUsers: async ({}, use) => {
    await use(loadTestUsers());
  },
});

export { expect } from '@playwright/test';
