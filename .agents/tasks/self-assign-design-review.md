# Design Review — Reviewer セルフ割り当て機能（C案）

対象設計: `.agents/tasks/self-assign-design.md`
照合した調査: `.agents/tasks/self-assign-investigation.md`
レビュー観点: 曖昧さ / gap / 未検証の仮定（＋依頼の重点5項目）
レビュー方式: 設計文書を単体で読み、記載された「既存コードはこう動く」という主張を実コードで裏取りした。

---

## 結論

設計本文が参照する既存コード（`joinSession` / `addParticipant` / `getSessionIdsByParticipantUserId` / `getSessionsByTeamId` / `getAllSessions` / `getUserTeamIds` / `isTeamMember` / `isAdmin` / `extractUser` / `recordAuditLog` / `AppError.statusCode` / Handler テンプレ / `api-stack.ts` のルート登録パターン）を実ファイルで確認した結果、**設計の主張はすべて実コードと一致**していた。依頼の重点5項目（権限昇格防止・join 候補経路・404/403 一貫性・規約遵守・テスト計画）はいずれも健全。

HIGH / MEDIUM の指摘は **0 件**。残る指摘は NIT のみ。**判定: APPROVED。**

---

## 指摘一覧

### NIT 1 — property-based test が「steering の必須対象」であるという記述は不正確（根拠の誤り。計画自体は妥当）

場所: 設計 3. NFR-5、7. Testing Strategy、10 の finding 対応表。

設計は「steering 上 join 系は property-based test 対象（join 系に準じ…）」と書くが、steering（tech.md）の property-based test 必須リストは *Correction, Consensus, Score, Search, IP filtering, Upload, Download, Deletion, Language Model, Transcription Job* であり、**join / self-assign は含まれていない**。したがって「steering が必須としている」という根拠付けは誤り。ただし冪等性・スコープ健全性の property test を追加すること自体は有益で、設計の実装内容は妥当。

CONCRETE FIX: 文言を「steering の必須リストには self-assign は含まれないが、本機能の中核不変条件（冪等性・スコープ健全性）を保証するため property-based test を自主的に追加する」に直す。テスト内容（冪等性 FR-2 / スコープ健全性 FR-1・NFR-1、`{ numRuns: 100 }`）は現状のままでよい。

### NIT 2 — `SessionAssignmentControls` の「参加」ボタン表示条件の最終的な結合式が未確定

場所: 設計 5.8。

設計は「default（scope 未指定）は `onClaim && !isClaimed` を維持」「`scope==='joinable'` のときは `isJoinableCandidate` で表示」と文章で指示し、`isJoinableCandidate` のスニペットも示すが、既存 JSX の `{onClaim && !isClaimed && ( <button>… )}`（実コード `SessionAssignmentControls.tsx` で確認）を **どの単一式に置き換えるか** が明示されていない。実装者が `!isClaimed` と `isJoinableCandidate` の合成を解釈する余地が残る。

CONCRETE FIX: 表示条件を次の 1 式に確定して明記する。

```tsx
const isClaimed = Boolean(session.assignedUserId);
const claimedByMe = session.assignedUserId === currentUserId; // 既存
const isJoinableCandidate =
  session.status === 'PENDING' && Boolean(session.assignedTeamId) && !claimedByMe;
const showJoinButton = scope === 'joinable' ? isJoinableCandidate : !isClaimed;
// render:
{onClaim && showJoinButton && ( <button … /> )}
```

ラベルは `scope === 'joinable' ? '参加' : '引き受ける'`。これで `/`・`/assigned` は従来どおり（scope 未指定＝`!isClaimed`）、`joinable` のみ新条件になる。

### NIT 3 — `GET /sessions/joinable` レスポンス型（`SessionRecord`）とフロント `ReviewSession` 必須フィールドの不一致（既存踏襲のため実害なしだが未言及）

場所: 設計 5.3 / 5.6（`JoinableSessionsResponse = { data: { items: ReviewSession[] } }`）。

