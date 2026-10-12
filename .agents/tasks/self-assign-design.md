# Reviewer セルフ割り当て機能（C案） — Requirements & Technical Design

対象リポジトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement`
関連調査: `.agents/tasks/self-assign-investigation.md`（本設計の前提。必読）

> 注記: このディレクトリは git リポジトリではない。実装・検証はすべてワークスペース上で直接ファイルを読み書きする。git 操作は一切行わない。

---

## 1. Summary

現状、Reviewer（REVIEWER ロール）は TEAM_LEADER / ADMIN がセッションを割り当てる（`assignSession` / `PATCH /sessions/{id}/assignment`）まで、自分で校閲作業に就けない。ジョブ実行時に自動生成される PENDING セッションは `assignedTeamId`（アップローダーのチーム）を持つが、既存の `GET /sessions` 一覧経路（`getAccessibleSessionIds` = `ASSIGNMENT#` レコードのみ参照）はこれを拾わないため、他の Reviewer からは「参加できる候補」として見えない。

本機能（C案 = セルフ割り当てAPI）は、「Reviewer が、自分の所属チームに `assignedTeamId` で割り当てられた PENDING セッションを、TEAM_LEADER / ADMIN の割り当てを待たずに自分で join（セルフ割り当て）できる」ようにする。実装は 3 点セット（join 候補一覧 API / セルフ割り当て API / フロント UI 導線）＋ CDK 配線 1 ファイル。

権限判定ロジックは既存 `joinSession` と同等（`session.assignedTeamId` + `isTeamMember()`）であり、**MediaFile 逆引きは不要**。権限昇格を避けるため、所属判定は必ず DynamoDB ベース（`getUserTeamIds` / `isTeamMember`）で行い、JWT クレーム由来の teamId は信用しない。

---

## 2. Functional Requirements

- FR-1: Reviewer は「自分が join できるセッション候補」の一覧を取得できる。候補は「呼び出し元の DB 所属チーム（`getUserTeamIds`）に `assignedTeamId` で割り当てられた PENDING セッションのうち、自分がまだ participant でないもの」。
- FR-2: Reviewer は候補セッションに対してセルフ割り当て（join）できる。join は participant 登録であり、冪等（再実行は no-op）。
- FR-3: セルフ割り当ては REVIEWER / TEAM_LEADER / ADMIN が実行できる。**ロールに依らず入口では拒否せず（`requireRole` を使わない）**、非 ADMIN は「自チームに `assignedTeamId` で割り当てられたセッション」に限りチームメンバーシップ（DynamoDB `isTeamMember` 判定）で許可する。ADMIN は無条件で join 可能。スコープ外は 403 で拒否するが、これは「ロール不足」ではなく「チームスコープ外」による拒否である。
- FR-4: セルフ割り当て操作は監査ログ（`operationType: 'REVIEW_ASSIGNMENT_CHANGE'`）に記録される。
- FR-5: フロント UI は Reviewer に候補一覧を見せる導線を提供し、候補からセルフ割り当て（参加）を実行できる。
- FR-6: 自動生成セッション（アップローダーが `assignedUserId` に入る）に対して、他の Reviewer に「参加」ボタンが表示される（既存の `const isClaimed = Boolean(session.assignedUserId)` 条件を見直す）。

## 3. Non-Functional Requirements

- NFR-1（セキュリティ / 権限昇格防止）: 所属チーム判定は必ず DynamoDB 側（`getUserTeamIds(user.userId)` / `isTeamMember`）で行う。JWT クレームや `session.assignedTeamId` を「所属の証明」として扱わない（`assignedTeamId` は「候補の対象かどうか」の照合にのみ使う）。
- NFR-2（エラー方針の一貫性）: 既存 `joinSession` と同一。セッションが存在しない → 404（`notFoundError`）、スコープ外（自チーム未割り当て / 非メンバー）→ 403（`forbiddenError`）。
- NFR-3（アーキテクチャ規約）: Handler → Service → Repository の層構造を厳守。ESM の相対 import は `.js` 拡張子必須。named export のみ（default export 禁止）。1 ファイル 1 ハンドラ。frontend/src/components はフラット構造厳守（サブディレクトリ禁止）。
- NFR-4（監査保持）: product.md「全書き込み操作（POST/PUT/DELETE）を記録、90日間保持」に従い、セルフ割り当て（POST）を監査ログに記録する。
- NFR-5（テスト）: steering の property-based test 対象（join 系に準じ participant 追加の冪等性等）。ユニット＋プロパティテストを co-located で追加する。
- NFR-6（アクセシビリティ）: 追加するフロントコンポーネントは vitest-axe で `toHaveNoViolations()` を満たす。

---

## 4. Technology Stack（確定・承認後ロック）

変更なし。既存スタックに完全準拠する。

- Backend: AWS Lambda（TypeScript, ESM）/ API Gateway HTTP API + JWT Authorizer（`APIGatewayProxyEventV2WithJWTAuthorizer`）/ DynamoDB 単一テーブル（`@aws-sdk/lib-dynamodb` の `docClient`）。
- Frontend: React 19 + TypeScript / react-router-dom v7 / 既存 `ApiClient` + `SessionApi`。
- Infra: AWS CDK（TypeScript）、`infra/lib/stacks/api-stack.ts` の既存ヘルパ（`createLambda` / `grantCommonPermissions` / `addRoute`）。
- DynamoDB テーブル名の環境変数は **`DYNAMODB_TABLE_NAME`**（実コード準拠。steering tech.md の `TABLE_NAME` 記述は実コードと不一致なので実コードに従う。`commonEnv` が自動付与する）。
- Test: Vitest + fast-check（backend）/ Vitest + RTL + vitest-axe（frontend）。

---

## 5. Technical Design

### 5.0 全体像

実装対象は以下。既存コードと同一パターンを踏襲し、新しい抽象や層を導入しない。

