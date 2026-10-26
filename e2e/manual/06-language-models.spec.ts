import { test } from '../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「言語モデル管理」。全手順 TEAM_LEADER / ADMIN。
 *
 * カスタム言語モデルの作成は Amazon Transcribe のモデル作成という不可逆・コスト発生の
 * 副作用を伴うため、本シナリオでは作成 POST を一切行わない。読み取り系 API
 * （/me/teams・/sessions・/language-models・assignments）を page.route で固定し、
 * フォーム表示・ベースモデル選択・対象セッション選択・モデル一覧（ステータスバッジ）の
 * 「表示状態」のみを決定論的に撮影する（tests/language-models と同手法）。
 *
 * 本設計では、確実に全画面を撮れる loginAsAdmin を既定採用する（画面自体は
 * TEAM_LEADER / ADMIN 共通のため roles は両ロールを付与する）。
 * 全操作は防御的に .catch で握りつぶし、撮影が止まらないようにする。
 */

const MOCK_TEAM_ID = 'e2e-mock-team-001';
const MOCK_SESSION_ID = 'e2e-mock-session-001';

/** 言語モデル画面の読み取り系 API を固定する共通モック。 */
async function stubLanguageModelApis(page: Page): Promise<void> {
  // チーム選択肢（/me/teams）
  await page.route(/\/me\/teams$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ teamId: MOCK_TEAM_ID, name: 'E2E モックチーム' }],
      }),
    })
  );
  // 指定チームの割り当てセッション（候補絞り込み）
  await page.route(/\/admin\/teams\/.+\/assignments$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            teamId: MOCK_TEAM_ID,
            sessionId: MOCK_SESSION_ID,
            createdBy: 'x',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }),
    })
  );
  // 候補セッションの母集合（GET /sessions）
  await page.route(/\/sessions(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            sessionId: MOCK_SESSION_ID,
            transcriptionJobId: 'job-mock',
            name: 'E2E モックセッション',
            status: 'COMPLETED',
            assignedReviewerCount: 3,
            consensusThreshold: 3,
            partialAggregationEnabled: false,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        pagination: {
          currentPage: 1,
          pageSize: 50,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
    });
  });
  // モデル一覧（GET /language-models）: ステータスバッジ撮影用に完了済みモデルを 1 件返す
  await page.route(/\/language-models$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          {
            modelName: 'e2e-sample-model',
            modelStatus: 'COMPLETED',
            displayName: 'サンプルモデル',
            teamId: MOCK_TEAM_ID,
            baseModelName: 'NarrowBand',
          },
        ],
      }),
    });
  });
}

test('manual: 言語モデル管理', async ({ page, loginAsAdmin }) => {
  const rec = new ManualRecorder(page, '言語モデル管理', 'language-models');

  // 読み取り系 API をモック固定してから Admin でログインする。
  await stubLanguageModelApis(page);
  await loginAsAdmin(page);

  // 言語モデル管理メニューから画面へ遷移する。
  await page
    .getByRole('menuitem', { name: '言語モデル管理' })
    .click()
    .catch(() => {});
  await page.waitForURL(/\/language-models/, { timeout: 30_000 }).catch(() => {});

  // 1. 言語モデル管理画面（新規モデル作成フォーム）
  await page
    .getByLabel(/モデル名/)
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: '言語モデル管理画面',
    description:
      'ナビゲーションの「言語モデル管理」メニューから、カスタム言語モデルの作成画面を開きます。モデル名・表示名を入力し、ベースモデルと学習対象の校閲セッションを選んでモデルを作成します。この機能は Admin または TeamLeader のみ利用できます。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  // 2. ベースモデルを選ぶ（WideBand を選択して状態を見せる）
  await page
    .getByRole('radio', { name: 'WideBand' })
    .click()
    .catch(() => {});
  await rec.capture({
    title: 'ベースモデルを選ぶ',
    description:
      'ベースモデルとして「NarrowBand」または「WideBand」を選択します。NarrowBand は電話音声などの狭帯域音声向け、WideBand はより広帯域の高音質な音声向けです。学習データの音質に合わせて選んでください。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 3. 対象セッションを選ぶ（チーム選択 → 候補セッションのチェックボックス）
  await page
    .getByLabel(/チーム/)
    .selectOption(MOCK_TEAM_ID)
    .catch(() => {});
  await page
    .getByText('E2E モックセッション')
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await page
    .getByRole('checkbox')
    .first()
    .check()
    .catch(() => {});
  await rec.capture({
    title: '対象セッションを選ぶ',
    description:
      '学習に使う校閲セッションを選びます。まずチームを選択すると、そのチームに割り当てられた候補セッションの一覧が表示されます。チェックボックスで対象を1つ以上選ぶと、確定済みの校閲結果がモデルの学習データとして使われます。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 4. モデル一覧とステータス（ステータスバッジ）
  await page
    .getByRole('list', { name: 'カスタム言語モデル一覧' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await rec.capture({
    title: 'モデル一覧とステータス',
    description:
      '作成済みのカスタム言語モデルは一覧で確認できます。各モデルには作成状況を示すステータスバッジ（作成中・完了・失敗など）が表示されます。作成には時間がかかるため、ステータスが「完了」になるまで待ってから利用してください。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  rec.flush();
});
