import { test, expect } from '../../fixtures/auth.js';
import type { Page } from '@playwright/test';

/**
 * 管理画面 - チーム管理。dev 環境に対して実操作で検証する。
 * テスト専用チーム（名前に e2e-ui- プレフィックス）を作成し、各操作後に削除して後始末する。
 */

async function gotoTeamTab(page: Page) {
  await page.getByRole('menuitem', { name: '管理', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.getByRole('tab', { name: 'チーム管理' }).click();
  await expect(page.getByRole('tab', { name: 'チーム管理' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
}

/** テスト専用チームを作成し、一覧に現れるまで待つ。チーム名を返す。 */
async function createTeam(page: Page): Promise<string> {
  const name = `e2e-ui-team-${Date.now()}`;
  await page.getByRole('button', { name: 'チーム作成' }).click();
  const form = page.getByRole('form', { name: 'チーム作成フォーム' });
  await form.getByLabel('チーム名').fill(name);
  await form.getByRole('button', { name: '作成' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
  return name;
}

/** 指定名チームの li 要素を返す。 */
function teamItem(page: Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name });
}

/** チームを削除する（後始末用）。 */
async function deleteTeam(page: Page, name: string) {
  const item = teamItem(page, name);
  if (!(await item.count())) return;
  await item.getByRole('button', { name: `${name}を削除` }).click();
  const dialog = page.getByRole('dialog', { name: 'チーム削除の確認' });
  await dialog.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText(name, { exact: true })).toBeHidden({ timeout: 15_000 });
}

test.describe('管理画面 - チーム管理', () => {
  test.beforeEach(async ({ page, loginAsAdmin }) => {
    await loginAsAdmin(page);
    await gotoTeamTab(page);
  });

  test('8.3.1 チーム一覧が表示される', async ({ page }) => {
    // seed チーム（E2E テストチーム A）が一覧に存在する
    await expect(page.getByRole('list', { name: 'チーム一覧' })).toBeVisible();
    await expect(page.getByText('E2E テストチーム A')).toBeVisible();
  });

  test('8.3.2 新規チームを作成できる', async ({ page }) => {
    const name = await createTeam(page);
    await deleteTeam(page, name); // 後始末
  });

  test('8.3.3 チーム名を編集できる', async ({ page }) => {
    const name = await createTeam(page);
    const renamed = `${name}-renamed`;
    await teamItem(page, name).getByRole('button', { name: `${name}を編集` }).click();
    // 編集モードでは入力欄に名前が移り listitem の hasText フィルタから外れるため、
    // ページ全体から編集入力欄を特定する。
    const editInput = page.getByLabel('チーム名を編集');
    await expect(editInput).toBeVisible({ timeout: 10_000 });
    await editInput.fill(renamed);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 15_000 });
    await deleteTeam(page, renamed);
  });

  test('8.3.4 チームを削除できる', async ({ page }) => {
    const name = await createTeam(page);
    await teamItem(page, name).getByRole('button', { name: `${name}を削除` }).click();
    const dialog = page.getByRole('dialog', { name: 'チーム削除の確認' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText(name, { exact: true })).toBeHidden({ timeout: 15_000 });
  });

  test('8.3.5 / 8.3.6 チームにメンバーを追加・削除できる', async ({ page, testUsers }) => {
    const name = await createTeam(page);
    const item = teamItem(page, name);
    // チーム名ボタンを押して詳細（メンバー）を展開
    await item.getByRole('button', { name, exact: true }).click();

    // メンバー追加（globalSetup の Reviewer を userId=value で選択）
    const memberSelect = item.getByLabel('追加するメンバーを選択');
    await expect(memberSelect).toBeVisible();
    await memberSelect.selectOption(testUsers.reviewer.userId);
    await item.getByRole('button', { name: '追加' }).click();

    // メンバー一覧に表示される
    const memberList = item.getByRole('list', { name: `${name}のメンバー` });
    await expect(memberList.getByText(testUsers.reviewer.displayName)).toBeVisible({ timeout: 15_000 });

    // メンバー削除（8.3.6）
    await memberList
      .getByRole('button', { name: `${testUsers.reviewer.displayName}をチームから削除` })
      .click();
    await expect(
      memberList.getByText(testUsers.reviewer.displayName)
    ).toBeHidden({ timeout: 15_000 });

    await deleteTeam(page, name);
  });

  test('8.3.7 チームにセッションを割り当てできる', async ({ page }) => {
    const name = await createTeam(page);
    const item = teamItem(page, name);
    // 割り当てセクションを開く（aria-label 完全一致で開くボタンを特定）
    await item.getByRole('button', { name: `${name}にセッション割り当て` }).click();

    const sessionSelect = item.getByLabel('割り当てるセッションを選択');
    await expect(sessionSelect).toBeVisible();
    // 先頭の割り当て可能セッションを選ぶ
    const options = sessionSelect.locator('option');
    const optionValue = await options.nth(1).getAttribute('value');
    expect(optionValue).toBeTruthy();
    await sessionSelect.selectOption(optionValue!);
    // 実行ボタンは exact で開くボタン（aria-label）と区別する
    await item.getByRole('button', { name: '割り当て', exact: true }).click();

    // 割り当て済みリストに表示される
    await expect(
      item.getByRole('list', { name: `${name}の割り当て済みセッション` })
    ).toBeVisible({ timeout: 15_000 });

    await deleteTeam(page, name);
  });
});
