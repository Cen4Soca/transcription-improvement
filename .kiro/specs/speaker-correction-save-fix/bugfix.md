# Bugfix Requirements Document

## Introduction

校閲画面（ReviewPage）で Reviewer がセグメントの話者ラベル（speaker）を変更しても、その変更が永続化されない。テキスト本文の修正（`TEXT` Correction）は正しく保存・復元されるが、話者の変更（`SPEAKER` / 単一セグメントの話者ラベル変更、および `SPEAKER_RENAME` / 話者ラベル一括変更）は、保存リクエストに正しく含まれない、またはバリデーション・保存・復元のいずれかの段階で破棄され、ReviewSession を再読み込みすると変更前の話者ラベルに戻ってしまう。

これにより Reviewer は話者の誤りを恒久的に修正できず、Consensus 集約やダウンロード出力にも話者修正が反映されないおそれがある。本バグ修正の目的は、話者ラベルの変更が `Correction` として確実に保存され、ReviewSession 再読み込み後も反映され続けることを保証することである。テキスト本文修正など、話者以外の既存の校閲動作には一切影響を与えない。

バグ条件・不変条件の定義で使用する記号:

- **C(X)**: バグ条件。バグを引き起こす入力（話者ラベルの変更操作）を識別する述語。
- **P(result)**: プロパティ。C(X) を満たす入力に対して期待される正しい挙動。
- **¬C(X)**: バグを引き起こさない入力（テキスト本文修正など、話者を変更しない操作）。
- **F**: 修正前の関数（現在のコード）。
- **F'**: 修正後の関数（修正適用後のコード）。

## Bug Analysis

### Current Behavior (Defect)

Reviewer が話者ラベルを変更したときに現在発生している誤った挙動:

1.1 WHEN Reviewer が単一セグメントの話者ラベルを別のラベルに変更して確定する（`correctionType = 'SPEAKER'`、`beforeSpeaker ≠ afterSpeaker`）THEN the system は変更を `Correction` として永続化せず、ReviewSession を再読み込みすると話者ラベルが変更前の値に戻る

1.2 WHEN Reviewer が話者ラベルの一括変更（リネーム）を確定する（`correctionType = 'SPEAKER_RENAME'`、`beforeSpeaker ≠ afterSpeaker`）THEN the system は変更を `Correction` として永続化せず、ReviewSession を再読み込みすると全セグメントの話者ラベルが変更前の値に戻る

1.3 WHEN 話者ラベルの変更が保存される際 THEN the system は `beforeSpeaker` / `afterSpeaker` フィールドを保存リクエスト・バリデーション・永続化・復元のいずれかの段階で破棄し、変更内容が失われる

### Expected Behavior (Correct)

同じ条件に対して本来あるべき正しい挙動:

2.1 WHEN Reviewer が単一セグメントの話者ラベルを別のラベルに変更して確定する（`correctionType = 'SPEAKER'`、`beforeSpeaker ≠ afterSpeaker`）THEN the system SHALL その変更を `beforeSpeaker` / `afterSpeaker` を含む `Correction` として永続化し、ReviewSession 再読み込み後も変更後の話者ラベルが表示され続ける

2.2 WHEN Reviewer が話者ラベルの一括変更（リネーム）を確定する（`correctionType = 'SPEAKER_RENAME'`、`beforeSpeaker ≠ afterSpeaker`）THEN the system SHALL その変更を `beforeSpeaker` / `afterSpeaker`（および該当する `affectedSegmentCount`）を含む `Correction` として永続化し、ReviewSession 再読み込み後も対象セグメントの話者ラベルが変更後の値で表示され続ける

2.3 WHEN 話者ラベルの変更が保存される際 THEN the system SHALL `beforeSpeaker` / `afterSpeaker` フィールドを保存リクエスト・バリデーション・永続化・復元の全段階で欠落なく引き継ぎ、保存した話者変更が GET 取得時に同一の値で返される

### Unchanged Behavior (Regression Prevention)

話者変更以外の、保持されなければならない既存の挙動:

3.1 WHEN Reviewer がセグメントのテキスト本文を修正する（`correctionType = 'TEXT'`）THEN the system SHALL CONTINUE TO その修正を `Correction` として保存し、ReviewSession 再読み込み後も修正後テキストを表示する

3.2 WHEN Reviewer が同じ `correctionId` で同一の Correction を再送する THEN the system SHALL CONTINUE TO 冪等に扱い、重複保存せず成功（200）を返す

3.3 WHEN Reviewer が話者ラベルを変更前と同じ値に選び直す（`beforeSpeaker = afterSpeaker`、実質的な変更なし）THEN the system SHALL CONTINUE TO Correction を生成せず、既存の表示状態を維持する

3.4 WHEN いずれかの Correction が保存される THEN the system SHALL CONTINUE TO 初回 Correction で ReviewSession ステータスを PENDING → IN_PROGRESS に更新し、監査ログを記録し、Consensus 集約イベントを発行する

3.5 WHEN ReviewSession ステータスが COMPLETED（読み取り専用）である THEN the system SHALL CONTINUE TO 話者ラベルの編集 UI を無効化し、変更を受け付けない

## Deriving the Bug Condition

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type CorrectionSaveRequest
  OUTPUT: boolean

  // 話者ラベルを実際に変更する保存要求であること
  RETURN (X.correctionType = 'SPEAKER' OR X.correctionType = 'SPEAKER_RENAME')
         AND X.afterSpeaker IS DEFINED
         AND X.beforeSpeaker <> X.afterSpeaker
END FUNCTION
```

### Property Specification (Fix Checking)

```pascal
// Property: Fix Checking - 話者変更の永続化と復元
FOR ALL X WHERE isBugCondition(X) DO
  saveCorrection'(X)                       // F': 修正後の保存処理
  restored ← listCorrections'(X.sessionId) // 再読み込み時の復元
  c ← findBy(restored, X.correctionId)
  ASSERT c IS DEFINED
         AND c.correctionType = X.correctionType
         AND c.beforeSpeaker = X.beforeSpeaker
         AND c.afterSpeaker = X.afterSpeaker
END FOR
```

### Preservation Goal (Preservation Checking)

```pascal
// Property: Preservation Checking - 話者変更以外の挙動を不変に保つ
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

ここで ¬C(X) には、テキスト本文修正（`correctionType = 'TEXT'`）、実質的な変更のない話者再選択（`beforeSpeaker = afterSpeaker`）、冪等な再送などが含まれる。これらについては修正前後で挙動が完全に一致しなければならない。
