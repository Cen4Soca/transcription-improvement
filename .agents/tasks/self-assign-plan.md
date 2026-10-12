# Reviewer セルフ割り当て機能（C案） — 実装計画

対象リポジトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement`（**git リポジトリではない**。worktree/branch/commit/rebase/merge は一切行わない。全作業はワークスペース上で直接ファイルを読み書きする）

前提ドキュメント（必読・本計画の根拠）:
- 承認済み設計: `.agents/tasks/self-assign-design.md`
- 確定事実調査: `.agents/tasks/self-assign-investigation.md`

探索で確認した実コードの事実（計画の前提）:
- `backend/src/services/session-service.ts` は `isAdmin` / `requireRole` を `../utils/auth-middleware.js` から import。`getUserTeamIds` / `isTeamMember` を `./access-control-service.js` から import。既存 `joinSession(user, sessionId)` が「存在しなければ 404 / 非 ADMIN は `assignedTeamId` + `isTeamMember` で 403 / `addParticipant` で冪等」を実装済み（本機能のロジックの雛形）。
- `session-repository.ts` に `getSessionsByTeamId`, `getAllSessions`, `getSessionIdsByParticipantUserId`, `addParticipant`, `getSessionById`, `getSessionsByParticipantUserId` がすべて存在する（Repository 追加は不要）。
- `backend/src/handlers/post-session-join.ts` が self-assign ハンドラの雛形（`extractUser`→`validationError('sessionId...')`→Service 呼び出し→`recordAuditLog({ operationType:'REVIEW_ASSIGNMENT_CHANGE', resourceType:'ReviewSession', ... })`→`successResponse({ data })`、内側 catch で AppError 透過＋`internalError`）。`get-assigned-sessions.ts` が GET 候補一覧の雛形（`{ data: { items } }`）。
- `audit-service.ts` の `RecordAuditLogParams` は `{ actorUserId, actorRole: 'REVIEWER'|'TEAM_LEADER'|'ADMIN', operationType, resourceId, resourceType, metadata? }`。`recordAuditLog` が `sanitizeMetadata` で metadata を整形する。
- `infra/lib/stacks/api-stack.ts`: `postSessionJoinFn = this.createLambda('PostSessionJoin', {...})` + `this.grantCommonPermissions(...)`（約 383 行）と、`// Sessions` ブロックのルート登録（約 1200〜1214 行、`GET /sessions`→`GET /sessions/assigned`→`GET /sessions/{sessionId}`→…→`POST /sessions/{sessionId}/join`）が雛形。`createLambda` はクラス名を kebab-case 化してファイル名にし、ハンドラ export 既定は `handler`。`commonEnv` が `DYNAMODB_TABLE_NAME` 他を付与。
- `infra/test/api-stack.test.ts` が**存在する**（`toMatchSnapshot()` のスナップショットテスト＋ルート/Lambda の `hasResourceProperties` アサーション群）。`__snapshots__/` にスナップショットがコミットされている。infra テストは `vitest --run`（`infra/vitest.config.ts`、`SKIP_BUNDLING=true`、`include: test/**/*.test.ts`）。→ **Lambda 2 本＋ルート 2 本の追加でスナップショットが必ず変化するため更新が必要。**
- `frontend/src/services/session-api.ts`: `claimSession`（`POST /sessions/{id}/join`）/ `listAssignedSessions`（`GET /sessions/assigned` → `AssignedSessionsResponse = { data: { items: ReviewSession[] } }`）が雛形。
- `frontend/src/App.tsx`: `SessionListPageWrapper({ scope?: 'all' | 'assigned', ... })`。`loadSessions` が `scope==='assigned'` で `listAssignedSessions`、既定で `listSessions`。`handleClaim`→`claimSession`。`AppRoutes` に `/assigned` ルート（`scope="assigned"` title=「自分の割り当てセッション」）。
- `frontend/src/components/Navigation.tsx`: `NAV_ITEMS` に `/`=「セッション一覧」, `/assigned`=「自分のタスク」, `/upload`, `/language-models`(ADMIN/TEAM_LEADER), `/ranking`, `/admin`(ADMIN)。
- `frontend/src/components/SessionAssignmentControls.tsx`: `const isClaimed = Boolean(session.assignedUserId)`、ボタンは `onClaim && !isClaimed` で表示（＝自動生成セッションでは他 Reviewer にボタンが出ない課題の原因）。Props に `currentUserId` あり。

