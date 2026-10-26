import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderHtml, loadStepsJson, main } from './build-manual.js';
import type { ManualStep, SectionGroup } from './build-manual.js';

// ---------------------------------------------------------------------------
// テスト用の固定入力
// ---------------------------------------------------------------------------

/**
 * renderHtml に渡す固定の SectionGroup[]。
 * section "ホーム" に ManualStep を 2 件（order 昇順・異なる roles）持たせる。
 * 例ベースのため、プロパティテストのような網羅はせず代表的な 1 ケースを組み立てる。
 */
function buildFixtureGroups(): SectionGroup[] {
  const step1: ManualStep = {
    section: 'ホーム',
    order: 1,
    title: '校閲セッション一覧を開く',
    description: 'ホーム画面で校閲セッションの一覧を確認します。',
    roles: ['REVIEWER', 'TEAM_LEADER', 'ADMIN'],
    screenshot: 'screenshots/home-01.png',
  };
  const step2: ManualStep = {
    section: 'ホーム',
    order: 2,
    title: 'ステータスで絞り込む',
    description: '進行中のセッションだけに絞り込んで表示します。',
    roles: ['TEAM_LEADER', 'ADMIN'],
    screenshot: 'screenshots/home-02.png',
  };

  return [{ section: 'ホーム', steps: [step1, step2] }];
}

// ---------------------------------------------------------------------------
// 例ベース・ユニットテスト
// ---------------------------------------------------------------------------

describe('renderHtml: lang 属性 / ロールフィルタ / 日本語 UI', () => {
  // 固定入力から 1 度だけ HTML を生成して各検証で共有する。
  const html = renderHtml(buildFixtureGroups());

  it('ルート html 要素の lang 属性が ja である（R6.3）', () => {
    // <html lang="ja"> がそのまま出力されていること。
    assert.ok(
      html.includes('<html lang="ja">'),
      'ルート html 要素に lang="ja" が設定されていない'
    );
  });

  it('ロールフィルタが aria-label="ロールで絞り込み" の group として存在する（R7.3, R6.2）', () => {
    // 支援技術から識別可能なラベル付きの group（R7.3）。
    assert.ok(
      html.includes('role="group"'),
      'ロールフィルタの role="group" が出力されていない'
    );
    assert.ok(
      html.includes('aria-label="ロールで絞り込み"'),
      'ロールフィルタに aria-label="ロールで絞り込み" が設定されていない'
    );
  });

  it('ロールフィルタに ALL/REVIEWER/TEAM_LEADER/ADMIN のラジオがラベル付きで存在する（R5.2, R7.3）', () => {
    // 各選択肢が name="role" のラジオとして value 付きで出力されていること。
    const expectedValues = ['ALL', 'REVIEWER', 'TEAM_LEADER', 'ADMIN'];
    for (const value of expectedValues) {
      assert.ok(
        html.includes(`<input type="radio" name="role" value="${value}"`),
        `ロールフィルタに value="${value}" のラジオが存在しない`
      );
    }

    // 各ラジオは <label> で囲まれ、識別可能なラベルテキストを伴う（R7.3）。
    // ALL は日本語ラベル「すべて」、各ロールはトークン名をラベルに表示する。
    const expectedLabels = ['すべて', 'REVIEWER', 'TEAM_LEADER', 'ADMIN'];
    for (const label of expectedLabels) {
      assert.ok(
        html.includes(label),
        `ロールフィルタのラベル「${label}」が出力されていない`
      );
    }

    // ラジオ 4 個はすべて <label> の内側に置かれる（ラベル付けの担保）。
    const radioCount = (html.match(/<input type="radio" name="role"/g) ?? []).length;
    assert.equal(radioCount, 4, 'ロールフィルタのラジオが 4 個でない');
    const labelCount = (html.match(/<label>/g) ?? []).length;
    assert.ok(
      labelCount >= 4,
      'ラジオを囲む <label> が 4 個以上存在しない（ラベル付けが不足）'
    );
  });

  it('日本語 UI 文字列「ロールで絞り込み」「すべて」が存在する（R6.2）', () => {
    // UI テキストが日本語で表示されていること。
    assert.ok(html.includes('ロールで絞り込み'), 'UI 文字列「ロールで絞り込み」が無い');
    assert.ok(html.includes('すべて'), 'UI 文字列「すべて」が無い');
  });
});

// ---------------------------------------------------------------------------
// 空入力エッジケース（R4.6）
// ---------------------------------------------------------------------------

describe('loadStepsJson: 空入力エッジケース（R4.6）', () => {
  it('Steps_JSON が 0 件のとき日本語エラーを throw する', () => {
    // 空の一時ディレクトリを作り、*.json が 1 件も無い状態を再現する。
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-'));
    try {
      // R4.6: 0 件なら「steps JSON が見つかりません」を含むエラーで throw すること。
      assert.throws(
        () => loadStepsJson(tmpDir),
        /steps JSON が見つかりません/,
        'Steps_JSON が 0 件でも例外が throw されない、またはメッセージが一致しない'
      );
    } finally {
      // 一時ディレクトリは必ず後始末する（テスト失敗時もリークさせない）。
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // NOTE: main() は内部で固定の STEPS_DIR を読むため、空ディレクトリを直接渡せない。
  // main の exitCode 検証は STEPS_DIR が固定のため単体では空状態を直接検証できないため、
  // ここでは loadStepsJson の throw 検証を主とし、main のスキップに留める。
  // （main は import 時に副作用が走らないようガードされており、参照のみで未使用警告を避ける）
  void main;
});
