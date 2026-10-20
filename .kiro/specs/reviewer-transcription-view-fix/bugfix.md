# Bugfix Requirements Document

## Introduction

非ADMINユーザー（REVIEWER / TEAM_LEADER）が校閲画面を開くと、トランスクリプション（文字起こしセグメント）が表示されない。ADMINでは正常に表示できる。

校閲画面はセグメント取得API（`GET /sessions/{sessionId}/segments`）とセッション詳細API（`GET /sessions/{sessionId}`）を呼び出し、いずれも `checkSessionAccess(user, sessionId)` でアクセス判定を行う。この判定は、呼び出しユーザーの `userId` をキーにチーム所属（TeamMembership）と担当（ReviewAssignment / TeamAssignment）を DynamoDB で照合する。

根本原因は `extractUser`（`backend/src/utils/auth-middleware.ts`）の userId 解決にある。JWT に有効な `custom:role` クレームがある場合、`extractUser` は `userId` を Cognito の `sub` クレームからそのまま採用する。一方、DynamoDB のユーザーレコード（およびそれにぶら下がる TeamMembership / ReviewAssignment）は、ユーザー作成時（`admin-users.ts` / `admin-sync-user.ts` / JIT プロビジョニング）に生成される `uuidv4()` の `userId` をキーにしている。この2つの ID は一致しないため、`checkSessionAccess` → `userHasSessionAccess` が `USER#{sub}` でチーム所属・担当を検索しても一致レコードが見つからず、非ADMINユーザーはアクセス拒否（404）となりセグメントが表示されない。

ADMIN は `checkSessionAccess` 内の `isAdmin(user)` で DynamoDB 照合前に早期 return するため、この ID 不一致の影響を受けず表示できる。これが「ADMINでは表示できるが非ADMINでは表示できない」という症状の理由である。

## Bug Analysis

### Current Behavior (Defect)

JWT に有効な `custom:role` クレームを持つ非ADMINユーザーについて、`extractUser` が解決する `userId`（= `sub`）が DynamoDB ユーザーレコードの `userId`（= `uuidv4()`）と異なるため、アクセス判定がチーム所属・担当レコードと照合できず失敗する。

1.1 WHEN 有効な `custom:role` クレームを持つ REVIEWER が、自分が担当（ReviewAssignment）する、またはチーム所属経由（TeamAssignment）でアクセス可能なセッションの校閲画面を開く THEN the system はセグメント取得API（`GET /sessions/{sessionId}/segments`）で 404 を返し、セグメントを表示しない
1.2 WHEN 有効な `custom:role` クレームを持つ TEAM_LEADER が、自チームに割り当てられたセッションの校閲画面を開く THEN the system はセグメント取得API（`GET /sessions/{sessionId}/segments`）で 404 を返し、セグメントを表示しない
1.3 WHEN 有効な `custom:role` クレームを持つ非ADMINユーザーが、アクセス可能なセッションのセッション詳細API（`GET /sessions/{sessionId}`）を呼び出す THEN the system は 404 を返す
1.4 WHEN `extractUser` が有効な `custom:role` クレームを処理する THEN the system は JWT の `sub` を `userId` として採用し、DynamoDB ユーザーレコードの正規 `userId` を解決しない

### Expected Behavior (Correct)

アクセス権を持つ非ADMINユーザーは、校閲画面でセグメントとセッション詳細を閲覧できる。`extractUser` はロールのソースに関わらず、DynamoDB ユーザーレコードの正規 `userId` を解決し、以降のアクセス判定がチーム所属・担当レコードと正しく照合できるようにする。

2.1 WHEN 有効な `custom:role` クレームを持つ REVIEWER が、自分が担当する、またはチーム所属経由でアクセス可能なセッションの校閲画面を開く THEN the system SHALL セグメント取得API（`GET /sessions/{sessionId}/segments`）でそのセッションのセグメントを返す
2.2 WHEN 有効な `custom:role` クレームを持つ TEAM_LEADER が、自チームに割り当てられたセッションの校閲画面を開く THEN the system SHALL セグメント取得API（`GET /sessions/{sessionId}/segments`）でそのセッションのセグメントを返す
2.3 WHEN 有効な `custom:role` クレームを持つ非ADMINユーザーが、アクセス可能なセッションのセッション詳細API（`GET /sessions/{sessionId}`）を呼び出す THEN the system SHALL セッション詳細を返す
2.4 WHEN `extractUser` が有効な `custom:role` クレームを処理する THEN the system SHALL DynamoDB ユーザーレコードの正規 `userId` を `AuthUser.userId` として採用しつつ、ロールは JWT の `custom:role` クレームから採用する

### Unchanged Behavior (Regression Prevention)

3.1 WHEN ADMIN ユーザーが任意のセッションの校閲画面を開く THEN the system SHALL CONTINUE TO セグメントとセッション詳細を表示する
3.2 WHEN 非ADMINユーザーが、担当もチーム所属経由の割り当ても持たないセッションにアクセスする THEN the system SHALL CONTINUE TO 404 を返して存在を隠蔽する
3.3 WHEN `custom:role` クレームを持たないユーザー（共有ユーザープール経由）が認証する THEN the system SHALL CONTINUE TO DynamoDB ユーザーレコードからロールと `userId` を解決し、JIT プロビジョニングと無効化アカウントのチェックを行う
3.4 WHEN `extractUser` が有効な `custom:role` クレームを処理する THEN the system SHALL CONTINUE TO 解決したロールを `AuthUser.role` として返す
3.5 WHEN いずれかのロールのユーザーが認証する THEN the system SHALL CONTINUE TO `email` および `displayName` を `AuthUser` に設定する

## Bug Condition and Properties

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { claims, dynamoUserRecord }
  OUTPUT: boolean

  // 有効な custom:role クレームを持ち、かつ JWT の sub が
  // DynamoDB ユーザーレコードの正規 userId と一致しない非ADMINユーザー
  RETURN isValidRole(X.claims['custom:role'])
     AND X.claims['custom:role'] <> 'ADMIN'
     AND X.claims['sub'] <> X.dynamoUserRecord.userId
END FUNCTION
```

### Property: Fix Checking

```pascal
// アクセス権を持つ非ADMINユーザーは正規 userId で解決され、アクセス判定に通る
FOR ALL X WHERE isBugCondition(X) DO
  user ← extractUser'(X)
  ASSERT user.userId = X.dynamoUserRecord.userId
  ASSERT user.role   = X.claims['custom:role']
  // 結果として、担当/チーム所属を持つセッションに対し
  ASSERT checkSessionAccess(user, accessibleSessionId) succeeds (no 404)
END FOR
```

### Property: Preservation Checking

```pascal
// バグ条件に該当しない全入力で、修正前後の挙動は同一
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT extractUser(X) = extractUser'(X)
END FOR
```

**定義**
- **F**: 修正前の `extractUser`（JWT パスで `userId = sub` を採用）
- **F'**: 修正後の `extractUser`（ロールのソースに関わらず DynamoDB の正規 `userId` を解決、ロールは `custom:role` を優先）
