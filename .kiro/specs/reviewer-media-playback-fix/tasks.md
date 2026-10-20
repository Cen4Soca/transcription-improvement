# Implementation Plan

> NOTE: ユーザー指示によりタスク1・2（探索/Preservation の PBT）はスキップ。代わりに `auth-middleware.test.ts` / `.property.test.ts` の最小ユニット/プロパティテストで検証し、バックエンド全テスト（1283 passed）で回帰を確認済み。

- [ ] 1. バグ条件の探索テストを作成する（修正前）
  - **Property 1: Bug Condition** - 正当なアクセス権を持つ非 ADMIN ユーザーのメディア URL 取得
  - **IMPORTANT**: このプロパティベーステストは修正を実装する前に書くこと
  - **CRITICAL**: 未修正コードでこのテストは FAIL しなければならない。失敗がバグの存在を証明する
  - **DO NOT**: テストが失敗してもテストやコードを修正しないこと
  - **NOTE**: このテストは期待挙動をエンコードしている。修正実装後に PASS することで修正を検証する
  - **GOAL**: バグの存在を示す反例（counterexample）を表面化させ、根本原因（`AuthUser.userId` が Cognito `sub` で割り当てキーの DynamoDB `userId` と不一致）を確認または反証する
  - **Scoped PBT Approach**: 決定論的バグのため、プロパティを具体的な失敗ケースにスコープする。`sub != dynamoDbUserId` かつ正規 `userId` キーで割り当てが実在する非 ADMIN ユーザー（REVIEWER / TEAM_LEADER）を生成する
  - fast-check で入力を生成: `role ∈ {REVIEWER, TEAM_LEADER}`、`sub`（Cognito UUID）と `dynamoDbUserId`（別の UUID）が常に不一致、`USER#{dynamoDbUserId}` キーで ReviewAssignment（直接割り当て）または TeamMembership + TeamAssignment（自チーム割り当て）が存在
  - isBugCondition（design の Formal Specification）を満たす入力を構築する: `NOT isAdmin(user) AND hasLegitimateAccess(canonicalUserId(user), sessionId) AND user.userId != canonicalUserId(user) AND accessCheckDeniesAccess(user.userId, sessionId)`
  - テスト対象: `custom:role` 付き JWT で `extractUser` → `checkSessionAccess` → `getMediaUrl` の経路を未修正コードで実行する
  - テストのアサーションは design の Correctness Property 1（Expected Behavior）に一致させる: アクセスが許可され、署名付き URL（`signedUrl` + `expiresAt`）が返ること
  - **Test Cases**（design の Exploratory Bug Condition Checking より）:
    - 直接割り当て REVIEWER: `USER#{dynamoDbUserId}` に ReviewAssignment を設定し、メディア URL 要求が 404 になることを観測
    - 自チーム割り当て TEAM_LEADER: `USER#{dynamoDbUserId}` キーでチームに所属させ、同チームにセッションを割り当て、要求が 404 になることを観測
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは FAIL する（正しい結果 — バグの存在を証明する）
  - 発見した反例を文書化して根本原因を理解する（例: 「正規 `userId` キーで割り当てが実在するにもかかわらず、`sub` ベースの照会が不一致となり 404 が返る」）
  - テストが書かれ、実行され、失敗が文書化された時点でタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Preservation プロパティテストを作成する（修正前）
  - **Property 2: Preservation** - バグ条件外のアクセス判定挙動の維持
  - **IMPORTANT**: observation-first（観測優先）メソドロジーに従うこと
  - **手順**: 未修正コードをバグ条件外の入力（isBugCondition が false を返すケース）で実行し、実際の出力を観測・記録してから、その出力をプロパティテストで固定する
  - バグ条件外の入力を生成する: ADMIN による要求、正規識別子でも割り当てが存在しない非 ADMIN による要求、scanStatus 違反（PENDING / INFECTED）、メディア未存在
  - **観測して記録する挙動**（design の Preservation Checking / Preservation Requirements より）:
    - ADMIN 許可の保持: 未修正コードで ADMIN が許可され署名付き URL が返ることを観測（Req 3.1）
    - アクセス権なし 404 の保持: 正規識別子でも割り当てが無い非 ADMIN が 404 になることを観測（Req 3.2）
    - scanStatus ガードの保持: PENDING / INFECTED で 403 になる挙動を観測（既存 `get-media-url.property.test.ts` の scanStatus プロパティを含む、Req 3.3）
    - メディア未存在 404 の保持: セッションにメディアが無い場合の 404 を観測（Req 3.4）
    - 署名付き URL の有効期限（既定 300 秒）と CSP 適合ホスト（`media-src https://*.amazonaws.com`）の保持を観測（Req 3.5）
  - fast-check でバグ条件外の入力領域（ロール、識別子一致／不一致、scanStatus、割り当ての有無）を横断してプロパティベーステストを書く: `FOR ALL input WHERE NOT isBugCondition(input): getMediaUrlFlow_original(input) == getMediaUrlFlow_fixed(input)`
  - `numRuns: 100` を既定とし、describe はフィーチャー名とプロパティ番号を参照、docstring は検証する Requirement を参照する（テスト規約準拠）
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは PASS する（保持すべきベースライン挙動を確認する）
  - テストが書かれ、実行され、未修正コードで PASS した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. 非 ADMIN ユーザーのメディア再生不具合の修正

  - [x] 3.1 アクセス判定識別子の不整合を修正する
    - `backend/src/utils/auth-middleware.ts` の `extractUser` を修正する
    - **識別子の正規化**: JWT の `custom:role` 経路でも `email` クレームから DynamoDB ユーザーレコードを解決し、`userRecord.userId`（正規 DynamoDB `userId`）を `AuthUser.userId` に採用する（`sub` をそのまま使わない）。`role` は有効な `custom:role` があればそれを優先してよい
    - **既存レコードが無い場合の整合**: レコードが存在しない場合は現行の JIT プロビジョニング（`provisionUserOnFirstLogin`）に委譲し、採番済みの DynamoDB `userId` を返す
    - **ADMIN 経路の不変性**: `isAdmin` 判定と `checkSessionAccess` の早期リターン経路は変更しない
    - **副作用・互換性**: `email` クレーム欠如時の 403、無効化アカウント（`isActive=false`）の 403 を維持する。識別子解決のための追加照会はアクセス判定前に一度で完結させ、既存ハンドラ（`get-media-url.ts` 等）には変更を加えない
    - _Bug_Condition: isBugCondition(input) = NOT isAdmin(user) AND hasLegitimateAccess(canonicalUserId(user), sessionId) AND user.userId != canonicalUserId(user) AND accessCheckDeniesAccess(user.userId, sessionId)（design より）_
    - _Expected_Behavior: expectedBehavior(result) = バグ条件成立時にアクセス許可 + getMediaUrl 呼び出し + 署名付き URL（signedUrl + expiresAt）生成・返却（design Correctness Property 1 より）_
    - _Preservation: Preservation Requirements（ADMIN 許可、アクセス権なし 404、scanStatus 403、メディア未存在 404、署名付き URL の有効期限・ホスト制約）（design より）_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 バグ条件の探索テストが PASS することを確認する
    - **Property 1: Expected Behavior** - 正当なアクセス権を持つ非 ADMIN ユーザーのメディア URL 取得
    - **IMPORTANT**: タスク 1 と同じテストを再実行する。新しいテストは書かない
    - タスク 1 のテストは期待挙動をエンコードしている。このテストが PASS することで期待挙動が満たされたことを確認する
    - タスク 1 のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストは PASS する（バグが修正されたことを確認する）
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Preservation テストが引き続き PASS することを確認する
    - **Property 2: Preservation** - バグ条件外のアクセス判定挙動の維持
    - **IMPORTANT**: タスク 2 と同じテストを再実行する。新しいテストは書かない
    - タスク 2 の Preservation プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストは PASS する（リグレッションが無いことを確認する）
    - 修正後もすべてのテストが PASS することを確認する（既存の `get-media-url.property.test.ts` を含む）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. チェックポイント — すべてのテストが PASS することを確認する
  - `cd backend && npx vitest --run` でバックエンドの全ユニット・プロパティテストを実行する
  - Property 1（Fix Checking）と Property 2（Preservation）の両方が PASS することを確認する
  - 既存テストにリグレッションが無いことを確認する
  - 疑問が生じた場合はユーザーに確認する