検証コマンド（探索で確認した実コマンド）:
- backend: `cd backend && npm install && npx vitest --run`
- frontend: `cd frontend && npm install && npx vitest --run`
- infra: `cd infra && npm install && npx cdk diff --all`、および infra テスト `cd infra && npx vitest --run`（`infra/test/api-stack.test.ts`）

> ユーザー報告の課題（Reviewer がボタンを見つけられない／候補が一覧に出ない）は「コードを読んで問題なし」で片付けず、**テスト・ビルドの実行**で実証する（項目 11〜13 の検証を必ず実行し、結果を記録する）。

---

## Implementation Plan

- [ ] 1. `session-service.ts` に `selfAssignSession(user, sessionId)` を追加する。
      既存 `joinSession` と同一方針: `getSessionById`→存在しなければ `notFoundError`（404）／非 ADMIN は `session.assignedTeamId` 未設定 or `isTeamMember(user.userId, session.assignedTeamId)===false` で `forbiddenError`（403）／ADMIN 無条件／`addParticipant` で冪等（追加時のみ `getSessionById` で再取得）。**`requireRole` は使わない**（REVIEWER を通す）。所属判定は DB ベース（`getUserTeamIds`/`isTeamMember`）のみ、JWT クレーム・`assignedTeamId` を所属の証明に使わない（NFR-1）。named export、`.js` 拡張子 import。
      Files: `backend/src/services/session-service.ts`
      Verify: `cd backend && npx vitest --run src/services/session-service.test.ts`（項目 4 のユニットテスト追加後に green）。本項目単体では `cd backend && npx tsc --noEmit`（型が通ること）。

- [ ] 2. `session-service.ts` に `listJoinableSessions(user): Promise<SessionRecord[]>` を追加する。
      ロジック: 母集合取得（非 ADMIN=`getUserTeamIds(user.userId)` の各 teamId を `getSessionsByTeamId` で列挙し集約／ADMIN=`getAllSessions()`）→ `Map<sessionId, SessionRecord>` で de-dup → `status==='PENDING'` のみ → 未参加フィルタ（`const joined = new Set(await getSessionIdsByParticipantUserId(user.userId))` を**1回だけ**呼び、`joined.has(sessionId)===false` のみ残す。`isParticipant` の N 連打は使わない）→ `createdAt` 降順ソート。所属 0 件（非 ADMIN）は空配列。DynamoDB 例外は素通し（ハンドラが 500 に包む）。`getUserTeamIds`/`isTeamMember` は既に import 済みなので、不足する repository 関数（`getSessionsByTeamId`/`getAllSessions`/`getSessionIdsByParticipantUserId`）を import に追加する。
      Files: `backend/src/services/session-service.ts`
      Verify: `cd backend && npx tsc --noEmit`（型が通ること）。機能検証は項目 4 のユニットテストで実施。

- [ ] 3. 新ハンドラ 2 本を追加する（1 ファイル 1 ハンドラ・named export `handler`・`.js` 拡張子 import・JSDoc 必須）。
      (a) `get-joinable-sessions.ts`: `GET /sessions/joinable`。`get-assigned-sessions.ts` を雛形に、`extractUser`→`listJoinableSessions(user)`→`successResponse({ data: { items } })`。内側 catch は AppError 透過ガード（`error instanceof Error && 'statusCode' in error → throw`）＋`internalError('参加可能なセッションの取得に失敗しました。', ...)`。
      (b) `post-session-self-assign.ts`: `POST /sessions/{sessionId}/self-assign`。`post-session-join.ts` を雛形に、相違点は 2 点のみ — 呼ぶ Service を `selfAssignSession`、`recordAuditLog` の metadata に `{ reason: 'self-assign' }` を付与（`operationType:'REVIEW_ASSIGNMENT_CHANGE'`, `resourceId:sessionId`, `resourceType:'ReviewSession'`, `actorUserId:user.userId`, `actorRole:user.role`）。`sessionId` 欠落は `validationError`（400）。監査ログは成功時のみ（Service が 404/403 を投げたら `recordAuditLog` に到達しない）。
      Files: `backend/src/handlers/get-joinable-sessions.ts`, `backend/src/handlers/post-session-self-assign.ts`
      Verify: `cd backend && npx tsc --noEmit`。機能検証は項目 5 のハンドラテストで実施。

