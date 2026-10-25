import { test, expect } from '../../fixtures/auth.js';
import type { Page, Route } from '@playwright/test';

const RANKING_GLOB = /\/ranking(\?.*)?$/;

/** ランキング行を1件生成する。 */
function entry(rank: number, overrides: Record<string, unknown> = {}) {
  return {
    rank,
    userId: `ranker-${rank}`,
    displayName: `ランカー ${rank}`,
    answerCount: 100 - rank,
    accuracyRate: 90 - rank,
    score: 1000 - rank,
    ...overrides,
  };
}

/**
 * GET /ranking の API 呼び出し（XHR/fetch）だけを固定レスポンスに差し替える。
 * ドキュメントナビゲーション（SPA の HTML 取得）には介入しないよう resourceType で絞る。
 */
async function stubRanking(
  page: Page,
  body: {
    rankings: ReturnType<typeof entry>[];
    currentUser: ReturnType<typeof entry> | null;
    pagination: Record<string, unknown>;
  }
) {
  await page.route(RANKING_GLOB, (route: Route) => {
    const req = route.request();
    if (req.method() !== 'GET' || req.resourceType() === 'document') {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: body }),
    });
  });
}

test.describe('ランキングページ', () => {
  test.describe('実データ（seed 35 件・全期間）', () => {
    test.beforeEach(async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(page).toHaveURL(/\/ranking/);
    });

    test('7.1 ランキングテーブルが表示される', async ({ page }) => {
      await expect(
        page.getByRole('main', { name: 'コントリビューターランキング' })
      ).toBeVisible();

      const table = page.getByRole('table', { name: 'ランキングテーブル' });
      await expect(table).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '順位' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'ユーザー名' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '回答数' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '正答率' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'スコア' })).toBeVisible();
      // seed に 35 件あるためデータ行が存在する
      expect(await table.locator('tbody tr').count()).toBeGreaterThan(0);
    });

    test('7.2 期間フィルター「全期間」がデフォルトで選択される', async ({ page }) => {
      const tablist = page.getByRole('tablist', { name: '期間フィルター' });
      await expect(
        tablist.getByRole('tab', { name: '全期間' })
      ).toHaveAttribute('aria-selected', 'true');
    });

    test('7.3 期間フィルターを切り替えるとデータが更新される', async ({ page }) => {
      const tablist = page.getByRole('tablist', { name: '期間フィルター' });
      await tablist.getByRole('tab', { name: '今月' }).click();
      await expect(
        tablist.getByRole('tab', { name: '今月' })
      ).toHaveAttribute('aria-selected', 'true');
      await tablist.getByRole('tab', { name: '直近30日' }).click();
      await expect(
        tablist.getByRole('tab', { name: '直近30日' })
      ).toHaveAttribute('aria-selected', 'true');
    });

    test('7.6 ランキングデータが 0 件の場合、空状態メッセージが表示される', async ({ page }) => {
      // seed は全件 period=ALL のため「今月」は 0 件 → 空状態メッセージが出る
      const tablist = page.getByRole('tablist', { name: '期間フィルター' });
      await tablist.getByRole('tab', { name: '今月' }).click();
      await expect(
        page.getByText('まだランキングデータがありません')
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('現ユーザー表示・ページング（レスポンス注入）', () => {
    test('7.4 現在のユーザーが「あなた」バッジでハイライトされる', async ({
      page,
      loginAsReviewer,
    }) => {
      // 現ユーザーがランキング内にいるケースを注入する。
      await loginAsReviewer(page);
      await stubRanking(page, {
        rankings: [
          entry(1),
          entry(2, { userId: '__ME__', displayName: '自分' }),
          entry(3),
        ],
        currentUser: entry(2, { userId: '__ME__', displayName: '自分' }),
        pagination: { currentPage: 1, pageSize: 50, totalItems: 3, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      });
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(page).toHaveURL(/\/ranking/);

      const table = page.getByRole('table', { name: 'ランキングテーブル' });
      await expect(table).toBeVisible();
      // 現ユーザー行に「あなた」バッジが付き、その行が aria-current でハイライトされる
      await expect(table.getByText('あなた')).toBeVisible();
      const highlightedRow = table.locator('tr[aria-current="true"]');
      await expect(highlightedRow).toBeVisible();
      await expect(highlightedRow).toContainText('自分');
    });

    test('7.5 ランキング外の現在ユーザーがテーブル下部に表示される', async ({
      page,
      loginAsReviewer,
    }) => {
      // currentUser が rankings に含まれないケース → 「···」区切り + 下部行
      await loginAsReviewer(page);
      await stubRanking(page, {
        rankings: [entry(1), entry(2), entry(3)],
        currentUser: entry(99, { userId: '__ME_OUT__', displayName: '圏外の自分' }),
        pagination: { currentPage: 1, pageSize: 50, totalItems: 3, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      });
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(page).toHaveURL(/\/ranking/);

      const table = page.getByRole('table', { name: 'ランキングテーブル' });
      await expect(table).toBeVisible();
      // 「···」区切りと圏外ユーザー行が表示される
      await expect(table.getByText('···')).toBeVisible();
      await expect(table.getByText('圏外の自分')).toBeVisible();
    });

    test('7.7 ページネーションが正しく動作する', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      // 2 ページ分のレスポンスを注入する（page に応じて切替、API 呼び出しのみ）。
      await page.route(RANKING_GLOB, (route: Route) => {
        const req = route.request();
        if (req.method() !== 'GET' || req.resourceType() === 'document') {
          return route.fallback();
        }
        const url = new URL(req.url());
        const pageNum = Number(url.searchParams.get('page') ?? '1');
        const rankings = pageNum === 2 ? [entry(51), entry(52)] : [entry(1), entry(2)];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              rankings,
              currentUser: null,
              pagination: {
                currentPage: pageNum, pageSize: 50, totalItems: 52, totalPages: 2,
                hasNextPage: pageNum < 2, hasPreviousPage: pageNum > 1,
              },
            },
          }),
        });
      });
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(page).toHaveURL(/\/ranking/);

      const nav = page.getByRole('navigation', { name: 'ページネーション' });
      await expect(nav).toBeVisible();
      await expect(nav.getByText('1 / 2')).toBeVisible();
      await nav.getByRole('button', { name: '次のページ' }).click();
      await expect(nav.getByText('2 / 2')).toBeVisible();
      await expect(page.getByText('ランカー 51')).toBeVisible();
      await nav.getByRole('button', { name: '前のページ' }).click();
      await expect(nav.getByText('1 / 2')).toBeVisible();
    });

    test('7.8 読み込み中スピナーが表示される', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      // ランキング API（XHR のみ）を遅延させてスピナーを観測する。
      await page.route(RANKING_GLOB, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'GET' || req.resourceType() === 'document') {
          return route.fallback();
        }
        await new Promise((r) => setTimeout(r, 2_000));
        return route.fallback();
      });
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(
        page.getByRole('status', { name: '読み込み中' })
      ).toBeVisible({ timeout: 5_000 });
    });
  });
});
