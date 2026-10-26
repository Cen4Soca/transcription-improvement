import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { groupAndSort, SECTION_ORDER } from './build-manual.js';
import { manualStepArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// プロパティテスト（Property 4）
// ---------------------------------------------------------------------------
// 共有 arbitrary（manualStepArbitrary）は既存の build-manual.property.test.ts
// から再利用する。本ファイルはセクション配置順のみを検証する。

/**
 * セクション名から規定順インデックスを返すヘルパ。
 * SECTION_ORDER に含まれる正規カテゴリはそのインデックス、
 * 未知カテゴリは末尾扱い（SECTION_ORDER.length）とする。
 * groupAndSort の出力 section は正規化済み（"管理 - *" は "管理" に畳まれる）なので、
 * ここでは SECTION_ORDER の直接一致のみを見ればよい。
 */
function orderIndex(section: string): number {
  const index = SECTION_ORDER.indexOf(section as (typeof SECTION_ORDER)[number]);
  // 未知カテゴリは末尾（最大インデックス）に置く。
  return index === -1 ? SECTION_ORDER.length : index;
}

describe('Feature: solution-manual, Property 4: セクションは規定順に配置される', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * 任意のセクション部分集合・任意ファイル順の ManualStep 集合について、
   * `groupAndSort` の出力に現れるセクション（正規化カテゴリ）の並びは、
   * 規定順 SECTION_ORDER の部分列になっている。すなわち出力グループの
   * section 名を規定順インデックスに写像した列が（未知カテゴリは末尾として）
   * 昇順に並んでいることを検証する。
   */
  it('groupAndSort の出力セクション順は規定順 SECTION_ORDER の部分列になる', () => {
    fc.assert(
      fc.property(fc.array(manualStepArbitrary, { maxLength: 40 }), (steps) => {
        const groups = groupAndSort(steps);

        // 出力グループの section 名を規定順インデックスへ写像する。
        const indices = groups.map((group) => orderIndex(group.section));

        // 隣接要素が昇順（規定順インデックスが単調非減少）であることを確認する。
        // これが成り立てば、出力セクション順は SECTION_ORDER の部分列である。
        for (let i = 1; i < indices.length; i += 1) {
          assert.ok(
            indices[i - 1] <= indices[i],
            `セクション順が規定順の部分列でない: ${JSON.stringify(
              groups.map((group) => group.section)
            )}`
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
