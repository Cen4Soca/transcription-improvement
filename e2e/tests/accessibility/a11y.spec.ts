import { test, expect } from '../../fixtures/auth.js';

test.describe('アクセシビリティ (WCAG 2.1 AA)', () => {
  test.describe('ランドマークとARIA属性', () => {
    test('9.1 セッション一覧ページに適切な role="main" と aria-label がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);

      const main = page.getByRole('main', { name: '校閲セッション一覧' });
      await expect(main).toBeVisible();
    });

    test('9.2 タブコンポーネントに正しいARIA属性がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);

      // ステータスフィルターのタブ
      const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
      await expect(tablist).toBeVisible();

      const tabs = tablist.getByRole('tab');
      await expect(tabs.first()).toBeVisible();

      // 選択されたタブには aria-selected="true" がある
      const selectedTab = tablist.getByRole('tab', { selected: true });
      await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
    });

    test('9.10 ナビゲーションに aria-label="メインナビゲーション" がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);

      const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
      await expect(nav).toBeVisible();
    });
  });

  test.describe('フォームとインタラクション', () => {
    test('9.3 ログインフォームの入力にラベルが関連付けられている', async ({ page }) => {
      await page.goto('./');
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

      const emailInput = page.getByLabel('メールアドレス');
      await expect(emailInput).toBeVisible();
      await expect(emailInput).toHaveAttribute('type', 'email');

      const passwordInput = page.getByLabel('パスワード');
      await expect(passwordInput).toBeVisible();
      await expect(passwordInput).toHaveAttribute('type', 'password');
    });

    test('9.6 キーボードでフォーカス移動ができる', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);

      // Tab キーでナビゲーション要素にフォーカスが移動する
      await page.keyboard.press('Tab');
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    });

    test('9.7 アップロードページのボタンに適切な aria-label がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);
      await page.goto('./upload');

      // ドロップエリアボタン
      const dropZone = page.getByRole('button', {
        name: 'ファイルを選択またはドラッグ＆ドロップ',
      });
      await expect(dropZone).toBeVisible();
    });
  });

  test.describe('エラーとステータス', () => {
    test('9.4 エラーメッセージに role="alert" がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);
      await page.goto('./upload');

      // 非対応ファイルを選択してエラーを発生させる
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'invalid.xyz',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(100, 0),
      });

      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
    });

    test('9.8 色のみに依存しないステータス表示がある', async ({
      page,
      loginAsReviewer,
    }) => {
      await loginAsReviewer(page);

      // セッション一覧のステータスバッジにテキストラベルがある
      const list = page.getByRole('list', { name: 'セッション一覧' });
      const isVisible = await list.isVisible().catch(() => false);

      if (isVisible) {
        const items = list.getByRole('listitem');
        const count = await items.count();

        if (count > 0) {
          // ステータスはテキスト（未着手/進行中/完了）で表示される
          const firstItem = items.first();
          const text = await firstItem.textContent();
          const hasStatusText =
            text?.includes('未着手') ||
            text?.includes('進行中') ||
            text?.includes('完了');
          expect(hasStatusText).toBeTruthy();
        }
      }
    });
  });

  test.describe('管理画面のアクセシビリティ', () => {
    test('9.2 管理画面タブに正しいARIA属性がある', async ({
      page,
      loginAsAdmin,
    }) => {
      await loginAsAdmin(page);
      await page.goto('./admin');

      const tablist = page.getByRole('tablist', { name: '管理画面タブ' });
      await expect(tablist).toBeVisible();

      // 各タブにid, aria-selected, aria-controls がある
      const userTab = tablist.getByRole('tab', { name: 'ユーザー管理' });
      await expect(userTab).toHaveAttribute('id', 'tab-users');
      await expect(userTab).toHaveAttribute('aria-controls', 'tabpanel-users');
      await expect(userTab).toHaveAttribute('aria-selected', 'true');

      // タブパネルに正しいaria-labelledbyがある
      const tabpanel = page.locator('#tabpanel-users');
      await expect(tabpanel).toHaveAttribute('aria-labelledby', 'tab-users');
    });
  });
});
