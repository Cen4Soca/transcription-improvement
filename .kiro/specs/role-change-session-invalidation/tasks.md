# Implementation Plan

- [x] 1. バグ条件探索テストを書く（修正前に FAIL）
  - **Property 1: Bug Condition** - ロール変更時の強制サインアウト欠落
  - **CRITICAL**: このテストは未修正コードで必ず FAIL すること。FAIL がバグの存在を証明する
  - **DO NOT attempt to fix the test or the code when it fails** — FAIL は期待された結果
  - **NOTE**: このテストは期待される振る舞い（ロール変更時に `globalSignOutCognitoUser` が発火）をエンコードする。修正後に PASS へ転じることでフィックスを検証する
  - **GOAL**: バグの存在を示す counterexample を surfacing する
  - **Scoped PBT Approach**: fast-check で role 遷移を生成するプロパティにする。アービトラリは `fc.constantFrom('REVIEWER','TEAM_LEADER','ADMIN')` から `existingRole` と `newRole` を生成し `newRole !== existingRole`（昇格・降格の全組合せ）に絞り込む。プロパティ化が難しければ降格（ADMIN→REVIEWER）/昇格（REVIEWER→ADMIN）の代表 2 ケースの探索テスト + 補助プロパティでもよいが、方針は探索テストで FAIL を示すこと
  - 配置: `backend/src/handlers/admin-users.property.test.ts`（プロパティ）。既存 `backend/src/handlers/admin-users.test.ts` のモック手法に準拠（`vi.mock` で `cognito-service` / `user-repository` / `audit-service` / `user-service` / `auth-middleware` をモック）
  - バグ条件: `isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role`（`isActive` 未指定）。`getUserById` を `existingRole` の既存ユーザーで解決させ、`body = { role: newRole }` の PATCH を `updateUserHandler` に渡す
  - アサーション（Expected Behavior = Property 1 と一致）: `globalSignOutCognitoUser` が `existingUser.email` で **1 回** 呼ばれる。`updateCognitoUserRole` が `(existingUser.email, newRole)` で呼ばれる。`updateUser` が `role = newRole` で呼ばれる
  - describe は `Feature: role-change-session-invalidation, Property 1: Bug Condition - role change session invalidation`。docstring に `**Validates: Requirements 2.1, 2.2**`。fast-check は `{ numRuns: 100 }`
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは FAILS（ロール変更ブランチに `globalSignOutCognitoUser` 呼び出しが無く、呼び出し回数 0 のため）
  - 見つかった counterexample を記録して根本原因を確認（例: 「`calculatePrice` 相当の `updateUserHandler(role: REVIEWER, existingRole: ADMIN)` で `globalSignOutCognitoUser` 呼び出し回数 0」）
  - テストを書き、実行し、FAIL を記録した時点でタスク完了とする
  - _Bug_Condition: isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role_
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Preservation プロパティテストを書く（修正前に PASS）
  - **Property 2: Preservation** - ロール非変更・無効化・プロフィール更新の保持
  - **IMPORTANT**: observation-first（観測優先）方法論に従う。まず未修正コード（F）を非バグ入力で動かし、実際の呼び出し有無/引数を観測してからテストを書く
  - 配置: `backend/src/handlers/admin-users.property.test.ts`（タスク 1 と同ファイル）。モックはタスク 1 と共通
  - 観測対象（未修正 F で記録する基準値）:
    - ロール非変更: `body.role` 未指定、または `body.role === existingUser.role` → `globalSignOutCognitoUser` 呼び出し回数 0
    - 無効化フロー: `body = { isActive: false }` → `globalSignOutCognitoUser` 1 回 + `disableCognitoUser` 1 回
    - 無効化 + ロール変更同時: `body = { role: <異なる>, isActive: false }` → `globalSignOutCognitoUser` は **1 回のみ**（二重発火しない基準値）
    - プロフィールのみ更新: `body = { displayName }` / `{ email }` → `updateUserProfile` 経由で `globalSignOutCognitoUser` 呼び出し回数 0
  - プロパティ: 非バグ入力（`body.role` 未指定 or `body.role === existingUser.role`、各種 `isActive` / プロフィール組合せ）を fast-check で生成し、`globalSignOutCognitoUser` / `disableCognitoUser` / `enableCognitoUser` / `updateUserProfile` の呼び出し回数・引数が観測した基準値と一致することをアサート
  - describe は `Feature: role-change-session-invalidation, Property 2: Preservation - non-role-change behavior preserved`。docstring に `**Validates: Requirements 3.1, 3.2, 3.3, 3.4**`。fast-check は `{ numRuns: 100 }`
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは PASS（保持すべきベースライン挙動を確認）
  - テストを書き、実行し、未修正コードで PASS を確認した時点でタスク完了とする
  - _Preservation: Preservation Requirements from design（NOT isBugCondition(X)）_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. ロール変更時セッション強制サインアウトの修正

  - [x] 3.1 新しい詳細エラーコードを追加する
    - `backend/src/utils/error-codes.ts` の `ERROR_CODES` に `ROLE_CHANGE_SESSION_INVALIDATION_FAILED: 'ROLE_CHANGE_SESSION_INVALIDATION_FAILED'` を追加する
    - 配置は `// --- Profile / user ---` グループ内、`ROLE_UPDATE_FAILED` 付近（SCREAMING_SNAKE_CASE）
    - _Requirements: 2.3_

  - [x] 3.2 updateUserHandler のロール変更ブランチに強制サインアウトを実装する
    - `backend/src/handlers/admin-users.ts` の `updateUserHandler` を変更する
    - 発火条件を定義: `roleChanged = body.role !== undefined && body.role !== existingUser.role`、`invalidateForRoleChange = roleChanged && body.isActive !== false`（無効化が走る場合は無効化ブランチの sign out に任せ、二重化しない）
    - ロール変更ブランチの実行順序を固定: (1) `updateCognitoUserRole(existingUser.email, body.role)` → (2) `invalidateForRoleChange` のとき `globalSignOutCognitoUser(existingUser.email)` → (3) `updateUser(userId, { role, isActive })` → (4) `recordAuditLog(...)`
    - 部分失敗: `globalSignOutCognitoUser` の例外を捕捉し、`internalError('Failed to invalidate existing sessions after the role change.', <cognitoError.message>, ERROR_CODES.ROLE_CHANGE_SESSION_INVALIDATION_FAILED)`（500）を throw する。握りつぶさない。ロールバックしない（再 PATCH で収束、`updateCognitoUserRole`/`globalSignOutCognitoUser` は冪等）
    - 監査: `invalidateForRoleChange` のとき `USER_MANAGEMENT` 監査ログの `metadata` に `sessionInvalidated: true` を追加する。既存 `previousValue` / `newValue` の記録は維持する
    - レイヤリング遵守: Handler はオーケストレーションのみ。Cognito 操作は既存 `cognito-service`（`updateCognitoUserRole` / `globalSignOutCognitoUser`、新規関数は追加しない）、DynamoDB は repository（`updateUser`）、監査は `audit-service`（`recordAuditLog`）
    - _Bug_Condition: isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role_
    - _Expected_Behavior: expectedBehavior(result) — roleChanged かつ body.isActive !== false のとき globalSignOutCognitoUser が existingUser.email で 1 回発火し、updateCognitoUserRole / updateUser も実行され、監査に sessionInvalidated: true が残る_
    - _Preservation: Preservation Requirements from design（ロール非変更・無効化・プロフィール更新・二重更新の既存挙動を維持）_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.5_

  - [x] 3.3 バグ条件探索テストが PASS に転じることを確認する
    - **Property 1: Expected Behavior** - ロール変更時の強制サインアウト
    - **IMPORTANT**: タスク 1 と **同じテストを再実行** する。新しいテストを書かない
    - タスク 1 のテストは期待される振る舞いをエンコードしている。このテストが PASS することで Expected Behavior が満たされたことを確認する
    - タスク 1 のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストは PASS（バグが修正されたことを確認）
    - _Expected_Behavior: expectedBehavior(result) — Property 1 Expected Behavior Properties from design_
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Preservation テストが引き続き PASS することを確認する
    - **Property 2: Preservation** - ロール非変更・無効化・プロフィール更新の保持
    - **IMPORTANT**: タスク 2 と **同じテストを再実行** する。新しいテストを書かない
    - タスク 2 の Preservation プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストは PASS（リグレッションが無いことを確認）
    - 修正後も全テストが PASS することを確認する（回帰なし）
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. 発火条件マトリクスの単体テストを追加する
  - 配置: `backend/src/handlers/admin-users.test.ts`（既存ファイルに追記）。`vi.mock` の既存モックを使用
  - 次のケースをカバーする:
    - 昇格（REVIEWER→ADMIN）で `globalSignOutCognitoUser` が `existingUser.email` で 1 回呼ばれる
    - 降格（ADMIN→REVIEWER）で `globalSignOutCognitoUser` が 1 回呼ばれる
    - 実行順序: `updateCognitoUserRole` → `globalSignOutCognitoUser` → `updateUser` → `recordAuditLog`（`mock.invocationCallOrder` で検証）
    - ロール同一指定（`body.role === existingUser.role`）で `globalSignOutCognitoUser` が呼ばれない
    - ロール未指定（`body.role` undefined、`isActive` のみ等）で `globalSignOutCognitoUser` が呼ばれない
    - `body = { role: <異なる>, isActive: false }`（無効化同時指定）で `globalSignOutCognitoUser` が 1 回のみ（二重化しない）+ `disableCognitoUser` 1 回
    - プロフィールのみ更新（`displayName` / `email`）で `globalSignOutCognitoUser` が呼ばれない
    - 部分失敗: `updateCognitoUserRole` 成功後に `globalSignOutCognitoUser` が例外を投げたとき、レスポンスが 500 かつ `errorCode = ROLE_CHANGE_SESSION_INVALIDATION_FAILED`、`updateUser` と `recordAuditLog` が呼ばれないこと
    - 監査 metadata に `sessionInvalidated: true` と既存 `previousValue` / `newValue` が含まれること
  - _Bug_Condition: isBugCondition(X) = body.role !== undefined && body.role !== existingUser.role_
  - _Expected_Behavior: expectedBehavior(result) from design_
  - _Preservation: Preservation Requirements from design_
  - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.2, 3.3, 3.5_

