# reviewer-uploaded-session-not-visible Bugfix Design

## Overview

アップローダー（REVIEWER / TEAM_LEADER / ADMIN のいずれか）が自分でメディアをアップロードし、トランスクリプションジョブ完了後に自動生成された ReviewSession が、セッション一覧（`GET /sessions`）に表示されず、かつ校閲画面でメディア取得（`GET /sessions/{sessionId}/media-url`）が `MEDIA_FILE_NOT_FOUND`（404）になる。症状は主に REVIEWER で報告されたが、欠陥はアップローダーのロールに依存しない（詳細は Hypothesized Root Cause のロール横断分析を参照）。

本バグは **2 つの独立した欠陥** が重なっている。

1. **可視性の不整合**: `createSession()`（`session-repository.ts`）はアップローダーを `SessionParticipant` としてのみ登録し、`assignedTeamId` がある場合のみ GSI1 を張る。一方セッション一覧が依存する `getAccessibleSessionIds()`（`access-control-service.ts`）は `TeamAssignment` / `ReviewAssignment` の **Assignment アイテム** しか走査しない。アップロード由来セッションにはどちらの Assignment も作られないため、一覧から欠落する（`GET /sessions/assigned` は GSI2 の `SessionParticipant` 走査なので表示され、不整合が生じる）。
2. **メディアリンクの欠落**: `startJob()`（`transcription-job-service.ts`）内で `createSessionForJob` 成功後に `mediaFileRepository.updateSessionId()` で MediaFile へ `sessionId` を張るが、この処理全体が **空の `catch {}`** の内側にあり、例外を握りつぶす。失敗すると `mediaFile.sessionId` 未設定のまま job が進み、`media-file-repository.getBySessionId()` が `null` を返して `MEDIA_FILE_NOT_FOUND`（404）となる。Admin の後付け割り当てでも復旧しない。

**ロール横断性（追加調査で確定）**: `createSession` が書き込む内容はアップローダーのロールではなく引数の有無だけで決まり、`createSessionForJob` は全ロールで同じ経路（`assignedUserId = mediaFile.uploadedBy`, `teamId = mediaFile.teamId`）を通る。したがって — 欠陥 1（可視性）は **REVIEWER / TEAM_LEADER 共通**（TeamLeader が `teamId` 設定済みでアップロードしても、GSI1 に張られる `SESSION#` プレフィックスのアイテムと、`getAccessibleSessionIds` の team 経路が走査する `TeamAssignment`（`ASSIGNMENT#` プレフィックス）アイテムが不一致のため一覧に出ない）、欠陥 2（メディアリンク）は **全ロール共通**（空 catch が原因でロール非依存）。ADMIN は `getAccessibleSessionIds` が `isAdmin` で `null`（全件）を返すため **一覧には非影響** だが、メディアリンク欠陥は **影響あり**。

**修正アプローチ（結論）**:

- 欠陥 1 は、`createSessionForJob` が `assignedUserId`（アップローダー）に対して **`ReviewAssignment` を追加で作成** する（採用案 A）。`createReviewAssignment()`（シグネチャ `{ userId, sessionId, createdBy }`、`PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}` の固定キー PUT で冪等）は `team-repository.ts` に既存で、`getAccessibleSessionIds()` の直接割り当て経路が走査する `PK=USER#{userId}, SK begins_with ASSIGNMENT#` アイテムをそのまま生成するため、一覧経路に最小の変更で到達可能になる。この割り当ては **アップローダーのロールに依存せず** 本人（REVIEWER / TEAM_LEADER）を一覧に到達させる。ADMIN アップロードでは `getAccessibleSessionIds` が `null`（全件）を返す挙動は変わらない。
- 欠陥 2 は、**空 catch を廃し、`updateSessionId` 失敗を検知・記録** する。加えて、`getMediaFileForSession()` が `getBySessionId` で解決できない場合に、`sessionId` でセッション→ジョブ→MediaFile を辿り直す **フォールバック解決** を `media-service` に追加して、既存の壊れたデータ（`sessionId` 未リンクの MediaFile）も救済する。

いずれも Handler → Service → Repository のレイヤリングを厳守し、bugfix.md の Unchanged Behavior 3.1–3.7 を破らない。

## Glossary

- **Bug_Condition (C)**: バグが発動する条件。2 つに分かれる（可視性 `C_vis`、メディアリンク `C_link`）。
- **Property (P)**: バグ入力に対する期待挙動。アップロード由来セッションが一覧に出る／メディアが解決できる。
- **Preservation**: 既存の Assignment ベース可視性、ADMIN 全件、scanStatus チェック、アクセス制御、`process-job-complete` のセッション再利用など、本修正で変えてはならない挙動。
- **getAccessibleSessionIds**: `access-control-service.ts` の関数。非 ADMIN に対し `TeamAssignment`（`PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`）と `ReviewAssignment`（`PK=USER#{userId}, SK begins_with ASSIGNMENT#`）を走査してアクセス可能な sessionId 集合を返す。ADMIN には `null`（＝全件）を返す。
- **SessionParticipant**: `PK=SESSION#{sessionId}, SK=PARTICIPANT#{userId}`、`GSI2PK=USER#{userId}` のアイテム。`GET /sessions/assigned` が GSI2 で走査する。アップローダーは `createSession` でこれに登録される。
- **ReviewAssignment**: `PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}` のアイテム。`createReviewAssignment()`（`team-repository.ts`）で作成され、`getAccessibleSessionIds` の直接割り当て経路が参照する。
- **createSessionForJob**: `session-service.ts` の関数。ジョブ開始時に ReviewSession を PENDING で作成し、アップローダーを participant 登録する。
- **startJob**: `transcription-job-service.ts` の関数。Transcribe ジョブ開始、`createSessionForJob` 呼び出し、`updateSessionId` による MediaFile リンクを行う。
- **getMediaFileForSession / getBySessionId**: `media-service.ts` → `media-file-repository.ts`。`sessionId` 属性スキャンで MediaFile を解決する。

