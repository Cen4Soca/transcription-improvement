# Reviewer Media Playback Fix Bugfix Design

## Overview

校閲画面（ReviewPage）で、ADMIN 以外のユーザー（REVIEWER / TEAM_LEADER）が、正当なアクセス権を持つセッションに対して `GET /sessions/{sessionId}/media-url` を呼び出してもメディアの署名付き URL を取得できず、メディアプレイヤーが表示されない不具合を修正する。

メディア URL エンドポイントは `extractUser(event)` で呼び出し元ユーザーを解決し、`checkSessionAccess(user, sessionId)` でチーム／直接割り当てに基づくアクセス可否を判定してから、`getMediaUrl(sessionId)` で署名付き URL を生成する。ADMIN は `checkSessionAccess` 内で DynamoDB 照会を行わず即座に許可されるため正常に再生できるが、非 ADMIN ユーザーはアクセス判定のための DynamoDB 照会で必ずヒットせず、`denyResourceAccess()` によって 404 が返る。

根本原因は、アクセス判定で用いるユーザー識別子（`AuthUser.userId`）と、割り当て（ReviewAssignment）／チーム所属（TeamMembership）レコードがキーとして保持しているユーザー識別子が一致していないことにある。`extractUser` は JWT に有効な `custom:role` クレームがある場合、`userId` に Cognito の `sub`（UUID）を設定する。一方、ユーザーレコード・ReviewAssignment・TeamMembership は DynamoDB 側で採番された `userId`（`uuidv4()`、Cognito `sub` とは無関係）をキーに書き込まれる。この結果、`checkSessionAccess` → `userHasSessionAccess(user.userId, sessionId)` は `USER#{sub}` を探索するが、実レコードは `USER#{dynamoDbUserId}` に存在するため一致せず、正当なアクセス権を持つ非 ADMIN ユーザーでも 404 になる。

本修正は、アクセス判定に用いるユーザー識別子を、割り当てレコードが保持する正規の DynamoDB `userId` に一致させることで、正当なアクセス権を持つ非 ADMIN ユーザーがメディアを再生できるようにする。ADMIN の再生、アクセス権のない利用者の遮断、スキャン状態・リソース存在に基づく既存ガードは変更しない。

## Glossary

- **Bug_Condition (C)**: バグが発動する条件 — 非 ADMIN ユーザーが、正当なアクセス権（自分への直接割り当て、または自チームへのセッション割り当て）を持つセッションに対してアクセス判定を行う際、判定に用いる識別子が割り当てレコードのキー識別子と一致せず、アクセスが誤って拒否（404）される状態。
- **Property (P)**: バグ入力に対する望ましい挙動 — 正当なアクセス権を持つ非 ADMIN ユーザーのアクセス判定が成功し、署名付き URL が生成・返却される。
- **Preservation**: 本修正で変更してはならない既存挙動 — ADMIN の許可、アクセス権のない利用者の 404 遮断、scanStatus（PENDING/INFECTED）による 403、メディア未存在の 404、署名付き URL の有効期限・ホスト制約。
- **Cognito sub**: Cognito が発行する不変のユーザー識別子（UUID）。JWT の `sub` クレームに入る。
- **DynamoDB userId**: DynamoDB ユーザーレコードの正規 ID（`uuidv4()`）。ユーザー作成時に Cognito `sub` とは独立に採番される。ReviewAssignment（`PK=USER#{userId}`）・TeamMembership（`GSI1PK=USER#{userId}`）のキーに使われる識別子。
- **extractUser**: `backend/src/utils/auth-middleware.ts` の関数。JWT クレームから `AuthUser`（`userId`, `email`, `displayName`, `role`）を解決する。
- **checkSessionAccess**: `backend/src/services/access-control-service.ts` の関数。ADMIN は即許可、非 ADMIN は `userHasSessionAccess(user.userId, sessionId)` の結果で許可／`denyResourceAccess()`（404）を判定する。
- **AuthUser.userId**: アクセス判定の起点となるユーザー識別子。本バグの中心となる値。

## Bug Details

### Bug Condition

バグは、非 ADMIN ユーザー（REVIEWER / TEAM_LEADER）が、割り当て上は正当なアクセス権を持つセッションに対してアクセス判定を行うときに発動する。`extractUser` が JWT の `custom:role` クレーム経由で `AuthUser.userId` に Cognito `sub` を設定する一方、ReviewAssignment／TeamMembership は DynamoDB `userId` をキーに保持しているため、`checkSessionAccess` の DynamoDB 照会が必ず不一致となり、本来許可すべきアクセスが 404 で拒否される。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { user: AuthUser, sessionId: string }
  OUTPUT: boolean

  RETURN NOT isAdmin(input.user)
         AND hasLegitimateAccess(canonicalUserId(input.user), input.sessionId)   // 正規IDでは割り当てが存在
         AND input.user.userId != canonicalUserId(input.user)                    // 判定に使う識別子が正規IDと不一致
         AND accessCheckDeniesAccess(input.user.userId, input.sessionId)         // 実際のアクセス判定は拒否(404)
