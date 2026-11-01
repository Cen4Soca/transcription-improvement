# Implementation Plan

- [x] 1. バグ条件の探索的再現テストを書く（修正実装の前）
  - **Property 1: Bug Condition** - IME 変換中の Enter で確定処理が発火してしまう
  - **CRITICAL**: このテストは未修正コードで FAIL しなければならない。失敗がバグの存在を証明する
  - **DO NOT**: ここでテストやコードを修正しようとしないこと
  - **NOTE**: このテストは期待挙動（確定を発火しない）をエンコードする。修正後にパスすることで修正を検証する
  - **GOAL**: バグを示す反例（IME 変換中 Enter で確定が発火する）を観測する
  - **Scoped PBT Approach**: 決定的バグのため、`fc` で生成した任意のラベル文字列に対し「`compositionStart` 後・`isComposing: true` の Enter」という具体的な失敗ケースにプロパティをスコープする（`frontend/src/components/SpeakerLabelManager.test.tsx` に co-location）
  - IME 変換は `fireEvent.compositionStart` と `isComposing: true` / `keyCode: 229` を指定した `fireEvent.keyDown` で再現する（`userEvent.keyboard` は `isComposing` を直接制御できないため `fireEvent` を使用）
  - テストケース: (1) リネーム入力で composition 開始 → `isComposing: true` の Enter → `onRenameConfirm`（`handleConfirmRename`）が呼ばれないことを期待、(2) ラベル追加入力で composition 開始 → `isComposing: true` の Enter → `onAddLabel`（`handleAddLabel`）が呼ばれないことを期待、(3) `keyCode === 229` の Enter → 確定が発火しないことを期待
  - テストの assert は design の Expected Behavior / Correctness Properties の Property 1 に一致させる
  - 未修正コードで実行する
  - **EXPECTED OUTCOME**: テストが FAIL する（正しい状態。バグの存在を証明する＝確定コールバックが呼ばれてしまう）
  - 反例を記録する（例: 「リネーム入力で変換 Enter を押すと `onRenameConfirm` が『やまだ』で呼ばれてしまう」）して根本原因（`isComposing` 未確認）を理解する
  - テストを書き・実行し・失敗を記録した時点でタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3_

