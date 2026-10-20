# Reviewer Transcription View Fix Bugfix Design

## Overview

校閲画面（ReviewPage）で、ADMIN 以外のユーザー（REVIEWER / TEAM_LEADER）が、正当なアクセス権を持つセッションを開いてもトランスクリプション（文字起こしセグメント）が表示されない不具合を修正する。

校閲画面はセグメント取得 API（`GET /sessions/{sessionId}/segments`、`backend/src/handlers/get-segments.ts`）とセッション詳細 API（`GET /sessions/{sessionId}`、`backend/src/handlers/get-session-detail.ts`）を呼び出す。両ハンドラはいずれも `extractUser(event)` で呼び出しユーザーを解決し、`checkSessionAccess(user, sessionId)` でチーム／直接割り当てに基づくアクセス可否を判定する。ADMIN は `checkSessionAccess` 内で `isAdmin(user)` により DynamoDB 照会を行わず即座に許可されるため正常にセグメントを閲覧できるが、非 ADMIN ユーザーはアクセス判定の DynamoDB 照会が必ず不一致となり、`denyResourceAccess()` によって 404 が返り、セグメント・セッション詳細のいずれも表示されない。

根本原因は、アクセス判定で用いるユーザー識別子（`AuthUser.userId`）と、チーム所属（TeamMembership）および担当（ReviewAssignment / TeamAssignment）レコードがキーとして保持するユーザー識別子が一致しないことにある。`extractUser` は JWT に有効な `custom:role` クレームがある場合、`userId` に Cognito の `sub`（UUID）をそのまま採用する。一方、ユーザーレコード・TeamMembership・ReviewAssignment は DynamoDB 側で採番された `userId`（`uuidv4()`、Cognito `sub` とは無関係）をキーに書き込まれる。この結果、`checkSessionAccess` → `userHasSessionAccess(user.userId, sessionId)` は `USER#{sub}` を探索するが、実レコードは `USER#{dynamoDbUserId}` に存在するため一致せず、正当なアクセス権を持つ非 ADMIN ユーザーでも 404 になる。

本修正は、アクセス判定に用いるユーザー識別子を、割り当て・所属レコードが保持する正規の DynamoDB `userId` に一致させることで、正当なアクセス権を持つ非 ADMIN ユーザーがセグメントとセッション詳細を閲覧できるようにする。ADMIN の閲覧、アクセス権のない利用者の遮断、`custom:role` を持たない共有プール経路の挙動は変更しない。

### 関連スペックとの整合（reviewer-media-playback-fix）

本バグは、別スペック **`reviewer-media-playback-fix`** と**同一の根本原因**（`extractUser` が `custom:role` 経路で `AuthUser.userId` に Cognito `sub` を採用し、DynamoDB の正規 `userId` と不整合になる）に起因する。両スペックは症状が異なるだけで、同じ `checkSessionAccess` 経由のアクセス判定が同じ識別子不整合によって失敗している。

- **`reviewer-media-playback-fix`**: `GET /sessions/{sessionId}/media-url` で署名付き URL を取得できず、メディアプレイヤーが表示されない。
- **本スペック（`reviewer-transcription-view-fix`）**: `GET /sessions/{sessionId}/segments` と `GET /sessions/{sessionId}` でセグメント・セッション詳細が表示されない。

**整合方針**: どちらのスペックも修正対象は `backend/src/utils/auth-middleware.ts` の `extractUser` 1 箇所であり、**単一の修正で両方のバグが同時に解消される見込みが高い**。重複・競合を避けるため、本修正は新たなコードパスを追加せず、`reviewer-media-playback-fix` の design.md で定義された `extractUser` の識別子正規化方針と**同一の変更**を採用する。実装時にいずれか一方のスペックが先に `extractUser` を修正済みの場合、本スペックでは新規実装を行わず、その修正を前提にセグメント／セッション詳細経路の検証（テスト）を行う。両スペックのテストは対象エンドポイントが異なるため共存可能であり、`extractUser` 自体のユニット／プロパティテストは重複定義を避けて 1 箇所に集約する。

## Glossary

