# Speaker Label IME Confirm Fix Bugfix Design

## Overview

話者ラベル管理パネル `frontend/src/components/SpeakerLabelManager.tsx` には、Enter キーで確定処理を発火するテキスト入力が2つある。話者名リネーム入力（`handleKeyDown` → `handleConfirmRename`）と、話者ラベル新規追加入力（`handleAddKeyDown` → `handleAddLabel`）である。

どちらのハンドラも IME（日本語入力）の変換確定を意味する Enter かどうかを判定していない。`isComposing` を確認せず、`compositionstart` / `compositionend` も購読していないため、漢字変換を確定するための Enter 押下が、IME 変換の確定だけでなくリネーム確定・ラベル追加まで発火させてしまう。ユーザーは意図した日本語名を入力し終える前に、変換途中の誤った文字列で確定・送信されてしまう。

修正方針は、同リポジトリで確立済みの IME ガードパターンに準拠することである。`SegmentEditor.tsx` と `InlineEditor.tsx` は `isComposingRef`（`onCompositionStart` / `onCompositionEnd` で更新）をキーダウンの先頭で確認してガードし、`hooks/useKeyboardShortcuts.ts` は `event.isComposing` と ref の両方を確認する。本修正では両方のシグナル（`event.isComposing === true` および ref による composition 状態）で Enter を無視し、確定処理を発火しないようにする。非 IME の Enter 確定・Escape キャンセル・ボタンクリックは従来どおり維持する。

## Glossary

- **Bug_Condition (C)**: バグが発火する条件。SpeakerLabelManager の対象 input 上で、IME 変換が進行中（`isComposing === true`、または IME 既知の `keyCode === 229`）のまま Enter が押され、確定処理（リネーム確定 / ラベル追加）が発火してしまう状態。
- **Property (P)**: 望ましい挙動。変換確定のための Enter は変換の確定のみを行い、`handleConfirmRename` / `handleAddLabel` を発火しない。変換確定後の非 IME Enter で初めて確定する。
- **Preservation**: 本修正で変更してはならない既存挙動。非 IME の Enter 確定、Escape キャンセル、確定/追加ボタンクリック、マージ確認ダイアログ（Req 2.17 相当）、ラベル表示や件数表示など。
- **handleKeyDown**: `SpeakerLabelManager.tsx` 内のリネーム入力の `onKeyDown` ハンドラ。Enter で `handleConfirmRename()`、Escape で `handleCancelRename()` を呼ぶ。
- **handleAddKeyDown**: `SpeakerLabelManager.tsx` 内のラベル追加入力の `onKeyDown` ハンドラ。Enter で `handleAddLabel()` を呼ぶ。
- **isComposingRef**: `onCompositionStart` / `onCompositionEnd` で更新される、IME 変換進行中かどうかを保持する ref。ブラウザによっては確定の keydown 時点で `event.isComposing` が false に戻るため、ref を併用してガードの取りこぼしを防ぐ（既存 `InlineEditor` / `SegmentEditor` と同一方式）。

## Bug Details

### Bug Condition

バグは、対象 input（リネーム入力またはラベル追加入力）上で IME 変換が未確定（composition 進行中）のまま Enter が押下されたときに発生する。現在の `handleKeyDown` / `handleAddKeyDown` は IME 状態を一切確認しないため、変換確定用の Enter が確定処理（`handleConfirmRename` / `handleAddLabel`）まで発火させる。

**Formal Specification:**
```
FUNCTION isBugCondition(E)
  INPUT: E of type KeyboardEvent on a SpeakerLabelManager text input
         (rename input or add-label input)
  OUTPUT: boolean

  // IME 変換が進行中の Enter（＝変換確定のための Enter）で
  // 確定処理が発火してしまう条件
  RETURN E.key = "Enter"
         AND isImeComposing(E)   // E.isComposing = true OR composition 進行中(ref) OR E.keyCode = 229
END FUNCTION
```

### Examples

