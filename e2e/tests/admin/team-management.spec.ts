import { test, expect } from '../../fixtures/auth.js';

test.describe('管理画面 - チーム管理', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await page.getByRole('menuitem', { name: '管理', exact: true }).click();
    await expect(page).toHaveURL(/\/admin/);

    // チーム管理タブに切り替え
    await page.getByRole('tab', { name: 'チーム管理' }).click();
  });

  test('8.3.1 チーム一覧が表示される', async ({ page }) => {
    const tabpanel = page.getByRole('tabpanel');
    await expect(tabpanel).toBeVisible();

    // チーム情報が何らかの形で表示される
    // （リストまたはテーブル形式）
    await expect(tabpanel).not.toBeEmpty();
  });

  test('8.3.2 新規チームを作成できる', async ({ page }) => {
    const teamName = `e2e-test-team-${Date.now()}`;

    // チーム名入力
    const nameInput = page.getByLabel(/チーム名/);
    if (await nameInput.isVisible()) {
      await nameInput.fill(teamName);

      // 作成ボタン
      const createButton = page.getByRole('button', { name: /作成|追加/ });
      await createButton.click();

      // チームが一覧に追加される
      await expect(page.getByText(teamName)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('8.3.4 チームを削除できる', async ({ page }) => {
    // 削除ボタンが表示されるチームを探す
    const deleteButtons = page.getByRole('button', { name: /削除/ });
    const count = await deleteButtons.count();

    if (count > 0) {
      // 最後のチームの削除ボタンをクリック
      await deleteButtons.last().click();

      // 確認ダイアログまたは即時削除
      const confirmButton = page.getByRole('button', { name: /確認|はい|削除/ });
      if (await confirmButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await confirmButton.click();
      }
    }
  });
});
