# ダウンロード時の未修正セグメント欠落 Bugfix Design

## Overview

Consensus 確定後に校閲画面からトランスクリプションをダウンロードすると、修正されなかったセグメント（`UNDECIDED`）や競合セグメント（`CONFLICT`）が出力ファイル（JSON / SRT）から欠落する。原因は `backend/src/services/download-service.ts` の `filterConfirmedSegments` が `consensusStatus === 'CONFIRMED'` のセグメントだけを残し、それ以外を除外していることにある。さらに、全セグメントが未修正の場合は `confirmedSegments.length === 0` ガードが `validationError('確定済みの Segment がありません。')` を投げ、ダウンロード自体が失敗する。

幸い、DynamoDB からセグメントを読み出す `getSessionSegments` は各セグメントの `text` を `consensusText ?? originalText` で既に解決している。つまり、CONFIRMED セグメントは確定テキスト、それ以外は元の文字起こしテキストが `text` フィールドに入った状態で返されている。したがって修正は最小限で済む。`filterConfirmedSegments` によるフィルタリングを撤廃して全セグメントを出力対象にし、空判定を「セグメントが 1 つも無い」場合のみに調整すればよい。これにより JSON / SRT 両経路で全セグメントがタイムライン順に欠落なく出力される。

本設計は、修正を最小かつ対象限定に保ち、既存の CONFIRMED セグメントの出力・話者ラベル修正の適用・JSON/SRT 構造・ファイル名生成・`NOT_FOUND` エラーといった既存挙動を一切変更しないことを目標とする。

## Glossary

- **Bug_Condition (C)**: バグが発動する条件。セッション内に 1 つでも非 `CONFIRMED` セグメント（`UNDECIDED` / `CONFLICT`）が存在する状態でダウンロードを実行したとき、そのセグメントが出力から欠落する（または全セグメント未修正時にエラーになる）こと。
- **Property (P)**: 修正後に満たすべき望ましい挙動。全セグメントが出力に含まれ、CONFIRMED は `consensusText`、それ以外は `originalText` のテキストで、`startTime` 昇順の連続した並びで出力されること。
- **Preservation（保全）**: 修正によって変化してはならない既存挙動。CONFIRMED セグメントの出力テキスト、話者ラベル修正の適用、JSON/SRT 構造、ファイル名形式、`NOT_FOUND` エラー。
- **`filterConfirmedSegments`**: `download-service.ts` 内の純粋関数。`consensusStatus === 'CONFIRMED'` のセグメントだけを残すフィルタ。本バグの直接原因。
- **`getSessionSegments`**: `download-service.ts` 内の関数。DynamoDB から全セグメントを `ScanIndexForward: true`（PK/SK 昇順）で取得し、各 `text` を `consensusText ?? originalText` で解決して返す。
- **`generateJson` / `generateSrt`**: ダウンロードの公開エントリ関数。セッション取得 → 全セグメント取得 → フィルタ → 空ガード → 話者修正適用 → 整形、の順で処理する。
- **`consensusStatus`**: 各セグメントの確定状態。`UNDECIDED`（未修正・元テキスト）/ `CONFIRMED`（確定・`consensusText`）/ `CONFLICT`（競合・確定テキスト無しで元テキストにフォールバック）。

## Bug Details

### Bug Condition

このバグは、セッション内に 1 つでも非 `CONFIRMED` セグメントが存在する状態でダウンロード（JSON または SRT）を実行したときに発動する。`generateJson` / `generateSrt` は全セグメントを取得した後 `filterConfirmedSegments` を通すため、`UNDECIDED` / `CONFLICT` セグメントが出力配列から除外される。全セグメントが非 `CONFIRMED` の場合は、フィルタ結果が空になり `confirmedSegments.length === 0` ガードがバリデーションエラーを投げる。

**Formal Specification:**
```
FUNCTION isBugCondition(session)
  INPUT: session with ordered segments[] (each has consensusStatus, originalText, consensusText)
  OUTPUT: boolean

  // 非 CONFIRMED セグメントは出力からドロップされる（または全未修正時にエラー）ため、
  // 1 つでも非 CONFIRMED が存在すればバグが顕在化する。
  RETURN EXISTS s IN session.segments WHERE s.consensusStatus <> 'CONFIRMED'
END FUNCTION
```

