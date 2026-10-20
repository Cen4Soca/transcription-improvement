# Force Confirm Consensus Display Fix Bugfix Design

## Overview

強制確定（force confirm）を含め Consensus が確定したセッションを校閲画面（ReviewPage）で開くと、確定済み（`CONFIRMED`）セグメントに対しても、ログイン中 Reviewer 個人の Correction（最新 `afterText`）が表示テキストへ上書き適用されてしまう。その結果、集約で定まった「正答」（`consensusText`）ではなく個人の修正結果が見えてしまう。

根本原因は、`frontend/src/App.tsx` の `ReviewPageWrapper` 内にあるセグメント復元用の `segments` useMemo が、セグメントの `consensusStatus` / `consensusText` をまったく参照せず、個人 Correction の最新テキスト（`appliedText`）を無条件に各セグメントの `originalText` へ上書きしている点にある。`consensusStatus` / `consensusText` は既に `GET /sessions/{sessionId}/segments`（`backend/src/handlers/get-segments.ts`）からフロントに公開されており、`Segment` 型（`frontend/src/types/segment.ts`）にも定義済みであるため、バックエンド変更は不要で、表示解決ロジックのみを修正する。

修正方針は、`segments` useMemo の各セグメント変換において、`consensusStatus === 'CONFIRMED'` のセグメントでは個人 Correction（テキスト・話者ラベル変更）を適用せず `consensusText` を表示テキストとして採用し、当該セグメントを読み取り専用として扱う。`UNDECIDED` / `CONFLICT` セグメントは現状の個人 Correction 復元ロジックを完全に維持する。読み取り専用扱いは、現在セッション全体の `COMPLETED` 判定（`isReadOnly` = session-wide）で制御されている編集無効化（`editingEnabled` / SegmentEditor のハンドラ undefined 化）と整合させ、CONFIRMED セグメントでは個別に編集・候補・話者変更・revert を抑止する。

## Glossary

- **Bug_Condition (C)**: バグが発現する条件。セグメントの `consensusStatus` が `CONFIRMED` であること（確定済みセグメント）。この条件下で個人 Correction が確定テキストを上書きしてしまう。
- **Property (P)**: 確定済みセグメントのあるべき表示挙動。`consensusText` を表示テキストとし、個人 Correction で上書きせず、読み取り専用として提示する。
- **Preservation**: 変えてはならない既存挙動。`UNDECIDED` / `CONFLICT` セグメントにおける個人 Correction（テキスト・単一話者変更・話者一括リネーム）の復元・インライン編集・修正候補・検索・アンドゥ・修正前に戻す操作、および `COMPLETED` セッション全体の読み取り専用挙動。
- **`segments` useMemo**: `frontend/src/App.tsx` の `ReviewPageWrapper` 内で、サーバー取得の素のセグメント（`baseSegments`）に個人 Correction（`appliedText` / `appliedSpeaker` / `speakerRenames`）を適用し、表示用セグメント配列を導出する `useMemo`。本バグの原因箇所。
- **`appliedText`**: `segmentId` → 個人 Correction の最新 `afterText` のマップ。復元表示に使われる。
- **`consensusStatus`**: セグメントの集約状態。`'UNDECIDED' | 'CONFIRMED' | 'CONFLICT'`。`get-segments` で取得され `Segment` 型に含まれる。
- **`consensusText`**: `CONFIRMED` セグメントの確定された正答テキスト。`get-segments` で取得され `Segment` 型に含まれる（任意）。
- **`isReadOnly` / `editingEnabled`**: `frontend/src/pages/ReviewPage.tsx` のフラグ。現在は `sessionStatus === 'COMPLETED'` でセッション全体を読み取り専用化する。CONFIRMED は本来セグメント単位の確定であり、session-wide 判定とは粒度が異なる。

## Bug Details

### Bug Condition

