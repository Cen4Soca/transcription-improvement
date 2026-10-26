# Implementation Plan: solution-manual

## Overview

実装は 2 系統に分かれる。(1) Manual_Builder（`e2e/manual/build-manual.ts`）の純粋変換関数群と I/O ラッパ、およびその co-location ユニット／fast-check プロパティテスト。(2) Manual_Spec 群（02〜08）を design の撮影計画に従い実装。段階は「Builder とそのテスト → 各 Manual_Spec → npm script → 最終動作確認」の順で進め、各ステップは前段へ積み上げる。

言語は TypeScript ESM（相対 import は `.js` 拡張子）、コメントは日本語。新規ファイルはすべて `e2e/manual/` 配下に置き、既存の `ManualRecorder` / `Auth_Fixture` / `01-login.spec.ts` のパターンへ準拠する。`ManualRecorder` は変更しない。

テスト実行方針: Builder は純粋変換なので、fast-check を用いたプロパティテストと例ベースのユニットテストを co-location で用意する。Builder テストは `tsx --test`（Node 組み込みテストランナー）で実行し、Playwright E2E（`manual/*.spec.ts`）とは分離する。HTML 検証は正規表現／属性抽出で行い、JS 実行は不要（ロールフィルタは純粋関数 `shouldShow` で検証）。

## Tasks

- [x] 1. Manual_Builder のスケルトンと型・定数を定義する
  - `e2e/manual/build-manual.ts` を新規作成し、`ManualRole` / `ManualStep` / `StepsJson` / `SectionGroup` 型、`SECTION_ORDER`（`['ログイン','ホーム','文字起こし校閲','Consensus','アップロード','言語モデル管理','ランキング','管理']`）、`ALL_ROLES` 定数を宣言する
  - 純粋関数 `collectSteps` / `groupAndSort` / `sectionRank` / `renderStep` / `renderHtml` / `shouldShow`、I/O ラッパ `loadStepsJson` / `main` のシグネチャを `export` で用意する（本体は後続タスクで実装）
  - HTML エスケープ用のヘルパ（title / description / section / screenshot を安全化）を用意する
  - 相対 import は `.js` 拡張子、コメントは日本語
  - _Requirements: 4.1, 4.2_

- [x] 2. 収集・グループ化・ソートの純粋関数を実装する
  - [x] 2.1 `collectSteps(files)` を実装する
    - `StepsJson[]` の各 `steps` を漏れなく 1 本の `ManualStep[]` へ平坦化する（順序は入力ファイル順 → 各 steps 順）
    - _Requirements: 4.1_

  - [x] 2.2 `collectSteps` のプロパティテストを書く
    - **Property 1: 読み込みは全手順を保全する**
    - 出力総数が各ファイル手順数の総和に等しく、全手順が含まれることを検証（`fc.array` で StepsJson 集合を生成）
    - `e2e/manual/build-manual.property.test.ts`、`{ numRuns: 100 }`、`Feature: solution-manual, Property 1:` 形式
    - **Validates: Requirements 4.1**

  - [x] 2.3 `sectionRank(section)` と `groupAndSort(steps)` を実装する
    - `sectionRank` は section 名を正規カテゴリへ写像（`管理 - *` → `管理`）し `SECTION_ORDER` のインデックスを返す。未知カテゴリは末尾（最大 rank）
    - `groupAndSort` は正規化カテゴリ単位でグループ化し、各グループ内を order 昇順にソートする。「管理」配下は slug 既定順 users → ip → audit を保ったうえで order で安定ソートする
    - 出力グループ列は `sectionRank` の昇順（規定セクション順）に並べる
    - _Requirements: 4.3, 4.4_

  - [x] 2.4 `groupAndSort` のプロパティテストを書く
    - **Property 3: セクション内は order 昇順に並ぶ**（各グループ内が非減少、同一 section は同一グループ）
    - **Validates: Requirements 4.3**

  - [x] 2.5 セクション配置順のプロパティテストを書く
    - **Property 4: セクションは規定順に配置される**（任意のセクション部分集合・任意ファイル順で、出力カテゴリ列が規定順の部分列になる）
    - **Validates: Requirements 4.4**

