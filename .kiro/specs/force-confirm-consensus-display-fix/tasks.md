# Implementation Plan

> NOTE: ユーザー指示により探索/Preservation の PBT 追加はスキップ。App.tsx の segments useMemo に CONFIRMED 分岐を追加（consensusText を表示、個人 Correction を上書きしない）、TranscriptionEditor で CONFIRMED セグメントの編集系ハンドラを per-segment 抑止（読み取り専用）。TranscriptionEditor に読み取り専用の回帰テストを追加し、フロント全テスト（1167 passed）で検証済み。

- [x] 1. バグ条件の探索テストを作成する（修正実装の前に実施）
  - **Property 1: Bug Condition** - 確定済みセグメントは確定テキストを読み取り専用で表示する
  - **IMPORTANT**: このプロパティベーステストは修正を実装する前に書くこと
  - **CRITICAL**: このテストは未修正コードで必ず FAIL する。失敗こそがバグの存在を証明する
  - **DO NOT**: テストが失敗してもテストやコードを修正しようとしないこと
  - **NOTE**: このテストは期待挙動をエンコードしており、修正後に PASS することで修正を検証する
  - **GOAL**: バグの存在を示す反例を顕在化させ、根本原因（`segments` useMemo が `consensusStatus` を参照せず個人 Correction を無条件に上書きしている）を確認する
  - **Scoped PBT Approach**: 決定論的バグのため、プロパティを具体的な失敗ケースにスコープする。`consensusStatus = 'CONFIRMED'` のセグメントに対し、`consensusText` と任意の個人 `afterText`（有無両方）を fast-check で生成する
  - テスト対象: `frontend/src/App.tsx` の `ReviewPageWrapper` 内 `segments` 表示解決ロジック（design の Bug Condition `isBugCondition(segment) = (segment.consensusStatus === 'CONFIRMED')`）
  - テストファイル配置: `frontend/src/App.property.test.tsx`（Vitest + React Testing Library + fast-check）
  - 各コンポーネントテストで `expect(container).toHaveNoViolations()`（vitest-axe）を含める
  - Test Case 1 — CONFIRMED + 個人 Correction あり: `consensusStatus = 'CONFIRMED'`, `consensusText = "確定された正答"`, 個人 `afterText = "私個人の修正"` のとき、表示テキストが "確定された正答" であることをアサート（未修正コードでは "私個人の修正" となり FAIL する）
  - Test Case 2 — CONFIRMED + 個人 Correction なし: `consensusStatus = 'CONFIRMED'`, `consensusText = "確定本文"`, 個人 Correction なしのとき、表示テキストが "確定本文" であることをアサート（未修正コードでは素の `originalText` となり FAIL する）
  - Test Case 3 — CONFIRMED の読み取り専用: `CONFIRMED` セグメントがクリックでインライン編集に入らず、修正候補・話者変更・revert が提示されないことをアサート（未修正コードでは編集可能となり FAIL しうる）
  - テストのアサーションは design の Correctness Properties の Property 1（`display.text = consensusText` かつ `display.readOnly = true` かつ `display.text ≠ personalCorrection.afterText`）に一致させる
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストが FAIL する（これが正しい。バグの存在を証明する）
  - 発見した反例を記録して根本原因を理解する（例: "CONFIRMED セグメントの表示が consensusText ではなく個人 afterText になる"）
  - テストを書き、実行し、失敗を記録した時点でタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. 保存プロパティテストを作成する（修正実装の前に実施）
  - **Property 2: Preservation** - 未確定セグメントの個人結果復元は不変
  - **IMPORTANT**: observation-first（観測優先）方法論に従う
  - まず未修正コードで非バグ入力（`isBugCondition` が false、すなわち `consensusStatus` が `UNDECIDED` / `CONFLICT`）の挙動を観測・記録する
  - 観測: `UNDECIDED` セグメントで個人 `afterText` があればそれが、無ければ `originalText` が表示される
  - 観測: `CONFLICT` セグメントでも同様に個人 Correction が復元表示される
  - 観測: 未確定セグメントに対する単一話者変更（`appliedSpeaker`）・話者一括リネーム（`speakerRenames`、連鎖リネームの畳み込み含む）が表示に反映される
  - 観測した挙動を捉えるプロパティベーステストを `frontend/src/App.property.test.tsx` に書く（design の Preservation Requirements より）。ランダムなセグメント集合・Correction 集合・話者リネーム列（連鎖含む）を fast-check で生成し、非 `CONFIRMED` セグメントの表示が修正前後で同一であることを検証する形にする
  - プロパティ: `FOR ALL segment WHERE NOT isBugCondition(segment)` に対し、表示解決が「個人 `afterText` があればそれ、無ければ `originalText`、話者変更も従来どおり反映」と一致する（design の Preservation Checking 擬似コード）
  - `{ numRuns: 100 }` をデフォルトとする
  - 各コンポーネントテストで `expect(container).toHaveNoViolations()`（vitest-axe）を含める
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストが PASS する（保存すべきベースライン挙動を確認する）
  - テストを書き、実行し、未修正コードで通ることを確認した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. 確定済みセグメント表示上書きバグの修正

  - [x] 3.1 修正を実装する
    - `frontend/src/App.tsx` の `ReviewPageWrapper` 内 `segments` useMemo に CONFIRMED 分岐を追加する
    - 各セグメント変換の冒頭で `s.consensusStatus === 'CONFIRMED'` を判定する。真なら `consensusText`（存在時）を表示テキストとして `originalText` に設定し、個人 Correction（`appliedText`）・単一話者変更（`appliedSpeaker`）・話者一括リネーム（`speakerRenames`）の適用をスキップする
    - 例: `if (s.consensusStatus === 'CONFIRMED') { return s.consensusText !== undefined ? { ...s, originalText: s.consensusText } : s; }`
    - `consensusText` が欠落している CONFIRMED セグメントは素の `originalText` をそのまま表示し、個人 Correction で上書きしない
    - useMemo 冒頭の「`appliedText`/`appliedSpeaker`/`speakerRenames` がすべて空なら `baseSegments` を返す」早期 return ショートカットを見直す。空のときでも CONFIRMED で `consensusText` を適用する必要があるため、CONFIRMED 変換を常に通すよう map を無条件に実行する形へ単純化する
    - `UNDECIDED` / `CONFLICT` セグメントは現状の `appliedText` → `originalText` 上書き、`appliedSpeaker` / `speakerRenames` による話者解決をそのまま適用する（挙動不変）
    - CONFIRMED セグメントを読み取り専用として提示するため、`ReviewPage` 側で per-segment の編集系ハンドラ（`onStartEdit` / `onConfirmEdit` / `onSuggestionRequest` / `onSpeakerChange` / `onRevert`）を、当該セグメントが `CONFIRMED` のとき抑止する。既存の session-wide `isReadOnly`（`COMPLETED`）と OR 合成し、`isReadOnly || segment.consensusStatus === 'CONFIRMED'` で当該セグメントの編集を無効化する（`frontend/src/pages/ReviewPage.tsx`、最小差分で実装）
    - バックエンド（`get-segments`）および `Segment` 型の変更は不要
    - _Bug_Condition: isBugCondition(segment) = (segment.consensusStatus === 'CONFIRMED') from design_
    - _Expected_Behavior: expectedBehavior(result) — CONFIRMED は consensusText を表示テキストとし読み取り専用、個人 afterText で上書きしない（design Property 1）_
    - _Preservation: Preservation Requirements from design — UNDECIDED / CONFLICT の個人 Correction 復元・話者変更反映・編集フロー、COMPLETED session-wide 読み取り専用は不変_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 バグ条件の探索テストが PASS することを検証する
    - **Property 1: Expected Behavior** - 確定済みセグメントは確定テキストを読み取り専用で表示する
    - **IMPORTANT**: タスク 1 と同じテストを再実行する。新しいテストを書かないこと
    - タスク 1 のテストは期待挙動をエンコードしており、このテストが通ることで期待挙動が満たされたことを確認する
    - タスク 1 のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認する）
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 保存テストが引き続き PASS することを検証する
    - **Property 2: Preservation** - 未確定セグメントの個人結果復元は不変
    - **IMPORTANT**: タスク 2 と同じテストを再実行する。新しいテストを書かないこと
    - タスク 2 の保存プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションが無いことを確認する）
    - 修正後も全テストが通ること（リグレッションなし）を確認する
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. チェックポイント - 全テストが通ることを確認する
  - `cd frontend && npx vitest --run` を実行し、ユニット・プロパティ・アクセシビリティテストがすべて通ることを確認する
  - タスク 1 の探索テストが PASS、タスク 2 の保存テストが PASS していることを確認する
  - 疑問が生じた場合はユーザーに確認する
