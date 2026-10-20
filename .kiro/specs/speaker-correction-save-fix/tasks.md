# Implementation Plan

> NOTE: ユーザー指示によりタスク1・2（探索/Preservation の PBT）はスキップ。`validateCorrectionInput` の segmentId 検証を `typeof !== 'string'` に修正し、空 segmentId の SPEAKER_RENAME を受理する回帰ユニットテストを追加。correction-service の全テストで検証済み。

- [ ] 1. バグ条件探索テストを作成する（修正前に実施）
  - **Property 1: Bug Condition** - 話者変更の永続化と復元
  - **CRITICAL**: このテストは未修正コードで FAIL しなければならない。失敗がバグの存在を証明する
  - **DO NOT**: テストが失敗してもテストやコードを修正しようとしないこと
  - **NOTE**: このテストは期待挙動をエンコードしており、修正実装後に PASS することでフィックスを検証する
  - **GOAL**: バグの存在を示す反例（counterexample）を表面化させ、design の根本原因分析（`validateCorrectionInput` の `segmentId` 空文字列誤判定）を確証・反証する
  - **Scoped PBT Approach**: 決定的バグのため、`SPEAKER_RENAME` かつ `segmentId=''`、`beforeSpeaker='spk_0'`、`afterSpeaker='Tanaka'` という具体的な失敗ケースにプロパティをスコープして再現性を確保する。あわせて `afterSpeaker` を任意の非空文字列（`beforeSpeaker ≠ afterSpeaker`）に広げてバグ条件全域を生成する
  - ファイル: `backend/src/services/correction-service.property.test.ts`（既存ファイルに追記、同居テスト）
  - テスト内容（design の Bug Condition / Exploratory Bug Condition Checking より）:
    - **Test Case 1 - SPEAKER_RENAME 空 segmentId 破棄**: `validateCorrectionInput({ correctionType:'SPEAKER_RENAME', segmentId:'', beforeSpeaker:'spk_0', afterSpeaker:<任意の非空ラベル>, ... })` が `validationError('segmentId は必須です。')` を投げることを未修正コードで観測する（＝リクエストが永続化前に破棄される）
    - **Test Case 2 - SPEAKER_RENAME 保存されない**: handler/service 経路で空 `segmentId` の `SPEAKER_RENAME` を送ると `saveCorrection`（`vi.mock()` でモック）が呼ばれず、GET 復元で `afterSpeaker` が得られないことを観測する
    - **Test Case 3 - 単一 SPEAKER 保存・復元の観測**: 実在 `segmentId` の `SPEAKER`（`afterSpeaker='spk_1'`）を保存し `getCorrections` モック経由で `afterSpeaker` が返るかを観測し、Req 1.1 の別要因有無を確認・反証する
    - **Test Case 4 - Edge Case affectedSegmentCount 伝播**: `SPEAKER_RENAME` の `affectedSegmentCount` が保存・復元で保持されるかを観測する
  - テスト assertion は design の Expected Behavior Properties（Property 1: `correctionType` / `beforeSpeaker` / `afterSpeaker` が同一値で永続化・復元される）と一致させる
  - AWS SDK は `vi.mock()` でモックし、fast-check は `{ numRuns: 100 }` を使用する
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストが FAIL する（これが正しい挙動であり、バグの存在を証明する）
  - 発見した反例を記録して根本原因を理解する（例: `validateCorrectionInput({correctionType:'SPEAKER_RENAME', segmentId:''})` が `!'' === true` により 400 を投げ、話者一括変更が永続化されない）
  - テストを作成・実行し、失敗を記録した時点でタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. 保持（Preservation）プロパティテストを作成する（修正前に実施）
  - **Property 2: Preservation** - 話者変更以外の挙動
  - **IMPORTANT**: 観測優先（observation-first）方法論に従う。未修正コードで非バグ入力の挙動を観測し、その挙動を捕捉するプロパティテストを書く
  - ファイル: `backend/src/services/correction-service.property.test.ts`（既存ファイルに追記、同居テスト）
  - 観測対象（design の Preservation Requirements / Preservation Checking より。`isBugCondition` が false の入力 ¬C(X)）:
    - **Test Case 1 - TEXT 保存・復元の保持**: 実在 `segmentId` の `TEXT` 修正が未修正コードで検証を通過し、`createCorrection`（repository はモック）→ `getCorrections` モックで保存・復元されることを観測する（Req 3.1）
    - **Test Case 2 - 冪等再送の保持**: 同一 `correctionId` 再送が 200 を返し重複保存しないことを観測する（Req 3.2、`saveCorrection` の `attribute_not_exists` 条件式）
    - **Test Case 3 - 実質変更なし再選択の保持**: `beforeSpeaker = afterSpeaker` で `isBugCondition` が false となり Correction を生成しない挙動を観測する（Req 3.3）
    - **Test Case 4 - 他必須フィールド検証の保持**: `correctionId` 欠落・不正 `correctionType`・非文字列 `beforeText`/`afterText` が未修正コードで従来どおり拒否されることを観測する
  - 観測した挙動を捕捉するプロパティベーステストを書く（`isBugCondition` が false の入力ドメイン全域を fast-check で生成、`{ numRuns: 100 }`）。プロパティテストは多数のケースを自動生成し、非バグ入力すべてで挙動不変であるという強い保証を与える
  - あわせて初回 Correction でのセッションステータス PENDING → IN_PROGRESS 更新・監査ログ記録・Consensus イベント発行（Req 3.4）、COMPLETED セッションの読み取り専用化（Req 3.5）に対応する観測挙動を保持する
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストが PASS する（保持すべきベースライン挙動を確認）
  - テストを作成・実行し、未修正コードで通過することを確認した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. segmentId 空文字列誤判定バグの修正

  - [x] 3.1 修正を実装する
    - ファイル: `backend/src/services/correction-service.ts`、関数: `validateCorrectionInput`
    - `segmentId` 検証を `if (!input.segmentId || typeof input.segmentId !== 'string')` から `if (typeof input.segmentId !== 'string')` に変更し、空文字列を有効値として通す（`!input.segmentId` による falsy 誤判定を廃止）
    - `SPEAKER_RENAME` は特定セグメントに紐づかない一括操作であるため、空 `segmentId` を正当なケースとして明示的に許容する意図を JSDoc / コメントで明記する
    - `correctionId` など他の必須 ID 検証は変更しない（常に非空であるため）
    - `createCorrection` / `saveCorrection` / `getCorrections` / handler / フロントの運搬・復元コードは変更しない（話者フィールドを全経路で正しく引き継ぐことを design で確認済み）。ただしタスク 1 の探索テストが単一 `SPEAKER` の別要因を示した場合のみ、該当箇所を追加修正する
    - _Bug_Condition: isBugCondition(X) — X.correctionType ∈ {'SPEAKER','SPEAKER_RENAME'} AND X.afterSpeaker IS DEFINED AND X.beforeSpeaker ≠ X.afterSpeaker（特に SPEAKER_RENAME の segmentId='' が validateCorrectionInput で破棄されるケース）_
    - _Expected_Behavior: expectedBehavior(result) — 話者変更が beforeSpeaker / afterSpeaker（SPEAKER_RENAME では affectedSegmentCount を含む）を伴う Correction として永続化され、segmentId が空でもバリデーションで破棄されず、GET 復元時に同一値で返る（design Property 1）_
    - _Preservation: Preservation Requirements from design — TEXT 修正の保存・復元、冪等再送、beforeSpeaker=afterSpeaker 再選択、セッションステータス更新・監査ログ・Consensus イベント発行、COMPLETED セッション読み取り専用化を不変に保つ_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 バグ条件探索テストが PASS することを確認する
    - **Property 1: Expected Behavior** - 話者変更の永続化と復元
    - **IMPORTANT**: タスク 1 と同じテストを再実行する。新しいテストは書かないこと
    - タスク 1 のテストは期待挙動をエンコードしており、PASS することで Expected Behavior が満たされたことを確認する
    - タスク 1 のバグ条件探索テストを実行する（`SPEAKER_RENAME` 空 `segmentId` が検証を通過し、`beforeSpeaker` / `afterSpeaker` / `affectedSegmentCount` を保持して永続化・復元される）
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認）
    - 実行コマンド: `cd backend && npx vitest --run src/services/correction-service.property.test.ts`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 保持テストが引き続き PASS することを確認する
    - **Property 2: Preservation** - 話者変更以外の挙動
    - **IMPORTANT**: タスク 2 と同じテストを再実行する。新しいテストは書かないこと
    - タスク 2 の保持プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションがないことを確認）
    - 修正後も TEXT 修正の保存・復元、冪等性、`beforeSpeaker=afterSpeaker` 再選択、セッションステータス更新・監査ログ・Consensus イベント発行、COMPLETED セッション読み取り専用化がすべて不変であることを確認する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. チェックポイント - 全テストが PASS することを確認する
  - `cd backend && npx vitest --run` でバックエンドの全ユニット・プロパティテストが PASS することを確認する
  - 既存の `correction-service.property.test.ts` / `correction-service.test.ts` / `correction-repository.property.test.ts` が引き続き通過することを確認する
  - 疑問が生じた場合はユーザーに確認する