- [x] 3. Checkpoint - Builder 変換（収集・ソート）のテストを通す
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. ロールフィルタと手順レンダリングの純粋関数を実装する
  - [x] 4.1 `shouldShow(step, selection)` を実装する
    - `selection === 'ALL'` で常に真、それ以外は `step.roles.includes(selection)` のときのみ真
    - _Requirements: 5.3, 5.4_

  - [x] 4.2 `shouldShow` のプロパティテストを書く
    - **Property 5: ロールフィルタ契約**（`ALL` は真、他は `R ∈ roles` のときのみ真。手順要素の `data-roles` が step.roles とちょうど一致する点も `renderStep` 出力から検証）
    - **Validates: Requirements 5.3, 5.4**

  - [x] 4.3 `renderStep(step)` を実装する
    - `<article class="step" data-roles="…">`（roles をスペース区切り）、`<h3>` 見出し、ロールバッジ（step.roles と一致、既知 3 ロールのみ）、日本語の説明 `<p class="desc">`、`<img>`（`alt="{section}: {title} — {description 要約}"`、空にしない）を出力
    - title / description / section / screenshot を HTML エスケープする
    - _Requirements: 5.1, 1.5, 6.1, 7.2_

  - [x] 4.4 `renderStep` のバッジ・alt のプロパティテストを書く
    - **Property 6: ロールバッジは roles と一致し、既知ロールのみを含む**（バッジ集合 = step.roles、空でない、各要素は REVIEWER/TEAM_LEADER/ADMIN）
    - **Property 8: すべてのスクリーンショットに説明的な alt を持つ**（対応 img の alt が空でなく title を含む）
    - **Validates: Requirements 5.1, 1.5, 7.2**

- [x] 5. 完全な HTML 文書を生成する `renderHtml` を実装する
  - [x] 5.1 `renderHtml(groups)` を実装する
    - `<!doctype html>` + `<html lang="ja">`、`<head>`（charset・title・インライン CSS）、`<header>`（単一 `<h1>` 文書タイトル + ロールフィルタ `role="group" aria-label="ロールで絞り込み"`、ラジオ「すべて/REVIEWER/TEAM_LEADER/ADMIN」各ラベル付き）
    - `<main>` にグループごとの `<section>`＋`<h2>`（セクション名、規定順）、配下に `renderStep` の `<article>` を order 昇順で出力
    - インライン `<script>`（ラジオ `change` → 各 `.step` の `data-roles` を見て表示切替、`shouldShow` と同等ロジック。表示手順が 0 のセクションは見出しごと `hidden`）
    - 見出し階層を h1 → h2 → h3 で飛ばさない
    - _Requirements: 4.2, 5.2, 5.5, 6.2, 6.3, 7.1, 7.3_

  - [x] 5.2 集約網羅のプロパティテストを書く
    - **Property 2: 集約は単一 HTML にすべての手順を含める**（各 ManualStep につき手順要素 1 つ、title・エスケープ済み description・screenshot を含み、手順要素総数 = 入力総数）
    - **Validates: Requirements 4.2, 5.5**

  - [x] 5.3 見出し階層のプロパティテストを書く
    - **Property 7: 見出し階層を飛ばさない**（h1 がちょうど 1、各出力セクションに h2 が 1、各手順に h3。先頭から走査した見出しレベル列は増加時に高々 +1）
    - **Validates: Requirements 7.1**

  - [x] 5.4 日本語 UI とフィルタ・lang 属性の例ベース・ユニットテストを書く
    - `<html lang="ja">` を出力（R6.3）、フィルタに「すべて/REVIEWER/TEAM_LEADER/ADMIN」が各ラベル付きで存在（R5.2, R7.3）、日本語 UI 文字列「ロールで絞り込み」「すべて」が存在（R6.2）
    - `e2e/manual/build-manual.test.ts`
    - _Requirements: 5.2, 6.2, 6.3, 7.3_

- [x] 6. I/O ラッパ `loadStepsJson` / `main` を実装し Builder を結線する
  - [x] 6.1 `loadStepsJson(stepsDir)` と `main()` を実装する
    - `loadStepsJson` は `output/steps/*.json` を読み込み `StepsJson[]` を返す。0 件なら日本語エラー（例:「steps JSON が見つかりません。先に `npm run manual` を実行してください。」）を stderr に出力し例外化。不正 JSON はファイル名を含むエラーで非ゼロ終了
    - `main()` は load → `collectSteps` → `groupAndSort` → `renderHtml` → `output/manual.html` 書き出し。0 件時は `process.exitCode = 1`
    - エントリポイントとして `main()` を実行する（`tsx manual/build-manual.ts` で起動）
    - _Requirements: 4.1, 4.2, 4.6_

  - [x] 6.2 空入力エッジケースのユニットテストを書く
    - Steps_JSON 0 件で `loadStepsJson`/`main` が非ゼロ終了しエラーメッセージを出すことを検証（一時ディレクトリを使用）
    - `e2e/manual/build-manual.test.ts`
    - _Requirements: 4.6_

