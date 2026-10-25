import { test, expect } from '../../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';

/**
 * メディアアップロードページのテスト。
 *
 * 実アップロードは S3 バケットを汚すため、presigned URL 取得（POST /upload-url）と
 * S3 PUT をルートインターセプトで固定し、UI の状態遷移のみを検証する。
 */

// presigned URL は BASE_URL と同一オリジンにし、クロスオリジン XHR の CORS
// プリフライト（OPTIONS）を回避する（同一オリジン PUT はプリフライト不要）。
const UPLOAD_TARGET = new URL('/e2e-upload-put', process.env.BASE_URL).toString();

/** POST /upload-url と S3 PUT を成功で固定する。 */
async function stubUpload(page: Page, mediaFileId = 'e2e-uploaded-001') {
  await page.route(/\/upload-url$/, (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        presignedUrl: UPLOAD_TARGET,
        mediaFileId,
        s3Key: `media/${mediaFileId}/test-audio.mp3`,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
  // presigned URL への PUT を 200 で返す（実 S3 を叩かない）。
  // クロスオリジン XHR が成功扱いになるよう CORS ヘッダを付与する。
  await page.route(UPLOAD_TARGET, (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      body: '',
    });
  });
}

const AUDIO_FILE = {
  name: 'test-audio.mp3',
  mimeType: 'audio/mpeg',
  buffer: Buffer.alloc(1024, 0),
};

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
    await expect(
      page.getByRole('button', { name: /ファイルを選択 ?またはドラッグ＆ドロップ/ })
    ).toBeVisible();
    await expect(page.getByText(/対応形式/).first()).toBeVisible();
  });

  test('5.2 ファイルを選択するとファイル情報が表示される', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await expect(page.getByText('test-audio.mp3')).toBeVisible();
    await expect(page.getByLabel('選択されたファイル')).toBeVisible();
  });

  test('5.3 非対応形式のファイルでバリデーションエラーが表示される', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(1024, 0),
    });
    await expect(page.getByRole('alert')).toContainText(
      'サポートされていないファイル形式です'
    );
  });

  test('5.4 2GB 超のファイルでサイズエラーが表示される', async ({ page }) => {
    // 2GB のバッファは非現実的なので、File.size を細工して巨大サイズに見せる。
    // 特定ファイル名のときだけ 3GB を返すよう size ゲッターを上書きする。
    await page.addInitScript(() => {
      const originalSize = Object.getOwnPropertyDescriptor(
        File.prototype,
        'size'
      );
      Object.defineProperty(File.prototype, 'size', {
        get(this: File) {
          if (this.name === 'huge-file.mp3') {
            return 3 * 1024 * 1024 * 1024; // 3GB
          }
          return originalSize?.get?.call(this) ?? 0;
        },
        configurable: true,
      });
    });
    // init script を効かせるため再読込
    await page.reload();
    await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge-file.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.alloc(1024, 0),
    });
    await expect(page.getByRole('alert')).toContainText(
      'ファイルサイズが上限'
    );
  });

  test('5.5 アップロード開始ボタンをクリックするとアップロードが開始される', async ({ page }) => {
    await stubUpload(page);
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    const uploadButton = page.getByRole('button', { name: 'アップロード開始' });
    await expect(uploadButton).toBeEnabled();
    await uploadButton.click();
    await expect(
      page.getByText(/アップロード準備中|アップロード中|アップロードが完了/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('5.6 アップロード準備中の表示が出る', async ({ page }) => {
    // upload-url 応答を遅延させ、「アップロード準備中...」を観測する。
    await page.route(/\/upload-url$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((r) => setTimeout(r, 2_000));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          presignedUrl: UPLOAD_TARGET,
          mediaFileId: 'e2e-prep-001',
          s3Key: 'media/x/test-audio.mp3',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      });
    });
    await page.route(UPLOAD_TARGET, (route: Route) =>
      route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        body: '',
      })
    );
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await page.getByRole('button', { name: 'アップロード開始' }).click();
    await expect(page.getByText('アップロード準備中...')).toBeVisible({ timeout: 5_000 });
  });

  test('5.7 アップロード完了後に成功メッセージとファイルIDが表示される', async ({ page }) => {
    await stubUpload(page, 'e2e-success-123');
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await page.getByRole('button', { name: 'アップロード開始' }).click();

    await expect(page.getByText('アップロードが完了しました')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/e2e-success-123/)).toBeVisible();
  });

  test('5.8 完了後「別のファイルをアップロード」でリセットされる', async ({ page }) => {
    await stubUpload(page);
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await page.getByRole('button', { name: 'アップロード開始' }).click();
    await expect(page.getByText('アップロードが完了しました')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '別のファイルをアップロード' }).click();
    // リセット後はファイル情報が消え、アップロード開始ボタンに戻る
    await expect(page.getByText('test-audio.mp3')).toBeHidden();
    await expect(page.getByRole('button', { name: 'アップロード開始' })).toBeVisible();
  });

  test('5.9 ファイル選択の「取消」ボタンで選択が解除される', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await expect(page.getByText('test-audio.mp3')).toBeVisible();
    await page.getByRole('button', { name: 'ファイル選択を解除' }).click();
    await expect(page.getByText('test-audio.mp3')).toBeHidden();
  });

  test('5.10 アップロード中はボタンが無効化される', async ({ page }) => {
    // S3 PUT を遅延させ、アップロード中（disabled）状態を観測する。
    await page.route(/\/upload-url$/, (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          presignedUrl: UPLOAD_TARGET,
          mediaFileId: 'e2e-inflight-001',
          s3Key: 'media/x/test-audio.mp3',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      });
    });
    await page.route(UPLOAD_TARGET, async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      await new Promise((r) => setTimeout(r, 2_000));
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        body: '',
      });
    });
    await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
    await page.getByRole('button', { name: 'アップロード開始' }).click();
    await expect(
      page.getByRole('button', { name: 'アップロード中...' })
    ).toBeDisabled();
  });

  test('5.11 ドラッグオーバー時にエリアのスタイルが変わる', async ({ page }) => {
    // a11y 構造修正後、ドラッグ&ドロップのハンドラとボーダー変化は role="button" の
    // 内側ノードではなく、それを包む外側のドロップ領域（border-dashed コンテナ）にある。
    const dropButton = page.getByRole('button', {
      name: /ファイルを選択 ?またはドラッグ＆ドロップ/,
    });
    await expect(dropButton).toBeVisible();
    // onDragOver を持つ外側コンテナ（border-dashed）を親から特定する。
    const dropArea = dropButton.locator(
      'xpath=ancestor::div[contains(@class,"border-dashed")][1]'
    );
    await expect(dropArea).toBeVisible();
    // 実 DataTransfer を持つ dragover を外側コンテナに発火し、ボーダーが青に変わることを確認する。
    await dropArea.evaluate((el) => {
      const dt = new DataTransfer();
      el.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(dropArea).toHaveClass(/border-blue-400/);
  });
});
