import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { collectSteps, groupAndSort, renderHtml, escapeHtml } from './build-manual.js';
// 共有 arbitrary は 2.2 のプロパティテストから再利用する（並行作業の競合回避のため別ファイル）。
import { stepsJsonFilesArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------------------

/**
 * HTML 文字列中に出現する `<article class="step"` の個数を数える。
 * renderStep が各手順を `<article class="step" ...>` で出力する契約に依存して、
 * 単一 HTML 内の手順要素総数を実装非依存に数える（属性以降は問わない）。
 */
function countStepArticles(html: string): number {
  const matches = html.match(/<article class="step"/g);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// プロパティテスト
// ---------------------------------------------------------------------------

describe('Feature: solution-manual, Property 2: 集約は単一 HTML にすべての手順を含める', () => {
  /**
   * **Validates: Requirements 4.2, 5.5**
   *
   * 任意の Steps_JSON 入力集合について、`renderHtml(groupAndSort(collectSteps(files)))`
   * が生成する単一 HTML は、入力の各 ManualStep につき手順要素（`<article class="step">`）を
   * ちょうど 1 つ含み、手順要素の総数が入力手順の総数に等しい。さらに各手順の
   * title・(エスケープ済み)description・screenshot パスがすべて HTML に含まれる。
   * title / description は手順間で重複し得るため、総数の厳密等価は article 要素のみで検証し、
   * 各 step の内容は「含まれる」ことを基本として検証する。
   */
  it('手順要素総数が入力総数に等しく、各手順の title・description・screenshot を含む', () => {
    fc.assert(
      fc.property(stepsJsonFilesArbitrary, (files) => {
        const steps = collectSteps(files);
        const html = renderHtml(groupAndSort(steps));

        // 手順要素（<article class="step">）の総数が入力手順の総数に等しい。
        // groupAndSort は手順を落とさず・増やさないため、collectSteps の件数と一致する。
        assert.equal(
          countStepArticles(html),
          steps.length,
          '手順要素の総数が入力手順の総数に一致しない'
        );

        // 各手順について、title・description・screenshot が
        // escapeHtml 済みの形で単一 HTML に含まれること（漏れがない）。
        for (const step of steps) {
          const escapedTitle = escapeHtml(step.title);
          const escapedDescription = escapeHtml(step.description);
          const escapedScreenshot = escapeHtml(step.screenshot);

          assert.ok(
            html.includes(escapedTitle),
            `HTML に手順の title（エスケープ後）が含まれていない: ${escapedTitle}`
          );
          assert.ok(
            html.includes(escapedDescription),
            `HTML に手順の description（エスケープ後）が含まれていない: ${escapedDescription}`
          );
          assert.ok(
            html.includes(escapedScreenshot),
            `HTML に手順の screenshot パス（エスケープ後）が含まれていない: ${escapedScreenshot}`
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