| # | 層 | 追加/変更 | ファイル |
|---|----|-----------|----------|
| 1 | Service | `listJoinableSessions(user)` 追加 | `backend/src/services/session-service.ts` |
| 2 | Service | `selfAssignSession(user, sessionId)` 追加 | `backend/src/services/session-service.ts` |
| 3 | Handler | 新規 `GET /sessions/joinable` | `backend/src/handlers/get-joinable-sessions.ts` |
| 4 | Handler | 新規 `POST /sessions/{sessionId}/self-assign` | `backend/src/handlers/post-session-self-assign.ts` |
| 5 | Infra | 新ルート 2 本 + Lambda 2 定義 | `infra/lib/stacks/api-stack.ts` |
| 6 | Frontend(API) | `listJoinableSessions` / `selfAssignSession` 追加 | `frontend/src/services/session-api.ts` |
| 7 | Frontend(導線) | 候補一覧 scope 追加 + ルート + ナビ | `frontend/src/App.tsx` / `frontend/src/components/Navigation.tsx` |
| 8 | Frontend(UI) | 参加ボタン表示条件の見直し | `frontend/src/components/SessionAssignmentControls.tsx` |

Repository 層は**追加・変更不要**。既存の `getSessionsByTeamId`（GSI1 TEAM# 列挙）、`getAllSessions`、`getSessionIdsByParticipantUserId`（GSI2 で呼び出し元の参加セッション ID を 1 クエリ取得）、`addParticipant`、`getSessionById`、`sortByCreatedAtDesc` と、`access-control-service` の `getUserTeamIds` / `isTeamMember` をそのまま再利用する。`selfAssignSession` の判定は `isTeamMember`、`listJoinableSessions` の未参加フィルタは `getSessionIdsByParticipantUserId` + Set 差分で行う。

---

### 5.1 Service: `listJoinableSessions(user: AuthUser): Promise<SessionRecord[]>`

場所: `backend/src/services/session-service.ts`（named export 追加）。

責務: 「呼び出し元 user が join できる候補 = 自チームに `assignedTeamId` で割り当てられた PENDING セッションのうち、自分が未参加のもの」を返す。

ロジック:

1. 母集合（候補セッション）を取得する。
   - 非 ADMIN: `teamIds = await getUserTeamIds(user.userId)`（DynamoDB ベース = 権限昇格防止の要）。各 `teamId` について `getSessionsByTeamId(teamId)`（GSI1、既存）でセッションを列挙し集約する。
   - ADMIN: 既存一覧系（`getAccessibleSessionIds` が ADMIN に `null` を返して全件、`getAllSessions`）に合わせ、`getAllSessions()` で全セッションを母集合にする（下記「ADMIN の扱い」参照）。
2. `Map<sessionId, SessionRecord>` で `sessionId` によって de-dup する（複数チーム所属・将来の再割り当てに備えた防御。下記「de-dup の必要性」参照）。
3. `status === 'PENDING'` のみ残す。
4. 自分が未参加のものに絞る（**確定した方式: 1 クエリ + Set 差分**）。
   - `const joinedIds = new Set(await getSessionIdsByParticipantUserId(user.userId))` を**1 回だけ**呼ぶ（GSI2 で呼び出し元が participant のセッション ID を 1 クエリ取得。既存 repository 関数）。
   - 候補のうち `joinedIds.has(sessionId) === false` のものだけ残す（メモリ上の Set 差分、O(候補数)）。
   - **`isParticipant` を候補ごとに N 回呼ぶ方式は採用しない。** これにより ADMIN パスでも「全件母集合 × GetCommand の N 連打」を避け、`getSessionIdsByParticipantUserId` の 1 クエリ + メモリ差分に置換する（finding 2/3 の確定事項）。
5. `createdAt` 降順でソートして返す（既存 `sortByCreatedAtDesc` を再利用）。

**なぜ Set 差分か（findings 2, 3 の確定）**: `isParticipant(sessionId, userId)` を候補ごとに呼ぶと、ADMIN パスでは母集合が全 PENDING セッションになり `GetCommand` が件数ぶん一斉発行される（スロットリング・コストリスク）。`getSessionIdsByParticipantUserId(userId)` は GSI2（`USER#{userId}` / `PARTICIPANT#` prefix）で「呼び出し元が参加しているセッション ID」を**1 クエリ**で返す既存関数であり、これを `Set` 化して候補集合から差し引けば、未参加フィルタが「1 追加クエリ + メモリ内差分」で済む。非 ADMIN・ADMIN いずれのパスでも同一の方式を使い、実装・テストのモック対象を単一化する。

**ADMIN の扱い（既存一覧系との整合）**: 既存 `getAccessibleSessionIds` は ADMIN に `null`（全件）、`get-sessions` は ADMIN で `getAllSessions()` を使う。これに合わせ、`listJoinableSessions` でも ADMIN は全セッション（`getAllSessions()`）から PENDING かつ未参加のものを候補にする。これにより「候補一覧」の可視範囲が既存の一覧 API と一貫する。未参加フィルタはステップ4のとおり `getSessionIdsByParticipantUserId` の 1 クエリ + Set 差分で行うため、ADMIN パスでも追加の DynamoDB 呼び出しは「`getAllSessions()` + 参加 ID の 1 クエリ」に限定され、候補件数ぶんの `GetCommand` 連打は発生しない。なお `getAllSessions()` は内部で `ALL_SESSIONS` GSI → Scan フォールバックを持つ既存実装であり、ADMIN 全件取得のコスト特性は既存 `get-sessions` の ADMIN パスと同一（本機能で新たな性能劣化を導入しない）。候補件数は小規模想定（Out of Scope 参照）。

**de-dup の必要性（エッジケース）**: `getUserTeamIds` が複数チームを返し、同一セッションが（理論上）複数チームにインデックスされるケースは現状の `createSession` では発生しない（1 セッション = 単一 `assignedTeamId`）が、`updateSessionAssignment` による再割り当てで GSI1 キーが張り替わるため、同一チーム内の列挙では重複は起きない。防御的に `Map<sessionId, SessionRecord>` で de-dup しておく（低コスト・将来の多重割り当て変更に強い）。

