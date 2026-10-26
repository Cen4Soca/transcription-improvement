import { test } from '../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「アップロード」。
 *
 * メディアファイルのアップロード手順を撮影する。実アップロードは S3 バケットを
 * 汚すため、presigned URL 取得（POST /upload-url）と S3 PUT を page.route で
 * 成功固定し（tests/upload/media-upload.spec.ts と同手法）、UI の状態遷移のみを撮る。
 */

// presigned URL は BASE_URL と同一オリジンにし、クロスオリジン XHR の CORS
// プリフライト（OPTIONS）を回避する（同一オリジン PUT はプリフライト不要）。
const UPLOAD_TARGET = new URL('/e2e-upload-put', process.env.BASE_URL).toString();

/** 撮影用のダミー音声ファイル（小さなバッファ）。 */
const AUDIO_FILE = {
  name: 'sample-audio.mp3',
  mimeType: 'audio/mpeg',
  buffer: Buffer.alloc(1024, 0),
};

/** POST /upload-url と S3 PUT を成功で固定する（実 S3 を叩かない）。 */
async function stubUpload(page: Page, mediaFileId = 'manual-upload-001'): Promise<void> {
  await page.route(/\/upload-url$/, (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        presignedUrl: UPLOAD_TARGET,
        mediaFileId,
        s3Key: `media/${mediaFileId}/${AUDIO_FILE.name}`,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
  // presigned URL への PUT を 200 で返す。クロスオリジン XHR が成功扱いになるよう
  // CORS ヘッダを付与する。
  await page.route(UPLOAD_TARGET, (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      body: '',
    });
  });
}

test('manual: アップロード', async ({ page, loginAsReviewer }) => {
  const rec = new ManualRecorder(page, 'アップロード', 'upload');

  // upload-url 取得と S3 PUT を成功固定してから操作を始める。
  await stubUpload(page);

  // ログインしてアップロード画面へ遷移
  await loginAsReviewer(page);
  await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();
  await page.waitForURL(/\/upload/, { timeout: 15_000 });

  // 1. アップロード画面
  await page
    .getByRole('main', { name: 'メディアアップロード' })
    .waitFor({ timeout: 15_000 });
  await rec.capture({
    title: 'アップロード画面',
    description:
      'ナビゲーションの「メディアアップロード」を選ぶと、アップロード画面が表示されます。「ファイルを選択」ボタンを押すか、ファイルを枠内にドラッグ＆ドロップしてアップロードするメディアを指定します。対応形式（音声・動画）の案内も画面に表示されます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 2. ファイルを選択する
  await page.locator('input[type="file"]').setInputFiles(AUDIO_FILE);
  await page.getByLabel('選択されたファイル').waitFor({ timeout: 15_000 });
  await rec.capture({
    title: 'ファイルを選択する',
    description:
      'ファイルを選択すると、ファイル名やサイズなどの情報が表示されます。内容を確認し、問題がなければ「アップロード開始」ボタンを押してください。選択をやり直す場合は「ファイル選択を解除」ボタンで解除できます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 3. アップロードを開始する
  await page.getByRole('button', { name: 'アップロード開始' }).click();
  await page
    .getByText(/アップロード準備中|アップロード中|アップロードが完了/)
    .first()
    .waitFor({ timeout: 15_000 });
  await rec.capture({
    title: 'アップロードを開始する',
    description:
      '「アップロード開始」を押すとアップロードが始まり、進捗が表示されます。完了すると成功メッセージとファイル ID が表示されます。続けて別のファイルを登録する場合は「別のファイルをアップロード」ボタンから操作を繰り返せます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  rec.flush();
});
