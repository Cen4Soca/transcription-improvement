# ロール変更時セッション強制サインアウト Bugfix Design

## Overview

管理者が `PATCH /admin/users/{userId}`（`backend/src/handlers/admin-users.ts` の `updateUserHandler`）で対象ユーザーのロールのみを変更した場合、対象ユーザーの既存 Cognito セッション（発行済み JWT）が無効化されない。専用 User Pool 構成では `extractUser`（`backend/src/utils/auth-middleware.ts`）が JWT の `custom:role` claim を DynamoDB レコードより優先するため、降格が再ログインまで効かず、剥奪されたはずの旧権限で API を呼べてしまう。

修正方針は採用方針Bである。ロールが実際に変化したとき（昇格・降格を問わず）、既存の `globalSignOutCognitoUser`（Cognito `AdminUserGlobalSignOut`）を呼び、対象ユーザーの全既存セッションを強制サインアウトする。これにより新ロールの即時反映を専用・共有の両 User Pool 構成で一貫して保証する。

修正はハンドラのロール変更ブランチに `globalSignOutCognitoUser` 呼び出しと調停ルールを追加するもので、Handler → Service のレイヤリングを維持する（Cognito 操作は `cognito-service`、DynamoDB は repository）。`cognito-service` の既存関数をそのまま使い、新規 Cognito 関数の追加は不要。部分失敗を明示的に扱うため、`error-codes.ts` に新しい詳細エラーコードを1つ追加する。

## Glossary

- **Bug_Condition (C)**: ロールが実際に変化する更新（`body.role` が指定され、かつ `existingUser.role` と異なる）であるにもかかわらず、現行コードで強制サインアウトが発火しない状態を識別する条件。
- **Property (P)**: ロールが実際に変化したとき、対象ユーザーに対して `globalSignOutCognitoUser` が（昇格・降格を問わず）発火し、既存セッションが無効化されるという望ましい振る舞い。
- **Preservation**: ロール非変更の更新、無効化フロー、プロフィール更新、Cognito/DynamoDB 二重更新など、修正で変えてはならない既存の振る舞い。
- **updateUserHandler**: `backend/src/handlers/admin-users.ts` の `PATCH /admin/users/{userId}` ハンドラ。入力検証、対象ユーザー存在確認、Cognito/DynamoDB の更新、監査ログ記録をオーケストレーションする。
- **globalSignOutCognitoUser(username)**: `backend/src/services/cognito-service.ts` の関数。`AdminUserGlobalSignOutCommand` を送信し、対象ユーザーの全既存トークンを即時無効化する。無効化フロー（`isActive === false`）で実績がある。
- **updateCognitoUserRole(username, role)**: `cognito-service.ts` の関数。`AdminUpdateUserAttributesCommand` で `custom:role` を更新する。共有プールで `custom:role` 未定義の場合は警告ログを出して握りつぶす（DynamoDB が source of truth）。
- **roleChanged**: `body.role !== undefined && body.role !== existingUser.role`。ロールが実際に変化する更新を表すフラグ。
- **isDeactivating**: `body.isActive === false`。無効化フローの発火条件。無効化ブランチで既に `globalSignOutCognitoUser` が呼ばれる。
- **専用 User Pool**: JWT に `custom:role` claim が入る構成。`extractUser` が claim を優先するため、強制サインアウトしないと降格が再ログインまで効かない。
- **共有 User Pool**: `custom:role` claim が無い構成（例: GenU と共有）。`extractUser` が DynamoDB role にフォールバックするため role 変更は次の API 呼び出しで反映されるが、方針Bの強制サインアウトは両構成で一貫した即時反映を保証する。

## Bug Details

### Bug Condition

ロールが実際に変化する（`body.role` が指定され `existingUser.role` と異なる）にもかかわらず、現行の `updateUserHandler`（F）がロール変更ブランチで `globalSignOutCognitoUser` を呼ばない状態をバグ条件とする。現行コードでは `globalSignOutCognitoUser` は `body.isActive === false` のときだけ発火するため、`roleChanged` が真の全入力でセッション無効化が欠落している。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input = { existingUser, body }  // PATCH /admin/users/{userId} の入力
  OUTPUT: boolean

  roleChanged := (input.body.role IS DEFINED)
                 AND (input.body.role != input.existingUser.role)

  // 現行関数 F ではロール変更経路で globalSignOutCognitoUser を呼ばない。
  // 「ロールは変わるのに強制サインアウトが発火しない」入力がバグ条件。
  RETURN roleChanged