## Bug Details

### Bug Condition

本バグは 2 つの独立した条件からなる。入力 `X = { session, user }`（`session` はアップロード由来、`user` は操作中の認証ユーザー）。

#### 欠陥 1: 可視性（C_vis）

アップロード由来セッションに対し、一覧経路が参照する Assignment が 1 件も存在しないのに、アップローダー本人は正当なアクセス権を持つ。

**Formal Specification:**
```
FUNCTION isBugCondition_visibility(X)
  INPUT: X = { session, user }   // session はアップロード由来、user はアップローダー本人
  OUTPUT: boolean

  RETURN session.generatedFromUpload = true
     AND NOT existsTeamAssignment(session.sessionId)
     AND NOT existsReviewAssignment(user.userId, session.sessionId)
     AND userIsUploaderOrEntitled(user, session)
     // 結果: getAccessibleSessionIds(user) が session.sessionId を含まない
     //       が、getSessionsByParticipantUserId(user) は含む
END FUNCTION
```

#### 欠陥 2: メディアリンク（C_link）

Session は存在するが、どの MediaFile も `sessionId` でそれを指していない（`startJob` の空 catch によりリンク付与が失われた）。

**Formal Specification:**
```
FUNCTION isBugCondition_mediaLink(X)
  INPUT: X = { session }
  OUTPUT: boolean

  RETURN session.generatedFromUpload = true
     AND getMediaFileBySessionId(session.sessionId) = null
     // 結果: getMediaUrl(session.sessionId) が MEDIA_FILE_NOT_FOUND(404)
END FUNCTION
```

### Examples

- **可視性（Reviewer, 完全に非表示）**: Reviewer が media をアップロード（`mediaFile.teamId` 未設定）→ ジョブ完了 → `GET /sessions` に当該セッションが出ない（期待: 出る）。同時に `GET /sessions/assigned` には出る（不整合）。
- **可視性（TeamLeader, teamId ありでも非表示）**: TeamLeader が media をアップロード（`mediaFile.teamId` 設定済み）→ ジョブ完了 → `createSession` は GSI1 に `GSI1PK=TEAM#{teamId}, GSI1SK=SESSION#{now}#{sessionId}`（`SESSION#` プレフィックス）を張るが、`getAccessibleSessionIds` の team 経路は `PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`（`TeamAssignment`）を走査するため不一致で、`GET /sessions` に当該セッションが出ない（期待: 出る）。`GET /sessions/assigned` には出る（Reviewer と同じ不整合）。
- **可視性（Admin, 一覧には出る）**: Admin が media をアップロード → `getAccessibleSessionIds` は `isAdmin` で `null`（全件）を返すため `GET /sessions` に出る（可視性欠陥は一覧に顕在化しない）。
- **メディアリンク（全ロール共通）**: 上記いずれのロールのアップロード由来セッションでも、校閲画面を開く → `GET /sessions/{sessionId}/media-url` が `MEDIA_FILE_NOT_FOUND`（404、期待: 署名付き URL）。`startJob` の空 catch による `sessionId` リンク欠落はロール非依存であり、Reviewer / TeamLeader / Admin のいずれでも同じ 404 が起こりうる（特に Admin は「一覧には出るがメディア取得 404 はあり得る」）。
- **Admin 後付け割り当て**: Admin が team/reviewer を割り当てても、MediaFile の `sessionId` リンクは復旧されず、メディア取得エラーが継続する（期待: 割り当て後に取得成功）。
- **エッジ（正常系・変えない）**: Admin がアップロードし `mediaFile.teamId` 設定済み → GSI1 と（本修正で）ReviewAssignment が張られ、一覧に出る。scanStatus が PENDING のセッションは本修正後も 403（`MEDIA_SCAN_PENDING`）のまま。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 既存の `TeamAssignment` / `ReviewAssignment` が正しく存在するセッションの `GET /sessions` 可視性（team スコープ／直接割り当て）を現状どおり維持する（bugfix 3.1）。
- ADMIN の `GET /sessions` 全件返却（`getAccessibleSessionIds` が `null` を返す ADMIN パス）を維持する（bugfix 3.2）。
- `mediaFile.teamId` / `assignedTeamId` が設定されたメディア由来セッションの可視性を維持する（bugfix 3.3）。
- `scanStatus` が `CLEAN` のセッションの署名付き URL + `expiresAt` 返却を維持する（bugfix 3.4）。
- `scanStatus` が `PENDING` / `INFECTED` の 403（`MEDIA_SCAN_PENDING` / `MEDIA_MALWARE_DETECTED`）を維持する。本修正はスキャン状態チェックを変えない（bugfix 3.5）。
- `checkSessionAccess` / `denyResourceAccess` による他チーム・未割り当てセッションへのアクセス拒否（404 で存在隠蔽）を維持する。本修正でアクセス制御を緩めない（bugfix 3.6）。
- `process-job-complete` が `job.sessionId` を持つ job を処理する際、既存セッションを再利用し重複した空セッションを作らない挙動を維持する（bugfix 3.7）。

**Scope:**
`isBugCondition_visibility` にも `isBugCondition_mediaLink` にも該当しない入力は、本修正の影響を受けない。具体的には:
- Assignment が既に整合しているセッションの一覧表示。
- MediaFile が正しく `sessionId` にリンク済みのセッションのメディア取得。
- 他チーム／未割り当てセッションへのアクセス（引き続き拒否）。

> 実際の期待される正しい挙動（アップロード由来セッションが一覧に出る、メディアが解決できる）は後述の Correctness Properties（Property 1 / 3）で定義する。本節は「変えてはならないもの」に焦点を当てる。

