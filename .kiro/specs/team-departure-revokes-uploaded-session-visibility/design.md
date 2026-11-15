# team-departure-revokes-uploaded-session-visibility Bugfix Design

## Overview

チーム全離脱時の revoke（Req 13.8）が、本人がアップロードしかつまだどのチームにもアサインしていないセッションの `ReviewAssignment` を巻き添えで削除し、アップローダー本人の可視性を失わせるバグを修正する。

バグの中心は `backend/src/services/team-service.ts` の `revokeReviewAssignmentsIfOrphaned(userId)` にある。この関数は `getUserTeamIds(userId)` が空（＝全チーム離脱）のとき、`getReviewAssignmentsByUser(userId)` が返す `ReviewAssignment` を **区別せず全件削除** する。`ReviewAssignment` の可視性は本来 2 状態で捉えるべきである。

- **本人所有（まだチーム未アサイン）**: `createSessionForJob`（`backend/src/services/session-service.ts`）が `createReviewAssignment({ userId: assignedUserId, sessionId, createdBy: assignedUserId })` を呼び、`createdBy === userId`。かつ、そのセッションにまだ `TeamAssignment` が 1 件も存在しない状態。チームの存在に依存しない本人所有の可視性であり、全チーム離脱でも保持すべき。
- **チーム管理下**: 以下のいずれか。全チーム離脱時に revoke すべき対象。
  - `createdBy !== userId`（`createUserReviewAssignment` が TeamLeader/Admin 名義で付与したチーム経由割り当て）。
  - `createdBy === userId` だが、そのセッションに `TeamAssignment` が 1 件以上存在する。`createAssignment`（→ `createTeamAssignment`）でチームへ移管された時点で所有権がチームに移ったとみなす。

本設計は **所有権移転モデル（案A'）** を採用する。revoke 対象から除外する（＝保持する）条件は「`createdBy === userId` かつ そのセッションに `TeamAssignment` が 1 件も存在しない」のみとし、それ以外は従来どおり削除する。チームにアサインされたセッションは、`createdBy === userId` であっても離脱で可視性を失うのが正しい挙動である。

`TeamAssignment` の存在は GSI1（`GSI1PK=SESSION#{sessionId}`, `GSI1SK` が `begins_with 'TEAM#'`）で判定できる。変更はサービス層（`team-service.ts` の `revokeReviewAssignmentsIfOrphaned`）と、その判定を支える Repository 関数の追加に閉じる。Handler は変更しない（レイヤリング厳守: Service が Repository を呼ぶ）。

## Glossary

- **Bug_Condition (C)**: バグが発火する条件。ユーザーが全チーム離脱状態（`getUserTeamIds(userId)` が空）で、かつ「本人所有かつチーム未アサイン」の `ReviewAssignment` を少なくとも 1 件持つとき。
- **Property (P)**: バグ条件下での期待挙動。「本人所有かつチーム未アサイン」の `ReviewAssignment` は保持され、それ以外（チーム経由 / 本人所有だがチーム移管済み）の `ReviewAssignment` のみが削除される。結果としてアップロード由来（チーム未アサイン）セッションの可視性が維持される。
- **Preservation**: バグ条件を満たさない入力（チーム所属が残る、または「本人所有かつチーム未アサイン」の `ReviewAssignment` を持たない）に対して、修正後も現行と完全に同一に振る舞うこと。
- **ReviewAssignment**: `PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}, GSI1PK=SESSION#{sessionId}, GSI1SK=USER#{userId}` のアイテム。`{ userId, sessionId, createdBy, createdAt }` を保持。ユーザーへの直接セッション割り当てを表す。
- **TeamAssignment**: `PK=TEAM#{teamId}, SK=ASSIGNMENT#{sessionId}, GSI1PK=SESSION#{sessionId}, GSI1SK=TEAM#{teamId}, entityType='TeamAssignment'` のアイテム。セッションがチームにアサイン（移管）されたことを表す。
- **本人所有かつチーム未アサイン (owner-retained)**: `createdBy === userId` かつ そのセッションに `TeamAssignment` が 1 件も存在しない `ReviewAssignment`。アップロード由来セッションの可視性の担保であり、全チーム離脱でも保持する唯一の除外対象。
- **チーム管理下 (team-managed)**: `createdBy !== userId`、または `createdBy === userId` だが `TeamAssignment` が存在する `ReviewAssignment`。Req 13.8 の revoke 対象。
- **isOwnerRetained(A)**: `ReviewAssignment` A が「本人所有かつチーム未アサイン」か否かを判定する述語。本設計では `A.createdBy === A.userId AND NOT sessionHasTeamAssignment(A.sessionId)` と定義する。
- **sessionHasTeamAssignment(sessionId)**: セッションに（チームを問わず）`TeamAssignment` が 1 件でも存在するかを判定する述語。GSI1 `SESSION#{sessionId}` + `begins_with(GSI1SK, 'TEAM#')` で判定する。
- **revokeReviewAssignmentsIfOrphaned(userId)**: `team-service.ts` の関数。全チーム離脱時に `ReviewAssignment` を削除する。本バグの修正対象。
- **getUserTeamIds(userId)**: `access-control-service.ts` の関数。ユーザーが所属する全チーム ID を毎回 DB 参照で返す。チーム所属の即時反映を担う。

