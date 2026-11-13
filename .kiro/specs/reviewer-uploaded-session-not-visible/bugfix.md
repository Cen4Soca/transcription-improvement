# Bugfix Requirements Document

## Introduction

アップローダー（REVIEWER / TEAM_LEADER / ADMIN のいずれかのロール）が自分でメディアファイルをアップロードし、トランスクリプションジョブが完了した後、そのジョブから自動生成された ReviewSession に複数の不具合が発生する。症状は主に REVIEWER で報告されたが、追加調査により欠陥がアップローダーのロールに依存しないことが確定している（可視性欠陥は REVIEWER / TEAM_LEADER 共通、メディアリンク欠陥は全ロール共通、ADMIN は一覧には非影響だがメディアリンクは影響あり）。以下は REVIEWER を代表例として記述する。

- セッション一覧画面（`GET /sessions`）に、自分がアップロードしたメディアのセッションが表示されない。
- 一方で「自分のタスク」画面（`GET /sessions/assigned`）には同じセッションが表示される。
- 「自分のタスク」からそのセッションの校閲画面を開くと、メディア取得（`GET /sessions/{sessionId}/media-url`）でエラーになり、以下 3 つのメッセージが表示される。
  - 「メディアファイルが見つかりません。このセッションには再生可能なファイルが登録されていない可能性があります。」（`MEDIA_FILE_NOT_FOUND` / 404）
  - 「データの取得に失敗しました」
  - 「リソースが見つかりません。」

Admin がチームまたは Reviewer にセッションを割り当ててもエラーは解消しない。これはアクセス制御（team スコープ割り当て）だけが原因ではなく、MediaFile / Session / Transcription 間の関連付け（`sessionId` リンク）とメディア取得パス自体に根本原因があることを示す。

### 根本原因の仮説（調査に基づく）

同一のセッションに対し、2 つの画面が **別々のデータ取得パス** を使っている。

- **セッション一覧（`GET /sessions`）**: `access-control-service.getAccessibleSessionIds(user)` が返す ID 集合でフィルタする。非 ADMIN では、
  1. チーム割り当て: `PK=TEAM#{teamId}`, `SK begins_with ASSIGNMENT#`（`TeamAssignment` アイテム）
  2. 直接割り当て: `PK=USER#{userId}`, `SK begins_with ASSIGNMENT#`（`ReviewAssignment` アイテム）
  の 2 種類の **Assignment アイテム** のみを走査する。
  （`backend/src/handlers/get-sessions.ts`, `backend/src/services/access-control-service.ts` 265–309 行付近）
- **自分のタスク（`GET /sessions/assigned`）**: `session-service.getAssignedSessions(userId)` → `getSessionsByParticipantUserId(userId)` が GSI2 の `SessionParticipant` アイテム（`PARTICIPANT#`）を走査する。
  （`backend/src/handlers/get-assigned-sessions.ts`, `backend/src/services/session-service.ts` の `getAssignedSessions`, `backend/src/repositories/session-repository.ts` の `getSessionsByParticipantUserId`）

Reviewer がアップロードすると `start-transcription` → `transcription-job-service.startJob()` → `session-service.createSessionForJob(jobId, name, mediaFile.teamId, mediaFile.uploadedBy)` → `session-repository.createSession()` が実行される。このとき `createSession` は、

- アップローダーを **`SessionParticipant`** として登録する（→ 自分のタスクには出る）。
- `assignedTeamId`（= `input.assignedTeamId ?? input.teamId`）が **存在する場合のみ** GSI1（`TEAM#`）を張る。
- **`TeamAssignment`（`SK=ASSIGNMENT#{sessionId}`）も `ReviewAssignment`（`PK=USER#..., SK=ASSIGNMENT#...`）も一切作らない。**

その結果、`getAccessibleSessionIds` は Assignment アイテムを 1 件も見つけられず、セッション一覧に現れない（症状 1・2）。さらに、Reviewer のアップロードで `mediaFile.teamId` が未設定だと `assignedTeamId` も付かず、GSI1 も張られないため、`post-session-assignment`（Admin による team/reviewer 割り当て）で `TeamAssignment` を追加しても、セッション一覧の `getAccessibleSessionIds` が依存する Assignment とは別経路であり、メディア取得エラー（後述）は解消しない。

