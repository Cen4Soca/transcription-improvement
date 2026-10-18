# Implementation Plan: language-model-source-session-team-match

## Overview

CustomLanguageModel 作成時に、各ソース ReviewSession が TargetTeam に TeamAssignment として割り当てられていることをバックエンドで検証し、フロントの作成フォームでは候補セッションを割り当て済みのものだけに絞り込む。実装はサービス層とフロント層のみ（新規 Lambda・リポジトリ・CDK なし）。バックエンド検証 → バックエンドテスト → フロント API/UI → フロントテストの順で、各段階を `npx vitest --run` で検証する。

## Tasks

- [x] 1. バックエンド: createModel に TeamAssignment 一致検証ループを追加
  - [x] 1.1 `hasTeamAssignment` のインポートと検証ループの実装
    - `backend/src/services/language-model-service.ts` の `access-control-service.js` import 文に `hasTeamAssignment` を追加
    - `createModel` 内、既存の `checkSessionAccess` ループ直後（displayName バリデーションの前）に、各 `sessionId` を `hasTeamAssignment(teamId, sessionId)` で検証するループを追加
    - `isAdmin` 分岐の外に置き ADMIN にも適用（Req 1.5）
    - 最初の未割り当て検出時に `validationError` を throw（fail-fast）して中止。`message` は固定の日本語文字列、`details` は `Session {sessionId} is not assigned to team {teamId}` の英語文字列
    - 全件割り当て済みならループを抜けて既存の後続処理（displayName 検証 → トレーニングデータ生成 → S3 → Transcribe → putModel → 監査ログ）を継続
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1_

- [x] 2. バックエンド: createModel の検証テスト
  - [x] 2.1 `language-model-service.test.ts` にユニットテストを追記
    - `access-control-service.js` の `hasTeamAssignment` を `vi.mock()` でモック
    - 呼び出し順序: すべての `checkSessionAccess` 完了後に `hasTeamAssignment` が呼ばれ、いずれも `putModel` / Transcribe `CreateLanguageModelCommand` より前に実行されること（Req 1.4）
    - 失敗代表例: 2 件中 1 件が未割り当てのとき 400 `VALIDATION_ERROR` を投げ、`PutObjectCommand` / `CreateLanguageModelCommand` / `putModel` が呼ばれないこと（Req 1.2）
    - 成功代表例: 全件割り当て済みのとき検証を通過し後続処理へ進むこと（Req 1.6）
    - role ガード回帰: REVIEWER 呼び出しで 403 `FORBIDDEN`、下流未実行（Req 3.1）
    - エッジケース: `sessionIds` が空配列のとき検証ループは 0 回で通過すること
    - _Requirements: 1.2, 1.4, 1.6, 3.1_

  - [x] 2.2 `language-model-service.property.test.ts` に Property 1 を追記
    - **Property 1: TeamAssignment 一致ゲートは「全セッション割り当て済み」と同値（ロール非依存・エラー形状つき）**
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.6, 4.1**
    - `fc.record` で `{ role: ADMIN|TEAM_LEADER, sessionIds, assignedSubset }` を生成。全件 ⊆ `assignedSubset` のとき `putModel` 到達、そうでなければ 400 / `VALIDATION_ERROR`・固定日本語 `message`・`details` に `sessionId`/`teamId` を含み下流副作用なし。ADMIN でも同一挙動
    - `{ numRuns: 100 }`

  - [x] 2.3 `language-model-service.property.test.ts` に Property 2 を追記
    - **Property 2: 未割り当て検出時のフェイルファスト（短絡）**
    - **Validates: Requirements 1.3**
    - 少なくとも 1 つが未割り当ての順序付き `sessionIds` と「最初に失敗するインデックス」を生成。`hasTeamAssignment` の引数列を記録し、最後の問い合わせが最初の失敗要素で、それ以降の要素が一度も問い合わされないことを検証
    - `{ numRuns: 100 }`

- [x] 3. Checkpoint - バックエンドテストが通ることを確認
  - `cd backend && npx vitest --run` を実行し、すべてのテストが通ることを確認する
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. フロント: TeamAssignment 取得 API の追加
  - [x] 4.1 `language-model-api.ts` に `TeamAssignmentRecord` 型と `listTeamAssignments` メソッドを追加
    - `frontend/src/services/language-model-api.ts` に `TeamAssignmentRecord` インターフェース（`teamId` / `sessionId` / `createdBy` / `createdAt`）を追加
    - `LanguageModelApi` クラスに `listTeamAssignments(teamId)` を追加し、既存エンドポイント `GET /admin/teams/{teamId}/assignments` を呼ぶ（`teamId` を `encodeURIComponent`）。バックエンドは無変更
    - _Requirements: 2.1, 2.2_

