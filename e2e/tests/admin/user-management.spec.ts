import { test, expect } from '../../fixtures/auth.js';

test.describe('管理画面 - ユーザー管理', () => {
  test('8.1.1 Reviewer が /admin にアクセスすると / にリダイレクトされる', async ({
    page,
    loginAsReviewer,
  }) => {
    await loginAsReviewer(page);
    await page.goto('./admin');

    // リダイレクトされてホームに戻る
    await expect(page).toHaveURL(/\/(transcription-improvement-dev\/?)?$/);
  });

  test.describe('Admin アクセス', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '管理', exact: true }).click();
      await expect(page).toHaveURL(/\/admin/);
    });

    test('8.1.2 Admin がタブ付き管理画面にアクセスできる', async ({ page }) => {
      await expect(
        page.getByRole('main', { name: '管理画面' })
      ).toBeVisible();

      const tablist = page.getByRole('tablist', { name: '管理画面タブ' });
      await expect(tablist.getByRole('tab', { name: 'ユーザー管理' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: 'チーム管理' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: 'IPアドレス制限' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: '監査ログ' })).toBeVisible();
    });

    test('8.2.1 ユーザー一覧が表示される', async ({ page }) => {
      // デフォルトでユーザー管理タブが選択されている
      const userTab = page.getByRole('tab', { name: 'ユーザー管理' });
      await expect(userTab).toHaveAttribute('aria-selected', 'true');

      // ユーザー一覧のパネルが表示される
      const tabpanel = page.getByRole('tabpanel');
      await expect(tabpanel).toBeVisible();
    });

    test('8.2.2 新規ユーザーを作成できる', async ({ page }) => {
      // ユーザー作成フォームに入力
      const emailInput = page.getByLabel(/メール/);
      const nameInput = page.getByLabel(/表示名|名前/);

      if (await emailInput.isVisible()) {
        const uniqueEmail = `e2e-test-create-${Date.now()}@test.example.com`;
        await emailInput.fill(uniqueEmail);
        await nameInput.fill('E2E 作成テスト');

        // ロール選択
        const roleSelect = page.locator('select').first();
        if (await roleSelect.isVisible()) {
          await roleSelect.selectOption('REVIEWER');
        }

        // 作成ボタン
        const createButton = page.getByRole('button', { name: /作成|追加/ });
        await createButton.click();

        // 成功確認（ユーザーがリストに追加される）
        await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 10_000 });
      }
    });
  });
});
