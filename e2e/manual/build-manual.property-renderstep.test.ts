import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { renderStep, escapeHtml, ALL_ROLES } from './build-manual.js';
// 共有 arbitraries は 4.1 のプロパティテストから再利用する（並行作業の競合回避のため別ファイル）。
import { manualStepArbitrary } from './build-manual.property.test.js';

// ---------------------------------------------------------------------------
// ヘルパ
// ---------------------------------------------------------------------------

/**
 * renderStep(step) の出力文字列からロールバッジのトークンを抽出する。
 * `<span class="badge badge-...">ROLE</span>` 形式のバッジ要素の内側テキストを
 * 正規表現で順に取り出し、配列として返す（重複・順序を保持して検証できるようにする）。
 * 実装内部に依存せず、出力 HTML からだけ読み取る。
 */
function extractBadgeTokens(html: string): string[] {
  const tokens: string[] = [];
  const re = /<span class="badge badge-[^"]*">([^<]*)<\/span>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * renderStep(step) の出力文字列から `<img ... alt="...">` の alt 属性値を抽出する。
 * alt 属性が無い場合は null を返す。
 */
function extractImgAlt(html: string): string | null {
  const match = /<img\b[^>]*\balt="([^"]*)"/.exec(html);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// プロパティテスト
// ---------------------------------------------------------------------------

describe('Feature: solution-manual, Property 6: ロールバッジは roles と一致し、既知ロールのみを含む', () => {
  /**
   * **Validates: Requirements 5.1, 1.5**
   *
   * 任意の ManualStep について、renderStep(step) が出力するロールバッジ集合が
   * step.roles とちょうど集合一致し（R5.1）、空ではなく（R1.5: 1 つ以上のロール）、
   * 各要素が既知ロール {REVIEWER, TEAM_LEADER, ADMIN} のいずれかであることを検証する。
   */
  it('バッジ集合は step.roles と集合一致し、空でなく、各要素が既知ロールのいずれかである', () => {
    fc.assert(
      fc.property(manualStepArbitrary, (step) => {
        const badges = extractBadgeTokens(renderStep(step));

        // 空でないこと（R1.5: 各手順は 1 つ以上のロールから構成される）。
        assert.ok(badges.length > 0, 'ロールバッジが 1 つも出力されていない');

        // 各要素が既知ロールのいずれかであること（未知ロールを出力しない）。
        for (const token of badges) {
          assert.ok(
            ALL_ROLES.includes(token as (typeof ALL_ROLES)[number]),
            `未知のロールバッジ ${token} が出力されている`
          );
        }

        // バッジ集合が step.roles とちょうど集合一致すること（R5.1）。
        const badgeSet = new Set<string>(badges);
        const expected = new Set<string>(step.roles);
        assert.equal(
          badgeSet.size,
          expected.size,
          'バッジのロール種別数が step.roles の件数と一致しない'
        );
        for (const role of expected) {
          assert.ok(badgeSet.has(role), `バッジに ${role} が欠落している`);
        }
        for (const role of badgeSet) {
          assert.ok(expected.has(role), `バッジに余分なロール ${role} が含まれている`);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: solution-manual, Property 8: すべてのスクリーンショットに説明的な alt を持つ', () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * 任意の ManualStep について、renderStep(step) が出力する img 要素の alt 属性が
   * 空でなく、かつ手順見出し（title）を含むことを検証する（R7.2: 代替テキストで
   * 内容を説明する）。title に HTML 特殊文字が含まれ得るため、escapeHtml 適用後の
   * 形で alt に含まれていることを確認する。
   */
  it('img の alt は空でなく、escapeHtml 後の title を含む', () => {
    fc.assert(
      fc.property(manualStepArbitrary, (step) => {
        const alt = extractImgAlt(renderStep(step));

        // alt 属性が存在し、空でないこと。
        assert.notEqual(alt, null, 'img に alt 属性が存在しない');
        assert.ok((alt as string).length > 0, 'img の alt が空文字である');

        // alt が escapeHtml 後の title を含むこと（出力はエスケープ済みのため期待値もエスケープする）。
        const escapedTitle = escapeHtml(step.title);
        assert.ok(
          (alt as string).includes(escapedTitle),
          'img の alt が title（エスケープ後）を含んでいない'
        );
      }),
      { numRuns: 100 }
    );
  });
});
