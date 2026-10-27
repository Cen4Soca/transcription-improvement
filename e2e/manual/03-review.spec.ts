import { test } from '../fixtures/auth.js';
import { SEEDED_MEDIA_SESSION_IDS } from '../helpers/ui-helper.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「文字起こし校閲」。
 *
 * 校閲画面の全体構成、セグメント編集、音声同期再生、AI 修正候補、
 * レイアウト切り替え、修正後 Transcription のダウンロードを撮影する。seed のメディア紐付きセッション
 * （e2e-session-001: 音声 + 5 セグメント）へ直接遷移して撮る。
 *
 * AI 修正候補は外部 API（Bedrock / Comprehend）に依存しコスト・非決定性が
 * あるため、候補取得エンドポイントを固定レスポンスに差し替えて決定論的に撮影する。
 */

/** メディア紐付きセッション id（segments + 音声あり）。 */
const MEDIA_SESSION = SEEDED_MEDIA_SESSION_IDS[0]; // e2e-session-001

/** 撮影用の固定修正候補レスポンス。suggestions エンドポイントに注入する。 */
const STUB_SUGGESTIONS = {
  suggestions: [
    { text: '本日はお集まりいただきありがとうございます。', source: 'history' },
    { text: '本日はお集まり頂き誠にありがとうございます。', source: 'bedrock' },
    { text: '本日は御集まりいただき有難うございます。', source: 'comprehend' },
  ],
  hasExternalApiError: false,
};

/** 撮影用の固定ダウンロードレスポンス（JSON）。 */
const STUB_DOWNLOAD_JSON = {
  sessionName: 'e2e-session-001',
  exportedAt: '2025-01-01T00:00:00.000Z',
  segments: [
    { startTime: 0, endTime: 4.2, text: '本日はお集まりいただきありがとうございます。' },
  ],
};

/** 撮影用の固定ダウンロードレスポンス（SRT）。 */
const STUB_DOWNLOAD_SRT =
  '1\n00:00:00,000 --> 00:00:04,200\n本日はお集まりいただきありがとうございます。\n';