### Examples

- **部分未修正（欠落）**: 3 セグメント（1=`UNDECIDED`, 2=`CONFIRMED`, 3=`CONFLICT`）のセッションをダウンロード。期待は 3 セグメント全部（1 と 3 は `originalText`、2 は `consensusText`）だが、現状はセグメント 2 のみの 1 件しか出力されず、タイムライン上に穴が空く。
- **CONFLICT 欠落**: セグメントが `CONFLICT`（確定テキスト無し）のとき、期待は `originalText` で出力に含まれることだが、現状は除外される。
- **全未修正（エラー）**: 全セグメントが `UNDECIDED` のセッションをダウンロード。期待は全セグメントを `originalText` で出力することだが、現状は「確定済みの Segment がありません。」というバリデーションエラーで失敗する。
- **エッジケース（空セッション）**: セグメントが 0 件のセッション。全セグメント未修正でも存在しないため、空出力（JSON は `segments: []`、SRT は空文字列）が妥当なフォールバック挙動。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors（変更してはならない挙動）:**
- `consensusStatus === 'CONFIRMED'` のセグメントは、引き続き確定後テキスト（`consensusText`、`getSessionSegments` で `text` に解決済み）で出力される。
- リクエストユーザーの話者ラベル修正（`SPEAKER` / `SPEAKER_RENAME`）は、引き続き全出力セグメントに適用される。
- JSON 構造（`sessionName` / `exportedAt` / 各セグメントの `startTime`/`endTime`/`text`/ 存在時のみ `speakerLabel`）は変更しない。
- SRT 構造（連番 / `HH:MM:SS,mmm --> HH:MM:SS,mmm` タイムコード / 話者ラベル存在時は `[label] text`）は変更しない。
- ダウンロードファイル名形式 `{sessionName}_{YYYYMMDD}.{extension}` は維持する。
- 指定された ReviewSession が存在しない場合は、引き続き `NOT_FOUND` エラーを返す。

**Scope:**
バグ条件に該当しない入力（＝全セグメントが `CONFIRMED` のセッション）は、本修正の影響を一切受けてはならない。具体的には以下を含む。
- 全セグメントが `CONFIRMED` の JSON 出力
- 全セグメントが `CONFIRMED` の SRT 出力
- 話者ラベル修正の適用結果
- ファイル名生成・`NOT_FOUND` エラー経路

**Note:** バグ条件該当入力に対する正しい期待挙動（全セグメントの包含とテキストソースの選択）は「Correctness Properties」セクションの Property 1 で定義する。本セクションは「変わってはならないもの」を扱う。

## Hypothesized Root Cause

バグの記述とコード確認に基づき、原因は以下に特定できる。

1. **過剰なフィルタリング（主因・確定）**: `filterConfirmedSegments` が `consensusStatus === 'CONFIRMED'` 以外のセグメントを除外する。`generateJson` / `generateSrt` がこの関数を通すため、`UNDECIDED` / `CONFLICT` セグメントが出力から欠落する。
   - `getSessionSegments` は `text: (item['consensusText'] as string) ?? (item['originalText'] as string)` で既に正しいテキストソースを解決済み。よってフィルタを外せば非 CONFIRMED は自動的に `originalText` で出力される。

2. **厳しすぎる空ガード（副因・確定）**: `if (confirmedSegments.length === 0) throw validationError('確定済みの Segment がありません。')` が、全セグメント未修正時に全出力を失敗させる。本来は「確定済みが無い」ではなく「セグメントが 1 つも無い」場合のみフォールバック（空出力）とすべき。

3. **並び順（問題なし・確認済み）**: `getSessionSegments` は `ScanIndexForward: true` で取得し、SRT の連番は配列インデックス順に振られる。セグメントの SK が `startTime` 昇順に並ぶ設計のため、フィルタ撤廃後も `startTime` 昇順・欠落なしが維持される。追加のソート実装は不要だが、テストで昇順を保証する。

## Correctness Properties

Property 1: Bug Condition - 全セグメントが正しいテキストソースで出力に含まれる

