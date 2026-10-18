import { test, expect } from '../../fixtures/auth.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('メディアアップロードページ', () => {
  test.beforeEach(async ({ page, loginAsReviewer }) => {
    await loginAsReviewer(page);
    await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();
    await expect(page).toHaveURL(/\/upload/);
  });

  test('5.1 アップロードエリアが表示される', async ({ page }) => {
    await expect(
      page.getByRole('main', { name: 'メディアアップロード' })
    ).toBeVisible();

    // ドロップエリア
    await expect(
      page.getByRole('button', { name: 'ファイルを選択またはドラッグ＆ドロップ' })
    ).toBeVisible();

    // 対応形式情報
    await expect(page.getByText(/対応形式/).first()).toBeVisible();
    await expect(page.getByText(/mp3.*wav.*flac/).first()).toBeVisible();
  });

  test('5.2 ファイルを選択するとファイル情報が表示される', async ({ page }) => {
    // ファイル入力を操作
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(1024, 0),
    });

    // ファイル名とサイズが表示される
    await expect(page.getByText('test-audio.mp3')).toBeVisible();
    await expect(page.getByLabel('選択されたファイル')).toBeVisible();
  });

  test('5.3 非対応形式のファイルでバリデーションエラーが表示される', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(1024, 0),
    });

    await expect(
      page.getByRole('alert')
    ).toContainText('サポートされていないファイル形式です');
  });

  test('5.9 ファイル選択の「取消」ボタンで選択が解除される', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(1024, 0),
    });

    await expect(page.getByText('test-audio.mp3')).toBeVisible();

    await page.getByRole('button', { name: 'ファイル選択を解除' }).click();
    await expect(page.getByText('test-audio.mp3')).toBeHidden();
  });

  test('5.5 アップロード開始ボタンをクリックするとアップロードが開始される', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(1024, 0),
    });

    const uploadButton = page.getByRole('button', { name: 'アップロード開始' });
    await expect(uploadButton).toBeEnabled();
    await uploadButton.click();

    // アップロード準備中 or アップロード中テキストが表示される
    await expect(
      page.getByText(/アップロード準備中|アップロード中/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('5.10 アップロード中はボタンが無効化される', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(1024, 0),
    });

    await page.getByRole('button', { name: 'アップロード開始' }).click();

    // アップロード中はボタンがdisabled
    await expect(
      page.getByRole('button', { name: 'アップロード中...' })
    ).toBeDisabled();
  });
});