バックエンドの `SessionRecord`（`session-repository.ts` で確認）は `transcriptionJobId` と `partialAggregationEnabled` を **持たない**。一方フロントの `ReviewSession`（`types/session.ts` で確認）は両方を **required** として宣言している。設計はレスポンスを `ReviewSession[]` として受けるが、これは **既存 `GET /sessions` / `GET /sessions/assigned` と全く同じ既存の型ギャップ**であり（`get-sessions.ts` も `SessionRecord` を返して `SessionListResponse.items: ReviewSession[]` が受けている）、本機能が新たに持ち込む欠陥ではない。実行時 JSON なので動作もしている。設計がこの点に触れていないだけ。

CONCRETE FIX: 設計 5.6 に 1 文追記する。「`SessionRecord` には `transcriptionJobId` / `partialAggregationEnabled` が無く、フロント `ReviewSession` は両者を required とするが、これは既存 `GET /sessions` と同一の既存ギャップであり本機能では現状踏襲（Out of Scope）」。実装変更は不要。

### NIT 4 — AC-5 の「PENDING」表現と `selfAssignSession` のステータス非制約との間に文言ギャップ

場所: 設計 6. Acceptance Criteria の 5／ 5.2「ステータス前提」。

AC-5 は「自チーム割り当て **PENDING** セッションに self-assign すると 200」と書くが、`selfAssignSession` 自体はステータスを問わない設計（5.2 で「join は IN_PROGRESS にも参加でき、意図的にステータス制約を課さない」と明記＝既存 `joinSession` と一致、実コードでも `joinSession` はステータス未検査を確認）。AC-5 を字面どおり「PENDING のみ 200」と読むと、IN_PROGRESS への self-assign が 200 を返す実装と矛盾して見える。

CONCRETE FIX: AC-5 を「自チーム割り当てセッション（候補一覧には PENDING のみ出るが、API 自体はステータスを問わず join 可能＝既存 join と同じ）に self-assign すると 200 + participant 登録」に補足する。候補一覧（AC-1）が PENDING 限定である事実は保つ。

---

## Verified Assumptions（実コードで裏取り済み）