## Bug Details

### Bug Condition

ユーザーが全チーム離脱状態（`getUserTeamIds(userId)` が空）になり、`revokeReviewAssignmentsIfOrphaned(userId)` が走るとき、現行実装は `getReviewAssignmentsByUser(userId)` の返す `ReviewAssignment` を区別せず全件 `deleteReviewAssignment` する。そのため、「本人所有かつチーム未アサイン」の `ReviewAssignment`（`createdBy === userId` かつ `TeamAssignment` 不在）までもが削除され、アップロード由来セッションの可視性が失われる。全チーム離脱は `removeMemberFromTeam`（最後のチームからの削除）や「旧チーム削除 → 新チーム追加」の過渡状態で発生する。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RevokeInput
         RevokeInput = { userId, teamIds, assignments }
         where teamIds     = getUserTeamIds(userId)
               assignments = getReviewAssignmentsByUser(userId)
  OUTPUT: boolean

  RETURN LENGTH(input.teamIds) = 0
         AND EXISTS A IN input.assignments WHERE isOwnerRetained(A)

  // isOwnerRetained(A) := (A.createdBy == A.userId)
  //                       AND NOT sessionHasTeamAssignment(A.sessionId)
  // 注意: createdBy == userId でも TeamAssignment が存在するケースは
  //       バグ条件に含めない（所有権移転済み = 消えてよい）。
