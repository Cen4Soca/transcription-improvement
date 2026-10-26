import { test } from '../fixtures/auth.js';
import type { Route } from '@playwright/test';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「ランキング」。
 *
 * コントリビューターランキング画面の全体構成、期間フィルターの切り替え、
 * 自分の順位（「あなた」バッジ）を撮影する。全ロール共通の閲覧機能。
 *
 * 「自分の順位を確認する」手順は、現ユーザーがランキング内に含まれる状態を
 * 決定論的に撮るため、ランキング取得 API（GET /ranking）を固定レスポンスに
 * 差し替える（tests/ranking/ranking.spec.ts の route パターンを踏襲）。
 * seed データでは現ユーザーが上位に入る保証がないため、スクショの安定化に必要。
 */

/** GET /ranking の XHR/fetch 呼び出しだけにマッチする（SPA ドキュメント取得は除外）。 */
const RANKING_GLOB = /\/ranking(\?.*)?$/;

/** ランキング行を1件生成する。 */
function entry(rank: number, overrides: Record<string, unknown> = {}) {
  return {
    rank,
    userId: `ranker-${rank}`,
    displayName: `ランカー ${rank}`,
    answerCount: 100 - rank,
    accuracyRate: 90 - rank,
    score: 1000 - rank,
    ...overrides,
  };
}

test('manual: ランキング', async ({ page, loginAsReviewer }) => {
  const rec = new ManualRecorder(page, 'ランキング', 'ranking');

  // ログインしてランキング画面へ遷移
  await loginAsReviewer(page);
  await page.getByRole('menuitem', { name: 'ランキング' }).click().catch(() => {});
  await page
    .getByRole('main', { name: 'コントリビューターランキング' })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});

  // 1. ランキング画面
  await page
    .getByRole('table', { name: 'ランキングテーブル' })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await rec.capture({
    title: 'ランキング画面',
    description:
      'ナビゲーションの「ランキング」からコントリビューターランキングを開けます。順位・ユーザー名・回答数・正答率・スコアが一覧表示され、校閲への貢献度を確認できます。スコアは回答数と正答率（修正が多数決の正答に採用された割合）から算出されます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 500,
  });

  // 2. 期間で切り替える
  await page
    .getByRole('tablist', { name: '期間フィルター' })
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await rec.capture({
    title: '期間で切り替える',
    description:
      '期間フィルターで「全期間」「今月」「直近30日」を切り替えると、その期間の集計でランキングが更新されます。既定では「全期間」が選択されています。対象期間に該当データが無い場合は空状態メッセージが表示されます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  // 3. 自分の順位を確認する
  // 現ユーザーがランキング内に入る状態を注入し、「あなた」バッジを決定論的に撮る。
  // GET /ranking（XHR のみ）を固定レスポンスへ差し替える。
  await page.route(RANKING_GLOB, (route: Route) => {
    const req = route.request();
    if (req.method() !== 'GET' || req.resourceType() === 'document') {
      return route.fallback();
    }
    const me = entry(2, { userId: '__ME__', displayName: '自分' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          rankings: [entry(1), me, entry(3)],
          currentUser: me,
          pagination: {
            currentPage: 1,
            pageSize: 50,
            totalItems: 3,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      }),
    });
  });

  // 注入したレスポンスで再描画させる（全期間タブを押し直して再取得）。
  await page
    .getByRole('tablist', { name: '期間フィルター' })
    .getByRole('tab', { name: '全期間' })
    .click()
    .catch(() => {});
  await page
    .getByRole('table', { name: 'ランキングテーブル' })
    .getByText('あなた')
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await rec.capture({
    title: '自分の順位を確認する',
    description:
      'ランキング内の自分の行には「あなた」バッジが付き、その行がハイライト表示されます。自分がランキング圏外の場合は、テーブル下部に区切りとともに自分の順位が表示されるため、現在の立ち位置をすぐに把握できます。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    settleMs: 300,
  });

  rec.flush();
});
