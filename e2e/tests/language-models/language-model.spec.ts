import { test, expect } from '../../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';

/**
 * カスタム言語モデル管理ページのテスト。
 *
 * モデル作成は実行すると Amazon Transcribe のカスタム言語モデル作成という
 * 不可逆・コスト発生の副作用を伴うため、作成・一覧・候補・ステータスの各 API を
 * ルートインターセプトで固定し、UI ロジック（バリデーション順序・成功表示・
 * ポーリングバナー・ステータスバッジ）のみを決定論的に検証する。
 */

const MOCK_TEAM_ID = 'e2e-mock-team-001';
const MOCK_SESSION_ID = 'e2e-mock-session-001';

/** 言語モデル画面の読み取り系 API を固定する共通モック。 */
async function stubLanguageModelApis(
  page: Page,
  opts: { existingModelName?: string } = {}
) {
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
          { teamId: MOCK_TEAM_ID, sessionId: MOCK_SESSION_ID, createdBy: 'x', createdAt: '2024-01-01T00:00:00.000Z' },
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
          currentPage: 1, pageSize: 50, totalItems: 1,
          totalPages: 1, hasNextPage: false, hasPreviousPage: false,
        },
      }),
    });
  });
  // モデル一覧（GET /language-models）
  await page.route(/\/language-models$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const models = opts.existingModelName
      ? [{ modelName: opts.existingModelName, modelStatus: 'COMPLETED', displayName: '既存モデル', teamId: MOCK_TEAM_ID, baseModelName: 'NarrowBand' }]
      : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models }),
    });
  });
}

/** チームを選び、候補セッションが表示されるまで待つ。 */
async function selectMockTeam(page: Page) {
  await page.getByLabel(/チーム/).selectOption(MOCK_TEAM_ID);
  await expect(page.getByText('E2E モックセッション')).toBeVisible({ timeout: 10_000 });
}