**ロール横断（追加調査で確定）**: `createSession` の書き込み内容はアップローダーのロールではなく引数の有無だけで決まるため、この可視性欠陥は Reviewer に固有ではない。TeamLeader がアップロードし `mediaFile.teamId` が設定されても、`createSession` が GSI1 に張るのは `GSI1PK=TEAM#{teamId}, GSI1SK=SESSION#{now}#{sessionId}`（`SESSION#` プレフィックス）のアイテムであり、`getAccessibleSessionIds` の team 経路は `PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`（`TeamAssignment` アイテム）しか走査しない。両者は別アイテム・別インデックスなので TeamLeader アップロード由来セッションも一覧に出ない。一方 Admin アップロードは `getAccessibleSessionIds` が `isAdmin` で `null`（全件）を返すため一覧には顕在化しない。メディアリンク欠陥（次段落）は `startJob` の空 catch が原因で、アップローダーのロールに完全に非依存であり、Reviewer / TeamLeader / Admin のいずれでも同じ 404 が起こりうる。

メディア取得エラーの根本原因は `sessionId` リンクの欠落にある。`getMediaUrl(sessionId)` → `media-service.getMediaFileForSession(sessionId)` → `media-file-repository.getBySessionId(sessionId)` は MediaFile の `sessionId` 属性でスキャンして一致レコードを探す。この `sessionId` リンクは `startJob()` 内の `createSessionForJob` 成功後に `mediaFileRepository.updateSessionId(mediaFileId, session.sessionId)` で張られるが、この処理は **`createSessionForJob` の例外を握りつぶす `try { ... } catch {}`（空 catch）の内側** にある。セッション作成またはリンク処理が失敗すると `mediaFile.sessionId` は未設定のまま job だけが先に進み、`process-job-complete` が segment と（必要なら）新規セッションを作っても、MediaFile にはリンクが張られない。この状態で `getBySessionId` は `null` を返し、`MEDIA_FILE_NOT_FOUND`（404）となる（症状 3）。

補助的に、`getMediaFileForSession` は `scanStatus` が `CLEAN` 以外（未設定 / `PENDING` / `INFECTED`）の場合は 404 ではなく 403（`MEDIA_SCAN_PENDING` / `MEDIA_MALWARE_DETECTED`）を返す。これはメディア取得が失敗する別経路であり、本バグの `MEDIA_FILE_NOT_FOUND` とは区別して扱う（リンク不整合が主因）。

## Bug Analysis

### Current Behavior (Defect)

アップローダー（Reviewer / TeamLeader / Admin のいずれか）が自分でアップロードし、トランスクリプションジョブ完了後にセッションが自動生成された状態で発生する。

> **ロール横断の確定事実（追加調査、実コード確認済み）**: `createSession`（`session-repository.ts`）が書き込む内容はアップローダーのロールではなく「引数の有無」だけで決まる。`createSessionForJob` はすべてのアップローダー（Reviewer / TeamLeader / Admin）に対して同じ経路を通り、`assignedUserId = mediaFile.uploadedBy`、`teamId = mediaFile.teamId` を渡す。したがって本バグはアップローダーのロールに依存しない。可視性欠陥は Reviewer だけでなく TeamLeader でも発生し（1.1a 参照）、メディアリンク欠陥は全ロール共通（1.7 参照）である。Admin アップロードは一覧には顕在化しない（`getAccessibleSessionIds` が `isAdmin` で `null`（全件）を返すため）が、メディアリンク欠陥は等しく受ける。

1.1 WHEN アップローダー（Reviewer または TeamLeader）が自分でアップロードしたメディアから生成されたセッションがあり、そのセッションに `TeamAssignment`（`PK=TEAM#{teamId}, SK=ASSIGNMENT#{sessionId}`）も `ReviewAssignment`（`PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}`）も存在しない状態で、そのアップローダーが `GET /sessions`（セッション一覧）を呼び出す THEN the system はそのセッションを一覧に含めない（`getAccessibleSessionIds` が当該 `sessionId` を返さず、items から欠落する）

1.1a WHEN TeamLeader が自分でアップロードし `mediaFile.teamId` が設定された（＝ `assignedTeamId` あり）メディアから生成されたセッションについて、その TeamLeader（または同チームの Reviewer）が `GET /sessions` を呼び出す THEN the system はそのセッションを一覧に含めない。根拠: `createSession` が `assignedTeamId` ありのとき GSI1 に張るのは `GSI1PK=TEAM#{teamId}, GSI1SK=SESSION#{now}#{sessionId}`（**`SESSION#` プレフィックス**）のアイテムである。一方 `getAccessibleSessionIds` の team 経路は `PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`（**`TeamAssignment` アイテム、ベーステーブル**）を走査する。両者は別アイテム・別インデックスであり、`teamId` が設定され GSI1 が張られても TeamLeader アップロード由来セッションは一覧に出ない。結果、TeamLeader でも「一覧に出ない／マイタスクには出る」という Reviewer と同じ不整合が発生する

