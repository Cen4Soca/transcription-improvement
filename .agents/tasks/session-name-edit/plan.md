# Implementation Plan — 校閲セッション名の編集機能（フルスタック）

作業ディレクトリは git リポジトリではない。git 操作（init/commit/branch 等）は一切行わない。全作業は作業ディレクトリ本体のファイルを直接読み書きする。

## 設計判断（根拠つき）

- **名前提案の text ソース**: セグメントは DynamoDB の `PK=SESSION#{sessionId}, SK begins_with SEGMENT#`（`originalText` 属性）に格納される（`get-segments.ts` で確認済み）。よって name-suggestion サービスは sessionId から直接セグメントを Query して全文を連結する。transcription-job-repository を経由する必要はない。
- **Bedrock 抽象化**: `suggestion-service.ts` の `BedrockSuggestionProvider` インターフェース（`getSuggestions(originalText, context?)`）と `defaultBedrockProvider`（`InvokeModelCommand`、Anthropic Messages API、`jp.anthropic.claude-haiku-4-5` 既定、`BEDROCK_MODEL_ID` 環境変数）を踏襲する。name 用途では専用プロンプトが必要なため、既存 provider を再利用せず **新しい `SessionNameProvider` インターフェース + `defaultSessionNameProvider`** を session-name-suggestion-service.ts 内に定義する（既存 provider のプロンプトは「修正候補」用で用途が異なるため）。実装様式（lazy client, TextDecoder, JSON parse, console.error でログ）は踏襲。
- **提案ボタンの配置**: 詳細ページ（ReviewPage、route `/sessions/:sessionId`）にのみ配置する。全文セグメントが必要であり、一覧ページには個々のセッションの全文がない。一覧ページには編集 UI のみ載せる。この判断は要件文の「一覧に載せるのが不自然なら詳細のみで可」に合致する。
- **監査ログ**: `patch-session-status.ts` は write 操作で `recordAuditLog` を記録している。名前編集も write なので記録する。`AuditOperationType`（audit-repository.ts）に新メンバー `'SESSION_NAME_CHANGED'` を追加する。
- **アクセス不可時 404**: `checkSessionAccess` は内部で `denyResourceAccess()` を呼び 404（存在隠蔽）を投げるため、ハンドラは patch-session-status と同じく `await checkSessionAccess(user, sessionId)` を呼ぶだけでよい。
- **フロントのセッション詳細ページ**: 専用 SessionDetailPage は存在せず、詳細表示は ReviewPage（`ReviewPageWrapper` が wire）である。編集 UI は ReviewPage ヘッダ + SessionListPage の各項目に追加する。

## バックエンド

- [ ] 1. `AuditOperationType` に `'SESSION_NAME_CHANGED'` を追加する。
      Files: backend/src/repositories/audit-repository.ts
      Verify: `cd backend && npx tsc --noEmit`（型エラーなし）。

- [ ] 2. session-repository に `updateSessionName(sessionId, name)` を追加する。`updateSessionStatus` の `UpdateCommand` パターンに揃え、`SET #name = :name, updatedAt = :updatedAt`（`name` は予約語なので `ExpressionAttributeNames` で `#name`）、`ReturnValues: 'ALL_NEW'`、`mapItemToSessionRecord` で返す。
      Files: backend/src/repositories/session-repository.ts
      Verify: `cd backend && npx vitest --run src/repositories`（既存 repository テストが通る）。

- [ ] 3. session-service に `renameSession(sessionId, rawName)` を追加する。トリム → 空文字/空白のみ/101文字以上は `validationError`（英語メッセージ、フロントで日本語変換）→ トリム後の name で `updateSessionName` を呼ぶ。`getSessionById` で存在確認し、無ければ `validationError`（patch-session-status の service と同じ握り方）。
      Files: backend/src/services/session-service.ts
      Verify: `cd backend && npx vitest --run src/services`（既存 service テストが通る）。

- [ ] 4. ハンドラ `patch-session-name.ts` を作成する。JSDoc（`PATCH /sessions/{sessionId}/name`）必須。構造は patch-session-status.ts に完全準拠: `extractUser` → sessionId 検証 → `checkSessionAccess` → body から `name` 取得・型検証 → `renameSession` 呼び出し → `recordAuditLog`（operationType `'SESSION_NAME_CHANGED'`, resourceType `'ReviewSession'`, metadata に新 name）→ `successResponse({ data })`。内側 try/catch で非 AppError を `internalError` に包む。
      Files: backend/src/handlers/patch-session-name.ts
      Verify: 手順6のテストで検証。

