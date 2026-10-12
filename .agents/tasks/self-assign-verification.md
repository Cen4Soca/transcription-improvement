# Reviewer セルフ割り当て機能（C案） — 検証レポート

対象リポジトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement`
（git リポジトリではないため commit は行わず、ワークスペース上で直接編集した）

実装は初回イテレーション（`self-assign-review.json` は存在しなかった。`self-assign-design-review.json` は設計フェーズのレビューであり実装レビューではない）。計画 `.agents/tasks/self-assign-plan.md` / 設計 `.agents/tasks/self-assign-design.md` / 確定事実 `.agents/tasks/self-assign-investigation.md` に従って実装した。

---

## 実装したファイル

### Backend
- `backend/src/services/session-service.ts`（追記）
  - `listJoinableSessions(user)`: 非 ADMIN は `getUserTeamIds`（DynamoDB）→ 各チームの `getSessionsByTeamId` を集約し `Map` で de-dup、ADMIN は `getAllSessions()`。`status==='PENDING'` のみ残し、`getSessionIdsByParticipantUserId` の **1 クエリ + Set 差分**で未参加フィルタ、`sortByCreatedAtDesc`。所属 0 件は空配列。
  - `selfAssignSession(user, sessionId)`: `joinSession` 同等（存在しなければ 404 / 非 ADMIN は `assignedTeamId` + `isTeamMember`（DB）判定で 403 / ADMIN 無条件 / `addParticipant` で冪等）。`requireRole` 不使用。
- `backend/src/handlers/get-joinable-sessions.ts`（新規）: `GET /sessions/joinable` → `{ data: { items } }`。AppError 透過ガード + `internalError`。
- `backend/src/handlers/post-session-self-assign.ts`（新規）: `POST /sessions/{sessionId}/self-assign`。`sessionId` 欠落で 400、成功時のみ `recordAuditLog({ operationType:'REVIEW_ASSIGNMENT_CHANGE', resourceId, resourceType:'ReviewSession', metadata:{ reason:'self-assign' }, actorUserId, actorRole })`。

### Backend テスト（co-located）
- `backend/src/services/session-service.test.ts`（追記）: `selfAssignSession` 6 ケース（404 / 403×2 / ADMIN 成功 / REVIEWER 自チーム成功 / 冪等）、`listJoinableSessions` 6 ケース（PENDING 以外除外 / 参加済み除外 / 所属 0 件→空 / de-dup / ADMIN 全件 / 基本）。`isAdmin` はモックせず実関数を使用。未参加フィルタは `getSessionIdsByParticipantUserId` をモック。
- `backend/src/services/session-service.property.test.ts`（新規, `{ numRuns: 100 }`）:
  - Property 1「`selfAssignSession` の冪等性」（**Validates: FR-2**）: participant 集合がちょうど 1 件、reviewer count が二度目で増えない。
  - Property 2「`listJoinableSessions` のスコープ健全性」（**Validates: FR-1, NFR-1**）: 結果は常に「DB 所属チーム割り当て・PENDING・未参加」の部分集合。他チーム割り当て（`assignedTeamId` が DB 所属外）は REVIEWER の候補に出ない。重複なし。ADMIN パスは REVIEWER で呼ばれない。
- `backend/src/handlers/post-session-self-assign.test.ts`（新規）: 成功時 `reason:'self-assign'` 付き監査ログ 1 回 / `sessionId` 欠落 400 で監査ログなし / 403・404 伝播で監査ログなし / 500。
- `backend/src/handlers/get-joinable-sessions.test.ts`（新規）: `{ data: { items } }` 返却 / 空配列 / 認証不備 403 / 500 / AppError statusCode 透過。

### Infra
- `infra/lib/stacks/api-stack.ts`（追記）: `postSessionJoinFn` 定義直後に `createLambda('GetJoinableSessions', ...)` + `createLambda('PostSessionSelfAssign', ...)` と各 `grantCommonPermissions`。`// Sessions` ルートで `GET /sessions/joinable` を greedy `/sessions/{sessionId}` の前（`/sessions/assigned` の隣）に、`POST /sessions/{sessionId}/self-assign` を `/join` の隣に登録。
- `infra/test/api-stack.test.ts`（追記）: 「Self-Assign Routes」describe を追加（ルート 2 本 + Lambda 2 本の `hasResourceProperties` アサーション）。`toMatchSnapshot()` スナップショットを `-u` で更新。