END FUNCTION
```

ここで `canonicalUserId(user)` は割り当てレコードがキーとして使う DynamoDB `userId`、`hasLegitimateAccess` は直接割り当て（ReviewAssignment）または自チームへのセッション割り当て（TeamAssignment + TeamMembership）の存在を表す。

### Examples

- **直接割り当ての REVIEWER**: Admin が REVIEWER（DynamoDB `userId = u-123`）にセッション `sess-A` を直接割り当て済み。REVIEWER がログインし JWT の `sub = cognito-xyz`、`custom:role = REVIEWER` でメディア URL を要求 → 期待: 署名付き URL を返す / 実際: `USER#cognito-xyz` に割り当てが無く 404。
- **自チーム割り当ての TEAM_LEADER**: TEAM_LEADER（DynamoDB `userId = u-456`）が `team-1` のメンバーで、`team-1` にセッション `sess-B` が割り当て済み。JWT の `sub = cognito-abc` でメディア URL を要求 → 期待: 署名付き URL を返す / 実際: `getUserTeamIds(cognito-abc)` が空で、チーム照会も不一致のため 404。
- **ADMIN（対照）**: ADMIN が同じ `sess-A` を要求 → `checkSessionAccess` が即許可し、署名付き URL を返す（バグの影響を受けない）。
- **エッジケース — アクセス権のない REVIEWER**: どのチームにも属さず直接割り当ても無い REVIEWER → 正規 ID で判定しても割り当てが存在しないため 404（これは正しい挙動であり、修正後も維持すべき）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- ADMIN が `GET /sessions/{sessionId}/media-url` を呼び出したときの許可と署名付き URL 生成（Req 3.1）。
- 対象セッションにアクセス権を持たない非 ADMIN ユーザーに対する 404 遮断（リソース存在の隠蔽、Req 3.2）。
- scanStatus が PENDING または INFECTED のメディアに対する 403（Req 3.3）。
- 対象セッションにメディアファイルが存在しない場合の 404（Req 3.4）。
- 署名付き URL の有効期限（既定 300 秒）と現行 CSP（`media-src https://*.amazonaws.com`）適合ホスト（Req 3.5）。

**Scope:**
バグ条件（正規 ID で正当なアクセス権を持つ非 ADMIN ユーザーのアクセス判定）に該当しない入力は、本修正の影響を受けない。具体的には以下を含む:
- ADMIN によるすべてのアクセス判定（`checkSessionAccess` の早期リターン経路は不変）。
- 正規 ID で判定しても割り当てが存在しない非 ADMIN ユーザー（引き続き 404）。
- scanStatus・メディア存在・URL 生成に関わる `media-service` の挙動（本修正はアクセス判定の識別子解決のみを対象とし、URL 生成ロジックには触れない）。

本修正の期待される正しい挙動の本体は Correctness Properties の Property 1 に定義する。本節は「変更してはならない挙動」に焦点を当てる。

## Hypothesized Root Cause

バグ記述とコード調査（`auth-middleware.ts`, `access-control-service.ts`, `team-repository.ts`, `user-repository.ts`, `user-service.ts`, `admin-users.ts`）に基づく最有力の原因は以下。

1. **アクセス判定識別子の不整合（最有力）**: `extractUser` は JWT に有効な `custom:role` がある場合 `userId = claims['sub']`（Cognito sub）を返す。一方、ユーザーレコード・ReviewAssignment・TeamMembership は DynamoDB `userId`（`uuidv4()`、`admin-users.ts` / `provisionUserOnFirstLogin` で Cognito `sub` とは独立に採番）をキーに保持する。
   - `checkSessionAccess` → `userHasSessionAccess(user.userId, sessionId)` は `hasReviewAssignment`（`PK=USER#{userId}`）と `isSessionAssignedToUserTeams`→`getUserTeamIds`（`GSI1PK=USER#{userId}`）を参照する。
   - `user.userId = sub` のため両照会が常に不一致となり、割り当てが実在しても 404 になる。
   - ADMIN は `isAdmin(user)` の早期リターンで照会を行わないため、この不整合の影響を受けない（ADMIN だけ成功する症状と一致）。