バグは、確定済みセグメント（`consensusStatus === 'CONFIRMED'`）を校閲画面で表示するときに発現する。`segments` useMemo は `consensusStatus` を参照しないため、CONFIRMED セグメントであっても個人 Correction の最新 `afterText`（あれば）を `originalText` に上書きし、無ければ素の `originalText` を表示する。どちらの場合も、本来表示すべき確定テキスト `consensusText` が表示されない。

**Formal Specification:**
```
FUNCTION isBugCondition(segment)
  INPUT: segment with (consensusStatus, consensusText, originalText),
         評価はログイン中 Reviewer の個人 Correction の文脈で行う
  OUTPUT: boolean

  // 確定済みセグメントでは consensusText を読み取り専用で表示すべきだが、
  // 現状は consensusStatus を参照せず個人 Correction / originalText を表示している。
  RETURN segment.consensusStatus = 'CONFIRMED'
END FUNCTION
```

### Examples

- **CONFIRMED + 個人 Correction あり（1.1 / 2.1）**: セグメント 2 が `CONFIRMED`（`consensusText = "確定された正答"`）で、ログイン中 Reviewer が `afterText = "私個人の修正"` を持つ。期待: "確定された正答"（読み取り専用）／ 現状: "私個人の修正"。
- **CONFIRMED + 個人 Correction なし（1.2 / 2.2）**: セグメント 3 が `CONFIRMED`（`consensusText = "確定本文"`）で個人 Correction なし。期待: "確定本文"（読み取り専用）／ 現状: 素の `originalText`。
- **CONFIRMED の編集可否（1.3 / 2.3）**: `CONFIRMED` セグメントは読み取り専用で提示すべき。現状: 他セグメントと同様に編集可能（クリックでインライン編集・候補・話者変更・revert が働く。ただしセッションが `COMPLETED` の場合は session-wide に無効化される）。
- **UNDECIDED（保存すべき挙動 / 3.1）**: `consensusStatus = 'UNDECIDED'` のセグメントは、個人 Correction があれば `afterText`、無ければ `originalText` を表示し編集可能。
- **CONFLICT（保存すべき挙動 / 3.2）**: `consensusStatus = 'CONFLICT'` のセグメントも UNDECIDED と同様に個人 Correction を復元表示する。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `UNDECIDED` セグメントにおける個人 Correction の復元表示（`afterText` があればそれ、無ければ `originalText`）。
- `CONFLICT` セグメントにおける個人 Correction の復元表示。
- 未確定セグメントに対する単一話者ラベル変更（`SPEAKER`）および話者ラベル一括リネーム（`SPEAKER_RENAME`）の表示反映（連鎖リネームの畳み込みを含む）。
- 全セグメントが未確定のセッションにおける復元・インライン編集・修正候補・検索・話者ラベル編集・アンドゥ・修正前に戻す操作。
- `COMPLETED` セッション全体の読み取り専用挙動（`isReadOnly` / `editingEnabled`）およびダウンロード可否。

**Scope:**
`consensusStatus` が `CONFIRMED` でないすべてのセグメント（`UNDECIDED` / `CONFLICT`）は、本修正の影響を一切受けてはならない。具体的には以下を含む:
- `UNDECIDED` セグメントの表示テキスト解決と編集可否
- `CONFLICT` セグメントの表示テキスト解決と編集可否
- 未確定セグメントに対する話者ラベル変更（単一・一括）の表示反映

**Note:** 確定済みセグメントのあるべき正しい表示挙動は Correctness Properties の Property 1 に定義する。本節は「変えてはならないもの」に焦点を当てる。

## Hypothesized Root Cause

バグ記述とコード調査に基づくと、原因は以下に集約される:

1. **`consensusStatus` 未参照の無条件上書き**: `frontend/src/App.tsx` の `ReviewPageWrapper` 内 `segments` useMemo が、各 `baseSegments` 要素に対し `appliedText.has(s.segmentId)` のみを条件に `originalText` を個人 `afterText` へ上書きしている。`consensusStatus` / `consensusText` を一切参照しないため、`CONFIRMED` セグメントでも個人修正が優先されてしまう。
   - 対象コード: `if (appliedText.has(s.segmentId)) { next = { ...next, originalText: appliedText.get(s.segmentId)! }; }`