### Frontend
- `frontend/src/services/session-api.ts`（追記）: `listJoinableSessions()`（`GET /sessions/joinable`）、`selfAssignSession(sessionId)`（`POST /sessions/{id}/self-assign`）、型 `JoinableSessionsResponse`。
- `frontend/src/components/SessionAssignmentControls.tsx`（変更）: 任意 prop `scope?: 'all'|'assigned'|'joinable'` を追加。**未指定時は従来挙動を完全維持**（`onClaim && !isClaimed`）。`scope==='joinable'` のときのみ表示条件を「`status==='PENDING'` かつ `assignedTeamId` あり かつ `assignedUserId !== currentUserId`」に差し替え、ラベルを「参加」に。
- `frontend/src/App.tsx`（変更）: `SessionListPageWrapper` の `scope` に `'joinable'` を追加、`loadSessions` に joinable 分岐、`handleSelfAssign`、`renderSessionActions` で scope と `onClaim` を出し分け、`/joinable` ルート追加。
- `frontend/src/components/Navigation.tsx`（変更）: `NAV_ITEMS` に `{ to:'/joinable', label:'参加可能なセッション' }`。

### Frontend テスト
- `frontend/src/services/session-api.test.ts`（追記）: `listJoinableSessions` / `selfAssignSession` のエンドポイント検証。
- `frontend/src/components/SessionAssignmentControls.test.tsx`（追記）: joinable scope で (a) axe `toHaveNoViolations()`、(b) 自動生成セッション（`assignedUserId` あり・PENDING・自分以外）で「参加」ボタン表示 + `onClaim` 呼び出し、(c) 自分がアップローダーなら非表示、(d) 非 PENDING は非表示、(e) scope 未指定の回帰ガード。

---

## 実行コマンドと結果

### Backend
```
cd backend && npm install && npx vitest --run
```
結果: **Test Files 92 passed | 6 skipped (98) / Tests 1139 passed | 85 skipped (1224)**。失敗 0。
（新規追加分の個別実行 `session-service.test.ts` + `session-service.property.test.ts` + 2 ハンドラテスト = 63 passed も確認。）
補助: `npx tsc --noEmit` → exit 0（型エラーなし）。

### Frontend
```
cd frontend && npm install && npx vitest --run
```
結果: **Test Files 85 passed (85) / Tests 1039 passed (1039)**。失敗 0。vitest-axe 違反なし。
補助: `npx tsc --noEmit` → exit 0（型エラーなし）。

### Infra
```
cd infra && npm install && npx cdk diff --all
```
`dev-ApiStack` の差分は新規 `[+]` のみ:
- `[+] AWS::Lambda::Function GetJoinableSessionsLambda/Function`（+ Role / DefaultPolicy / LogGroup）
- `[+] AWS::Lambda::Function PostSessionSelfAssignLambda/Function`（+ Role / DefaultPolicy / LogGroup）
- `[+] AWS::ApiGatewayV2::Route HttpApi/GET--sessions--joinable`（+ Integration / Permission）
- `[+] AWS::ApiGatewayV2::Route HttpApi/POST--sessions--{sessionId}--self-assign`（+ Integration / Permission）

既存 Lambda に出る `[~]`（`COGNITO_USER_POOL_ID` のハードコード値 → `Fn::ImportValue` 化、コード S3Key のアセットハッシュ変化）および FoundationStack の `SeedAdmin*` の `[-]` は、**本実装前から存在するデプロイ済みスタックとリポジトリ現状とのベースライン差分**であり、本変更（api-stack.ts への 2 Lambda + 2 ルート追加）が原因ではない。これらは全 Lambda に一様に出ており、触っていない他スタック（Foundation / CloudFrontWaf / Cdn / Monitoring）にも及ぶことから、環境ドリフトであることが確認できる。

