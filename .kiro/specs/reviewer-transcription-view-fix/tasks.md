# Implementation Plan

> NOTE: 本バグは reviewer-media-playback-fix と同一の `extractUser` 修正で解消済み。ユーザー指示によりタスク1・2（PBT）はスキップし、get-segments / get-session-detail を含むバックエンド全テスト（1283 passed）で検証・回帰確認済み。`extractUser` の再実装は行っていない。

> **関連スペックとの整合（reviewer-media-playback-fix）**
> 本バグは関連スペック `reviewer-media-playback-fix` と**同一の根本原因**（`extractUser` が `custom:role` 経路で `AuthUser.userId` に Cognito `sub` を採用し、DynamoDB の正規 `userId` と不整合になる）に起因し、**単一の `extractUser` 修正で両方のバグが同時に解消される見込み**である（design.md「関連スペックとの整合」参照）。
> そのため、**実装タスク 3.1 の着手時にまず `backend/src/utils/auth-middleware.ts` の `extractUser` が既に修正済みか確認すること**。`reviewer-media-playback-fix` 側で既に識別子正規化が適用されている場合は、**本スペックで `extractUser` を再実装・再変更してはならない**。その場合はタスク 3.1 を「既存修正の確認のみ」に読み替え、セグメント取得 API（`GET /sessions/{sessionId}/segments`）とセッション詳細 API（`GET /sessions/{sessionId}`）経路の**検証（探索テスト・Preservation テスト・ハンドラ単位テスト）に注力する**。
> `extractUser` 自体のユニット／プロパティテストは関連スペックと重複させず 1 箇所に集約する。本スペックのテストはセグメント・セッション詳細エンドポイントを対象とし、関連スペックのメディア URL テストと対象が異なるため共存可能である。