- [x] 5. Checkpoint - 全テストが PASS することを確認する
  - `cd backend && npx vitest --run src/handlers/admin-users.test.ts src/handlers/admin-users.property.test.ts` を実行する（関連範囲）
  - 探索テスト（Property 1）が PASS、Preservation テスト（Property 2）が PASS、単体テストが全て PASS であることを確認する
  - 疑問が生じた場合はユーザーに確認する

- [x] 6. 実機確認（監査ログ + 手動）
  - **GOAL**: 修正の実機動作を確認する。確認対象を 2 つに役割分担する: (a) 監査ログに `sessionInvalidated: true` が記録されることは **自動化対象**（API/画面/軽量 Playwright で観測可能）、(b) 既存 JWT セッションの強制サインアウトの実体（対象ユーザーが再ログインを求められる / 401）は UI 操作だけでは観測しにくく 2 ブラウザコンテキストの 401 再現が E2E として不安定なため **手動確認対象**
  - **E2E spec は新規作成を必須としない**。セッション無効化そのものの UI 観測は手動確認（6.2）に委ね、自動化は監査ログ観測（6.1）に限定する
  - _Requirements: 2.1, 2.2, 2.4_

  - [x] 6.1 監査ログによる実機確認（自動化できる範囲）
    - **確認内容**: 修正により、ロール変更（`roleChanged && body.isActive !== false`）時に `recordAuditLog` の `metadata` に `sessionInvalidated: true` が記録される（`operationType = USER_MANAGEMENT`、既存の `previousValue` / `newValue` 併記）。これは admin の監査ログ API / 画面で観測可能
    - **確認方法（2 通り。実施しやすい方を採る）**:
      - (i) **API（推奨・自動化対象）**: 管理者トークンで `PATCH /admin/users/{userId}` にロール変更を投げ、その後 `GET /admin/audit-logs`（`operationType=USER_MANAGEMENT` でフィルタ）で当該ログの `metadata` に `sessionInvalidated: true` と `previousValue` / `newValue` が含まれることを確認する。`e2e/helpers/api-helper.ts` の `apiRequest` と `e2e/helpers/cognito-helper.ts` の `adminAuth` を使ったスクリプト、または軽量 Playwright test で確認できる
      - (ii) **UI**: admin の監査ログ画面（`e2e/tests/admin/audit-logs.spec.ts` が参照する画面）で `USER_MANAGEMENT` を絞り込み、該当エントリの `metadata` を確認する
    - **任意の確認 spec**: 必要なら最小の確認 spec（例: `e2e/tests/admin/role-change-session-invalidation.spec.ts`）を 1 本だけ置いてもよい。ただし **目的を監査ログに `sessionInvalidated: true` が出ることの確認に限定** し、UI でのセッション無効化そのものの観測は目的にしない。環境依存のため `npx playwright test --list`（収集確認）+ 可能なら実行、で可
    - **固定ユーザー保護（必須）**: テスト用ユーザーのロールを変更するとそのユーザーに影響が出るため、**テスト専用ユーザーを作って変更する / 変更後に元のロールへ戻す** などで、`e2e/global-setup.ts` の固定ユーザー（`teamLeader` = `e2e-leader@test.example.com` / `reviewer` = `e2e-reviewer@test.example.com`）のロール前提を壊さないこと。固定ユーザーのロールを直接変更しない
    - _Requirements: 2.1, 2.4_

  - [x] 6.2 手動確認手順書（セッション無効化の実体）
    - **目的**: 強制サインアウトの実体（既存 JWT が無効化され、対象ユーザーが次の API / 画面操作で再ログインを求められる）を人手で確認する。以下の手順で実施する:
      1. 対象ユーザー U で dev 環境にログインし、セッションを保持する（ブラウザ A）
      2. 別ブラウザ / 別セッションで管理者が U のロールを変更する（昇格 or 降格）
      3. ブラウザ A で U が次の操作（ページ遷移 / API 呼び出し）を行うと、セッションが無効化され再ログインを求められる（または 401 が返る）ことを確認する
      4. 降格の場合、再ログイン後は新しい（低い）ロールの権限に制限されることを確認する
    - **挙動の注意（手順に補記）**: Cognito の global sign-out（`AdminUserGlobalSignOut`）はリフレッシュトークンを即時無効化するが、既発行のアクセストークンは短期の有効期限が切れた時点で弾かれる。したがって手順 3 の拒否は **即時 401 とは限らず、アクセストークンの有効期限に依存しうる**（リフレッシュ時 / トークン失効後に確実に再ログインが要求される）
    - _Requirements: 2.1, 2.2_