## Hypothesized Root Cause

### 欠陥 1: 可視性

1. **一覧経路と自分のタスク経路のデータモデル不一致**: `getAccessibleSessionIds` は Assignment アイテム（`SK begins_with ASSIGNMENT#`）のみを走査する。`createSession` はアップローダーを `SessionParticipant`（`SK=PARTICIPANT#{userId}`）としてのみ登録し、Assignment を作らない。2 経路が別エンティティを見ているため不整合が確定的に発生する。

2. **`assignedTeamId` 依存の GSI1 と `getAccessibleSessionIds` のアイテム不一致（TeamLeader でも発生）**: `createSession` は `assignedTeamId = input.assignedTeamId ?? input.teamId` が存在する場合のみ GSI1 を張る。このとき張られるのは `GSI1PK=TEAM#{teamId}, GSI1SK=SESSION#{now}#{sessionId}`（**`SESSION#` プレフィックス**）のアイテムである。一方 `getAccessibleSessionIds` の team 経路は `PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`（**`TeamAssignment` アイテム、ベーステーブル**）を走査する。両者は別アイテム・別インデックスであるため、Reviewer アップロードで `mediaFile.teamId` 未設定で GSI1 が張られない場合はもちろん、**TeamLeader アップロードで `mediaFile.teamId` が設定され GSI1 が張られても**、`getAccessibleSessionIds` は `SESSION#` アイテムを拾わず一覧に出ない。つまり可視性欠陥は REVIEWER だけでなく TEAM_LEADER でも同様に発生する（「一覧に出ない／マイタスクには出る」不整合）。GSI1 だけでは一覧に出ない（一覧の依存は `ASSIGNMENT#` の Assignment アイテム）。

3. **Admin 後付け割り当ての経路差**: `post-session-assignment` が `TeamAssignment` を追加すると team スコープの可視性は回復しうるが、アップローダー個人が確実に一覧へ到達するには `ReviewAssignment`（直接割り当て）が最も素直。

### 欠陥 2: メディアリンク

4. **空 catch による握りつぶし（全ロール共通）**: `startJob()` の `try { createSessionForJob → updateSessionId } catch {}` が、セッション作成・リンク付与の失敗を無言で飲み込む。job は `sessionId` 未設定のまま続行し、MediaFile は未リンクのまま残る。この経路はアップローダーのロールに完全に非依存であり、Reviewer / TeamLeader / Admin のいずれがアップロードしても同じリンク欠落・`MEDIA_FILE_NOT_FOUND`（404）が起こりうる。Admin は可視性欠陥こそ一覧に顕在化しない（`isAdmin → null` 全件）が、このメディアリンク欠陥は等しく受ける。

5. **リンク復旧経路の不在**: 一度リンクが欠落すると、`getBySessionId`（`sessionId` 属性スキャン）でしか解決しないため永続的に 404。`job.sessionId` → `job.mediaFileId` という別経路での再解決・補償が存在しない。

## Correctness Properties

Property 1: Bug Condition - 可視性（アップロード由来セッションが一覧に出る）

_For any_ 入力 `X = { session, user }` で可視性バグ条件が成立する場合（`isBugCondition_visibility(X)` が true、= アップロード由来かつ user がアップローダー本人かつ Assignment 不在）、修正後のシステムは SHALL `getAccessibleSessionIds(user)` に `session.sessionId` を含め、`GET /sessions` の結果にそのセッションを含める。かつ、`GET /sessions/assigned` に出るアップロード由来セッションは `GET /sessions` にも出る（両画面の可視性整合）。

ここで `userIsUploaderOrEntitled(user, session)` は **アップローダーのロールに依存せず** 成立する（REVIEWER でも TEAM_LEADER でもアップローダー本人であれば真）。したがって本プロパティは非 ADMIN のアップローダー（REVIEWER / TEAM_LEADER）に対して `session.sessionId` が一覧に含まれることを保証する。ADMIN アップローダーは `getAccessibleSessionIds` が `null`（全件）を返す挙動が維持され（Property 2）、可視性欠陥の対象外である。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - 既存可視性の不変

_For any_ 入力で可視性バグ条件が成立しない場合（`isBugCondition_visibility(X)` が false）、修正後のシステムは SHALL `getAccessibleSessionIds` / `GET /sessions` について元の実装と同一の結果を返し、既存の TeamAssignment / ReviewAssignment ベース可視性、ADMIN 全件返却、アクセス制御（他チーム拒否）を保持する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.6**

Property 3: Bug Condition - メディアリンク（メディアが解決できる）

_For any_ 入力 `X = { session }` でメディアリンクバグ条件が成立する場合（`isBugCondition_mediaLink(X)` が true、= アップロード由来かつ `getMediaFileBySessionId(session.sessionId) = null`）、修正後のシステムは SHALL MediaFile と Session の `sessionId` リンクを一貫して保証する。すなわち (a) `startJob` でリンク付与が失敗した場合は無言で不整合を残さず検知・記録し、(b) `getMediaUrl(session.sessionId)` 呼び出し時に `job.sessionId → job.mediaFileId` 経由で MediaFile を再解決してリンクを補償する。補償後、MediaFile の `scanStatus` が `CLEAN` であれば署名付き URL を返し、`MEDIA_FILE_NOT_FOUND` を返さない。

メディアリンク欠陥とその補償は **アップローダーのロールに完全に非依存** である。本プロパティは Reviewer / TeamLeader / Admin のいずれがアップロードしたセッションに対しても、リンク欠落からの補償が同じく効くことを保証する。

**Validates: Requirements 2.4, 2.5, 2.6**

Property 4: Preservation - メディア取得・スキャン状態チェックの不変

