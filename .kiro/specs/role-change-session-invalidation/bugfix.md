# Bugfix Requirements Document

## Introduction

管理者が `PATCH /admin/users/{userId}` で対象ユーザーのロールのみを変更（`isActive` は変更しない）した場合、対象ユーザーの既存 Cognito セッション（発行済み JWT）が無効化されない。

専用 User Pool 構成（JWT に `custom:role` claim が入る構成）では、`extractUser`（`backend/src/utils/auth-middleware.ts`）のロール解決順が「有効な `custom:role` claim を優先し、無ければ DynamoDB のユーザーレコードの role にフォールバック」（`role = isValidRole(jwtRole) ? jwtRole : userRecord.role`）となっているため、対象ユーザーは旧 role を運ぶ既存 JWT を使い続け、トークンの有効期限切れまたは手動の再ログイン / トークンリフレッシュまで新ロールが反映されない。特に降格（権限剥奪）が即座に効かないため、剥奪されたはずの旧権限で API を呼べてしまうセキュリティリスクがある。昇格の場合も新権限が即座に反映されない UX 上の問題がある。

一方、`globalSignOutCognitoUser`（Cognito `AdminUserGlobalSignOut`、全トークン無効化）は `updateUserHandler`（`backend/src/handlers/admin-users.ts`）内で `body.isActive === false`（ユーザー無効化）のときだけ呼ばれており、ロール変更の経路では呼ばれない。

本修正では、採用方針（方針B）に従い、ロールが実際に変化したときは昇格・降格を問わず常に対象ユーザーの既存セッションを強制サインアウトし、新ロールの確実な即時反映を両 User Pool 構成で一貫して保証する。

関連コード:
- `backend/src/handlers/admin-users.ts` — `updateUserHandler`（ロール変更ブランチ: `updateCognitoUserRole` + `updateUser` を実行するが `globalSignOutCognitoUser` は呼ばない。`isActive === false` ブランチのみ `globalSignOutCognitoUser` + `disableCognitoUser` を呼ぶ）
- `backend/src/services/cognito-service.ts` — `globalSignOutCognitoUser`（`AdminUserGlobalSignOutCommand` 送信、既存。無効化フローで実績あり）、`updateCognitoUserRole`（`AdminUpdateUserAttributesCommand` で `custom:role` 更新）
- `backend/src/utils/auth-middleware.ts` — `extractUser`（ロール解決順: `custom:role` claim 優先 → DynamoDB フォールバック）

## Bug Analysis

### Current Behavior (Defect)

`PATCH /admin/users/{userId}` でロールが変化しても既存セッションが無効化されず、専用 User Pool 構成で新ロールが再ログインまで反映されない。

1.1 WHEN 管理者が `PATCH /admin/users/{userId}` でロールを現在と異なる値に変更（`body.role` 指定かつ `existingUser.role` と異なる、`body.isActive` は変更しない）したとき THEN the system は `updateCognitoUserRole` と DynamoDB の `updateUser` のみを実行し、`globalSignOutCognitoUser` を呼ばず、対象ユーザーの既存セッション（発行済み JWT）を無効化しない

1.2 WHEN 専用 User Pool 構成（JWT に `custom:role` claim が入る）で 1.1 のロール変更が行われたとき THEN the system は対象ユーザーの後続 API 呼び出しに対し、`extractUser` が有効な `custom:role` claim（旧 role）を DynamoDB レコードより優先するため、旧 role を適用し続ける（トークン有効期限切れまたは手動の再ログイン / トークンリフレッシュまで）

1.3 WHEN 専用 User Pool 構成で降格（例: ADMIN → REVIEWER）が行われたとき THEN the system は剥奪されたはずの旧権限での API 呼び出しを旧 JWT の有効期間中は許容してしまう

### Expected Behavior (Correct)

方針B: ロールが実際に変化したときは昇格・降格を問わず常に既存セッションを強制サインアウトする。

2.1 WHEN 管理者が `PATCH /admin/users/{userId}` でロールを現在と異なる値に変更（`body.role` 指定かつ `existingUser.role` と異なる）したとき THEN the system SHALL 昇格・降格を問わず `globalSignOutCognitoUser` を呼び、対象ユーザーの全既存セッション（発行済み JWT）を無効化する

2.2 WHEN 2.1 のロール変更後に対象ユーザーが API を呼び出そうとするとき THEN the system SHALL 対象ユーザーに再ログインを要求し、再ログイン後に発行される新しい JWT を通じて新ロールを反映する（専用・共有の両 User Pool 構成で一貫した即時反映を保証する）

2.3 WHEN ロール変更が成功した（Cognito `custom:role` 更新および DynamoDB `updateUser` が完了した）のに `globalSignOutCognitoUser` が失敗したとき THEN the system SHALL その部分失敗時の挙動を明示的に定義する（失敗時のエラーハンドリング、ロール更新と強制サインアウトの実行順序、部分失敗の整合の詳細は design フェーズで確定する）

