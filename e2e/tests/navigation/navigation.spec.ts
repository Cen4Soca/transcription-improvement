import { test, expect } from '../../fixtures/auth.js';

test.describe('ナビゲーション', () => {
  test('2.1 Reviewer ロールで共通リンクが表示される', async ({ page, loginAsReviewer }) => {
    await loginAsReviewer(page);

    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await expect(nav.getByRole('menuitem', { name: 'セッション一覧' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: 'メディアアップロード' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: 'ランキング' })).toBeVisible();
  });

  test('2.2 Reviewer ロールで「言語モデル管理」「管理」リンクが非表示', async ({ page, loginAsReviewer }) => {
    await loginAsReviewer(page);

    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await expect(nav.getByRole('menuitem', { name: '言語モデル管理' })).toBeHidden();
    await expect(nav.getByRole('menuitem', { name: '管理', exact: true })).toBeHidden();
  });

  test('2.3 TeamLeader ロールで「言語モデル管理」リンクが表示される', async ({ page, loginAsTeamLeader }) => {
    await loginAsTeamLeader(page);

    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await expect(nav.getByRole('menuitem', { name: '言語モデル管理' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: '管理', exact: true })).toBeHidden();
  });

  test('2.4 Admin ロールで全リンクが表示される', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);

    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await expect(nav.getByRole('menuitem', { name: 'セッション一覧' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: 'メディアアップロード' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: '言語モデル管理' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: 'ランキング' })).toBeVisible();
    await expect(nav.getByRole('menuitem', { name: '管理', exact: true })).toBeVisible();
  });

  test('2.5 アクティブページのリンクがハイライトされる', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);

    // ホーム（/）にいるのでセッション一覧がアクティブ。
    // react-router の NavLink は active 時に aria-current="page" を付与する（堅牢な判定）。
    const sessionLink = page.getByRole('menuitem', { name: 'セッション一覧' });
    await expect(sessionLink).toHaveAttribute('aria-current', 'page');
    // 視覚的ハイライト（bg-blue-50）も併せて確認
    await expect(sessionLink).toHaveClass(/bg-blue-50/);

    // 別ページへ移動するとアクティブが移る
    await page.getByRole('menuitem', { name: 'ランキング' }).click();
    await expect(page).toHaveURL(/\/ranking/);
    await expect(
      page.getByRole('menuitem', { name: 'ランキング' })
    ).toHaveAttribute('aria-current', 'page');
    await expect(sessionLink).not.toHaveAttribute('aria-current', 'page');
  });

  test('2.6 ナビゲーションリンクをクリックしてページ遷移する', async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);

    await page.getByRole('menuitem', { name: 'ランキング' }).click();
    await expect(page).toHaveURL(/\/ranking/);
    await expect(
      page.getByRole('main', { name: 'コントリビューターランキング' })
    ).toBeVisible();

    await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();
    await expect(page).toHaveURL(/\/upload/);
    await expect(
      page.getByRole('main', { name: 'メディアアップロード' })
    ).toBeVisible();
  });
});