2. **リポジトリのキースキーマ自体の不整合（反証済みの可能性）**: 書き込み側（`team-repository.ts`）と読み取り側（`access-control-service.ts`）のキー構成（`PK=USER#{userId}` / `SK=ASSIGNMENT#{sessionId}`、`GSI1PK=USER#{userId}` / `GSI1SK=TEAM#{teamId}`）は一致している。したがってスキーマ定義そのものの齟齬ではなく、「キーに入れる識別子の値（sub か DynamoDB userId か）」の齟齬である。探索テストでこの切り分けを確認する。

3. **DynamoDB フォールバック経路の相対的健全性**: JWT に `custom:role` が無い共有プール経路では `userId = userRecord.userId`（DynamoDB userId）となり、割り当てキーと整合する。したがってバグは主に `custom:role` を持つ JWT 経路で顕在化すると想定される。

## Correctness Properties

Property 1: Bug Condition - 正当なアクセス権を持つ非 ADMIN ユーザーのメディア URL 取得

_For any_ 入力でバグ条件が成立する場合（isBugCondition が true を返す、すなわち非 ADMIN ユーザーが正規ユーザー識別子では直接割り当てまたは自チーム割り当てによりアクセス権を持つセッションを要求する場合）、修正後の処理は SHALL アクセスを許可し、`getMediaUrl` を呼び出して当該セッションのメディアに対する署名付き URL（有効期限付き）を生成・返却する。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - バグ条件外のアクセス判定挙動の維持

_For any_ 入力でバグ条件が成立しない場合（isBugCondition が false を返す、すなわち ADMIN による要求、正規識別子でも割り当てが存在しない非 ADMIN による要求、scanStatus 違反、メディア未存在など）、修正後の処理は SHALL 修正前と同一の結果（許可・404・403・署名付き URL の有効期限とホスト制約）を生成し、既存の遮断・ガード挙動を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

根本原因分析（アクセス判定識別子の不整合）が正しいと仮定した場合の変更方針。

**File**: `backend/src/utils/auth-middleware.ts`

**Function**: `extractUser`

**Specific Changes**:
1. **識別子の正規化**: `AuthUser.userId` が常に割り当てレコードのキーと一致する正規の DynamoDB `userId` になるよう解決する。JWT の `custom:role` 経路でも `email` クレームから DynamoDB ユーザーレコードを解決し、その `userRecord.userId` を `AuthUser.userId` に採用する（`sub` をそのまま使わない）。`role` は従来どおり有効な `custom:role` があればそれを優先してよい。
2. **既存レコードが無い場合の整合**: レコードが存在しない場合は現行の JIT プロビジョニング（`provisionUserOnFirstLogin`）に委譲し、採番済みの DynamoDB `userId` を返す。これにより新規・既存のいずれでも識別子が一貫する。
3. **ADMIN 経路の不変性**: `isAdmin` 判定と `checkSessionAccess` の早期リターン経路は変更しない（ADMIN の挙動を保持）。
4. **副作用・互換性の考慮**: `email` クレーム欠如時の扱い（現行の 403）と無効化アカウントの扱い（`isActive=false` で 403）を維持する。識別子解決のための追加照会はアクセス判定前に一度で完結させ、既存ハンドラ（`get-media-url.ts` 等）には変更を加えない。

> 備考: 代替案として `access-control-service` 側で `sub → DynamoDB userId` の解決を行う方法もあるが、識別子は `extractUser` が返す `AuthUser` の単一責務とするのが最も影響範囲が小さく、他のアクセス判定（`getAccessibleSessionIds`, `checkLanguageModelAccess`, `isTeamMember` 等）とも一貫する。探索テストの結果に応じて最終的な変更箇所を確定する。

## Testing Strategy

### Validation Approach

テスト戦略は二段階で進める。まず未修正コード上でバグを再現する反例を表面化させ、根本原因（識別子の不整合）を確認または反証する。次に修正が正しく機能し、バグ条件外の既存挙動を保持することを検証する。

### Exploratory Bug Condition Checking

**Goal**: 修正前に、バグを示す反例を表面化させる。根本原因分析（`AuthUser.userId` が Cognito `sub` で、割り当てキーの DynamoDB `userId` と不一致）を確認する。反証された場合は再仮説を立てる。

**Test Plan**: `custom:role` 付き JWT を持つ非 ADMIN ユーザーについて、DynamoDB 上に正規 `userId` キーで割り当て（ReviewAssignment / TeamMembership + TeamAssignment）が存在する状況を用意し、未修正の `extractUser` + `checkSessionAccess` 経由でメディア URL を要求する。未修正コードで 404 になることを観測し、識別子の不一致が原因であることを確認する。

