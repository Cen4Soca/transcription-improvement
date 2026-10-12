# 校閲画面: 修正済みセグメントの「修正前に戻す」と「もう一度修正候補」

修正済みセグメント（`displayCorrection` あり）に対して、修正前テキストへ戻す導線（要件A）と、修正済みでも修正候補を再取得できる導線（要件B）を追加する UI 変更。要件Aは「戻し操作も Correction として記録してから `appliedText` から該当エントリを delete する」方式で、`correctedSegmentIds` / `displayCorrections` / `segments`（`originalText=最新テキスト`）の既存派生ロジックに一切手を入れず、delete の副作用だけで未修正表示に戻す最小侵襲設計。要件Bは「`SuggestionButton` が `displayCorrection` の有無に関わらず非編集分岐の末尾で描画される」既存構造をそのまま使うためロジック追加はゼロで、テストで共存・押下可能性を担保している。配線は `App.tsx → ReviewPage → TranscriptionEditor → SegmentEditor` を optional prop で貫通。

Watch for: このワークスペースは git リポジトリではなく（`git diff` 不可、confirmed）、本レビューは現行ソース + plan.md の検証記録 + 変更前スナップショットの突き合わせで実施した。コーダーの検証記録（tsc 0 / vitest 987 pass / build 成功）は plan.md に記録済みで、確認のため型チェック `tsc --noEmit -p tsconfig.app.json` のみ 1 回スポット再実行し exit 0 を得た（confirmed）。要件A/B とも plan.md に忠実に実装され、不変条件は維持されており、ブロッカーは無い。

**Verdict**: APPROVED

## High-level view

要件A（修正前に戻す）は `SegmentEditor` の非編集・修正済み分岐に「修正前に戻す」ボタン（`aria-label="修正前に戻す"`, `type="button"`, `stopPropagation`）を追加して満たしている。`onRevert` 未指定時と未修正時はボタンを出さない。クリックは `App.tsx` の `handleRevertCorrection` まで配線され、`baseSegments` から元テキストを取得し、現在の修正後→元テキストの TEXT Correction を保存した上で `appliedText.delete(segmentId)` を実行する。delete により `correctedSegmentIds` と `displayCorrections` から該当 segmentId が自動的に外れ、`segments` の `originalText` が base の元テキストに戻るため、戻した後は「未修正」表示（amber ラベル）に遷移する。

要件B（もう一度修正候補）はロジック変更なし。`SuggestionButton` は非編集分岐で `displayCorrection` の外側に描画されるため修正済みでも表示され、`handleSuggestionClick` は `segment.originalText`（=最新=修正後テキスト）を候補取得対象として渡す。候補取得対象が最新テキストである点は「`originalText`=最新」不変条件とも整合する。

「`originalText`=最新テキスト」不変条件は壊れていない。revert は派生ロジック（`segments` useMemo / `displayCorrections` / `correctedSegmentIds`）に触れず `appliedText` から delete するだけで、delete 後は base の元テキストが最新として自動的に復元される。監査・サーバ整合のため、戻し操作も既存の `createCorrection` で Correction として記録している（既存 undo と同じ方針）。冪等性も担保されており、未修正または既に元テキストと同一の場合は保存を行わず `true` を返す。

steering 整合は保たれている。新規 import はすべて拡張子なし（frontend 既存慣習・`bundler` 解決）、名前付き export のみ、UI 文言は日本語・コード/コメントは英日混在だが既存慣習どおり、`SegmentEditor` / `ReviewPage` の新規分岐に `vitest-axe` の `toHaveNoViolations` が追加され、テストは co-locate されている。新規 prop はすべて optional のため既存の呼び出し元・既存テストは非影響。

<details>
<summary>Issues (2)</summary>

1. **検証ソースが git diff ではない** — ワークスペースが git 管理下に無く真の diff は取得できないため、現行ソース + plan.md 検証記録 + スナップショットで検証した。型チェックのみ 1 回再実行して exit 0 を確認。非ブロッカー。
2. **revert 失敗時のエラー文言が保存失敗と共用** — `ReviewPage.handleRevert` は失敗時に既存の「修正内容の保存に失敗しました。もう一度お試しください。」を再利用する。plan.md が明示した許容方針どおりで、文言の重複追加を避ける妥当な判断。非ブロッカー。

</details>

<details>
<summary>Details</summary>

## 「修正前に戻す」の UI とイベント競合回避（要件A）

`SegmentEditor` の非編集・修正済み分岐（`displayCorrection` あり）で、修正前/修正後の 2 行を包む `<div className="flex-1 space-y-1">` の末尾にアクション行を追加し、`onRevert` が渡されている場合のみ「修正前に戻す」ボタンを描画する。ボタンは `type="button"`・`aria-label="修正前に戻す"` を持ち、`handleRevertClick` が `e.stopPropagation()` の後に `onRevert?.(segment.segmentId)` を呼ぶ。行自体のクリックは編集開始（`handleClick`）に割り当てられているため、stopPropagation が無ければ戻すクリックが同時に編集モードを起動してしまう。この競合は stopPropagation で正しく断たれている。未修正分岐には戻すボタンを描画しないため、未修正セグメントに戻し導線が漏れることはない。

## revert の状態遷移と不変条件（要件A, App.tsx）