- **Bug_Condition (C)**: バグが発動する条件 — 非 ADMIN ユーザーが、正当なアクセス権（自分への直接割り当て、または自チームへのセッション割り当て）を持つセッションの校閲画面を開く際、アクセス判定に用いる識別子が割り当て・所属レコードのキー識別子と一致せず、アクセスが誤って拒否（404）され、セグメント・セッション詳細が表示されない状態。
- **Property (P)**: バグ入力に対する望ましい挙動 — 正当なアクセス権を持つ非 ADMIN ユーザーのアクセス判定が成功し、セグメント取得 API がセグメントを返し、セッション詳細 API がセッション詳細を返す。
- **Preservation**: 本修正で変更してはならない既存挙動 — ADMIN の閲覧許可、アクセス権のない利用者の 404 遮断、`custom:role` を持たない共有プール経路の `userId`／ロール解決・JIT プロビジョニング・無効化チェック、解決後のロール値、`email`／`displayName` の設定。
- **Cognito sub**: Cognito が発行する不変のユーザー識別子（UUID）。JWT の `sub` クレームに入る。
- **DynamoDB userId**: DynamoDB ユーザーレコードの正規 ID（`uuidv4()`）。ユーザー作成時（`admin-users.ts` / `admin-sync-user.ts` / `provisionUserOnFirstLogin`）に Cognito `sub` とは独立に採番される。TeamMembership（`GSI1PK=USER#{userId}`）・ReviewAssignment（`PK=USER#{userId}`）のキーに使われる識別子。
- **extractUser**: `backend/src/utils/auth-middleware.ts` の関数。JWT クレームから `AuthUser`（`userId`, `email`, `displayName`, `role`）を解決する。本バグの修正対象。
- **checkSessionAccess**: `backend/src/services/access-control-service.ts` の関数。ADMIN は即許可、非 ADMIN は `userHasSessionAccess(user.userId, sessionId)` の結果で許可／`denyResourceAccess()`（404）を判定する。
- **AuthUser.userId**: アクセス判定の起点となるユーザー識別子。本バグの中心となる値。
- **関連スペック (reviewer-media-playback-fix)**: 同一の `extractUser` 識別子不整合に起因する、メディア再生側のバグ修正スペック。本修正と同一変更で解消される見込み。

## Bug Details

### Bug Condition

バグは、非 ADMIN ユーザー（REVIEWER / TEAM_LEADER）が、割り当て上は正当なアクセス権を持つセッションの校閲画面を開き、セグメント取得 API またはセッション詳細 API を呼び出すときに発動する。`extractUser` が JWT の `custom:role` クレーム経由で `AuthUser.userId` に Cognito `sub` を設定する一方、TeamMembership／ReviewAssignment は DynamoDB `userId` をキーに保持しているため、`checkSessionAccess` の DynamoDB 照会が必ず不一致となり、本来許可すべきアクセスが 404 で拒否される。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { claims, dynamoUserRecord, sessionId }
  OUTPUT: boolean

  RETURN isValidRole(input.claims['custom:role'])                                  // 有効な custom:role を持つ JWT 経路
         AND input.claims['custom:role'] != 'ADMIN'                                // 非 ADMIN
         AND hasLegitimateAccess(input.dynamoUserRecord.userId, input.sessionId)   // 正規IDでは割り当て・所属が存在
         AND input.claims['sub'] != input.dynamoUserRecord.userId                  // 判定に使う識別子が正規IDと不一致
         AND accessCheckDeniesAccess(input.claims['sub'], input.sessionId)         // 実際のアクセス判定は拒否(404)
END FUNCTION
```

ここで `hasLegitimateAccess(userId, sessionId)` は直接割り当て（ReviewAssignment、`PK=USER#{userId}` / `SK=ASSIGNMENT#{sessionId}`）または自チームへのセッション割り当て（TeamAssignment + TeamMembership、`GSI1PK=USER#{userId}`）の存在を表す。`accessCheckDeniesAccess(id, sessionId)` は `userHasSessionAccess(id, sessionId)` が false を返し `denyResourceAccess()`（404）に至ることを表す。

### Examples

