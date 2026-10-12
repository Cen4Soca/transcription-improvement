# セッション一覧からの強制集約 UI

セッション項目ごとに ADMIN / TEAM_LEADER 専用の「強制集約して確定」操作を追加し、既存の `POST /sessions/{sessionId}/aggregate` をサービス層から呼び出す変更です。不可逆な確定操作の前に確認を挟み、成功時は集約結果を日本語で通知して一覧を再取得します。前回指摘された英語 API エラーの素通しは、コード／HTTP ステータス優先の日本語変換と専用テストによって解消されています。

Watch for: ブロッキング懸念はありません。

**Verdict**: APPROVED

## High-level view

操作は既存の `UserRole` に従って ADMIN と TEAM_LEADER に限定され、COMPLETED の項目では無効になります。未完了の項目だけが確認ステップから実行へ進みます。

API 呼び出しは `SessionApi.forceAggregateSession` に置かれ、`SessionListPage` の props を変えず `renderSessionActions` から注入されます。成功後は一覧を再取得し、確定数、不一致数、レビュアー数を表示します。

403、400、その他の API エラーはいずれも日本語へ変換されます。前回の欠陥を再現する英語メッセージ入力もテストされています。

<details>
<summary>Issues (0)</summary>

該当なし。

</details>

<details>
<summary>Details</summary>

## 管理ロール限定操作と完了済みセッションの保護

`frontend/src/App.tsx:85,225-249` は既存の `UserRole` から `canManage` を算出し、`renderSessionActions` 内で管理可能ロールにだけコントロールを差し込みます。コンポーネントも `frontend/src/components/SessionAggregateControls.tsx:34-40` で ADMIN / TEAM_LEADER 以外を描画せず、Reviewer 非表示と両管理ロールでの表示は `frontend/src/components/SessionAggregateControls.test.tsx:52-93` で検証されています。要件 1 は満たされています。

`frontend/src/components/SessionAggregateControls.tsx:35,71-83` は COMPLETED のボタンを無効化し、完了済みの説明を表示します。`frontend/src/components/SessionAggregateControls.test.tsx:94-111` に対応テストがあり、要件 2 は満たされています。

## 確認後にだけ実行される強制集約

`frontend/src/components/SessionAggregateControls.tsx:44-55,67-119` は確認領域を開く操作と集約実行を分離しています。確認前とキャンセル後に未呼び出しであること、実行時に対象の `sessionId` を渡すことは `frontend/src/components/SessionAggregateControls.test.tsx:113-155` で検証され、要件 3 は満たされています。

起点ボタンは `aria-expanded`、`aria-controls`、日本語の `aria-label` を持ち、確認領域はセッション固有 ID、`role="group"`、日本語ラベルを持ちます（`frontend/src/components/SessionAggregateControls.tsx:61-75,87-103`）。展開後を含む axe 検証は `frontend/src/components/SessionAggregateControls.test.tsx:33-49` で `toHaveNoViolations()` を実行しており、要件 6 は満たされています。

## 集約結果とセッション一覧の再同期

`ForceAggregateResult`（`frontend/src/types/session.ts:32-42`）は既存バックエンドのレスポンスと一致し、`frontend/src/services/session-api.ts:229-237` は空ボディで aggregate endpoint を呼びます。サービス契約は `frontend/src/services/session-api.test.ts:140-202` で成功、400、403 が検証されています。

`frontend/src/components/SessionAggregateControls.tsx:122-126` は `confirmedCount`、`conflictCount`、`totalReviewers` を日本語の `role="status"` で通知し、`frontend/src/App.tsx:212-223` は成功後に `loadSessions()` を待って COMPLETED 状態を再取得します。件数表示は `frontend/src/components/SessionAggregateControls.test.tsx:135-155` で検証され、要件 4 は満たされています。

## 英語 API エラーを遮断する日本語変換

`frontend/src/utils/aggregate-error.ts:12-22` は 403 / `FORBIDDEN`、400 / `VALIDATION_ERROR` をコード／ステータス優先で日本語へ変換し、それ以外も日本語の汎用文へ落とします。`frontend/src/App.tsx:212-218` が失敗結果を変換し、`frontend/src/components/SessionAggregateControls.tsx:44-55,129-133` が `role="alert"` で表示します。

`frontend/src/utils/aggregate-error.test.ts:8-62` は英語メッセージを持つ 403、400、未知エラーと statusCode がない場合を検証し、`frontend/src/components/SessionAggregateControls.test.tsx:157-180` は日本語エラー表示を検証しています。前回指摘は解消され、要件 5 は満たされています。

## 変更境界と記録済み検証

`SessionListPage` の `renderSessionActions` 契約は `frontend/src/pages/SessionListPage.tsx:10-20,61-63,195-197` のままです。新規コンポーネントとテストはフラットな `frontend/src/components/` に共同配置され、API は `frontend/src/services/`、型は `frontend/src/types/`、変換処理は `frontend/src/utils/` にあります。フロントエンドの型は既存ハンドラのレスポンス（`backend/src/handlers/post-session-aggregate.ts:21-22,168-177`）とも一致します。

`plan.md` の iteration 2 検証記録を確認し、指示どおり再実行していません。対象 4 ファイルの 28 テスト、全体 87 ファイル / 1054 テスト、`tsc -b && vite build` の成功、および対象変更に新規 lint エラーがないことが記録されています。指定ワークツリーには `.git` がないため `git diff main` とコミットメッセージは取得できず、現在の対象ファイル、前回レビュー、タスクスナップショット、検証記録を照合しました。

</details>

<details>
<summary>File map</summary>

- `frontend/src/App.tsx` — 集約ハンドラ、一覧再取得、アクション注入。
- `frontend/src/components/SessionAggregateControls.tsx` — ロール制御、確認、結果・エラー表示。
- `frontend/src/components/SessionAggregateControls.test.tsx` — UI 挙動と axe の検証。
- `frontend/src/services/session-api.ts` / `.test.ts` — aggregate POST と契約テスト。
- `frontend/src/types/session.ts` — 強制集約レスポンス型。
- `frontend/src/utils/aggregate-error.ts` / `.test.ts` — API エラーの日本語変換と回帰テスト。

Full diff: 指定ワークツリーに Git メタデータがないため直接参照不可。前回レビューとタスクスナップショットを差分根拠として使用。

</details>
