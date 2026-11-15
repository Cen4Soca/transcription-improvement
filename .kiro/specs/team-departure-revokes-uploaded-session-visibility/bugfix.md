# Bugfix Requirements Document

## Introduction

`reviewer-uploaded-session-not-visible` の修正により、`createSessionForJob`（`backend/src/services/session-service.ts`）はアップロード由来セッションに対し、アップローダー本人（`assignedUserId` = `mediaFile.uploadedBy`）へロール非依存で `createReviewAssignment` を呼ぶようになった。これにより `PK=USER#{uploaderId}, SK=ASSIGNMENT#{sessionId}` の ReviewAssignment が張られ、`getAccessibleSessionIds`（`backend/src/services/access-control-service.ts`）の直接割り当て経路を通じて、アップロード由来セッションがそのユーザーのセッション一覧に表示される。

一方で `removeMemberFromTeam`（`backend/src/services/team-service.ts`）はメンバー削除後に `revokeReviewAssignmentsIfOrphaned(userId)` を呼ぶ（Req 13.8）。その実装は `getUserTeamIds(userId)` が空（全チーム離脱）のとき、`getReviewAssignmentsByUser(userId)` が返す ReviewAssignment を **全件** `deleteReviewAssignment` する。`getReviewAssignmentsByUser`（`backend/src/repositories/team-repository.ts`）は `PK=USER#{userId}, SK begins_with ASSIGNMENT#` を `entityType='ReviewAssignment'` でフィルタして返すだけで、「本人がまだどのチームにもアサインしていないアップロード由来セッション」か「既にチームへ移管された（TeamAssignment を持つ）セッション」かを区別する判定を行わない。

さらに `admin-teams` の API はアトミックな「チーム移動」エンドポイントを持たず、個別の「メンバー追加」「メンバー削除」のみを提供する。そのため「旧チームから削除 → 新チームに追加」の順でユーザーを移動させると、削除の瞬間に全チーム離脱状態が生じ、revoke が発火しうる。

結果として、本人が所有しかつまだどのチームにもアサインしていないアップロード由来セッションの可視性を表す ReviewAssignment が巻き添えで削除され、`reviewer-uploaded-session-not-visible` で復活させたはずの可視性が、チーム操作を契機に再び失われる。チーム所属の可視性反映（`getUserTeamIds` の毎回 DB 参照による即時反映）自体は健全であり、問題は revoke が「まだチームに移管されていない本人所有セッション」の ReviewAssignment を区別せず削除する点に限定される。

### 所有権移転モデル（採用モデル）

本バグの修正は **所有権移転モデル（案A'）** に基づく。ReviewAssignment の可視性を「本人所有」と「チーム管理下」の 2 状態で捉える。

- **本人所有（まだチーム未アサイン）**: アップローダー本人が `createSessionForJob` で得た ReviewAssignment（`createdBy === userId`）で、かつそのセッションにまだ TeamAssignment が 1 件も存在しない状態。これはチームの存在に依存しない本人所有の可視性であり、全チーム離脱でも保持すべき。revoke 対象から除外する。
- **チーム管理下**: 以下のいずれか。全チーム離脱時に revoke すべき対象。
  - `createdBy !== userId`（TeamLeader/Admin がチーム経由で付与した割り当て）。
  - `createdBy === userId` だが、そのセッションに TeamAssignment が 1 件以上存在する（`createAssignment` 等でチームへ移管済み）。チームにアサインされた時点で所有権がチームに移ったとみなし、離脱で可視性を失うのが正しい。

すなわち revoke 対象から除外する（＝保持する）条件は「`createdBy === userId` かつ そのセッションに TeamAssignment が 1 件も存在しない」のみである。

### 関連コード

- `backend/src/services/team-service.ts` — `removeMemberFromTeam`、`revokeReviewAssignmentsIfOrphaned`、`revokeOrphanedReviewAssignments`、`deleteExistingTeam`、`createAssignment`（`createTeamAssignment` を呼ぶ）
- `backend/src/repositories/team-repository.ts` — `getReviewAssignmentsByUser`、`createReviewAssignment`、`deleteReviewAssignment`、`createTeamAssignment`（TeamAssignment: `PK=TEAM#{teamId}, SK=ASSIGNMENT#{sessionId}, GSI1PK=SESSION#{sessionId}, GSI1SK=TEAM#{teamId}, entityType='TeamAssignment'`）、`ReviewAssignmentRecord` レイアウト（`createdBy` を保持）
- `backend/src/services/session-service.ts` — `createSessionForJob`（`createdBy: assignedUserId` でアップローダー本人の ReviewAssignment を作成）
- `backend/src/services/access-control-service.ts` — `getAccessibleSessionIds`（ADMIN は `null` 全件、それ以外は team 割り当て + 直接 ReviewAssignment の和集合）、`getUserTeamIds`、`isSessionAssignedToUserTeams`（GSI1 `SESSION#{sessionId}` + `begins_with(GSI1SK, 'TEAM#')` の同形クエリ。ただしユーザーのチームに絞った判定）