- [x] 7. Checkpoint - Builder 全体（レンダリング・I/O）のテストを通す
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. ホーム・校閲・Consensus の Manual_Spec を実装する
  - [x] 8.1 `02-home.spec.ts`（セクション「ホーム」, slug `home`, `loginAsAdmin`）を実装する
    - 撮影計画に従い order 1〜4 を `capture()`: 校閲セッション一覧（`main[校閲セッション一覧]`+`list[セッション一覧]`）/ ステータス絞り込み（`tablist[ステータスフィルター]`「進行中」）/ ページ移動（`navigation[ページネーション]`）/ メインナビゲーション（`navigation[メインナビゲーション]`）
    - roles は全手順 REVIEWER/TEAM_LEADER/ADMIN、description は日本語、末尾で `flush()`
    - `01-login.spec.ts` のパターンに準拠、相対 import は `.js`
    - _Requirements: 2.2, 3.1, 3.4, 1.4, 1.5_

  - [x] 8.2 `03-review.spec.ts`（セクション「文字起こし校閲」, slug `review`, `loginAsAdmin`）を実装する
    - `./sessions/e2e-session-001` へ遷移し order 1〜6 を `capture()`: 校閲画面全体（`main[校閲画面]`）/ セグメント編集（`listitem`→`編集テキスト`）/ 編集確定（`button[編集を確定]`）/ 同期再生（`region[メディアプレイヤー]`）/ AI 修正候補（`button[修正候補を表示]`→`dialog[修正候補]`）/ レイアウト切替（`button[レイアウトを上下分割に切り替え]`）
    - AI 修正候補の取得 API は `page.route` で固定レスポンスに差し替えてから撮影（決定論的スクショ）
    - _Requirements: 2.3, 3.1, 3.4, 1.4, 1.5_

  - [x] 8.3 `04-consensus.spec.ts`（セクション「Consensus」, slug `consensus`, `loginAsAdmin`）を実装する
    - order 1〜3 を `capture()`: 多数決の概要（`group[強制集約の操作]`, roles TEAM_LEADER/ADMIN）/ 強制集約して確定（`button[強制集約して確定]`→`group[強制集約の確認]`, TEAM_LEADER/ADMIN）/ 競合解決（競合解決パネル, ADMIN）
    - 集約 API は `page.route` で成功レスポンスに差し替え、UI 状態のみ撮影（seed を汚さない）
    - _Requirements: 2.4, 3.1, 3.4, 1.4, 1.5_

- [x] 9. アップロード・言語モデル・ランキングの Manual_Spec を実装する
  - [x] 9.1 `05-upload.spec.ts`（セクション「アップロード」, slug `upload`, `loginAsReviewer`）を実装する
    - order 1〜3 を `capture()`: アップロード画面（`menuitem[メディアアップロード]`→`main[メディアアップロード]`）/ ファイル選択（`input[type=file]`→`[選択されたファイル]`）/ アップロード開始（`button[アップロード開始]` 後の進捗・完了）
    - `upload-url` 取得と S3 PUT を `page.route` で成功固定（`tests/upload` と同手法）し実 S3 を叩かない
    - roles は全手順 REVIEWER/TEAM_LEADER/ADMIN
    - _Requirements: 2.5, 3.1, 3.4, 1.4, 1.5_

  - [x] 9.2 `06-language-models.spec.ts`（セクション「言語モデル管理」, slug `language-models`, `loginAsAdmin`）を実装する
    - order 1〜4 を `capture()`: 管理画面（`menuitem[言語モデル管理]`→新規作成フォーム `label[モデル名]`）/ ベースモデル選択（`radio[NarrowBand]`/`radio[WideBand]`）/ 対象セッション選択（チーム選択→候補 `checkbox`）/ モデル一覧（`list[カスタム言語モデル一覧]` ステータスバッジ）
    - 読み取り系 API（`/me/teams`, `/sessions`, `/language-models`, assignments）を `page.route` でモック固定（`tests/language-models` と同手法）
    - roles は全手順 TEAM_LEADER/ADMIN
    - _Requirements: 2.6, 3.1, 3.2, 3.4, 1.4, 1.5_

  - [x] 9.3 `07-ranking.spec.ts`（セクション「ランキング」, slug `ranking`, `loginAsReviewer`）を実装する
    - order 1〜3 を `capture()`: ランキング画面（`menuitem[ランキング]`→`table[ランキングテーブル]`）/ 期間切替（`tablist[期間フィルター]` 全期間/今月/直近30日）/ 自分の順位（現ユーザー行の「あなた」バッジ, `page.route` で現ユーザー入りデータ注入）
    - roles は全手順 REVIEWER/TEAM_LEADER/ADMIN
    - _Requirements: 2.7, 3.1, 3.4, 1.4, 1.5_

