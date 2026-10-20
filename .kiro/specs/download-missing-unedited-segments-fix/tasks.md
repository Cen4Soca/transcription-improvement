# Implementation Plan

> NOTE: ユーザー指示により探索/Preservation の PBT 追加はスキップ。download-service の generateJson/generateSrt からフィルタと空ガードを撤廃し、全セグメント出力（CONFIRMED は consensusText、他は originalText）に修正。既存 download-service テストを新挙動へ更新し、全テスト（1285 passed）で検証済み。

- [x] 1. バグ条件の探索テストを作成する（修正前）
  - **Property 1: Bug Condition** - 非 CONFIRMED セグメントの欠落・全未修正時のエラー
  - **CRITICAL**: このテストは未修正コードで FAIL しなければならない。失敗がバグの存在を裏付ける。
  - **DO NOT attempt to fix the test or the code when it fails** — この段階ではコード修正を行わない。
  - **NOTE**: このテストは期待挙動を符号化しており、修正後に PASS することで Fix を検証する。
  - **GOAL**: バグを示す反例（非 CONFIRMED セグメントの欠落、全未修正時のバリデーションエラー）を表面化させる。
  - **Scoped PBT Approach**: 決定的なバグのため、プロパティを具体的な失敗ケースにスコープする（design「Bug Condition」/ `isBugCondition(session) = EXISTS s WHERE s.consensusStatus <> 'CONFIRMED'`）。
  - テスト配置: `backend/src/services/download-service.property.test.ts`（既存があれば追記、無ければ新規）。`getSessionSegments` の DynamoDB アクセスと `sessionRepository.getSessionById` を `vi.mock()` でモックする。
  - テストケース（design「Exploratory Bug Condition Checking」より）:
    - 部分未修正（JSON）: 3 セグメント（1=`UNDECIDED`, 2=`CONFIRMED`, 3=`CONFLICT`）で `generateJson` を呼び、`output.segments.length === 3` を期待（未修正コードでは 1 件に落ちて失敗する）。
    - 部分未修正（SRT）: 同構成で `generateSrt` を呼び、連番 1〜3 の 3 ブロックを期待（未修正コードでは 1 ブロックのみで失敗する）。
    - 全未修正（JSON）: 全セグメント `UNDECIDED` で `generateJson` を呼び、全セグメントが `originalText` で出力されることを期待（未修正コードでは「確定済みの Segment がありません。」で失敗する）。
  - Property 対象: 1 つでも非 CONFIRMED を含むセッションに対し、全セグメントが含まれ、CONFIRMED は `consensusText`、それ以外は `originalText`、`startTime` 昇順で出力される（design「Correctness Properties」Property 1 のアサーションに一致させる）。
  - **EXPECTED OUTCOME**: テストが FAIL する（バグの存在を証明する正しい結果）。
  - 見つかった反例を文書化する（例: 「3 セグメント中 2 のみが出力され、1 と 3 が欠落」「全 `UNDECIDED` でバリデーションエラー」）。根本原因（`filterConfirmedSegments` による除外・`confirmedSegments.length === 0` ガード）を裏付ける。
  - テストを書いて実行し、失敗を文書化した時点でタスク完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