- 話者名リネーム入力に「やまだ」と入力し、漢字「山田」へ変換するための Enter を押すと、変換が確定されると同時にリネームが「やまだ」で確定・送信される（期待: 変換のみ確定し、リネームは発火しない）。
- ラベル追加入力に「はなこ」と入力して変換 Enter を押すと、ラベル「はなこ」が追加確定されてしまう（期待: 変換のみ確定）。
- 「山田」への変換を確定した後、改めて Enter を押下するとリネームが「山田」で確定される（期待どおり／バグ条件に該当しない）。
- 英数字 "Alice" を入力して Enter（IME 非経由）を押すとリネームが確定される（期待どおり／バグ条件に該当しない）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 非 IME（英数字入力など、`isComposing === false`）での Enter 押下による `handleConfirmRename()` の発火（リネーム確定）はこれまでどおり動作する。
- 非 IME での Enter 押下による `handleAddLabel()` の発火（ラベル追加確定）はこれまでどおり動作する。
- リネーム入力での Escape 押下による `handleCancelRename()` の発火（キャンセル）はこれまでどおり動作する。
- 「確定」ボタン・「追加」ボタンのクリックによる確定操作はこれまでどおり動作する（キーダウンを経由しないため影響を受けない）。
- 新ラベルが既存ラベルと重複する場合のマージ確認ダイアログ（Req 2.17 相当）はこれまでどおり表示される。
- ラベル一覧表示、件数表示、削除ボタンの活性/非活性、各種 aria-label など UI 表示は一切変化しない。

**Scope:**
バグ条件（IME 変換中の Enter）に該当しない入力はすべて本修正の影響を受けない。これには以下が含まれる:
- 非 IME の Enter（確定）
- Escape（キャンセル）
- 確定/追加ボタンのマウスクリック
- Enter / Escape 以外のキー入力（文字キー、矢印キー等）

**Note:** 変換確定後に期待される正しい確定挙動は「Correctness Properties」セクションの Property 1 に定義する。本セクションは「変化してはならない挙動」に焦点を当てる。

## Hypothesized Root Cause

バグ記述とコード調査に基づき、根本原因は以下に特定できる。

1. **IME 状態の未確認（主因）**: `handleKeyDown` / `handleAddKeyDown` は `e.key === 'Enter'` だけを見て即座に確定処理を呼んでいる。`e.isComposing` を確認しておらず、変換確定のための Enter と確定操作のための Enter を区別できていない。
   - リネーム入力: `onKeyDown={handleKeyDown}` のみで `onCompositionStart` / `onCompositionEnd` 未購読。
   - ラベル追加入力: `onKeyDown={handleAddKeyDown}` のみで同上。

2. **composition ライフサイクルの未購読**: 対象 input は `onCompositionStart` / `onCompositionEnd` を購読していないため、ref による補助ガードが存在しない。一部ブラウザは変換確定の keydown 時点で `event.isComposing` を既に false にするため、`event.isComposing` 単独では取りこぼす可能性がある。既存の `InlineEditor` / `SegmentEditor` は ref を併用してこれを回避している。

3. **確立済みパターン未適用**: 同リポジトリの `SegmentEditor.tsx`・`InlineEditor.tsx`・`useKeyboardShortcuts.ts` に IME ガードの確立済みパターンがあるが、SpeakerLabelManager の2入力だけが未準拠である。

## Correctness Properties

Property 1: Bug Condition - IME 変換中の Enter で確定処理を発火しない

_For any_ 対象 input（リネーム入力 / ラベル追加入力）上の KeyboardEvent で、バグ条件が成立する場合（isBugCondition が true＝Enter かつ IME 変換進行中）、修正後のハンドラ SHALL 変換の確定のみを許し、`handleConfirmRename()` / `handleAddLabel()` を発火しない（リネーム確定・ラベル追加を行わない）。変換確定後（`isComposing === false`）の改めての Enter では、入力し終えた話者名で確定する。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - 非 IME 入力・その他キーの挙動維持

_For any_ バグ条件が成立しない入力（isBugCondition が false。非 IME の Enter、Escape、Enter/Escape 以外のキー、ボタンクリックなど）について、修正後のハンドラ SHALL 修正前と同一の結果を生成し、既存の確定・キャンセル・マージ確認ダイアログ・UI 表示を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