_For any_ 入力でメディアリンクバグ条件が成立しない場合（`isBugCondition_mediaLink(X)` が false、= MediaFile が既に `sessionId` にリンク済み）、修正後のシステムは SHALL `getMediaUrl` / `getMediaFileForSession` について元の実装と同一の結果を返す。`scanStatus=CLEAN` なら署名付き URL + `expiresAt`、`PENDING`/`INFECTED` ならそれぞれ 403（`MEDIA_SCAN_PENDING` / `MEDIA_MALWARE_DETECTED`）。

**Validates: Requirements 3.4, 3.5**

Property 5: Preservation - process-job-complete のセッション再利用

_For any_ `job.sessionId` が既に設定された job を `process-job-complete` が処理する場合、修正後のシステムは SHALL 引き続き既存セッションを再利用し、重複した空セッション（`SK=METADATA`）を新規作成しない。

**Validates: Requirements 3.7**

## Fix Implementation

### 採用方式の検討（可視性）

| 観点 | 案 A: `createSessionForJob` が ReviewAssignment を作る（採用） | 案 B: `getAccessibleSessionIds` が SessionParticipant も走査する |
|------|------------------------------------------------------------|---------------------------------------------------------------|
| 一覧経路の変更 | 変更なし（既存の Assignment 走査がそのまま効く） | `getAccessibleSessionIds` に GSI2 の `PARTICIPANT#` 走査を追加 |
| データモデル | アップローダーに直接割り当てを明示的に付与（意味が明確） | participant と accessible の意味が融合し責務が曖昧化 |
| アクセス制御との整合 | `checkSessionAccess`（`hasReviewAssignment`）と同じエンティティを使い整合 | `checkSessionAccess` 側も participant を見るよう追従変更が必要（波及大） |
| 既存データ | 既存の壊れたセッションは別途バックフィルが必要 | クエリ変更だけで既存データも一覧に出る（マイグレーション不要） |
| 冪等性 | `createReviewAssignment` は固定キー PUT で冪等（再割り当て安全） | 追加クエリのレイテンシ・コスト増 |
| レイヤリング | Service(`session-service`) → Repository(`team-repository.createReviewAssignment`) で完結 | Service 内クエリ追加。影響範囲が広い |
| リグレッションリスク | 低（既存経路を変えず、割り当て追加のみ） | 中〜高（`getAccessibleSessionIds` と `checkSessionAccess` の両方に影響） |

**採用: 案 A**。理由は (1) 一覧経路（`getAccessibleSessionIds`）と認可経路（`checkSessionAccess`/`hasReviewAssignment`）が **同一の ReviewAssignment エンティティ** を参照するため可視性と認可が自動的に整合し、bugfix 3.6 のアクセス制御を緩めない。(2) 既存の Assignment 走査ロジックを一切変更しないため 3.1–3.3 のリグレッションリスクが最小。(3) `createReviewAssignment()` が既存で冪等。

案 B は既存データをマイグレーション不要で救える利点があるが、`getAccessibleSessionIds` と `checkSessionAccess` の両方を participant 対応にする必要があり（片方だけだと「一覧に出るのにアクセスは 404」という新たな不整合を生む）、波及が大きいため採用しない。既存の壊れたデータは Fix 実装の「既存データの扱い」で別途対応する。

### 採用方式の検討（メディアリンク）

| 観点 | 案 C: 空 catch を例外伝播に変更 | 案 D: 明示的ハンドリング + 取得時フォールバック補償（採用） |
|------|-------------------------------|--------------------------------------------------------|
| job への影響 | セッション作成失敗で job 全体が失敗（Req 17.8「job 結果は保全」に反する） | job は保全。リンク失敗はログ記録のみで握りつぶさない |
| 既存の壊れたデータ | 復旧不可 | `getMediaUrl` 時に `job.sessionId→mediaFileId` で再解決・補償 |
| 無言の不整合 | 解消（ただし job 可用性を犠牲に） | 解消（ログ + メトリクス、取得時に自己修復） |

**採用: 案 D**。`startJob` の空 catch を、失敗を `console.error` で記録し（無言で握りつぶさない、bugfix 2.4）、job 自体は保全する明示的ハンドリングに変える。加えて `media-service` に取得時フォールバックを追加し、`getBySessionId` が null のとき `session → transcriptionJob → mediaFileId` を辿って MediaFile を解決し、解決できたら `updateSessionId` でリンクを補償（自己修復）する。これにより既存の壊れたデータ（bugfix 1.6 / 2.6 の Admin 後付け割り当てケース含む）も救済される。案 C は job 可用性要件（Req 17.8）に反するため不可。

### 変更内容

#### 変更 1: `createSessionForJob` がアップローダーに ReviewAssignment を作る（可視性）

**File**: `backend/src/services/session-service.ts`

**Function**: `createSessionForJob(transcriptionJobId, name, teamId?, assignedUserId?)`

**Specific Changes**:
1. `createSession(input)` でセッションを作成した後、`assignedUserId` が指定されている場合に `createReviewAssignment({ userId: assignedUserId, sessionId, createdBy: assignedUserId })` を呼び出す。
2. `team-repository.js` から `createReviewAssignment` を named import（`.js` 拡張子、ESM）。
3. ReviewAssignment 作成は `createSession` 成功後に実行し、`createReviewAssignment` の冪等性（固定キー PUT）に依存。これにより再実行（再トランスクリプション）でも安全。
4. レイヤリング厳守: Service(`session-service`) が Repository(`team-repository.createReviewAssignment`, `session-repository.createSession`) を呼ぶ。Handler からの直接呼び出しはしない。

> 備考: `createReviewAssignment` の既存シグネチャは `{ userId, sessionId, createdBy }`。アップロード由来の自動割り当てでは `createdBy` をアップローダー自身（`assignedUserId`）に設定する。