2. **確定テキスト（`consensusText`）の未使用**: `Segment` 型および `get-segments` レスポンスには `consensusText` が存在するが、表示解決ロジックで一度も読まれていない。確定済みセグメントの表示元として `consensusText` を採用する分岐が欠落している。

3. **読み取り専用粒度のミスマッチ**: 読み取り専用制御（`ReviewPage.tsx` の `isReadOnly = sessionStatus === 'COMPLETED'`）はセッション全体（session-wide）の粒度で、`COMPLETED` でないセッションに `CONFIRMED` セグメントが混在するケース（例: 一部のみ強制確定）では、確定済みセグメントが編集可能なままになる。CONFIRMED を読み取り専用として提示するにはセグメント単位の読み取り専用判定が必要。

4. **話者変更の確定済みセグメントへの適用**: 同じ useMemo 内で話者ラベル（単一 `appliedSpeaker` / 一括 `speakerRenames`）も `consensusStatus` を見ずに適用している。確定済みセグメントでは確定テキストを提示する以上、個人起因の話者変更も上書き対象から除外するのが一貫する。

## Correctness Properties

Property 1: Bug Condition - 確定済みセグメントは確定テキストを読み取り専用で表示する

_For any_ セグメントで Bug Condition が成立する場合（isBugCondition が true、すなわち `consensusStatus === 'CONFIRMED'`）、修正後の表示解決は、個人 Correction（`afterText`）や素の `originalText` ではなく確定テキスト（`consensusText`）を当該セグメントの表示テキストとして採用し、かつ当該セグメントを読み取り専用（インライン編集・修正候補・話者変更・修正前に戻す操作の対象外）として提示する SHALL。個人 Correction を持つ場合でもその `afterText` で上書きしてはならない。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - 未確定セグメントの個人結果復元は不変

_For any_ セグメントで Bug Condition が成立しない場合（isBugCondition が false、すなわち `consensusStatus` が `UNDECIDED` または `CONFLICT`）、修正後の表示解決は修正前と同一の結果を生成する SHALL。すなわち、個人 Correction の最新 `afterText` があればそれを、無ければ `originalText` を表示テキストとし、単一話者変更・話者一括リネームの反映を含め、既存の復元・編集・候補・検索・アンドゥ挙動を保存する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

根本原因分析が正しいと仮定した場合の変更:

**File**: `frontend/src/App.tsx`（`ReviewPageWrapper` 内 `segments` useMemo）

**Function**: セグメント表示テキスト解決（`segments` useMemo の `baseSegments.map(...)` 変換）

**Specific Changes**:
1. **CONFIRMED 分岐の追加**: 各セグメント変換の冒頭で `s.consensusStatus === 'CONFIRMED'` を判定する。真なら、`consensusText`（存在する場合）を表示テキストとして `originalText` に設定し、個人 Correction（`appliedText`）・単一話者変更（`appliedSpeaker`）・話者一括リネーム（`speakerRenames`）の適用をスキップする。`consensusText` が万一欠落している場合は素の `originalText` をそのまま表示する（個人 Correction では上書きしない）。
   - 例: `if (s.consensusStatus === 'CONFIRMED') { return s.consensusText !== undefined ? { ...s, originalText: s.consensusText } : s; }`

2. **非 CONFIRMED の既存ロジック維持**: `UNDECIDED` / `CONFLICT` セグメントは現状の `appliedText` → `originalText` 上書き、`appliedSpeaker` / `speakerRenames` による話者解決をそのまま適用する（挙動不変）。

3. **早期 return ショートカットの整合**: useMemo 冒頭の「`appliedText`/`appliedSpeaker`/`speakerRenames` がすべて空なら `baseSegments` を返す」ショートカットは、CONFIRMED のとき `consensusText` を適用する必要があるため見直す。空ショートカット時でも、CONFIRMED で `consensusText` を持つセグメントがあれば表示テキストを `consensusText` に差し替える（または、CONFIRMED 変換を常に通すよう map を無条件に実行する形へ単純化する）。

