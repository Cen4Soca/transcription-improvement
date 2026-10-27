import { test } from '../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「アップロード」。
 *
 * メディアファイルのアップロード手順と、続く文字起こしジョブ作成手順を撮影する。
 * 実アップロードは S3 バケットを汚し、実ジョブ起動は Transcribe のコストが発生するため、
 * presigned URL 取得（POST /upload-url）・S3 PUT・メディア一覧・言語モデル一覧・
 * ジョブ開始（POST /transcription-jobs）を page.route で固定し
 * （tests/upload/media-upload.spec.ts と同手法）、UI の状態遷移のみを撮る。
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

/** ジョブ作成フォームの選択肢に出す、固定のメディアファイル ID。 */
const JOB_MEDIA_ID = 'manual-media-001';
const NOW = '2025-01-01T00:00:00.000Z';

/** メディア一覧に返す固定データ（status は UPLOADED でフォームの選択肢に出る）。 */
const STUB_MEDIA_FILES = [
  {
    mediaFileId: JOB_MEDIA_ID,
    filename: '会議録音_サンプル.mp3',
    s3Key: `media/${JOB_MEDIA_ID}/meeting-sample.mp3`,
    contentType: 'audio/mpeg',
    fileSize: 5_242_880,
    uploadedBy: 'manual-user',
    status: 'UPLOADED',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    // 手順 3 のアップロード結果。一覧に現れるまでのポーリングを即座に終わらせる。
    mediaFileId: 'manual-upload-001',
    filename: AUDIO_FILE.name,
    s3Key: `media/manual-upload-001/${AUDIO_FILE.name}`,
    contentType: AUDIO_FILE.mimeType,
    fileSize: AUDIO_FILE.buffer.length,
    uploadedBy: 'manual-user',
    status: 'UPLOADED',
    createdAt: NOW,
    updatedAt: NOW,
  },
];

/**
 * ジョブ作成フォームが依存する API（メディア一覧・言語モデル一覧・ジョブ開始）を
 * 固定する。ジョブ開始 POST は実 Transcribe ジョブを起動しないよう成功固定にする。
 */
async function stubTranscriptionJob(page: Page): Promise<void> {
  // メディア一覧（GET のみ）
  await page.route(/\/media-files(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { mediaFiles: STUB_MEDIA_FILES } }),
    });
  });
  // カスタム言語モデル一覧（GET のみ）
  await page.route(/\/language-models(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          {
            modelName: 'e2e-sample-model',
            modelStatus: 'COMPLETED',
            displayName: 'サンプル言語モデル',
            baseModelName: 'WideBand',
            createTime: NOW,
          },
        ],
      }),
    });
  });
  // ジョブ開始（POST のみ）
  await page.route(/\/transcription-jobs$/, (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'manual-job-001',
        transcribeJobName: 'manual-job-001',
        mediaFileId: JOB_MEDIA_ID,
        status: 'IN_PROGRESS',
        languageCode: 'ja-JP',
        maxSpeakerLabels: 3,
        startedBy: 'manual-user',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    });
  });
}

test('manual: アップロード', async ({ page, loginAsReviewer }) => {
  const rec = new ManualRecorder(page, 'アップロード', 'upload');

  // upload-url 取得と S3 PUT、ジョブ作成フォームの依存 API を固定してから操作を始める。
  await stubUpload(page);
  await stubTranscriptionJob(page);

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

  // 4. 文字起こしジョブを作成する
  const jobSection = page.getByRole('region', { name: '文字起こしジョブ作成セクション' });
  await jobSection.scrollIntoViewIfNeeded().catch(() => {});
  // メディア一覧とモデル一覧の取得を待ってから入力する
  await page
    .locator('#media-file-select option[value="' + JOB_MEDIA_ID + '"]')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => {});
  await page.locator('#language-model-select').waitFor({ timeout: 5_000 }).catch(() => {});
  await page.locator('#media-file-select').selectOption(JOB_MEDIA_ID).catch(() => {});
  await page.locator('#max-speaker-labels').fill('3').catch(() => {});
  await page.locator('#language-model-select').selectOption('e2e-sample-model').catch(() => {});
  await jobSection.scrollIntoViewIfNeeded().catch(() => {});
  await rec.capture({
    title: '文字起こしジョブを作成する',
    description:
      'アップロードしたメディアは、画面下部の「文字起こしジョブ作成」フォームから文字起こしを依頼します。「メディアファイル」では、アップロード済みのファイルを一覧から選びます。「最大話者数」には音声に登場する話者の人数を 2〜10 の範囲で入力します（既定は 2 名）。「言語」では音声の言語を選択します（既定は日本語）。「カスタム言語モデル（オプション）」は、専門用語や固有名詞の認識精度を高めたいときに利用できる任意の項目で、使わない場合は「モデルを使用しない」のままで構いません。利用できるモデルがない場合は「利用可能なモデルなし」と表示されます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 300,
  });

  // 5. 文字起こしジョブを開始する
  await page.getByRole('button', { name: '文字起こしジョブを開始' }).click().catch(() => {});
  // 成功するとセッション一覧（/）へ遷移する。遷移しなくても進めるよう短く待つ。
  await page.waitForURL((url) => url.pathname === '/', { timeout: 5_000 }).catch(() => {});
  await rec.capture({
    title: '文字起こしジョブを開始する',
    description:
      '入力内容を確認して「文字起こしジョブを開始」ボタンを押すと、Amazon Transcribe による文字起こしが始まり、自動的にセッション一覧に移動します。文字起こしには音声の長さに応じて時間がかかります。完了すると、そのメディアのセッションがセッション一覧に表示され、校閲を始められます。完了までは画面を開いたままにする必要はありません。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  rec.flush();
});