- [ ] 4. `session-service` の新関数ユニット＋プロパティテストを co-located で追加する。
      `session-service.test.ts`（既存に追記）: `vi.mock()` で `./access-control-service.js`（`getUserTeamIds`/`isTeamMember`）と `../repositories/session-repository.js`（`getSessionById`/`getSessionsByTeamId`/`getAllSessions`/`getSessionIdsByParticipantUserId`/`addParticipant`）をモック。**`isAdmin` はモックしない**（`auth-middleware` の純関数。ADMIN 分岐は `user.role='ADMIN'`、非 ADMIN は `'REVIEWER'`/`'TEAM_LEADER'` を渡して実関数で検証）。未参加フィルタは `getSessionIdsByParticipantUserId`（`isParticipant` ではない）をモック。ケース: `selfAssignSession`（404/403×2/ADMIN 成功/REVIEWER 自チーム成功/冪等 `addParticipant→false`）、`listJoinableSessions`（PENDING 以外除外/参加済み除外/他チーム除外/ADMIN 全件/所属 0 件→空/de-dup）。
      `session-service.property.test.ts`（新規, `{ numRuns: 100 }`, `describe('Feature: self-assign, Property N: ...')`, docstring に検証要件）: Property 1「`selfAssignSession` の冪等性」（**Validates: FR-2**。2 回呼び出しで participant 集合・reviewer count が 1 回と同一）、Property 2「`listJoinableSessions` は常に『DB 所属チーム割り当て PENDING かつ未参加』の部分集合＝ DB 所属チームに含まれない `assignedTeamId` は REVIEWER の候補に出ない」（**Validates: FR-1, NFR-1**。他チーム・非 PENDING・参加済みを含まない不変条件）。
      Files: `backend/src/services/session-service.test.ts`, `backend/src/services/session-service.property.test.ts`
      Verify: `cd backend && npx vitest --run src/services/session-service.test.ts src/services/session-service.property.test.ts` — 全テスト green。

- [ ] 5. 新ハンドラ 2 本のユニットテストを co-located で追加する（`vi.mock()` で Service / `audit-service` をモック）。
      `post-session-self-assign.test.ts`: `sessionId` 欠落→400、成功時に `recordAuditLog` が `metadata.reason==='self-assign'` 付きで 1 回呼ばれ 200 `{ data }`、Service が投げた 403/404 がそのまま伝播し `recordAuditLog` が呼ばれないこと、DynamoDB 例外→500（`internalError`）。
      `get-joinable-sessions.test.ts`: Service をモックし `{ data: { items } }` を返すこと、Service の DynamoDB 例外時に 500（`internalError`）になること、Service が AppError を投げた場合はその statusCode が透過すること。
      Files: `backend/src/handlers/post-session-self-assign.test.ts`, `backend/src/handlers/get-joinable-sessions.test.ts`
      Verify: `cd backend && npx vitest --run src/handlers/post-session-self-assign.test.ts src/handlers/get-joinable-sessions.test.ts` — green。

- [ ] 6. backend 全体テストで回帰がないことを確認する（項目 1〜5 の統合地点）。
      Files: （新規追加なし。既存テスト含む全 backend テスト実行）
      Verify: `cd backend && npm install && npx vitest --run` — 新規含む全テストが green、既存テスト破壊なし。

- [ ] 7. `infra/lib/stacks/api-stack.ts` に Lambda 2 本定義とルート 2 本を追加する。
      `postSessionJoinFn` 定義の直後に `createLambda('GetJoinableSessions', { entry: handlersDir, description: 'GET /sessions/joinable - PENDING sessions a reviewer can self-assign to', environment: commonEnv })` + `grantCommonPermissions(...)`、`createLambda('PostSessionSelfAssign', { ..., description: 'POST /sessions/{sessionId}/self-assign - Reviewer self-assigns to a team session', ... })` + `grantCommonPermissions(...)`。`// Sessions` ルートブロックで、静的 `GET /sessions/joinable` を `GET /sessions/{sessionId}` の**前**（`GET /sessions/assigned` の隣）に `addRoute('GET','/sessions/joinable', getJoinableSessionsFn, jwtAuthorizer)`、`POST /sessions/{sessionId}/self-assign` を `POST /sessions/{sessionId}/join` の隣に `addRoute('POST','/sessions/{sessionId}/self-assign', postSessionSelfAssignFn, jwtAuthorizer)`。クラス名の kebab-case 化（`GetJoinableSessions`→`get-joinable-sessions`, `PostSessionSelfAssign`→`post-session-self-assign`）がハンドラファイル名と一致することを確認。`commonEnv` のみで環境変数は十分。
      Files: `infra/lib/stacks/api-stack.ts`
      Verify: `cd infra && npx tsc --noEmit`（型が通ること）。差分確認は項目 9。

