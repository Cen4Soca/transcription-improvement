# Speaker Correction Save Fix Bugfix Design

## Overview

校閲画面（ReviewPage）で Reviewer が話者ラベルを変更しても永続化されず、ReviewSession の再読み込みで変更前に戻ってしまうバグを修正する。

Correction 保存・復元の全経路（フロント `handleSpeakerChange` / `handleSpeakerRename` → `CorrectionApi` → `post-corrections` handler → `correction-service.validateCorrectionInput` / `createCorrection` → `correction-repository.saveCorrection`、および復元経路 `get-corrections` → `correction-repository.getCorrections` → `App.tsx` の復元マージ）を実コードで精査した結果、**根本原因はバックエンドの入力バリデーション `validateCorrectionInput` にある**ことが特定できた。

`validateCorrectionInput` は `segmentId` を次のガードで必須検証する:

```typescript
if (!input.segmentId || typeof input.segmentId !== 'string') {
  throw validationError('segmentId は必須です。');
}
```

一方、フロントの `handleSpeakerRename`（`SPEAKER_RENAME`）は話者ラベルの一括変更であり特定の 1 セグメントに紐づかないため、保存要求で `segmentId: ''`（空文字列）を送る。`!''` は `true` と評価されるため、このガードが空文字列を「欠落」とみなして 400 `VALIDATION_ERROR` を投げ、保存要求はリポジトリに到達する前に拒否される。フロント側では `handleSaveCorrection` が `!result.ok` を受けて `false` を返し、ローカルの表示状態更新（`setSpeakerRenames`）もスキップされる。結果として一括リネームは一切保存されず、再読み込み後も反映されない（Req 1.2）。

修正方針は、話者変更に `segmentId` が不要なケース（特に `SPEAKER_RENAME`）でバリデーションがリクエストを破棄しないようにすること。空文字列を「欠落」と誤判定しない形に `segmentId` 検証を正すことを最小の修正とする。この変更は保存リクエストを通過させるだけであり、`beforeSpeaker` / `afterSpeaker` を運ぶ既存コード（handler, service, repository, restore）は全経路で正しく機能していることを確認済みのため、他の修正は要しない見込み。テキスト本文修正（`TEXT`）・単一話者変更（`SPEAKER`、実在の `segmentId` を送る）・冪等再送など話者一括変更以外の挙動には影響を与えない。

## Glossary

- **Bug_Condition (C)**: バグを引き起こす条件。話者ラベルを実際に変更する保存要求（`correctionType` が `SPEAKER` または `SPEAKER_RENAME` で、`afterSpeaker` が定義済みかつ `beforeSpeaker ≠ afterSpeaker`）。
- **Property (P)**: C(X) を満たす入力に対する期待挙動。話者変更が `beforeSpeaker` / `afterSpeaker` を含む `Correction` として永続化され、GET 復元時に同一値で返り、ReviewSession 再読み込み後も反映され続ける。
- **Preservation**: 修正により変わってはならない既存挙動。テキスト本文修正、実在 `segmentId` を持つ非話者修正、`beforeSpeaker = afterSpeaker` の実質変更なし再選択、冪等再送、セッションステータス更新・監査ログ・Consensus 集約イベント発行、COMPLETED セッションの読み取り専用化。
- **validateCorrectionInput**: `backend/src/services/correction-service.ts` のバリデーション関数。リクエストボディを検証し `CreateCorrectionInput` を返す。`SPEAKER_RENAME` の空 `segmentId` を「欠落」と誤判定してリクエストを破棄している箇所。
- **createCorrection**: `backend/src/services/correction-service.ts` の永続化オーケストレーション関数。検証済み入力から `CorrectionRecord` を構築し `saveCorrection` を呼ぶ。
- **saveCorrection**: `backend/src/repositories/correction-repository.ts` の DynamoDB 書き込み。`beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` を Item に含める。
- **getCorrections**: `backend/src/repositories/correction-repository.ts` の DynamoDB 読み出し。保存した話者フィールドを含めて `CorrectionRecord[]` を返す。
- **handleSpeakerChange / handleSpeakerRename**: `frontend/src/pages/ReviewPage.tsx` の話者変更確定ハンドラ。前者は実在 `segmentId`、後者は `segmentId: ''` で保存要求を送る。
- **復元マージ (restore merge)**: `frontend/src/App.tsx` が `listCorrections` の結果を `appliedText` / `appliedSpeaker` / `speakerRenames` に畳み込み、`segments` に反映する `useMemo` ロジック。
- **removeUndefinedValues**: `backend/src/utils/dynamodb-client.ts` の marshall オプション。`undefined` の `beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` を書き込み時に除去する（`null` 化しない）。