- **直接割り当ての REVIEWER**: Admin が REVIEWER（DynamoDB `userId = u-123`）にセッション `sess-A` を直接割り当て済み。REVIEWER がログインし JWT の `sub = cognito-xyz`、`custom:role = REVIEWER` で校閲画面を開く → 期待: `GET /sessions/sess-A/segments` がセグメントを返す / 実際: `USER#cognito-xyz` に割り当てが無く 404 となり、セグメントが表示されない。
- **自チーム割り当ての TEAM_LEADER**: TEAM_LEADER（DynamoDB `userId = u-456`）が `team-1` のメンバーで、`team-1` にセッション `sess-B` が割り当て済み。JWT の `sub = cognito-abc` で校閲画面を開く → 期待: `GET /sessions/sess-B/segments`・`GET /sessions/sess-B` が成功する / 実際: `getUserTeamIds(cognito-abc)` が空で、チーム照会も不一致のため両 API が 404。
- **セッション詳細経路（REVIEWER）**: 上記 REVIEWER が `GET /sessions/sess-A`（セッション詳細）を呼ぶ → 期待: セッション詳細を返す / 実際: 同一の `checkSessionAccess` 不一致により 404。
- **ADMIN（対照）**: ADMIN が同じ `sess-A` の校閲画面を開く → `checkSessionAccess` が即許可し、セグメントとセッション詳細を返す（バグの影響を受けない）。
- **エッジケース — アクセス権のない REVIEWER**: どのチームにも属さず直接割り当ても無い REVIEWER → 正規 ID で判定しても割り当てが存在しないため 404（これは正しい挙動であり、修正後も維持すべき）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- ADMIN が任意のセッションの校閲画面を開いたときのセグメント・セッション詳細の表示（Req 3.1）。
- 担当もチーム所属経由の割り当ても持たない非 ADMIN ユーザーに対する 404 遮断（リソース存在の隠蔽、Req 3.2）。
- `custom:role` クレームを持たないユーザー（共有プール経路）の、DynamoDB ユーザーレコードからのロール・`userId` 解決、JIT プロビジョニング、無効化アカウントのチェック（Req 3.3）。
- `extractUser` が有効な `custom:role` クレームを処理する際に、解決したロールを `AuthUser.role` として返すこと（Req 3.4）。
- いずれのロールのユーザーでも `email` および `displayName` を `AuthUser` に設定すること（Req 3.5）。

**Scope:**
バグ条件（有効な `custom:role` を持つ非 ADMIN ユーザーで、正規 ID では正当なアクセス権を持つケース）に該当しない入力は、本修正の影響を受けない。具体的には以下を含む:
- ADMIN によるすべてのアクセス判定（`checkSessionAccess` の早期リターン経路は不変）。
- 正規 ID で判定しても割り当て・所属が存在しない非 ADMIN ユーザー（引き続き 404）。
- `custom:role` を持たない共有プール経路（`userId = userRecord.userId` のため、もともと割り当てキーと整合しており挙動不変）。
- セグメント取得 API・セッション詳細 API のアクセス判定以外のロジック（DynamoDB セグメント照会、メディアファイルメタデータ付与、エラー整形など）。本修正はアクセス判定の識別子解決のみを対象とし、ハンドラ本体のクエリロジックには触れない。

本修正の期待される正しい挙動の本体は Correctness Properties の Property 1 に定義する。本節は「変更してはならない挙動」に焦点を当てる。

## Hypothesized Root Cause

バグ記述とコード調査（`auth-middleware.ts`, `access-control-service.ts`, `get-segments.ts`, `get-session-detail.ts`, `user-service.ts`, `admin-users.ts`）に基づく最有力の原因は以下。

1. **アクセス判定識別子の不整合（最有力）**: `extractUser` は JWT に有効な `custom:role` がある場合、`userId = claims['sub']`（Cognito sub）を返す（`auth-middleware.ts` の `if (isValidRole(jwtRole)) { return { userId, ... } }` 経路）。一方、ユーザーレコード・TeamMembership・ReviewAssignment は DynamoDB `userId`（`uuidv4()`、`admin-users.ts` / `provisionUserOnFirstLogin` で Cognito `sub` とは独立に採番）をキーに保持する。
   - セグメント取得・セッション詳細の両ハンドラが呼ぶ `checkSessionAccess` → `userHasSessionAccess(user.userId, sessionId)` は `hasReviewAssignment`（`PK=USER#{userId}`）と `isSessionAssignedToUserTeams`→`getUserTeamIds`（`GSI1PK=USER#{userId}`）を参照する。
   - `user.userId = sub` のため両照会が常に不一致となり、割り当てが実在しても 404 になる。
   - ADMIN は `isAdmin(user)` の早期リターンで照会を行わないため、この不整合の影響を受けない（ADMIN だけ成功する症状と一致）。