2.4 WHEN ロール変更に伴いセッションを強制サインアウトしたとき THEN the system SHALL 既存のロール変更監査ログ（`USER_MANAGEMENT`、`previousValue` / `newValue`）の記録を維持し、強制サインアウトを行った事実を監査に残せること（記録方法の詳細は design フェーズで確定する）

### Unchanged Behavior (Regression Prevention)

ロールが変化しない更新、無効化フロー、プロフィール更新、共有 User Pool の既存挙動を維持する。

3.1 WHEN `PATCH /admin/users/{userId}` でロールが変化しない（`body.role` 未指定、または `body.role === existingUser.role`）とき THEN the system SHALL CONTINUE TO 強制サインアウトを実行しない（不要なログアウトを避ける）

3.2 WHEN `PATCH /admin/users/{userId}` で `body.isActive === false`（無効化）が指定されたとき THEN the system SHALL CONTINUE TO 既存の無効化フロー（`globalSignOutCognitoUser` + `disableCognitoUser`）を従来どおり実行する（無効化とロール変更が同時に来た場合に二重サインアウトにならないよう整合する詳細は design フェーズで確定する）

3.3 WHEN `displayName` または `email` のみの更新（`updateUserProfile` 経由）が行われるとき THEN the system SHALL CONTINUE TO 強制サインアウトを実行しない

3.4 WHEN 共有 User Pool 構成（JWT に `custom:role` claim が無い）でロールが変更されたとき THEN the system SHALL CONTINUE TO `extractUser` が DynamoDB の role にフォールバックすることで次の API 呼び出しで新ロールを反映する既存挙動を壊さない

3.5 WHEN ロールが変更されるとき THEN the system SHALL CONTINUE TO Cognito `custom:role`（`updateCognitoUserRole`）と DynamoDB（`updateUser`）の二重更新の既存挙動を維持する

## Bug Condition and Properties

### Bug Condition

ロールが実際に変化したにもかかわらず、セッション無効化（強制サインアウト）が発火しない状態を識別する。

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = { existingUser, body }  // PATCH /admin/users/{userId} の入力
  OUTPUT: boolean

  // ロールが実際に変化する更新を識別する
  roleChanged ← (X.body.role IS DEFINED) AND (X.body.role ≠ X.existingUser.role)

  // 現行コード F ではロール変更経路で globalSignOutCognitoUser を呼ばない。
  // すなわち「ロールは変わるのに強制サインアウトが発火しない」入力がバグ条件。
  RETURN roleChanged
END FUNCTION
```

補足: 現行関数 F では `roleChanged` が真でも `globalSignOutCognitoUser` は呼ばれない（`globalSignOutCognitoUser` は `X.body.isActive = false` のときのみ発火）。そのため `isBugCondition(X)` が真となる全入力でセッション無効化が欠落している。

### Property: Fix Checking

バグ条件を満たす全入力で、修正後関数 F' が強制サインアウトを発火し、対象ユーザーの既存セッションが無効化されること。

```pascal
// Property: Fix Checking - ロール変更時の強制サインアウト
FOR ALL X WHERE isBugCondition(X) DO
  result ← F'(X)
  ASSERT globalSignOutCognitoUser WAS CALLED WITH X.existingUser.email
  ASSERT updateCognitoUserRole WAS CALLED WITH (X.existingUser.email, X.body.role)
  ASSERT updateUser WAS CALLED WITH role = X.body.role
  ASSERT result は対象ユーザーの全既存セッションが無効化された状態を表す
END FOR
```

### Property: Preservation Checking

バグ条件を満たさない全入力で、修正後関数 F' が修正前関数 F と同一に振る舞うこと。

```pascal
// Property: Preservation Checking - ロール非変更・無効化・プロフィール更新の保持
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

具体的には、`NOT isBugCondition(X)` に含まれる以下の入力で F と F' の挙動が一致する:
- ロールが変化しない更新（`body.role` 未指定、または `body.role = existingUser.role`）→ 強制サインアウトを発火しない（3.1）
- 無効化（`body.isActive = false`）→ 既存の `globalSignOutCognitoUser` + `disableCognitoUser` フローを従来どおり実行する（3.2）
- プロフィールのみの更新（`displayName` / `email`）→ 強制サインアウトを発火しない（3.3）

**定義:**
- **F**: 修正前の `updateUserHandler`（ロール変更経路で `globalSignOutCognitoUser` を呼ばない）
- **F'**: 修正後の `updateUserHandler`（`isBugCondition(X)` が真のとき `globalSignOutCognitoUser` を呼ぶ）
- **Counterexample**: `updateUserHandler` に `pathParameters.userId = <ADMIN ユーザー>`、`body = { role: "REVIEWER" }`（既存 role = "ADMIN"、`isActive` 未指定）を与えると、現行コードでは `globalSignOutCognitoUser` が呼ばれず、専用 User Pool 構成では対象ユーザーが旧 ADMIN 権限の JWT を使い続けられる