## Bug Details

### Bug Condition

バグは、Reviewer が話者ラベルを実際に変更する保存要求を発行したときに顕在化する。確定済みの根本原因は、バックエンドの `validateCorrectionInput` が `segmentId` の空文字列を「欠落」と誤判定し、話者一括変更（`SPEAKER_RENAME`、`segmentId = ''`）の保存要求を永続化前に 400 で破棄することである。単一話者変更（`SPEAKER`）については実在の `segmentId` が送られるため、この誤判定による破棄は発生しない経路になっており、1.1 の不具合が別要因か否かは探索テストで確認・反証する。

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type CorrectionSaveRequest
  OUTPUT: boolean

  // 話者ラベルを実際に変更する保存要求であること
  RETURN (X.correctionType = 'SPEAKER' OR X.correctionType = 'SPEAKER_RENAME')
         AND X.afterSpeaker IS DEFINED
         AND X.beforeSpeaker <> X.afterSpeaker
         AND NOT persistedAndRestored(X)   // 保存リクエスト・バリデーション・永続化・
                                           // 復元のいずれかで話者フィールドが破棄される
END FUNCTION
```

### Examples

- **一括リネーム（確定済み原因）**: Reviewer が話者 `spk_0` を `Tanaka` に一括変更（`SPEAKER_RENAME`、`segmentId=''`、`beforeSpeaker='spk_0'`、`afterSpeaker='Tanaka'`）。期待: 保存され再読み込み後も全対象セグメントが `Tanaka` 表示。実際: `validateCorrectionInput` が `!'' === true` により 400 を返し保存されず、再読み込みで `spk_0` に戻る。
- **単一話者変更（要確認）**: Reviewer がセグメントの話者を `spk_0` → `spk_1` に変更（`SPEAKER`、実在 `segmentId`、`afterSpeaker='spk_1'`）。期待: 保存され再読み込み後も `spk_1` 表示。精査したコード経路（validate → createCorrection → saveCorrection → getCorrections → App.tsx 復元）上は正しく機能するため、不具合が残る場合は別要因。探索テストで確認する。
- **実質変更なし（非バグ）**: Reviewer が同じ話者ラベルを選び直す（`beforeSpeaker = afterSpeaker`）。期待: Correction を生成せず表示維持。`SegmentEditor` / `SpeakerLabel` が `newSpeaker !== beforeSpeaker` のときだけ確定を呼ぶため、そもそも保存要求が発行されない。
- **テキスト修正（非バグ, 保持対象）**: `TEXT` 修正は実在 `segmentId` を送るため従来どおり保存・復元される。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- テキスト本文修正（`correctionType = 'TEXT'`）の保存・復元が従来どおり動作する（Req 3.1）。
- 同一 `correctionId` の再送が冪等に扱われ、重複保存せず 200 を返す（Req 3.2、`saveCorrection` の条件式 `attribute_not_exists` による）。
- `beforeSpeaker = afterSpeaker` の実質変更なし再選択で Correction を生成しない（Req 3.3、フロントの `newSpeaker !== beforeSpeaker` ガード）。
- 初回 Correction で ReviewSession ステータスを PENDING → IN_PROGRESS に更新し、監査ログを記録し、Consensus 集約イベントを発行する（Req 3.4）。
- COMPLETED（読み取り専用）セッションでは話者ラベル編集 UI を無効化し変更を受け付けない（Req 3.5、`assertSessionEditable` と `editingEnabled` ガード）。

**Scope:**
C(X) を満たさない入力（¬C(X)）はすべて本修正の影響を受けないこと。具体的には:
- テキスト本文修正（`TEXT`）
- 実在する `segmentId` を伴う非話者修正
- 実質的な変更のない話者再選択（`beforeSpeaker = afterSpeaker`）
- 同一 `correctionId` の冪等再送

**Note:** 話者変更に対する正しい期待挙動（永続化と復元）は Correctness Properties の Property 1 で定義する。本節は「変えてはならない挙動」に焦点を当てる。

## Hypothesized Root Cause

実コード精査に基づく原因分析。

1. **【確定】`segmentId` バリデーションの空文字列誤判定**: `validateCorrectionInput` の `if (!input.segmentId || typeof input.segmentId !== 'string')` が空文字列を「欠落」と誤判定する。
   - `SPEAKER_RENAME` は特定セグメントに紐づかないためフロントが `segmentId: ''` を送る（`ReviewPage.handleSpeakerRename`）。
   - `!'' === true` のため 400 `VALIDATION_ERROR('segmentId は必須です。')` が投げられ、リクエストは `createCorrection` / `saveCorrection` に到達しない。
   - 既存のサービス単体テストは `...validInput`（`segmentId: 'seg-001'`）を流用しており、実際に空 `segmentId` の `SPEAKER_RENAME` を検証していないため、このバグが見逃されていた。

2. **【反証済み】話者フィールドの運搬欠落**: handler / service / repository / restore は `beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` を全経路で引き継ぐことをコードで確認。`CorrectionRecord` と `Correction` 型の両方にフィールドが定義され、`saveCorrection` が Item に含め、`getCorrections` が読み戻し、`App.tsx` が `appliedSpeaker` / `speakerRenames` に畳み込む。ここは原因ではない。

3. **【反証済み】`removeUndefinedValues` / 空文字列の扱い**: `dynamodb-client.ts` の `removeUndefinedValues: true` は `undefined` のフィールドを除去するのみで、定義済みの話者文字列（空文字含む）には影響しない。話者変更時は `afterSpeaker` に実値が入るため除去対象外。`null` 化もしない。ここは原因ではない。

4. **【要確認】単一 `SPEAKER` の別要因**: 単一話者変更の経路はコード上破綻が見当たらない。1.1 の不具合が実在する場合、UI 条件（`speakerEditable` ガード）や `App.tsx` 復元の順序など別要因の可能性を探索テストで確認・反証する。

## Correctness Properties

Property 1: Bug Condition - 話者変更の永続化と復元

_For any_ バグ条件を満たす入力（`isBugCondition` が true、すなわち `correctionType` が `SPEAKER` または `SPEAKER_RENAME` で `afterSpeaker` が定義済みかつ `beforeSpeaker ≠ afterSpeaker`）に対して、修正後の保存処理 SHALL その話者変更を `beforeSpeaker` / `afterSpeaker`（`SPEAKER_RENAME` では該当する `affectedSegmentCount` を含む）を伴う `Correction` として永続化し、`SPEAKER_RENAME` のように `segmentId` が空のケースでもバリデーションで破棄せず、GET 復元時に同一の `correctionType` / `beforeSpeaker` / `afterSpeaker` で返し、ReviewSession 再読み込み後も変更後の話者ラベルを表示し続ける。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - 話者変更以外の挙動

_For any_ バグ条件を満たさない入力（`isBugCondition` が false。テキスト本文修正、実質変更のない話者再選択、冪等再送、実在 `segmentId` を伴う非話者修正を含む）に対して、修正後のコード SHALL 修正前のコードと同一の結果を生成し、テキスト修正の保存・復元、冪等性、セッションステータス更新・監査ログ・Consensus イベント発行、COMPLETED セッションの読み取り専用化を含む既存挙動を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

根本原因分析が正しいことを前提とした修正。

**File**: `backend/src/services/correction-service.ts`

**Function**: `validateCorrectionInput`

**Specific Changes**:
1. **`segmentId` 検証の空文字列許容**: `!input.segmentId` による falsy 判定をやめ、「文字列であること」を要件とする検証に正す。
   - 例: `if (typeof input.segmentId !== 'string')` に変更し、空文字列を有効値として通す。
   - `correctionId` など他の必須 ID 検証は変更しない（これらは常に非空であるため）。
2. **`SPEAKER_RENAME` の意味的整合**: `SPEAKER_RENAME` は `segmentId` を持たない一括操作であるため、空 `segmentId` を正当なケースとして明示的に許容する（上記 1 で達成される。必要なら JSDoc / コメントで意図を明記）。
3. **他経路は不変**: `createCorrection` / `saveCorrection` / `getCorrections` / handler / フロントの運搬・復元コードは変更不要（既に話者フィールドを正しく引き継ぐことを確認済み）。探索テストが単一 `SPEAKER` の別要因を示した場合のみ、該当箇所を追加修正する。

## Testing Strategy

### Validation Approach

テスト戦略は二段階アプローチを取る。まず未修正コード上でバグを示す反例を表面化させ、次に修正が正しく機能し既存挙動を保持することを検証する。バックエンドは Vitest + fast-check（`{ numRuns: 100 }`）、AWS SDK は `vi.mock()` でモックする。テストは原則コード同居（`correction-service.property.test.ts` / `correction-service.test.ts`）。

### Exploratory Bug Condition Checking

**Goal**: 修正実装前に、未修正コード上でバグを示す反例を表面化させる。根本原因分析を確証または反証する。反証された場合は再仮説立案が必要。

**Test Plan**: `validateCorrectionInput` に `SPEAKER_RENAME` かつ `segmentId: ''` の入力を与え、400 `VALIDATION_ERROR` が投げられること（＝リクエストが破棄されること）を未修正コードで観測する。あわせて単一 `SPEAKER`（実在 `segmentId`）の経路で保存・復元が成立するかを観測し、1.1 の別要因有無を確認する。

**Test Cases**:
1. **SPEAKER_RENAME 空 segmentId 破棄**: `correctionType='SPEAKER_RENAME'`、`segmentId=''`、`beforeSpeaker='spk_0'`、`afterSpeaker='Tanaka'` を `validateCorrectionInput` に与えると `'segmentId は必須です。'` を投げる（未修正コードで失敗＝破棄を実証）。
2. **SPEAKER_RENAME 保存されない**: handler/service 経路で空 `segmentId` の `SPEAKER_RENAME` を送ると `saveCorrection` が呼ばれず、GET で復元できない（未修正コードで失敗）。
3. **単一 SPEAKER 保存・復元の観測**: 実在 `segmentId` の `SPEAKER` を保存し GET で `afterSpeaker` が返るかを観測する（別要因の確認・反証）。
4. **Edge Case - affectedSegmentCount 伝播**: `SPEAKER_RENAME` の `affectedSegmentCount` が保存・復元で保持されるかを観測する。

**Expected Counterexamples**:
- `validateCorrectionInput({correctionType:'SPEAKER_RENAME', segmentId:'', ...})` が例外を投げ、話者一括変更が永続化されない。
- 原因: `!input.segmentId` による空文字列の誤判定。

### Fix Checking

**Goal**: バグ条件を満たすすべての入力について、修正後の処理が期待挙動を生むことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  saveCorrection'(X)                       // F': 修正後の保存処理
  restored := listCorrections'(X.sessionId)
  c := findBy(restored, X.correctionId)
  ASSERT c IS DEFINED
         AND c.correctionType = X.correctionType
         AND c.beforeSpeaker = X.beforeSpeaker
         AND c.afterSpeaker  = X.afterSpeaker
END FOR
```

