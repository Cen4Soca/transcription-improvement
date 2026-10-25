import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Shared UI helpers for E2E specs.
 *
 * These utilities replace brittle patterns (unscoped `getByRole('button').first()`,
 * `waitForTimeout`, visibility guards that let tests pass vacuously) with
 * deterministic, seed-aware interactions.
 *
 * Seeded data (see e2e/seed/seed-data.ts) is a hard precondition for most specs:
 *   - 65 ReviewSessions (e2e-session-001..065)
 *   - first 3 sessions have 5 segments each + linked MediaFiles
 * Helpers that depend on seed data assert its presence instead of guarding on it.
 */

/** Known seeded session ids that have segments and a linked media file. */
export const SEEDED_MEDIA_SESSION_IDS = [
  'e2e-session-001',
  'e2e-session-002',
  'e2e-session-003',
] as const;

/**
 * Locate the "open review screen" button for a session list item.
 *
 * In the running app the session-select button carries
 * `aria-label="<name> - <status>"` and contains the visible text
 * 「校閲画面を開く」. Because the aria-label becomes the accessible name,
 * we match on the visible text node instead of the role name.
 */
export function openReviewButtons(page: Page): Locator {
  return page
    .getByRole('list', { name: 'セッション一覧' })
    .getByRole('button', { name: /.+ - (未着手|進行中|完了)$/ });
}

/**
 * Open the first session in the list and wait for the review screen route.
 * Asserts at least one session exists (fails loudly if seed data is missing).
 */
export async function openFirstSession(page: Page): Promise<void> {
  const buttons = openReviewButtons(page);
  await expect(
    buttons.first(),
    'セッション一覧に少なくとも1件のセッションが必要です（seed データ未投入の可能性）'
  ).toBeVisible({ timeout: 15_000 });
  await buttons.first().click();
  await page.waitForURL(/\/sessions\/.+/);
}

/**
 * Switch the session list status filter and wait for the server re-fetch.
 *
 * The list is server-driven: changing the filter sends `?status=` and the
 * server returns only matching sessions. We wait for that GET /sessions
 * response so assertions run against the refreshed DOM, not the stale one.
 */
export async function selectStatusFilter(
  page: Page,
  label: '全て' | '未着手' | '進行中' | '完了'
): Promise<void> {
  const tablist = page.getByRole('tablist', { name: 'ステータスフィルター' });
  const tab = tablist.getByRole('tab', { name: label });
  await Promise.all([
    page
      .waitForResponse(
        (r) =>
          /\/sessions(\?.*)?$/.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.request().resourceType() !== 'document'
      )
      .catch(() => {}),
    tab.click(),
  ]);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The session list (role=list, name セッション一覧). */
export function sessionList(page: Page): Locator {
  return page.getByRole('list', { name: 'セッション一覧' });
}

/** All list items in the session list. */
export function sessionItems(page: Page): Locator {
  return sessionList(page).getByRole('listitem');
}

/**
 * Wait for the session-list loading spinner (role=status 読み込み中) to disappear.
 * No-op if it was never shown.
 */
export async function waitForSessionListReady(page: Page): Promise<void> {
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
}

/**
 * Switch to an admin tab and wait for its loading spinner to clear.
 */
export async function openAdminTab(
  page: Page,
  tabName: 'ユーザー管理' | 'チーム管理' | 'IPアドレス制限' | '監査ログ'
): Promise<void> {
  await page.getByRole('tab', { name: tabName }).click();
  await expect(page.getByRole('tab', { name: tabName })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page
    .getByRole('status', { name: '読み込み中' })
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
}
