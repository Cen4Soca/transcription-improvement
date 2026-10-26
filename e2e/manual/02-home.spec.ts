import { test } from '../fixtures/auth.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「ホーム」。
 *
 * ログイン直後のホーム（校閲セッション一覧）を起点に、ステータス絞り込み・
 * ページネーション・メインナビゲーションを撮影する。全ロール共通の入口機能。
 *
 * seed データ（65 セッション）を前提とし、ステータスフィルターやページネーションが
 * 表示される状態を撮る。クリックや待機は spec の目的（スクショ収集）上、UI 差異で
 * 止まらないよう防御的に .catch(() => {}) で握りつぶす。
 */
test('manual: ホーム', async ({ page, loginAsAdmin }) => {
  const rec = new ManualRecorder(page, 'ホーム', 'home');

  // 全リンクを撮影できるよう Admin でログインしてホーム（校閲セッション一覧）へ
  await loginAsAdmin(page);
  await page
    .getByRole('main', { name: '校閲セッション一覧' })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});

  // 1. 校閲セッション一覧
  await page
    .getByRole('list', { name: 'セッション一覧' })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await rec.capture({
    title: '校閲セッション一覧',
    description:
      'ログイン後のホーム画面には、校閲対象のセッションが一覧表示されます。各行にはセッション名・ステータス（未着手／進行中／完了）・作成日時が表示され、「校閲画面を開く」から校閲作業を開始できます。一覧は作成日時の新しい順に並びます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 500,
  });

  // 2. ステータスで絞り込む（「進行中」を選択した状態）
  await page
    .getByRole('tablist', { name: 'ステータスフィルター' })
    .getByRole('tab', { name: '進行中' })
    .click()
    .catch(() => {});
  await page
    .getByRole('tablist', { name: 'ステータスフィルター' })
    .getByRole('tab', { name: '進行中' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: 'ステータスで絞り込む',
    description:
      'ステータスフィルターで「全て」「未着手」「進行中」「完了」を切り替えると、その状態のセッションだけに一覧が絞り込まれます。ここでは「進行中」を選択し、作業中のセッションだけを表示した状態です。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 500,
  });

  // 3. ページを移動する（ページネーションを表示）
  // 「全て」に戻すと全 65 件となりページネーションが表示される。
  await page
    .getByRole('tablist', { name: 'ステータスフィルター' })
    .getByRole('tab', { name: '全て' })
    .click()
    .catch(() => {});
  await page
    .getByRole('navigation', { name: 'ページネーション' })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page
    .getByRole('navigation', { name: 'ページネーション' })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await rec.capture({
    title: 'ページを移動する',
    description:
      'セッション件数が多い場合、一覧の下部にページネーションが表示されます。「次へ」「前へ」ボタンでページを移動でき、現在のページ番号と総ページ数を確認できます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 300,
  });

  // 4. メインナビゲーション
  await page
    .getByRole('navigation', { name: 'メインナビゲーション' })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await rec.capture({
    title: 'メインナビゲーション',
    description:
      '画面上部のメインナビゲーションから各機能に移動できます。「セッション一覧」「メディアアップロード」「ランキング」は全ユーザーに表示され、ロールに応じて「言語モデル管理」「管理」メニューが追加されます。現在表示中のページはハイライトされます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: false,
    settleMs: 300,
  });

  rec.flush();
});
