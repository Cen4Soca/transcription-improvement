import { test, expect } from '../../fixtures/auth.js';
import {
  createForceChangePasswordUser,
  deleteUser,
} from '../../helpers/cognito-helper.js';

test.describe('認証フロー', () => {
  test('1.1 未認証ユーザーがアクセスするとログインフォームが表示される', async ({ page }) => {
    await page.goto('./');
    await expect(
      page.getByRole('button', { name: 'ログイン' })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await expect(page.getByLabel('パスワード')).toBeVisible();
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
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

    await page.getByLabel('メールアドレス').fill('invalid@example.com');
    await page.getByLabel('パスワード').fill('WrongPassword123!');
    await page.getByRole('button', { name: 'ログイン' }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  });

  test('1.4 初回ログインで新パスワード設定フォームが表示される', async ({ page }) => {
    // FORCE_CHANGE_PASSWORD 状態の専用ユーザーを作成し、一時パスワードで
    // サインインすると NEW_PASSWORD_REQUIRED チャレンジ画面が出ることを検証する。
    const email = `e2e-firstlogin-${Date.now()}@test.example.com`;
    const tempPassword = 'E2eTemp@Password123';
    await createForceChangePasswordUser(email, tempPassword);
    try {
      await page.goto('./');
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
      await page.getByLabel('メールアドレス').fill(email);
      await page.getByLabel('パスワード').fill(tempPassword);
      await page.getByRole('button', { name: 'ログイン' }).click();

      // 新パスワード設定フォームが表示される
      await expect(
        page.getByText('新しいパスワードを設定してください')
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel('新しいパスワード')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'パスワードを設定' })
      ).toBeVisible();
    } finally {
      await deleteUser(email);
    }
  });

  // 1.5 は MFA（TOTP）有効ユーザーが前提。テスト環境に MFA 設定済みユーザーが
  // 存在せず、TOTP を動的に設定・検証するのは不安定なため、前提が整うまで明示 skip する。
  // （LoginForm には TOTP_CODE ステップ UI が実装済み: ラベル「MFA コード」/ ボタン「認証」）
  test.skip('1.5 MFA（TOTP）コード入力画面が表示される', async () => {
    // 前提: MFA 有効ユーザー + TOTP シークレット。環境が整い次第、
    // サインイン → CONFIRM_SIGN_IN_WITH_TOTP_CODE で「MFA コード」入力欄の表示を検証する。
  });

  test('1.6 ログイン中はボタンが無効化される', async ({ page }) => {
    await page.goto('./');
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

    await page.getByLabel('メールアドレス').fill(process.env.ADMIN_EMAIL!);
    await page.getByLabel('パスワード').fill(process.env.ADMIN_PASSWORD!);

    const loginButton = page.getByRole('button', { name: 'ログイン' });
    await loginButton.click();

    await expect(
      page.getByRole('button', { name: 'ログイン中...' })
    ).toBeDisabled();
  });
});