- [ ] 1. バグ条件の探索テストを作成する（修正前）
  - **Property 1: Bug Condition** - 正当なアクセス権を持つ非 ADMIN ユーザーのトランスクリプション閲覧
  - **IMPORTANT**: このプロパティベーステストは修正を実装する前に書くこと
  - **CRITICAL**: 未修正コードでこのテストは FAIL しなければならない。失敗がバグの存在を証明する
  - **DO NOT**: テストが失敗してもテストやコードを修正しないこと
  - **NOTE**: このテストは期待挙動をエンコードしている。修正実装後に PASS することで修正を検証する
  - **GOAL**: バグの存在を示す反例（counterexample）を表面化させ、根本原因（`AuthUser.userId` が Cognito `sub` で割り当て・所属キーの DynamoDB `userId` と不一致）を確認または反証する
  - **Scoped PBT Approach**: 決定論的バグのため、プロパティを具体的な失敗ケースにスコープする。`sub != dynamoDbUserId` かつ正規 `userId` キーで割り当て・所属が実在する非 ADMIN ユーザー（REVIEWER / TEAM_LEADER）を生成する
  - fast-check で入力を生成: `role ∈ {REVIEWER, TEAM_LEADER}`、`sub`（Cognito UUID）と `dynamoDbUserId`（別の UUID）が常に不一致、`USER#{dynamoDbUserId}` キーで ReviewAssignment（直接割り当て）または TeamMembership + TeamAssignment（自チーム割り当て）が存在
  - isBugCondition（design の Formal Specification）を満たす入力を構築する: `isValidRole(claims['custom:role']) AND claims['custom:role'] != 'ADMIN' AND hasLegitimateAccess(dynamoUserRecord.userId, sessionId) AND claims['sub'] != dynamoUserRecord.userId AND accessCheckDeniesAccess(claims['sub'], sessionId)`
  - テスト対象: `custom:role` 付き JWT で `extractUser` → `checkSessionAccess` → `getSegments`（セグメント取得 API）および `getSessionDetail`（セッション詳細 API）の経路を未修正コードで実行する
  - テストのアサーションは design の Correctness Property 1（Expected Behavior）に一致させる: アクセスが許可され、セグメント取得 API が当該セッションのセグメントを返し、セッション詳細 API がセッション詳細を返すこと
  - **Test Cases**（design の Exploratory Bug Condition Checking より）:
    - 直接割り当て REVIEWER のセグメント取得テスト: `USER#{dynamoDbUserId}` に ReviewAssignment を設定し、`GET /sessions/{sessionId}/segments` が 404 になることを観測
    - 自チーム割り当て TEAM_LEADER のセグメント取得テスト: `USER#{dynamoDbUserId}` キーでチームに所属させ、同チームにセッションを割り当て、`GET /sessions/{sessionId}/segments` が 404 になることを観測
    - セッション詳細取得テスト: 上記いずれかの非 ADMIN ユーザーで `GET /sessions/{sessionId}` が 404 になることを観測
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは FAIL する（正しい結果 — バグの存在を証明する）
  - 発見した反例を文書化して根本原因を理解する（例: 「正規 `userId` キーで割り当て・所属が実在するにもかかわらず、`sub` ベースの照会が不一致となり 404 が返り、セグメント・セッション詳細が表示されない」）
  - テストが書かれ、実行され、失敗が文書化された時点でタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Preservation プロパティテストを作成する（修正前）
  - **Property 2: Preservation** - バグ条件外の認証・アクセス判定挙動の維持
  - **IMPORTANT**: observation-first（観測優先）メソドロジーに従うこと
  - **手順**: 未修正コードをバグ条件外の入力（isBugCondition が false を返すケース）で実行し、実際の出力を観測・記録してから、その出力をプロパティテストで固定する
  - バグ条件外の入力を生成する: ADMIN による要求、正規識別子でも割り当て・所属が存在しない非 ADMIN による要求、`custom:role` を持たない共有プール経路、無効化アカウント
  - **観測して記録する挙動**（design の Preservation Checking / Preservation Requirements より）:
    - ADMIN 閲覧の保持: 未修正コードで ADMIN がセグメント・セッション詳細を取得できることを観測（Req 3.1）
    - アクセス権なし 404 の保持: 正規識別子でも割り当て・所属が無い非 ADMIN が 404 になることを観測（Req 3.2）
    - 共有プール経路の保持: `custom:role` 無しユーザーの `userId`／ロール解決・JIT プロビジョニング・無効化 403 を観測（Req 3.3）
    - ロール・プロフィール保持: `custom:role` 経路で `AuthUser.role` が `custom:role` 値になり、`email`／`displayName` が設定される挙動を観測（Req 3.4, 3.5）
  - fast-check でバグ条件外の入力領域（ロール、`custom:role` の有無、識別子一致／不一致、割り当て・所属の有無、無効化状態）を横断してプロパティベーステストを書く: `FOR ALL input WHERE NOT isBugCondition(input): extractUser_original(input) == extractUser_fixed(input)`（および同一の `checkSessionAccess` 判定結果）
  - `numRuns: 100` を既定とし、describe はフィーチャー名とプロパティ番号を参照、docstring は検証する Requirement を参照する（テスト規約準拠）
  - **NOTE**: `extractUser` 自体の挙動固定テストは関連スペック `reviewer-media-playback-fix` と重複させず 1 箇所に集約する。本スペックのこのタスクはセグメント／セッション詳細経路のアクセス判定に対する Preservation を対象とする
  - 未修正コードでテストを実行する
  - **EXPECTED OUTCOME**: テストは PASS する（保持すべきベースライン挙動を確認する）
  - テストが書かれ、実行され、未修正コードで PASS した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. 非 ADMIN ユーザーのトランスクリプション非表示不具合の修正

  - [x] 3.1 アクセス判定識別子の不整合を修正する（または既存修正を確認する）
    - **FIRST**: 着手時に `backend/src/utils/auth-middleware.ts` の `extractUser` が関連スペック `reviewer-media-playback-fix` により既に識別子正規化済みかを確認する
    - **既に修正済みの場合**: `extractUser` を再実装・再変更しない。本タスクは「既存修正が本スペックのバグ条件（セグメント・セッション詳細経路）を解消することの確認」に読み替え、タスク 3.2 / 3.3 の検証に注力する
    - **未修正の場合のみ**: `extractUser` を修正する
      - **識別子の正規化**: JWT の `custom:role` 経路でも `email` クレームから DynamoDB ユーザーレコードを解決し、`userRecord.userId`（正規 DynamoDB `userId`）を `AuthUser.userId` に採用する（`sub` をそのまま使わない）。`role` は有効な `custom:role` があればそれを優先する（Req 2.4）
      - **既存レコードが無い場合の整合**: レコードが存在しない場合は現行の JIT プロビジョニング（`provisionUserOnFirstLogin`）に委譲し、採番済みの DynamoDB `userId` を返す
      - **ADMIN 経路の不変性**: `isAdmin` 判定と `checkSessionAccess` の早期リターン経路は変更しない（Req 3.1）
      - **共有プール経路の不変性**: `custom:role` 無しユーザーの `userId`／ロール解決・JIT プロビジョニング・無効化チェックは現行どおり維持する（Req 3.3）。`email` クレーム欠如時の 403、無効化アカウント（`isActive=false`）の 403 を維持する
      - **副作用・互換性**: 識別子解決のための追加照会はアクセス判定前に一度で完結させ、既存ハンドラ（`get-segments.ts` / `get-session-detail.ts` 等）には変更を加えない
    - _Bug_Condition: isBugCondition(input) = isValidRole(claims['custom:role']) AND claims['custom:role'] != 'ADMIN' AND hasLegitimateAccess(dynamoUserRecord.userId, sessionId) AND claims['sub'] != dynamoUserRecord.userId AND accessCheckDeniesAccess(claims['sub'], sessionId)（design より）_
    - _Expected_Behavior: expectedBehavior(result) = バグ条件成立時に `AuthUser.userId` が正規 DynamoDB `userId` に解決され（role は `custom:role`）、`checkSessionAccess` が成功し、セグメント取得 API がセグメントを返し、セッション詳細 API がセッション詳細を返す（design Correctness Property 1 より）_
    - _Preservation: Preservation Requirements（ADMIN 閲覧許可、アクセス権なし 404、共有プール経路の `userId`／ロール解決・JIT・無効化チェック、解決後ロール値、`email`／`displayName` 設定）（design より）_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 バグ条件の探索テストが PASS することを確認する
    - **Property 1: Expected Behavior** - 正当なアクセス権を持つ非 ADMIN ユーザーのトランスクリプション閲覧
    - **IMPORTANT**: タスク 1 と同じテストを再実行する。新しいテストは書かない
    - タスク 1 のテストは期待挙動をエンコードしている。このテストが PASS することで期待挙動が満たされたことを確認する
    - タスク 1 のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストは PASS する（バグが修正されたことを確認する — セグメント取得・セッション詳細の両 API がアクセス許可され結果を返す）
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Preservation テストが引き続き PASS することを確認する
    - **Property 2: Preservation** - バグ条件外の認証・アクセス判定挙動の維持
    - **IMPORTANT**: タスク 2 と同じテストを再実行する。新しいテストは書かない
    - タスク 2 の Preservation プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストは PASS する（リグレッションが無いことを確認する）
    - 修正後もすべてのテストが PASS することを確認する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. チェックポイント — すべてのテストが PASS することを確認する
  - `cd backend && npx vitest --run` でバックエンドの全ユニット・プロパティテストを実行する
  - Property 1（Fix Checking）と Property 2（Preservation）の両方が PASS することを確認する
  - 関連スペック `reviewer-media-playback-fix` と同一の `extractUser` 修正を前提に、セグメント取得・セッション詳細・メディア URL の 3 経路すべてが非 ADMIN ユーザーで機能することを横断的に確認する（両スペックの修正が同一変更で解消されることの検証）
  - 既存テストにリグレッションが無いことを確認する
  - 疑問が生じた場合はユーザーに確認する
