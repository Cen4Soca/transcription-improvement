import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { collectSteps } from './build-manual.js';
import type { ManualRole, ManualStep, StepsJson } from './build-manual.js';

// ---------------------------------------------------------------------------
// 共有 arbitraries
// ---------------------------------------------------------------------------
// ManualStep / StepsJson を生成する fc.Arbitrary 群。後続のプロパティテスト
// （2.4 / 2.5 など別ファイル）から再利用できるようにエクスポートする。

/** マニュアルが対象とする全ロール（roles 生成の母集合）。 */
const MANUAL_ROLES: ManualRole[] = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'];

/**
 * section 名の候補集合。SECTION_ORDER の値（規定カテゴリ）に加え、
 * "管理 - *" のサブセクションや未知カテゴリも混ぜ、グループ化・正規化を
 * 揺さぶれるようにする。
 */
const SECTION_CANDIDATES: string[] = [
  'ログイン',
  'ホーム',
  '文字起こし校閲',
  'Consensus',
  'アップロード',
  '言語モデル管理',
  'ランキング',
  '管理 - ユーザー管理',
  '管理 - IP制御',
  '管理 - 監査ログ',
  '未知セクション',
];

/**
 * roles の arbitrary。MANUAL_ROLES の空でない部分集合を生成する
 * （R1.5: 1 つ以上のロールから構成）。
 */
export const rolesArbitrary: fc.Arbitrary<ManualRole[]> = fc
  .subarray(MANUAL_ROLES, { minLength: 1, maxLength: MANUAL_ROLES.length })
  .map((roles) => [...roles]);

/** section の arbitrary（規定カテゴリ・"管理 - *"・未知を含む集合から選ぶ）。 */
export const sectionArbitrary: fc.Arbitrary<string> = fc.constantFrom(...SECTION_CANDIDATES);

/** 1 手順（ManualStep）の arbitrary。order は小さい整数に抑える。 */
export const manualStepArbitrary: fc.Arbitrary<ManualStep> = fc.record({
  section: sectionArbitrary,
  order: fc.integer({ min: 0, max: 20 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  description: fc.string({ minLength: 1, maxLength: 60 }),
  roles: rolesArbitrary,
  screenshot: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((name) => `screenshots/${name}.png`),
});

/** 1 ファイル分（StepsJson）の arbitrary。steps は 0 件以上を許容する。 */
export const stepsJsonArbitrary: fc.Arbitrary<StepsJson> = fc.record({
  section: sectionArbitrary,
  slug: fc.string({ minLength: 1, maxLength: 20 }),
  steps: fc.array(manualStepArbitrary, { maxLength: 8 }),
});

/** Steps_JSON 入力集合（StepsJson[]）の arbitrary。 */
export const stepsJsonFilesArbitrary: fc.Arbitrary<StepsJson[]> = fc.array(
  stepsJsonArbitrary,
  { maxLength: 6 }
);

// ---------------------------------------------------------------------------
// プロパティテスト
// ---------------------------------------------------------------------------

describe('Feature: solution-manual, Property 1: 読み込みは全手順を保全する', () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * 任意の有限個の Steps_JSON 入力集合について、`collectSteps` が返す
   * ManualStep 配列は各ファイルの steps を漏れなく含み、総数は各ファイルの
   * 手順数の総和に等しい。平坦化が手順を落とさず・増やさないことを保証する。
   */
  it('collectSteps は全手順を保全し、総数は各ファイル手順数の総和に等しい', () => {
    fc.assert(
      fc.property(stepsJsonFilesArbitrary, (files) => {
        const result = collectSteps(files);

        // 総数は各ファイルの steps 数の総和に等しい（漏れ・重複増殖がない）。
        const expectedTotal = files.reduce((sum, file) => sum + file.steps.length, 0);
        assert.equal(result.length, expectedTotal);

        // 期待される平坦化列（入力ファイル順 → 各 steps 順）とちょうど一致し、
        // 各手順オブジェクトが同一参照で漏れなく含まれることを検証する。
        const expected = files.flatMap((file) => file.steps);
        assert.equal(result.length, expected.length);
        for (let i = 0; i < expected.length; i += 1) {
          assert.equal(result[i], expected[i]);
        }
      }),
      { numRuns: 100 }
    );
  });
});