戻り値: `SessionRecord[]`（既存一覧系と同じ型）。

#### エラーハンドリング（Service 層）

| 失敗条件 | 分類 | 呼び出し元が受け取るもの | ログ |
|----------|------|--------------------------|------|
| `getUserTeamIds` / `getSessionsByTeamId` / `getAllSessions` / `getSessionIdsByParticipantUserId` の DynamoDB 例外 | 原因により回復不能 | 例外を throw（ハンドラが `internalError` で 500 に包む） | ハンドラ層でラップ時にメッセージ記録 |
| user が所属チーム 0 件（非 ADMIN） | 正常系 | 空配列 `[]`（エラーにしない） | なし |

- `listJoinableSessions` 自身は `AppError` を throw しない（純粋な読み取り。権限不足の概念がなく、「見える候補が無い」は空配列）。DynamoDB 例外のみ素通しし、ハンドラが 500 に包む。

#### 不変条件とその所有層

- 「候補は自チーム割り当て PENDING かつ未参加のみ」: Service 層が所有。`getUserTeamIds`（DB）を起点に `getSessionsByTeamId` + `status==='PENDING'` + `getSessionIdsByParticipantUserId` の Set 差分でのみ構成する。
- 「所属判定は DB ベース」: Service 層が `getUserTeamIds` を使うことで所有（NFR-1）。

---

### 5.2 Service: `selfAssignSession(user: AuthUser, sessionId: string): Promise<SessionRecord>`

場所: `backend/src/services/session-service.ts`（named export 追加）。

責務: Reviewer（および TEAM_LEADER / ADMIN）が自チーム割り当て PENDING セッションに自分を participant として登録する。ロジックは既存 `joinSession` と**実質同等**だが、「自動生成セッションのアップローダー以外の Reviewer がセルフで就く」ユースケースを明示する専用関数として分離する（調査の推奨に従う）。意図の明確化と、監査ログの `reason:'self-assign'` 区別のため。

ロジック（`joinSession` と同一方針）:

```
export async function selfAssignSession(user, sessionId):
  const session = await getSessionById(sessionId)
  if (!session) throw notFoundError('指定されたセッションが見つかりません。')   // 存在しない → 404

  if (!isAdmin(user)):                                                          // ADMIN は無条件
    if (!session.assignedTeamId)
      throw forbiddenError('このセッションはチームに割り当てられていません。')  // → 403
    const member = await isTeamMember(user.userId, session.assignedTeamId)      // DB ベース判定
    if (!member)
      throw forbiddenError('自チームに割り当てられたセッションのみ参加できます。')  // → 403

  const added = await addParticipant(sessionId, user.userId)                    // 冪等
  if (added):
    const refreshed = await getSessionById(sessionId)
    return refreshed ?? session
  return session
```

**`requireRole` は使わない**（REVIEWER を通すため）。これが `assignSession`（`requireRole(user,'TEAM_LEADER')` で REVIEWER を 403）との決定的な違い。

**判定を `joinSession` 相当にする理由**: `session.assignedTeamId` は「このセッションがどのチーム向けか」の属性であり、呼び出し元の所属を主張するものではない。実際の所属は `isTeamMember(user.userId, session.assignedTeamId)` が DynamoDB の `TEAM#{teamId} / MEMBER#{userId}` を引いて確認する。したがって `assignedTeamId` を信用しても権限昇格は起きない（攻撃者が任意の `assignedTeamId` を注入できる経路は無い。セッション属性はサーバ生成）。NFR-1 を満たす。

**ステータス前提**: 候補一覧（5.1）は PENDING のみを出すが、`selfAssignSession` 自体はステータスを問わない（join は IN_PROGRESS セッションにも後から参加でき、consensus 用に複数 Reviewer が参加するのは正常）。これは既存 `joinSession` と同じ挙動であり、意図的にステータス制約を課さない。

#### エラーハンドリング（Service 層）

| 失敗条件 | 分類 | 呼び出し元が受け取るもの | ログ |
|----------|------|--------------------------|------|
| セッションが存在しない | 回復不能（呼び出し側の誤り） | `notFoundError` → 404 | ハンドラは監査ログを記録しない（throw が先行） |
| `assignedTeamId` 未設定 / 非メンバー（非 ADMIN） | 回復不能（権限なし） | `forbiddenError` → 403 | 同上 |
| `addParticipant` の条件付き書き込み衝突（既に participant） | 正常系（冪等） | 既存 `session` を返す（例外にしない。`addParticipant` が内部で `false` を返す） | なし |
| DynamoDB 例外（`getSessionById` / `isTeamMember` / `addParticipant`） | 原因により回復不能 | 例外素通し（ハンドラが `internalError` で 500 に包む） | ハンドラ層で記録 |

- `addParticipant` は `ConditionalCheckFailedException` を内部で握って `false` を返す実装なので、再 join は 2xx + 既存セッション返却になる（冪等。reviewer count 二重計上なし）。

#### 不変条件とその所有層

- 「REVIEWER もセルフ割り当て可能だが、他チームには就けない」: Service 層が `isTeamMember`（DB）で所有。
- 「join は冪等」: Repository 層（`addParticipant` の `ConditionExpression`）が所有。
- 「404/403 の使い分け」: Service 層が所有（`joinSession` と一致）。

---

### 5.3 Handler: `GET /sessions/joinable`（`get-joinable-sessions.ts`）

場所: `backend/src/handlers/get-joinable-sessions.ts`（新規・1 ファイル 1 ハンドラ・named export `handler`）。

雛形は `get-assigned-sessions.ts`（候補の読み取り系・ペイロードなし）に倣う。

```ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { internalError } from '../utils/error-handler.js';
import { listJoinableSessions } from '../services/session-service.js';

/**
 * GET /sessions/joinable
 *
 * Returns PENDING sessions assigned to one of the caller's teams that the
 * caller has not yet joined — the candidates a reviewer can self-assign to.
 * - Any authenticated user may call this; scope is derived from DB team membership.
 * - ADMIN sees all PENDING sessions they have not joined.
 *
 * Response: { data: { items: SessionRecord[] } }
 */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    try {
      const items = await listJoinableSessions(user);
      return successResponse({ data: { items } });
    } catch (queryError: unknown) {
      // Let AppError (e.g. a future forbiddenError/validationError) propagate with its
      // own status instead of being swallowed into a 500. Harmless today because
      // listJoinableSessions throws only raw DynamoDB errors, but guards against regressions.
      if (queryError instanceof Error && 'statusCode' in queryError) {
        throw queryError;
      }
      throw internalError(
        '参加可能なセッションの取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
```

入力バリデーション: パスパラメータ・ボディなし。`event` から追加の入力は取らない。認証は JWT Authorizer + `extractUser` が担保。

レスポンス形: `{ data: { items: SessionRecord[] } }`（`get-assigned-sessions` と同形。フロントの `AssignedSessionsResponse` と同じ構造を再利用）。

#### エラーハンドリング（Handler 層）

| 失敗条件 | HTTP | 返却 | ログ |
|----------|------|------|------|
| Service が DynamoDB 例外を素通し | 500 | `errorResponse(internalError(...))`（`{ error: { code:'INTERNAL_ERROR', message, details } }`） | `internalError` の `details` に元メッセージを格納 |
| `extractUser` 失敗（認証不備） | 401/適宜 | `errorResponse(error)`（既存 `extractUser` の投げる AppError に従う） | — |

---

### 5.4 Handler: `POST /sessions/{sessionId}/self-assign`（`post-session-self-assign.ts`）

場所: `backend/src/handlers/post-session-self-assign.ts`（新規・1 ファイル 1 ハンドラ・named export `handler`）。

雛形は `post-session-join.ts`。相違点は (a) 呼ぶ Service が `selfAssignSession`、(b) 監査ログ metadata に `reason:'self-assign'` を付ける、の 2 点のみ。

```ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { validationError, internalError } from '../utils/error-handler.js';
import { selfAssignSession } from '../services/session-service.js';
import { recordAuditLog } from '../services/audit-service.js';

/**
 * POST /sessions/{sessionId}/self-assign
 *
 * Lets the authenticated reviewer self-assign (join) a PENDING session assigned
 * to one of their teams, without waiting for a TEAM_LEADER/ADMIN assignment.
 * - REVIEWER/TEAM_LEADER: only their team's sessions; ADMIN: any session.
 * - Idempotent (addParticipant). Records a REVIEW_ASSIGNMENT_CHANGE audit log.
 *
 * Response: { data: SessionRecord }
 */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      throw validationError('sessionId パスパラメータが必要です。');
    }

    try {
      const session = await selfAssignSession(user, sessionId);

      await recordAuditLog({
        actorUserId: user.userId,
        actorRole: user.role,
        operationType: 'REVIEW_ASSIGNMENT_CHANGE',
        resourceId: sessionId,
        resourceType: 'ReviewSession',
        metadata: { reason: 'self-assign' },
      });

      return successResponse({ data: session });
    } catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error) {
        throw error;   // AppError（404/403/400）はそのまま伝播
      }
      throw internalError(
        'セッションへの参加に失敗しました。',
        error instanceof Error ? error.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
```

#### 入力バリデーション

| 入力 | 必須/任意 | 型 | 制約 | 失敗時 |
|------|-----------|----|------|--------|
| `pathParameters.sessionId` | 必須 | string | 空不可 | `validationError`（400） |
| リクエストボディ | 任意 | — | 参照しない（`join` と同じく空ボディ） | — |

#### 監査ログの位置（重要・既存 join と一致）

- 監査ログは Service ではなく **ハンドラ層**で記録する（既存 `post-session-join.ts` と一致）。
- `selfAssignSession` が例外（404/403）を投げた場合、`recordAuditLog` には**到達しない**（失敗した割り当て試行は記録しない）。これは既存 join の挙動と一致。成功時（冪等な再 join 含む）のみ記録する。
- `actorRole` は `user.role`（`'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'`）。`RecordAuditLogParams.actorRole` の型と一致。

#### エラーハンドリング（Handler 層）

| 失敗条件 | HTTP | 返却 | ログ |
|----------|------|------|------|
| `sessionId` 欠落 | 400 | `errorResponse(validationError)` | — |
| Service が 404（存在しない） | 404 | `errorResponse(notFoundError)` | 監査ログ記録せず |
| Service が 403（スコープ外） | 403 | `errorResponse(forbiddenError)` | 監査ログ記録せず |
| DynamoDB 例外 | 500 | `errorResponse(internalError)` | `details` に元メッセージ |
| 成功（新規 join / 冪等 no-op） | 200 | `{ data: SessionRecord }` | `REVIEW_ASSIGNMENT_CHANGE` + `reason:'self-assign'` |

---

### 5.5 Infra: `infra/lib/stacks/api-stack.ts`（新ルート 2 本）

編集は **1 ファイルのみ**。`post-session-join` の雛形に倣い、Lambda 定義 2 本 + ルート 2 本を追加する。

**Lambda 定義**（`postSessionJoinFn` 定義の直後、`api-stack.ts` の 388 行付近に追加）:

```ts
const getJoinableSessionsFn = this.createLambda('GetJoinableSessions', {
  entry: handlersDir,
  description: 'GET /sessions/joinable - PENDING sessions a reviewer can self-assign to',
  environment: commonEnv,
});
this.grantCommonPermissions(getJoinableSessionsFn, props);

const postSessionSelfAssignFn = this.createLambda('PostSessionSelfAssign', {
  entry: handlersDir,
  description: 'POST /sessions/{sessionId}/self-assign - Reviewer self-assigns to a team session',
  environment: commonEnv,
});
this.grantCommonPermissions(postSessionSelfAssignFn, props);
```