- [ ] 5. ハンドラ unit テスト `patch-session-name.test.ts` を作成する。patch-session-status.test.ts の `vi.mock`（access-control-service/session-service/audit-service）と `createEvent` ヘルパーを踏襲。ケース: 成功(200, data.name)、sessionId 欠落(400)、body 欠落/ name 欠落(400)、空白のみ name で service が validationError(400)、101文字で validationError(400)、アクセス不可(404)、DynamoDB 失敗(500)。
      Files: backend/src/handlers/patch-session-name.test.ts
      Verify: `cd backend && npx vitest --run src/handlers/patch-session-name.test.ts`（全通過）。

- [ ] 6. property テスト `session-service.property.test.ts`（または patch-session-name.property.test.ts）を作成する。fast-check `{ numRuns: 100 }`、describe に feature 名とプロパティ番号、docstring に検証要件。プロパティ: (a) 任意文字列入力に対し、保存される name は常にトリム済みで長さ 1〜100、または validationError を投げる。(b) トリムは冪等（trim(trim(x))===trim(x)）。`updateSessionName` はモックして保存値を検証。
      Files: backend/src/services/session-service.property.test.ts
      Verify: `cd backend && npx vitest --run`（新規 property テスト含め全通過）。

- [ ] 7. name 提案サービス `session-name-suggestion-service.ts` を作成する。`SessionNameProvider` インターフェース + `defaultSessionNameProvider`（Bedrock InvokeModel、`BEDROCK_MODEL_ID` 既定は suggestion-service と同一）を定義。`suggestSessionName(sessionId, provider?)`: sessionId から segments を Query（get-segments.ts と同じ KeyCondition）して `originalText` を連結（長すぎる場合は先頭 N 文字に制限）→ provider で「簡潔な日本語セッション名（100文字以内）」を1件生成 → 返す前に必ず `.trim().slice(0,100)` で 100 文字以内に後処理。Bedrock 失敗は try/catch で握りつぶし `{ suggestion: null, hasExternalApiError: true }` を返す（suggestion-service の hasExternalApiError 方針）。
      Files: backend/src/services/session-name-suggestion-service.ts
      Verify: 手順9のテストで検証。

- [ ] 8. ハンドラ `get-session-name-suggestion.ts` を作成する。JSDoc（`GET /sessions/{sessionId}/name-suggestion`）必須。get-suggestions.ts に準拠: `extractUser` → sessionId 検証 → `checkSessionAccess` → `suggestSessionName(sessionId)` → `successResponse(result)`。例外は `internalError('セッション名候補の取得に失敗しました。', ...)`。
      Files: backend/src/handlers/get-session-name-suggestion.ts
      Verify: 手順9のテストで検証。

- [ ] 9. name 提案の unit + property テストを作成する。service unit: `SessionNameProvider` をモックし、生成結果が 100 文字超でも返り値が 100 文字以内に切り詰められること、Bedrock 失敗時 `hasExternalApiError: true` を返すこと。segments Query は aws-sdk を vi.mock。property（`{ numRuns: 100 }`）: provider が任意長文字列を返しても結果 suggestion は常に 100 文字以内。ハンドラ unit: アクセス不可(404)、成功(200)。
      Files: backend/src/services/session-name-suggestion-service.test.ts, backend/src/services/session-name-suggestion-service.property.test.ts, backend/src/handlers/get-session-name-suggestion.test.ts
      Verify: `cd backend && npm install && npx vitest --run`（全テスト通過）。

## インフラ（CDK）

- [ ] 10. api-stack.ts に 2 つの Lambda とルートを追加する。`PatchSessionName` Lambda（`createLambda`、description `PATCH /sessions/{sessionId}/name - Rename session`、`environment: commonEnv`）に `grantCommonPermissions`。`GetSessionNameSuggestion` Lambda（description `GET /sessions/{sessionId}/name-suggestion - Suggest session name`、`environment: { ...commonEnv, BEDROCK_MODEL_ID: bedrockModelId }`、`timeoutSeconds: 60`）に `grantCommonPermissions` と `bedrockComprehend.grantInvoke(fn.role)`（getSuggestionsFn と同一パターン、同一スコープ内で定義）。ルートは `addRoute('PATCH', '/sessions/{sessionId}/name', ...)` と `addRoute('GET', '/sessions/{sessionId}/name-suggestion', ...)` を session ルート群（status の隣、greedy `/sessions/{sessionId}` より後）に登録。
      Files: infra/lib/stacks/api-stack.ts
      Verify: `cd infra && npm install && npx cdk synth`（synth 成功。失敗時は `npx tsc --noEmit` で型確認し報告）。

- [ ] 11. api-stack.test.ts にルート assertion を追加し、スナップショットを更新する。新規 `describe` もしくは既存 `New API Routes` に `PATCH /sessions/{sessionId}/name` と `GET /sessions/{sessionId}/name-suggestion` の `RouteKey` 検証、name-suggestion Lambda の BEDROCK_MODEL_ID 付与を追加。スナップショットは新規リソースで差分が出るため `-u` で更新。
      Files: infra/test/api-stack.test.ts
      Verify: `cd infra && npx vitest --run -u` 後に `npx vitest --run`（全通過）。