END FUNCTION
```

### Examples

- **アップローダーが最後のチームから外れる（チーム未アサイン）**: User U がアップロード由来セッション S を所有（`ReviewAssignment{ userId: U, sessionId: S, createdBy: U }`）し、S に `TeamAssignment` は存在しない。U は team-A のみ所属。`removeMemberFromTeam(team-A, U)` 実行後、`getUserTeamIds(U)` が空になり revoke が発火。期待: S の `ReviewAssignment` は保持される。実際（現行）: S の `ReviewAssignment` が削除され、`getAccessibleSessionIds(U)` に S が含まれなくなる。
- **チーム移動の過渡状態**: Admin が「team-A から U を削除 → team-B に U を追加」の順で移動。削除直後、`getUserTeamIds(U)` が一時的に空になり revoke が発火。期待: 「本人所有かつチーム未アサイン」のアップロード由来セッションの可視性は移動完了後も維持。実際（現行）: 当該 `ReviewAssignment` が削除され、team-B 追加後もアップロード由来セッションは見えないまま（team-B は当該セッションの `TeamAssignment` を持たないため）。
- **チーム経由割り当てとの混在**: U が全チーム離脱時に、本人所有かつチーム未アサインの `ReviewAssignment{ createdBy: U }`（S に TeamAssignment 無し）と、以前 TeamLeader L が付与した `ReviewAssignment{ createdBy: L }`（L ≠ U）を併せ持つ。期待: `createdBy: L` のものだけ削除、`createdBy: U`（チーム未アサイン）のものは保持。実際（現行）: 両方削除。
- **所有権移転済み（正しく消える）**: U がアップロードしたセッション S を `createAssignment` でチーム team-C にアサイン済み（S に `TeamAssignment{ team-C }` が存在）。`ReviewAssignment{ userId: U, sessionId: S, createdBy: U }` と `TeamAssignment` が併存する。U が全チーム離脱すると、S は所有権がチームに移っているため `ReviewAssignment` は revoke される。これは欠陥ではなく、所有権移転モデルで期待される正しい挙動（可視性を失う）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- チーム経由で付与された `ReviewAssignment`（`createdBy !== userId`）は、全チーム離脱時に従来どおり削除される（Req 13.8 のアクセス取り消しを維持 / bugfix 3.1）。
- `createdBy === userId` だが `TeamAssignment` が存在する（チームへ移管済み）`ReviewAssignment` は、全チーム離脱時に従来どおり削除される（所有権移転の帰結 / bugfix 3.6）。
- ユーザーが少なくとも 1 つのチームに所属している（`getUserTeamIds(userId)` が非空）とき、`revokeReviewAssignmentsIfOrphaned` は何も削除せず早期 return する（bugfix 3.2）。
- `getUserTeamIds` ベースの team スコープ可視性は、チーム所属変更を毎回 DB 参照で即時反映する（bugfix 3.3）。
- ユーザーが ADMIN のとき、`getAccessibleSessionIds` は `null`（全件アクセス可）を返す（bugfix 3.4）。
- `deleteExistingTeam` のチーム削除カスケードは、TeamAssignment と TeamMembership を削除したうえで各メンバーの全チーム離脱時 revoke（`revokeOrphanedReviewAssignments`）を実行する既存意図を維持する（bugfix 3.5）。本修正により、カスケード経由の revoke でも「本人所有かつチーム未アサイン」分は保持されるが、チーム管理下分の revoke は維持される。

**Scope:**
バグ条件を満たさない入力はすべて本修正の影響を受けない。具体的には以下。
- `getUserTeamIds(userId)` が非空（チーム所属が残る）ケース → 現行どおり早期 return。
- 全チーム離脱でも「本人所有かつチーム未アサイン」の `ReviewAssignment` を 1 件も持たないケース（全件がチーム経由、または `createdBy === userId` でも全件が TeamAssignment を持つ）→ 現行どおり全削除。
- `removeMemberFromTeam` / `createUserReviewAssignment` / `createAssignment` / `addMemberToTeam` などの入力検証・アクセス制御・Handler の挙動。
- `getAccessibleSessionIds` / `getUserTeamIds` の実装（本修正では変更しない）。

> 期待される「正しい挙動」の本体は Correctness Properties 節（Property 1）で定義する。本節は「変化してはならないもの」に焦点を当てる。

## Hypothesized Root Cause

バグ記述と実コード確認に基づく根本原因は以下。

1. **所有状態の不区別（主因）**: `revokeReviewAssignmentsIfOrphaned` は `getReviewAssignmentsByUser(userId)` が返す全 `ReviewAssignment` をループし、無条件に `deleteReviewAssignment` する。`createdBy` も `TeamAssignment` の有無も参照しないため、「本人所有かつチーム未アサイン」と「チーム管理下」を区別できない。

   ```
   // 現行（team-service.ts）
   const reviewAssignments = await getReviewAssignmentsByUser(userId);
   for (const assignment of reviewAssignments) {
     await deleteReviewAssignment(userId, assignment.sessionId); // 所有状態を問わず削除
   }
   ```

2. **アップロード由来 RA が team スコープ外の可視性担保である点の見落とし**: まだチームに移管されていないアップロード由来 `ReviewAssignment` は、チーム所属に依存しない本人所有の可視性を表す。Req 13.8 の「チーム所属喪失＝アクセス取り消し」は、本来チーム管理下のアクセスのみを対象とするが、実装はこの区別を欠く。

3. **チーム移動のアトミック性欠如（誘発条件、本修正の対象外だが発火契機）**: `admin-teams` API がアトミックな「チーム移動」を持たず「削除 → 追加」になるため、過渡的な全チーム離脱状態が revoke を発火させる。本修正は revoke 側で「本人所有かつチーム未アサイン」を保護することで、この誘発条件下でも可視性を守る。

採用する除外述語は `isOwnerRetained(A) := (A.createdBy === A.userId) AND NOT sessionHasTeamAssignment(A.sessionId)`。この判定が妥当である根拠と代替案は次節で評価する。

## 採用案の比較（設計判断）

| 案 | 除外（保持）条件 | 変更範囲 | マイグレーション | 所有モデルの明確さ | エッジ耐性 |
|----|------------------|----------|------------------|--------------------|------------|
| **A**（不採用） | `createdBy === userId`（アップロード由来は常に保持） | revoke 内のフィルタ追加のみ | 不要 | 中（アサイン後も本人保持で所有が曖昧） | TeamLeader 自己割り当てを一律保持 |
| **A'（採用）** | `createdBy === userId` **かつ** `TeamAssignment` 不在 | revoke 内のフィルタ + Repository に存在判定関数を追加 | 不要（`createdBy` / GSI1 は既存） | 高（アサイン＝所有権移転が明確） | TeamAssignment の有無で自然に分岐 |
| B | 明示的な由来属性（`origin: 'UPLOAD' \| 'TEAM_ASSIGNMENT'`）を追加 | `createReviewAssignment` シグネチャ変更 + 2 呼び出し元 + revoke フィルタ + 既存データ backfill | 必要 | 高 | 属性で厳密判別、ただし移管状態は追従しない |

### 案A（不採用）: `createdBy === userId` で常に除外

**内容**: `revokeReviewAssignmentsIfOrphaned` で `assignment.createdBy === userId` を満たす `ReviewAssignment` を一律 revoke 対象から除外する。

**長所**: 最小変更。`createdBy` のみで判定でき Repository 変更不要。

**短所 / リスク**:
- アップロード由来セッションをチームにアサインした後（`TeamAssignment` が付いた後）も本人の `ReviewAssignment` を保持してしまう。所有権がチームに移った後も本人が可視性を持ち続けるため、所有モデルが曖昧になる。Req 13.8 の「チーム管理下のアクセスは離脱で失う」という意図と、アサイン済みセッションについて食い違う。
- TeamLeader が自分自身へ割り当てた RA（`createdBy === userId`）を、チームアサインの有無に関わらず一律保持してしまう。

### 案A'（採用）: `createdBy === userId` かつ TeamAssignment 不在のみ除外

**内容**: `revokeReviewAssignmentsIfOrphaned` で、`ReviewAssignment` ごとに「`createdBy === userId` かつ そのセッションに `TeamAssignment` が存在しない」なら skip（保持）、それ以外は delete する。`TeamAssignment` 存在判定は Repository の関数（GSI1 `SESSION#{sessionId}` + `begins_with(GSI1SK, 'TEAM#')`）で行う。