- `createLambda` はクラス名を kebab-case 化してファイル名にする（`'GetJoinableSessions'` → `get-joinable-sessions.ts`、`'PostSessionSelfAssign'` → `post-session-self-assign.ts`）。ハンドラ export は `handler` 既定でよい（`fileName`/`exportedHandler` 上書き不要）。
- `commonEnv` を渡すだけで `DYNAMODB_TABLE_NAME` ほかが付く。追加の環境変数は不要。
- `grantCommonPermissions` が DynamoDB 読み書き + KMS を付与する。self-assign は DynamoDB 読み（session/membership）+ 書き（participant / reviewer count / audit log）+ KMS のみなので必要十分（最小権限）。各 Lambda は L3 construct `LambdaFunction` が個別 IAM ロールを生成する。

**ルート追加**（`// Sessions` ブロック内）:

```ts
// Register static /sessions/joinable BEFORE the greedy /sessions/{sessionId}.
this.addRoute('GET', '/sessions/joinable', getJoinableSessionsFn, jwtAuthorizer);
...
this.addRoute('POST', '/sessions/{sessionId}/self-assign', postSessionSelfAssignFn, jwtAuthorizer);
```

#### ルート衝突の検討（明記）

- `GET /sessions/joinable`: 静的セグメント `joinable` は `GET /sessions/{sessionId}` と同階層だが、API Gateway HTTP API（payload v2）は静的ルートをパス変数より優先解決するため誤マッチ（`{sessionId}="joinable"`）は起きず安全。可読性のため、既存の `/sessions/assigned`（「静的を greedy の前に登録せよ」コメント付き）の慣習どおり `GET /sessions` → `GET /sessions/assigned` → `GET /sessions/joinable` → `GET /sessions/{sessionId}` の順に並べる。
- `POST /sessions/{sessionId}/self-assign`: `{sessionId}` 配下のサブパス（静的末尾セグメント `self-assign`）であり、`/sessions/{sessionId}/join` 等と同列。greedy 衝突の懸念なし。登録順の特別対応は不要。

#### CDK 検証

- `cd infra && npm install && npx cdk diff --all` でルート・Lambda 追加を確認。
- `infra/test/` に CDK スナップショット / アサーションテストがある場合、Lambda 2 本 + ルート 2 本の追加でスナップショットが変化するため更新が必要になり得る。テスト実行で差分を確認し、意図した追加であることを確かめた上で更新する。

---

### 5.6 Frontend API client: `frontend/src/services/session-api.ts`

`SessionApi` クラスに 2 メソッドを追加する（既存 `claimSession` / `listAssignedSessions` を参考）。

```ts
/**
 * 自分が参加可能なセッション候補一覧を取得する（Reviewer）
 * GET /sessions/joinable
 */
async listJoinableSessions(): Promise<Result<JoinableSessionsResponse, AppError>> {
  return this.client.get<JoinableSessionsResponse>('/sessions/joinable');
}

/**
 * 自チームに割り当てられた PENDING セッションに自分で参加する（Reviewer）
 * POST /sessions/{sessionId}/self-assign
 */
async selfAssignSession(sessionId: string): Promise<Result<{ data: ReviewSession }, AppError>> {
  return this.client.post<{ data: ReviewSession }>(`/sessions/${sessionId}/self-assign`, {});
}
```

- レスポンス型 `JoinableSessionsResponse` は `AssignedSessionsResponse` と同形（`{ data: { items: ReviewSession[] } }`）。重複を避けるなら `AssignedSessionsResponse` を再利用してもよいが、意味を明確にするため同形の型 alias を追加する（`export type JoinableSessionsResponse = { data: { items: ReviewSession[] } }`）。
- `selfAssignSession` は空ボディ POST（`claimSession` と同じ）。

### 5.7 Frontend 導線: 候補一覧 scope の追加

既存 `SessionListPageWrapper` は `scope: 'all' | 'assigned'` を取る設計なので、**`scope` に `'joinable'` を追加**するのが既存パターンに最も素直（新ページを別途作らず、`SessionListPage` を再利用）。components はフラット構造厳守のため新コンポーネントは作らない。

変更点（`frontend/src/App.tsx`）:

1. `SessionListPageWrapper` の `scope` 型を `'all' | 'assigned' | 'joinable'` に拡張。
2. `loadSessions` に `joinable` 分岐を追加:
   ```ts
   if (scope === 'joinable') {
     const result = await sessionApi.listJoinableSessions();
     if (result.ok) { setSessions(result.value.data.items); setError(null); }
     else { setError({ message: result.error.message }); }
     return;
   }
   ```
3. 参加アクションのハンドラ `handleSelfAssign` を追加（`handleClaim` と対になる）:
   ```ts
   const handleSelfAssign = useCallback(async (sessionId: string) => {
     const result = await sessionApi.selfAssignSession(sessionId);
     if (!result.ok) throw new Error(result.error.message);
     await loadSessions();   // 成功後、候補から外れるよう再取得
   }, [sessionApi, loadSessions]);
   ```
4. `renderSessionActions` が `scope === 'joinable'` のとき `SessionAssignmentControls` に `onClaim={handleSelfAssign}` を渡す（＝「参加」導線をセルフ割り当て API に接続）。`scope` を `SessionAssignmentControls` に伝え、候補画面では「参加」ボタンの表示条件を 5.8 の新条件で評価する。
5. 新ルート `/joinable` を `AppRoutes` に追加（`/assigned` の隣）:
   ```tsx
   <Route path="/joinable" element={<>
     <Navigation {...navProps} />
     <SessionListPageWrapper getToken={auth.getToken} userRole={auth.user?.role}
       userId={auth.user?.userId} scope="joinable" title="参加可能なセッション" />
   </>} />
   ```
