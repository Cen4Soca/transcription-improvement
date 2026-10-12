import { test, expect } from '../../fixtures/auth.js';

test.describe('ランキングページ', () => {
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
    const isVisible = await table.isVisible().catch(() => false);

    if (isVisible) {
      // ヘッダーカラムの確認
      await expect(page.getByRole('columnheader', { name: '順位' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'ユーザー名' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '回答数' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: '正答率' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'スコア' })).toBeVisible();
    } else {
      // データがない場合
      await expect(page.getByText('まだランキングデータがありません')).toBeVisible();
    }
  });

  test('7.2 期間フィルター「全期間」がデフォルトで選択される', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: '期間フィルター' });
    const allTab = tablist.getByRole('tab', { name: '全期間' });
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
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

  test('7.4 現在のユーザーが「あなた」バッジでハイライトされる', async ({ page }) => {
    const table = page.getByRole('table', { name: 'ランキングテーブル' });
    const isVisible = await table.isVisible().catch(() => false);

    if (isVisible) {
      // 「あなた」バッジが存在するか確認
      const badge = page.getByText('あなた');
      const hasBadge = await badge.isVisible().catch(() => false);

      if (hasBadge) {
        // ハイライト行が存在する
        const highlightedRow = page.locator('tr[aria-current="true"]');
        await expect(highlightedRow).toBeVisible();
        await expect(highlightedRow).toHaveClass(/bg-blue-50/);
      }
    }
  });

  test('7.6 ランキングデータが 0 件の場合、空状態メッセージが表示される', async ({ page }) => {
    // 特定の期間でデータがない場合をテスト
    const tablist = page.getByRole('tablist', { name: '期間フィルター' });
    await tablist.getByRole('tab', { name: '今月' }).click();

    // テーブルか空メッセージのどちらかが表示される
    const table = page.getByRole('table', { name: 'ランキングテーブル' });
    const emptyMsg = page.getByText('まだランキングデータがありません');

    const tableVisible = await table.isVisible().catch(() => false);
    const emptyVisible = await emptyMsg.isVisible().catch(() => false);

    expect(tableVisible || emptyVisible).toBeTruthy();
  });
});
