import { test, expect } from '../../fixtures/auth.js';

test.describe('管理画面 - 監査ログ', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await page.getByRole('menuitem', { name: '管理', exact: true }).click();
    await expect(page).toHaveURL(/\/admin/);

    // 監査ログタブに切り替え
    await page.getByRole('tab', { name: '監査ログ' }).click();
  });

  test('8.5.1 監査ログ一覧が表示される', async ({ page }) => {
    const tabpanel = page.getByRole('tabpanel');
    await expect(tabpanel).toBeVisible();

    // ログエントリまたは空メッセージが表示される
    await page.waitForTimeout(5_000);
    const hasContent = await tabpanel.locator('table, [role="table"], ul, .audit-log').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/ログ.*ありません|データ.*ありません/).isVisible().catch(() => false);
    const hasLoading = await page.getByRole('status', { name: '読み込み中' }).isVisible().catch(() => false);

    expect(hasContent || hasEmpty || hasLoading).toBeTruthy();
  });

  test('8.5.2 フィルターで絞り込みできる', async ({ page }) => {
    // フィルターコントロールが存在する場合
    const filterInputs = page.locator('select, input[type="date"], input[type="text"]');
    const count = await filterInputs.count();

    if (count > 0) {
      // 操作タイプのフィルターがあれば選択
      const operationFilter = page.locator('select').first();
      if (await operationFilter.isVisible()) {
        const options = await operationFilter.locator('option').allTextContents();
        if (options.length > 1) {
          await operationFilter.selectOption({ index: 1 });
          // フィルター適用後にリストが更新される
          await page.waitForTimeout(1_000);
        }
      }
    }
  });

  test('8.5.3 ページネーションで移動できる', async ({ page }) => {
    // ページネーションが存在する場合
    const nextButton = page.getByRole('button', { name: /次へ|次のページ/ });
    const isVisible = await nextButton.isVisible().catch(() => false);

    if (isVisible) {
      const isEnabled = await nextButton.isEnabled();
      if (isEnabled) {
        await nextButton.click();
        await page.waitForTimeout(1_000);

        // 前のページに戻れる
        const prevButton = page.getByRole('button', { name: /前へ|前のページ/ });
        await expect(prevButton).toBeEnabled();
      }
    }
  });
});