6. `frontend/src/components/Navigation.tsx` の `NAV_ITEMS` に `{ to: '/joinable', label: '参加可能なセッション' }` を追加（全ロールに表示。REVIEWER が主な利用者だが TEAM_LEADER/ADMIN も候補を見られてよい）。既存 `NAV_ITEMS` は `/`=「セッション一覧」・`/assigned`=「自分のタスク」等であり、新規項目はその並びに加える（既存ラベルは変更しない）。

**代替案の検討**: (A) `scope='joinable'` を既存 `SessionListPageWrapper` に追加して `SessionListPage` を再利用、(B) 専用の新ページ `JoinableSessionListPage.tsx` を作る。→ **(A) を採用**。理由: `/assigned` が既に同じ `SessionListPageWrapper` + `scope` + `title` パターンで実装されており、候補一覧も「セッションのリスト + 各項目にアクション」という同一構造。(B) はフラット components 制約下で新ページ追加の正当性が薄く、`SessionListPage` の責務と重複する。既存パターン踏襲で保守コストを最小化する。

### 5.8 Frontend UI: `SessionAssignmentControls.tsx` の参加ボタン条件見直し

現状 `const isClaimed = Boolean(session.assignedUserId)` のため、自動生成セッション（アップローダーが `assignedUserId`）では他 Reviewer に「引き受ける」ボタンが出ない（FR-6 の課題）。

変更方針（他画面を壊さないこと最優先）:

- `SessionAssignmentControlsProps` に任意の `scope?: 'all' | 'assigned' | 'joinable'`（または `showSelfAssign?: boolean`）を追加する。デフォルト未指定時は**現状の挙動を完全維持**（`onClaim && !isClaimed` でボタン表示 = 既存 `/` 一覧の挙動）。
- `scope === 'joinable'`（または `showSelfAssign === true`）のときのみ、ボタンの表示条件を「**自チーム割り当て済み PENDING かつ自分が未参加**」に差し替える:
  ```ts
  const alreadyMine = session.assignedUserId === currentUserId;
  const isJoinableCandidate =
    session.status === 'PENDING' &&
    Boolean(session.assignedTeamId) &&
    !alreadyMine;        // 自分がアップローダー/割り当て済みなら出さない
  ```
  - 「自分が未参加」の厳密判定は participant 情報が UI 側に無いため、候補一覧 API（`listJoinableSessions`）が既にサーバ側で「未参加」をフィルタ済み。したがって候補画面に出ているセッション = 未参加候補であり、UI は `isJoinableCandidate` の軽量条件で足りる。二重登録しても `addParticipant` が冪等なので安全。
  - ボタンのラベルは「参加」とする（`scope==='joinable'` 時）。既存 `/` の「引き受ける」ラベルは据え置き（破壊的変更を避ける）。ラベルは scope により出し分ける。
- 既存の「割り当て状態」表示文言（`isClaimed ? ... : session.assignedTeamId ? 'チーム … に割り当て（未引き受け）' : '未割り当て'`）はそのまま。候補画面でも「チーム … に割り当て（未引き受け）」相当の表示で意味が通る。

この変更は「default（scope 未指定）では既存挙動を 1 ビットも変えない」ことで `/` および `/assigned` 画面の回帰を防ぐ。新しい条件は候補画面でのみ有効化する。

---

## 6. Acceptance Criteria

1. REVIEWER が `GET /sessions/joinable` を呼ぶと、自分の DB 所属チームに `assignedTeamId` で割り当てられた **PENDING** セッションのうち、**自分が participant でないもの**だけが返る（`{ data: { items } }`）。
2. REVIEWER が既に参加しているセッションは `GET /sessions/joinable` の結果に**含まれない**。
3. 所属していないチームに割り当てられたセッションは `GET /sessions/joinable` の結果に**含まれない**（`getUserTeamIds` ベースのフィルタ）。
4. ADMIN が `GET /sessions/joinable` を呼ぶと、全 PENDING セッションのうち未参加のものが返る（既存一覧系の ADMIN 全件方針と一致）。
5. REVIEWER が自チーム割り当て PENDING セッションに `POST /sessions/{sessionId}/self-assign` すると 200 + `{ data: SessionRecord }` が返り、`addParticipant` により participant に登録され `assignedReviewerCount` が +1 される。
6. 同じ REVIEWER が同一セッションに `POST .../self-assign` を 2 回呼んでも 200 が返り、`assignedReviewerCount` は二重計上されない（冪等）。
7. 存在しない `sessionId` への `POST .../self-assign` は **404**（`NOT_FOUND`）を返す。
8. 自分の所属チームに割り当てられていない（または `assignedTeamId` 未設定の）セッションへの REVIEWER の `POST .../self-assign` は **403**（`FORBIDDEN`）を返す。
9. ADMIN は任意のセッションに `POST .../self-assign` でき、チーム所属に関係なく参加できる。
10. 成功した `POST .../self-assign`（新規 / 冪等 no-op いずれも）は監査ログに `operationType:'REVIEW_ASSIGNMENT_CHANGE'`, `resourceType:'ReviewSession'`, `metadata.reason:'self-assign'`, `actorUserId`, `actorRole` で 1 件記録される。失敗（404/403）時は記録されない。
11. `self-assign` ハンドラ・サービスは `getUserTeamIds` / `isTeamMember`（DynamoDB）で所属を判定し、JWT クレームや `session.assignedTeamId` を所属の証明として使わない（コードレビューで確認可能）。
12. フロントで `/joinable` ルートに遷移すると候補セッション一覧が表示され、各項目の「参加」ボタンから `selfAssignSession` が呼ばれ、成功後に一覧が再取得されて当該セッションが候補から消える。
13. 既存の `/`（全件一覧）・`/assigned`（ナビラベル「自分のタスク」）画面の `SessionAssignmentControls` の挙動は本変更で**変化しない**（scope 未指定時の既存条件を維持）。
14. バックエンド `cd backend && npx vitest --run` が通る（新規ユニット + プロパティテストを含む）。フロント `cd frontend && npx vitest --run` が通り、追加コンポーネントの vitest-axe が `toHaveNoViolations()`。
15. `cd infra && npx cdk diff --all` で新ルート 2 本 + Lambda 2 本の追加のみが差分に現れる（既存リソースの破壊的変更なし）。