2. **リポジトリのキースキーマ自体の不整合（反証済みの可能性）**: 書き込み側（チーム／割り当てリポジトリ）と読み取り側（`access-control-service.ts`）のキー構成（`PK=USER#{userId}` / `SK=ASSIGNMENT#{sessionId}`、`GSI1PK=USER#{userId}` / `GSI1SK=TEAM#{teamId}`）は一致している。したがってスキーマ定義そのものの齟齬ではなく、「キーに入れる識別子の値（sub か DynamoDB userId か）」の齟齬である。探索テストでこの切り分けを確認する。

3. **DynamoDB フォールバック経路の相対的健全性**: JWT に `custom:role` が無い共有プール経路では `userId = userRecord.userId`（DynamoDB userId）となり、割り当てキーと整合する。したがってバグは主に `custom:role` を持つ JWT 経路で顕在化すると想定される。

4. **関連スペックとの同一原因性**: `reviewer-media-playback-fix` で確認されているメディア URL 取得失敗も、同じ `extractUser` 識別子不整合に起因する。セグメント・セッション詳細・メディア URL の 3 経路はすべて同一の `checkSessionAccess` を通るため、`extractUser` の識別子正規化で 3 経路すべてが同時に解消される見込みが高い。

## Correctness Properties

Property 1: Bug Condition - 正当なアクセス権を持つ非 ADMIN ユーザーのトランスクリプション閲覧

_For any_ 入力でバグ条件が成立する場合（isBugCondition が true を返す、すなわち有効な `custom:role` を持つ非 ADMIN ユーザーが、正規ユーザー識別子では直接割り当てまたは自チーム割り当てによりアクセス権を持つセッションの校閲画面を開く場合）、修正後の処理は SHALL `extractUser` が DynamoDB の正規 `userId` を `AuthUser.userId` として解決し（ロールは `custom:role` を採用）、`checkSessionAccess` が成功して、セグメント取得 API（`GET /sessions/{sessionId}/segments`）は当該セッションのセグメントを返し、セッション詳細 API（`GET /sessions/{sessionId}`）はセッション詳細を返す。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - バグ条件外の認証・アクセス判定挙動の維持

_For any_ 入力でバグ条件が成立しない場合（isBugCondition が false を返す、すなわち ADMIN による要求、正規識別子でも割り当て・所属が存在しない非 ADMIN による要求、`custom:role` を持たない共有プール経路など）、修正後の処理は SHALL 修正前と同一の結果を生成し、ADMIN の閲覧許可・アクセス権なしの 404 遮断・共有プール経路の `userId`／ロール解決・JIT プロビジョニング・無効化チェック・解決後ロール値・`email`／`displayName` 設定を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

根本原因分析（アクセス判定識別子の不整合）が正しいと仮定した場合の変更方針。本変更は `reviewer-media-playback-fix` の `extractUser` 変更方針と同一であり、両スペックで重複・競合しないよう **`extractUser` の単一箇所のみ**を対象とする。

**File**: `backend/src/utils/auth-middleware.ts`

**Function**: `extractUser`

**Specific Changes**:
1. **識別子の正規化**: `AuthUser.userId` が常に割り当て・所属レコードのキーと一致する正規の DynamoDB `userId` になるよう解決する。JWT の `custom:role` 経路でも `email` クレームから DynamoDB ユーザーレコードを解決し、その `userRecord.userId` を `AuthUser.userId` に採用する（`sub` をそのまま使わない）。`role` は従来どおり有効な `custom:role` を優先して採用する（Req 2.4）。
2. **既存レコードが無い場合の整合**: レコードが存在しない場合は現行の JIT プロビジョニング（`provisionUserOnFirstLogin`）に委譲し、採番済みの DynamoDB `userId` を返す。これにより新規・既存のいずれでも識別子が一貫する。
3. **ADMIN 経路の不変性**: `isAdmin` 判定と `checkSessionAccess` の早期リターン経路は変更しない（ADMIN の閲覧挙動を保持、Req 3.1）。
4. **共有プール経路の不変性**: `custom:role` を持たないユーザーの `userId`／ロール解決・JIT プロビジョニング・無効化チェックは現行どおり維持する（Req 3.3）。`email` クレーム欠如時の 403、無効化アカウント（`isActive=false`）の 403 も維持する。
5. **ロール・プロフィールの維持**: 解決したロールを `AuthUser.role` として返し（Req 3.4）、`email` と `displayName` を `AuthUser` に設定する（Req 3.5）。識別子解決のための追加照会はアクセス判定前に一度で完結させ、既存ハンドラ（`get-segments.ts` / `get-session-detail.ts` 等）には変更を加えない。

