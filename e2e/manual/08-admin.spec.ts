import { test } from '../fixtures/auth.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「管理」。全手順 ADMIN 専用。
 *
 * 管理画面はタブ構成（ユーザー管理 / チーム管理 / IPアドレス制限 / 監査ログ）で、
 * 本シナリオでは「ユーザー管理」「IP制御」「監査ログ」の 3 サブセクションを撮影する。
 * サブセクションごとに別の ManualRecorder を生成し、section 名と slug を分けて
 * 個別に flush() する（build-manual が slug 単位の steps JSON を集約する）。
 *
 * 書き込み操作（ユーザー登録 POST・IP エントリ追加・監査ログ削除）は一切実行しない。
 * フォームや一覧の「表示状態」のみを撮影し、WAF 許可リストや Cognito を汚さない。
 * 全操作は防御的に .catch で握りつぶし、撮影が止まらないようにする。
 */
test('manual: 管理', async ({ page, loginAsAdmin }) => {
  // Admin でログインし、管理画面へ遷移する。
  await loginAsAdmin(page);
  await page
    .getByRole('menuitem', { name: '管理', exact: true })
    .click()
    .catch(() => {});
  await page
    .getByRole('main', { name: '管理画面' })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});

  // ─────────────────────────────────────────────────────────
  // サブセクション 1: 管理 - ユーザー管理
  // ─────────────────────────────────────────────────────────
  const recUsers = new ManualRecorder(page, '管理 - ユーザー管理', 'admin-users');

  // 1. 管理画面を開く（タブ付きトップ）
  await page
    .getByRole('tablist', { name: '管理画面タブ' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recUsers.capture({
    title: '管理画面を開く',
    description:
      'ナビゲーションの「管理」メニューから管理画面を開きます。管理画面はタブで構成され、「ユーザー管理」「チーム管理」「IPアドレス制限」「監査ログ」を切り替えて操作できます。管理画面は Admin ロールのみアクセスできます。',
    roles: ['ADMIN'],
    settleMs: 500,
  });

  // 2. ユーザー一覧
  await page
    .getByRole('tab', { name: 'ユーザー管理' })
    .click()
    .catch(() => {});
  await page
    .getByRole('table', { name: 'ユーザー一覧テーブル' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recUsers.capture({
    title: 'ユーザー一覧を確認する',
    description:
      '「ユーザー管理」タブでは、登録済みユーザーの一覧が表示されます。各ユーザーのメールアドレス・表示名・ロール・有効/無効の状態を確認でき、行ごとに無効化・再有効化などの操作ができます。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  // 3. ユーザーを登録する（フォーム表示まで。POST はしない）
  await page
    .getByRole('button', { name: 'ユーザー追加' })
    .click()
    .catch(() => {});
  await page
    .getByRole('form', { name: 'ユーザー登録フォーム' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recUsers.capture({
    title: 'ユーザーを登録する',
    description:
      '「ユーザー追加」ボタンを押すと、ユーザー登録フォームが表示されます。メールアドレス・表示名・ロールを入力して「登録」すると、招待メールが送信され新しいユーザーが作成されます。登録したユーザーは一覧にすぐ反映されます。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  recUsers.flush();

  // ─────────────────────────────────────────────────────────
  // サブセクション 2: 管理 - IP制御
  // ─────────────────────────────────────────────────────────
  const recIp = new ManualRecorder(page, '管理 - IP制御', 'admin-ip');

  // 1. IPアドレス制限（一覧）
  await page
    .getByRole('tab', { name: 'IPアドレス制限' })
    .click()
    .catch(() => {});
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  await page
    .getByRole('table', { name: 'IPアドレス許可リストテーブル' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recIp.capture({
    title: 'IPアドレス制限を確認する',
    description:
      '「IPアドレス制限」タブでは、アプリへのアクセスを許可する IP アドレス（CIDR ブロック）の一覧が表示されます。許可リストは WAF に反映され、記載された範囲からのアクセスのみを通します。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  // 2. エントリを追加する（フォーム表示まで。許可リストは汚さない）
  await page
    .getByRole('button', { name: 'エントリ追加' })
    .click()
    .catch(() => {});
  await page
    .getByRole('form', { name: 'IPエントリ追加フォーム' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recIp.capture({
    title: 'IPエントリを追加する',
    description:
      '「エントリ追加」ボタンを押すと、IP エントリ追加フォームが表示されます。CIDR ブロック（例: 203.0.113.0/24）と任意の説明を入力して「追加」すると、許可リストに反映されます。自分のアクセス元 IP を誤って除外しないよう注意してください。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  recIp.flush();

  // ─────────────────────────────────────────────────────────
  // サブセクション 3: 管理 - 監査ログ
  // ─────────────────────────────────────────────────────────
  const recAudit = new ManualRecorder(page, '管理 - 監査ログ', 'admin-audit');

  // 1. 監査ログ一覧
  await page
    .getByRole('tab', { name: '監査ログ' })
    .click()
    .catch(() => {});
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  await page
    .getByRole('table', { name: '監査ログテーブル' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recAudit.capture({
    title: '監査ログ一覧を確認する',
    description:
      '「監査ログ」タブでは、書き込み操作（登録・更新・削除）の履歴が時系列で一覧表示されます。操作者・ロール・操作種別・対象リソースを確認でき、監査証跡として参照できます。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  // 2. 操作種別で絞り込む（フィルタ表示まで。削除は撮影しない）
  await page
    .getByRole('form', { name: '監査ログフィルタ' })
    .getByLabel('操作種別')
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await recAudit.capture({
    title: '操作種別で絞り込む',
    description:
      '監査ログフィルタの「操作種別」で、表示する操作の種類を絞り込めます。種別を選んで「検索」すると該当するログだけが一覧表示されます。期間などと組み合わせて目的の操作履歴をすばやく探せます。',
    roles: ['ADMIN'],
    settleMs: 300,
  });

  recAudit.flush();
});