## フロントエンド

- [ ] 12. session-api に `renameSession(sessionId, name)`（PATCH /sessions/{sessionId}/name, body `{ name }`, 返り `{ data: ReviewSession }`）と `getSessionNameSuggestion(sessionId)`（GET /sessions/{sessionId}/name-suggestion, 返り `{ suggestion: string | null; hasExternalApiError: boolean }`）を追加する。
      Files: frontend/src/services/session-api.ts
      Verify: 手順16のテストで検証（`cd frontend && npx vitest --run src/services/session-api.test.ts`）。

- [ ] 13. 共有バリデーション util `frontend/src/utils/session-name.ts` に `validateSessionName(raw): { ok: true; value: string } | { ok: false; message: string }`（トリム後 1〜100 文字、日本語メッセージ）と、API エラー（英語）を日本語に変換するヘルパーを追加する。クライアント側とサーバ側で同一ルール。
      Files: frontend/src/utils/session-name.ts, frontend/src/utils/session-name.test.ts
      Verify: `cd frontend && npx vitest --run src/utils/session-name.test.ts`。

- [ ] 14. 再利用コンポーネント `SessionNameEditor.tsx` を components 直下（フラット、PascalCase）に作成する。表示モード（名前 + 編集アイコンボタン）↔ 編集モード（テキスト入力 + 保存/キャンセル + ⓘ インフォメーションマーク）。ⓘ は `button`/`span` に `aria-describedby` でルール文（「セッション名は必須です。1〜100文字で入力してください。前後の空白は自動的に削除されます。」）を関連付け、ホバーとキーボードフォーカスの両方でツールチップ表示（CSS `:hover`/`:focus-within` もしくは state）。props: `name`, `onSave(name): Promise<AppError|null>`, 任意の `onRequestSuggestion?(): Promise<...>` と `suggestionState`（提案ボタン表示はこの prop の有無で切替）。クライアントバリデーション（手順13）を使用。ローディング/エラーは日本語表示。
      Files: frontend/src/components/SessionNameEditor.tsx
      Verify: 手順16のテストで検証。

- [ ] 15. ReviewPage と SessionListPage に SessionNameEditor を組み込む。ReviewPage: ヘッダのセッション名表示部を SessionNameEditor に置換（`sessionName`、`onSave`、提案ボタン有効 = `onRequestSuggestion` を渡す）。新規 props `onRenameSession`, `onRequestNameSuggestion` を ReviewPageProps に追加し、ReviewPageWrapper（App.tsx）で `sessionApi.renameSession` / `getSessionNameSuggestion` を wire、保存成功時 `setSessionName` を更新。SessionListPage: 各項目に SessionNameEditor（提案ボタンなし）を追加し、新規 props `onRenameSession?` を受け、SessionListPageWrapper（App.tsx）で wire し保存後 `loadSessions()`。
      Files: frontend/src/pages/ReviewPage.tsx, frontend/src/pages/SessionListPage.tsx, frontend/src/App.tsx
      Verify: `cd frontend && npx tsc --noEmit`（型エラーなし）。

- [ ] 16. フロント component/page テストを追加・更新する。SessionNameEditor.test.tsx: 編集フロー（アイコン→入力→保存/キャンセル）、クライアントバリデーション（空・101文字でエラー表示）、提案ボタン押下で候補が入力欄にセット・ローディング/エラー日本語表示、ⓘ にホバー/フォーカスでルール文が参照可能（`aria-describedby` の存在と文言）。全テストで `vitest-axe` の `expect(container).toHaveNoViolations()` を含める。ルーティングコンポーネントは `MemoryRouter` でラップ。既存 SessionListPage.test.tsx / ReviewPage.test.tsx が props 追加で壊れないよう更新。API はモック。
      Files: frontend/src/components/SessionNameEditor.test.tsx, frontend/src/pages/SessionListPage.test.tsx, frontend/src/pages/ReviewPage.test.tsx, frontend/src/services/session-api.test.ts
      Verify: `cd frontend && npm install && npx vitest --run`（全テスト通過）。

## 最終統合検証

- [ ] 17. 3 パッケージの検証コマンドを全て実行し、通過を確認する。
      Verify:
      `cd backend && npm install && npx vitest --run` →
      `cd frontend && npm install && npx vitest --run` →
      `cd infra && npm install && (npx vitest --run || npx cdk synth || npx tsc --noEmit)`。
      いずれも成功（CDK は test 優先、無ければ synth、だめなら tsc で型確認し報告）。