### Preservation Checking

**Goal**: バグ条件を満たさないすべての入力について、修正後の処理が修正前と同一の結果を生むことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT validateCorrectionInput_original(X) = validateCorrectionInput_fixed(X)
  ASSERT F(X) = F'(X)   // TEXT 修正・冪等再送・実質変更なし再選択の結果が不変
END FOR
```

**Testing Approach**: プロパティベーステストを推奨する。理由:
- 入力ドメイン全体にわたり多数のテストケースを自動生成する。
- 手動単体テストが見逃すエッジケースを捕捉する。
- 非バグ入力すべてで挙動が不変であるという強い保証を与える。

**Test Plan**: 未修正コードでまず `TEXT` 修正・冪等再送・`beforeSpeaker = afterSpeaker` 再選択の挙動を観測し、その挙動を捕捉するプロパティテストを書く。修正後も同一結果であることを確認する。

**Test Cases**:
1. **TEXT 保存・復元の保持**: 実在 `segmentId` の `TEXT` 修正が従来どおり検証を通過し保存・復元される（未修正コードで観測 → 修正後も不変）。
2. **冪等再送の保持**: 同一 `correctionId` 再送が 200 を返し重複保存しない（未修正コードで観測 → 修正後も不変）。
3. **実質変更なし再選択の保持**: `beforeSpeaker = afterSpeaker` で Correction が生成されない（フロントガードの挙動を未修正コードで観測 → 修正後も不変）。
4. **他必須フィールド検証の保持**: `correctionId` 欠落・不正 `correctionType`・非文字列 `beforeText`/`afterText` が従来どおり拒否される。

### Unit Tests

- `validateCorrectionInput`: `SPEAKER_RENAME` + 空 `segmentId` が通過し、`beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` を保持することを検証。
- `validateCorrectionInput`: 単一 `SPEAKER`（実在 `segmentId`）が従来どおり通過することを検証。
- `validateCorrectionInput`: `correctionId` 欠落、不正 `correctionType`、非文字列 `beforeText`/`afterText` を拒否する既存検証が不変であることを検証。
- `createCorrection`: `SPEAKER` / `SPEAKER_RENAME` 入力から構築した `CorrectionRecord` が話者フィールドを含めて `saveCorrection` に渡ることを検証（SDK はモック）。

### Property-Based Tests

- Property 1（Fix Checking）: `isBugCondition` を満たす入力（`SPEAKER` / `SPEAKER_RENAME`、`beforeSpeaker ≠ afterSpeaker`、`SPEAKER_RENAME` では空 `segmentId` を含む）を fast-check で生成し、`validateCorrectionInput → createCorrection`（repository をモック）で話者フィールドが欠落なく運ばれ、`getCorrections` モック経由で同一値が復元されることを検証。
- Property 2（Preservation Checking）: `isBugCondition` を満たさない入力（`TEXT` 修正、実在 `segmentId` の非話者修正、`beforeSpeaker = afterSpeaker`）を生成し、修正前後で `validateCorrectionInput` の戻り値と保存結果が一致することを検証。
- 既存の `correction-service.property.test.ts` / `correction-repository.property.test.ts` が引き続き通過することを確認。

### Integration Tests

- `backend/src/__tests__/integration/`（LocalStack）で、`SPEAKER_RENAME`（空 `segmentId`）を POST → DynamoDB 保存 → GET 復元の往復で `beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` が同一値で返ることを検証。
- 単一 `SPEAKER` の POST → GET 往復で `afterSpeaker` が保持されることを検証。
- `TEXT` 修正の往復が従来どおり成立することを検証（リグレッション防止）。
- フロント統合（`frontend` の Vitest + RTL、`MemoryRouter` ラップ、各コンポーネントテストで `vitest-axe` の `toHaveNoViolations()`）で、`handleSpeakerRename` → `onSaveCorrection` 成功時に `speakerRenames` が更新され表示に反映されること、再読み込み相当の `listCorrections` 復元で話者ラベルがマージされることを検証。
