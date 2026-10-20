# Bugfix Requirements Document

## Introduction

強制確定（force confirm / Admin による強制的な Consensus 集約・確定）を含め、セッションの Consensus が確定した後に校閲画面（ReviewPage）を開くと、確定された Consensus の結果（`consensusText`）ではなく、ログイン中の Reviewer 個人の校閲結果（そのユーザー自身の Correction）が表示されてしまう。

Consensus が確定したセグメントは、全 Reviewer の修正を集約して定まった「正答」を表示すべきであり、個々の Reviewer の修正はそれを上書きしてはならない。確定後は確定テキストを提示する（読み取り専用の）振る舞いが正しい。

本バグは校閲画面のセグメント復元ロジックに起因する。校閲画面は取得したセグメントの `consensusStatus` / `consensusText` を参照せず、常に個人の Correction（`afterText`）をセグメントの表示テキストへ上書き適用している。その結果、確定済みセグメントでも個人の修正結果が見えてしまう。

本ドキュメントでは要件（何が起きていて、何が起きるべきか、何を変えてはならないか）のみを定義する。原因箇所・修正方法・コンポーネント分析などの技術的詳細は design.md で扱う。

## Bug Analysis

用語の前提:
- **確定済みセグメント**: `consensusStatus` が `CONFIRMED` のセグメント。集約された正答として `consensusText` を持つ。強制確定（force confirm）経由で確定したものを含む。
- **個人 Correction**: ログイン中の Reviewer 自身が記録した Correction の、当該セグメントに対する最新の `afterText`。
- **未確定セグメント**: `consensusStatus` が `UNDECIDED` または `CONFLICT` のセグメント。確定テキスト（`consensusText`）を持たない。

### Current Behavior (Defect)

校閲画面を開いたとき、セグメントの `consensusStatus` に関わらず、個人 Correction の最新 `afterText` がセグメントの表示テキストへ上書き適用される。

1.1 WHEN セッションの Consensus が確定（強制確定を含む）され、あるセグメントが `CONFIRMED`（`consensusText` を持つ）であり、かつログイン中の Reviewer がそのセグメントに個人 Correction を持つ状態で校閲画面を開く THEN the system は確定テキスト（`consensusText`）ではなく個人 Correction の `afterText` をそのセグメントの表示テキストとして表示する

1.2 WHEN セッションの Consensus が確定（強制確定を含む）され、あるセグメントが `CONFIRMED` であり、かつログイン中の Reviewer がそのセグメントに個人 Correction を持たない状態で校閲画面を開く THEN the system は確定テキスト（`consensusText`）を表示せず、元の文字起こしテキスト（`originalText`）のまま表示する

1.3 WHEN セグメントが `CONFIRMED` の状態で校閲画面を開く THEN the system はそのセグメントを編集可能として扱い、確定済みの表示（読み取り専用）として提示しない

### Expected Behavior (Correct)

Consensus が確定したセグメントは、個人 Correction を上書き適用せず、確定された Consensus 結果を表示する。

2.1 WHEN セッションの Consensus が確定（強制確定を含む）され、あるセグメントが `CONFIRMED`（`consensusText` を持つ）であり、かつログイン中の Reviewer がそのセグメントに個人 Correction を持つ状態で校閲画面を開く THEN the system SHALL 個人 Correction の `afterText` ではなく、確定テキスト（`consensusText`）をそのセグメントの表示テキストとして表示する

2.2 WHEN セッションの Consensus が確定（強制確定を含む）され、あるセグメントが `CONFIRMED` であり、かつログイン中の Reviewer がそのセグメントに個人 Correction を持たない状態で校閲画面を開く THEN the system SHALL 確定テキスト（`consensusText`）をそのセグメントの表示テキストとして表示する

2.3 WHEN セグメントが `CONFIRMED` の状態で校閲画面を開く THEN the system SHALL そのセグメントを確定済みとして読み取り専用で表示し、個人 Correction による上書き・再編集の対象としない