#### 変更 2: `startJob` の空 catch を明示的ハンドリングに（メディアリンク）

**File**: `backend/src/services/transcription-job-service.ts`

**Function**: `startJob(params)`

**Specific Changes**:
1. `try { createSessionForJob → jobRecord.sessionId 設定 → updateSessionId } catch {}` の空 catch を廃止。
2. catch 節で `console.error('Failed to create/link session for job', { jobId, mediaFileId, error })` を記録し、無言の握りつぶしをやめる（bugfix 2.4）。
3. job 自体は保全する（Req 17.8）: 例外を再 throw せず、`jobRecord.sessionId` 未設定のまま `transcriptionJobRepository.save(jobRecord)` を継続。`process-job-complete` の既存フォールバック（`job.sessionId ?? crypto.randomUUID()`）がセッションを補完する。
4. `createSessionForJob` と `updateSessionId` を分離して扱い、どちらで失敗したかをログに残す（セッションは作れたがリンクに失敗、のケースを識別可能にする）。

#### 変更 3: メディア取得時のフォールバック解決・補償（メディアリンク）

**File**: `backend/src/services/media-service.ts`

**Function**: `getMediaFileForSession(sessionId)`

**Specific Changes**:
1. `mediaFileRepository.getBySessionId(sessionId)` が `null` を返した場合、即 404 とせず、フォールバック解決を試みる:
   - `session-repository.getSessionById(sessionId)` でセッションを取得し `transcriptionJobId` を得る。
   - `transcription-job-repository` でジョブを引き、`job.mediaFileId` を得る（またはセッションの `transcriptionJobId` から `mediaFileId` を解決）。
   - `mediaFileRepository.getById(mediaFileId)` で MediaFile を取得。
2. フォールバックで MediaFile が解決できた場合、`mediaFileRepository.updateSessionId(mediaFileId, sessionId)` でリンクを補償（自己修復）し、以降の `getBySessionId` が成功するようにする。
3. フォールバックでも解決できない場合のみ、従来どおり `MEDIA_FILE_NOT_FOUND`（404）を throw する。
4. `scanStatus` チェック（CLEAN/PENDING/INFECTED → 200/403/403）は**解決後の MediaFile に対して従来どおり**適用し、挙動を一切変えない（bugfix 3.4, 3.5）。
5. レイヤリング厳守: `media-service`（Service）が `media-file-repository` / `session-repository` / `transcription-job-repository`（Repository）を呼ぶ。Handler は変更しない。

> 注意: フォールバックは `getBySessionId` が null のとき **のみ** 走る追加経路であり、リンク済みセッション（`isBugCondition_mediaLink` が false）のコードパスは一切変わらない（Property 4 保証）。

### 既存の壊れたデータの扱い

- **自己修復（優先）**: 変更 3 のフォールバックにより、既存の `sessionId` 未リンク MediaFile は、次回の `GET /sessions/{sessionId}/media-url` 呼び出し時に自動でリンクが補償される。これは Admin 後付け割り当てケース（bugfix 1.6 / 2.6）も救済する。
- **可視性のバックフィル（必須タスクとして実施する）**: 既に作られてしまった Reviewer / TeamLeader アップロード由来セッションは ReviewAssignment を持たないため、自己修復（変更 3 のメディアリンク補償）は一覧可視性には及ばない。これを是正するため、`SessionParticipant`（アップローダー）を走査して対応する `ReviewAssignment` を生成するワンショットのバックフィルスクリプト（`infra/scripts/backfill-review-assignments.ts`、運用用）を**必須タスクとして実施する**（tasks.md タスク 8）。dry-run をデフォルトとし（`--execute` で実書き込み）、`--env dev|staging|prod` で環境を指定、ADMIN は除外（`getAccessibleSessionIds` が `null` 全件を返すため割り当て不要）、固定キー PUT により冪等。書き込みレイアウトは `createReviewAssignment`（`PK=USER#{userId}`, `SK=ASSIGNMENT#{sessionId}`, `GSI1PK=SESSION#{sessionId}`, `GSI1SK=USER#{userId}`, `entityType='ReviewAssignment'`）と一致させる。
- **E2E 検証（必須タスクとして実施する）**: デプロイ済み環境に対し、Reviewer / TeamLeader アップロード → ジョブ完了 → セッション一覧に出る、校閲画面でメディア取得が成功する、のフルフローを Playwright で検証する（tasks.md タスク 9、`e2e/tests/sessions/reviewer-uploaded-session-visibility.spec.ts`）。

## Testing Strategy

### Validation Approach

2 フェーズで進める。まず **未修正コード** でバグを再現するカウンターイグザンプルを表面化し、根本原因を確認（または反証）する。次に修正後に Fix プロパティ（バグ入力で正しく動く）と Preservation プロパティ（非バグ入力で挙動不変）を検証する。テストは AWS SDK を `vi.mock()` でモックし、Handler / Service / Repository を独立に検証する（既存テスト規約に準拠）。

### Exploratory Bug Condition Checking

**Goal**: 修正前にバグを再現し、根本原因（可視性＝Assignment 不在、メディアリンク＝空 catch による欠落）を確認する。反証されたら再仮説を立てる。

**Test Plan**: Reviewer アップロード由来セッションを模擬し、未修正の `getAccessibleSessionIds` / `startJob` / `getMediaFileForSession` の挙動を観測する。