- [x] 2. 保持（Preservation）プロパティテストを書く（修正実装の前）
  - **Property 2: Preservation** - 非 IME 入力・その他キーの挙動維持
  - **IMPORTANT**: 観測優先（observation-first）メソドロジーに従う
  - 未修正コードで非バグ入力の挙動を観測して記録する:
    - 観測: composition を経ない（`isComposing: false`）Enter で `onRenameConfirm` / `onAddLabel` が呼ばれる
    - 観測: リネーム入力の Escape で `onCancel`（`handleCancelRename`）が呼ばれる
    - 観測: 「確定」/「追加」ボタンのクリックで確定が発火する（キーダウン非経由）
    - 観測: 既存ラベルと重複する名前で（非 IME）確定するとマージ確認ダイアログ（Req 2.17 相当）が表示される
  - 観測した挙動を保証するプロパティベーステストを書く: `fast-check` でラベル文字列とキー種別（非 IME の Enter / Escape / その他キー、いずれも `isComposing: false`）を生成し、確定・キャンセルコールバックの発火有無が観測どおりであることを検証する（`{ numRuns: 100 }`）
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストが PASS する（保持すべきベースライン挙動を確認）
  - 全テストで vitest-axe の違反ゼロ（`expect(container).toHaveNoViolations()`）を維持する
  - テストを書き・実行し・未修正コードでパスすることを確認した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. SpeakerLabelManager の2入力に IME ガードを実装する

  - [x] 3.1 IME ガードを実装する
    - `frontend/src/components/SpeakerLabelManager.tsx` を対象に、確立済みパターン（`InlineEditor.tsx` / `SegmentEditor.tsx` / `hooks/useKeyboardShortcuts.ts`）に準拠して実装する
    - `useRef` を import し、コンポーネント内に `const isComposingRef = useRef(false);` を追加する（リネーム入力とラベル追加入力で共有）
    - `handleCompositionStart`（`isComposingRef.current = true`）と `handleCompositionEnd`（`isComposingRef.current = false`）を `useCallback` で追加する
    - リネーム入力とラベル追加入力の両 `<input>` に `onCompositionStart={handleCompositionStart}` と `onCompositionEnd={handleCompositionEnd}` を付与する
    - `handleKeyDown`（リネーム）の先頭で IME ガードを追加する: `event.nativeEvent.isComposing || event.isComposing || isComposingRef.current || event.keyCode === 229` が真なら early return（`e.preventDefault()` も `handleConfirmRename()` も呼ばない）。ガード通過後のみ従来どおり Enter で確定・Escape でキャンセルする
    - `handleAddKeyDown`（ラベル追加）の先頭で同様の IME ガードを追加する: 真なら early return。ガードを通過した Enter のみ `e.preventDefault()` + `void handleAddLabel()` を実行する
    - 判定ロジックは `event.isComposing` と `isComposingRef.current` の論理和を基本とし、IME 既知の `keyCode === 229` も併せて確認する。新規ヘルパ導入は最小化し既存コンポーネントの書き味に合わせる
    - _Bug_Condition: isBugCondition(E) = E.key = "Enter" AND isImeComposing(E)（E.isComposing = true OR composition 進行中(ref) OR E.keyCode = 229）_
    - _Expected_Behavior: 変換 Enter は変換の確定のみを行い `handleConfirmRename()` / `handleAddLabel()` を発火しない。変換確定後（isComposing === false）の Enter で初めて確定する_
    - _Preservation: 非 IME の Enter 確定、Escape キャンセル、ボタンクリック確定、マージ確認ダイアログ、UI 表示は不変_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 バグ条件の探索的再現テストがパスすることを確認する
    - **Property 1: Expected Behavior** - IME 変換中の Enter で確定処理を発火しない
    - **IMPORTANT**: タスク1と同じテストを再実行する。新しいテストを書かないこと
    - タスク1のテストは期待挙動をエンコードしている。このテストがパスすることで期待挙動が満たされたことを確認する
    - タスク1のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認）
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 保持テストが引き続きパスすることを確認する
    - **Property 2: Preservation** - 非 IME 入力・その他キーの挙動維持
    - **IMPORTANT**: タスク2と同じテストを再実行する。新しいテストを書かないこと
    - タスク2の保持プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションがないことを確認）
    - 修正後も全テストがパスすること（非 IME Enter 確定・Escape キャンセル・ボタンクリック・マージ確認ダイアログ・UI 表示が不変）を確認する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Unit / Integration テストを追加する
  - **Unit Tests** (`SpeakerLabelManager.test.tsx` に co-location):
    - リネーム入力: composition 中 Enter で `onRenameConfirm` が呼ばれないこと、composition 終了後（`compositionEnd` 後）の Enter で呼ばれること
    - ラベル追加入力: composition 中 Enter で `onAddLabel` が呼ばれないこと、composition 終了後の Enter で呼ばれること
    - `keyCode === 229` の Enter で確定が発火しないこと（エッジケース）
    - Escape でキャンセル（`handleCancelRename`）が従来どおり発火すること
  - **Integration Tests**:
    - 日本語入力フロー: リネーム入力で `compositionStart` → 文字入力 → 変換 Enter（確定発火しない）→ `compositionEnd` → 確定 Enter（リネーム確定）までの一連を検証する
    - コンテキスト切替: リネーム入力とラベル追加入力を切り替え、それぞれで IME ガードと確定が独立して正しく動作することを検証する
  - **Accessibility**: パネル描画時に vitest-axe で違反ゼロ（`expect(container).toHaveNoViolations()`）を維持することを検証する
  - `cd frontend && npx vitest --run` で実行する
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. チェックポイント - 全テストがパスすることを確認する
  - `cd frontend && npx vitest --run` で全テストがパスすることを確認する
  - 探索テスト（Property 1）がパス、保持テスト（Property 2）がパス、新規 Unit / Integration テストがパス、vitest-axe 違反ゼロを確認する
  - 疑問が生じた場合はユーザーに確認する
