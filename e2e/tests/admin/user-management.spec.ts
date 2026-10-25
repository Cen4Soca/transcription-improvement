import { test, expect } from '../../fixtures/auth.js';
import { openAdminTab } from '../../helpers/ui-helper.js';

test.describe('管理画面 - ユーザー管理', () => {
  test('8.1.1 Reviewer が /admin にアクセスすると / にリダイレクトされる', async ({
    page,
    loginAsReviewer,
  }) => {
    await loginAsReviewer(page);
    await page.goto('./admin');
    await expect(page).toHaveURL(/\/(transcription-improvement-dev\/?)?$/);
  });

  test.describe('Admin アクセス', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '管理', exact: true }).click();
      await expect(page).toHaveURL(/\/admin/);
    });

    test('8.1.2 Admin がタブ付き管理画面にアクセスできる', async ({ page }) => {
      await expect(page.getByRole('main', { name: '管理画面' })).toBeVisible();
      const tablist = page.getByRole('tablist', { name: '管理画面タブ' });
      await expect(tablist.getByRole('tab', { name: 'ユーザー管理' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: 'チーム管理' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: 'IPアドレス制限' })).toBeVisible();
      await expect(tablist.getByRole('tab', { name: '監査ログ' })).toBeVisible();
    });

    test('8.2.1 ユーザー一覧が表示される', async ({ page }) => {
      const userTab = page.getByRole('tab', { name: 'ユーザー管理' });
      await expect(userTab).toHaveAttribute('aria-selected', 'true');
      // 一覧テーブルが表示される（globalSetup の実ユーザーが存在する）
      await expect(
        page.getByRole('table', { name: 'ユーザー一覧テーブル' })
      ).toBeVisible();
    });

    test('8.2.2 新規ユーザーを作成できる', async ({ page }) => {
      const uniqueEmail = `e2e-ui-create-${Date.now()}@test.example.com`;
      await page.getByRole('button', { name: 'ユーザー追加' }).click();

      const form = page.getByRole('form', { name: 'ユーザー登録フォーム' });
      await form.getByLabel('メールアドレス').fill(uniqueEmail);
      await form.getByLabel('表示名').fill('E2E UI 作成テスト');
      await form.getByLabel('ロール').selectOption('REVIEWER');
      await form.getByRole('button', { name: '登録' }).click();

      // 作成されたユーザーが一覧に出る
      await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 15_000 });
    });

    test('8.2.3 ユーザーを無効化・再有効化できる', async ({ page }) => {
      // まず無効化対象の専用ユーザーを作成する（実操作・dev 環境）。
      const email = `e2e-ui-disable-${Date.now()}@test.example.com`;
      await page.getByRole('button', { name: 'ユーザー追加' }).click();
      const form = page.getByRole('form', { name: 'ユーザー登録フォーム' });
      await form.getByLabel('メールアドレス').fill(email);
      await form.getByLabel('表示名').fill('E2E 無効化対象');
      await form.getByLabel('ロール').selectOption('REVIEWER');
      await form.getByRole('button', { name: '登録' }).click();
      await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });

      // 作成ユーザーの行を特定し、無効化する
      const row = page.getByRole('row', { name: new RegExp(email) });
      await row.getByRole('button', { name: /を無効化$/ }).click();

      // 確認ダイアログ → 無効化する
      const disableDialog = page.getByRole('dialog', { name: 'ユーザー無効化の確認' });
      await expect(disableDialog).toBeVisible();
      await disableDialog.getByRole('button', { name: '無効化する' }).click();

      // ステータスが「無効」になり、有効化ボタンが出る
      await expect(row.getByText('無効')).toBeVisible({ timeout: 15_000 });

      // 後始末も兼ねて再有効化を検証する
      await row.getByRole('button', { name: /を有効化$/ }).click();
      const enableDialog = page.getByRole('dialog', { name: 'ユーザー有効化の確認' });
      await expect(enableDialog).toBeVisible();
      await enableDialog.getByRole('button', { name: '有効化する' }).click();
      await expect(row.getByText('有効')).toBeVisible({ timeout: 15_000 });
    });
  });
});
