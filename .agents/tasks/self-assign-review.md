# Reviewer self-assign feature (C案) — semantic review

Reviewer セルフ割り当て機能の実装レビュー。REVIEWER が TEAM_LEADER/ADMIN の割り当てを待たず、自チームに割り当てられた自動生成 PENDING セッションに自分で join できるようにする変更。バックエンドに join 候補一覧 (`GET /sessions/joinable`) とセルフ割り当て (`POST /sessions/{sessionId}/self-assign`) の 2 API を追加し、既存 `joinSession` と同一の DB ベース権限判定を再利用。フロントは新ページを作らず既存 `SessionListPage`/`SessionAssignmentControls` に `scope='joinable'` を足して導線を追加。CDK は `api-stack.ts` 1 ファイルに Lambda 2 本 + ルート 2 本を追加。

Watch for: なし。重点観点（権限昇格・候補抽出経路・既存挙動の非破壊・監査ログ・構造規約・テスト）はすべて満たされており、ブロッキングな発見はない。

**Verdict**: APPROVED

## High-level view

権限昇格の防止が本機能の肝であり、設計どおり実装されている。`selfAssignSession` は `requireRole` を使わず REVIEWER を通すが、所属判定は `isTeamMember(user.userId, session.assignedTeamId)`（DynamoDB `TEAM#{teamId}/MEMBER#{userId}` を引く）に委ねており、`session.assignedTeamId` はサーバ生成の照合対象であって呼び出し元が所属を主張する手段ではない。候補一覧 `listJoinableSessions` も非 ADMIN の母集合を `getUserTeamIds`（GSI1 の DB クエリ）起点に構成するため、JWT クレーム由来の teamId は一切信用されない。NFR-1 を満たす。

join 候補の抽出経路は、既存 `getAccessibleSessionIds`（`ASSIGNMENT#` レコードしか見ず自動生成 PENDING を拾わない）を迂回し、`getSessionsByTeamId`（GSI1 で `assignedTeamId` 属性を列挙）＋ PENDING フィルタ＋ `getSessionIdsByParticipantUserId` の 1 クエリ Set 差分で未参加を除く構成になっている。これがユーザー報告の「候補が一覧に出ない」課題の直接の解決であり、property test で部分集合不変条件が実証されている。

既存挙動の非破壊は `SessionAssignmentControls` の prop 追加で担保されている。`scope` 未指定時の表示条件は `onClaim && !isClaimed` のまま 1 ビットも変わらず、新しい候補向け条件は `scope==='joinable'` のときだけ有効化される。`/` と `/assigned` は従来の `handleClaim`/`claimSession` 経路を使い続け、`/joinable` だけが `handleSelfAssign`/`selfAssignSession` に接続される。

監査ログとエラー方針は既存 join と一貫している。成功時のみハンドラ層で `REVIEW_ASSIGNMENT_CHANGE` を `metadata.reason:'self-assign'` 付きで記録し、404/403 で throw したときは記録に到達しない。存在しない→404・スコープ外→403 の使い分けも `joinSession` と同一。

<details>
<summary>Issues (0)</summary>

ブロッキング・非ブロッキングいずれの発見もなし。

</details>

<details>
<summary>Details</summary>

### DB ベースの所属判定で権限昇格を遮断

`selfAssignSession`（`session-service.ts`）は `joinSession` と判定順序・エラー種別が同一で、`requireRole` を意図的に使わないことで REVIEWER を入口で弾かない。非 ADMIN は `session.assignedTeamId` 未設定で 403、設定済みでも `isTeamMember(user.userId, session.assignedTeamId)` が false なら 403。`isTeamMember` は `access-control-service.ts` で `PK=TEAM#{teamId}, SK=MEMBER#{userId}` を DynamoDB に問い合わせており、JWT の `custom:*` クレームは参照しない。`assignedTeamId` はセッション属性（サーバ生成）であって攻撃者が注入できる経路がないため、これを照合に使っても昇格にはつながらない。

`listJoinableSessions` の非 ADMIN パスも `getUserTeamIds(user.userId)`（GSI1 `GSI1PK=USER#{userId}, begins_with(GSI1SK, 'TEAM#')` の DB クエリ）を母集合の起点にしており、クレーム由来の teamId を信用しない。ADMIN のみ `getAllSessions()` 全件を母集合にするが、これは既存一覧 API（`getAccessibleSessionIds` が ADMIN に全件を返す方針）と一致する。

property test Property 2 がこの不変条件を 100 ケースで固定している。`getSessionsByTeamId` を「`assignedTeamId === queriedTeam` を返す」実 GSI 挙動でモックし、結果の各セッションについて `teamSet.has(assignedTeamId)` が true（＝ DB 所属チーム以外は出ない）・PENDING・未参加であることを検証し、さらに REVIEWER パスで `getAllSessions` が呼ばれないことをアサートしている。所属主張の手段と DB 判定を取り違える回帰をこのテストが捕捉する。

### 候補抽出が自動生成 PENDING を正しく拾う

母集合取得 → `Map<sessionId, SessionRecord>` で de-dup → `status==='PENDING'` フィルタ → `getSessionIdsByParticipantUserId(user.userId)` を 1 回だけ呼んで Set 化し未参加のみ残す → `sortByCreatedAtDesc`、という設計どおりの流れ。未参加フィルタを候補ごとの `isParticipant` N 連打ではなく単一クエリ + メモリ差分にしているため、ADMIN 全件母集合でも GetCommand の N 連打が発生しない。

```
getUserTeamIds(DB) ──> getSessionsByTeamId(team) × N ──┐
                                                        ├─> Map de-dup ─> PENDING ─> (Set diff vs getSessionIdsByParticipantUserId) ─> sortByCreatedAtDesc
getAllSessions() [ADMIN only] ──────────────────────────┘
```

