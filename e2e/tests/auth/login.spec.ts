import { test, expect } from '../../fixtures/auth.js';

test.describe('認証フロー', () => {
  test('1.1 未認証ユーザーがアクセスするとログインフォームが表示される', async ({ page }) => {
    await page.goto('./');
    await expect(
      page.getByRole('button', { name: 'ログイン' })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('1.2 メールアドレスとパスワードでログインできる', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/(transcription-improvement-dev\/?)?$/);
    await expect(
      page.getByRole('main', { name: '校閲セッション一覧' })
    ).toBeVisible();
  });

  test('1.3 無効な認証情報でエラーメッセージが表示される', async ({ page }) => {
    await page.goto('./');
    // ログインフォームが表示されるまで待機
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

    await page.getByLabel('メールアドレス').fill('invalid@example.com');
    await page.getByLabel('パスワード').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'ログイン' }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  });

  test('1.6 ログイン中はボタンが無効化される', async ({ page }) => {
    await page.goto('./');
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

    await page.getByLabel('メールアドレス').fill(process.env.ADMIN_EMAIL!);
    await page.getByLabel('パスワード').fill(process.env.ADMIN_PASSWORD!);

    const loginButton = page.getByRole('button', { name: 'ログイン' });
    await loginButton.click();

    // ボタンが「ログイン中...」テキストに変わりdisabledになる
    await expect(
      page.getByRole('button', { name: 'ログイン中...' })
    ).toBeDisabled();
  });
});
