# Implementation Plan — 校閲画面: 修正済みセグメントの「修正前に戻す」/「もう一度修正候補」

作業ディレクトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend`
テスト/ビルドコマンド: `npx vitest --run`（単体/プロパティ）、`npm run build`（`tsc -b && vite build`）。

## 調査結果（確定事実）

データフロー（確認済み）:
- `App.tsx` の `ReviewPageWrapper` が state `appliedText: Map<segmentId, 修正後テキスト>` を保持。`correctedSegmentIds = new Set(appliedText.keys())`、`displayCorrections` は `baseSegments[i].originalText !== appliedText.get(id)` の場合のみ `{ originalText: base, correctedText: applied }` を生成。両者とも `appliedText` から導出されるため、`appliedText` から該当 segmentId を delete すれば correctedSegmentIds・displayCorrections から自動的に外れ、未修正表示に戻る。
- `segments` useMemo が修正済みの `originalText` を最新テキストで上書き（「originalText=最新テキスト」不変条件）。この不変条件は検索・ダウンロード・編集・候補取得が依存。revert では appliedText から delete するため、該当 segment の originalText は baseSegments の元テキストに自動的に戻り、不変条件は維持される。
- `handleSaveCorrection(input)` が `apis.correction.createCorrection` を呼び、成功時に TEXT なら `appliedText.set` する。

**要件B（もう一度修正候補）は既に動作している**:
- `SegmentEditor` の非編集分岐で、`displayCorrection` の有無に関わらず末尾に `onSuggestionRequest && <SuggestionButton>` を描画している（修正済みでもボタンは出る）。
- `handleSuggestionClick` は `segment.originalText`（= 最新=修正後テキスト）を渡す。`ReviewPage.fetchSuggestions` も `segment.originalText` を使う。よって候補取得対象は正しく最新テキスト。候補選択時は `handleSuggestionSelect` が TEXT Correction を保存し `appliedText` を更新する。
- 結論: 要件Bは**ロジック変更不要**。要件Aのボタン追加でレイアウトが崩れないよう整え、修正済みセグメントで両ボタンが押せることを保証するテストを追加するのみ。

## 不変条件の維持方法

revert は `appliedText.delete(segmentId)` のみ行い、`segments` useMemo / `displayCorrections` / `correctedSegmentIds` の派生ロジックには一切手を加えない。これにより「originalText=最新テキスト」は（delete 後は baseSegments の元テキストが最新になる形で）自動的に保たれる。監査/サーバ整合のため、delete 前に「元テキストへ戻す」TEXT Correction（before=現在の修正後, after=元テキスト）を既存 `apis.correction.createCorrection` で保存する（既存 undo と同じ「戻す操作も Correction として記録」方式）。

---

- [ ] 1. SegmentEditor に `onRevert?: (segmentId: string) => void` prop を追加し、修正済み（`displayCorrection` あり）分岐に「修正前に戻す」ボタンを描画する。
      ボタンは日本語ラベル「修正前に戻す」、`aria-label="修正前に戻す"`、`type="button"`、クリックで `e.stopPropagation()` 後に `onRevert?.(segment.segmentId)` を呼ぶ（行クリックの編集開始と競合させない）。`onRevert` 未指定時はボタンを出さない。既存の修正前/修正後 2行と末尾 `SuggestionButton` を崩さないよう、修正済みブロックのレイアウトを調整する: 修正済みのテキスト2行を包む `<div className="flex-1 space-y-1">` の下にアクション行（`修正前に戻す` ボタン）を置くか、`SuggestionButton` と並ぶ操作列にまとめる。`isUncorrected` 分岐（未修正）にはボタンを出さない。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/components/SegmentEditor.tsx`
      Verify: `npx vitest --run src/components/SegmentEditor.test.tsx` — 既存テスト全通過（この時点で新テストは未追加でも可。既存の aria/role/未修正/修正済み表示テストが壊れないこと）。