_For any_ バグ条件が成立する（`isBugCondition` が true を返す）セッション入力、すなわち 1 つでも非 `CONFIRMED` セグメントを含むセッションに対して、修正後の生成関数（`generateJson` / `generateSrt`）SHALL セッションの全セグメントを出力に含め、各セグメントのテキストを `consensusStatus === 'CONFIRMED'` のときは `consensusText`、それ以外のときは `originalText` とし、`startTime` 昇順の連続した並びで（タイムライン上に欠落なく）出力する。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - 全 CONFIRMED セッションの出力不変

_For any_ バグ条件が成立しない（`isBugCondition` が false を返す）セッション入力、すなわち全セグメントが `CONFIRMED` のセッションに対して、修正後の生成関数 SHALL 修正前の生成関数とまったく同一の出力を生成し、CONFIRMED セグメントのテキスト・タイミング・話者ラベル・JSON/SRT 構造を保全する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

根本原因の分析が正しいという前提で、変更は `download-service.ts` の 1 ファイルに限定される。

**File**: `backend/src/services/download-service.ts`

**Functions**: `generateJson`, `generateSrt`（および `filterConfirmedSegments` の扱い）

**Specific Changes**:

1. **フィルタの撤廃**: `generateJson` / `generateSrt` 内の `filterConfirmedSegments(allSegments)` 呼び出しを取り除き、`allSegments` をそのまま出力対象にする。`getSessionSegments` が既に `consensusText ?? originalText` を解決済みのため、非 CONFIRMED は自動的に `originalText` で出力される。
   - 変更後の対象変数名は意味に合わせて `confirmedSegments` → `outputSegments`（または `segments`）へ改名し、誤解を招かないようにする。

2. **空ガードの調整**: 空判定を「確定済みが 0 件」から「セグメントが 0 件」に変更する。`allSegments.length === 0` の場合は、エラーを投げず空出力をフォールバックとして返す（JSON は `segments: []`、SRT は空文字列）。これにより Req 2.3（全未修正でもエラーにしない）を満たす。
   - 既存の `validationError('確定済みの Segment がありません。')` スローは削除する。

3. **話者修正の適用順序維持**: `applySpeakerCorrections` の呼び出しは、フィルタ撤廃後の全セグメント配列に対して従来どおり適用する（適用ロジック自体は変更しない）。

4. **`filterConfirmedSegments` の扱い**: 本関数は呼び出し元が無くなる。公開エクスポート（純粋関数としてテストから参照されている可能性）であるため、不要であれば削除し、関連する単体/プロパティテストも併せて整理する。削除可否はテスト依存を確認したうえで実装タスクで判断する。

5. **JSDoc の更新**: `generateJson` / `generateSrt` の JSDoc から「filters to confirmed segments only」および `NO_CONFIRMED_SEGMENTS` に関する記述を削除し、「全セグメントを含め、未修正/競合は元テキストで出力する」旨に更新する。

## Testing Strategy

### Validation Approach

テスト戦略は 2 フェーズで進める。まず未修正コード上でバグを再現する反例を表面化させ、次に修正が正しく機能し、かつ既存挙動を保全していることを検証する。

### Exploratory Bug Condition Checking

**Goal**: 修正を実装する前に、未修正コード上でバグを示す反例を表面化させる。根本原因分析（過剰フィルタ＋厳しすぎる空ガード）を確認または反証する。反証された場合は再仮説を立てる。

**Test Plan**: `getSessionSegments` の DynamoDB アクセスを `vi.mock()` でモックし、非 CONFIRMED セグメントを含むセッションを与えて `generateJson` / `generateSrt` を呼ぶテストを書く。未修正コード上で実行し、欠落やバリデーションエラーが観測されることを確認する。

**Test Cases**:
1. **部分未修正テスト（JSON）**: 3 セグメント（`UNDECIDED` / `CONFIRMED` / `CONFLICT`）で `generateJson` を呼び、出力が 3 件になることを期待（未修正コードでは 1 件に落ちて失敗する）。
2. **部分未修正テスト（SRT）**: 同構成で `generateSrt` を呼び、連番 1〜3 の 3 ブロックが生成されることを期待（未修正コードでは 1 ブロックのみで失敗する）。
3. **全未修正テスト**: 全セグメント `UNDECIDED` で `generateJson` を呼び、全セグメントが `originalText` で出力されることを期待（未修正コードでは `確定済みの Segment がありません。` で失敗する）。
4. **エッジケース（空セッション）**: セグメント 0 件で `generateJson` を呼び、`segments: []` を期待（未修正コードではバリデーションエラーになる可能性）。

