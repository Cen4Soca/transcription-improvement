import { test } from '../fixtures/auth.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「ログイン」。
 *
 * 全ロール共通の入口。ログインフォームと、ログイン後のセッション一覧（ホーム）を撮る。
 */
test('manual: ログイン', async ({ page, loginAsReviewer }) => {
  const rec = new ManualRecorder(page, 'ログイン', 'login');

  // 1. ログインフォーム
  await page.goto('./');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await rec.capture({
    title: 'ログイン画面',
    description:
      'アプリにアクセスすると、ログイン画面が表示されます。登録済みのメールアドレスとパスワードを入力し、「ログイン」ボタンを押してください。初回ログイン時は新しいパスワードの設定を求められる場合があります。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    fullPage: false,
  });

  // 2. ログイン後のホーム（セッション一覧）
  await loginAsReviewer(page);
  await rec.capture({
    title: 'ログイン後のホーム画面',
    description:
      'ログインに成功すると、校閲セッション一覧（ホーム画面）が表示されます。上部のナビゲーションから各機能に移動できます。表示されるメニューはロールによって異なります。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  rec.flush();
});