- [x] 2. 保全プロパティテストを作成する（修正前）
  - **Property 2: Preservation** - 全 CONFIRMED セッションの出力不変
  - **IMPORTANT**: observation-first（観測優先）方法論に従う。まず未修正コードを非バグ入力（全 `CONFIRMED`）で実行し、実際の出力を観測・記録してからテストを書く。
  - テスト配置: `backend/src/services/download-service.property.test.ts`（Property 1 と同ファイル）。`getSessionSegments` / `getSessionById` / `getCorrections` を `vi.mock()` でモックする。
  - 観測（未修正コード上）:
    - 全 `CONFIRMED` セッションで `generateJson` が各セグメントを `consensusText`（= `getSessionSegments` 解決済み `text`）で出力することを観測。
    - JSON 構造（`sessionName` / `exportedAt` / 各セグメントの `startTime`/`endTime`/`text`/ 存在時のみ `speakerLabel`）を観測（design 3.3）。
    - SRT 構造（連番 / `HH:MM:SS,mmm --> HH:MM:SS,mmm` / 話者ラベル存在時は `[label] text`）を観測（design 3.4）。
    - 話者ラベル修正（`SPEAKER` / `SPEAKER_RENAME`）が全出力セグメントに適用され続けることを観測（design 3.2）。
    - 存在しないセッション ID で `NOT_FOUND` が返ることを観測（design 3.6）。
  - fast-check で全 `CONFIRMED` セッションを生成するプロパティテストを書く（`NOT isBugCondition(session)` ⇒ 全 CONFIRMED）。観測した出力パターン（テキスト・タイミング・話者ラベル・JSON/SRT 構造）が保持されることをアサートする。
  - `{ numRuns: 100 }` を使用。describe ブロックは「Feature: download-missing-unedited-segments-fix, Property 2: Preservation」を参照する。
  - **EXPECTED OUTCOME**: テストが PASS する（保全すべきベースライン挙動を確認）。
  - 未修正コード上でテストを書いて実行し、PASS した時点でタスク完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. ダウンロード時の未修正セグメント欠落を修正する

  - [x] 3.1 フィルタを撤廃し空ガードを調整する
    - `backend/src/services/download-service.ts` の `generateJson` / `generateSrt` 内から `filterConfirmedSegments(allSegments)` の呼び出しを取り除き、`allSegments` をそのまま出力対象にする。`getSessionSegments` が既に `consensusText ?? originalText` を解決済みのため、非 CONFIRMED は自動的に `originalText` で出力される。
    - 対象変数名を意味に合わせて `confirmedSegments` → `outputSegments`（または `segments`）へ改名する。
    - 空判定を「確定済みが 0 件」から「セグメントが 0 件」へ変更する。`validationError('確定済みの Segment がありません。')` のスローを削除し、`allSegments.length === 0` の場合はエラーを投げず空出力（JSON は `segments: []`、SRT は空文字列）をフォールバックとして返す。
    - `applySpeakerCorrections` は、フィルタ撤廃後の全セグメント配列に対して従来どおり適用する（適用ロジックは変更しない）。
    - `filterConfirmedSegments` は呼び出し元が無くなる。テスト依存を確認したうえで、不要であれば削除し関連テストを整理する。
    - `generateJson` / `generateSrt` の JSDoc から「filters to confirmed segments only」および `NO_CONFIRMED_SEGMENTS` に関する記述を削除し、「全セグメントを含め、未修正/競合は元テキストで出力する」旨に更新する。
    - _Bug_Condition: isBugCondition(session) = EXISTS s IN session.segments WHERE s.consensusStatus <> 'CONFIRMED'_
    - _Expected_Behavior: 全セグメントを出力に含め、CONFIRMED は consensusText、それ以外は originalText、startTime 昇順（design Correctness Properties Property 1）_
    - _Preservation: design「Preservation Requirements」— CONFIRMED テキスト・話者ラベル適用・JSON/SRT 構造・ファイル名・NOT_FOUND を保全_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 バグ条件の探索テストが PASS することを検証する
    - **Property 1: Expected Behavior** - 非 CONFIRMED セグメントの欠落・全未修正時のエラー
    - **IMPORTANT**: タスク 1 と同じテストを再実行する（新しいテストを書かない）。タスク 1 のテストが期待挙動を符号化している。
    - このテストが PASS することで期待挙動（全セグメント包含・正しいテキストソース・`startTime` 昇順）が満たされたことを確認する。
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認）。
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 保全テストが依然 PASS することを検証する
    - **Property 2: Preservation** - 全 CONFIRMED セッションの出力不変
    - **IMPORTANT**: タスク 2 と同じテストを再実行する（新しいテストを書かない）。
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションが無いことを確認）。
    - 修正後も全テストが PASS することを確認する（CONFIRMED テキスト・話者ラベル適用・JSON/SRT 構造・ファイル名・`NOT_FOUND` が不変）。
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. チェックポイント - 全テストが PASS することを確認する
  - `cd backend && npx vitest --run` を実行し、ユニット・プロパティテストが全て PASS することを確認する。
  - Property 1（Fix Checking）と Property 2（Preservation Checking）の両方が PASS していることを確認する。
  - 疑問が生じた場合はユーザーに確認する。
