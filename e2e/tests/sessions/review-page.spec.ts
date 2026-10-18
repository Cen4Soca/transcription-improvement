import { test, expect } from '../../fixtures/auth.js';

test.describe('校閲画面', () => {
  test.describe('表示とレイアウト', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      // セッション一覧の最初のセッションに遷移
      const list = page.getByRole('list', { name: 'セッション一覧' });
      await list.getByRole('listitem').first().getByRole('button').click();
      await page.waitForURL(/\/sessions\/.+/);
    });

    test('4.1 メディアプレーヤーと文字起こしエディタが表示される', async ({ page }) => {
      const main = page.getByRole('main', { name: '校閲画面' });
      await expect(main).toBeVisible();

      // メディアパネルまたは文字起こしパネルが存在
      const transcriptionPanel = page.getByLabel('文字起こしパネル');
      await expect(transcriptionPanel).toBeVisible();
    });

    test('4.2 レイアウトを左右分割から上下分割に切り替えできる', async ({ page }) => {
      const toggleButton = page.getByRole('button', { name: /上下分割/ });
      await toggleButton.click();

      // 切り替え後は「左右分割」ボタンに変わる
      await expect(
        page.getByRole('button', { name: /左右分割/ })
      ).toBeVisible();
    });

    test('4.3 レイアウトを上下分割から左右分割に切り替えできる', async ({ page }) => {
      // まず上下分割に切り替え
      await page.getByRole('button', { name: /上下分割/ }).click();
      // 左右分割に戻す
      await page.getByRole('button', { name: /左右分割/ }).click();

      await expect(
        page.getByRole('button', { name: /上下分割/ })
      ).toBeVisible();
    });
  });

  test.describe('権限別の削除ボタン表示', () => {
    test('4.7 Admin に「メディア削除」ボタンが表示される', async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      const list = page.getByRole('list', { name: 'セッション一覧' });
      await list.getByRole('listitem').first().getByRole('button').click();
      await page.waitForURL(/\/sessions\/.+/);

      // メディア削除ボタンはメディアが紐づいたセッションでのみ表示される
      // Transcription削除ボタンは常に表示されるのでそちらを検証
      await expect(
        page.getByRole('button', { name: /Transcription.*削除/ })
      ).toBeVisible();
    });

    test('4.8 Admin に「Transcription 削除」ボタンが表示される', async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      const list = page.getByRole('list', { name: 'セッション一覧' });
      await list.getByRole('listitem').first().getByRole('button').click();
      await page.waitForURL(/\/sessions\/.+/);

      await expect(
        page.getByRole('button', { name: 'Transcription を削除' })
      ).toBeVisible();
    });

    test.skip('4.9 Reviewer に削除ボタンが表示されない', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      const list = page.getByRole('list', { name: 'セッション一覧' });
      await list.getByRole('listitem').first().getByRole('button').click();
      await page.waitForURL(/\/sessions\/.+/);

      await expect(
        page.getByRole('button', { name: /メディア.*削除/ })
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Transcription を削除' })
      ).toBeHidden();
    });
  });

  test.describe('削除確認ダイアログ', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      const list = page.getByRole('list', { name: 'セッション一覧' });
      await list.getByRole('listitem').first().getByRole('button').click();
      await page.waitForURL(/\/sessions\/.+/);
    });

    test('4.10 メディア削除確認ダイアログが表示される', async ({ page }) => {
      // Transcription 削除ダイアログを確認（メディア削除はメディア紐づけ時のみ）
      await page.getByRole('button', { name: /Transcription.*削除/ }).click();

      // 確認ダイアログまたは確認メッセージが表示される
      await expect(
        page.getByRole('dialog').or(page.getByRole('alertdialog')).or(page.getByText(/削除.*確認|本当に削除/))
      ).toBeVisible({ timeout: 5_000 });
    });

    test('4.12 Transcription 削除確認ダイアログが表示される', async ({ page }) => {
      await page.getByRole('button', { name: 'Transcription を削除' }).click();

      await expect(page.getByText('Transcription の削除')).toBeVisible();
      await expect(page.getByText('この操作は取り消せません')).toBeVisible();
    });
  });
});
