# Bugfix Requirements Document

## Introduction

Consensus（コンセンサス）確定後に校閲画面からトランスクリプションをダウンロードすると、修正されなかったセグメント（Correction/Consensus が存在しないセグメント）が出力ファイルに含まれない。ダウンロード生成処理が `consensusStatus === 'CONFIRMED'` のセグメントだけを出力対象とし、未修正セグメント（`UNDECIDED`）や競合セグメント（`CONFLICT`）をマージせずに除外してしまうことが原因である。

本来、確定後にダウンロードするトランスクリプションは**全セグメント**を欠落なく含むべきである。修正があったセグメントは確定後のテキストで、修正がなかったセグメントは元の文字起こしテキストで出力されなければならない。この欠落により、ダウンロードした成果物が元メディアの完全な書き起こしにならず、タイムライン上に穴が空く。

本バグは JSON 形式・SRT 形式の両方のダウンロードに影響する（両経路とも共通の `filterConfirmedSegments` を経由する）。

### 用語と状態の対応（コンテキスト）

- `UNDECIDED`: 未修正セグメント。Correction/Consensus が存在せず、出力テキストは元の文字起こし（`originalText`）であるべき。
- `CONFIRMED`: Consensus 確定済みセグメント。出力テキストは確定テキスト（`consensusText`）であるべき。
- `CONFLICT`: 修正は存在するが閾値未達で手動解決待ちのセグメント。確定テキストを持たないため、出力テキストは元の文字起こし（`originalText`）にフォールバックすべき。

## Bug Analysis

### Current Behavior (Defect)

確定後にダウンロードを実行すると、以下が発生する。

1.1 WHEN セッションに `consensusStatus` が `UNDECIDED`（未修正）のセグメントが存在する状態でダウンロードを実行する THEN the system はそのセグメントを出力（JSON/SRT）から除外し、欠落させる

1.2 WHEN セッションに `consensusStatus` が `CONFLICT`（競合・手動解決待ち）のセグメントが存在する状態でダウンロードを実行する THEN the system はそのセグメントを出力（JSON/SRT）から除外し、欠落させる

1.3 WHEN セッション内に `CONFIRMED` のセグメントが 1 つも存在しない（全セグメントが未修正）状態でダウンロードを実行する THEN the system は全セグメントを欠落させ、「確定済みの Segment がありません。」というバリデーションエラーを返す

### Expected Behavior (Correct)

2.1 WHEN セッションに `consensusStatus` が `UNDECIDED`（未修正）のセグメントが存在する状態でダウンロードを実行する THEN the system SHALL そのセグメントを元の文字起こしテキスト（`originalText`）で出力に含める

2.2 WHEN セッションに `consensusStatus` が `CONFLICT`（競合・手動解決待ち）のセグメントが存在する状態でダウンロードを実行する THEN the system SHALL そのセグメントを元の文字起こしテキスト（`originalText`、確定テキストが無いため）で出力に含める

2.3 WHEN セッション内に `CONFIRMED` のセグメントが 1 つも存在しない（全セグメントが未修正）状態でダウンロードを実行する THEN the system SHALL エラーを返さず、全セグメントを元の文字起こしテキストで出力する

2.4 WHEN 確定後にダウンロードを実行する THEN the system SHALL セッションの全セグメントを、`startTime` 昇順の連続した並びで（タイムライン上に欠落なく）出力に含める

### Unchanged Behavior (Regression Prevention)

3.1 WHEN セグメントの `consensusStatus` が `CONFIRMED` である THEN the system SHALL CONTINUE TO そのセグメントを確定後のテキスト（`consensusText`）で出力する

3.2 WHEN リクエストユーザーの話者ラベル修正（`SPEAKER` / `SPEAKER_RENAME`）が存在する THEN the system SHALL CONTINUE TO それらを全出力セグメントに適用する

3.3 WHEN JSON 形式でダウンロードする THEN the system SHALL CONTINUE TO `sessionName`・`exportedAt`・各セグメントの `startTime`/`endTime`/`text`/（存在時のみ）`speakerLabel` を含む既存の JSON 構造を生成する

3.4 WHEN SRT 形式でダウンロードする THEN the system SHALL CONTINUE TO 連番・`HH:MM:SS,mmm --> HH:MM:SS,mmm` タイムコード・（話者ラベル存在時は）`[label] text` 形式の既存の SRT 構造を生成する

3.5 WHEN ダウンロードファイル名を生成する THEN the system SHALL CONTINUE TO `{sessionName}_{YYYYMMDD}.{extension}` 形式を維持する

3.6 WHEN 指定された ReviewSession が存在しない THEN the system SHALL CONTINUE TO `NOT_FOUND` エラーを返す

---

## Bug Condition & Properties

### Bug Condition

```pascal
FUNCTION isBugCondition(session)
  INPUT: session with ordered segments[] (each has consensusStatus, originalText, consensusText)
  OUTPUT: boolean

  // The bug manifests whenever any segment is not CONFIRMED, because such
  // segments are dropped from the download instead of being merged back in.
  RETURN EXISTS s IN session.segments WHERE s.consensusStatus <> 'CONFIRMED'
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: every segment appears in the download, with the correct text source.
FOR ALL session WHERE isBugCondition(session) DO
  output ← generateDownload'(session)   // F' = fixed generator (JSON or SRT)

  // Completeness: no segment is missing.
  ASSERT count(output.segments) = count(session.segments)

  // Correct text source per segment.
  FOR ALL s IN session.segments DO
    o ← output.segmentFor(s)
    IF s.consensusStatus = 'CONFIRMED' THEN
      ASSERT o.text = s.consensusText
    ELSE
      ASSERT o.text = s.originalText
    END IF
  END FOR

  // Ordering preserved (startTime ascending, no gaps introduced by filtering).
  ASSERT output.segments are ordered by startTime ascending
END FOR
```

### Property: Preservation Checking

```pascal
// Property: for any segment that is CONFIRMED, the fixed generator produces
// exactly the same output as the original generator (text, timing, speaker label).
FOR ALL session WHERE NOT isBugCondition(session) DO
  // NOT isBugCondition ⇒ every segment is CONFIRMED.
  ASSERT generateDownload(session) = generateDownload'(session)
END FOR
```

**Key Definitions**

- **F** (`generateDownload`): the original download generator (`generateJson` / `generateSrt`) that filters to `CONFIRMED` segments only.
- **F'** (`generateDownload'`): the fixed generator that includes all segments, using `consensusText` for `CONFIRMED` segments and `originalText` otherwise.
- **Counterexample**: a session with 3 segments where only segment 2 is `CONFIRMED`. Current download emits 1 segment (segment 2); expected download emits 3 segments (1 and 3 with original text, 2 with confirmed text).
