import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { groupAndSort } from './build-manual.js';
import type { ManualStep } from './build-manual.js';
// 共有 arbitraries は 2.2 のプロパティテストから再利用する（並行作業の競合回避のため別ファイル）。
import { manualStepArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------------------

/**
 * テスト側で独立に section を正規カテゴリへ写像する（build-manual.ts の
 * normalizeSection と同契約）。"管理 - *" / "管理" は一律「管理」へ畳む。
 * それ以外はそのまま返す。実装と重複させることで、グループ化の正しさを
 * 実装内部に依存せず検証する。
 */
function normalizeSection(section: string): string {
  if (section === '管理' || section.startsWith('管理 - ')) {
    return '管理';
  }
  return section;
}

// ---------------------------------------------------------------------------
// プロパティテスト
// ---------------------------------------------------------------------------

describe('Feature: solution-manual, Property 3: セクション内は order 昇順に並ぶ', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * 任意の ManualStep 集合について、`groupAndSort` が返す各 SectionGroup は、
   * (1) その section が正規化カテゴリであること、(2) 同一の正規化カテゴリに
   * 属する手順がちょうど 1 つのグループにまとめられること、(3) グループ内の
   * 手順列が order の昇順（非減少）であること（「管理」配下はサブセクション
   * 既定順で区切られ、その各ブロック内で order 非減少であること）を保証する。
   */
  it('各グループは正規化カテゴリ単位でまとまり、グループ内は order 昇順である', () => {
    fc.assert(
      fc.property(fc.array(manualStepArbitrary, { maxLength: 30 }), (steps) => {
        const groups = groupAndSort(steps);

        // --- (1)(2) 同一の正規化カテゴリは単一グループにまとまる ---------
        // 出力グループの section は正規化カテゴリと一致し、重複しない。
        const seen = new Set<string>();
        for (const group of groups) {
          assert.equal(
            group.section,
            normalizeSection(group.section),
            'グループの section は正規化済みのカテゴリでなければならない'
          );
          assert.ok(
            !seen.has(group.section),
            `正規化カテゴリ ${group.section} が複数グループに分裂している`
          );
          seen.add(group.section);
        }

        // 入力に現れた正規化カテゴリの集合と、出力グループの集合は一致する
        // （漏れ・余剰グループがない）。
        const expectedCategories = new Set(
          steps.map((step) => normalizeSection(step.section))
        );
        assert.equal(
          seen.size,
          expectedCategories.size,
          'グループ数は入力に現れる正規化カテゴリ数と一致しなければならない'
        );
        for (const category of expectedCategories) {
          assert.ok(seen.has(category), `カテゴリ ${category} のグループが欠落している`);
        }

        // 各正規化カテゴリに属する入力手順の件数が、対応グループの件数と一致する
        // （手順がグループ間で漏れ・重複なく振り分けられている）。
        const byGroup = new Map(groups.map((group) => [group.section, group.steps]));
        for (const category of expectedCategories) {
          const expectedCount = steps.filter(
            (step) => normalizeSection(step.section) === category
          ).length;
          const bucket = byGroup.get(category);
          assert.ok(bucket, `カテゴリ ${category} のグループが存在しない`);
          assert.equal(
            bucket.length,
            expectedCount,
            `カテゴリ ${category} の手順数がグループ件数と一致しない`
          );
          // グループ内の各手順は、正規化後に確かにそのカテゴリへ属する。
          for (const step of bucket) {
            assert.equal(normalizeSection(step.section), category);
          }
        }

        // --- (3) グループ内は order 昇順（非減少） -----------------------
        // 「管理」グループは生の section（サブセクション）で区切られ、同一
        // サブセクションのブロック内で order が非減少となる。非「管理」グループ
        // は単一ブロックなので全体で order 非減少となる。
        for (const group of groups) {
          let prevRawSection: string | undefined;
          let prevOrder = -Infinity;
          for (const step of group.steps) {
            if (step.section !== prevRawSection) {
              // サブセクション境界で order の比較を仕切り直す。
              prevRawSection = step.section;
              prevOrder = -Infinity;
            }
            assert.ok(
              step.order >= prevOrder,
              `グループ ${group.section}（${step.section}）内で order が降順になっている: ${prevOrder} -> ${step.order}`
            );
            prevOrder = step.order;
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
