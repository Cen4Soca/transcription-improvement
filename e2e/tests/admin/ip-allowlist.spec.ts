import { test, expect } from '../../fixtures/auth.js';
import type { Page } from '@playwright/test';

/**
 * 管理画面 - IPアドレス制限。dev 環境に対して実操作で検証する。
 *
 * 安全策:
 *   - 追加するエントリは必ず同テスト内で削除する（WAF 許可リストを汚さない）。
 *   - 既存 seed エントリ（10.0.0.0/8 等）には一切触れない。
 *   - 実行元 IP を誤って制限しないよう、ドキュメント用レンジ（198.51.100.0/24, TEST-NET-2）を使う。
 */

async function gotoIpTab(page: Page) {
  await page.getByRole('menuitem', { name: '管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.getByRole('tab', { name: 'IPアドレス制限' }).click();
  await expect(page.getByRole('tab', { name: 'IPアドレス制限' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
}

test.describe('管理画面 - IPアドレス制限', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await gotoIpTab(page);
  });

  test('8.4.1 IP アドレスホワイトリストが表示される', async ({ page }) => {
    // seed エントリ（4 件）が表示される
    await expect(
      page.getByRole('table', { name: 'IPアドレス許可リストテーブル' })
    ).toBeVisible();
    await expect(page.getByText('10.0.0.0/8')).toBeVisible();
  });

  test('8.4.2 / 8.4.3 IP エントリを追加・削除できる', async ({ page }) => {
    // ドキュメント用 TEST-NET-2 を使う（実行元 IP に影響しない）。説明で一意特定する。
    const cidr = '198.51.100.0/24';
    const description = `e2e-ui-${Date.now()}`;

    // --- 追加（8.4.2） ---
    await page.getByRole('button', { name: 'エントリ追加' }).click();
    const form = page.getByRole('form', { name: 'IPエントリ追加フォーム' });
    await form.getByLabel('CIDRブロック').fill(cidr);
    await form.getByLabel('説明（任意）').fill(description);
    await form.getByRole('button', { name: '追加' }).click();

    // 追加した説明がテーブルに現れる（CIDR は重複し得るため説明で一意特定）
    const row = page.getByRole('row', { name: new RegExp(description) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // --- 削除（8.4.3・後始末） ---
    await row.getByRole('button', { name: /を削除$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'エントリ削除の確認' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '削除する' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(description) })
    ).toBeHidden({ timeout: 15_000 });

    // 既存 seed エントリが消えていないことを確認する
    await expect(page.getByText('10.0.0.0/8')).toBeVisible();
  });
});