END FUNCTION
```

### Examples

- **降格（セキュリティリスク）**: `existingUser.role = "ADMIN"`、`body = { role: "REVIEWER" }`（`isActive` 未指定）。期待: 強制サインアウトで旧 ADMIN JWT が即時無効化される。実際（現行 F）: `updateCognitoUserRole` + `updateUser` のみ実行、旧 ADMIN 権限の JWT を有効期限まで使い続けられる。
- **昇格（UX 問題）**: `existingUser.role = "REVIEWER"`、`body = { role: "TEAM_LEADER" }`。期待: 再ログインで新権限が即反映。実際: 新権限が再ログイン/トークンリフレッシュまで反映されない。
- **ロール同一指定（バグ条件外）**: `existingUser.role = "REVIEWER"`、`body = { role: "REVIEWER" }`。期待と現行が一致（サインアウトしない）。修正後も変化してはならない。
- **プロフィールのみ更新（バグ条件外）**: `body = { displayName: "New Name" }`。期待と現行が一致（サインアウトしない）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- ロールが変化しない更新（`body.role` 未指定、または `body.role === existingUser.role`）では強制サインアウトを発火しない（不要なログアウト回避）。
- 無効化フロー（`body.isActive === false` の `globalSignOutCognitoUser` + `disableCognitoUser`）を従来どおり実行する。
- `displayName` / `email` のみの更新（`updateUserProfile` 経由）では強制サインアウトを発火しない。
- ロール変更時の Cognito `custom:role`（`updateCognitoUserRole`）と DynamoDB（`updateUser`）の二重更新の既存挙動を維持する。
- 既存のロール変更監査ログ（`USER_MANAGEMENT`、`previousValue` / `newValue`）の記録を維持する。
- 共有 User Pool 構成で `extractUser` が DynamoDB role にフォールバックして次の API 呼び出しで新ロールを反映する既存挙動を壊さない。

**Scope:**
`isBugCondition(X)` が偽となる全入力（`NOT roleChanged`）は、この修正によって完全に不変でなければならない。これには以下が含まれる:
- ロール未指定の更新（`isActive` のみ、プロフィールのみ、など）
- 同一ロールの再指定
- プロフィールのみの更新（`displayName` / `email`）

**Note:** ロールが実際に変化したときの望ましい正しい振る舞いは Correctness Properties の Property 1 に定義する。本セクションは「変えてはならない」ことに焦点を当てる。

## Hypothesized Root Cause

本バグはロジックの欠落であり、調査済みの事実から根本原因は確定している。

1. **ロール変更ブランチでのセッション無効化の欠落（確定した主因）**: `updateUserHandler` のロール変更ブランチ（`if (body.role !== undefined && body.role !== existingUser.role)`）は `updateCognitoUserRole` のみを呼び、`globalSignOutCognitoUser` を呼ばない。`globalSignOutCognitoUser` は `body.isActive === false` ブランチにしか存在しない。

2. **`extractUser` のロール解決順**: 専用 User Pool では `extractUser` が有効な `custom:role` claim を DynamoDB レコードより優先する（`role = isValidRole(jwtRole) ? jwtRole : userRecord.role`）。既存 JWT は旧 role を運ぶため、強制サインアウトで再ログインを強制しない限り新ロールが反映されない。

3. **設計上の非対称性**: 無効化（`isActive = false`）はセッション無効化を伴うのにロール変更は伴わない、という非対称がセキュリティ上の穴（降格の遅延反映）を生んでいる。方針Bはこの非対称を解消する。

## Correctness Properties

Property 1: Bug Condition - ロール変更時の強制サインアウト

_For any_ 入力 X でバグ条件が成立する（`isBugCondition(X)` が真 = `body.role` が指定され `existingUser.role` と異なる）とき、修正後の `updateUserHandler` は昇格・降格を問わず対象ユーザー（`existingUser.email`）に対して `globalSignOutCognitoUser` を1回発火させ、`updateCognitoUserRole` と DynamoDB `updateUser` も実行して、対象ユーザーの全既存セッションが無効化され新ロールが永続化された状態を SHALL 生成する。ただし無効化フロー（`body.isActive === false`）が同時に発火する場合は、無効化ブランチで既に実行される `globalSignOutCognitoUser` を唯一の発火とし、ロール変更起因の二重サインアウトは SHALL スキップする。

**Validates: Requirements 2.1, 2.2, 3.5**

Property 2: Preservation - ロール非変更・無効化・プロフィール更新の保持

_For any_ 入力 X でバグ条件が成立しない（`isBugCondition(X)` が偽 = `body.role` 未指定、または `body.role === existingUser.role`）とき、修正後の `updateUserHandler` は修正前の関数と同一の結果を SHALL 生成し、ロール非変更での非サインアウト（3.1）、無効化フロー（`globalSignOutCognitoUser` + `disableCognitoUser`）の既存挙動（3.2）、プロフィールのみ更新での非サインアウト（3.3）、共有プールの DynamoDB フォールバック挙動（3.4）を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

根本原因分析が正しいという前提で、変更は `updateUserHandler` のロール変更ブランチに集中する。

**File**: `backend/src/handlers/admin-users.ts`

**Function**: `updateUserHandler`

**追加する詳細エラーコード**: `backend/src/utils/error-codes.ts` の `ERROR_CODES` に `ROLE_CHANGE_SESSION_INVALIDATION_FAILED: 'ROLE_CHANGE_SESSION_INVALIDATION_FAILED'` を追加（SCREAMING_SNAKE_CASE、`// --- User management ---` グループに配置）。ロール更新は成功したがサインアウトが失敗した部分失敗（2.3）を無言で握りつぶさず明示的に扱うため。

