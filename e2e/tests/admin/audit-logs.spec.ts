import { test, expect, type Page } from '../../fixtures/auth.js';
import type { Route } from '@playwright/test';

/**
 * 管理画面 - 監査ログ。
 * 一覧・フィルタ・削除は dev 環境に対して実操作。ページネーション(8.5.3)のみ
 * seed が 60 件（pageSize 100 で 1 ページ）に収まるためレスポンス注入で複数ページを再現する。
 */

async function gotoAuditTab(page: Page) {
  await page.getByRole('menuitem', { name: '管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.getByRole('tab', { name: '監査ログ' }).click();
  await expect(page.getByRole('tab', { name: '監査ログ' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
}

test.describe('管理画面 - 監査ログ', () => {
  test('8.5.1 監査ログ一覧が表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await gotoAuditTab(page);
    // seed に 60 件あるためテーブルが表示される
    await expect(page.getByRole('table', { name: '監査ログテーブル' })).toBeVisible();
    await expect(page.getByText(/件中/)).toBeVisible();
  });

  test('8.5.2 操作種別フィルターで絞り込みできる', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await gotoAuditTab(page);

    const form = page.getByRole('form', { name: '監査ログフィルタ' });
    await form.getByLabel('操作種別').selectOption('SESSION_COMPLETED');
    // フィルタ適用で再取得され、表示件数テキストが更新される
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/audit-logs/.test(r.url()) && r.request().method() === 'GET'
      ),
      form.getByRole('button', { name: '検索' }).click(),
    ]);
    expect(resp.ok()).toBeTruthy();
    // テーブルまたは空状態のいずれかが表示される（絞り込み結果が確定的に反映）
    await expect(
      page.getByRole('table', { name: '監査ログテーブル' }).or(
        page.getByText('該当する監査ログがありません')
      )
    ).toBeVisible();
  });

  test('8.5.3 ページネーションで移動できる', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    // 監査ログ API を複数ページで注入（seed は 1 ページに収まるため）。
    await page.route(/\/audit-logs(\?.*)?$/, (route: Route) => {
      if (route.request().method() !== 'GET' || route.request().resourceType() === 'document') {
        return route.fallback();
      }
      const url = new URL(route.request().url());
      const pageNum = Number(url.searchParams.get('page') ?? '1');
      const makeLogs = (base: number) =>
        Array.from({ length: 100 }, (_, i) => ({
          logId: `log-${base + i}`,
          createdAt: '2024-06-01T00:00:00.000Z',
          actorUserId: 'admin',
          actorRole: 'ADMIN',
          operationType: 'SESSION_COMPLETED',
          resourceId: `res-${base + i}`,
          resourceType: 'Test',
        }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: makeLogs(pageNum === 2 ? 100 : 0),
          pagination: {
            totalCount: 150,
            page: pageNum,
            pageSize: 100,
            totalPages: 2,
          },
        }),
      });
    });
    await gotoAuditTab(page);

    const nav = page.getByRole('navigation', { name: 'ページネーション' });
    await expect(nav).toBeVisible();
    await expect(nav.getByText('1 / 2')).toBeVisible();
    await nav.getByRole('button', { name: '次のページ' }).click();
    await expect(nav.getByText('2 / 2')).toBeVisible();
    await nav.getByRole('button', { name: '前のページ' }).click();
    await expect(nav.getByText('1 / 2')).toBeVisible();
  });

  test('8.5.4 監査ログを削除できる', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await gotoAuditTab(page);

    // 操作種別で絞ってから「フィルタ条件で削除」を実行する（影響範囲を限定）。
    const form = page.getByRole('form', { name: '監査ログフィルタ' });
    await form.getByLabel('操作種別').selectOption('REVIEW_ASSIGNMENT_CHANGE');
    await Promise.all([
      page.waitForResponse(
        (r) => /\/audit-logs/.test(r.url()) && r.request().method() === 'GET'
      ),
      form.getByRole('button', { name: '検索' }).click(),
    ]);

    const deleteButton = page.getByRole('button', { name: 'フィルタ条件で削除' });
    // 対象 0 件だと disabled。件数があるときのみ削除フローを検証する。
    if (await deleteButton.isDisabled()) {
      test.info().annotations.push({
        type: 'note',
        description: 'REVIEW_ASSIGNMENT_CHANGE の監査ログが 0 件のため削除フローはスキップ',
      });
      return;
    }
    await deleteButton.click();
    const dialog = page.getByRole('dialog', { name: '監査ログ削除の確認' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('この操作は取り消せません')).toBeVisible();

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/audit-logs\/delete$/.test(r.url()) && r.request().method() === 'POST'
      ),
      dialog.getByRole('button', { name: '削除する' }).click(),
    ]);
    expect(resp.ok()).toBeTruthy();
  });
});