**長所**:
- 所有権移転モデルを正確に表現する。チームにアサインされた時点で所有権がチームに移り、離脱で可視性を失う（正しい挙動）。チーム未アサインの本人所有セッションのみ保持する。
- `createdBy` は既存属性、`TeamAssignment` の GSI1 レイアウトも既存。マイグレーション・backfill 不要で既存データにそのまま機能する。
- `reviewer-uploaded-session-not-visible` の付与規約（`createdBy === assignedUserId`）と整合しつつ、アサイン後の所有権移転を `TeamAssignment` の有無で自然に表現できる。
- 変更がサービス層 1 関数 + Repository の読み取り関数 1 本に閉じ、レイヤリング（Service → Repository）に合致。Handler 不変。

**短所 / リスク**:
- revoke 時に `ReviewAssignment` ごとに `TeamAssignment` 存在判定クエリ（GSI1 Query）が増える。revoke は低頻度操作であり、件数も通常小さいため実害は限定的。

### 案B: 明示的な由来属性の追加

**内容**: `ReviewAssignmentRecord` に `origin: 'UPLOAD' | 'TEAM_ASSIGNMENT'` を追加し、revoke は `'TEAM_ASSIGNMENT'` のみ対象とする。

**長所**: 由来が明示的。

**短所 / リスク**:
- `createReviewAssignment` のシグネチャ変更と 2 呼び出し元の修正、既存データの backfill が必要。
- 「由来」は付与時点の固定値であり、その後セッションがチームにアサインされて所有権が移っても追従しない。所有権移転モデル（アサイン＝移転）を表現するには結局 `TeamAssignment` の有無を見る必要があり、案A' の判定を内包することになる。

### 採用決定

**案A'（所有権移転モデル）を採用する。** 根拠:
1. Req 13.8 の「チーム管理下のアクセスは離脱で失う」という意図と厳密に整合する。チームにアサインされたセッションは所有権がチームに移ったとみなし、離脱で可視性を失う。チーム未アサインの本人所有セッションのみ保持する。所有モデルが明確。
2. 既存の `createdBy` 属性と `TeamAssignment` の GSI1 レイアウトで判定でき、マイグレーション・backfill・シグネチャ変更が不要。既存データにそのまま正しく機能する。
3. 変更がサービス層 1 関数 + Repository の読み取り関数追加に閉じ、レイヤリングと最小修正原則に合致。
案A は最小変更だがアサイン後も本人保持で所有が曖昧。案B は由来固定で移管に追従しない。いずれも所有権移転モデルの意図を満たさない。

### エッジケース分析: 「Admin/TeamLeader が自分自身に ReviewAssignment を割り当てる」