1.2 WHEN 同じアップローダー（Reviewer または TeamLeader）が同じセッションについて `GET /sessions/assigned`（自分のタスク）を呼び出す THEN the system はそのセッションを `SessionParticipant` 経由で返すため、一覧には出ないのに自分のタスクには出るという不整合が生じる

1.3 WHEN Reviewer のアップロードで `mediaFile.teamId` が未設定のまま `createSessionForJob` が呼ばれる THEN the system は `assignedTeamId` も GSI1（`TEAM#`）も付与せず、セッションをチームスコープのどの一覧経路からも到達不能にする

1.4 WHEN `startJob()` 内の `createSessionForJob` または `mediaFileRepository.updateSessionId` が失敗する THEN the system は空の `catch {}` で例外を握りつぶし、MediaFile の `sessionId` リンクが張られないまま job を続行する

1.5 WHEN 上記 1.4 により MediaFile の `sessionId` が未設定のセッションに対して `GET /sessions/{sessionId}/media-url` が呼ばれる THEN the system は `getBySessionId` が `null` を返し、`MEDIA_FILE_NOT_FOUND`（404）を返して校閲画面にメディア取得エラーを表示する

1.6 WHEN Admin がこの状態のセッションを team または reviewer に割り当てても（`PATCH /sessions/{sessionId}/assignment` 等で `TeamAssignment` を追加しても）THEN the system は MediaFile の欠落した `sessionId` リンクを復旧しないため、校閲画面のメディア取得エラー（1.5）は解消しない

1.7 WHEN アップローダーのロールが Reviewer / TeamLeader / Admin のいずれであっても（`createSessionForJob` → `startJob` の経路はロール非依存）1.4 の空 catch による `sessionId` リンク欠落が起こる THEN the system はそのロールに関わらず `GET /sessions/{sessionId}/media-url` で同じ `MEDIA_FILE_NOT_FOUND`（404）を返しうる（メディアリンク欠陥は全ロール共通でアップローダーのロールに依存しない）

1.8 WHEN Admin がアップローダーである場合、Admin が `GET /sessions` を呼び出す THEN the system は `getAccessibleSessionIds` が `isAdmin` で `null`（全件）を返すため当該セッションを一覧に含める（可視性欠陥は Admin の一覧には顕在化しない）。ただし 1.7 のメディアリンク欠陥は Admin アップロードでも等しく発生しうる（一覧には出るがメディア取得は 404 になりうる、という切り分け）

### Expected Behavior (Correct)

2.1 WHEN Reviewer が自分でアップロードしたメディアから生成されたセッションについて、その Reviewer が `GET /sessions`（セッション一覧）を呼び出す THEN the system SHALL そのセッションを一覧に含めて返す（アップローダー本人が到達できる割り当て/スコープを一覧経路が認識する）

2.2 WHEN 同じ Reviewer が `GET /sessions`（一覧）と `GET /sessions/assigned`（自分のタスク）の両方を呼び出す THEN the system SHALL 同一のアップロード由来セッションについて両画面で整合した可視性を提供する（自分のタスクに出るセッションは一覧にも出る）

2.3 WHEN Reviewer のアップロードで `mediaFile.teamId` が未設定のまま `createSessionForJob` が呼ばれる THEN the system SHALL アップローダー本人がセッション一覧でそのセッションに到達できるよう、`getAccessibleSessionIds` が参照する割り当て/スコープ（直接割り当て相当、またはアップローダー自身を起点とする可視性）を設定する

2.4 WHEN `startJob()` 内でセッション作成または MediaFile への `sessionId` リンク付与が失敗する THEN the system SHALL 失敗を握りつぶさず、MediaFile が後続でメディア取得可能になるようリンクの一貫性を保証する（リンク不整合を検知・記録し、無言で不整合状態を残さない）

2.5 WHEN MediaFile が正しく `sessionId` にリンクされたセッションに対して `GET /sessions/{sessionId}/media-url` が呼ばれる THEN the system SHALL その MediaFile を `getBySessionId` で解決し、`scanStatus` が `CLEAN` であれば署名付き URL を返す（`MEDIA_FILE_NOT_FOUND` を返さない）

2.6 WHEN Admin がこの状態のセッションを team または reviewer に割り当てる THEN the system SHALL MediaFile と Session の関連付けが維持された状態で、割り当て後に校閲画面のメディア取得が成功するようにする

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Admin または TEAM_LEADER が、`TeamAssignment` または `ReviewAssignment` が正しく存在する既存のセッションについて `GET /sessions` を呼び出す THEN the system SHALL CONTINUE TO 現行の team スコープ/直接割り当てに基づく可視性どおりにセッション一覧を返す

3.2 WHEN ADMIN が `GET /sessions` を呼び出す THEN the system SHALL CONTINUE TO 全セッションを返す（`getAccessibleSessionIds` が `null` を返す ADMIN 全件パスを維持する）