> 備考: 代替案として `access-control-service` 側で `sub → DynamoDB userId` の解決を行う方法もあるが、識別子は `extractUser` が返す `AuthUser` の単一責務とするのが最も影響範囲が小さく、他のアクセス判定（`getAccessibleSessionIds`, `checkLanguageModelAccess`, `isTeamMember` 等）および関連スペック `reviewer-media-playback-fix` のメディア URL 経路とも一貫する。探索テストの結果に応じて最終的な変更箇所を確定する。`reviewer-media-playback-fix` が先に `extractUser` を修正済みの場合、本スペックでは同一変更を再実装せず、セグメント／セッション詳細経路の検証に注力する。

## Testing Strategy

### Validation Approach

テスト戦略は二段階で進める。まず未修正コード上でバグを再現する反例を表面化させ、根本原因（識別子の不整合）を確認または反証する。次に修正が正しく機能し、バグ条件外の既存挙動を保持することを検証する。`extractUser` 自体のユニット／プロパティテストは関連スペックと重複しないよう 1 箇所に集約し、本スペックではセグメント取得 API・セッション詳細 API 経路の検証を中心に据える。

### Exploratory Bug Condition Checking

**Goal**: 修正前に、バグを示す反例を表面化させる。根本原因分析（`AuthUser.userId` が Cognito `sub` で、割り当て・所属キーの DynamoDB `userId` と不一致）を確認する。反証された場合は再仮説を立てる。

**Test Plan**: `custom:role` 付き JWT を持つ非 ADMIN ユーザーについて、DynamoDB 上に正規 `userId` キーで割り当て（ReviewAssignment）／所属（TeamMembership + TeamAssignment）が存在する状況を用意し、未修正の `extractUser` + `checkSessionAccess` 経由でセグメント取得 API・セッション詳細 API を呼び出す。未修正コードで 404 になることを観測し、識別子の不一致が原因であることを確認する。

**Test Cases**:
1. **直接割り当て REVIEWER のセグメント取得テスト**: `sub != dynamoDbUserId` の REVIEWER に `USER#{dynamoDbUserId}` で ReviewAssignment を設定し、`GET /sessions/{sessionId}/segments` が 404 になることを観測する（未修正コードで失敗する想定）。
2. **自チーム割り当て TEAM_LEADER のセグメント取得テスト**: `sub != dynamoDbUserId` の TEAM_LEADER を `USER#{dynamoDbUserId}` キーでチームに所属させ、同チームにセッションを割り当て、`GET /sessions/{sessionId}/segments` が 404 になることを観測する（未修正コードで失敗する想定）。
3. **セッション詳細取得テスト**: 上記いずれかの非 ADMIN ユーザーで `GET /sessions/{sessionId}` が 404 になることを観測する（未修正コードで失敗する想定）。
4. **識別子一致の対照テスト**: フォールバック経路（`custom:role` 無し）など `userId = dynamoDbUserId` となる場合にアクセスが許可されセグメントが返ることを観測し、原因が識別子の値の不一致であることを切り分ける。
5. **エッジケース — ADMIN**: ADMIN では未修正コードでもセグメント・セッション詳細が返ることを確認し、バグが非 ADMIN 経路に限定されることを示す。

**Expected Counterexamples**:
- 正規 `userId` キーで割り当て・所属が実在するにもかかわらず、`sub` ベースの照会が不一致となり 404 が返り、セグメント・セッション詳細が表示されない。
- 想定原因: `extractUser` が `custom:role` 経路で `userId = sub` を返す／割り当て・チーム所属は DynamoDB `userId` をキーに保持。

### Fix Checking