infra テスト（`infra/package.json` の `test` = `vitest --run`）:
```
cd infra && npx vitest --run
```
結果: **Test Files 3 passed (3) / Tests 147 passed (147)**。失敗 0。
（新規「Self-Assign Routes」4 アサーション green。スナップショットは `-u` で更新済み。）

#### スナップショットが「新 2 Lambda + 2 ルートのみ」であることの実証
更新前スナップショットをバックアップし、更新後とリソース型ヒストグラムを比較:

| 型 | 旧 | 新 | 差 |
|----|----|----|----|
| AWS::Lambda::Function | 59 | 61 | +2 |
| AWS::ApiGatewayV2::Route | 52 | 54 | +2 |
| AWS::ApiGatewayV2::Integration | 52 | 54 | +2 |
| AWS::IAM::Role | 60 | 62 | +2 |
| AWS::IAM::Policy | 60 | 62 | +2 |
| AWS::Lambda::Permission | 57 | 59 | +2 |
| AWS::Logs::LogGroup | 56 | 58 | +2 |

→ Lambda / ルート 1 本につき生成される付随リソースがそれぞれちょうど +2。**他の型は一切増減なし**（既存リソースの削除・置換なし）。巨大なテキスト差分は再シリアライズ（インデント・順序）ノイズであり、意味的追加は上記のみ。

---

## ユーザー報告課題の実証（「コマンドが通った」だけで完了としない確認）

1. **候補一覧が自動生成 PENDING を拾う**:
   - `session-service.test.ts > listJoinableSessions`「returns PENDING team sessions the reviewer has not joined, sorted by createdAt desc」が、`assignedTeamId` 付き PENDING セッションを候補として返すことを実証。
   - property test Property 2 が「DB 所属チーム割り当て・PENDING・未参加」の部分集合であることを 100 ケースで実証。
   - フロント `SessionAssignmentControls.test.tsx`「shows a 参加 button for an auto-generated session claimed by someone else」が、`assignedUserId`（アップローダー）が入った PENDING セッションでも他 Reviewer に「参加」ボタンが出ることを実証（旧条件 `isClaimed = Boolean(session.assignedUserId)` ではボタンが出なかった課題の解消）。

2. **他チームセッションは self-assign 不可**:
   - `selfAssignSession`「forbids a REVIEWER who is not a member of the session team (403)」「forbids a REVIEWER when the session has no assignedTeamId (403)」で 403 を実証。
   - property test Property 2 で、DB 所属外 `assignedTeamId` のセッションが REVIEWER の候補に出ない不変条件を実証。

3. **冪等**:
   - `selfAssignSession`「is idempotent when the reviewer already self-assigned」で二度目に reviewer count を再計上しないこと（`getSessionById` 1 回のみ）を実証。
   - property test Property 1 で、2 回呼び出し後も participant 集合が 1 件・reviewer count が二重計上されないことを 100 ケースで実証。

4. **回帰防止**:
   - フロント「keeps default-scope behaviour unchanged」で、scope 未指定時の `/`・`/assigned` の挙動（claimed セッションにボタンを出さない）が変わらないことを実証。

---

## 規約遵守
ESM `.js` 拡張子 import / named export のみ / 1 ファイル 1 ハンドラ / Handler→Service→Repository（Handler は Repository を直接呼ばない）/ Lambda 型 `APIGatewayProxyEventV2WithJWTAuthorizer`・`APIGatewayProxyResultV2` / AppError ファクトリのみ / `successResponse`・`errorResponse` のみ / ハンドラ JSDoc / UI テキスト日本語・コード英語 / env `DYNAMODB_TABLE_NAME`（`commonEnv` 自動付与）/ components フラット構造維持（新コンポーネント不要）。