- [x] 5. フロント: LanguageModelPage の候補絞り込みロジック
  - [x] 5.1 純粋ヘルパ `filterSessionsByAssignment` / `reconcileSelection` を export
    - `frontend/src/pages/LanguageModelPage.tsx` に 2 つの純粋関数を定義・`export`
    - `filterSessionsByAssignment(sessions, assignedSessionIds)`: 割り当て集合に含まれる `sessionId` のセッションのみ返す（Req 2.1）
    - `reconcileSelection(prevSelected, assignedSessionIds)`: 前回選択と割り当て集合の積集合を返す（Req 2.3）
    - _Requirements: 2.1, 2.3_

  - [x] 5.2 候補絞り込みの state・副作用・描画切り替えを実装
    - `assignedSessionIds` / `isLoadingAssignments` state を追加
    - `teamId` 変更時に `listTeamAssignments(teamId)` を呼び、`sessionId` 集合を構築する `useEffect`（取得失敗時は空集合にフォールバック、`cancelled` ガード付き）（Req 2.2）
    - `candidateSessions` の `useMemo`（`filterSessionsByAssignment` を使用）（Req 2.1）
    - 割り当て集合変更時に `reconcileSelection` で選択を整合させる `useEffect`（Req 2.3, 2.4）
    - この選択整合 `useEffect` を「SourceReviewSession 選択に依存する付随入力の連動リセットの単一拡張点」としてコメントで明記する。現状は依存入力が存在しないため `selectedSessionIds` の整合のみを行い、将来依存入力が追加された際はここでリセットする（Req 2.4）
    - セッションのチェックボックス描画を `sessions` から `candidateSessions` に切り替え
    - Team 未選択時は空集合・案内文言、読み込み中の `role="status"`（「割り当て読み込み中...」）、既存の `aria-label` / `role="alert"` を踏襲
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2_

- [x] 6. フロント: LanguageModelPage のテスト
  - [x] 6.1 `LanguageModelPage.test.tsx` にコンポーネントテストを追記
    - `languageModelApi.listTeamAssignments` をモック。各テストで `expect(container).toHaveNoViolations()`（vitest-axe、WCAG 2.1 AA）を含める
    - Team A 選択で A の割り当てセッションのみ候補表示（Req 2.1）
    - Team A→B 変更で `listTeamAssignments` が B で再呼び出しされ候補が更新される（Req 2.2）
    - A の候補を 1 件選択 → B（含まない）へ変更で当該選択が解除され `selectedSessionIds` が空になる（Req 2.3）
    - ADMIN / TEAM_LEADER はフォーム表示、REVIEWER はアクセス拒否（Req 3.2）
    - TeamAssignment 取得失敗時に候補が空集合となり UI がクラッシュしないこと
    - 新規ローディング表示（`role="status"`）と空状態メッセージが axe 違反を出さないこと
    - 注記: Req 2.4（選択解除に連動する依存入力のリセット）の専用テストは現状不要。作成フォームに SourceReviewSession 選択へ依存する付随入力が存在せず、選択整合は Property 4（`reconcileSelection`）で既にカバー済みのため。将来依存入力が追加された時点で連動リセットのテストを追加する
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2_

  - [x] 6.2 `LanguageModelPage.property.test.ts` に Property 3 を追記
    - **Property 3: 候補絞り込みは割り当て集合に一致**
    - **Validates: Requirements 2.1**
    - 任意の `ReviewSession[]` と `assignedSessionIds: Set<string>` を生成し、`filterSessionsByAssignment` の結果が「割り当て集合に含まれるセッションのみ」かつ「一覧内で割り当て集合に含まれるものを漏らさない」ことを検証
    - `{ numRuns: 100 }`

  - [x] 6.3 `LanguageModelPage.property.test.ts` に Property 4 を追記
    - **Property 4: 選択整合は「前回選択 ∩ 新割り当て集合」**
    - **Validates: Requirements 2.3**
    - 任意の `prevSelected: string[]` と `assignedSessionIds: Set<string>` を生成し、`reconcileSelection` の結果が積集合（新割り当て集合の部分集合であり、前回選択かつ割り当て済みの要素を落とさない）であることを検証
    - `{ numRuns: 100 }`

- [x] 7. Final checkpoint - フロント・バックエンド全テストが通ることを確認
  - `cd backend && npx vitest --run` と `cd frontend && npx vitest --run` を実行し、すべてのテストが通ることを確認する
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` 付きのサブタスクはオプション（テスト）で、MVP を急ぐ場合はスキップ可能。ただし本機能は Language Model がプロパティテスト対象のため、Property 1〜4 の実施を強く推奨。
- 各タスクは特定の Requirement に紐づけており、プロパティテストタスクは design の Property 番号を明記している。
- 検証（`npx vitest --run`）タスクを Checkpoint として各フェーズ末に配置している。
- 統合テストは不要（バックエンドは既存エンドポイント・リポジトリのみ使用し、新規アクセスパターンがない）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "5.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "5.2", "6.2", "6.3"] },
    { "id": 2, "tasks": ["6.1"] }
  ]
}
```
