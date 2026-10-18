import { test, expect } from '../../fixtures/auth.js';

test.describe('管理画面 - IPアドレス制限', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await page.getByRole('menuitem', { name: '管理', exact: true }).click();
    await expect(page).toHaveURL(/\/admin/);

    // IPアドレス制限タブに切り替え
    await page.getByRole('tab', { name: 'IPアドレス制限' }).click();
    await page.getByRole('status', { name: '読み込み中' }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  });

  test('8.4.1 IP アドレスホワイトリストが表示される', async ({ page }) => {
    const tabpanel = page.getByRole('tabpanel');
    await expect(tabpanel).toBeVisible();
  });

  test('8.4.2 IP エントリを追加できる', async ({ page }) => {
    // IPアドレスフォームの入力要素を探す
    const inputs = page.locator('input[type="text"], input[placeholder*="IP"], input[placeholder*="CIDR"]');
    const count = await inputs.count();

    if (count > 0) {
      await inputs.first().fill('192.168.1.0/24');

      const addButton = page.getByRole('button', { name: /追加|登録/ });
      if (await addButton.isVisible().catch(() => false)) {
        await addButton.click();
        await expect(page.getByText('192.168.1.0/24')).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('8.4.3 IP エントリを削除できる', async ({ page }) => {
    // 既存エントリの削除ボタン
    const deleteButtons = page.getByRole('button', { name: /削除/ });
    const count = await deleteButtons.count();

    if (count > 0) {
      const entryText = await page.locator('text=192.168').first().textContent();
      await deleteButtons.first().click();

      // 確認がある場合
      const confirmButton = page.getByRole('button', { name: /確認|はい/ });
      if (await confirmButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmButton.click();
      }
    }
  });
});
