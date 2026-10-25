import { test, expect } from '../../fixtures/auth.js';
import { expectNoAxeViolations } from '../../helpers/axe-helper.js';
import { openFirstSession } from '../../helpers/ui-helper.js';

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
        name: /ファイルを選択 ?またはドラッグ＆ドロップ/,
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

  test.describe('role="status" と フォーカスリング', () => {
    test('9.5 ステータスメッセージに role="status" がある', async ({
      page,
      loginAsReviewer,
    }) => {
      // アップロード成功メッセージは role="status"。実 S3 を汚さないようモックで完了させる。
      const uploadTarget = new URL('/e2e-a11y-upload-put', process.env.BASE_URL).toString();
      await loginAsReviewer(page);
      await page.route(/\/upload-url$/, (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            presignedUrl: uploadTarget,
            mediaFileId: 'e2e-a11y-001',
            s3Key: 'media/x/a.mp3',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
        });
      });
      await page.route(uploadTarget, (route) =>
        route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' })
      );

      await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'a11y-audio.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.alloc(1024, 0),
      });
      await page.getByRole('button', { name: 'アップロード開始' }).click();

      // 成功メッセージが role="status" で通知される
      const status = page.getByRole('status').filter({ hasText: 'アップロードが完了しました' });
      await expect(status).toBeVisible({ timeout: 15_000 });
    });

    test('9.9 フォーカスリングが表示される', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      await expect(page.getByRole('main', { name: '校閲セッション一覧' })).toBeVisible();
      // ステータスフィルターのタブは focus:ring-2 を持つ。フォーカス時にリングが
      // 付与される契約（focus:ring-2 クラスの存在）を検証する。
      const tab = page
        .getByRole('tablist', { name: 'ステータスフィルター' })
        .getByRole('tab', { name: '未着手' });
      await tab.focus();
      await expect(tab).toBeFocused();
      await expect(tab).toHaveClass(/focus:ring-2/);
    });
  });

  test.describe('axe-core 自動スキャン (WCAG 2.1 AA)', () => {
    test('9.A ログイン画面に axe 違反がない', async ({ page }) => {
      await page.goto('./');
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
      await expectNoAxeViolations(page);
    });

    test('9.B セッション一覧ページに axe 違反がない', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      await expect(page.getByRole('main', { name: '校閲セッション一覧' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('9.C 校閲画面に axe 違反がない', async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      await openFirstSession(page);
      await expect(page.getByRole('main', { name: '校閲画面' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('9.D メディアアップロードページに axe 違反がない', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      await page.getByRole('menuitem', { name: 'メディアアップロード' }).click();
      await expect(page.getByRole('main', { name: 'メディアアップロード' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('9.E ランキングページに axe 違反がない', async ({ page, loginAsReviewer }) => {
      await loginAsReviewer(page);
      await page.getByRole('menuitem', { name: 'ランキング' }).click();
      await expect(
        page.getByRole('main', { name: 'コントリビューターランキング' })
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('9.F 管理画面に axe 違反がない', async ({ page, loginAsAdmin }) => {
      await loginAsAdmin(page);
      await page.getByRole('menuitem', { name: '管理', exact: true }).click();
      await expect(page.getByRole('main', { name: '管理画面' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
});
