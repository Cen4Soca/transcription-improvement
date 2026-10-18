import { test, expect } from '../../fixtures/auth.js';

test.describe('カスタム言語モデル管理ページ', () => {
  test('6.1 Reviewer がアクセスすると「アクセス権限がありません」が表示される', async ({
    page,
    loginAsReviewer,
  }) => {
    await loginAsReviewer(page);
    await page.goto('./language-models');

    await expect(page.getByText('アクセス権限がありません')).toBeVisible();
    await expect(
      page.getByText('この機能は Admin または TeamLeader のみ利用できます')
    ).toBeVisible();
  });

  test.describe('Admin/TeamLeader アクセス', () => {
    test.beforeEach(async ({ page, loginAsTeamLeader }) => {
      await loginAsTeamLeader(page);
      await page.getByRole('menuitem', { name: '言語モデル管理' }).click();
      await expect(page).toHaveURL(/\/language-models/);
    });

    test('6.2 モデル作成フォームにアクセスできる', async ({ page }) => {
      await expect(page.getByText('新規モデル作成')).toBeVisible();
      await expect(page.getByText('モデル名')).toBeVisible();
      await expect(page.getByText('ベースモデル')).toBeVisible();
    });

    test('6.3 モデル名が空の状態で送信するとバリデーションエラーが出る', async ({ page }) => {
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      await expect(
        page.getByRole('alert')
      ).toContainText('モデル名を入力してください');
    });

    test('6.4 不正な文字を含むモデル名でバリデーションエラーが出る', async ({ page }) => {
      await page.locator('input[name="modelName"], input').first().fill('invalid model name!');
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      await expect(
        page.getByRole('alert')
      ).toContainText('英数字、ハイフン、アンダースコアのみ');
    });

    test('6.6 セッション未選択で送信するとバリデーションエラーが出る', async ({ page }) => {
      await page.locator('input[name="modelName"], input').first().fill('valid-model-name');
      await page.getByRole('button', { name: 'モデルを作成' }).click();

      await expect(
        page.getByRole('alert')
      ).toContainText('対象の校閲セッションを1つ以上選択してください');
    });

    test('6.7 ベースモデル（NarrowBand / WideBand）を選択できる', async ({ page }) => {
      // デフォルトは NarrowBand
      const narrowBandRadio = page.getByRole('radio', { name: 'NarrowBand' });
      await expect(narrowBandRadio).toBeChecked();

      // WideBand に切り替え
      const wideBandRadio = page.getByRole('radio', { name: 'WideBand' });
      await wideBandRadio.click();
      await expect(wideBandRadio).toBeChecked();
      await expect(narrowBandRadio).not.toBeChecked();
    });

    test('6.10 モデル一覧にステータスバッジが表示される', async ({ page }) => {
      await expect(page.getByText('モデル一覧')).toBeVisible();

      // モデルが存在する場合、ステータスバッジが表示される
      const modelList = page.getByRole('list', { name: 'カスタム言語モデル一覧' });
      const isVisible = await modelList.isVisible().catch(() => false);

      if (isVisible) {
        // ステータスバッジのいずれかが存在する
        const badges = page.locator('text=作成中, text=完了, text=失敗');
        await expect(badges.first()).toBeVisible();
      }
    });

    test('6.11 モデル一覧の「更新」ボタンでリストが再読み込みされる', async ({ page }) => {
      const refreshButton = page.getByRole('button', { name: 'モデル一覧を更新' });
      await expect(refreshButton).toBeVisible();
      await refreshButton.click();

      // 読み込み中状態が表示される
      await expect(
        page.getByText('読み込み中...').first()
      ).toBeVisible();
    });
  });
});