**Goal**: バグ条件が成立するすべての入力について、修正後の処理が期待挙動（正規 `userId` 解決 → アクセス許可 → セグメント／セッション詳細の返却）を返すことを検証する。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  user := extractUser_fixed(input)
  ASSERT user.userId == input.dynamoUserRecord.userId
  ASSERT user.role   == input.claims['custom:role']
  ASSERT checkSessionAccess(user, input.sessionId) succeeds   // no 404
  ASSERT getSegments(input.sessionId) returns segments
  ASSERT getSessionDetail(input.sessionId) returns session detail
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しないすべての入力について、修正後の処理が修正前と同一の結果を返すことを検証する。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT extractUser_original(input) = extractUser_fixed(input)
END FOR
```

**Testing Approach**: プロパティベーステスト（fast-check）を用いる。理由:
- 入力領域（ロール、`custom:role` の有無、識別子一致／不一致、割り当て・所属の有無、無効化状態）を横断して多数のケースを自動生成できる。
- 手動テストが見落としやすいエッジケースを捕捉できる。
- バグ条件外のすべての入力で挙動が不変であることを強く保証できる。

**Test Plan**: 未修正コードで ADMIN 許可・アクセス権なし 404・共有プール経路の `userId`／ロール解決・JIT プロビジョニング・無効化 403 の各挙動を観測し、その挙動を保持することをプロパティテストで固定する。`extractUser` の挙動固定テストは関連スペックと重複させず 1 箇所に集約する。

**Test Cases**:
1. **ADMIN 閲覧の保持**: 未修正コードで ADMIN がセグメント・セッション詳細を取得できる挙動を観測し、修正後も取得できることを検証する。
2. **アクセス権なし 404 の保持**: 正規識別子でも割り当て・所属が無い非 ADMIN が 404 になる挙動を観測し、修正後も 404 であることを検証する。
3. **共有プール経路の保持**: `custom:role` 無しユーザーの `userId`／ロール解決・JIT プロビジョニング・無効化 403 を観測し、修正後も不変であることを検証する。
4. **ロール・プロフィール保持**: `custom:role` 経路で `AuthUser.role` が `custom:role` 値になり、`email`／`displayName` が設定される挙動を観測し、修正後も維持されることを検証する。

### Unit Tests

- `extractUser`: `custom:role` 付き JWT で、解決される `AuthUser.userId` が DynamoDB の正規 `userId`（`sub` ではない）になり、`role` は `custom:role` 値になることを検証する。
- `extractUser`: `email` 欠如時の 403、無効化アカウントの 403、JIT プロビジョニング経路の各挙動を検証する。
- `get-segments` ハンドラ: 正規 `userId` を持つ `AuthUser` で直接割り当て／自チーム割り当てがあるときセグメントを返し、割り当てが無いとき 404 になることを検証する。
- `get-session-detail` ハンドラ: 同様にアクセス権ありでセッション詳細を返し、アクセス権なしで 404 になることを検証する。

### Property-Based Tests

- バグ条件（非 ADMIN × `custom:role` あり × 正規識別子で正当なアクセス権あり）を満たすランダム入力で、常に正規 `userId` が解決され、セグメント取得・セッション詳細がアクセス許可されることを検証する（Property 1、`numRuns: 100`）。
- バグ条件外のランダム入力（ADMIN、アクセス権なし、`custom:role` 無しの共有プール経路、無効化アカウント）で、修正前後の `extractUser` 結果が一致することを検証する（Property 2、`numRuns: 100`）。
- describe はフィーチャー名とプロパティ番号を参照し、docstring は検証する Requirement を参照する（テスト規約準拠）。

### Integration Tests

- 非 ADMIN ユーザーが校閲画面フローでセグメントとセッション詳細を取得し、トランスクリプションが表示される一連の流れを検証する。
- 直接割り当て・自チーム割り当ての双方の経路でアクセスが許可されることを検証する。
- アクセス権のない非 ADMIN ユーザーが引き続き 404 で遮断されることを検証する（回帰防止）。
- 関連スペック `reviewer-media-playback-fix` と同一の `extractUser` 修正を前提に、メディア URL 取得も含めた校閲画面全体が非 ADMIN ユーザーで機能することを横断的に確認する（両スペックの修正が同一変更で解消されることの検証）。