## Bug Analysis

### Current Behavior (Defect)

本人が所有しかつまだどのチームにもアサインしていないアップロード由来セッションを持つユーザーが全チーム離脱状態になると、revoke 処理が当該 ReviewAssignment も区別なく削除し、本人が自分でアップロードした（かつチーム未アサインの）セッションが一覧から見えなくなる。これが主たる欠陥である。

1.1 WHEN ユーザーがアップロード由来セッションを所有（`createdBy === userId` の ReviewAssignment で可視性が担保され、かつそのセッションに TeamAssignment が 1 件も存在しない）しており、かつ `removeMemberFromTeam` によってそのユーザーが最後のチームから削除されて `getUserTeamIds(userId)` が空になる THEN `revokeReviewAssignmentsIfOrphaned` は `getReviewAssignmentsByUser(userId)` が返す ReviewAssignment を全件削除し、まだチームに移管されていない本人所有の ReviewAssignment も削除する

1.2 WHEN 上記 1.1 により当該ユーザーの本人所有（チーム未アサイン）ReviewAssignment が削除された後に `getAccessibleSessionIds(user)` が評価される THEN そのアップロード由来 sessionId が返り値に含まれなくなり、ユーザーのセッション一覧から自分がアップロードしたセッションが消える

1.3 WHEN 管理者が「旧チームから削除 → 新チームに追加」の順でユーザーのチームを移動させ、削除の直後（新チーム追加の前）に `revokeReviewAssignmentsIfOrphaned` が全チーム離脱状態を観測する THEN 新チームへの所属が残っているにもかかわらず本人所有（チーム未アサイン）の ReviewAssignment が削除され、チーム移動完了後もアップロード由来セッションの可視性が失われたままになる

### Expected Behavior (Correct)

「アップロード由来（`createdBy === userId`） かつ そのセッションに TeamAssignment が存在しない」ReviewAssignment のみを revoke 対象から除外し、全チーム離脱後も可視性を維持する。所有権移転モデルに基づき、チームにアサイン済みのセッション（TeamAssignment が存在する）は、たとえ `createdBy === userId` でも所有権がチームへ移ったとみなし、離脱で可視性を失うのが正しい挙動である。Req 13.8 本来の意図（チーム管理下のアクセスの revoke）はこれにより維持される。

> TeamAssignment 存在判定の具体手段（既存 `isSessionAssignedToUserTeams` の流用可否、または repository への新規関数 `hasAnyTeamAssignment(sessionId)` 追加）は design フェーズで確定する。本要件は「本人所有かつチーム未アサイン」を区別し、それのみを revoke 対象外とすることを規定する。

2.1 WHEN ユーザーがアップロード由来セッション（`createdBy === userId` かつ TeamAssignment 不在）を所有しており、かつ `removeMemberFromTeam` によってそのユーザーが最後のチームから削除されて `getUserTeamIds(userId)` が空になる THEN `revokeReviewAssignmentsIfOrphaned` SHALL 当該「本人所有かつチーム未アサイン」の ReviewAssignment を削除せず保持する

2.2 WHEN 上記 2.1 の処理後に `getAccessibleSessionIds(user)` が評価される THEN アップロード由来 sessionId SHALL 引き続き返り値に含まれ、ユーザーのセッション一覧に自分がアップロードしたセッションが表示される

2.3 WHEN 管理者が「旧チームから削除 → 新チームに追加」の順でユーザーのチームを移動させ、削除の直後に全チーム離脱状態が一時的に生じる THEN チーム移動完了後も当該ユーザーの「本人所有かつチーム未アサイン」のアップロード由来セッションの可視性 SHALL 維持される

### Unchanged Behavior (Regression Prevention)

3.1 WHEN ユーザーが全チーム離脱状態になり、かつそのユーザーが TeamLeader/Admin によってチーム経由で割り当てられた（`createdBy !== userId`）ReviewAssignment を持つ THEN `revokeReviewAssignmentsIfOrphaned` SHALL CONTINUE TO そのチーム経由 ReviewAssignment を従来どおり削除する（Req 13.8 のアクセス取り消しを維持）

3.2 WHEN ユーザーが少なくとも 1 つのチームに所属している（`getUserTeamIds(userId)` が非空） THEN `revokeReviewAssignmentsIfOrphaned` SHALL CONTINUE TO 何も削除せず早期 return する

3.3 WHEN 任意のユーザーについて `getUserTeamIds` ベースの team スコープ可視性が評価される THEN システム SHALL CONTINUE TO チーム所属の変更を毎回 DB 参照により即時反映する