test('manual: 文字起こし校閲', async ({ page, loginAsAdmin }) => {
  const rec = new ManualRecorder(page, '文字起こし校閲', 'review');

  // 修正候補取得 API（GET /sessions/{id}/suggestions?...）を固定レスポンスに
  // 差し替える。本番 API を呼ばず、スクショを決定論的にするため。
  await page.route(/\/sessions\/[^/]+\/suggestions(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_SUGGESTIONS),
    });
  });

  // 修正後 Transcription ダウンロード API（GET /sessions/{id}/download?format=...）を
  // 固定レスポンスに差し替える。実データ取得を避け、確定済みセグメントの有無に
  // 依存しないようにするため。ApiClient はエンベロープ無しで JSON / テキストをそのまま読む。
  await page.route(/\/sessions\/[^/]+\/download(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const format = new URL(route.request().url()).searchParams.get('format');
    if (format === 'srt') {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: STUB_DOWNLOAD_SRT,
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_DOWNLOAD_JSON),
    });
  });

  // ログインして校閲画面へ遷移
  await loginAsAdmin(page);
  await page.goto(`./sessions/${MEDIA_SESSION}`);
  await page
    .getByRole('main', { name: '校閲画面' })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});

  // 1. 校閲画面の全体構成
  await rec.capture({
    title: '校閲画面の全体構成',
    description:
      'セッションを開くと校閲画面が表示されます。左側（または上側）に文字起こしパネル、右側（または下側）にメディアパネルが並びます。文字起こしパネルにはセグメント（発話区間）が時系列で一覧表示され、メディアパネルで音声・動画を再生しながら校閲できます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  // セグメント一覧の先頭を取得
  const segments = page
    .getByRole('list', { name: '文字起こしセグメント一覧' })
    .getByRole('listitem');

  // 2. セグメントを選んで編集する
  await segments.first().click().catch(() => {});
  await page
    .getByLabel('編集テキスト')
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: 'セグメントを選んで編集する',
    description:
      '編集したいセグメントをクリックすると、そのセグメントが編集モードになり、テキスト入力欄が表示されます。選択中のセグメントはハイライト表示され、該当する再生位置にジャンプします。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 3. 編集を確定する
  const textarea = page.getByLabel('編集テキスト').first();
  await textarea.fill('本日はお集まりいただきありがとうございます。').catch(() => {});
  await page
    .getByRole('button', { name: '編集を確定' })
    .first()
    .click()
    .catch(() => {});
  // 確定後は修正前／修正後が並んで表示される
  await page
    .getByLabel('修正後のテキスト')
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: '編集を確定する',
    description:
      'テキストを修正して「編集を確定」ボタンを押すと、修正内容が保存されます。確定後のセグメントには修正前のテキスト（取り消し線）と修正後のテキストが並べて表示され、どこを直したか一目で分かります。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 4. 音声と同期して再生する
  await page
    .getByRole('region', { name: 'メディアプレイヤー' })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await rec.capture({
    title: '音声と同期して再生する',
    description:
      'メディアプレイヤーの再生ボタンで音声・動画を再生できます。シークバーで任意の位置へ移動でき、再生速度（0.5〜2.0倍）も切り替えられます。再生位置に対応するセグメントは自動でハイライトされるため、聞きながら正確に校閲できます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 5. AI 修正候補を表示する
  await segments
    .first()
    .getByRole('button', { name: '修正候補を表示' })
    .click()
    .catch(() => {});
  await page
    .getByRole('dialog', { name: '修正候補' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: 'AI 修正候補を表示する',
    description:
      '「修正候補を表示」ボタンを押すと、過去の修正履歴や AI（Bedrock・Comprehend）から生成された修正候補が最大 5 件表示されます。候補一覧から選ぶだけで修正を適用でき、入力の手間を減らせます。候補が無い場合は「直接編集する」から手入力に切り替えられます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });
  // ポップアップを閉じてレイアウト撮影に備える
  await page.getByRole('dialog', { name: '修正候補' }).getByRole('button', { name: '閉じる' }).click().catch(() => {});

  // 6. レイアウトを切り替える
  await page
    .getByRole('button', { name: 'レイアウトを上下分割に切り替え' })
    .click()
    .catch(() => {});
  await page
    .getByRole('button', { name: 'レイアウトを左右分割に切り替え' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: 'レイアウトを切り替える',
    description:
      '文字起こしパネルとメディアパネルの配置は、左右分割と上下分割を切り替えられます。画面サイズや作業スタイルに合わせて見やすいレイアウトを選んでください。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 7. 修正後 Transcription をダウンロードする
  // 手順 6 で上下分割に切り替わっているため、左右分割に戻してから撮影する
  await page
    .getByRole('button', { name: 'レイアウトを左右分割に切り替え' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  const downloadSection = page.locator('div[aria-label="Transcription ダウンロード"]');
  await downloadSection
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
    .catch(() => {});
  // 形式選択の UI が伝わるよう SRT を選択した状態にする（JSON / SRT 両方が写る）
  await downloadSection
    .getByLabel('SRT')
    .check({ timeout: 5_000 })
    .catch(() => {});
  await rec.capture({
    title: '修正後 Transcription をダウンロードする',
    description:
      '校閲画面下部の「修正後 Transcription ダウンロード」で、ダウンロード形式（JSON または SRT）を選んで「ダウンロード」ボタンを押すと、修正後の文字起こしをファイルとして取得できます。JSON は分析やほかのシステムでの再利用に、SRT は字幕ツールや動画編集ソフトでの利用に向いています。ファイル名は「セッション名_日付.拡張子」（例: e2e-session-001_20250101.srt）になります。確定済みのセグメントがまだ無い場合は、エラーメッセージが表示されダウンロードされません。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: false,
    settleMs: 300,
  });

  rec.flush();
});