4. **読み取り専用の伝達（CONFIRMED セグメント）**: 確定済みセグメントを読み取り専用として提示するため、`ReviewPage` 側で「当該セグメントが `CONFIRMED` なら編集系ハンドラ（`onStartEdit` / `onConfirmEdit` / `onSuggestionRequest` / `onSpeakerChange` / `onRevert`）を抑止する」セグメント単位の判定を追加する。既存の session-wide `isReadOnly`（`COMPLETED`）と OR 合成し、「`isReadOnly || segment.consensusStatus === 'CONFIRMED'`」で当該セグメントの編集を無効化する。SegmentEditor は現状どおりハンドラの有無で編集可否を表現する（props 契約を変えずに済む）。

**File（整合確認のみ・必要に応じて変更）**: `frontend/src/pages/ReviewPage.tsx`

- `editingEnabled` / `suggestionEnabled` はセッション全体のフラグとして残しつつ、`TranscriptionEditor` へ渡す per-segment の編集ハンドラを、当該セグメントが `CONFIRMED` のとき `undefined` にする（または TranscriptionEditor / SegmentEditor でセグメントの `consensusStatus` を見て抑止する）。どちらに読み取り専用判定を置くかは実装時に最小差分で決める。バックエンド（`get-segments`）および `Segment` 型の変更は不要。

## Testing Strategy

### Validation Approach

テスト戦略は二段階で行う。まず、未修正コード上でバグを再現する反例を顕在化させ、根本原因分析を確認する。次に、修正が確定済みセグメントで正しく動作し、未確定セグメントの既存挙動を保存することを検証する。テストは `frontend/`（Vitest + React Testing Library + fast-check、各コンポーネントテストで vitest-axe による `toHaveNoViolations()` を含める）で実施する。

### Exploratory Bug Condition Checking

**Goal**: 修正実装前に、バグを示す反例を顕在化させる。根本原因分析（`consensusStatus` 未参照の無条件上書き）を確認する。反証された場合は再仮説を立てる。

**Test Plan**: `ReviewPageWrapper` もしくは `segments` 導出ロジックに対し、`CONFIRMED` セグメントと個人 Correction（`appliedText`）を与え、表示テキストを検証するテストを書く。未修正コードで実行し、確定テキストではなく個人 `afterText`（または素の `originalText`）が表示される失敗を観測する。

**Test Cases**:
1. **CONFIRMED + 個人 Correction あり**: `consensusStatus = 'CONFIRMED'`, `consensusText = "確定された正答"`, 個人 `afterText = "私個人の修正"` のとき、表示が "確定された正答" であることを検証（未修正コードでは "私個人の修正" となり失敗する）。
2. **CONFIRMED + 個人 Correction なし**: `consensusStatus = 'CONFIRMED'`, `consensusText = "確定本文"`, 個人 Correction なしのとき、表示が "確定本文" であることを検証（未修正コードでは素の `originalText` となり失敗する）。
3. **CONFIRMED の読み取り専用**: `CONFIRMED` セグメントに対し編集系ハンドラが抑止され、クリックでインライン編集に入らない／候補・話者変更・revert が提示されないことを検証（未修正コードでは編集可能となり失敗しうる）。
4. **CONFIRMED + 話者変更の無視**: `CONFIRMED` セグメントに個人の単一話者変更・一括リネームが存在しても確定テキスト表示が優先され、話者起因の上書きが行われないことを検証（Edge case）。

**Expected Counterexamples**:
- `CONFIRMED` セグメントの表示テキストが `consensusText` ではなく個人 `afterText` / 素の `originalText` になる。
- 原因候補: `segments` useMemo が `consensusStatus` を参照せず `appliedText` を無条件に `originalText` へ上書きしている。

### Fix Checking

**Goal**: Bug Condition が成立するすべての入力に対し、修正後の解決が期待挙動を満たすことを検証する。