**Specific Changes**:

1. **強制サインアウトの発火条件（Property 1 / 要件 2.1）**: ロール変更ブランチ（`if (body.role !== undefined && body.role !== existingUser.role)`）に、`updateCognitoUserRole` 成功後に `globalSignOutCognitoUser(existingUser.email)` の呼び出しを追加する。発火は「ロールが実際に変化したとき」に限定し、`body.role` 未指定や同一ロール指定では呼ばない（Property 2 / 要件 3.1）。

2. **無効化との二重サインアウト調停（要件 3.2）**: `body.isActive === false` のときは既に無効化ブランチで `globalSignOutCognitoUser` が呼ばれている。ロール変更ブランチでのサインアウトは `body.isActive !== false`（= 無効化が発火しない）ときに限りスキップ条件を設ける。具体的には、ロール変更由来のサインアウトを `const invalidateForRoleChange = roleChanged && body.isActive !== false;` のガードで制御する。`globalSignOutCognitoUser` は冪等（同一ユーザーに2回呼んでも Cognito 側の害は無い）だが、無駄な API 呼び出しと監査の重複を避けるため、無効化が発火するケースではロール変更起因の2回目を抑止する。

3. **実行順序（要件 2.3, 3.5）**: ロールが変化し無効化が発火しないケースの実行順序を次のとおり固定する。
   1. `updateCognitoUserRole(existingUser.email, body.role)` — Cognito `custom:role` 更新
   2. `globalSignOutCognitoUser(existingUser.email)` — 既存セッションを無効化
   3. `updateUser(userId, { role, isActive })` — DynamoDB の role を永続化
   4. `recordAuditLog(...)` — 監査ログ記録

   Cognito の role 更新を先に行い、その直後にサインアウトすることで、「サインアウト後に発行される次の JWT が確実に新 role を持つ」状態を保証する。DynamoDB 更新は最後段で行う既存順序を維持する（`updateUser` と監査は既存の DynamoDB ブロックに属する）。