1. **権限昇格が起きない**: `selfAssignSession` の判定は既存 `joinSession`（`session-service.ts`）と同一で、`isAdmin(user)` 以外は `isTeamMember(user.userId, session.assignedTeamId)` を使う。`isTeamMember` / `getUserTeamIds` は `access-control-service.ts` で DynamoDB（`TEAM#` / `MEMBER#` / GSI1）を引く実関数。`session.assignedTeamId` は `createSession`（`session-repository.ts`）がサーバ側で `mediaFile.teamId`／`input.teamId` から設定しており、呼び出し元が注入する経路はない。JWT クレームを所属の証明に使っていない。→ NFR-1 / 重点(1) を満たす。
2. **join 候補経路**: 自動生成 PENDING セッションは `createSession` が `assignedTeamId` 設定時に GSI1（`GSI1PK=TEAM#{teamId}`, `GSI1SK=SESSION#…`）を張る。`getSessionsByTeamId(teamId)` はまさにこの GSI1 を Query する既存関数。未参加フィルタに使う `getSessionIdsByParticipantUserId(userId)` は GSI2（`USER#{userId}` / `PARTICIPANT#`）を 1 クエリで引く既存関数。→ 重点(2) の経路（`getSessionsByTeamId` ＋未参加フィルタ）は実在し正しい。
3. **404/403 の一貫性**: `joinSession` は存在しない→`notFoundError`(404)、`assignedTeamId` 未設定／非メンバー→`forbiddenError`(403)。設計 5.2 の擬似コードはこれと同順序・同種別。`AppError.statusCode`（`error-handler.ts`）が存在し、ハンドラの `'statusCode' in error` ガード（実在する `post-session-join.ts` と同一）が機能する。→ 重点(3) 一致。
4. **規約遵守**: Handler→Service→Repository 層構造は維持（ハンドラは service のみ呼ぶ）。新ハンドラは `export async function handler`（named export）・1 ファイル 1 ハンドラ・相対 import `.js`。テーブル名 env は実コードどおり `DYNAMODB_TABLE_NAME`（`api-stack.ts` の `commonEnv`、`dynamodb-client.ts` のフォールバックで確認。steering の `TABLE_NAME` 記述が実コードと不一致である点も設計が正しく指摘）。frontend components はフラット維持（新コンポーネントを作らず既存 `SessionListPage` / `SessionAssignmentControls` を再利用）。→ 重点(4) 一致。
5. **infra 配線**: `createLambda('PascalName', …)` → kebab-case ファイル名、`grantCommonPermissions`（DynamoDB RW + KMS）、`addRoute`、静的ルートを greedy `{sessionId}` の前に登録する慣習（`api-stack.ts:1203-1214` に `GET /sessions/assigned` を `GET /sessions/{sessionId}` の前に置くコメント付きで実在）はすべて設計の記述どおり。
6. **冪等性**: `addParticipant`（`session-repository.ts`）は `ConditionExpression` 付き PutCommand で `ConditionalCheckFailedException` を握って `false` を返し、新規時のみ `assignedReviewerCount` を +1。再実行で二重計上しない。→ FR-2 / AC-6 を満たす。
7. **監査ログ**: `recordAuditLog`（`audit-service.ts`）は `metadata?: Record<string, unknown>` を受け、`operationType: 'REVIEW_ASSIGNMENT_CHANGE'` は `AuditOperationType`（`audit-repository.ts`）に実在。ハンドラ層で成功時のみ記録し例外時は到達しない（既存 `post-session-join.ts` と同位置）。→ FR-4 / NFR-4 / AC-10 を満たす。
8. **フロント導線**: `SessionListPageWrapper` は `scope?: 'all' | 'assigned'` と `loadSessions` の scope 分岐、`handleClaim`、`renderSessionActions` を持ち（`App.tsx` で確認）、設計の `'joinable'` 追加・`handleSelfAssign`・`/joinable` ルートは既存 `/assigned` と同一パターンで無理なく載る。`SessionAssignmentControls` は `currentUserId` prop と `isClaimed`/`claimedByMe` を既に持つ。`Navigation.tsx` の `NAV_ITEMS` に `/assigned`=「自分のタスク」が実在（設計 finding 7 の整合も正しい）。
9. **テスト計画のモック対象**: `session-service.ts` は `isAdmin` を `auth-middleware.js` から import（access-control 経由ではない）。設計 finding 1 の「`isAdmin` はモックしない／ADMIN 分岐は `user.role='ADMIN'` を渡す」は実 import 構造と一致。未参加フィルタのモックを `getSessionIdsByParticipantUserId` に統一する方針も実関数と整合。

---

## Unverified / Wrong Assumptions

1. **（Wrong, 軽微）** 「steering 上 join 系は property-based test 必須対象」: steering の property-based 必須リストに join / self-assign は **含まれない**（→ NIT 1）。テスト追加の判断自体は妥当だが根拠付けが誤り。
2. **（未検証・本機能では不使用）** 調査が指摘する `SessionRecord` 型の `transcriptionJobId` 欠落。設計は MediaFile／ジョブ逆引きを使わないため該当なしとして Out of Scope 化しており、本レビューでも逆引き経路は検証対象外とした（設計判断は妥当）。
3. **（未検証）** `infra/test/` の CDK スナップショットテストの有無と、Lambda 2 本 + ルート 2 本追加による差分の具体内容。設計は「ある場合は更新が必要になり得る」と条件付きで記述しており、実行時に確認すべき運用事項（設計上の欠陥ではない）。
4. **（未検証）** フロント `ReviewSession` と バックエンド `SessionRecord` の必須フィールド差（`transcriptionJobId` / `partialAggregationEnabled`）が実行時に問題を起こさないこと。既存 `GET /sessions` が同じ型で稼働している事実から実害なしと判断したが、ランタイムの厳密な一致は静的には未確認（→ NIT 3）。