`createUserReviewAssignment(user, teamId, targetUserId, sessionId)` は `createReviewAssignment({ userId: targetUserId, createdBy: user.userId })` を呼ぶ。`targetUserId === user.userId` の場合 `createdBy === userId` となる。案A ではこれを一律「保持」と判定していたが、所有権移転モデル（案A'）では **`TeamAssignment` の有無で自然に分岐** するため、より正確に扱える。

- `createUserReviewAssignment` はチームのメンバーシップ（`isTeamMember(targetUserId, teamId)`）を要求し、TeamLeader は自チームのメンバーであるため自己割り当てが到達可能。
- この自己割り当てが「チームにアサイン済みのセッション」（`TeamAssignment` が存在する）に対して行われた場合、案A' では `isOwnerRetained` が偽になり、全チーム離脱で revoke される。チーム管理下として正しく扱える。
- 逆に、`TeamAssignment` を持たないセッションに対する自己割り当て（＝実質的にアップロード由来の本人所有と同じ可視性状態）は保持される。

したがって案A で「エッジとして受容」していた自己割り当ての扱いは、案A' では「`TeamAssignment` の有無」という所有状態に基づいて一貫して決まる。特別扱い・受容の明記は不要になり、より正確な判定となる。

### チーム削除カスケードへの適用

`deleteExistingTeam → revokeOrphanedReviewAssignments → revokeReviewAssignmentsIfOrphaned` の経路でも、修正後の `revokeReviewAssignmentsIfOrphaned` が共通に使われる。したがって除外ロジックはカスケード経由の revoke にも自動的に効く。

**要件意図に沿った判断**: チーム削除によりメンバーが全チーム離脱した場合も、そのメンバーの「本人所有かつチーム未アサイン」のアップロード由来セッションの可視性は保持すべきである。チーム削除が取り消すべきは「チーム管理下で得ていたアクセス」であり、本人がアップロードしまだどのチームにもアサインしていない自分のセッションへの可視性は別物（チームの存在に依存しない本人所有）だからである。bugfix 3.5 は「チーム管理下 ReviewAssignment の revoke を実行する既存意図を維持」と規定しており、本人所有（チーム未アサイン）分の保持はこの意図と矛盾しない。

なお `deleteExistingTeam` は先に `deleteAllTeamAssignments(teamId)` を実行してから `revokeOrphanedReviewAssignments(members)` を呼ぶ。したがってカスケード時点では削除対象チームの `TeamAssignment` は既に消えている。あるセッションが他チームにもアサインされていなければ `sessionHasTeamAssignment` は偽となり、本人所有分として保持される（当該チームのみに属していたセッションは、チーム消滅後は本人所有に戻る）。他チームにも `TeamAssignment` が残るセッションは引き続きチーム管理下として扱われ、`createdBy !== userId` のチーム経由分は従来どおり revoke される。

## Correctness Properties

Property 1: Bug Condition - 本人所有（チーム未アサイン）ReviewAssignment の保持と可視性維持

_For any_ バグ条件を満たす入力（`isBugCondition` が true、すなわち `getUserTeamIds(userId)` が空、かつ「本人所有かつチーム未アサイン」（`createdBy === userId` かつ `TeamAssignment` 不在）の `ReviewAssignment` を少なくとも 1 件含む）に対して、修正後の `revokeReviewAssignmentsIfOrphaned` SHALL 「本人所有かつチーム未アサイン」の `ReviewAssignment` をすべて保持し（削除しない）、同時にそれ以外（`createdBy !== userId`、または `createdBy === userId` だが `TeamAssignment` が存在する）の `ReviewAssignment` をすべて削除する。結果として、保持された各 sessionId は引き続き `getAccessibleSessionIds(user)` の返り値に含まれる。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - 非バグ入力での挙動不変

_For any_ バグ条件を満たさない入力（`isBugCondition` が false、すなわち (a) `getUserTeamIds(userId)` が非空、または (b) 「本人所有かつチーム未アサイン」の `ReviewAssignment` を 1 件も含まない）に対して、修正後の `revokeReviewAssignmentsIfOrphaned` SHALL 現行（未修正）の関数と同一の結果を生む。すなわち (a) では何も削除せず早期 return し、(b) では `getReviewAssignmentsByUser` が返す全 `ReviewAssignment`（すべてチーム経由、または本人所有だがチーム移管済み）を削除する。team スコープ可視性の即時反映、ADMIN の全件アクセス、チーム削除カスケードの既存意図は不変。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

Property 3: Ownership Transfer - チーム移管済みセッションは離脱で revoke される