**Test Cases**:
1. **直接割り当て REVIEWER テスト**: `sub != dynamoDbUserId` の REVIEWER に `USER#{dynamoDbUserId}` で ReviewAssignment を設定し、メディア URL 要求が 404 になることを観測する（未修正コードで失敗する想定）。
2. **自チーム割り当て TEAM_LEADER テスト**: `sub != dynamoDbUserId` の TEAM_LEADER を `USER#{dynamoDbUserId}` キーでチームに所属させ、同チームにセッションを割り当て、要求が 404 になることを観測する（未修正コードで失敗する想定）。
3. **識別子一致の対照テスト**: フォールバック経路（`custom:role` 無し）など `userId = dynamoDbUserId` となる場合にアクセスが許可されることを観測し、原因が識別子の値の不一致であることを切り分ける。
4. **エッジケース — ADMIN**: ADMIN では未修正コードでも許可されることを確認し、バグが非 ADMIN 経路に限定されることを示す。

**Expected Counterexamples**:
- 正規 `userId` キーで割り当てが実在するにもかかわらず、`sub` ベースの照会が不一致となり 404 が返る。
- 想定原因: `extractUser` が `custom:role` 経路で `userId = sub` を返す／割り当て・チーム所属は DynamoDB `userId` をキーに保持。

### Fix Checking

**Goal**: バグ条件が成立するすべての入力について、修正後の処理が期待挙動（アクセス許可 + 署名付き URL 生成）を返すことを検証する。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := getMediaUrlFlow_fixed(input)
  ASSERT result.allowed == true
  ASSERT result.signedUrl is present AND result.expiresAt is present
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しないすべての入力について、修正後の処理が修正前と同一の結果を返すことを検証する。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getMediaUrlFlow_original(input) = getMediaUrlFlow_fixed(input)
END FOR
```

**Testing Approach**: プロパティベーステスト（fast-check）を用いる。理由:
- 入力領域（ロール、識別子一致／不一致、scanStatus、割り当ての有無）を横断して多数のケースを自動生成できる。
- 手動テストが見落としやすいエッジケースを捕捉できる。
- バグ条件外のすべての入力で挙動が不変であることを強く保証できる。

**Test Plan**: 未修正コードで ADMIN 許可・アクセス権なし 404・scanStatus 403・メディア未存在 404 の各挙動を観測し、その挙動を保持することをプロパティテストで固定する（既存の `get-media-url.property.test.ts` の scanStatus プロパティを含めて回帰を防ぐ）。

**Test Cases**:
1. **ADMIN 許可の保持**: 未修正コードで ADMIN が許可される挙動を観測し、修正後も許可されることを検証する。
2. **アクセス権なし 404 の保持**: 正規識別子でも割り当てが無い非 ADMIN が 404 になる挙動を観測し、修正後も 404 であることを検証する。
3. **scanStatus ガードの保持**: PENDING / INFECTED で 403 になる挙動（既存プロパティ）を観測し、修正後も維持されることを検証する。
4. **メディア未存在 404 の保持**: セッションにメディアが無い場合の 404 を観測し、修正後も維持されることを検証する。

### Unit Tests

- `extractUser`: `custom:role` 付き JWT で、解決される `AuthUser.userId` が DynamoDB の正規 `userId`（`sub` ではない）になることを検証する。
- `extractUser`: `email` 欠如時の 403、無効化アカウントの 403、JIT プロビジョニング経路の各挙動を検証する。
- `checkSessionAccess`: 正規 `userId` を持つ `AuthUser` で直接割り当て／自チーム割り当てが許可されること、割り当てが無い場合に 404 になることを検証する。

### Property-Based Tests

- バグ条件（非 ADMIN × 正規識別子で正当なアクセス権あり）を満たすランダム入力で、常に許可され署名付き URL が返ることを検証する（Property 1）。
- バグ条件外のランダム入力（ADMIN、アクセス権なし、scanStatus 違反、メディア未存在）で、修正前後の結果が一致することを検証する（Property 2）。
- `numRuns: 100` を既定とし、describe はフィーチャー名とプロパティ番号を参照、docstring は検証する Requirement を参照する（テスト規約準拠）。

### Integration Tests

- 非 ADMIN ユーザーが校閲画面フローでメディア URL を取得し、署名付き URL でプレイヤーが表示される一連の流れを検証する。
- 直接割り当て・自チーム割り当ての双方の経路でアクセスが許可されることを検証する。
- アクセス権のない非 ADMIN ユーザーが引き続き 404 で遮断されることを検証する（回帰防止）。
