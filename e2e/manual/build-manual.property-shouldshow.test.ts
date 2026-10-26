import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { shouldShow, renderStep } from './build-manual.js';
import type { ManualRole, ManualStep } from './build-manual.js';
// 共有 arbitraries は 4.1 のプロパティテストから再利用する（並行作業の競合回避のため別ファイル）。
import { manualStepArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------------------

/** Role_Filter の選択肢（「すべて」= 'ALL' と 3 ロール）。 */
const SELECTION_VALUES: Array<'ALL' | ManualRole> = [
  'ALL',
  'REVIEWER',
  'TEAM_LEADER',
  'ADMIN',
];

/** フィルタ選択値 R の arbitrary（'ALL' または特定 Manual_Role）。 */
const selectionArbitrary: fc.Arbitrary<'ALL' | ManualRole> =
  fc.constantFrom(...SELECTION_VALUES);

/**
 * renderStep(step) の出力文字列から `data-roles="..."` 属性値を抽出し、
 * スペース区切りトークンの集合を返す。属性が無い、または空文字の場合は空集合。
 * 表示判定が属性だけで決まることを検証するため、実装内部に依存せず出力から読み取る。
 */
function extractDataRoles(html: string): Set<string> {
  const match = /data-roles="([^"]*)"/.exec(html);
  if (!match) {
    return new Set<string>();
  }
  const raw = match[1].trim();
  if (raw === '') {
    return new Set<string>();
  }
  return new Set(raw.split(/\s+/));
}

// ---------------------------------------------------------------------------
// プロパティテスト
// ---------------------------------------------------------------------------

describe('Feature: solution-manual, Property 5: ロールフィルタ契約', () => {
  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * 任意の ManualStep とフィルタ選択値 R（'ALL' / 'REVIEWER' / 'TEAM_LEADER' /
   * 'ADMIN'）について、`shouldShow(step, R)` は R==='ALL' のとき真、そうでなければ
   * R ∈ step.roles のときにのみ真となる（R5.4「すべて」で全表示 / R5.3 特定ロールで
   * 当該ロールを含む手順のみ表示）。さらに renderStep(step) 出力の手順要素の
   * `data-roles` 属性が step.roles とちょうど集合一致し、表示判定が属性だけで
   * 決まることも検証する。
   */
  it('shouldShow は ALL で常に真・特定ロールで包含時のみ真、かつ data-roles は roles と集合一致する', () => {
    fc.assert(
      fc.property(manualStepArbitrary, selectionArbitrary, (step, selection) => {
        // --- shouldShow の契約 -----------------------------------------
        const shown = shouldShow(step, selection);
        if (selection === 'ALL') {
          // 'ALL' 選択時はロールに関わらず常に表示する（R5.4）。
          assert.equal(shown, true, 'ALL 選択時は常に表示されなければならない');
        } else {
          // 特定ロール選択時は、その手順の roles に選択ロールを含むときのみ表示（R5.3）。
          assert.equal(
            shown,
            step.roles.includes(selection),
            `特定ロール ${selection} の表示判定が roles 包含と一致しない`
          );
        }

        // --- data-roles 属性が step.roles と集合一致する -----------------
        // renderStep の出力から属性だけを読み取り、表示判定が属性で決まることを確認。
        const dataRoles = extractDataRoles(renderStep(step));
        const expected = new Set<string>(step.roles);
        assert.equal(
          dataRoles.size,
          expected.size,
          'data-roles のトークン数が step.roles の件数と一致しない'
        );
        for (const role of expected) {
          assert.ok(
            dataRoles.has(role),
            `data-roles に ${role} が欠落している`
          );
        }
        for (const role of dataRoles) {
          assert.ok(
            expected.has(role),
            `data-roles に余分なトークン ${role} が含まれている`
          );
        }

        // --- 属性だけで表示判定が決まることの確認 -----------------------
        // 特定ロール選択時、shouldShow の結果は data-roles 集合の包含と一致する。
        if (selection !== 'ALL') {
          assert.equal(
            shown,
            dataRoles.has(selection),
            '表示判定が data-roles 属性だけでは決まっていない'
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
