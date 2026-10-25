import { test, expect } from '../../fixtures/auth.js';
import { SEEDED_MEDIA_SESSION_IDS } from '../../helpers/ui-helper.js';

/**
 * 校閲画面テスト。
 *
 * seed のメディア紐付きセッション（e2e-session-001: mp3 + 5 segments）へ直接遷移して
 * 検証する。一覧先頭（最新 = session-065）はメディア未紐付けのため使わない。
 */
const MEDIA_SESSION = SEEDED_MEDIA_SESSION_IDS[0]; // e2e-session-001

/** メディア紐付きセッションの校閲画面を開く（Admin） */
async function openMediaReview(
  page: import('@playwright/test').Page,
  login: (p: import('@playwright/test').Page) => Promise<void>
) {
  await login(page);
  await page.goto(`./sessions/${MEDIA_SESSION}`);
  await expect(page.getByRole('main', { name: '校閲画面' })).toBeVisible();
}

test.describe('校閲画面', () => {
  test.describe('表示とレイアウト', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await openMediaReview(page, loginAsAdmin);
    });

    test('4.1 メディアプレーヤーと文字起こしエディタが表示される', async ({ page }) => {
      await expect(page.getByLabel('文字起こしパネル')).toBeVisible();
      await expect(page.getByLabel('メディアパネル')).toBeVisible();
      await expect(
        page.getByRole('list', { name: '文字起こしセグメント一覧' })
      ).toBeVisible();
    });

    test('4.2 レイアウトを左右分割から上下分割に切り替えできる', async ({ page }) => {
      await page.getByRole('button', { name: 'レイアウトを上下分割に切り替え' }).click();
      await expect(
        page.getByRole('button', { name: 'レイアウトを左右分割に切り替え' })
      ).toBeVisible();
    });

    test('4.3 レイアウトを上下分割から左右分割に切り替えできる', async ({ page }) => {
      await page.getByRole('button', { name: 'レイアウトを上下分割に切り替え' }).click();
      await page.getByRole('button', { name: 'レイアウトを左右分割に切り替え' }).click();
      await expect(
        page.getByRole('button', { name: 'レイアウトを上下分割に切り替え' })
      ).toBeVisible();
    });

    test('4.4 セグメントが表示され再生位置ハイライト対象になる', async ({ page }) => {
      // 実音声の自動再生に依存せず、セグメントが aria-current 対象要素として
      // 存在することを確認する（ハイライトの DOM 契約を検証）。
      const segments = page
        .getByRole('list', { name: '文字起こしセグメント一覧' })
        .getByRole('listitem');
      await expect(segments.first()).toBeVisible();
      expect(await segments.count()).toBeGreaterThan(0);
      await expect(segments.first()).toHaveAttribute('data-segment-id', /.+/);
    });

    test('4.5 セグメントクリックで編集モードに入りハイライトされる', async ({ page }) => {
      const segments = page
        .getByRole('list', { name: '文字起こしセグメント一覧' })
        .getByRole('listitem');
      const first = segments.first();
      await first.click();
      // クリックで編集モード（aria-current=true + 編集テキストエリア表示）
      await expect(first).toHaveAttribute('aria-current', 'true');
      await expect(page.getByLabel('編集テキスト').first()).toBeVisible();
    });

    test('4.6 セグメントのインライン編集ができる', async ({ page }) => {
      const segments = page
        .getByRole('list', { name: '文字起こしセグメント一覧' })
        .getByRole('listitem');
      await segments.first().click();

      const textarea = page.getByLabel('編集テキスト').first();
      await expect(textarea).toBeVisible();
      await textarea.fill('E2E で編集したテキスト');

      // 確定で POST /sessions/{id}/corrections が飛ぶ
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) =>
            /\/sessions\/.+\/corrections$/.test(r.url()) &&
            r.request().method() === 'POST'
        ),
        page.getByRole('button', { name: '編集を確定' }).first().click(),
      ]);
      expect(resp.ok()).toBeTruthy();
      // 編集後は修正後テキストが表示される
      await expect(page.getByText('E2E で編集したテキスト').first()).toBeVisible();
    });

    test('4.14 TranscriptionDownload セクションが表示される', async ({ page }) => {
      const section = page.getByLabel('Transcription ダウンロード');
      await expect(section).toBeVisible();
      await expect(
        section.getByRole('button', { name: 'ダウンロード' })
      ).toBeVisible();
    });
  });

  test.describe('権限別の削除ボタン表示', () => {
    test('4.7 Admin に「メディア削除」ボタンが表示される', async ({ page, loginAsAdmin }) => {
      await openMediaReview(page, loginAsAdmin);
      await expect(
        page.getByRole('button', { name: /メディア削除/ })
      ).toBeVisible();
    });

    test('4.8 Admin に「Transcription 削除」ボタンが表示される', async ({ page, loginAsAdmin }) => {
      await openMediaReview(page, loginAsAdmin);
      await expect(
        page.getByRole('button', { name: /Transcription 削除/ })
      ).toBeVisible();
    });

    test('4.9 Reviewer に削除ボタンが表示されない', async ({ page, loginAsReviewer }) => {
      await openMediaReview(page, loginAsReviewer);
      // 文字起こしパネルが見える = 画面ロード済み
      await expect(page.getByLabel('文字起こしパネル')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /メディア削除/ })
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: /Transcription 削除/ })
      ).toBeHidden();
    });
  });

  test.describe('削除確認ダイアログ', () => {
    test.beforeEach(async ({ page, loginAsAdmin }) => {
      await openMediaReview(page, loginAsAdmin);
    });

    test('4.10 メディア削除確認ダイアログが表示される', async ({ page }) => {
      await page.getByRole('button', { name: /メディア削除/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('メディアファイルの削除')).toBeVisible();
      await expect(dialog.getByText('この操作は取り消せません')).toBeVisible();
    });

    test('4.12 Transcription 削除確認ダイアログが表示される', async ({ page }) => {
      await page.getByRole('button', { name: /Transcription 削除/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Transcription の削除')).toBeVisible();
      await expect(dialog.getByText('この操作は取り消せません')).toBeVisible();
    });
  });

  test.describe('エラー・削除後の状態（レスポンス注入）', () => {
    test('4.11 メディア削除後に削除通知が表示されプレーヤーが消える', async ({
      page,
      loginAsAdmin,
    }) => {
      await openMediaReview(page, loginAsAdmin);
      // 削除 API（DELETE /media-files/{id}）を成功で差し替え、本番データを壊さない。
      await page.route(/\/media-files\/.+/, async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { deleted: true } }),
        });
      });
      await page.getByRole('button', { name: /メディア削除/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();

      await expect(
        page.getByText('メディアファイルは削除されました')
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByLabel('メディアパネル')).toBeHidden();
    });

    test('4.13 メディアエラー時にエラーメッセージが表示される', async ({
      page,
      loginAsAdmin,
    }) => {
      await loginAsAdmin(page);
      // メディア URL 取得 API を 403 にして、校閲画面にエラーバナーを出す。
      await page.route(/\/sessions\/.+\/media-url$/, async (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'forbidden' },
          }),
        })
      );
      await page.goto(`./sessions/${MEDIA_SESSION}`);
      await expect(page.getByRole('main', { name: '校閲画面' })).toBeVisible();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    });
  });
});