**Test Cases**:
1. **可視性不整合テスト（Reviewer / TeamLeader）**: `mediaFile.teamId` 未設定の Reviewer アップロード、および `mediaFile.teamId` 設定済みの TeamLeader アップロードの両方でセッション作成 → `getAccessibleSessionIds(uploader)` に sessionId が含まれないことを確認（未修正で失敗を観測）。同時に `getAssignedSessions(uploader)` には含まれることを確認（不整合の再現）。TeamLeader ケースでは teamId ありでも GSI1 の `SESSION#` アイテムが `ASSIGNMENT#` 走査に拾われないことが欠落の根拠。
2. **メディアリンク欠落テスト（全ロール）**: `startJob` 内で `updateSessionId` が throw する状況をモックし、uploader role を `REVIEWER` / `TEAM_LEADER` / `ADMIN` で生成して、空 catch により `mediaFile.sessionId` 未設定のまま job が save されることをロール非依存で観測（未修正の挙動）。
3. **メディア取得 404 テスト（全ロール）**: `getBySessionId` が null を返す状態で、全ロールのアップロード由来セッションに対し `getMediaUrl(sessionId)` が `MEDIA_FILE_NOT_FOUND` を返すことを観測（未修正で再現、ロール非依存）。
4. **Admin 後付け割り当てテスト（エッジ）**: TeamAssignment 追加後も `getBySessionId` が null のままメディア取得が 404 になることを観測（bugfix 1.6）。

**Expected Counterexamples**:
- `getAccessibleSessionIds` がアップロード由来 sessionId を返さない（Assignment アイテムが 0 件）。
- `updateSessionId` 失敗が空 catch で握りつぶされ、MediaFile リンクが欠落。
- Possible causes: Assignment 未作成、`assignedTeamId` 依存の GSI1、空 catch、リンク復旧経路の不在。

### Fix Checking

**Goal**: バグ条件が成立する全入力で、修正後の関数が期待挙動を満たすことを検証する。

**Pseudocode:**
```
// 可視性（Property 1）
FOR ALL X WHERE isBugCondition_visibility(X) DO
  listed   := getAccessibleSessionIds'(X.user)
  assigned := getAssignedSessions'(X.user)
  ASSERT X.session.sessionId IN listed
  ASSERT (X.session IN assigned) IMPLIES (X.session.sessionId IN listed)
END FOR

// メディアリンク（Property 3）
FOR ALL X WHERE isBugCondition_mediaLink(X) DO
  result := getMediaUrl'(X.session.sessionId)
  ASSERT getMediaFileBySessionId'(X.session.sessionId) != null   // 補償後
  ASSERT (mediaFile.scanStatus = CLEAN) IMPLIES (result = signedUrl AND result != MEDIA_FILE_NOT_FOUND)
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しない全入力で、修正後の関数が元の関数と同一の結果を返すことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE NOT (isBugCondition_visibility(X) OR isBugCondition_mediaLink(X)) DO
  ASSERT getAccessibleSessionIds(X.user) = getAccessibleSessionIds'(X.user)
  ASSERT getMediaUrl(X.session.sessionId)  = getMediaUrl'(X.session.sessionId)
END FOR
```

**Testing Approach**: Preservation の検証にはプロパティベーステスト（fast-check）を推奨する。入力ドメイン全体にわたり多数のケースを自動生成し、手書きの単体テストが見落とすエッジケース（さまざまな Assignment 組み合わせ、scanStatus の各値、ADMIN/非 ADMIN）を捕捉し、非バグ入力での挙動不変を強く保証できる。

**Test Plan**: 未修正コードで既存の Assignment 整合セッション・リンク済みメディアの挙動を観測してから、その挙動を固定するプロパティベーステストを書く。

**Test Cases**:
1. **既存 Assignment 可視性 Preservation**: TeamAssignment / ReviewAssignment が存在するセッションの `getAccessibleSessionIds` 結果が修正前後で不変（bugfix 3.1, 3.3）。
2. **ADMIN 全件 Preservation**: ADMIN に対し `getAccessibleSessionIds` が `null` を返し続ける（bugfix 3.2）。
3. **リンク済みメディア Preservation**: `getBySessionId` が非 null のとき、`getMediaUrl` がフォールバックを使わず従来どおり署名付き URL を返す（bugfix 3.4）。
4. **scanStatus Preservation**: `PENDING`/`INFECTED` で 403（`MEDIA_SCAN_PENDING`/`MEDIA_MALWARE_DETECTED`）を返す（bugfix 3.5）。
5. **アクセス制御 Preservation**: 他チーム・未割り当てセッションへのアクセスが `checkSessionAccess`/`denyResourceAccess` で 404 のまま（bugfix 3.6）。
6. **process-job-complete 再利用 Preservation**: `job.sessionId` あり時に重複セッションを作らない（bugfix 3.7）。

### Unit Tests

- `session-service.createSessionForJob`: `assignedUserId` あり → `createReviewAssignment` が正しいキーで呼ばれる。`assignedUserId` なし → 呼ばれない。`createReviewAssignment` の再実行が冪等。
- `transcription-job-service.startJob`: `createSessionForJob` 失敗時にログ記録され job が保全される（例外を再 throw しない、`sessionId` 未設定で save される）。`updateSessionId` 失敗時も同様にログ記録・job 保全。
- `media-service.getMediaFileForSession`: `getBySessionId` null → フォールバックで `session→job→mediaFileId` 解決 → `updateSessionId` 補償 → MediaFile 返却。フォールバックでも解決不能 → `MEDIA_FILE_NOT_FOUND`。解決後の scanStatus 分岐（CLEAN/PENDING/INFECTED）。
- `access-control-service.getAccessibleSessionIds`: ReviewAssignment が追加されたことでアップロード由来 sessionId が含まれる（ADMIN は `null` 維持）。

### Property-Based Tests