4. **部分失敗の整合（要件 2.3）**: サインアウトの失敗は明示的に扱う。
   - **Cognito role 更新が失敗**: 既存どおり `ROLE_UPDATE_FAILED`（500）を throw し、以降（サインアウト・DynamoDB 更新）を実行しない。状態は変化なし（再試行可能）。
   - **role 更新は成功したがサインアウトが失敗**: `globalSignOutCognitoUser` の例外を捕捉し、`internalError('Failed to invalidate existing sessions after the role change.', <詳細>, ERROR_CODES.ROLE_CHANGE_SESSION_INVALIDATION_FAILED)` を throw する。これにより DynamoDB 更新と監査記録は実行されない。結果として「Cognito role は新しいが DynamoDB role は旧のまま、セッション未無効化」という中途半端状態になるが、無言の握りつぶしはしない（500 を返す）。ロール更新のロールバックは行わない（Cognito の role は冪等に再設定可能で、再度 PATCH すれば `updateCognitoUserRole` と `globalSignOutCognitoUser` の双方が再試行されて収束するため）。この「リトライで収束する」性質を根拠に、複雑なロールバックよりリトライ可能性を優先する。
   - **冪等性・リトライ可能性**: `globalSignOutCognitoUser` と `updateCognitoUserRole` はいずれも冪等。管理者が同じ PATCH を再実行すれば、`roleChanged` は（DynamoDB が旧 role のままなら）真のままとなり、サインアウトが再試行される。収束後は DynamoDB role も新 role になり `roleChanged` が偽になるため、過剰なサインアウトは起きない。

5. **監査（要件 2.4）**: ロール変更ブランチで強制サインアウトを行った場合、既存の `USER_MANAGEMENT` 監査ログ（`previousValue` / `newValue`）に `sessionInvalidated: true` を `metadata` として追加する。これにより「ロール変更に伴いセッションを強制サインアウトした事実」を監査に残す。既存の `previousValue` / `newValue` の記録は維持する（`sanitizeMetadata` を通る既存経路に値を追加するのみ）。

### レイヤリング遵守

- ハンドラはオーケストレーションのみ（検証・順序制御・エラー変換・監査呼び出し）。
- Cognito 操作は `cognito-service`（`updateCognitoUserRole` / `globalSignOutCognitoUser`）に委譲。新規 Cognito 関数は追加しない。
- DynamoDB は repository（`updateUser`）経由。
- 監査は `audit-service`（`recordAuditLog`）経由。

## Testing Strategy

### Validation Approach

二段構えで検証する。まず修正前コードでバグを再現する counterexample を surfacing し、次に修正が正しく動きかつ既存挙動を保持することを検証する。ハンドラの単体テストは既存 `backend/src/handlers/admin-users.test.ts` のモック手法（`vi.mock` で `cognito-service` / `user-repository` / `audit-service` / `user-service` / `auth-middleware` をモック）に準拠する。

### Exploratory Bug Condition Checking

**Goal**: 修正実装の前にバグを示す counterexample を surfacing し、根本原因分析を確認または反証する。反証されたら再仮説を立てる。

**Test Plan**: 修正前（F）の `updateUserHandler` に対し、ロールのみを変更する PATCH を与え、`globalSignOutCognitoUser` モックが呼ばれないことを観測する。

**Test Cases**:
1. **降格テスト**: `existingUser.role = "ADMIN"`、`body = { role: "REVIEWER" }`（`isActive` 未指定）を与え、`globalSignOutCognitoUser` が呼ばれないことを確認（修正前で失敗 = 期待されるセッション無効化が欠落）。
2. **昇格テスト**: `existingUser.role = "REVIEWER"`、`body = { role: "ADMIN" }` を与え、`globalSignOutCognitoUser` が呼ばれないことを確認（修正前で失敗）。
3. **二重サインアウト境界の観測**: `body = { role: "REVIEWER", isActive: false }` を与え、修正前では無効化ブランチのみが `globalSignOutCognitoUser` を呼ぶ（1回）ことを観測し、修正後に二重発火しない基準値とする。

**Expected Counterexamples**:
- ロールのみ変更時に `globalSignOutCognitoUser` の呼び出し回数が 0。
- 想定原因: ロール変更ブランチにセッション無効化処理が存在しない（根本原因 1）。

### Fix Checking

**Goal**: バグ条件を満たす全入力で、修正後関数 F' が期待される振る舞い（強制サインアウト発火）を生成することを検証する。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := updateUserHandler_fixed(input)
  // 無効化が同時発火しないケース
  IF input.body.isActive != false THEN
    ASSERT globalSignOutCognitoUser CALLED ONCE WITH input.existingUser.email
  END IF
  ASSERT updateCognitoUserRole CALLED WITH (input.existingUser.email, input.body.role)
  ASSERT updateUser CALLED WITH role = input.body.role
  ASSERT audit metadata CONTAINS sessionInvalidated = true