### Unchanged Behavior (Regression Prevention)

確定していないセグメントや既存の校閲フローは、従来どおりに動作しなければならない。

3.1 WHEN セグメントが `UNDECIDED`（未確定・確定テキストを持たない）の状態で校閲画面を開く THEN the system SHALL CONTINUE TO ログイン中の Reviewer 個人の Correction（最新 `afterText`）をそのセグメントに復元表示し、個人 Correction が無ければ `originalText` を表示する

3.2 WHEN セグメントが `CONFLICT`（確定テキストを持たない）の状態で校閲画面を開く THEN the system SHALL CONTINUE TO ログイン中の Reviewer 個人の Correction（最新 `afterText`）をそのセグメントに復元表示し、個人 Correction が無ければ `originalText` を表示する

3.3 WHEN セッションに確定済みセグメントが 1 つも存在しない（全セグメントが `UNDECIDED` / `CONFLICT`）状態で校閲画面を開く THEN the system SHALL CONTINUE TO 従来どおり個人 Correction の復元・インライン編集・修正候補・検索・話者ラベル編集・アンドゥ・修正前に戻す操作を提供する

3.4 WHEN 未確定セグメントに対して話者ラベルの変更（単一 `SPEAKER` / 一括 `SPEAKER_RENAME`）が存在する THEN the system SHALL CONTINUE TO それらの話者ラベル変更を表示に反映する

## Deriving the Bug Condition

**F**: 校閲画面のセグメント表示テキスト解決関数（修正前）。各セグメントについて、`consensusStatus` を参照せず、個人 Correction の最新 `afterText` があればそれを、無ければ `originalText` を表示テキストとして返す。

**F'**: 修正後の解決関数。セグメントが `CONFIRMED` なら確定テキスト（`consensusText`）を表示テキストとし、当該セグメントを読み取り専用として扱う。`CONFIRMED` 以外（`UNDECIDED` / `CONFLICT`）は従来どおり個人 Correction → `originalText` の順で解決する。

### Bug Condition

```pascal
FUNCTION isBugCondition(segment)
  INPUT: segment with (consensusStatus, consensusText, originalText)
         evaluated in the context of the logged-in reviewer's personal corrections
  OUTPUT: boolean

  // バグは「確定済みセグメント」の表示で発生する。
  // CONFIRMED なら、個人 Correction の有無に関わらず確定テキストが表示されるべきなのに
  // 現状は個人 Correction（または originalText）が表示される。
  RETURN segment.consensusStatus = 'CONFIRMED'
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: Fix Checking - 確定済みセグメントは確定テキストを表示し読み取り専用である
FOR ALL segment WHERE isBugCondition(segment) DO
  display ← F'(segment)
  ASSERT display.text = segment.consensusText
  ASSERT display.readOnly = true
  ASSERT display.text ≠ personalCorrection(segment).afterText  // 個人結果で上書きされない
END FOR
```

### Property: Preservation Checking

```pascal
// Property: Preservation Checking - 未確定セグメントは従来どおり個人結果を復元する
FOR ALL segment WHERE NOT isBugCondition(segment) DO
  ASSERT F(segment) = F'(segment)
  // すなわち UNDECIDED / CONFLICT では、個人 Correction の最新 afterText があればそれを、
  // 無ければ originalText を表示し、話者ラベル変更も従来どおり反映する。
END FOR
```

### Counterexample

3 名以上の Reviewer が異なる修正を行った後、Admin が強制確定（force confirm）を実行し、セグメント 2 の Consensus が `CONFIRMED`（`consensusText = "確定された正答"`）になったとする。ログイン中の Reviewer 自身はセグメント 2 に `afterText = "私個人の修正"` の Correction を持っている。この状態で校閲画面を開くと、現状はセグメント 2 に「私個人の修正」が表示される。期待は「確定された正答」（`consensusText`）が読み取り専用で表示されることである。