_For any_ 全チーム離脱状態（`getUserTeamIds(userId)` が空）の入力で、`createdBy === userId` だがそのセッションに `TeamAssignment` が 1 件以上存在する `ReviewAssignment` に対して、修正後の `revokeReviewAssignmentsIfOrphaned` SHALL その `ReviewAssignment` を削除する。すなわちチームにアサインされた時点で所有権がチームへ移り、離脱で可視性を失うのが正しい挙動であることを保証する。

**Validates: Requirements 3.6**

## Fix Implementation

### Changes Required

採用案（案A': 所有権移転モデル）の実装。

**File 1**: `backend/src/repositories/team-repository.ts`

**追加関数**: `hasAnyTeamAssignment(sessionId: string): Promise<boolean>`

- セッションに（チームを問わず）`TeamAssignment` が 1 件でも存在するかを判定する。
- GSI1 を使用: `GSI1PK = SESSION#{sessionId} AND begins_with(GSI1SK, 'TEAM#')`。`Limit: 1` で存在のみ確認する。
- 注意: 同じ `GSI1PK=SESSION#{sessionId}` には `ReviewAssignment`（`GSI1SK=USER#{userId}`）も乗るため、`TeamAssignment` だけを数えるには `GSI1SK` を `begins_with 'TEAM#'` で必ず絞る。
- `isSessionAssignedToUserTeams`（`access-control-service.ts`）は同形のクエリだがユーザーのチームに絞った判定であり、本モデルの「チームを問わず 1 件でもあるか」とは意味が異なるため流用しない。Repository に新規関数を追加する（レイヤリング: Service が Repository を呼ぶ。`team-repository` が適切）。

   ```
   // 追加（team-repository.ts、擬似コード）
   export async function hasAnyTeamAssignment(sessionId: string): Promise<boolean> {
     const result = await docClient.send(new QueryCommand({
       TableName: TABLE_NAME,
       IndexName: 'GSI1',
       KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
       ExpressionAttributeValues: {
         ':pk': `SESSION#${sessionId}`,
         ':prefix': 'TEAM#',
       },
       Limit: 1,
     }));
     return (result.Items?.length ?? 0) > 0;
   }
   ```

**File 2**: `backend/src/services/team-service.ts`

**Function**: `revokeReviewAssignmentsIfOrphaned(userId)`

**Specific Changes**:
1. **早期 return の不変**: `teamIds.length > 0` のとき何もせず return する（3.2）。
2. **除外述語の導入**: 削除ループで `ReviewAssignment` ごとに判定する。`assignment.createdBy === userId` かつ `hasAnyTeamAssignment(assignment.sessionId) === false` のとき skip（保持）。それ以外（`createdBy !== userId`、または `TeamAssignment` が存在する）は `deleteReviewAssignment(userId, assignment.sessionId)` で削除する。

   ```
   // 修正後（擬似コード）
   const teamIds = await getUserTeamIds(userId);
   if (teamIds.length > 0) {
     return; // 3.2 早期 return は不変
   }
   const reviewAssignments = await getReviewAssignmentsByUser(userId);
   for (const assignment of reviewAssignments) {
     // Owner-retained: uploaded by the user AND not yet assigned to any team.
     // Ownership transfers to the team once a TeamAssignment exists, so such
     // assignments are revoked on departure (Req 13.6/13.8). Keep only the
     // uploader-owned, not-yet-team-assigned ones.
     const ownerRetained =
       assignment.createdBy === userId &&
       !(await hasAnyTeamAssignment(assignment.sessionId));
     if (ownerRetained) {
       continue;
     }
     await deleteReviewAssignment(userId, assignment.sessionId);
   }
   ```

3. **意図のコメント化**: 所有権移転モデルの意図（アサイン＝所有権がチームへ移転、離脱で失う。チーム未アサインの本人所有のみ保持）を英語コメントで明記する。
4. **他関数の不変**: `removeMemberFromTeam`、`deleteExistingTeam`、`revokeOrphanedReviewAssignments` のシグネチャ・呼び出し順は変更しない。カスケードは共通の `revokeReviewAssignmentsIfOrphaned` を介して自動的に新ロジックを得る。
5. **Handler 不変**: `admin-teams` 系 Handler は変更しない（レイヤリング厳守）。

## Testing Strategy

### Validation Approach

二段階アプローチ: まず未修正コードでバグを再現するカウンターイグザンプルを表面化させ、次に修正が「本人所有かつチーム未アサイン」分を保持しつつ、チーム経由分と「本人所有だがチーム移管済み」分の revoke と既存挙動を維持することを検証する。テストは `backend/src/services/team-service.property.test.ts`（プロパティ）と `backend/src/services/team-service.test.ts`（ユニット）に co-locate する。AWS SDK / repository は `vi.mock()` でモックする（既存テストの流儀に合わせる）。`hasAnyTeamAssignment` もモックして `TeamAssignment` の有無を制御する。

### Exploratory Bug Condition Checking

**Goal**: 修正前に、バグが発火するカウンターイグザンプルを表面化させ、根本原因（revoke が所有状態を区別しない）を確認する。反証されれば再仮説化する。

**Test Plan**: `revokeReviewAssignmentsIfOrphaned` を全チーム離脱状態（`getUserTeamIds` が空）でトリガーし、「本人所有かつチーム未アサイン」の `ReviewAssignment`（`createdBy === userId` かつ `hasAnyTeamAssignment` が偽）が削除されることを観測する。`removeMemberFromTeam` 経由と `deleteExistingTeam` カスケード経由の両方で確認。未修正コードで実行して失敗（削除されてしまうこと）を観測する。

**Test Cases**:
1. **本人所有・チーム未アサインの巻き添え削除（removeMember 経由）**: U が `ReviewAssignment{ userId: U, sessionId: S, createdBy: U }` のみ保持し、S に `TeamAssignment` 無し、team-A のみ所属。`removeMemberFromTeam(team-A, U)` 後、`deleteReviewAssignment(U, S)` が呼ばれることを観測（未修正で発生 = バグ）。
2. **本人所有・チーム未アサインの巻き添え削除（team 削除カスケード経由）**: `deleteExistingTeam` で U が全チーム離脱し、チーム未アサインのアップロード由来 RA が削除されることを観測（未修正で発生）。
3. **混在ケース**: U が `createdBy: U`（チーム未アサイン）と `createdBy: L`（チーム経由, L≠U）を併せ持つ。未修正では両方削除されることを観測。

**Expected Counterexamples**:
- 全チーム離脱時に「`createdBy === userId` かつ `TeamAssignment` 不在」の `ReviewAssignment` に対して `deleteReviewAssignment` が呼ばれる。
- 想定原因: revoke ループが所有状態（`createdBy` / `TeamAssignment` の有無）によるフィルタを持たず全件削除する。

### Fix Checking

**Goal**: バグ条件を満たす全入力に対し、修正後の関数が期待挙動（本人所有かつチーム未アサイン分は保持、それ以外は削除、可視性維持）を満たすことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  revokeReviewAssignmentsIfOrphaned_fixed(X.userId)
  // 本人所有かつチーム未アサインは保持
  ASSERT FOR ALL A IN X.assignments WHERE isOwnerRetained(A):
           deleteReviewAssignment was NOT called with (X.userId, A.sessionId)
  // それ以外は削除
  ASSERT FOR ALL A IN X.assignments WHERE NOT isOwnerRetained(A):
           deleteReviewAssignment was called with (X.userId, A.sessionId)
  // 可視性維持
  ASSERT FOR ALL A IN X.assignments WHERE isOwnerRetained(A):
           A.sessionId IN getAccessibleSessionIds(userOf(X))
END FOR
```

