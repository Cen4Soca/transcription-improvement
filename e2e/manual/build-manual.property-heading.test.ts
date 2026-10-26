import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { groupAndSort, renderHtml } from './build-manual.js';
import { manualStepArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// プロパティテスト（Property 7）
// ---------------------------------------------------------------------------
// 共有 arbitrary（manualStepArbitrary）は既存の build-manual.property.test.ts
// から再利用する。本ファイルは生成 HTML の見出し階層のみを検証する。

/**
 * HTML から `<h1>`〜`<h3>` の開始タグを出現順に抽出し、見出しレベル列（1/2/3）を返す。
 * インライン CSS/JS 中に "h1" などの文字列が混ざっても拾わないよう、
 * 開始タグ（`<h1` / `<h2` / `<h3` に続く `>` または空白）のみを厳密にマッチさせる。
 */
function extractHeadingLevels(html: string): number[] {
  // 例: <h2>, <h2 class="...">, <h3 id="x"> などの開始タグを出現順に拾う。
  const regex = /<h([123])(?:\s[^>]*)?>/g;
  const levels: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    levels.push(Number(match[1]));
  }
  return levels;
}

describe('Feature: solution-manual, Property 7: 見出し階層を飛ばさない', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * 1 件以上の任意の ManualStep 集合について、`renderHtml(groupAndSort(steps))`
   * が生成する HTML は、(a) h1 をちょうど 1 つ持ち、(b) 各セクション（groupAndSort
   * の出力グループ）につき h2 を 1 つ、(c) 各手順につき h3 を 1 つ持つ。さらに
   * (d) 文書を先頭から走査した見出しレベル列は、レベルが増加する際に高々 1 ずつ
   * しか増えない（h1 の直後に h3 が来るような飛びがない）ことを保証する。
   */
  it('生成 HTML は単一 h1・セクション毎 h2・手順毎 h3 を持ち、見出し階層を飛ばさない', () => {
    fc.assert(
      fc.property(
        fc.array(manualStepArbitrary, { minLength: 1, maxLength: 30 }),
        (steps) => {
          const groups = groupAndSort(steps);
          const html = renderHtml(groups);
          const levels = extractHeadingLevels(html);

          // 期待値: セクション数（h2 の数）と総手順数（h3 の数）。
          const sectionCount = groups.length;
          const stepCount = groups.reduce((sum, group) => sum + group.steps.length, 0);

          const h1Count = levels.filter((level) => level === 1).length;
          const h2Count = levels.filter((level) => level === 2).length;
          const h3Count = levels.filter((level) => level === 3).length;

          // (a) h1 はちょうど 1 個。
          assert.equal(h1Count, 1, `h1 は 1 個であるべき: ${h1Count}`);

          // (b) 各セクションにつき h2 が 1 個 → h2 総数 = セクション数。
          assert.equal(
            h2Count,
            sectionCount,
            `h2 の数はセクション数と一致すべき: h2=${h2Count}, sections=${sectionCount}`
          );

          // (c) 各手順につき h3 が 1 個 → h3 総数 = 総手順数。
          assert.equal(
            h3Count,
            stepCount,
            `h3 の数は総手順数と一致すべき: h3=${h3Count}, steps=${stepCount}`
          );

          // (d) 走査順でレベルが増加するとき、前のレベル +1 以下（飛ばさない）。
          //     減少方向（例: h3 → h2）は制約しない。
          for (let i = 1; i < levels.length; i += 1) {
            if (levels[i] > levels[i - 1]) {
              assert.ok(
                levels[i] <= levels[i - 1] + 1,
                `見出し階層を飛ばしている: ${JSON.stringify(levels)} (index ${i})`
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
