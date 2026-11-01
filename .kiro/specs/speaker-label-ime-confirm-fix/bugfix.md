# Bugfix Requirements Document

## Introduction

話者ラベル管理（Speaker Label management）機能で、話者名を日本語で入力している最中に発生するバグを修正する。

対象コンポーネントは `frontend/src/components/SpeakerLabelManager.tsx`。このコンポーネントには Enter キーで確定処理を発火するテキスト入力が2つ存在する。

- **話者名のリネーム入力**（`editingLabel` 編集時の input / `handleKeyDown`）— Enter で `handleConfirmRename()` が発火し、名前変更が確定される。
- **話者ラベルの新規追加入力**（`addLabelName` の input / `handleAddKeyDown`）— Enter で `handleAddLabel()` が発火し、ラベル追加が確定される。

どちらのハンドラも、IME（日本語入力）の変換確定を意味する Enter かどうかを判定していない。`onCompositionStart` / `onCompositionEnd` を購読しておらず、`KeyboardEvent.isComposing`（または `keyCode === 229`）も確認していない。このため、漢字変換を確定するための Enter 押下が、IME 変換の確定だけでなく名前変更そのもの（リネーム確定・ラベル追加）まで発火させてしまう。

ユーザーは、意図した日本語名を入力し終える前に名前変更が確定され、変換途中の誤った文字列が確定値として送信されてしまう。

なお同リポジトリの `SegmentEditor.tsx`・`InlineEditor.tsx`・`hooks/useKeyboardShortcuts.ts` では、IME 変換中の Enter を無視する確立済みパターン（`isComposing` ガード + `compositionstart`/`compositionend`）が既に実装されている。本バグは、話者ラベル管理の入力がそのパターンに未準拠であることに起因する。

## Bug Analysis

### Current Behavior (Defect)

話者ラベル管理の入力で、IME 変換確定のための Enter が確定処理まで発火させている状態。

1.1 WHEN ユーザーが話者名リネーム入力で日本語を入力中で、IME 変換が未確定（composition 進行中, `isComposing === true`）のまま Enter を押下する THEN the system は IME 変換の確定だけでなく `handleConfirmRename()` を発火し、名前変更（リネーム）を確定してしまう

1.2 WHEN IME 変換途中の文字列が入力欄に残った状態で 1.1 の Enter 押下により確定が発火する THEN the system はユーザーが意図していない変換途中の文字列を新しい話者名として確定・送信してしまう

1.3 WHEN ユーザーが話者ラベル新規追加入力で日本語を入力中で、IME 変換が未確定のまま Enter を押下する THEN the system は IME 変換の確定だけでなく `handleAddLabel()` を発火し、ラベル追加を確定してしまう

### Expected Behavior (Correct)

IME 変換確定のための Enter は変換のみを確定し、名前変更・ラベル追加は確定しない。変換確定後の明示的な Enter で初めて確定する。

2.1 WHEN ユーザーが話者名リネーム入力で日本語を入力中で、IME 変換が未確定（`isComposing === true`）のまま Enter を押下する THEN the system SHALL IME 変換の確定のみを行い、`handleConfirmRename()` を発火せず名前変更を確定しない

2.2 WHEN ユーザーが IME 変換を確定した後（composition 終了後, `isComposing === false`）に、変換中でない状態で改めて Enter を押下する THEN the system SHALL `handleConfirmRename()` を発火し、入力し終えた話者名で名前変更を確定する

2.3 WHEN ユーザーが話者ラベル新規追加入力で日本語を入力中で、IME 変換が未確定のまま Enter を押下する THEN the system SHALL IME 変換の確定のみを行い、`handleAddLabel()` を発火せずラベル追加を確定しない

### Unchanged Behavior (Regression Prevention)

IME を介さない既存の確定・キャンセル操作、および変換確定後の操作は従来どおり動作しなければならない。

3.1 WHEN ユーザーが IME を介さずに（英数字入力など、`isComposing === false`）話者名リネーム入力で Enter を押下する THEN the system SHALL CONTINUE TO `handleConfirmRename()` を発火して名前変更を確定する

3.2 WHEN ユーザーが話者名リネーム入力で Escape を押下する THEN the system SHALL CONTINUE TO `handleCancelRename()` を発火してリネームをキャンセルする

3.3 WHEN ユーザーが IME を介さずに話者ラベル新規追加入力で Enter を押下する THEN the system SHALL CONTINUE TO `handleAddLabel()` を発火してラベル追加を確定する

3.4 WHEN ユーザーが「確定」ボタン・「追加」ボタンをクリックして確定操作を行う THEN the system SHALL CONTINUE TO 従来どおり名前変更・ラベル追加を確定する

3.5 WHEN リネーム確定時に新ラベルが既存ラベルと重複する THEN the system SHALL CONTINUE TO マージ確認ダイアログ（Req 2.17 相当）を表示する

## Bug Condition and Properties

### Bug Condition

```pascal
FUNCTION isBugCondition(E)
  INPUT: E of type KeyboardEvent on a SpeakerLabelManager text input
         (rename input or add-label input)
  OUTPUT: boolean

  // 変換確定のための Enter（IME 変換が進行中）で確定処理が発火してしまう条件
  RETURN E.key = "Enter" AND E.isComposing = true
END FUNCTION
```

### Fix Checking

```pascal
// Property: Fix Checking - IME 変換中の Enter では確定処理を発火しない
FOR ALL E WHERE isBugCondition(E) DO
  result ← handleKeyDown'(E)   // F' = 修正後のハンドラ（rename / add 両方）
  ASSERT confirmNotTriggered(result)
         // handleConfirmRename / handleAddLabel が呼ばれない
END FOR
```

### Preservation Checking

```pascal
// Property: Preservation Checking - IME 変換中でない Enter / その他キーは従来どおり
FOR ALL E WHERE NOT isBugCondition(E) DO
  ASSERT handleKeyDown(E) = handleKeyDown'(E)
         // F(非バグ入力) = F'(非バグ入力)
         // 例: isComposing=false の Enter（確定）, Escape（キャンセル）
END FOR
```

- **F**: 修正前のキーダウンハンドラ（`handleKeyDown` / `handleAddKeyDown`）。`isComposing` を確認せず Enter で即確定する。
- **F'**: 修正後のハンドラ。`isComposing === true`（および IME 既知のキーコード 229 等）の Enter を無視し、確定処理を発火しない。
- **Counterexample**: 話者名リネーム入力に「やまだ」と入力し、漢字「山田」へ変換するための Enter を押すと、変換が確定されると同時にリネームが「やまだ」で確定・送信される。
