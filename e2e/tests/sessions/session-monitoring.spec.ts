import { test, expect } from '../../fixtures/auth.js';

/**
 * セッションの割当・進捗モニタリング（ADMIN / TEAM_LEADER 向け）の基本シナリオ。
 *
 * - ADMIN / TEAM_LEADER: セッション一覧画面の「割当・進捗」で一覧・行展開・ユーザー別を確認できる。
 * - REVIEWER: 切り替え UI 自体が表示されない（API も 403）。
 *
 * 件数や滞留バッジは環境のデータに依存するため、ここでは画面の構造と権限差のみを検証する。
 */

const SWITCH_NAME = '表示の切り替え';

async function openMonitoring(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '割当・進捗' }).click();
  await expect(page.getByRole('region', { name: 'セッションの割当・進捗' })).toBeVisible();
}

test.describe('セッション割当・進捗モニタリング', () => {
  test('ADMIN: 割当・進捗の一覧とフィルターが表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await openMonitoring(page);

    const filters = page.getByRole('form', { name: 'セッションの絞り込み' });
    await expect(filters.getByLabel('ステータス')).toBeVisible();
    await expect(filters.getByLabel('滞留のみ')).toBeVisible();
    await expect(filters.getByLabel('未割当のみ')).toBeVisible();

    // 一覧テーブルまたは空メッセージのいずれかが表示される（環境データに依存しない）。
    const table = page.getByRole('table', { name: 'セッションの割当・進捗一覧' });
    const empty = page.getByText('条件に一致するセッションがありません。');
    await expect(table.or(empty)).toBeVisible();
  });

  test('ADMIN: 行を開くと Reviewer 別の進捗が表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await openMonitoring(page);

    const table = page.getByRole('table', { name: 'セッションの割当・進捗一覧' });
    await expect(table).toBeVisible();

    await table.getByRole('button', { name: /の Reviewer 別進捗を表示$/ }).first().click();
    await expect(page.getByRole('region', { name: 'Reviewer 別の進捗' })).toBeVisible();
  });

  test('ADMIN: ユーザー別に担当数 / 進行中 / 滞留が表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await openMonitoring(page);

    await page.getByRole('tab', { name: 'ユーザー別' }).click();
    const table = page.getByRole('table', { name: 'ユーザー別の担当状況一覧' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '担当数' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '進行中' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '滞留' })).toBeVisible();
  });

  test('ADMIN: ユーザー管理画面に担当数・進行中・滞留の列が表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await page.getByRole('menuitem', { name: '管理', exact: true }).click();

    const table = page.getByRole('table', { name: 'ユーザー一覧テーブル' });
    await expect(table.getByRole('columnheader', { name: '担当数' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '滞留' })).toBeVisible();
  });

  test('TEAM_LEADER: 自チームの割当・進捗を確認できる', async ({ page, loginAsTeamLeader }) => {
    await loginAsTeamLeader(page);
    await openMonitoring(page);

    const table = page.getByRole('table', { name: 'セッションの割当・進捗一覧' });
    const empty = page.getByText('条件に一致するセッションがありません。');
    await expect(table.or(empty)).toBeVisible();

    await page.getByRole('tab', { name: 'ユーザー別' }).click();
    await expect(page.getByRole('table', { name: 'ユーザー別の担当状況一覧' })).toBeVisible();
  });

  test('REVIEWER: 割当・進捗の切り替えが表示されない', async ({ page, loginAsReviewer }) => {
    await loginAsReviewer(page);

    await expect(page.getByRole('main', { name: '校閲セッション一覧' })).toBeVisible();
    await expect(page.getByRole('group', { name: SWITCH_NAME })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '割当・進捗' })).toHaveCount(0);
  });
});