根本原因分析が正しいという前提で、確立済みパターン（`isComposing` ガード + composition ライフサイクル購読）を SpeakerLabelManager の2入力に適用する。

**File**: `frontend/src/components/SpeakerLabelManager.tsx`

**Functions**: `handleKeyDown`（リネーム）、`handleAddKeyDown`（ラベル追加）、および composition 状態を保持する ref とハンドラの追加

**Specific Changes**:

1. **composition 状態 ref の追加**: `useRef` を import し、コンポーネント内に `const isComposingRef = useRef(false);` を追加する。リネーム入力とラベル追加入力で共有する（どちらも同時に開いていても、フォーカスは常に一方であり composition も一方のみ進行するため単一 ref で足りる）。

2. **composition ハンドラの追加**: 既存 `InlineEditor` / `SegmentEditor` と同一シグネチャの `handleCompositionStart`（`isComposingRef.current = true`）と `handleCompositionEnd`（`isComposingRef.current = false`）を `useCallback` で追加する。

3. **両 input への composition 購読付与**: リネーム入力とラベル追加入力の `<input>` に `onCompositionStart={handleCompositionStart}` と `onCompositionEnd={handleCompositionEnd}` を追加する。

4. **`handleKeyDown` の IME ガード**: 先頭で IME 変換中を判定してガードする。`event.nativeEvent.isComposing || event.isComposing || isComposingRef.current || event.keyCode === 229` が真なら early return し、`e.preventDefault()` も `handleConfirmRename()` も呼ばない。ガードを通過した場合のみ、従来どおり Enter で確定・Escape でキャンセルを行う。Escape は composition 中でない前提で従来挙動を維持する。

5. **`handleAddKeyDown` の IME ガード**: 同様に先頭で IME 変換中を判定してガードし、真なら early return。ガードを通過した Enter のみ `e.preventDefault()` + `void handleAddLabel()` を実行する。

6. **判定ロジックの一貫性**: 判定は既存パターンに合わせ、`event.isComposing`（React SyntheticEvent 経由）と `isComposingRef.current`（ref）の論理和を基本とし、IME 既知の `keyCode === 229` も併せて確認する。新規ヘルパの導入は最小化し、既存コンポーネントの書き味に合わせる。

## Testing Strategy

### Validation Approach

テスト戦略は二段階アプローチを取る。まず未修正コード上でバグを再現する反例（IME 変換中 Enter で確定が発火する）を観測し、次に修正が正しく機能すること、および既存挙動が保持されることを検証する。テストは Vitest + React Testing Library + vitest-axe の規約に従い、`SpeakerLabelManager.test.tsx` に co-location する。IME 変換は `fireEvent.compositionStart` / `fireEvent.compositionEnd` と、`isComposing` / `keyCode` を指定した `keyDown` イベントで再現する（`userEvent.keyboard` は `isComposing` を直接制御できないため、IME 検証箇所は `fireEvent` を用いる）。翻訳キー経由の表示（デフォルト ja）で期待値を書き、全テストで vitest-axe の違反ゼロを維持する。

### Exploratory Bug Condition Checking

**Goal**: 修正実装前に、未修正コード上でバグを再現する反例を観測し、根本原因（IME 状態の未確認）を確認または反証する。反証された場合は再仮説立てが必要。

**Test Plan**: リネーム入力・ラベル追加入力それぞれで、composition 進行中（`compositionStart` 後、`isComposing: true` の keyDown）に Enter を発火し、確定コールバックが呼ばれないことを assert するテストを書く。未修正コード上で実行すると「確定が発火する（呼ばれてしまう）」ため失敗することを観測する。