- [x] 10. 管理 Manual_Spec を実装する
  - [x] 10.1 `08-admin.spec.ts`（`loginAsAdmin`、1 ファイル内でサブセクション別 `ManualRecorder`）を実装する
    - slug `admin-users`（セクション「管理 - ユーザー管理」）: 管理画面を開く（`menuitem[管理]`→`main[管理画面]`+`tablist[管理画面タブ]`）/ ユーザー一覧（`tab[ユーザー管理]`→`table[ユーザー一覧テーブル]`）/ ユーザー登録（`button[ユーザー追加]`→`form[ユーザー登録フォーム]`、フォーム表示までで POST しない）
    - slug `admin-ip`（セクション「管理 - IP制御」）: IP 制限（`tab[IPアドレス制限]`→`table[IPアドレス許可リストテーブル]`）/ エントリ追加（`button[エントリ追加]`→`form[IPエントリ追加フォーム]`、フォーム表示まで、許可リストは汚さない）
    - slug `admin-audit`（セクション「管理 - 監査ログ」）: 監査ログ一覧（`tab[監査ログ]`→`table[監査ログテーブル]`）/ 操作種別で絞り込む（`form[監査ログフィルタ]` の `label[操作種別]`、削除は撮影しない）
    - 各サブセクションごとに別 `ManualRecorder` を生成し個別 `flush()`、roles は全手順 ADMIN
    - _Requirements: 2.8, 3.1, 3.3, 3.4, 1.4, 1.5_

- [x] 11. npm script と依存を追加して結線する
  - `e2e/package.json` の `scripts` に `"manual": "playwright test manual/"` と `"manual:build": "tsx manual/build-manual.ts"` を追加する
  - Builder テスト実行用スクリプト（例: `"manual:test": "tsx --test manual/build-manual.test.ts manual/build-manual.property.test.ts"`）を追加し、`devDependencies` に `fast-check` を追加する
  - _Requirements: 4.5_

- [x] 12. Final checkpoint - Builder テストと Manual_Spec の結線を検証する
  - Builder のユニット／プロパティテストを実行して全て通す。各 Manual_Spec（02〜08）がファイルとして存在し、design の撮影計画どおりのセクション・roles・日本語 description で記録することをレビューで確認する
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` 付きサブタスクはテスト（ユニット／プロパティ／エッジ）で、MVP では省略可。`*` なしのコア実装タスクは必ず実装する。
- Builder の純粋関数（`collectSteps`/`groupAndSort`/`sectionRank`/`renderStep`/`renderHtml`/`shouldShow`）に対して design の Correctness Properties 1〜8 をプロパティテストで検証する（fast-check, `{ numRuns: 100 }`, `Feature: solution-manual, Property N:` 形式）。
- Manual_Spec 群は live browser・外部認証に依存するため PBT 対象外。存在確認・記録セクション名・ロール fixture の正当性はレビューと `npm run manual` のスモークで担保する。
- 副作用のある画面（AI 修正候補・集約確定・アップロード・モデル作成）は `page.route` で固定レスポンスに差し替え、seed データや外部リソースを汚さず決定論的に撮影する。
- `ManualRecorder` は変更しない。各 Manual_Spec は `01-login.spec.ts` のパターンに準拠する。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "6.1"] },
    { "id": 6, "tasks": ["6.2", "8.1", "8.2", "8.3", "9.1", "9.2", "9.3", "10.1"] },
    { "id": 7, "tasks": ["11"] }
  ]
}
```