`getSessionIdsByParticipantUserId` は呼び出し元自身の `USER#{userId}` を GSI2 で引くため、他人の参加状況が混ざる余地はない。`addParticipant` は `ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)` で冪等、重複時は reviewer count の UpdateCommand に進まず false を返す。

### 既存 join/assign/一覧を壊さない scope ゲート

`SessionAssignmentControls` は `isJoinableScope ? isJoinableCandidate : !isClaimed` でボタン表示を分岐する。`isJoinableCandidate`（`status==='PENDING' && assignedTeamId あり && assignedUserId !== currentUserId`）は毎回計算されるが未指定スコープでは評価結果が使われないため、`/` と `/assigned` の挙動は不変。ラベルも `isJoinableScope` のときだけ「参加」、既定は「引き受ける」のまま。`App.tsx` は `scope==='joinable'` のときだけ `onClaim={handleSelfAssign}` を渡し、それ以外は従来の `handleClaim` を渡す。回帰ガードのテスト（default scope でボタン条件が変わらない）も追加されている。

### 監査ログとエラー方針の一貫性

`post-session-self-assign.ts` は `post-session-join.ts` の雛形に対し (a) 呼ぶ Service、(b) `metadata:{ reason:'self-assign' }` の付与、の 2 点のみが差分。監査ログはハンドラ層で成功時のみ記録し、`selfAssignSession` が 404/403 を throw した場合は `recordAuditLog` に到達しない。内側 catch は AppError（`statusCode` を持つ Error）を透過し、それ以外のみ `internalError` で 500 に包む。`get-joinable-sessions.ts` も同じ透過ガードを持ち、今日は raw DynamoDB エラーしか来ないが将来の AppError が 500 に潰れるのを防ぐ。

### 構造規約の確認結果

重点観点として規約逸脱を探したが見当たらなかった。確認した点: Handler→Service→Repository の層構造（ハンドラは Repository を直接呼ばず Service 経由）、相対 import の `.js` 拡張子、named export のみ、1 ハンドラ 1 ファイル、components のフラット構造維持（新コンポーネントなし）、AppError ファクトリと `successResponse`/`errorResponse` のみ使用、ハンドラ JSDoc、Repository 追加なし（既存関数の再利用）。CDK は `createLambda('GetJoinableSessions'|'PostSessionSelfAssign')`（クラス名の kebab-case 化がハンドラファイル名と一致）＋ `grantCommonPermissions`、静的 `GET /sessions/joinable` を greedy `/sessions/{sessionId}` の前に登録しており、静的ルート誤マッチの懸念がない。

### テスト

property test は `describe('Feature: self-assign, Property N: ...')` 形式・docstring に `Validates:` 付き・`{ numRuns: 100 }`。Property 1（FR-2）は stateful な participant Set と reviewer count を使い 2 回呼び出しで二重計上しないことを、Property 2（FR-1, NFR-1）は結果が「DB 所属チーム割り当て・PENDING・未参加」の部分集合であることと ADMIN パス非使用を実証。service 単体テストは `selfAssignSession` の 404/403×2/ADMIN 成功/REVIEWER 成功/冪等、`listJoinableSessions` の PENDING 外除外/参加済み除外/所属 0 件→空/ADMIN 全件を網羅。ハンドラテストは監査メタデータ・400/403/404/500 を網羅。フロントは vitest-axe の `toHaveNoViolations()`、他人保有 PENDING での「参加」ボタン表示、アップローダー/非 PENDING での非表示、default scope 回帰ガードをカバー。

検証記録（`self-assign-verification.md`）に backend `vitest --run`（1139 passed / 85 skipped、失敗 0）、frontend（1039 passed、axe 違反なし）、infra `cdk diff --all`（新 Lambda 2 + ルート 2 のみ `[+]`、既存は環境ドリフトの `[~]`/`[-]`）と infra `vitest`（147 passed、スナップショットのリソース型ヒストグラムで +2 ずつのみ）が記録されている。これらは再実行せず記録を根拠に判断した。

</details>

<details>
<summary>File map</summary>

- `backend/src/services/session-service.ts` — `selfAssignSession`（join 同等・DB 判定）と `listJoinableSessions`（候補抽出）を追加。
- `backend/src/handlers/get-joinable-sessions.ts` — 新規 `GET /sessions/joinable`。
- `backend/src/handlers/post-session-self-assign.ts` — 新規 `POST /sessions/{sessionId}/self-assign`、`reason:'self-assign'` 監査ログ。
- `backend/src/services/session-service.test.ts` / `.property.test.ts` — 単体 + プロパティテスト追加。
- `backend/src/handlers/post-session-self-assign.test.ts` / `get-joinable-sessions.test.ts` — ハンドラテスト。
- `infra/lib/stacks/api-stack.ts` — Lambda 2 本 + ルート 2 本。
- `infra/test/api-stack.test.ts` (+ `__snapshots__/`) — ルート/Lambda アサーション、スナップショット更新。
- `frontend/src/services/session-api.ts` — `listJoinableSessions` / `selfAssignSession` と `JoinableSessionsResponse` 型。
- `frontend/src/components/SessionAssignmentControls.tsx` — `scope` prop 追加、joinable 時のみ表示条件差し替え。
- `frontend/src/App.tsx` / `frontend/src/components/Navigation.tsx` — `/joinable` 導線とナビ項目。
- `frontend/src/services/session-api.test.ts` / `components/SessionAssignmentControls.test.tsx` — フロントテスト。

このディレクトリは git リポジトリではないため diff は取得できず、実装ファイルを直接読んでレビューした。
</details>