- [ ] 2. SegmentEditor の新規挙動の単体テストを追加する。
      テストケース: (a) `displayCorrection` あり + `onRevert` 指定時に `aria-label="修正前に戻す"` ボタンが表示され、クリックで `onRevert('seg-1')` が呼ばれる。(b) `displayCorrection` あり + `onRevert` 未指定時はボタンが非表示。(c) `displayCorrection` 無し（未修正）では `onRevert` 指定でもボタンを出さない。(d) `displayCorrection` あり + `onSuggestionRequest` 指定時に「修正前に戻す」と「修正候補を表示」の両ボタンが同時に存在し、両方クリック可能（要件A/B共存）。(e) WCAG: 修正済み + onRevert + onSuggestionRequest の構成を `<div role="list">` でラップして `axe(container)` で `toHaveNoViolations()`。既存の `createSegment` ファクトリと `vitest-axe` の `axe` を流用。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/components/SegmentEditor.test.tsx`
      Verify: `npx vitest --run src/components/SegmentEditor.test.tsx` — 追加テスト含め全通過。

- [ ] 3. TranscriptionEditor に `onRevert?: (segmentId: string) => void` prop を追加し、各 `SegmentEditor` に `onRevert={onRevert}` を配線する。
      `TranscriptionEditorProps` に prop を追加、関数引数で分割代入し、map 内の `<SegmentEditor>` に渡すだけ。他の prop 配線パターン（`onSuggestionRequest` 等）に合わせる。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/components/TranscriptionEditor.tsx`
      Verify: `npx vitest --run src/components/TranscriptionEditor.test.tsx` — 既存テスト全通過。

- [ ] 4. ReviewPage に revert の配線を追加する。
      `ReviewPageProps` に `onRevertCorrection?: (segmentId: string) => Promise<boolean>` を追加（App 側の非同期 revert コールバック）。`ReviewPage` 本体で `handleRevert = useCallback(async (segmentId) => { ... })` を実装し、`onRevertCorrection` を呼ぶ。失敗時は既存 `saveCorrection` と同じ要領で `setSaveError('修正内容の保存に失敗しました。もう一度お試しください。')` を設定する（新規メッセージを増やさず既存文言を再利用、または revert 用に軽い日本語文言を1つ追加しても良いが過剰にしない）。`handleRevert` を `TranscriptionEditor` の新 prop `onRevert` に渡す。revert が有効なのは `onRevertCorrection` が渡されている場合のみ（`onRevert={onRevertCorrection ? handleRevert : undefined}`）。revert は undo スタックに積まない（既存 handleUndo との二重戻し防止、方針どおり）。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/pages/ReviewPage.tsx`
      Verify: `npx vitest --run src/pages/ReviewPage.test.tsx` — 既存テスト全通過（prop は optional なので既存呼び出しは壊れない）。

- [ ] 5. App.tsx の `ReviewPageWrapper` に `handleRevertCorrection` を実装し、`ReviewPage` の `onRevertCorrection` prop として渡す。
      実装: `handleRevertCorrection = useCallback(async (segmentId: string): Promise<boolean> => { ... }, [apis, sessionId, baseSegments, appliedText])`。
      手順: (1) `baseSegments.find(s => s.segmentId === segmentId)` から元テキスト `originalText` を取得。無ければ `false` を返す。(2) `appliedText.get(segmentId)` を現在の修正後テキスト（beforeText）とする。未修正（undefined）または既に元テキストと同じなら何もせず `true` を返す（冪等）。(3) `apis.correction.createCorrection(sessionId, { correctionId: generateId, segmentId, correctionType: 'TEXT', beforeText: 現在の修正後, afterText: 元テキスト })` を保存。失敗なら `false`。correctionId 生成は App 側に無ければ ReviewPage の `generateCorrectionId` と同等のフォールバック付き crypto.randomUUID ヘルパーを App.tsx 内に用意する（既存に無ければ追加、kebab なしの関数名 camelCase）。(4) 成功したら `setAppliedText(prev => { const next = new Map(prev); next.delete(segmentId); return next; })`。これで `correctedSegmentIds`・`displayCorrections` から外れ、`segments` の originalText が base の元テキストに戻り未修正表示になる。`true` を返す。
      `ReviewPage` 呼び出しに `onRevertCorrection={handleRevertCorrection}` を追加。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/App.tsx`
      Verify: `npm run build` — 型エラーなしでビルド成功（App.tsx はルーティング統合層で単体テストが薄いため、型チェックとビルドで配線を検証）。