必須対象（tech 規約「Download / Upload / Search / IP filtering」等に該当。本件は Upload 由来セッションと Download＝メディア取得に関わる）:
- **Property 1（Fix・可視性）**: ランダムなアップローダー userId / sessionId / teamId（未設定含む）に加え **uploader role（`REVIEWER` / `TEAM_LEADER` / `ADMIN`）を arbitrary に含める**。非 ADMIN（REVIEWER / TEAM_LEADER）では `createSessionForJob` 後に `getAccessibleSessionIds(uploader)` が必ず sessionId を含み、`getAssignedSessions` との整合（assigned ⊆ listed）が保たれること、ADMIN では `getAccessibleSessionIds` が `null`（全件）を維持することを検証する。TeamLeader の `teamId` 設定済みケース（GSI1 の `SESSION#` と `getAccessibleSessionIds` の `ASSIGNMENT#` 走査の不一致）を明示的に含める。`{ numRuns: 100 }`。
- **Property 2（Preservation・可視性）**: ランダムな Assignment 構成（TeamAssignment/ReviewAssignment の有無・組み合わせ）と uploader/caller role（`REVIEWER` / `TEAM_LEADER` / `ADMIN`）に対し、非バグ入力で `getAccessibleSessionIds` の結果が修正前実装と一致。特に ADMIN で `null`（全件）が維持されることを role arbitrary で検証する。
- **Property 3（Fix・メディアリンク）**: ランダムな scanStatus・リンク欠落状態に加え **uploader role（`REVIEWER` / `TEAM_LEADER` / `ADMIN`）を arbitrary に含め**、全ロールでフォールバック補償が効き MediaFile が解決され、CLEAN なら署名付き URL、`MEDIA_FILE_NOT_FOUND` を返さないことを検証する（補償はロール非依存）。
- **Property 4（Preservation・メディア取得）**: リンク済み MediaFile に対し、scanStatus の各値で修正前後の結果（URL / 403 コード）が一致。
- 各 `describe` は `Feature: reviewer-uploaded-session-not-visible, Property N: ...` 形式、各 `it` の docstring に `**Validates: Requirements X.Y**` を記載（tech 規約準拠）。

### Integration Tests

- **フルフロー（可視性）**: Reviewer アップロード（teamId 未設定）→ `createSessionForJob` → `GET /sessions` と `GET /sessions/assigned` の両方に当該セッションが出る（整合）。
- **フルフロー（メディア取得）**: 上記セッションで `GET /sessions/{sessionId}/media-url` が、CLEAN なら署名付き URL を返す（リンク補償経由を含む）。
- **Admin 後付け割り当て**: リンク欠落セッションに Admin が team/reviewer を割り当て → 校閲画面のメディア取得が成功する（bugfix 2.6）。
- **process-job-complete 連携**: `startJob` が `sessionId` を設定済みの job を処理 → 既存セッション再利用、重複なし（bugfix 3.7）。
## テスト見逃し分析と再発防止

### なぜ既存テストでこのバグを捕まえられなかったか

本バグは E2E を含む複数のテスト層が存在したにもかかわらず見逃された。原因は、**どのテスト層も「アップロード → ジョブ → セッション生成」という生成経路（`startJob` → `createSessionForJob` → `ReviewAssignment` 生成 / `MediaFile.sessionId` リンク）を一切通っていなかった** という構造的盲点である。既存テストはいずれも「生成経路の出力」を直接 seed / stub したうえで、その後の表示や UI 遷移だけを検証していた。したがって、生成経路そのものの欠陥（`startJob` が `ReviewAssignment` を作らない / 空 catch でメディアリンクが欠落する）を観測できるレイヤーが存在しなかった。

#### 4 層テストの構造的盲点（どの層も生成経路を通っていなかった）

| テスト層 | 既存の検証内容 | 生成経路を通るか | 見逃した欠陥 |
|----------|----------------|------------------|--------------|
| media-upload E2E（`e2e/tests/upload/media-upload.spec.ts`） | presigned URL 取得・S3 PUT を全スタブし、アップロード UI の遷移・成功表示のみ検証 | **通らない**（presigned / S3 PUT をスタブ、ジョブ起動以降に到達しない） | `startJob` の `ReviewAssignment` 未生成・空 catch によるメディアリンク欠落 |
| session-list / review-page E2E（`e2e/tests/sessions/session-list.spec.ts`, `review-page.spec.ts`） | 整合済みデータ（Assignment あり / メディアリンク済み）を直接 seed し、一覧表示・校閲画面表示のみ検証 | **通らない**（生成経路の出力を手で seed して表示だけ確認） | 生成経路が Assignment / メディアリンクを作らないこと（seed が肩代わりしていた） |
| 本 spec の可視性/メディア E2E（`reviewer-uploaded-session-visibility.spec.ts`） | 修正後レイアウト（ReviewSession + SessionParticipant + ReviewAssignment）を `seedUploadOriginSession` で直接投入し、表示のみ検証 | **通らない**（修正後の生成結果を seed、生成経路は実行しない） | 生成経路が実際にその出力を作るかどうか（seed が肩代わりする限り永久に緑） |
| backend 単体 / プロパティ（Property 1〜5） | AWS SDK を `vi.mock()` でモックし、Handler / Service / Repository を独立検証 | **通らない**（Service 間の実連携・実 DynamoDB 書き込みはモックで分断） | モック境界をまたぐ `startJob → createSessionForJob → team-repository` の実連携不整合 |

要するに、(a) media-upload E2E は presigned / S3 PUT を全スタブして UI 遷移のみを見ており生成経路に到達せず、(b) session-list / review-page E2E と本 spec は整合済みデータ・修正後レイアウトを直接 seed して表示のみを見ていた。生成経路の欠陥を捕まえるレイヤーが欠けていた。

### 追加する 4 パターンの狙い

再発防止として、tasks.md にタスク 10〜13 を追加する。各パターンが上表のどの盲点を埋めるかを以下に示す。

