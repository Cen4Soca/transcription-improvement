import { test, expect } from '../../fixtures/auth.js';
import type { Route } from '@playwright/test';
import {
  openFirstSession,
  selectStatusFilter,
  sessionItems,
  sessionList,
} from '../../helpers/ui-helper.js';

/**
 * GET /sessions の API 呼び出し（XHR/fetch, クエリ付き可）だけにマッチする正規表現。
 * SPA のドキュメントナビゲーション（/sessions/{id} の HTML 取得等）は resourceType で除外する。
 * セッション一覧はサーバー駆動（?status= / ?page=）になったため、クエリ付き URL も拾う。
 */
const SESSIONS_LIST_RE = /\/sessions(\?.*)?$/;

/** GET /sessions（一覧 XHR のみ、ドキュメント除外）にマッチするか（route インターセプト用）。 */
function isSessionsListGet(route: Route): boolean {
  const req = route.request();
  return (
    SESSIONS_LIST_RE.test(req.url()) &&
    req.method() === 'GET' &&
    req.resourceType() !== 'document'
  );
}

/** GET /sessions のレスポンス待ち用述語（waitForResponse 用）。 */
function isSessionsListResponse(res: { url(): string; request(): { method(): string; resourceType(): string } }): boolean {
  const req = res.request();
  return (
    SESSIONS_LIST_RE.test(res.url()) &&
    req.method() === 'GET' &&
    req.resourceType() !== 'document'
  );
}

test.describe('セッション一覧ページ', () => {
  test.describe('通常表示（seed データ前提・サーバー駆動）', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
    });

    test('3.1 セッション一覧が表示される', async ({ page }) => {
      await expect(
        page.getByRole('main', { name: '校閲セッション一覧' })
      ).toBeVisible();

      const list = sessionList(page);
      await expect(list).toBeVisible();
      const items = sessionItems(page);
      await expect(items.first()).toBeVisible();
      expect(await items.count()).toBeGreaterThan(0);
      await expect(
        items.first().getByText(/未着手|進行中|完了/).first()
      ).toBeVisible();
    });

    test('3.2 ステータスフィルター「全て」で全セッションが表示される', async ({ page }) => {
      const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
      const allTab = tablist.getByRole('tab', { name: '全て' });
      await expect(allTab).toHaveAttribute('aria-selected', 'true');
      // 全件 65 件 / 50 件ページで 2 ページ → サーバー pagination によりページネーションが出る
      await expect(
        page.getByRole('navigation', { name: 'ページネーション' })
      ).toBeVisible();
    });

    test('3.3 ステータスフィルター「未着手」で絞り込みできる', async ({ page }) => {
      // サーバーが status=PENDING で絞った結果を返す。表示中の全アイテムが「未着手」。
      await selectStatusFilter(page, '未着手');
      const items = sessionItems(page);
      await expect(items.first()).toBeVisible();
      const count = await items.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(items.nth(i)).toContainText('未着手');
      }
    });

    test('3.4 ステータスフィルター「進行中」で絞り込みできる', async ({ page }) => {
      await selectStatusFilter(page, '進行中');
      const items = sessionItems(page);
      await expect(items.first()).toBeVisible();
      const count = await items.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(items.nth(i)).toContainText('進行中');
      }
    });

    test('3.5 ステータスフィルター「完了」で絞り込みできる', async ({ page }) => {
      await selectStatusFilter(page, '完了');
      const items = sessionItems(page);
      await expect(items.first()).toBeVisible();
      const count = await items.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(items.nth(i)).toContainText('完了');
      }
    });

    test('3.6 セッションが作成日時の降順でソートされる', async ({ page }) => {
      // サーバーが降順で返す。表示順が降順であることを先頭 2 件の datetime で検証する。
      const times = sessionItems(page).locator('time');
      await expect(times.first()).toBeVisible();
      const first = await times.nth(0).getAttribute('datetime');
      const second = await times.nth(1).getAttribute('datetime');
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(new Date(first!).getTime()).toBeGreaterThanOrEqual(
        new Date(second!).getTime()
      );
    });

    test('3.7 ページネーションが正しく動作する', async ({ page }) => {
      const pagination = page.getByRole('navigation', { name: 'ページネーション' });
      await expect(pagination).toBeVisible();
      await expect(pagination.getByText('1 /')).toBeVisible();

      // 次ページはサーバー再取得（?page=2）。応答を待ってからページ表示を検証する。
      await Promise.all([
        page.waitForResponse(isSessionsListResponse).catch(() => {}),
        pagination.getByRole('button', { name: /次へ/ }).click(),
      ]);
      await expect(pagination.getByText('2 /')).toBeVisible();

      await Promise.all([
        page.waitForResponse(isSessionsListResponse).catch(() => {}),
        pagination.getByRole('button', { name: /前へ/ }).click(),
      ]);
      await expect(pagination.getByText('1 /')).toBeVisible();
    });

    test('3.8 セッションをクリックすると校閲画面に遷移する', async ({ page }) => {
      await openFirstSession(page);
      await expect(page).toHaveURL(/\/sessions\/.+/);
      await expect(
        page.getByRole('main', { name: '校閲画面' })
      ).toBeVisible();
    });
  });

  test.describe('状態別表示（レスポンス注入）', () => {
    test('3.9 読み込み中スピナーが表示される', async ({ page, loginAsAdmin }) => {
      await page.route(SESSIONS_LIST_RE, async (route: Route) => {
        if (!isSessionsListGet(route)) return route.fallback();
        await new Promise((r) => setTimeout(r, 2_000));
        return route.fallback();
      });
      await loginAsAdmin(page);
      await expect(
        page.getByRole('status', { name: '読み込み中' })
      ).toBeVisible({ timeout: 5_000 });
    });

    test('3.10 エラー時にエラーメッセージが表示される', async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      await page.route(SESSIONS_LIST_RE, async (route: Route) => {
        if (!isSessionsListGet(route)) return route.fallback();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' },
          }),
        });
      });
      await page.reload();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    });

    test('3.11 セッションが 0 件の場合、空状態メッセージが表示される', async ({
      page,
      loginAsAdmin,
    }) => {
      await page.route(SESSIONS_LIST_RE, async (route: Route) => {
        if (!isSessionsListGet(route)) return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            pagination: {
              currentPage: 1,
              pageSize: 50,
              totalItems: 0,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          }),
        });
      });
      await loginAsAdmin(page);
      await expect(page.getByText('校閲セッションがありません')).toBeVisible();
    });
  });
});
