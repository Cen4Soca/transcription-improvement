# セルフ割り当てAPI（C案）実装前調査

対象リポジトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement`
調査モード: 読み取り専用（コード変更なし）
目的: Reviewer が TEAM_LEADER/ADMIN の割り当てを待たずにセッションに join できる「セルフ割り当てAPI（C案）」の実装前調査。

---

## サマリ（先に結論）

- **項目1（逆引き経路）**: 既存の逆引き経路は **2つ** 存在する。(a) 最短経路 `mediaFileRepository.getBySessionId(sessionId)`（`media-service.ts` が既利用、`sessionId` の Scan で MediaFile の `uploadedBy`/`teamId` に直接到達）、(b) ジョブ経由経路 `session.transcriptionJobId → transcriptionJobRepository.getById → mediaFileId → mediaFileRepository.getById`。self-assign の権限判定だけなら実は **MediaFile 逆引きは不要** で、`session.assignedTeamId` と `isTeamMember()` で判定できる（既存 `joinSession` と同じ）。
- **項目2（Reviewer向けUI導線）**: join 操作のUI（「引き受ける」ボタン）と API クライアント（`sessionApi.claimSession` → `POST /sessions/{id}/join`）は **既に存在する**。ただし **致命的なギャップが2つ**ある。(a) ボタンは `!session.assignedUserId` のときのみ表示されるが、自動生成セッションは常にアップローダーが `assignedUserId` に入るため、他 Reviewer には **ボタンが出ない**。(b) そもそも他 Reviewer のセッション一覧 `GET /sessions` は `TeamAssignment`/`ReviewAssignment` レコードのみを見るため、自動生成された PENDING セッションは **一覧に出てこない**（候補表示が存在しない）。
- **項目3（CDK配線）**: `infra/lib/stacks/api-stack.ts` に明快な雛形がある。新ルート `POST /sessions/{sessionId}/self-assign` は、`createLambda('PostSessionSelfAssign', …)` + `grantCommonPermissions(fn, props)` + `addRoute('POST', '/sessions/{sessionId}/self-assign', fn, jwtAuthorizer)` の3行追加で完結する（`post-session-join` と完全に同一パターン）。環境変数は `commonEnv` を渡すだけ（テーブル名の env 変数は `DYNAMODB_TABLE_NAME`、steering の `TABLE_NAME` 記述は実コードと不一致）。
- **項目4（404 vs 403）**: 方針は **二層構造**。「リソースの存在自体を隠す」場面（他チームのセッション閲覧など）は `denyResourceAccess()` = 404。一方 **join/assign 系は 403（`forbiddenError`）を使う既存の例外** が明確に存在する（`joinSession`/`assignSession` とも 403）。self-assign は join 系の仲間なので **403 を採用するのが既存方針と整合する**。

---

## 調査項目1: セッション → メディアファイルの逆引き経路

### 結論
逆引きに必要な getter は **すべて揃っており、追加は不要**。経路は2系統ある。

1. **最短・推奨**: `sessionId` から直接 MediaFile を引く `getBySessionId()` が既に実装・実運用されている。
2. **想定経路（ジョブ経由）**: `session.transcriptionJobId → TranscriptionJob.mediaFileId → MediaFile` も全 getter が揃うが、**ただし `SessionRecord` 型に `transcriptionJobId` が含まれていない**（DynamoDB には保存されているが型にマップされていない）ため、この経路を使うなら型/マッパーの拡張が必要。

### 根拠（ファイルパス:行番号と短い引用）

- MediaFile を sessionId で逆引きする既存 getter（Scan、`uploadedBy`/`teamId` を含む MediaFile を返す）:
  `backend/src/repositories/media-file-repository.ts:71` 付近
  ```ts
  export async function getBySessionId(sessionId: string): Promise<MediaFile | null> {
    const result = await docClient.send(new ScanCommand({
      FilterExpression: 'entityType = :entityType AND sessionId = :sessionId', …
  ```
  ※ docstring に「For high-volume usage, consider adding a GSI on sessionId」と明記（Scan である点に注意）。

- その利用例（サービス層で既に sessionId → MediaFile を取得している）:
  `backend/src/services/media-service.ts:48`
  ```ts
  export async function getMediaFileForSession(sessionId: string) {
    const mediaFile = await mediaFileRepository.getBySessionId(sessionId);
  ```

- MediaFile 型が `uploadedBy` と `teamId` を持つこと:
  `backend/src/repositories/media-file-repository.ts` の `mapItemToMediaFile`（末尾）に `uploadedBy`, `teamId` フィールドあり。型定義は `backend/src/types/media-file.ts`（`MediaFile`）。

- ジョブ経由経路の getter 群:
  - `transcriptionJobRepository.getById(jobId)` → `backend/src/repositories/transcription-job-repository.ts:46` 付近。返す `TranscriptionJob` は `mediaFileId`・`sessionId` を含む（`types/transcription-job.ts:17-29`）。
  - `mediaFileRepository.getById(mediaFileId)` → `backend/src/repositories/media-file-repository.ts:54` 付近。

- セッションがジョブ ID を保持する実態と型の不一致:
  - 保存: `backend/src/repositories/session-repository.ts` の `createSession()` で `transcriptionJobId: input.transcriptionJobId` を Item に書き込む。
  - 型: 同ファイル先頭の `interface SessionRecord { … }` には **`transcriptionJobId` フィールドが無い**。`mapItemToSessionRecord()` も `transcriptionJobId` をマップしていない。
  - 既存の読み出し例（型を介さず直接 Projection で読む回避策）:
    `backend/src/services/deletion-service.ts:377` の `getTranscriptionJobIdForSession()` が `ProjectionExpression: 'transcriptionJobId'` で生 Item から取り出している。

### 実装への示唆
- **self-assign の権限判定に MediaFile 逆引きは不要**。`joinSession` と同様 `session.assignedTeamId` + `isTeamMember(userId, assignedTeamId)` で完結する（自動生成時に `assignedTeamId = mediaFile.teamId` が既にセットされているため）。
- もし「uploadedBy 本人かどうか」など MediaFile 属性で分岐したい場合のみ、`getBySessionId(sessionId)`（最短）を使う。Scan である点のみ留意（セッション単位の単発呼び出しなら許容範囲）。
- ジョブ経由経路を使う必要が出た場合は、`SessionRecord` に `transcriptionJobId?: string` を追加し `mapItemToSessionRecord` にマップ行を足すのが最小修正（`deletion-service` の Projection 回避策を正規化する形）。**推測**: 現状これが型から漏れているのは意図的ではなく実装漏れの可能性が高い（保存はしているため）。

---

## 調査項目2: Reviewer 向けの join 候補表示 UI 導線

### 結論
join を呼ぶ **API クライアントとボタンUIは既に存在する**が、**「これから join できる候補」を Reviewer に見せる導線は実質的に機能していない**。理由は2点:

1. 一覧取得 `GET /sessions` が自動生成 PENDING セッションを拾わない（`assignedTeamId` 属性ではなく `TeamAssignment`/`ReviewAssignment` レコードだけを見る）。
2. join ボタンが `assignedUserId` 未設定時のみ表示だが、自動生成セッションは常にアップローダーが `assignedUserId` に入るため、他 Reviewer にはボタンが出ない。

`GET /sessions/assigned` は「自分が **既に参加している**（participant）」セッションを返すもので、「join 候補」ではない。

### 根拠（ファイルパス:行番号と短い引用）

- join の API クライアント（既存。`POST /sessions/{id}/join` を呼ぶ）:
  `frontend/src/services/session-api.ts` の `claimSession()`
  ```ts
  async claimSession(sessionId: string) {
    return this.client.post(`/sessions/${sessionId}/join`, {});
  }
  ```

- join ボタンUI（既存）とその表示条件（`!isClaimed` のときのみ）:
  `frontend/src/components/SessionAssignmentControls.tsx`
  ```ts
  const isClaimed = Boolean(session.assignedUserId);
  …
  {onClaim && !isClaimed && ( <button …>引き受ける</button> )}
  ```
  → 自動生成セッションは `assignedUserId = mediaFile.uploadedBy` が常に入る（`transcription-job-service.ts` → `createSessionForJob` → `createSession`）ため、`isClaimed === true` となりボタンが出ない。

- `GET /sessions/assigned` は「参加済み」を返す（候補ではない）:
  `backend/src/services/session-service.ts` `getAssignedSessions()` → `getSessionsByParticipantUserId(userId)`（participant レコード経由）。
  フロントの対応: `frontend/src/App.tsx` の `/assigned` ルートが `scope="assigned"` で `sessionApi.listAssignedSessions()` を呼ぶ（「自分の割り当てセッション」画面）。

- 一覧 `GET /sessions` が自動生成セッションを拾わない根拠:
  `backend/src/handlers/get-sessions.ts` は `getAccessibleSessionIds(user)` の結果だけを `getSessionsByIds` で取得する。
  `backend/src/services/access-control-service.ts` `getAccessibleSessionIds()` は **`TEAM#{teamId}` の `ASSIGNMENT#` レコード** と **`USER#{userId}` の `ASSIGNMENT#` レコード** のみ集約する。自動生成セッションが設定するのは `assignedTeamId` 属性＋GSI1（`TEAM#…` / `SESSION#…`）であって `TeamAssignment`（`ASSIGNMENT#`）レコードではない。両者は別物。
  → 対応する「チームの PENDING セッションを GSI1 で列挙する」関数 `session-repository.ts` の `getSessionsByTeamId(teamId)` は存在するが、Reviewer 向け一覧の経路からは呼ばれていない。

### 実装への示唆
C案を機能させるには、UI/サービスに **「join 候補一覧」経路の新設** が必要:
- バックエンド: 「自チームに `assignedTeamId` で割り当てられた PENDING セッションのうち、自分が未参加のもの」を返すエンドポイント（例 `GET /sessions/joinable`）。実装は `getSessionsByTeamId(teamId)`（GSI1 既存）＋ `isParticipant` フィルタで組める。self-assign API 自体とは別に、この候補一覧が無いと Reviewer は join 先を発見できない。
- フロント: 新 API クライアント関数＋候補一覧画面（または既存 `SessionListPage` に scope 追加）。
- `SessionAssignmentControls` のボタン表示条件 `!isClaimed` は C案と非整合。self-assign 用には「自チーム割り当て済み PENDING かつ自分が未参加」で表示する別条件が必要。
- **代替案（最小変更）**: self-assign を独立 API にせず、既存 `POST /sessions/{id}/join` の表示条件とサービス判定を見直す案もあり得るが、ユーザー要望の「C案（セルフ割り当てAPI）」に沿うなら専用エンドポイントを足す方が明示的。

---

## 調査項目3: API Gateway ルート定義と Lambda ロール（CDK）

### 結論
`infra/lib/stacks/api-stack.ts`（API レイヤー）に、**Lambda 定義 → 共通権限付与 → ルート追加** の3ステップの明快な雛形がある。`post-session-join` がそのまま self-assign の雛形になる。編集ファイルは **`infra/lib/stacks/api-stack.ts` の1ファイルのみ**。

### 根拠（ファイルパス:行番号と短い引用）

- 既存 join の Lambda 定義（`createLambda` ヘルパ）:
  `infra/lib/stacks/api-stack.ts:384`
  ```ts
  const postSessionJoinFn = this.createLambda('PostSessionJoin', {
    entry: handlersDir,
    description: 'POST /sessions/{sessionId}/join - Reviewer joins a shared session',
    environment: commonEnv,
  });
  this.grantCommonPermissions(postSessionJoinFn, props);
  ```

- 既存 join のルート追加:
  `infra/lib/stacks/api-stack.ts:1210`
  ```ts
  this.addRoute('POST', '/sessions/{sessionId}/join', postSessionJoinFn, jwtAuthorizer);
  ```

- `createLambda` の規約（ファイル名はクラス名の kebab-case、ハンドラ名は既定 `handler`）:
  `infra/lib/stacks/api-stack.ts:1313` 付近
  ```ts
  const kebabName = this.toPascalToKebab(name);
  const fileName = options.fileName ?? kebabName;   // 'PostSessionSelfAssign' → 'post-session-self-assign'
  entry: `${options.entry}/${fileName}.ts`,
  handler: options.exportedHandler ?? 'handler',
  functionName: `transcription-review-${kebabName}`,
  ```
  → ハンドラファイルは `backend/src/handlers/post-session-self-assign.ts`、エクスポートは `export async function handler` にすれば `fileName`/`exportedHandler` 上書き不要。

- 最小権限（個別IAMロール）の付与方法:
  `infra/lib/stacks/api-stack.ts:1342` `grantCommonPermissions()`
  ```ts
  fn.grantDynamoDbReadWrite(props.table.tableArn);
  fn.grantKmsAccess(props.kmsKey.keyArn);
  ```
  → DynamoDB 読み書き＋KMS。self-assign は DynamoDB の読み（session/team membership）＋書き（participant 追加）＋監査ログ書き込みのみなので、これで必要十分。L3 construct `LambdaFunction`（`infra/lib/constructs/` 配下）が Lambda ごとに個別ロールを生成している。

- 共通環境変数（テーブル名の実 env 変数名）:
  `infra/lib/stacks/api-stack.ts:72`
  ```ts
  const commonEnv = {
    DYNAMODB_TABLE_NAME: props.table.tableName,
    MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
    DATA_BUCKET_NAME: props.dataBucket.bucketName,
    EVENT_BUS_NAME: this.eventBus.eventBusName,
    COGNITO_USER_POOL_ID: props.userPool.userPoolId,
  };
  ```
  実行時に読む側: `backend/src/utils/dynamodb-client.ts` `TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'TranscriptionReviewApp'`。
  → **注意**: steering（tech.md）には env 変数名が `TABLE_NAME` と書かれているが、**実コードは `DYNAMODB_TABLE_NAME`**。self-assign ハンドラ/サービスは既存リポジトリの `docClient`/`TABLE_NAME` を再利用するため、追加の環境変数設定は不要（`commonEnv` を渡すだけ）。

### 実装への示唆
`api-stack.ts` に以下3点を追記（`post-session-join` の直後に並べるのが読みやすい）:
```ts
// 1. Lambda 定義（387行付近 postSessionJoinFn の下）
const postSessionSelfAssignFn = this.createLambda('PostSessionSelfAssign', {
  entry: handlersDir,
  description: 'POST /sessions/{sessionId}/self-assign - Reviewer self-assigns to a team session',
  environment: commonEnv,
});
this.grantCommonPermissions(postSessionSelfAssignFn, props);

// 2. ルート追加（1210行 join の下）
this.addRoute('POST', '/sessions/{sessionId}/self-assign', postSessionSelfAssignFn, jwtAuthorizer);
```
- ハンドラは `backend/src/handlers/post-session-self-assign.ts`（`export async function handler`）。`post-session-join.ts` を雛形にできる（steering の Handler テンプレ準拠）。
- `/sessions/{sessionId}/self-assign` は静的セグメント付きなので `/sessions/assigned` のような greedy 衝突の懸念はない（`{sessionId}` 配下のサブパス）。ルート登録順の特別対応は不要。
- CDK 検証: `cd infra && npm install && npx cdk diff --all`。CDK スナップショットテスト（`infra/test/`）があれば更新が必要になる可能性あり。

---

## 調査項目4: 存在隠蔽（404 vs 403）の既存方針

### 結論
方針は **二層**:
- **リソースの存在自体を隠す必要がある場面** → `denyResourceAccess()`（404）。主に「閲覧・アクセス可否」の文脈。
- **join / assign のような「操作」系** → `forbiddenError()`（403）を使う **明確な既存例外** がある。

self-assign は join と同種の操作であり、かつ対象セッションは「自チームに割り当てられたもの＝本来 Reviewer に見えてよい候補」なので、**403（`forbiddenError`）が既存方針と整合**する。

### 根拠（ファイルパス:行番号と短い引用）

- 404（存在隠蔽）の意図と実装:
  `backend/src/utils/auth-middleware.ts` `denyResourceAccess()`
  ```ts
  // Returns 404 to hide the existence of the resource.
  export function denyResourceAccess(): never {
    throw notFoundError('リソースが見つかりません。');
  }
  ```
  利用: `access-control-service.ts` `checkSessionAccess()`（他チームのセッション閲覧不可時）、`requireTeamAccess()`（他チーム操作時）など「存在を見せない」文脈。
  クラスコメントにも「When a user tries to access another team's resource, 404 is returned (not 403) to hide the existence of the resource.」と明記（`access-control-service.ts` 冒頭）。

- 403（操作拒否）を使う既存例外 — **join**:
  `backend/src/services/session-service.ts` `joinSession()`
  ```ts
  if (!session) { throw notFoundError('指定されたセッションが見つかりません。'); }   // 存在しない→404
  …
  if (!session.assignedTeamId) { throw forbiddenError('このセッションはチームに割り当てられていません。'); }
  const member = await isTeamMember(user.userId, session.assignedTeamId);
  if (!member) { throw forbiddenError('自チームに割り当てられたセッションのみ参加できます。'); }
  ```
  → セッションが存在すれば 403、存在しなければ 404、という使い分け。

- 403 を使う既存例外 — **assign**:
  `backend/src/services/session-service.ts` `assignSession()` は `requireRole(user, 'TEAM_LEADER')`（権限不足→403）＋スコープ外時 `forbiddenError('自分のチームにのみ割り当てできます。')` など複数の 403。
  `requireRole` の実装: `auth-middleware.ts` `requireRole()` → `forbiddenError(...)`（403）。

### 実装への示唆
self-assign の推奨エラー方針（既存 `joinSession` に揃える）:
- セッションが存在しない → `notFoundError`（404）。
- 対象が自チーム割り当てでない / 自分がそのチームの member でない → `forbiddenError`（403）。
- **補足（存在隠蔽の観点）**: 「自チームに割り当てられたセッション」は本来 Reviewer に見えてよい対象なので、403 を返しても追加の情報漏えいにはならない。逆に「全く無関係なチームのセッション ID を総当たり」された場合に 403 と 404 で存在が区別され得るが、既存 `joinSession` が同じ挙動であり、**既存方針との一貫性を優先して 403 を採用**するのが妥当。より厳格に隠蔽したい場合のみ「自チーム割り当て以外は一律 404」に倒す選択肢もある（ただし既存 join と不一致になる）。

---

## 実装時の推奨事項サマリ

- **逆引きは原則不要**: self-assign の判定は `joinSession` と同様 `session.assignedTeamId` + `isTeamMember()` で実装する。MediaFile 属性が必要なら `mediaFileRepository.getBySessionId(sessionId)`（既存・Scan）を使う。ジョブ経由経路を使う場合のみ `SessionRecord` に `transcriptionJobId` を追加（現状型から漏れている・保存はされている）。
- **サービス層にビジネスロジック**: `session-service.ts` に `selfAssignSession(user, sessionId)` を追加（steering の Handler→Service→Repository 準拠）。中身は実質 `joinSession` と同等だが、「自動生成セッションの uploader 以外の Reviewer が参加する」ユースケースを明示する関数として分離すると意図が明確。
- **候補表示UIが必須のギャップ**: self-assign API 単体では Reviewer が join 先を発見できない。`GET /sessions`（`getAccessibleSessionIds` 経由）は自動生成 PENDING を拾わないため、`getSessionsByTeamId(teamId)`（GSI1 既存）＋未参加フィルタで「join 候補一覧」エンドポイント＋フロント画面を併せて実装する。
- **`SessionAssignmentControls` の表示条件を見直す**: `!isClaimed`（`assignedUserId` 未設定）だと自動生成セッションでボタンが出ない。self-assign 用に「自チーム割り当て済み PENDING かつ自分が未参加」で表示する条件を追加する。
- **CDK は `api-stack.ts` の1ファイルに3行追加**: `createLambda('PostSessionSelfAssign', …)` + `grantCommonPermissions` + `addRoute('POST', '/sessions/{sessionId}/self-assign', …)`。ハンドラは `backend/src/handlers/post-session-self-assign.ts`（`export async function handler`）。環境変数は `commonEnv` のみで十分（テーブル名の env は `DYNAMODB_TABLE_NAME`。steering の `TABLE_NAME` 記述は実コードと不一致なので注意）。
- **エラー方針は 403 を採用**: 存在しないセッション→404、スコープ外（自チーム非割り当て/非メンバー）→403。既存 `joinSession`/`assignSession` と一貫。
- **監査ログ**: 既存 join/assign ハンドラは `recordAuditLog({ operationType: 'REVIEW_ASSIGNMENT_CHANGE', … })` を記録している。self-assign も書き込み操作なので同様に監査ログを記録する（product.md「全書き込み操作を記録」）。
- **冪等性**: `addParticipant()` は条件付き書き込みで冪等（再 join は no-op、reviewer count を二重計上しない）。self-assign も同じ `addParticipant` を使えば再実行安全。
- **テスト**: steering 上 join 系は property-based test 対象（「Consensus/…」系に準じ participant 追加の冪等性等）。`post-session-join.test.ts` / `session-service.test.ts` を雛形に、ユニット＋プロパティテストを co-located で追加。

### 注意（事実と不一致だった steering 記述）
- steering `tech.md` の DynamoDB テーブル名 env 変数 `TABLE_NAME` は、実コードでは `DYNAMODB_TABLE_NAME`（`backend/src/utils/dynamodb-client.ts`、`infra/.../api-stack.ts:72`）。実装時は実コード側に合わせること。