| 追加パターン | 層 | 埋める盲点 | 狙い |
|--------------|----|------------|------|
| タスク 10（P1）アップロード生成経路の統合テスト | backend 統合（LocalStack） | 生成経路をモックせず実行する層が無かった | `startJob` → `createSessionForJob` → `ReviewAssignment` 生成 → `MediaFile.sessionId` リンクを実テーブルに対して実経路で検証し、本バグを「生成時点」で捕捉する（最重要） |
| タスク 11（P2）ロール別可視性マトリクス | backend プロパティ + E2E 補助 | 「見えすぎる」逆方向リグレッションを検出する層が無かった | 可視性修正が他人のアップロード由来セッションを無関係ユーザーに露出していないこと（分離）を検証し、アクセス制御を緩めていないことを保証 |
| タスク 12（P3）準エンドツーエンド縦貫 | backend 統合（LocalStack） | アップロード〜ジョブ完了〜一覧表示を実経路で縦貫する層が無かった | Transcribe 実時間を避けつつ、完了イベント注入で `process-job-complete` を短絡し、生成されたセッションが一覧経路・メディア解決経路に実際に乗ることを縦貫検証 |
| タスク 13（P4）Admin アップロードの回帰 | E2E | ADMIN 全件パスの退行を見張る層が弱かった | `getAccessibleSessionIds` の ADMIN=null 全件パスが本修正で壊れていないことを E2E で確認 |

これらにより、今後 (1) 生成経路が `ReviewAssignment` / メディアリンクを作らなくなる退行、(2) 可視性を緩めすぎる逆方向退行、(3) 縦貫フローの破断、(4) ADMIN 全件パスの退行、のいずれも検出可能になる。

## ロール変更・降格に関する追加考慮

追加質問「アップロード → セッション作成後にアップローダーのロールを変更したら可視性に反映されるか」を実コードで裏取り調査した結果を記録する。本節は 2 つの論点からなり、論点 1 は設計判断であり本タスクのスコープ外（記録のみ）、論点 2 がタスク 14 で塞ぐ限定エッジである。

### 論点 1: ロール解決とロール変更時の権限反映遅延（スコープ外・記録のみ）

- `extractUser`（`backend/src/utils/auth-middleware.ts`）のロール解決順は **JWT の `custom:role` を優先し、無い場合のみ DynamoDB の User レコードへフォールバック**する。したがって JWT にロールが埋まっているセッション中はトークンの値が優先される。
- ロール変更時には `globalSignOutCognitoUser` を **呼ばない**（グローバルサインアウトは `isActive=false`（無効化）時のみ実行する）。このため専用 User Pool 運用では、ロール変更後も当該ユーザーが再ログインして新しい JWT を取得するまで、`custom:role` ベースの権限反映が遅延する。
- これは意図された設計判断（無効化時のみ強制サインアウト）であり、**本タスク（タスク 14）のスコープ外**。ここでは事実として記録するにとどめ、挙動は変更しない。

### 論点 2: 可視性と降格の非対称（タスク 14 で塞ぐ限定エッジ）

可視性（`ReviewAssignment` の有無）の観点では、**新規作成経路は降格に強い**一方、**バックフィル経路だけが ADMIN を除外しており非対称**で、限定的なエッジを生んでいる。

- **新規作成（降格に強い）**: `createSessionForJob`（`backend/src/services/session-service.ts`）は `assignedUserId`（アップローダー）が渡れば **ロール非依存で無条件に** `createReviewAssignment` を呼ぶ。よって修正後に作られたセッションは ADMIN アップロードであっても `ReviewAssignment` が張られる。ADMIN のままなら `getAccessibleSessionIds` は `null`（全件）を返すため割り当ては一覧結果に影響しないが、その人が後で非 ADMIN に降格されても、`getAccessibleSessionIds` の非 ADMIN 経路（直接割り当て `PK=USER#{userId}, SK begins_with ASSIGNMENT#`）で当該セッションが一覧に残る。つまり **新規作成分は降格に対して安全**。
- **バックフィル（非対称で限定エッジを生む）**: バックフィルスクリプト（`infra/scripts/backfill-review-assignments.ts` の純粋関数 `selectBackfillTargets`）は条件 4 で `role === 'ADMIN'` のアップローダーを除外する（`skippedAdminUploader`）。これは「ADMIN は `getAccessibleSessionIds` が `null`＝全件を返すのでバックフィル不要」という前提に基づく。
- **限定エッジ**: 「修正前に ADMIN がアップロードし、かつバックフィル実行時点でもまだ ADMIN だった古いセッション」は、ADMIN 除外により `ReviewAssignment` を持たないまま残る。この人が後で非 ADMIN に降格されると、`getAccessibleSessionIds` の非 ADMIN 経路に入り、`ReviewAssignment` が無いため **自分がアップロードしたセッションが一覧から消える**。
- **非対称の是正方針（タスク 14）**: 新規作成（`createSessionForJob`）はロール非依存で `ReviewAssignment` を張るのに、バックフィルだけが ADMIN を除外している。この非対称が限定エッジの原因なので、**バックフィルを新規作成と同じ挙動に揃える** — `selectBackfillTargets` から `role === 'ADMIN'` を除外するロジックを撤廃し、アップローダーのロールに関わらず `ReviewAssignment` を backfill 対象にする。他の条件（セッション存在、TeamAssignment 不在、既存 ReviewAssignment 不在＝冪等、ユーザー解決可能）は維持し、冪等性（固定キー PUT）も変えない。

### タスク 14 が検証・保持する Requirement

- **検証**: 2.1, 2.2, 2.3（可視性 — 降格後もアップローダーが自分のアップロード由来セッションを一覧で見られる）。
- **Preservation 3.2**: ADMIN 全件パスは変えない。ADMIN に `ReviewAssignment` を張っても、ADMIN のままなら `getAccessibleSessionIds` は `null`（全件）を返すため一覧結果に影響はなく、効くのは降格後（非 ADMIN 経路）のみ。