test.describe('カスタム言語モデル管理ページ', () => {
  test('6.1 Reviewer がアクセスすると「アクセス権限がありません」が表示される', async ({
    page,
    loginAsReviewer,
  }) => {
    await loginAsReviewer(page);
    await page.goto('./language-models');

    await expect(page.getByText('アクセス権限がありません')).toBeVisible();
    await expect(
      page.getByText('この機能は Admin または TeamLeader のみ利用できます')
    ).toBeVisible();
  });

  test.describe('Admin アクセス（API モック）', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await stubLanguageModelApis(page);
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '言語モデル管理' }).click();
      await expect(page).toHaveURL(/\/language-models/);
    });

    test('6.2 モデル作成フォームにアクセスできる', async ({ page }) => {
      await expect(page.getByText('新規モデル作成')).toBeVisible();
      await expect(page.getByLabel(/モデル名/)).toBeVisible();
      await expect(page.getByText('ベースモデル')).toBeVisible();
    });

    test('6.3 モデル名が空の状態で送信するとバリデーションエラーが出る', async ({ page }) => {
      await page.getByRole('button', { name: 'モデルを作成' }).click();
      await expect(page.getByRole('alert')).toContainText('モデル名を入力してください');
    });

    test('6.4 不正な文字を含むモデル名でバリデーションエラーが出る', async ({ page }) => {
      await page.getByLabel('モデル名').fill('invalid model name!');
      await page.getByRole('button', { name: 'モデルを作成' }).click();
      await expect(page.getByRole('alert')).toContainText(
        '英数字、ハイフン、アンダースコアのみ'
      );
    });

    test('6.6 セッション未選択で送信するとバリデーションエラーが出る', async ({ page }) => {
      // バリデーション順序（名前→表示名→チーム→セッション）に従い、
      // セッション以外を全て埋めた状態で未選択エラーを発生させる。
      await page.getByLabel('モデル名').fill('valid-model-name');
      await page.getByLabel('表示名').fill('有効な表示名');
      await selectMockTeam(page);
      // セッションは選ばずに送信
      await page.getByRole('button', { name: 'モデルを作成' }).click();
      await expect(page.getByRole('alert')).toContainText(
        '対象の校閲セッションを1つ以上選択してください'
      );
    });

    test('6.7 ベースモデル（NarrowBand / WideBand）を選択できる', async ({ page }) => {
      const narrowBandRadio = page.getByRole('radio', { name: 'NarrowBand' });
      await expect(narrowBandRadio).toBeChecked();

      const wideBandRadio = page.getByRole('radio', { name: 'WideBand' });
      await wideBandRadio.click();
      await expect(wideBandRadio).toBeChecked();
      await expect(narrowBandRadio).not.toBeChecked();
    });

    test('6.8 セッションチェックボックスで複数選択できる', async ({ page }) => {
      await selectMockTeam(page);
      // 候補セッションのチェックボックスを選択 → 「N 件選択中」表示
      await page.getByRole('checkbox').first().check();
      await expect(page.getByText(/1 件選択中/)).toBeVisible();
    });

    test('6.9 モデル作成成功時に成功メッセージが表示される', async ({ page }) => {
      // 作成 API を成功で差し替え（実モデル作成を回避）。ステータスは IN_PROGRESS。
      await page.route(/\/language-models$/, (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            modelName: 'valid-model-name',
            displayName: '有効な表示名',
            baseModelName: 'NarrowBand',
            teamId: MOCK_TEAM_ID,
            status: 'IN_PROGRESS',
            trainingDataS3Uri: 's3://x',
            createdBy: 'admin',
            createdAt: '2024-01-01T00:00:00.000Z',
          }),
        });
      });
      await page.route(/\/language-models\/.+$/, (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ modelName: 'valid-model-name', modelStatus: 'IN_PROGRESS' }),
        });
      });

      await page.getByLabel('モデル名').fill('valid-model-name');
      await page.getByLabel('表示名').fill('有効な表示名');
      await selectMockTeam(page);
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      await expect(page.getByText(/作成を開始しました/)).toBeVisible({ timeout: 10_000 });
    });

    test('6.12 モデル作成中にステータスポーリングバナーが表示される', async ({ page }) => {
      await page.route(/\/language-models$/, (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            modelName: 'polling-model',
            displayName: 'ポーリング確認',
            baseModelName: 'NarrowBand',
            teamId: MOCK_TEAM_ID,
            status: 'IN_PROGRESS',
            trainingDataS3Uri: 's3://x',
            createdBy: 'admin',
            createdAt: '2024-01-01T00:00:00.000Z',
          }),
        });
      });
      await page.route(/\/language-models\/.+$/, (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ modelName: 'polling-model', modelStatus: 'IN_PROGRESS' }),
        });
      });

      await page.getByLabel('モデル名').fill('polling-model');
      await page.getByLabel('表示名').fill('ポーリング確認');
      await selectMockTeam(page);
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      // ポーリングバナー（role=status 内に「作成中」）が表示される
      await expect(page.getByText(/polling-model.*作成中/)).toBeVisible({ timeout: 10_000 });
    });

    test('6.11 モデル一覧の「更新」ボタンでリストが再読み込みされる', async ({ page }) => {
      const refreshButton = page.getByRole('button', { name: 'モデル一覧を更新' });
      await expect(refreshButton).toBeVisible();
      await refreshButton.click();
      // 更新後もモデル一覧セクションが見える（空状態 or 一覧）
      await expect(page.getByText('モデル一覧')).toBeVisible();
    });
  });

  test.describe('重複名・ステータスバッジ（一覧モック）', () => {
    test('6.5 重複するモデル名でバリデーションエラーが出る', async ({ page, loginAsAdmin }) => {
      await stubLanguageModelApis(page, { existingModelName: 'dup-model' });
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '言語モデル管理' }).click();
      await expect(page).toHaveURL(/\/language-models/);

      await page.getByLabel('モデル名').fill('dup-model');
      await page.getByLabel('表示名').fill('重複テスト');
      await selectMockTeam(page);
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      await expect(page.getByRole('alert')).toContainText(
        '同じ名前のモデルが既に存在します'
      );
    });

    test('6.10 モデル一覧にステータスバッジが表示される', async ({ page, loginAsAdmin }) => {
      await stubLanguageModelApis(page, { existingModelName: 'badge-model' });
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '言語モデル管理' }).click();
      await expect(page).toHaveURL(/\/language-models/);

      const list = page.getByRole('list', { name: 'カスタム言語モデル一覧' });
      await expect(list).toBeVisible();
      // ステータスバッジ（完了）が一覧内に表示される
      await expect(list.getByText('完了')).toBeVisible();
    });
  });
});