---

## 7. Testing Strategy

### Backend（co-located, Vitest + fast-check）

- `backend/src/services/session-service.test.ts`（既存に追記）: `listJoinableSessions` / `selfAssignSession` のユニット。
  - **モック対象（確定）**: `vi.mock()` で `access-control-service`（`getUserTeamIds` / `isTeamMember`）と `session-repository`（`getSessionById` / `getSessionsByTeamId` / `getAllSessions` / `getSessionIdsByParticipantUserId` / `addParticipant`）をモックする。
  - **`isAdmin` はモックしない（finding 1 の確定）**: `isAdmin` は `backend/src/utils/auth-middleware.ts` の純関数（`user.role === 'ADMIN'`）であり、`session-service.ts` はそこから import している。`access-control-service` 経由でモックしても分岐に効かない。ADMIN 分岐は `user.role = 'ADMIN'`、非 ADMIN 分岐は `user.role = 'REVIEWER' | 'TEAM_LEADER'` を渡して実関数で検証する（既存 `session-service.test.ts` も `access-control-service` からは `getUserTeamIds` / `isTeamMember` のみをモックしており、この方針と一致）。
  - **未参加フィルタのモックは `getSessionIdsByParticipantUserId`（`isParticipant` ではない）**: 5.1 ステップ4 で確定した Set 差分方式に合わせ、参加済み sessionId 配列を返すよう `getSessionIdsByParticipantUserId` をモックする。`isParticipant` は本機能では使わないためモック対象に含めない。
  - `selfAssignSession`: 404（存在しない）、403（非メンバー / `assignedTeamId` 未設定）、ADMIN 無条件成功（`user.role='ADMIN'`）、REVIEWER 自チーム成功、冪等（`addParticipant` が `false` → 既存 session 返却）。
  - `listJoinableSessions`: PENDING 以外を除外、`getSessionIdsByParticipantUserId` が返す参加済みを除外、他チームを除外、ADMIN 全件（`getAllSessions` + 参加 Set 差分）、所属 0 件 → 空配列、de-dup。
- `backend/src/services/session-service.property.test.ts`（新規または既存に追記, `{ numRuns: 100 }`）:
  - Property（冪等性）: 任意の user/sessionId で `selfAssignSession` を 2 回呼んでも participant 集合・reviewer count が 1 回呼び出しと同一（`addParticipant` モックの冪等性で表現）。**Validates: FR-2**。
  - Property（スコープ健全性）: 任意のチーム集合に対し、`listJoinableSessions` の結果は常に「user の所属チームに割り当てられた PENDING かつ未参加」の部分集合（他チーム・非 PENDING・参加済みを含まない）。**Validates: FR-1, NFR-1**。
- `backend/src/handlers/post-session-self-assign.test.ts`（新規）: `vi.mock()` で `session-service.selfAssignSession` と `audit-service.recordAuditLog` をモック。sessionId 欠落 → 400、成功時に監査ログが `reason:'self-assign'` 付きで 1 回呼ばれる、Service が投げた 403/404 がそのまま伝播し監査ログが呼ばれないこと、を検証。
- `backend/src/handlers/get-joinable-sessions.test.ts`（新規）: Service をモックし、`{ data: { items } }` を返すこと、Service 例外時に 500（`internalError`）になることを検証。

### Frontend（Vitest + RTL + vitest-axe）

- `frontend/src/services/session-api.test.ts`（既存に追記）: `listJoinableSessions` が `GET /sessions/joinable`、`selfAssignSession` が `POST /sessions/{id}/self-assign` を正しく叩くこと（`ApiClient` モック）。
- `frontend/src/components/SessionAssignmentControls.test.tsx`（既存に追記）:
  - scope 未指定時に既存挙動（`!isClaimed` でボタン表示）が変わらないこと（回帰防止）。
  - `scope='joinable'` 時、自動生成セッション（`assignedUserId` あり・`status='PENDING'`・`assignedTeamId` あり・自分以外）で「参加」ボタンが表示され `onClaim` が呼ばれること。自分がアップローダーのセッションでは出ないこと。
  - `toHaveNoViolations()`。

### テスト可能性メモ

- Service はすべて repository / access-control をモックしてユニットテスト可能（純粋なオーケストレーション）。
- participant「未参加」フィルタの正確性（GSI2 整合）は LocalStack 統合テスト領域だが、本機能は既存 `addParticipant` / `getSessionIdsByParticipantUserId` を再利用するため、既存の統合テスト範囲で十分。新規統合テストは必須としない（必要なら `backend/src/__tests__/integration/` に `self-assign.integration.test.ts` を追加可能）。

---

## 8. Out of Scope

- `SessionRecord` 型への `transcriptionJobId` 追加（調査で指摘の型漏れ）。本機能は MediaFile / ジョブ逆引きを使わないため不要。別タスク。
- 自動生成 PENDING セッションを既存 `GET /sessions`（`getAccessibleSessionIds`）に乗せる改修。候補は専用 `GET /sessions/joinable` 経路で扱う方針のため、`getAccessibleSessionIds` は変更しない。
- セルフ割り当ての「取り消し（leave / un-participate）」API。既存にも leave 操作は無く、本機能の要求範囲外。
- セッションステータス遷移（PENDING→IN_PROGRESS）の自動化。join はステータスを変えない（既存 join と同じ）。
- 候補一覧のページネーション API 化。既存 `SessionListPage` のクライアント側ページングを流用する（`get-sessions` のサーバページングは踏襲しない。候補件数は小規模想定）。
- WAF / IP 制限・ランキング・consensus 等、本導線に直接関係しない機能。