**Expected Counterexamples**:
- 非 CONFIRMED セグメントが出力に現れない（欠落）。
- 全未修正時にバリデーションエラーが投げられダウンロードが失敗する。
- 想定原因: `filterConfirmedSegments` による除外、`confirmedSegments.length === 0` ガード。

### Fix Checking

**Goal**: バグ条件が成立する全入力に対して、修正後の関数が期待挙動を生成することを検証する。

**Pseudocode:**
```
FOR ALL session WHERE isBugCondition(session) DO
  output := generateDownload_fixed(session)   // generateJson / generateSrt
  ASSERT count(output.segments) = count(session.segments)
  FOR ALL s IN session.segments DO
    o := output.segmentFor(s)
    IF s.consensusStatus = 'CONFIRMED' THEN
      ASSERT o.text = s.consensusText
    ELSE
      ASSERT o.text = s.originalText
    END IF
  END FOR
  ASSERT output.segments are ordered by startTime ascending
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しない全入力（全セグメント CONFIRMED）に対して、修正後の関数が修正前の関数と同一の結果を生成することを検証する。

**Pseudocode:**
```
FOR ALL session WHERE NOT isBugCondition(session) DO
  // NOT isBugCondition ⇒ 全セグメントが CONFIRMED
  ASSERT generateDownload_original(session) = generateDownload_fixed(session)
END FOR
```

**Testing Approach**: 保全検証にはプロパティベーステストが適している。理由は以下のとおり。
- 入力ドメイン全体にわたり多数のテストケースを自動生成できる。
- 手動の単体テストでは見落としがちなエッジケースを捕捉できる。
- 非バグ入力に対して挙動が不変であることを強く保証できる。

**Test Plan**: 全セグメント CONFIRMED のセッションを fast-check で生成し、修正後出力が「確定テキスト・タイミング・話者ラベル・JSON/SRT 構造」を保持することを検証する。修正前の既存テストのスナップショット的期待値と一致することを確認する。

**Test Cases**:
1. **CONFIRMED 出力保全**: 全 CONFIRMED セッションで、各セグメントが `consensusText` で出力されることを検証。
2. **話者ラベル修正保全**: `SPEAKER` / `SPEAKER_RENAME` が全出力セグメントに適用され続けることを検証。
3. **構造・ファイル名保全**: JSON の `sessionName`/`exportedAt`/セグメント構造、SRT のタイムコード形式、`{sessionName}_{YYYYMMDD}.{ext}` ファイル名が不変であることを検証。
4. **`NOT_FOUND` 保全**: 存在しないセッション ID で `NOT_FOUND` エラーが返り続けることを検証。

### Unit Tests

- `generateJson` / `generateSrt` について、非 CONFIRMED を含むセッションで全セグメントが出力されること（Req 2.1, 2.2, 2.4）。
- 全未修正セッションでエラーにならず全セグメントが `originalText` で出力されること（Req 2.3）。
- CONFIRMED セグメントが `consensusText` で出力され続けること（Req 3.1）。
- 空セッション（セグメント 0 件）で空出力を返すこと（エッジケース）。
- 存在しないセッションで `NOT_FOUND` を返すこと（Req 3.6）。

### Property-Based Tests

- **Property 1（Fix）**: ランダムな `consensusStatus` の組み合わせを持つセッションを生成し、全セグメントが含まれ、テキストソースが正しく（CONFIRMED→`consensusText` / その他→`originalText`）、`startTime` 昇順で出力されることを検証（`{ numRuns: 100 }`）。
- **Property 2（Preservation）**: 全 CONFIRMED セッションを生成し、修正後出力が従来挙動（テキスト・タイミング・話者ラベル・構造）を保持することを検証（`{ numRuns: 100 }`）。
- 話者ラベル修正をランダム生成し、全出力セグメントへの適用が保全されることを検証。

### Integration Tests

- セッション → セグメント（混在ステータス）→ `generateJson` / `generateSrt` の全経路を、混在ステータスのセグメントで実行し、タイムライン欠落がないことを検証。
- 全未修正セッションをダウンロードし、全セグメントが元テキストで出力されることを検証。
- 話者ラベル修正を伴うセッションで、修正適用と全セグメント包含が両立することを検証。