### Preservation Checking

**Goal**: バグ条件を満たさない全入力に対し、修正後の関数が現行（未修正）と同一の結果を生むことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT revokeReviewAssignmentsIfOrphaned_original(X.userId)
       = revokeReviewAssignmentsIfOrphaned_fixed(X.userId)
  // すなわち:
  // (a) LENGTH(X.teamIds) > 0                       → どちらも何も削除しない（早期 return）
  // (b) teamIds 空 かつ owner-retained を含まない    → どちらも全 ReviewAssignment を削除
  //     （全件チーム経由、または createdBy===userId でも全件が TeamAssignment を持つ）
END FOR
```

**Testing Approach**: Preservation checking はプロパティベーステスト（fast-check）を推奨する。理由:
- 入力ドメイン（`teamIds` の空/非空、`createdBy` が `userId` と一致/不一致、`TeamAssignment` の有無の組み合わせ）を自動で広くカバーできる。
- 手動ユニットテストが見落とすエッジ（空集合、全件チーム経由、全件が移管済みなど）を捕捉できる。
- 非バグ入力での挙動不変を強く保証できる。

**Test Plan**: 未修正コードで (a) チーム所属が残るケースの「何も削除しない」挙動と (b) owner-retained を含まない全チーム離脱ケースの「全件削除」挙動を観測し、それを基準に fast-check プロパティを書く。所有権移転の中核として、「`createdBy === userId` だが `TeamAssignment` あり」のセッションが離脱で revoke されることを明示的に検証するプロパティ（Property 3）を加える。

**Test Cases**:
1. **非空 teamIds の早期 return**: `getUserTeamIds` が非空のとき、修正前後ともに `deleteReviewAssignment` が一切呼ばれないことを検証（3.2）。
2. **チーム経由のみの全削除維持**: 全チーム離脱 + 全 `ReviewAssignment` が `createdBy !== userId` のとき、修正前後ともに全件削除されることを検証（3.1）。
3. **所有権移転（移管済みは削除）**: 全チーム離脱 + `createdBy === userId` だが `TeamAssignment` が存在するセッションの `ReviewAssignment` が削除されることを検証（3.6, Property 3）。
4. **ADMIN の全件アクセス不変**: `getAccessibleSessionIds(adminUser)` が `null` を返し続けることを検証（3.4）。
5. **カスケード意図の維持**: `deleteExistingTeam` が TeamAssignment / TeamMembership を削除し、各メンバーについて revoke を呼ぶ既存フロー（チーム管理下分は削除）を維持することを検証（3.5）。

### Unit Tests

`revokeReviewAssignmentsIfOrphaned` の 4 象限を網羅する（`hasAnyTeamAssignment` をモックして `TeamAssignment` の有無を制御）:

- **アップロード由来 × TeamAssignment 無 → 保持**: `createdBy === userId` かつ `hasAnyTeamAssignment` が偽の RA が削除されないことを検証（`removeMemberFromTeam` 経由）。
- **アップロード由来 × TeamAssignment 有 → 削除**: `createdBy === userId` だが `hasAnyTeamAssignment` が真の RA が削除されることを検証（3.6）。
- **チーム経由（`createdBy !== userId`）→ 削除**: `TeamAssignment` の有無に関わらず削除されることを検証（3.1）。
- **全チーム所属あり（teamIds 非空）→ 何もしない**: 早期 return で `deleteReviewAssignment` が一切呼ばれないことを検証（3.2）。
- **混在集合での選択的削除**: アップロード由来（未アサイン）保持 / チーム経由削除 / 移管済み削除（design Examples）。
- **`deleteExistingTeam` カスケード経由**: メンバーの「本人所有かつチーム未アサイン」分が保持され、チーム管理下分が削除されることを検証（3.5）。

### Property-Based Tests (fast-check)

- **Fix プロパティ（Property 1）**: ランダムな `ReviewAssignment` 集合（`createdBy` が `userId` と一致/不一致、`TeamAssignment` の有無を混在）と空 `teamIds` を生成し、修正後は「owner-retained（`createdBy === userId` かつ `TeamAssignment` 不在）は `deleteReviewAssignment` されない」かつ「それ以外はすべて `deleteReviewAssignment` される」ことを検証。`{ numRuns: 100 }`。
- **Preservation プロパティ（Property 2）**: 「`teamIds` 非空」または「owner-retained を含まない」入力を生成し、修正前後で削除された `(userId, sessionId)` 集合が一致することを検証。`{ numRuns: 100 }`。
- **Ownership Transfer プロパティ（Property 3）**: 全チーム離脱 + `createdBy === userId` だが `TeamAssignment` が存在するセッションを生成し、修正後に必ず `deleteReviewAssignment` されることを検証。`{ numRuns: 100 }`。
- **可視性維持**: 保持された owner-retained `sessionId` が、直接割り当て経路（`getAccessibleSessionIds` のユーザー直接 `ReviewAssignment` クエリ）に残ることを検証。

### Integration Tests

- `backend/src/__tests__/integration/`（LocalStack）で、実 DynamoDB に対し: アップロード由来 `ReviewAssignment`（TeamAssignment 無し）を張った後、全チーム離脱 revoke を実行してもアイテムが残ること、`getAccessibleSessionIds` に当該 `sessionId` が含まれることを検証。
- 「旧チーム削除 → 新チーム追加」の過渡で全チーム離脱 revoke が走っても、チーム未アサインのアップロード由来セッションの可視性が移動完了後に維持されることを検証。
- チームへアサイン済み（`TeamAssignment` 存在）のセッションは、全チーム離脱 revoke で `ReviewAssignment` が削除され可視性を失うことを検証（所有権移転）。
- `deleteExistingTeam` カスケードで、チーム未アサインの本人所有は残り、チーム管理下は削除される end-to-end を検証。