**Test Cases**:
1. **リネーム変換中 Enter**: リネーム編集中に composition 開始 → `isComposing: true` の Enter を発火 → `onRenameConfirm` が呼ばれないことを期待（未修正コードでは失敗＝呼ばれてしまう）。
2. **ラベル追加変換中 Enter**: ラベル追加入力で composition 開始 → `isComposing: true` の Enter を発火 → `onAddLabel` が呼ばれないことを期待（未修正コードでは失敗）。
3. **keyCode 229 の Enter**: `keyCode === 229` の Enter を発火 → 確定が発火しないことを期待（未修正コードでは失敗の可能性）。

**Expected Counterexamples**:
- IME 変換中の Enter で `onRenameConfirm` / `onAddLabel` が呼び出されてしまう。
- 想定原因: `handleKeyDown` / `handleAddKeyDown` が `isComposing` を確認していない。

### Fix Checking

**Goal**: バグ条件が成立するすべての入力について、修正後のハンドラが期待挙動（確定処理を発火しない）を満たすことを検証する。

**Pseudocode:**
```
FOR ALL E WHERE isBugCondition(E) DO
  result := handleKeyDown_fixed(E)   // rename / add 両方
  ASSERT confirmNotTriggered(result) // handleConfirmRename / handleAddLabel が呼ばれない
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しないすべての入力について、修正後のハンドラが修正前と同一の結果を生成することを検証する。

**Pseudocode:**
```
FOR ALL E WHERE NOT isBugCondition(E) DO
  ASSERT handleKeyDown_original(E) = handleKeyDown_fixed(E)
  // 例: isComposing=false の Enter（確定）, Escape（キャンセル）, ボタンクリック
END FOR
```

**Testing Approach**: 非 IME 入力の挙動保持にはプロパティベーステストが有効である。理由は以下のとおり。
- 入力ドメイン全体にわたり多数のテストケースを自動生成できる。
- 手動のユニットテストが見落とすエッジケースを捕捉できる。
- 非バグ入力すべてで挙動が不変であることを強く保証できる。

**Test Plan**: 未修正コード上でまず非 IME の Enter 確定・Escape キャンセル・ボタンクリックの挙動を観測し、その挙動をそのまま保証するテストを書く。プロパティテストでは、ラベル名・キー種別（非 Enter キーや非 IME Enter）を生成し、確定コールバックの発火有無が期待どおりであることを検証する。

**Test Cases**:
1. **非 IME Enter 確定の保持**: composition を経ない Enter でリネーム / ラベル追加が確定されることを、未修正コードで確認してから修正後も維持されることを検証する。
2. **Escape キャンセルの保持**: リネーム入力の Escape で `onCancel`（`handleCancelRename`）が呼ばれることを維持。
3. **ボタンクリック確定の保持**: 「確定」「追加」ボタンのクリックで確定が発火することを維持（キーダウン非経由）。
4. **マージ確認ダイアログの保持**: 既存ラベルと重複する名前で（非 IME）確定したときにマージ確認ダイアログが表示されることを維持。

### Unit Tests

- リネーム入力: composition 中 Enter で `onRenameConfirm` が呼ばれないこと、composition 終了後の Enter で呼ばれること。
- ラベル追加入力: composition 中 Enter で `onAddLabel` が呼ばれないこと、composition 終了後の Enter で呼ばれること。
- `keyCode === 229` の Enter で確定が発火しないこと（エッジケース）。
- Escape でキャンセルが従来どおり発火すること。

### Property-Based Tests

- fast-check で生成した任意のラベル文字列について、IME 変換中（`compositionStart` 後の `isComposing: true` Enter）では確定コールバックが一度も呼ばれないこと（Property 1）。
- 生成したキー種別（Enter / Escape / その他、`isComposing: false`）について、修正後の確定・キャンセル発火が修正前と一致すること（Property 2・非 IME 入力の保持）。

### Integration Tests

- 日本語入力フロー: リネーム入力で `compositionStart` → 文字入力 → 変換 Enter（確定発火しない）→ `compositionEnd` → 確定 Enter（リネーム確定）までの一連を検証する。
- コンテキスト切替: リネーム入力とラベル追加入力を切り替えて、それぞれで IME ガードと確定が独立して正しく動作することを検証する。
- アクセシビリティ: パネル描画時に vitest-axe で違反ゼロを維持することを検証する。
