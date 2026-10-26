import { test } from '../fixtures/auth.js';
import { SEEDED_MEDIA_SESSION_IDS } from '../helpers/ui-helper.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「Consensus」（多数決による確定）。
 *
 * 複数 Reviewer の修正を集約して正答を確定する運用（TEAM_LEADER / ADMIN）を撮影する。
 * - 強制集約の操作エリアと確認ステップ（SessionAggregateControls, セッション一覧の各項目内）
 * - 競合解決パネル（ConflictResolutionPanel 相当, /consensus/{id} 画面）
 *
 * 集約確定・競合解決はほぼ不可逆の確定操作のため、集約 API / Consensus 取得 API を
 * `page.route` で固定レスポンスに差し替え、UI 状態のみを決定論的に撮影する
 * （実 API を呼ばず seed データを汚さない）。
 */

/** メディア紐付きセッション id（segments あり）。Consensus 画面の遷移先に使う。 */
const CONSENSUS_SESSION = SEEDED_MEDIA_SESSION_IDS[0]; // e2e-session-001

/**
 * 競合解決パネル撮影用の固定 Consensus セグメント。
 * 確定済み / 未確定 / 競合解決待ち（候補＋票数あり）の 3 状態を揃え、
 * ステータスラベルと競合候補の表示を 1 画面で見せる。
 */
const STUB_CONSENSUS = {
  data: [
    {
      segmentId: `${CONSENSUS_SESSION}-seg-000`,
      sessionId: CONSENSUS_SESSION,
      startTime: 0,
      endTime: 3.2,
      originalText: '本日わお集まりいただきありがとうございます',
      consensusStatus: 'CONFIRMED',
      consensusText: '本日はお集まりいただきありがとうございます。',
    },
    {
      segmentId: `${CONSENSUS_SESSION}-seg-001`,
      sessionId: CONSENSUS_SESSION,
      startTime: 3.2,
      endTime: 7.5,
      originalText: '議事録の確認をお願いします',
      consensusStatus: 'UNDECIDED',
    },
    {
      segmentId: `${CONSENSUS_SESSION}-seg-002`,
      sessionId: CONSENSUS_SESSION,
      startTime: 7.5,
      endTime: 12.0,
      originalText: 'つぎの案件について話します',
      consensusStatus: 'CONFLICT',
      reviewerAnswers: [
        { text: '次の案件について話します。', count: 2, userIds: ['u1', 'u2'] },
        { text: '次の議案について話します。', count: 1, userIds: ['u3'] },
      ],
    },
  ],
};

test('manual: Consensus', async ({ page, loginAsAdmin }) => {
  const rec = new ManualRecorder(page, 'Consensus', 'consensus');

  // 全権限で操作エリアを撮影できるよう Admin でログイン（ホーム＝セッション一覧へ）
  await loginAsAdmin(page);
  await page
    .getByRole('main', { name: '校閲セッション一覧' })
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  await page
    .getByRole('list', { name: 'セッション一覧' })
    .waitFor({ timeout: 8_000 })
    .catch(() => {});

  // 集約 API（POST /sessions/{id}/aggregate）を固定の成功レスポンスに差し替える。
  // 実際には確定させず、確認ステップの UI だけを安全に撮るため。
  await page.route(/\/sessions\/[^/]+\/aggregate$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { confirmedCount: 4, conflictCount: 1, totalReviewers: 3 },
      }),
    });
  });

  // 「完了」セッションでは「強制集約して確定」ボタンが disabled になるため、
  // ステータスフィルターの「進行中」タブに切り替えて、強制集約ボタンが有効な
  // セッションに絞り込む（タブのクリックと再描画待ちは短く、失敗は握りつぶす）。
  await page
    .getByRole('tablist', { name: 'ステータスフィルター' })
    .getByRole('tab', { name: '進行中' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  // 進行中に絞った一覧の再描画を軽く待つ。
  await page
    .getByRole('list', { name: 'セッション一覧' })
    .getByRole('listitem')
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});

  // 操作対象として（進行中に絞り込んだ）一覧の先頭セッション項目にスコープする。
  // 進行中セッションでは「強制集約して確定」ボタンが有効になっている。
  const firstSession = page
    .getByRole('list', { name: 'セッション一覧' })
    .getByRole('listitem')
    .first();

  // 1. 多数決による確定の概要（強制集約の操作エリア）
  const aggregateGroup = firstSession.getByRole('group', { name: '強制集約の操作' });
  await aggregateGroup.scrollIntoViewIfNeeded().catch(() => {});
  await aggregateGroup.waitFor({ timeout: 8_000 }).catch(() => {});
  await rec.capture({
    title: '多数決による確定の概要',
    description:
      '複数の Reviewer が同じメディアを校閲すると、各セグメントの修正が集まります。最低 3 名の修正が揃うと自動で多数決による集約が実行され、最も支持された修正が正答（Consensus）として確定します。セッション一覧の各項目には、TeamLeader・Admin 向けに「強制集約して確定」の操作エリアが表示されます。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 300,
  });

  // 2. 強制集約して確定する（確認ステップを開いた状態）
  // 有効な「強制集約して確定」ボタンをクリックする。クリック自体も短い
  // タイムアウトで握りつぶし、確認UIの有無に関わらずクリック直後の状態を撮る。
  await firstSession
    .getByRole('button', { name: '強制集約して確定' })
    .click({ timeout: 5_000 })
    .catch(() => {});
  // 確認UI（group[強制集約の確認]）は名称が異なる / 存在しない可能性があるため、
  // 短いタイムアウトで待ち、出なければそのまま撮影する。
  await firstSession
    .getByRole('group', { name: '強制集約の確認' })
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await rec.capture({
    title: '強制集約して確定する',
    description:
      '自動集約の最低人数に満たない場合でも、TeamLeader・Admin は「強制集約して確定」から手動で集約を確定できます。ボタンを押すと確認メッセージが表示されます。集約を実行するとセッションは完了となり元に戻せないため、内容を確認したうえで「実行する」を押してください。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    fullPage: true,
    settleMs: 300,
  });

  // 3. 競合を解決する（Consensus 画面, ADMIN 専用）
  // Consensus 取得 API を固定レスポンスに差し替えてから遷移し、
  // 確定済み／未確定／競合解決待ちの各状態と競合候補を決定論的に撮る。
  await page.route(/\/consensus\/[^/]+\/segments(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_CONSENSUS),
    });
  });

  await page.goto(`./consensus/${CONSENSUS_SESSION}`);
  // main[Consensus 状態] / list[セグメント一覧] は名称が異なる / 存在しない
  // 可能性があるため短いタイムアウトで待ち、出なければ networkidle を軽く待って
  // そのまま撮影する（フォールバック）。
  await page
    .getByRole('main', { name: 'Consensus 状態' })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page
    .getByRole('list', { name: 'セグメント一覧' })
    .waitFor({ timeout: 8_000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await rec.capture({
    title: '競合を解決する',
    description:
      'Admin は Consensus 状態画面で各セグメントの確定状況を確認できます。ステータスは「確定」「未確定」「競合解決待ち」で示され、票が割れて自動確定できなかった「競合解決待ち」のセグメントでは、各 Reviewer の回答候補と得票数（◯名）が一覧表示されます。正しい回答を選んで「この回答で確定」を押すと、そのセグメントの正答が確定します。',
    roles: ['ADMIN'],
    fullPage: true,
    settleMs: 300,
  });

  rec.flush();
});