---

## 9. 設計上の重点（レビュー観点サマリ）

- **権限昇格が起きない設計**: 所属判定は必ず `getUserTeamIds(user.userId)` / `isTeamMember(user.userId, session.assignedTeamId)`（ともに DynamoDB 参照）で行う。`session.assignedTeamId` は「対象セッションの属性」であってサーバ生成であり、呼び出し元が注入できないため、これを照合に使っても昇格経路にならない。JWT の `custom:*` クレームを所属の証明として使わない。
- **404/403 の一貫性**: 存在しない → 404、スコープ外 → 403。既存 `joinSession` と完全一致。`selfAssignSession` は `joinSession` と同じ判定順序・同じエラー種別。
- **層構造の遵守**: Handler（入力抽出・監査ログ・レスポンス整形）→ Service（`listJoinableSessions` / `selfAssignSession` のビジネスロジック）→ Repository（既存の `getSessionsByTeamId` / `getAllSessions` / `getSessionIdsByParticipantUserId` / `addParticipant` / `getSessionById`）。Handler は Repository を直接呼ばない。
- **ESM `.js` 拡張子 / named export / 1 ファイル 1 ハンドラ**: 新規ハンドラ 2 本は `export async function handler` のみ、相対 import はすべて `.js`。
- **components フラット構造**: 新規コンポーネントは作らず、既存 `SessionListPage` / `SessionAssignmentControls` を scope 分岐で再利用。
- **監査ログ**: product.md「全書き込み操作を記録」に従い、成功した self-assign を `REVIEW_ASSIGNMENT_CHANGE` + `reason:'self-assign'` で記録（ハンドラ層、既存 join と同位置）。

---

## 10. Design Review 対応（イテレーション2）

`self-assign-design-review.json`（verdict: CHANGES_REQUESTED / HIGH 0・MEDIUM 3・NIT 4）の各 finding への対応。実コードで裏付けを取った上で設計へ反映した。

| # | Severity | 指摘 | 対応 |
|---|----------|------|------|
| 1 | MEDIUM | テスト計画が `isAdmin` を誤ったモジュール（access-control-service）からモックすると指示 | **解消（修正）**。`isAdmin` は `backend/src/utils/auth-middleware.ts` の純関数で `session-service` がそこから import していることを実コードで確認（`import { isAdmin, requireRole, type AuthUser } from '../utils/auth-middleware.js'`）。7. Testing Strategy を「`isAdmin` はモックしない。ADMIN 分岐は `user.role='ADMIN'` を渡して実関数で検証」に差し替え。モック対象から `isAdmin` を除外。 |
| 2 | MEDIUM | `listJoinableSessions` の ADMIN パスで未参加フィルタの件数・コストが未規定（全件 × GetCommand） | **解消（方式変更: レビュー推奨 (b) を採用）**。未参加フィルタを `isParticipant` の N 連打から `getSessionIdsByParticipantUserId(user.userId)`（GSI2 で参加セッション ID を 1 クエリ取得）+ メモリ内 Set 差分に変更。5.1 ステップ4・ADMIN の扱い・不変条件に明記。ADMIN パスの追加 DynamoDB 呼び出しは「`getAllSessions()` + 参加 ID 1 クエリ」に限定され、候補件数ぶんの GetCommand 連打は発生しない。候補小規模前提も明記。 |
| 3 | MEDIUM | 未参加フィルタの実装手段が本文（`isParticipant`）と既存資産（`getSessionIdsByParticipantUserId`）で未統一・曖昧 | **解消（単一化）**。方式を `getSessionIdsByParticipantUserId` + Set 差分の 1 つに確定。本文（5.1）・テストのモック対象（7.）・repository 再利用一覧（5.0）・不変条件・テスト可能性メモの `isParticipant` 参照をすべて `getSessionIdsByParticipantUserId` に統一。`isParticipant` は本機能では使わない旨を明記。 |
| 4 | NIT | `get-joinable-sessions.ts` の二重 try/catch が将来 Service の AppError を 500 に握り潰す | **解消（任意だが採用）**。5.3 ハンドラ雛形の内側 catch 先頭に `if (queryError instanceof Error && 'statusCode' in queryError) throw queryError;` ガードを追加（`post-session-self-assign` と同パターン、将来退行防止）。 |
| 5 | NIT | FR-3 の「REVIEWER を 403 しない」の表現ぶれ | **解消（補強）**。FR-3 に「ロールに依らず入口では拒否せず（`requireRole` を使わない）、非 ADMIN は自チーム割り当てセッションに限りチームメンバーシップ（DB）で許可」「403 はロール不足ではなくチームスコープ外による拒否」を明記。 |
| 6 | NIT | ルート衝突説明が冗長 | **解消（圧縮）**。5.5 の `GET /sessions/joinable` 説明を「HTTP API は静的優先で安全。可読性のため既存慣習どおり `/sessions`→`/sessions/assigned`→`/sessions/joinable`→`/sessions/{sessionId}` の順に並べる」の 1 文に圧縮。 |
| 7 | NIT | Navigation ラベルの既存文言と設計本文の不一致（表記ゆれ） | **解消（整合）**。実 `NAV_ITEMS` の `/assigned` ラベルが「自分のタスク」であることを確認し、受け入れ基準13・5.7 ステップ6 の参照を実ラベルに合わせた（新規 `/joinable` ラベル「参加可能なセッション」は据え置き）。 |

全 MEDIUM / NIT を解消済み。設計の骨格（権限昇格防止・join 候補経路・404/403・層構造）はレビューで「実コードと整合・健全」と評価されており、本イテレーションでの変更はテスト計画の正確化と未参加フィルタ方式の確定・文言整合に限定している。