- [ ] 8. `infra/test/api-stack.test.ts` に新ルート 2 本・Lambda 2 本のアサーションテストを追加し、スナップショットを更新する。
      既存の「New API Routes」「Speaker Label Routes」等のパターンに倣い、`hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /sessions/joinable' })` と `{ RouteKey: 'POST /sessions/{sessionId}/self-assign' }`、`hasResourceProperties('AWS::Lambda::Function', { Description: Match.stringLikeRegexp('.*joinable.*') })` と `{ Description: Match.stringLikeRegexp('.*self-assign.*') }` を追加。`toMatchSnapshot()` は Lambda/ルート追加で必ず変化するため、意図した追加（新規 2 Lambda + 2 ルートのみ）であることを確認した上でスナップショットを更新する。
      Files: `infra/test/api-stack.test.ts`, `infra/test/__snapshots__/`（スナップショット更新）
      Verify: `cd infra && npx vitest --run`（新アサーション green）。初回はスナップショット差分を確認してから `cd infra && npx vitest --run -u` で更新し、再度 `cd infra && npx vitest --run` で green を確認。差分が「新 2 Lambda + 2 ルート」に限定され既存リソースが変化していないことを目視確認する。

- [ ] 9. infra の CDK 差分で新ルート 2 本・Lambda 2 本の追加のみが出て既存を壊さないことを確認する。
      Files: （新規追加なし。項目 7・8 の結果確認）
      Verify: `cd infra && npm install && npx cdk diff --all` — `GET /sessions/joinable` ルート、`POST /sessions/{sessionId}/self-assign` ルート、GetJoinableSessions / PostSessionSelfAssign の 2 Lambda（＋各個別 IAM ロール）が差分に現れ、既存リソースの破壊的変更（削除・置換）がないこと。

- [ ] 10. `frontend/src/services/session-api.ts` に API クライアント 2 メソッドと型を追加する。
      `claimSession`/`listAssignedSessions` を参考に、`async listJoinableSessions(): Promise<Result<JoinableSessionsResponse, AppError>>`（`this.client.get('/sessions/joinable')`）、`async selfAssignSession(sessionId): Promise<Result<{ data: ReviewSession }, AppError>>`（`this.client.post('/sessions/${sessionId}/self-assign', {})`）。型 `export interface JoinableSessionsResponse { data: { items: ReviewSession[] } }`（`AssignedSessionsResponse` と同形）を追加。
      Files: `frontend/src/services/session-api.ts`
      Verify: `cd frontend && npx tsc --noEmit`。機能検証は項目 13 の api テストで実施。

- [ ] 11. `SessionAssignmentControls.tsx` の参加ボタン表示条件を見直す（**既存 `/`・`/assigned` 画面を壊さないこと最優先**）。
      Props に任意の `scope?: 'all' | 'assigned' | 'joinable'`（または `showSelfAssign?: boolean`）を追加。**未指定時は現状挙動を完全維持**（`onClaim && !isClaimed` でボタン表示＝既存 `/` の挙動を 1 ビットも変えない）。`scope==='joinable'` のときのみ、表示条件を「`session.status==='PENDING'` かつ `Boolean(session.assignedTeamId)` かつ `session.assignedUserId !== currentUserId`」に差し替え、ボタンラベルを「参加」にする（既存「引き受ける」ラベルは据え置き）。候補一覧 API がサーバ側で未参加フィルタ済みのため UI は軽量条件で足り、二重登録しても `addParticipant` が冪等。
      Files: `frontend/src/components/SessionAssignmentControls.tsx`
      Verify: `cd frontend && npx tsc --noEmit`。回帰・新挙動の検証は項目 13 のコンポーネントテストで実施。