3.3 WHEN Admin がアップロードし、`mediaFile.teamId` または `assignedTeamId` が設定されたメディアから生成されたセッションについて該当ユーザーが `GET /sessions` を呼び出す THEN the system SHALL CONTINUE TO そのセッションを一覧に含めて返す

3.4 WHEN MediaFile が `sessionId` に正しくリンクされ `scanStatus` が `CLEAN` のセッションに対して `GET /sessions/{sessionId}/media-url` が呼ばれる THEN the system SHALL CONTINUE TO 署名付き URL と `expiresAt` を返す

3.5 WHEN セッションの MediaFile の `scanStatus` が `PENDING`（未完了）または `INFECTED` である THEN the system SHALL CONTINUE TO それぞれ `MEDIA_SCAN_PENDING` / `MEDIA_MALWARE_DETECTED` の 403 を返す（本修正はスキャン状態チェックの挙動を変えない）

3.6 WHEN いずれかの画面が他チーム/未割り当てのセッションにアクセスしようとする（アップローダー本人でも割り当て対象でもない）THEN the system SHALL CONTINUE TO `checkSessionAccess` / `denyResourceAccess` によりアクセスを拒否する（本修正でアクセス制御を緩めない）

3.7 WHEN `process-job-complete` が、`startJob()` が既に作成した `job.sessionId` を持つ job を処理する THEN the system SHALL CONTINUE TO 既存セッションを再利用し、重複した空セッションを作らない

---

## 補足: Bug Condition の定式化（design フェーズへの引き継ぎ用）

> 以下は要件の定義ではなく、bug condition methodology に基づく分析の記録である。実装設計は design.md で行う。

本バグは 2 つの独立した欠陥が重なっている。入力 `X` を「Reviewer のアップロードから生成されたセッションと、それを操作する認証ユーザーの組」とする。

```pascal
FUNCTION isBugCondition_visibility(X)
  INPUT: X = { session, user }   // session はアップロード由来、user はアップローダー本人
  OUTPUT: boolean

  // 一覧経路が参照する Assignment が存在しないのに、user は正当なアクセス権を持つ
  RETURN session.generatedFromUpload = true
     AND NOT existsTeamAssignment(session.sessionId)
     AND NOT existsReviewAssignment(user.userId, session.sessionId)
     AND userIsUploaderOrEntitled(user, session)
END FUNCTION

FUNCTION isBugCondition_mediaLink(X)
  INPUT: X = { session }
  OUTPUT: boolean

  // Session は存在するが、どの MediaFile も sessionId でそれを指していない
  RETURN session.generatedFromUpload = true
     AND getMediaFileBySessionId(session.sessionId) = null
END FUNCTION
```

```pascal
// Property: Fix Checking - 可視性
FOR ALL X WHERE isBugCondition_visibility(X) DO
  listed ← GET_sessions'(X.user)   // 修正後の一覧
  assigned ← GET_sessions_assigned'(X.user)
  ASSERT X.session IN listed
  ASSERT (X.session IN assigned) IMPLIES (X.session IN listed)   // 整合性
END FOR

// Property: Fix Checking - メディアリンク
FOR ALL X WHERE isBugCondition_mediaLink(X) DO
  // 修正後はリンクが保証される（または失敗が握りつぶされない）
  result ← GET_media_url'(X.session.sessionId)
  ASSERT (getMediaFileBySessionId'(X.session.sessionId) ≠ null)
  ASSERT (mediaFile.scanStatus = CLEAN) IMPLIES (result = signedUrl AND result ≠ MEDIA_FILE_NOT_FOUND)
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugCondition_visibility(X) OR isBugCondition_mediaLink(X)) DO
  ASSERT GET_sessions(X) = GET_sessions'(X)
  ASSERT GET_media_url(X) = GET_media_url'(X)
END FOR
```

- **F**: 修正前の `get-sessions` / `startJob` / `media-service` の挙動
- **F'**: 修正後の挙動
- **Counterexample**: Reviewer（`teamId` 未設定）が media をアップロード → ジョブ完了 → `GET /sessions` に当該セッションが出ない一方 `GET /sessions/assigned` には出る。校閲画面を開くと `GET /sessions/{sessionId}/media-url` が `MEDIA_FILE_NOT_FOUND`（404）を返す。TeamLeader（`teamId` 設定済み）でも同じ可視性不整合が再現する（GSI1 の `SESSION#` アイテムは `getAccessibleSessionIds` の `ASSIGNMENT#` 走査に拾われないため）。メディアリンク 404 は Reviewer / TeamLeader / Admin のいずれのアップロードでも起こりうる（ロール非依存）。