**Pseudocode:**
```
FOR ALL segment WHERE isBugCondition(segment) DO
  display := resolveDisplay_fixed(segment, personalCorrections)
  ASSERT display.text = segment.consensusText
  ASSERT display.readOnly = true
  ASSERT display.text ≠ personalCorrection(segment).afterText
END FOR
```

### Preservation Checking

**Goal**: Bug Condition が成立しないすべての入力に対し、修正後の解決が修正前と同一の結果を生成することを検証する。

**Pseudocode:**
```
FOR ALL segment WHERE NOT isBugCondition(segment) DO
  ASSERT resolveDisplay_original(segment, personalCorrections)
       = resolveDisplay_fixed(segment, personalCorrections)
END FOR
```

**Testing Approach**: 保存検証には fast-check によるプロパティベーステストを推奨する。理由は以下:
- 入力領域全体にわたり多数のテストケースを自動生成できる。
- 手動の単体テストが見落とすエッジケース（空の Correction、連鎖リネーム、`CONFLICT` と `UNDECIDED` の混在）を捕捉できる。
- 未確定セグメントの挙動が全入力で不変であることを強く保証する。

**Test Plan**: まず未修正コードで `UNDECIDED` / `CONFLICT` セグメントの表示（個人 Correction 復元・話者変更反映）を観測し、その挙動を捉えるプロパティベーステストを書く。修正後も同一結果になることを検証する。

**Test Cases**:
1. **UNDECIDED 個人 Correction 復元保存**: 未修正コードで `afterText` 復元を観測し、修正後も同一であることを検証。
2. **CONFLICT 個人 Correction 復元保存**: 同上を `CONFLICT` で検証。
3. **話者ラベル変更保存**: 未確定セグメントに対する単一話者変更・一括リネーム（連鎖含む）の反映が修正後も不変であることを検証。
4. **全未確定セッションの既存フロー保存**: 全セグメントが未確定のセッションで、復元・編集・候補・検索・アンドゥ・修正前に戻す操作が従来どおり提供されることを検証。

### Unit Tests

- `segments` 表示解決の `CONFIRMED` 分岐（`consensusText` 採用、個人 Correction 無視）のテスト。
- `consensusText` 欠落の `CONFIRMED` セグメントで素の `originalText` を表示し個人 Correction で上書きしないエッジケース。
- `UNDECIDED` / `CONFLICT` での個人 Correction 復元・話者変更反映の継続動作テスト。
- `CONFIRMED` セグメントの読み取り専用（編集系ハンドラ抑止）と、`COMPLETED` session-wide 読み取り専用との整合テスト。
- 各コンポーネントテストで `expect(container).toHaveNoViolations()`（vitest-axe）を含める。

### Property-Based Tests

- `consensusStatus` / `consensusText` / 個人 Correction の有無をランダム生成し、`CONFIRMED` では常に `consensusText`（存在時）が表示され個人結果で上書きされないこと（Fix Checking / Property 1）を検証。
- ランダムなセグメント集合・Correction 集合に対し、非 `CONFIRMED` セグメントの表示が修正前後で同一であること（Preservation / Property 2）を検証。
- ランダムな話者リネーム列（連鎖含む）で、未確定セグメントの話者解決が不変であることを検証。

### Integration Tests

- 強制確定（force confirm）後に一部セグメントが `CONFIRMED`、残りが `UNDECIDED` / `CONFLICT` のセッションを校閲画面で開き、確定済みは `consensusText` を読み取り専用で、未確定は個人 Correction を編集可能で表示する全体フローを検証。
- `CONFIRMED` と非 `CONFIRMED` が混在するセッションで、確定済みのみ編集抑止され未確定は従来どおり編集・候補・話者変更・revert できることを検証。
- `COMPLETED` セッション（session-wide 読み取り専用）と `CONFIRMED` セグメント（per-segment 読み取り専用）の両条件が重なった場合も確定テキストが読み取り専用で表示されることを検証。