END FOR
```

### Preservation Checking

**Goal**: バグ条件を満たさない全入力で、修正後関数 F' が修正前関数 F と同一に振る舞うことを検証する。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT updateUserHandler_original(input) = updateUserHandler_fixed(input)
END FOR
```

**Testing Approach**: 保持検証にはプロパティベーステスト（fast-check）を推奨する。
- 入力ドメイン全域にわたり多数のケースを自動生成できる。
- 手動の単体テストが見落とすエッジケースを捕捉できる。
- バグ条件外の全入力で挙動が不変であるという強い保証を与える。

**Test Plan**: 修正前（F）のコードでロール非変更・無効化・プロフィール更新の挙動を観測し、その挙動を捉えるプロパティテストを書く。`globalSignOutCognitoUser` / `disableCognitoUser` / `updateUserProfile` の呼び出し有無と引数を観測する。

**Test Cases**:
1. **ロール非変更の非サインアウト保持（3.1）**: `body.role` 未指定、または `body.role === existingUser.role` で `globalSignOutCognitoUser` が呼ばれないことを修正前後で一致確認。
2. **無効化フロー保持（3.2）**: `body.isActive === false` で `globalSignOutCognitoUser` + `disableCognitoUser` が従来どおり（各1回）呼ばれ、ロール変更が同時でも `globalSignOutCognitoUser` が2回にならないことを確認。
3. **プロフィール更新の非サインアウト保持（3.3）**: `body = { displayName }` / `{ email }` で `updateUserProfile` 経由になり `globalSignOutCognitoUser` が呼ばれないことを確認。
4. **共有プールフォールバック保持（3.4）**: `updateCognitoUserRole` が `custom:role` 未定義を握りつぶす挙動を壊さないこと（ロール変更＋サインアウトの経路が共有プールでも例外を投げずに完了すること）を確認。

### Unit Tests

- ロール変更（昇格・降格）で `globalSignOutCognitoUser` が対象 email で1回呼ばれること。
- ロール変更の実行順序（`updateCognitoUserRole` → `globalSignOutCognitoUser` → `updateUser` → `recordAuditLog`）。
- `body = { role, isActive: false }` のとき `globalSignOutCognitoUser` が1回のみ（二重サインアウト抑止）。
- ロール同一指定・ロール未指定で `globalSignOutCognitoUser` が呼ばれないこと。
- プロフィールのみ更新で `globalSignOutCognitoUser` が呼ばれないこと。
- 部分失敗: `updateCognitoUserRole` 成功後に `globalSignOutCognitoUser` が例外を投げたとき、`ROLE_CHANGE_SESSION_INVALIDATION_FAILED`（500）が返り、`updateUser` と `recordAuditLog` が呼ばれないこと。
- 監査 metadata に `sessionInvalidated: true` と既存 `previousValue` / `newValue` が含まれること。

### Property-Based Tests

- **Property 1（Fix）**: 生成した `{ existingUser.role, body.role }`（`body.role` 指定かつ両者が異なる、`isActive` 未指定）に対し、`globalSignOutCognitoUser` が常に1回・対象 email で呼ばれることを検証（`{ numRuns: 100 }`）。
- **Property 2（Preservation）**: 生成した非バグ入力（`body.role` 未指定、または `body.role === existingUser.role`、各種 `isActive` / プロフィール組合せ）に対し、`globalSignOutCognitoUser` の呼び出し回数と `disableCognitoUser` / `enableCognitoUser` / `updateUserProfile` の呼び出しが修正前の期待と一致することを検証。
- 本機能はテスト規約上プロパティベーステスト必須領域（Deletion/Upload 等）には列挙されていないが、Fix/Preservation の二分法を強く保証するため fast-check を採用する。

### Integration Tests

- `backend/src/__tests__/integration/` にて、ロール変更 PATCH 後に対象ユーザーの旧トークンで保護 API を呼ぶと拒否される（再ログインが必要になる）ことを LocalStack で確認する。
- 無効化フローとロール変更を組み合わせた PATCH で Cognito 側の状態（サインアウト・無効化）が期待どおりになることを確認する。