3.4 WHEN ユーザーが ADMIN である THEN `getAccessibleSessionIds` SHALL CONTINUE TO `null`（フィルタ不要＝全件アクセス可）を返す

3.5 WHEN `deleteExistingTeam` によるチーム削除カスケードが実行される THEN システム SHALL CONTINUE TO TeamAssignment と TeamMembership を削除したうえで、各メンバーについて全チーム離脱時のチーム管理下 ReviewAssignment の revoke（`revokeOrphanedReviewAssignments`）を実行する既存意図を維持する

3.6 WHEN ユーザーが全チーム離脱状態になり、かつ `createdBy === userId` だがそのセッションに TeamAssignment が 1 件以上存在する（チームへ移管済み）ReviewAssignment を持つ THEN `revokeReviewAssignmentsIfOrphaned` SHALL そのセッションの ReviewAssignment を削除する（所有権がチームに移っているため離脱で可視性を失うのが正しい挙動であり、これは欠陥ではない）

## Bug Condition and Properties

以下は要件から導出したバグ条件と Fix/Preservation プロパティの定式化である。実装・判定手段の確定は design フェーズで行う。

### 入力モデル

```pascal
TYPE ReviewAssignment = RECORD
  userId    : string   // PK=USER#{userId}
  sessionId : string   // SK=ASSIGNMENT#{sessionId}
  createdBy : string   // 作成者（アップロード由来は assignedUserId 本人）
END RECORD

// セッションに TeamAssignment が 1 件でも存在するか（チームを問わず）。
// 判定手段（GSI1 SESSION#{sessionId} + begins_with(GSI1SK, 'TEAM#')）は design で確定する。
FUNCTION sessionHasTeamAssignment(sessionId : string) : boolean

// 「本人所有かつチーム未アサイン」= revoke 対象外の述語。
FUNCTION isOwnerRetained(A : ReviewAssignment) : boolean
  RETURN (A.createdBy == A.userId)
         AND NOT sessionHasTeamAssignment(A.sessionId)
END FUNCTION

TYPE RevokeInput = RECORD
  userId      : string
  teamIds     : list of string          // getUserTeamIds(userId) の結果
  assignments : list of ReviewAssignment // getReviewAssignmentsByUser(userId) の結果
END RECORD
```

### バグ条件

```pascal
// 全チーム離脱状態で、かつ「本人所有かつチーム未アサイン」の ReviewAssignment を含む入力。
// 注意: createdBy === userId でも TeamAssignment が存在するケースはバグ条件に含めない（消えてよい）。
FUNCTION isBugCondition_orphanRevoke(X : RevokeInput) : boolean
  INPUT:  X
  OUTPUT: boolean

  RETURN (LENGTH(X.teamIds) = 0)
         AND EXISTS A IN X.assignments WHERE isOwnerRetained(A)
END FUNCTION
```

### Fix Checking（バグ条件を満たす入力に対する期待挙動）

F は現行（未修正）の `revokeReviewAssignmentsIfOrphaned`、F' は修正後。`deleted(F'(X))` は F' が削除した ReviewAssignment 集合、`remaining(F'(X))` は削除後に残る集合とする。

```pascal
// Property: Fix Checking — 本人所有かつチーム未アサイン分は revoke しない
FOR ALL X WHERE isBugCondition_orphanRevoke(X) DO
  F'(X)
  // 本人所有かつチーム未アサインの ReviewAssignment は保持される
  ASSERT FOR ALL A IN X.assignments WHERE isOwnerRetained(A):
           A IN remaining(F'(X))
  // それ以外（チーム経由 / 本人所有だがチーム移管済み）は従来どおり削除される
  ASSERT FOR ALL A IN X.assignments WHERE NOT isOwnerRetained(A):
           A IN deleted(F'(X))
END FOR
```

```pascal
// Property: Fix Checking — 可視性の維持（1.2 / 2.2）
FOR ALL X WHERE isBugCondition_orphanRevoke(X) DO
  F'(X)
  ASSERT FOR ALL A IN X.assignments WHERE isOwnerRetained(A):
           A.sessionId IN getAccessibleSessionIds(userOf(X))
END FOR
```

### Preservation Checking（バグ条件を満たさない入力に対する不変性）

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_orphanRevoke(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

これにより、(a) ユーザーがまだいずれかのチームに所属する場合（`teamIds` 非空、3.2）と、(b) 全チーム離脱でも「本人所有かつチーム未アサイン」の ReviewAssignment を持たない場合（従来どおり全削除。すなわちチーム経由分 3.1、および本人所有だがチーム移管済み分 3.6 の削除）は、修正後も現行と同一に振る舞う。