```
SegmentEditor(修正済み) 「修正前に戻す」click
  → stopPropagation → onRevert(segmentId)
  → TranscriptionEditor.onRevert → ReviewPage.handleRevert
  → App.handleRevertCorrection(segmentId):
       base = baseSegments.find(id)            // 元テキスト
       current = appliedText.get(id)           // 現在の修正後
       if (current===undefined || current===base.originalText) return true   // 冪等
       createCorrection(before=current, after=base.originalText)  // 監査記録
       setAppliedText(prev => prev - id)       // delete
  → correctedSegmentIds / displayCorrections から id が外れる
  → segments useMemo: originalText が base の元テキストに戻る
  → SegmentEditor が未修正分岐へ（「未修正」amber ラベル表示）
```

戻し後に「未修正」表示へ戻るという要件は、専用の表示フラグを増やさず `appliedText` からの delete の副作用だけで実現されている。`correctedSegmentIds = new Set(appliedText.keys())` と `displayCorrections`（`appliedText.get(id) !== base.originalText` の時のみエントリ生成）がともに `appliedText` から導出されるため、delete 一回で両者から外れ、`SegmentEditor` 側の `isUncorrected = !displayCorrection` が true に転じる。`segments` useMemo も `appliedText.has(id)` が false になることで base の `originalText` をそのまま採用し、「`originalText`=最新テキスト」不変条件が delete 後も崩れない。

戻し操作を `createCorrection(before=現在の修正後, after=元テキスト)` として記録してから delete する順序も妥当で、保存に失敗した場合（`!result.ok`）は delete せず `false` を返すため、サーバに記録できないまま UI だけ未修正に戻る不整合は起きない。冪等分岐（`current===undefined || current===base.originalText`）が保存前に `true` を返すので、未修正セグメントや二重クリックで空の Correction が量産されることもない。

## 修正済みセグメントでの候補再取得（要件B）

要件Bはコード追加ゼロで満たされている。`SuggestionButton` は `SegmentEditor` 非編集分岐の `displayCorrection` 条件の外側に置かれており、修正済み・未修正どちらでも `onSuggestionRequest` が渡っていれば描画される。候補取得対象は `handleSuggestionClick` が渡す `segment.originalText` で、修正済みセグメントではこれが修正後テキスト（最新）になる。つまり「もう一度修正候補」は常に最新テキストに対して走り、修正前テキストに対して誤って候補を出すことはない。テストが修正済みセグメントで「修正前に戻す」と「修正候補を表示」の両ボタンの同時存在と、`onSuggestionRequest('seg-1', '修正後テキスト')` の呼び出し引数を検証しており、取得対象が最新テキストであることを引数レベルで担保している。

## テスト追加

`SegmentEditor.test.tsx`: (a) 修正済み + `onRevert` 指定でボタン表示＆クリックで `onRevert('seg-1')` 呼び出し、(b) `onRevert` 未指定で非表示、(c) 未修正 + `onRevert` 指定でも非表示、(d) 修正済みで戻す/候補の両ボタン共存＆両方の呼び出し引数検証（要件A/B共存）、(e) 修正済み + 両ハンドラ構成の axe。`ReviewPage.test.tsx`: 要件A のクリック→`onRevertCorrection('seg-1')` 到達、要件B の候補ボタン表示＆押下、`onRevertCorrection` 未指定時の非表示、描画 container の axe。`createCorrectedSegment` ファクトリは `originalText='修正後テキスト'` として「`originalText`=最新」前提をテストデータにも反映している。

Not tested: `App.tsx` の `handleRevertCorrection` 自体（createCorrection 保存→delete→未修正遷移の E2E）に対する専用単体テストは無く、型チェックとビルド、および ReviewPage 側のコールバック到達テストで担保している。App.tsx はルーティング統合層で単体テストが薄い既存方針どおりで、ロジックは単純なためブロッカーではない。

</details>

<details>
<summary>変更ファイル</summary>

- `src/App.tsx` — module 直下に `generateCorrectionId` ヘルパーを追加。`handleRevertCorrection`（baseSegments から元テキスト取得 → TEXT Correction 記録 → `appliedText.delete`、冪等判定・保存失敗ガード付き）を実装し `ReviewPage` の `onRevertCorrection` に配線。
- `src/pages/ReviewPage.tsx` — `ReviewPageProps` に optional `onRevertCorrection` を追加。`handleRevert`（失敗時に既存 saveError 文言を再利用、undo スタックには積まない）を実装し `onRevert={onRevertCorrection ? handleRevert : undefined}` で `TranscriptionEditor` に配線。
- `src/components/TranscriptionEditor.tsx` — optional `onRevert` prop を追加し各 `SegmentEditor` に素通し。
- `src/components/SegmentEditor.tsx` — optional `onRevert` prop を追加。修正済み分岐に「修正前に戻す」ボタン（`aria-label`, `type="button"`, `stopPropagation`）を描画。未修正・`onRevert` 未指定時は非表示。`SuggestionButton` は従来どおり修正済み・未修正の両方で描画（要件B）。
- `src/components/SegmentEditor.test.tsx` — 要件A の表示/呼び出し/未指定非表示/未修正非表示、要件A/B共存、axe を追加。
- `src/pages/ReviewPage.test.tsx` — 要件A のクリック到達、要件B のボタン表示/押下、未指定非表示、axe を追加。

真の diff は git 不在のため取得不可。検証は現行ソース + `.agents/tasks/plan.md` 検証記録 + `~/.kiro/sessions/.../snapshots/`（変更前版）+ 型チェック 1 回のスポット再実行で実施。
</details>