- [ ] 12. `App.tsx`・`Navigation.tsx` に候補一覧の導線を追加する（既存 `/assigned` パターンに準拠、components フラット厳守＝新コンポーネント不要）。
      `App.tsx`: `SessionListPageWrapper` の `scope` 型を `'all' | 'assigned' | 'joinable'` に拡張。`loadSessions` に `scope==='joinable'` 分岐（`sessionApi.listJoinableSessions()` → `result.value.data.items`）。`handleSelfAssign`（`selfAssignSession`→成功後 `loadSessions`）を追加。`renderSessionActions` で `scope` を `SessionAssignmentControls` に伝え、`scope==='joinable'` のとき `onClaim={handleSelfAssign}` を渡す。`AppRoutes` に `/joinable` ルート（`scope="joinable"` title=「参加可能なセッション」、`/assigned` の隣）を追加。
      `Navigation.tsx`: `NAV_ITEMS` に `{ to: '/joinable', label: '参加可能なセッション' }` を `/assigned` の並びに追加（全ロール表示、既存ラベルは変更しない）。
      Files: `frontend/src/App.tsx`, `frontend/src/components/Navigation.tsx`
      Verify: `cd frontend && npx tsc --noEmit`。

- [ ] 13. frontend のテストを追加する（RTL + vitest-axe、routed component は `MemoryRouter`）。
      `session-api.test.ts`（既存に追記）: `ApiClient` モックで `listJoinableSessions` が `GET /sessions/joinable`、`selfAssignSession` が `POST /sessions/{id}/self-assign` を叩くこと。
      `SessionAssignmentControls.test.tsx`（既存に追記）: (a) scope 未指定で既存挙動（`!isClaimed` でボタン表示）が変わらない回帰テスト、(b) `scope='joinable'` で自動生成セッション（`assignedUserId` あり・`status='PENDING'`・`assignedTeamId` あり・`assignedUserId !== currentUserId`）に「参加」ボタンが出て `onClaim` が呼ばれること、自分がアップローダー（`assignedUserId === currentUserId`）では出ないこと、(c) `expect(container).toHaveNoViolations()`。
      Files: `frontend/src/services/session-api.test.ts`, `frontend/src/components/SessionAssignmentControls.test.tsx`
      Verify: `cd frontend && npx vitest --run src/services/session-api.test.ts src/components/SessionAssignmentControls.test.tsx` — green、vitest-axe 違反なし。

- [ ] 14. frontend 全体テストで回帰がないことを確認する（項目 10〜13 の統合地点）。
      Files: （新規追加なし。既存テスト含む全 frontend テスト実行）
      Verify: `cd frontend && npm install && npx vitest --run` — 新規含む全テスト green、既存破壊なし。

- [ ] 15. 全パッケージの検証を実行し、結果を検証レポートに記録する。
      backend `cd backend && npm install && npx vitest --run`、frontend `cd frontend && npm install && npx vitest --run`、infra `cd infra && npm install && npx cdk diff --all` + `cd infra && npx vitest --run`（`infra/test`）。それぞれの実行結果（pass/fail 件数、CDK 差分の要約＝新ルート 2 本・Lambda 2 本が出て既存破壊なし）を記録する。ユーザー報告の課題（ボタンが出ない／候補が一覧に出ない）が、項目 13（b）のボタン表示テストと項目 4 の `listJoinableSessions` 候補抽出テストの green で実証されたことを明記する。
      Files: `.agents/tasks/self-assign-verification.md`（新規・検証結果の記録先）
      Verify: 上記全コマンドが成功し、結果が `.agents/tasks/self-assign-verification.md` に記録されていること。

---

## 補足・前提と注意

- **検証レポート**: 最終的な実行結果（backend/frontend/infra の各 `vitest --run`・`cdk diff --all`）は `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/.agents/tasks/self-assign-verification.md` に記録する（項目 15）。
- **env 変数名**: DynamoDB テーブル名の env は実コードで `DYNAMODB_TABLE_NAME`（steering tech.md の `TABLE_NAME` 記述は実コードと不一致）。`commonEnv` が自動付与するため追加設定不要。
- **404/403 方針**: 存在しない→404、スコープ外→403（既存 `joinSession` と一致）。
- **Repository は追加不要**: 既存の `getSessionsByTeamId`/`getAllSessions`/`getSessionIdsByParticipantUserId`/`addParticipant`/`getSessionById` を再利用する。
- **Out of Scope**（本計画で触らない）: `SessionRecord` への `transcriptionJobId` 追加、`getAccessibleSessionIds` 改修、leave/取り消し API、PENDING→IN_PROGRESS 自動遷移、候補一覧のサーバページネーション。
- **想定上の注意（実装時に検証で確認すること）**: 項目 1/2 のユニットは項目 4 のテスト追加前は「型が通る」までが検証範囲（`tsc --noEmit`）。機能的 green は項目 4〜6 で担保する。infra の `tsc --noEmit` は `cdk.out` の再生成を伴わないため、最終的な差分確認は `cdk diff --all`（項目 9）で行う。