- [ ] 6. ReviewPage の revert 統合テストを追加する（要件A/B両方のE2E的検証）。
      既存 `ReviewPage.test.tsx` の `renderReviewPage` ヘルパー（`MemoryRouter` ラップ、`useAuth` モック済み）を流用。
      テストケース: (a) 要件A: `segments`（最新テキスト反映済み1件）、`displayCorrections` に該当 segmentId のエントリ、`onRevertCorrection: vi.fn().mockResolvedValue(true)`、`onSaveCorrection`/`onFetchSuggestions` も渡して描画 → `aria-label="修正前に戻す"` ボタンをクリック → `onRevertCorrection` が該当 segmentId で呼ばれる。(b) 要件B: 同じ修正済みセグメントで `aria-label="修正候補を表示"` ボタンが表示され、クリックで `onFetchSuggestions`（または suggestionPopup 経由）が発火する／少なくともボタンが押下可能であることを確認。(c) `onRevertCorrection` 未指定時は「修正前に戻す」ボタンが出ない。(d) WCAG: 描画した container を `axe` で `toHaveNoViolations()`。
      Files: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend/src/pages/ReviewPage.test.tsx`
      Verify: `npx vitest --run src/pages/ReviewPage.test.tsx` — 追加テスト含め全通過。

- [x] 7. 全体回帰確認。
      Files: （なし）
      Verify: `npx vitest --run` 全テスト通過、かつ `npm run build` 成功。要件A（修正前に戻すとボタンが消え未修正表示に戻る導線）と要件B（修正済みでも候補ボタンが機能）が揃い、「originalText=最新テキスト」不変条件が維持されていることを最終確認。

## 検証記録（要件A/B 実装後）

実行ディレクトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend`

- `npx tsc --noEmit -p tsconfig.app.json` → exit 0（型エラーなし）
- `npx vitest --run` → 83 ファイル / 987 テスト 全グリーン
- `npm run build`（`tsc -b && vite build`）→ 成功（668 modules transformed）

実装概要:
- SegmentEditor: optional `onRevert` prop を追加。修正済み（`displayCorrection` あり）分岐に「修正前に戻す」ボタン（`aria-label="修正前に戻す"`, `type="button"`, `stopPropagation`）を追加。`onRevert` 未指定時・未修正時は非表示。
- TranscriptionEditor: optional `onRevert` prop を追加し各 SegmentEditor に配線。
- ReviewPage: optional `onRevertCorrection` prop を追加。`handleRevert` を実装し `onRevert={onRevertCorrection ? handleRevert : undefined}` で配線。revert は undo スタックに積まない。
- App.tsx: `handleRevertCorrection` を実装。baseSegments から元テキストを取得、現在の修正後→元テキストの TEXT Correction を保存後、`appliedText.delete(segmentId)` で未修正表示に戻す（correctedSegmentIds / displayCorrections から自動的に外れる）。module 直下に `generateCorrectionId` ヘルパーを追加。
- 要件B（もう一度修正候補）はロジック変更不要（修正済みでも SuggestionButton は描画され、`segment.originalText`=最新テキストに対して候補取得）。テストで共存・押下可能性を担保。
- テスト追加: SegmentEditor（表示/呼び出し/未指定非表示/未修正非表示/要件A・B共存/axe）、ReviewPage（要件A 呼び出し/要件B ボタン表示/未指定非表示/axe）。
