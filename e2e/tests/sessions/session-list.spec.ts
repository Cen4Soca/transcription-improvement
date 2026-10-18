import { test, expect } from '../../fixtures/auth.js';

test.describe('セッション一覧ページ', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
  });

  test('3.1 セッション一覧が表示される', async ({ page }) => {
    await expect(
      page.getByRole('main', { name: '校閲セッション一覧' })
    ).toBeVisible();

    // セッションリストが表示される
    const list = page.getByRole('list', { name: 'セッション一覧' });
    await expect(list).toBeVisible();
    const items = list.getByRole('listitem');
    await expect(items.first()).toBeVisible();
  });

  test('3.2 ステータスフィルター「全て」で全セッションが表示される', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
    const allTab = tablist.getByRole('tab', { name: '全て' });
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  test('3.3 ステータスフィルター「未着手」で絞り込みできる', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
    await tablist.getByRole('tab', { name: '未着手' }).click();

    // フィルター後のセッションは全て「未着手」バッジ
    const list = page.getByRole('list', { name: 'セッション一覧' });
    const items = list.getByRole('listitem');
    const count = await items.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(items.nth(i)).toContainText('未着手');
      }
    }
  });

  test('3.4 ステータスフィルター「進行中」で絞り込みできる', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
    await tablist.getByRole('tab', { name: '進行中' }).click();

    const list = page.getByRole('list', { name: 'セッション一覧' });
    const items = list.getByRole('listitem');
    const count = await items.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(items.nth(i)).toContainText('進行中');
      }
    }
  });

  test('3.5 ステータスフィルター「完了」で絞り込みできる', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
    await tablist.getByRole('tab', { name: '完了' }).click();

    const list = page.getByRole('list', { name: 'セッション一覧' });
    const items = list.getByRole('listitem');
    const count = await items.count();

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(items.nth(i)).toContainText('完了');
      }
    }
  });

  test('3.7 ページネーションが正しく動作する', async ({ page }) => {
    // 60件以上のデータがある場合のみテスト
    const pagination = page.getByRole('navigation', { name: 'ページネーション' });
    const isVisible = await pagination.isVisible().catch(() => false);

    if (isVisible) {
      await expect(page.getByText('1 /')).toBeVisible();
      await page.getByRole('button', { name: '次へ' }).click();
      await expect(page.getByText('2 /')).toBeVisible();
      await page.getByRole('button', { name: '前へ' }).click();
      await expect(page.getByText('1 /')).toBeVisible();
    }
  });

  test('3.8 セッションをクリックすると校閲画面に遷移する', async ({ page }) => {
    const list = page.getByRole('list', { name: 'セッション一覧' });
    const firstItem = list.getByRole('listitem').first();
    await firstItem.getByRole('button').click();

    await expect(page).toHaveURL(/\/sessions\/.+/);
    await expect(
      page.getByRole('main', { name: '校閲画面' })
    ).toBeVisible();
  });
});
