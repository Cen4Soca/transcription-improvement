# 設計書: 完了セッションの読み取り専用化 と 進行中への差し戻し

対象機能:
- Feature 1 — 完了（COMPLETED）セッションの校閲画面を読み取り専用にし、バックエンドでも完了セッションへの変更リクエストを拒否する。
- Feature 2 — ADMIN / TEAM_LEADER がセッション一覧画面から COMPLETED セッションを IN_PROGRESS に差し戻す。

本設計は `.kiro/specs/transcription-review-app/requirements.md` の Requirement 2 項目 18–20、Requirement 5 項目 8–11 を満たす。

---

## 1. Requirements

### Summary

完了済みセッションは「確定済み（finalized）」の状態であり、校閲者による追加修正を受け付けてはならない。本機能では (1) 校閲画面を完了時に読み取り専用化し、(2) UI を迂回したリクエストに対してもバックエンドが変更を拒否し、(3) 品質が不十分な完了セッションを ADMIN / TEAM_LEADER が IN_PROGRESS に差し戻せるようにする。差し戻しは確定済みデータ（ConsensusResult・各 Segment の consensusStatus）を保持する（policy A）。

### Functional Requirements

- FR-1 (Req 2.18): COMPLETED セッションの校閲画面で、Segment テキストのインライン編集・話者ラベルの追加/編集/削除・ConsensusResult 確定済みテキストの編集・ConflictResolution 操作をすべて無効化する。
- FR-2 (Req 2.19): COMPLETED セッションでも修正後 Transcription のダウンロードは引き続き許可する（ダウンロードは完了セッションの主用途）。
- FR-3 (Req 2.20): COMPLETED セッションに対する Correction の作成・更新・削除、話者ラベルの変更、ConflictResolution 操作がリクエストされた場合、バックエンドは当該リクエストを拒否し、セッションが完了済みである旨の日本語エラーメッセージを返す。
- FR-4 (Req 5.8): ADMIN / TEAM_LEADER はセッション一覧画面で COMPLETED セッションに対し「進行中に戻す」操作を実行できる。TEAM_LEADER は自チームに割り当てられたセッションのみ、ADMIN は全セッションを操作できる。Reviewer にはこの操作を一切見せない。
- FR-5 (Req 5.9): 差し戻し時はステータスを IN_PROGRESS に更新し、確定済み ConsensusResult と各 Segment の consensusStatus は変更せず保持する（policy A）。
- FR-6 (Req 5.10): 差し戻し操作を AuditLog に記録する。
- FR-7 (Req 5.11): COMPLETED でないセッションに対する差し戻しリクエストは拒否し、エラーメッセージを返す。

### Non-Functional Requirements

- NFR-1 (アーキテクチャ): バックエンドは Handler → Service → Repository の厳格な層構成を守る。Handler は Repository / docClient を直接呼ばない。既存の `post-session-aggregate.ts` / `post-consensus-resolve.ts` の docClient 直呼びは pre-existing の違反であり、新規コードでは踏襲しない。
- NFR-2 (DRY): 完了セッション判定は単一の共有ガードに集約し、各ミューテーション系サービスから呼び出す。
- NFR-3 (i18n): バックエンドのエラーメッセージは英語でも日本語でもよいが本リポジトリの既存慣習（これらのサービスは日本語メッセージ）に合わせ日本語とする。フロントは Result/AppError を日本語に変換して表示する。
- NFR-4 (アクセシビリティ): 追加・変更する React コンポーネントは WCAG 2.1 AA 準拠。全コンポーネントテストで `vitest-axe` の `toHaveNoViolations()` を実行する。

### Acceptance Criteria

1. COMPLETED セッションの校閲画面を開くと、Segment のインライン編集 UI（クリックでの編集開始・確定/キャンセルボタン）が表示されず、既存の修正は読み取り専用で表示される。(Req 2.18)
2. COMPLETED セッションの校閲画面で、話者ラベルの編集ボタン・話者ラベル管理（追加/名前変更/削除）の操作が無効化される。(Req 2.18)
3. COMPLETED セッションの校閲画面でも、ダウンロード UI は表示・操作可能である。(Req 2.19)
4. COMPLETED セッションに対する `POST /sessions/{id}/corrections` は 400 を返し、`{ error: { code: 'VALIDATION_ERROR', message: 'このセッションは既に完了しているため編集できません。' } }` 形式のレスポンスになる。(Req 2.20)
5. COMPLETED セッションに対する `POST /sessions/{id}/speaker-labels`・`DELETE /sessions/{id}/speaker-labels/{label}`・`POST /consensus/{id}/resolve` が同じく拒否される。(Req 2.20)
6. ADMIN がセッション一覧の COMPLETED セッションで「進行中に戻す」を押すと、`POST /sessions/{id}/reopen` が呼ばれ、ステータスが IN_PROGRESS になる。(Req 5.8)
7. TEAM_LEADER は自チームの COMPLETED セッションのみ差し戻せ、他チームのセッションに対してはバックエンドが拒否する。(Req 5.8)
8. Reviewer にはセッション一覧で差し戻しボタンが一切表示されない。(Req 5.8)
9. 差し戻し後も、差し戻し前に確定していた ConsensusResult と各 Segment の consensusStatus は変更されていない。(Req 5.9)
10. 差し戻し操作により `SESSION_REOPENED` の AuditLog が 1 件記録される。(Req 5.10)
11. COMPLETED 以外（PENDING / IN_PROGRESS）のセッションに対する `POST /sessions/{id}/reopen` は拒否され、エラーメッセージが返る。(Req 5.11)

### Out of Scope

- 完了セッションのダウンロード無効化（禁止）。
- 差し戻し時の ConsensusResult / Segment consensusStatus のクリア（policy A: 保持）。
- `SessionListPage` の props に対する破壊的変更（`renderSessionActions` を使う）。
- 無関係な機能への変更、`components/` 配下のサブディレクトリ作成。
- AdminPage の `ConflictResolutionPanel`（校閲画面ではなく Admin 画面の UI。Feature 1 の読み取り専用化対象は「校閲画面」であり、`ConflictResolutionPanel` は `ReviewPage` から参照されていない。CONFLICT 解決の防御は後述のバックエンドガードで担保する）。

---

## 2. Design

### 2.1 概要

本機能は既存の構造・パターンに自然に収まる。バックendは「完了セッションのミューテーション拒否ガード」をサービス層の共有関数として追加し、既存の 4 つのミューテーションサービス経路に差し込む。差し戻しは新規ハンドラ `post-session-reopen.ts` と新規サービス関数 `reopenSession` で実装する。フロントは校閲画面にセッションステータスを伝搬して読み取り専用化し、セッション一覧には `SessionAggregateControls` と同型の新規コンポーネント `SessionReopenControls` を `renderSessionActions` 経由で差し込む。

技術スタック（確定・承認後は固定）: バックエンド TypeScript ESM Lambda（`.js` 拡張子付き相対 import、named export）、`@aws-sdk/lib-dynamodb`、既存 `error-handler` / `response-builder` / `auth-middleware`。フロント React 19 + TypeScript、既存 `ApiClient` / `Result<T, AppError>` パターン、TailwindCSS。インフラ AWS CDK（`api-stack.ts`）。テスト Vitest + React Testing Library + vitest-axe。

---

### 2.2 Feature 1 — バックエンド: 完了セッションのミューテーション拒否

#### 共有ガードの形と置き場所

新規ユーティリティ `backend/src/utils/session-guard.ts` に、完了済みセッションを拒否する共有ガードを置く。「サービス層 or utils のどちらに置くか」の選択肢があるが、本ガードは

- 複数ドメインサービス（correction / session / consensus）から横断的に呼ばれる cross-cutting な前提条件であること、
- `error-handler` にのみ依存し他サービスに依存しない純粋関数であること、

から `src/utils/` に置くのが最も凝集度が高く循環依存も生まない。`session-service.ts` に置くと `correction-service.ts` → `session-service.ts` の新規依存が増え方向が不自然になるため採用しない。

関数は 2 本提供する（既に取得済みのレコードを使い回せるよう overload 的に分ける）:

```ts
// backend/src/utils/session-guard.ts
import { validationError } from './error-handler.js';
import type { SessionRecord } from '../repositories/session-repository.js';

/**
 * Reject mutations against a finalized (COMPLETED) session.
 * Call with an already-loaded session record.
 * @throws validationError (400, VALIDATION_ERROR) when the session is COMPLETED.
 */
export function assertSessionEditable(session: SessionRecord): void {
  if (session.status === 'COMPLETED') {
    throw validationError('このセッションは既に完了しているため編集できません。');
  }
}
```

エラーファクトリの選択: `validationError`（400 / `VALIDATION_ERROR`）を採用する。理由は、同一のビジネス状態チェックである既存 `post-session-aggregate.ts` の「`session.status === 'COMPLETED'` のとき `validationError('このセッションは既に完了しています。')`」および `post-consensus-resolve.ts` の「CONFLICT 以外は `validationError`」と整合するため。`forbiddenError`（403）は権限不足を表す用途で既に使い分けられており、ここでは状態不整合なので 400 が既存慣習に合う。これにより acceptance criterion 4/5 のレスポンス形状（`code: 'VALIDATION_ERROR'`）が決まる。

#### ガードを差し込むサービス経路（確定）

対象は Req 2.20 が列挙する「Correction の作成・更新・削除」「話者ラベルの変更」「ConflictResolution 操作」。本リポジトリの実装では以下の 4 ハンドラ（＝サービス経路）が該当する。各ハンドラは `checkSessionAccess`（アクセス可否）を既に通しているが、完了判定は未実施。ガードはいずれも「サービス層でセッションを getSessionById した直後」に呼ぶ（Handler から直接呼ばない、NFR-1）。

| ハンドラ | サービス関数 | ガード挿入位置 |
|---|---|---|
| `post-corrections.ts` | `correction-service.ts` `createCorrection` | 先頭でセッションを読み込み `assertSessionEditable` を実行してから保存 |
| `post-speaker-label.ts` | `session-service.ts` `addSpeakerLabel` | 既存の `getSessionById` 直後に `assertSessionEditable(session)` |
| `delete-speaker-label.ts` | `session-service.ts` `deleteSpeakerLabel` | 既存の `getSessionById` 直後に `assertSessionEditable(session)` |
| `post-consensus-resolve.ts` | （現状 handler が docClient 直呼び） | 下記のとおりサービス化せず、ハンドラ内で `getSessionById` + `assertSessionEditable` を呼ぶ最小対応 |

注記（Correction の「更新・削除」について）: 本リポジトリに Correction 専用の UPDATE/DELETE エンドポイントは存在しない。テキストの差し戻し（revert）や上書きも `POST /sessions/{id}/corrections`（`createCorrection`）経由で新しい Correction を積む実装である（`ReviewPage`/`App.tsx` の `handleRevertCorrection` を参照）。したがって `createCorrection` にガードを入れれば Req 2.20 の「作成・更新・削除」すべてを完了セッションに対して拒否できる。

各サービスの具体的変更:

- `correction-service.ts` `createCorrection(sessionId, user, input)`:
  冒頭（タイムスタンプ生成前）に
  ```ts
  const session = await getSessionById(sessionId);
  if (!session) throw validationError('指定されたセッションが見つかりません。');
  assertSessionEditable(session);
  ```
  を追加する。`getSessionById` は `session-repository.ts` から import（既に `addParticipant` を同 repo から import 済み）。これはサービス層での Repository 呼び出しであり層構成に適合する。

- `session-service.ts` `addSpeakerLabel` / `deleteSpeakerLabel`:
  両関数は既に `const session = await getSessionById(sessionId)` を実行し `notFoundError` 判定している。その直後に `assertSessionEditable(session)` を 1 行追加する。

- `post-consensus-resolve.ts`:
  このハンドラは pre-existing に docClient を直呼びしている（NFR-1 の既存違反）。本タスクでこれを全面サービス化するのはスコープ外のリファクタになるため、最小かつ層を悪化させない対応として、ハンドラ内の docClient 直呼びは温存しつつ、完了判定だけはサービス層の `getSessionById`（repository を呼ぶのはサービスの役割だが、本ハンドラは既に repository 相当を直接触っているため、ここでは `session-repository.ts` の `getSessionById` を import して使う）を用いて `assertSessionEditable` を適用する。
  具体的には、既存の segment 取得（`getSegment`）の前に:
  ```ts
  const session = await getSessionById(sessionId);
  if (!session) throw notFoundError('指定されたセッションが見つかりません。');
  assertSessionEditable(session);
  ```
  を追加する。これは「新規コードで docClient 直呼びを増やさない」制約（新たな直呼びは追加しない。`getSessionById` という既存 repository 関数を使う）を満たす。
  代替案として post-consensus-resolve を完全にサービス化する案も検討したが、既存の広範な docClient ロジック移設は本機能の目的（完了拒否）に対して過大で、回帰リスクが高いため採用しない。

#### バックエンドのエラーハンドリング（操作別）

- 失敗条件: `session.status === 'COMPLETED'`。→ `assertSessionEditable` が `validationError`（400）を throw。回復不能（当該リクエストは拒否）。各ハンドラの `catch` は既存同様 `statusCode` を持つエラーをそのまま再 throw し `errorResponse` が整形。ログは既存の `internalError` フォールバック経路に乗らない（AppError は想定内なので追加ログ不要）。
- 失敗条件: セッション不存在。→ 既存どおり `notFoundError`／`validationError`（経路ごとの既存慣習に合わせる。`addSpeakerLabel`/`deleteSpeakerLabel` は `notFoundError`、`createCorrection` 新規チェックは `validationError`。これは `changeSessionStatus` が不存在時に `validationError` を使う既存慣習に合わせる）。
- バリデーション: 新規入力なし（既存の body バリデーションは不変）。ガードはセッション状態という既存データのみ参照。
- 不変条件の所有層: 「完了セッションは不変」という不変条件はサービス層（+ consensus-resolve はハンドラ内）が所有する。UI の無効化はあくまで利便性であり、権威はバックエンドにある。

---

### 2.3 Feature 2 — バックエンド: 差し戻し（COMPLETED → IN_PROGRESS）

#### 新規ハンドラ vs patch-session-status 拡張（確定）

**新規ハンドラ `POST /sessions/{sessionId}/reopen` を追加する**（`patch-session-status.ts` は拡張しない）。理由:

1. 権限モデルが異なる。`patch-session-status.ts` は `checkSessionAccess`（Reviewer でも自チーム/担当なら通る）で、完了マーク等を誰でも行える。一方 reopen は ADMIN / TEAM_LEADER 限定・TEAM_LEADER は自チームのみという `post-session-aggregate.ts` と同じ権限・スコープ検証が必要。既存 PATCH に分岐を増やすと権限ロジックが入り混じり読みづらい。
2. 状態遷移の制約。`session-service.ts` の `VALID_STATUS_TRANSITIONS` は `COMPLETED: []`（完了からは遷移不可）と定義されている。これはレビュアーの通常フローの不変条件であり、ここを緩めると `changeSessionStatus` 全体の意味が変わる。reopen は「管理者による例外的差し戻し」という別のユースケースなので、遷移表を変更せず別経路にするのが正しい。
3. 監査要件。reopen は専用の `SESSION_REOPENED` を記録する必要があり、`post-session-aggregate.ts` の `SESSION_MANUAL_AGGREGATED` 記録パターンを踏襲した専用ハンドラが素直。

ルート: `POST /sessions/{sessionId}/reopen`（`aggregate` と同じ `POST /sessions/{sessionId}/<verb>` 形）。

#### ハンドラ実装 `backend/src/handlers/post-session-reopen.ts`

`post-session-aggregate.ts` を参照パターンにする（ADMIN/TEAM_LEADER 権限 + team-membership + `recordAuditLog` + `isTeamMember` + `getSessionById`）。ただし NFR-1 を守り docClient 直呼びはせず、ビジネスロジックは新規サービス関数 `reopenSession` に委譲する。

```ts
/**
 * POST /sessions/{sessionId}/reopen
 *
 * Reopen a COMPLETED review session back to IN_PROGRESS.
 * - ADMIN may reopen any session; TEAM_LEADER only sessions in their own team.
 * - Preserves confirmed ConsensusResult and each Segment's consensusStatus (policy A).
 * - Rejects reopening a session that is not COMPLETED.
 * - Records a SESSION_REOPENED audit log.
 *
 * Response: { data: { sessionId, status } }
 */
export async function handler(event): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) throw validationError('sessionId パスパラメータが必要です。');

    const updated = await reopenSession(user, sessionId);

    await recordAuditLog({
      actorUserId: user.userId,
      actorRole: user.role,
      operationType: 'SESSION_REOPENED',
      resourceId: sessionId,
      resourceType: 'ReviewSession',
    });

    return successResponse({ data: { sessionId, status: updated.status } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
```

監査記録はハンドラ側に置く（`patch-session-status.ts` が `SESSION_COMPLETED` をハンドラで記録しているのと同じ配置）。権限/スコープ/状態検証はサービスが担う。

#### 新規サービス関数 `session-service.ts` `reopenSession`

`assignSession` と同じ権限・スコープ検証パターン（`requireRole` + `isAdmin` 分岐 + `isTeamMember` / チームスコープ）を使う。`post-session-aggregate.ts` のインライン検証と等価のロジックをサービスに置く。

```ts
/**
 * Reopen a COMPLETED session back to IN_PROGRESS.
 * Only ADMIN / TEAM_LEADER. TEAM_LEADER limited to their own team.
 * Preserves ConsensusResult and Segment consensusStatus (policy A — status flip only).
 *
 * @throws forbiddenError when caller lacks permission/scope
 * @throws notFoundError when the session does not exist
 * @throws validationError when the session is not COMPLETED
 */
export async function reopenSession(
  user: AuthUser,
  sessionId: string
): Promise<SessionRecord> {
  requireRole(user, 'TEAM_LEADER');

  const session = await getSessionById(sessionId);
  if (!session) throw notFoundError('指定されたセッションが見つかりません。');

  if (!isAdmin(user)) {
    if (!session.assignedTeamId) {
      throw forbiddenError('このセッションを操作する権限がありません。');
    }
    const member = await isTeamMember(user.userId, session.assignedTeamId);
    if (!member) {
      throw forbiddenError('自チームのセッションのみ操作できます。');
    }
  }

  if (session.status !== 'COMPLETED') {
    throw validationError('完了していないセッションは差し戻しできません。');
  }

  // policy A: flip status only. ConsensusResult / Segment consensusStatus は touch しない。
  return updateSessionStatus(sessionId, 'IN_PROGRESS');
}
```

ここで `updateSessionStatus`（既存 repository 関数）は `SESSION#{id}` / `METADATA` の `status` と `updatedAt` のみ更新する。CONSENSUS#* 項目や SEGMENT#* 項目には一切触れないため policy A（確定済みデータ保持）が自動的に満たされる（acceptance criterion 9）。`changeSessionStatus` は使わない（遷移表 `COMPLETED: []` に阻まれるため・権限検証も異なるため）。

#### 差し戻しのエラーハンドリング（操作別）

- 権限不足（Reviewer 等）: `requireRole` が `forbiddenError`（403）。回復不能。`errorResponse` が整形。
- 他チーム（TEAM_LEADER）: `forbiddenError`（403）。
- セッション不存在: `notFoundError`（404）。
- 非 COMPLETED（PENDING/IN_PROGRESS）: `validationError`（400、`'完了していないセッションは差し戻しできません。'`）。acceptance criterion 11。
- DynamoDB 書き込み失敗: `updateSessionStatus` が送出する SDK エラーはハンドラの `catch` に到達。`statusCode` を持たないため既存慣習に倣い `internalError('セッションの差し戻しに失敗しました。', ...)` でラップし 500 を返す（サービス関数内で try/catch するか、ハンドラ側でラップするかは `post-session-aggregate.ts` に合わせハンドラ側の内側 try/catch でラップする実装にできるが、ここでは `assignSession` と同様サービスは AppError のみ throw し、SDK エラーはハンドラの外側 catch → errorResponse が 500 相当で返す形で十分。ログは `errorResponse` 既存実装に委ねる）。
- 入力バリデーション: `reopen` はボディを取らない（path param `sessionId` のみ）。body は無視する。

#### 監査（AuditLog）

`audit-repository.ts` の `AuditOperationType` union に `'SESSION_REOPENED'` を追加する。`post-session-aggregate.ts` が `'SESSION_MANUAL_AGGREGATED'` を使うのと同じ方式。`audit-service.ts` は型を re-export しているだけなので変更不要。metadata は不要（resourceId=sessionId で十分、acceptance criterion 10）。

---

### 2.4 インフラ: ルート登録（`infra/lib/stacks/api-stack.ts`）

`post-session-aggregate` の登録を参照パターンに、Lambda 定義と addRoute を 1 つずつ追加する。`createLambda('PostSessionReopen')` は `toPascalToKebab` により handler ファイル `post-session-reopen.ts` を自動解決する（命名規約一致）。

Lambda 定義（`postSessionAggregateFn` の直後あたり）:
```ts
const postSessionReopenFn = this.createLambda('PostSessionReopen', {
  entry: handlersDir,
  description:
    'POST /sessions/{sessionId}/reopen - ADMIN/TEAM_LEADER reopen COMPLETED → IN_PROGRESS',
  environment: commonEnv,
});
this.grantCommonPermissions(postSessionReopenFn, props);
```

ルート登録（`aggregate` の addRoute の直後）:
```ts
this.addRoute('POST', '/sessions/{sessionId}/reopen', postSessionReopenFn, jwtAuthorizer);
```

`grantCommonPermissions` は DynamoDB 読み書き（セッション更新・監査書き込み・チーム membership 読み取り）を含む共通権限で、reopen が必要とする操作をすべてカバーする（aggregate と同系の権限要件）。Feature 1 のガードは既存ハンドラ内に閉じるため新規ルート・新規 Lambda は不要。

---

### 2.5 Feature 1 — フロントエンド: 校閲画面の読み取り専用化

#### ReviewPage がセッションステータスを得る方法（確定）

`ReviewPageWrapper`（`App.tsx`）は既に `apis.session.getSessionDetail(sessionId)` を呼び、`detailResult.value.data.session` を受け取っている（`SessionDetailResponse.data.session: ReviewSession`、`status` フィールドを含む）。**新たな fetch は不要**。現状 `session.name` と `speakerLabels` のみを state に取り出しているので、`session.status` も state に追加して `ReviewPage` に新規 prop `sessionStatus?: ReviewSessionStatus` として渡す。

- `ReviewPageWrapper` に `const [sessionStatus, setSessionStatus] = useState<ReviewSessionStatus | undefined>()` を追加。
- `detailResult.ok` のブロックで `setSessionStatus(detailResult.value.data.session.status)` を追加。
- `<ReviewPage ... sessionStatus={sessionStatus} />` を渡す。

prop 方式を採用し、`ReviewPage` 内で再 fetch しない。理由: 詳細はラッパーが既に取得済みで、二重取得・ローディング競合を避けられる。

#### ReviewPage 内の読み取り専用フラグ

`ReviewPageProps` に `sessionStatus?: ReviewSessionStatus` を追加（型は `../types/session` から import）。内部で:
```ts
const isReadOnly = sessionStatus === 'COMPLETED';
```
`ReviewPage` は既存の `editingEnabled = Boolean(onSaveCorrection)` という「編集系を有効化する単一スイッチ」を持つ。これを最小改修で活かす:
```ts
const editingEnabled = Boolean(onSaveCorrection) && !isReadOnly;
```
これにより、既に `editingEnabled` でガードされている以下がすべて自動的に無効化される（FR-1）:

- `TranscriptionEditor` に渡す `onStartEdit / onUpdateText / onConfirmEdit / onCancelEdit / onSpeakerChange`（`editingEnabled ? ... : undefined`）→ `SegmentEditor` 側はこれらが undefined だと編集開始・確定・話者編集ができない（`SegmentEditor` の `speakerEditable` は `Boolean(onSpeakerChange)` を条件に含むため話者ラベル編集も無効化される）。
- 「話者ラベル管理」ボタン（`editingEnabled && hasSpeakerLabels` で表示）→ 非表示になり、`SpeakerLabelManager`（追加/名前変更/削除）に到達できない。

加えて、`editingEnabled` に紐づかない編集的 UI を個別に閉じる:

- `onRevert`（修正前に戻す）: 現状 `TranscriptionEditor` へ `onRevert={onRevertCorrection ? handleRevert : undefined}`。読み取り専用時は無効化するため `onRevert={!isReadOnly && onRevertCorrection ? handleRevert : undefined}` に変更。
- 話者ラベル管理パネルの表示状態 `speakerManagerOpen`: ボタンが消えるため新規に開くことはないが、防御的に `isReadOnly` のときはパネルを描画しない（`{speakerManagerOpen && !isReadOnly && (...)}`）。

**ダウンロードは変更しない**（FR-2 / acceptance criterion 3）。`TranscriptionDownload` のレンダリング条件 `transcriptionApi && sessionId && sessionName` は `isReadOnly` に依存させない。むしろ完了時こそ主用途。

**修正候補（suggestion）**: `suggestionEnabled = Boolean(onFetchSuggestions)` は編集ではなく閲覧補助だが、候補を選択すると Correction を発行する（`handleSuggestionSelect` → `saveCorrection`）。完了セッションで候補からの確定を許すと矛盾するため、`suggestionEnabled` も読み取り専用時は無効化する: `const suggestionEnabled = Boolean(onFetchSuggestions) && !isReadOnly;`。これにより候補ボタン・ホバー候補も消える。

**読み取り専用の明示（UX / アクセシビリティ）**: ツールバーに完了時のバッジ/注記（例: `完了したセッションのため編集できません。`）を `role="status"` で表示する。色だけに依存しないテキスト表示とし、`SegmentEditor` の既存「未修正/修正済」ラベル表示はそのまま読み取り表示として機能する。

#### 子コンポーネントへの readOnly 伝搬の方針（確定）

既存コンポーネントは「編集系ハンドラ（onConfirm/onSpeakerChange/onStartEdit 等）が undefined なら編集できない」という設計になっているため、**新規に `readOnly` prop を各子に足す必要は原則ない**。`editingEnabled` / `suggestionEnabled` / `onRevert` を false/undefined にするだけで、`SegmentEditor`・`SpeakerLabelManager`・`SpeakerLabelEditor`・`InlineEditor`・`TranscriptionEditor`・`SegmentRow`・`SpeakerLabel` はすべて表示専用に落ちる。これは変更面を最小化し回帰リスクを下げる。

既存 prop の確認結果:
- `SegmentEditor`: 編集・話者・候補・revert すべてハンドラ有無で分岐 → 追加 prop 不要。
- `SpeakerLabelManager`: `onAddLabel`/`onDeleteLabel`/`onRenameConfirm` 有無で機能分岐。管理ボタン自体を隠すため到達不能 → 追加 prop 不要。
- `TranscriptionDownload`: 変更なし（有効のまま）。
- `ConflictResolutionPanel`: `ReviewPage` から参照されていない（AdminPage 専用）→ 校閲画面の読み取り専用化対象外。CONFLICT 解決の実行拒否はバックエンドガード（2.2）で担保。

`TranscriptionEditor` に関しては、現状 `editingEnabled` で主要ハンドラを束ねているので追加変更は上記の prop 配線のみ。将来の明示性のため `TranscriptionEditor`/`SegmentEditor` に任意の `readOnly?: boolean` を足す案もあるが、本設計では採用しない（既存のハンドラ有無分岐で十分に要件を満たし、サーフェスを増やさない）。

---

### 2.6 Feature 2 — フロントエンド: 差し戻しボタン

#### 新規サービス関数 `session-api.ts` `reopenSession`

`forceAggregateSession` と同じ `Result<..., AppError>` 返却の慣習に合わせる。

```ts
/**
 * 完了したセッションを進行中（IN_PROGRESS）に差し戻す（ADMIN / TEAM_LEADER）
 * POST /sessions/{sessionId}/reopen
 * ADMIN は全セッション、TEAM_LEADER は自チームのセッションのみ。
 * COMPLETED でない場合は 400、権限不足は 403。
 */
async reopenSession(
  sessionId: string
): Promise<Result<{ data: { sessionId: string; status: ReviewSessionStatus } }, AppError>> {
  return this.client.post<{ data: { sessionId: string; status: ReviewSessionStatus } }>(
    `/sessions/${sessionId}/reopen`,
    {}
  );
}
```

#### 型（`frontend/src/types/session.ts`）

差し戻しレスポンスは小さいため専用 interface を追加する:
```ts
/** 差し戻し（POST /sessions/{sessionId}/reopen）の結果 */
export interface ReopenSessionResult {
  sessionId: string;
  status: ReviewSessionStatus;
}
```
`reopenSession` の返り値を `Result<{ data: ReopenSessionResult }, AppError>` にする。フロントとバックは型を共有しない方針どおり、backend には別途（必要なら）定義する（本機能では handler がインラインで `{ sessionId, status }` を返すのみ）。

#### 新規コンポーネント `frontend/src/components/SessionReopenControls.tsx`

`SessionAggregateControls.tsx` を鏡写しにした新規フラットコンポーネント（サブディレクトリ禁止）。契約:

```ts
export interface SessionReopenControlsProps {
  session: ReviewSession;
  userRole: UserRole;
  /** 完了セッションを進行中へ差し戻す。成功時は結果を resolve、失敗時は日本語化済み Error を throw。 */
  onReopen: (sessionId: string) => Promise<ReopenSessionResult>;
}
```

振る舞い（`SessionAggregateControls` と同型）:
- `canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER'`。false（Reviewer / 不明）なら `return null`（acceptance criterion 8、FR-4）。
- ボタン「進行中に戻す」は `enabled` を `isCompleted = session.status === 'COMPLETED'` のときのみ有効（`disabled={!isCompleted || busy}`）。非 COMPLETED のときは補助テキスト「完了したセッションのみ差し戻せます。」を表示。
- 確認ステップ（差し戻しは影響が大きいので確認を挟む）: `showConfirm` トグル → 確認ボックス（`role="group"`、`aria-controls`/`aria-expanded` 配線は `SessionAggregateControls` と同一）→「実行する／キャンセル」。確認文言: 「このセッションを進行中に戻します。確定済みの結果は保持されます。実行してよろしいですか。」（policy A を明示）。
- 成功時: `result` を保持し `role="status"` で「進行中に戻しました。」を表示。失敗時: `role="alert"` でエラーメッセージ。
- 権限・スコープの最終検証はバックエンド。本コンポーネントは入口のみ。

#### App.tsx での配線（`renderSessionActions`）

`SessionListPageWrapper` に差し戻しハンドラを追加し、`renderSessionActions` 内で `canManage` のとき `SessionReopenControls` を描画する。`SessionListPage` の props は変更しない（`renderSessionActions` の既存拡張点のみ使用、Out of Scope 準拠）。

```ts
const handleReopen = useCallback(
  async (sessionId: string): Promise<ReopenSessionResult> => {
    const result = await sessionApi.reopenSession(sessionId);
    if (!result.ok) {
      throw new Error(describeReopenError(result.error));
    }
    await loadSessions(); // 成功後に一覧を再取得し IN_PROGRESS を反映
    return result.value.data;
  },
  [sessionApi, loadSessions]
);
```

`renderSessionActions` の `canManage && (...)` ブロックに、既存 `SessionAggregateControls` と並べて追加:
```tsx
{canManage && (
  <SessionReopenControls
    session={session}
    userRole={userRole}
    onReopen={handleReopen}
  />
)}
```
`handleReopen` を `renderSessionActions` の `useCallback` 依存配列に追加する。

#### エラーの日本語変換 `frontend/src/utils/aggregate-error.ts` の隣に `describeReopenError`

`describeAggregateError` と同じ方針（HTTP ステータス / code 先判定 → 日本語定型文）。新規ユーティリティは `frontend/src/utils/reopen-error.ts`（kebab-case、新規ファイル）に置く:
```ts
export function describeReopenError(error: AppError): string {
  const status = error.statusCode;
  const code = error.code;
  if (status === 403 || code === 'FORBIDDEN') {
    return 'このセッションを差し戻す権限がありません。';
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return 'セッションが見つかりません。';
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return '完了していないセッションは差し戻しできません。';
  }
  return '差し戻しに失敗しました。時間をおいて再度お試しください。';
}
```
（`describeAggregateError` と同居させず別ファイルにするのは、`aggregate-error.ts` の責務（集約エラー専用）を汚さないため。配置は `frontend/src/utils/` の既存慣習どおり。）

---

### 2.7 エッジケース

- 競合（別ユーザーが差し戻し中に完了→差し戻し）: `reopenSession` は毎回 `getSessionById` で最新状態を見て `status !== 'COMPLETED'` を弾くため、二重差し戻しは 2 回目が 400 になる。致命的ではない。
- 校閲中に別タブで完了にされたケース: フロントの `isReadOnly` は詳細取得時点のスナップショット。古い画面から編集を試みても、バックエンドの `assertSessionEditable` が最終防衛線として 400 を返す（UI を迂回したリクエストの拒否、FR-3）。この 400 は `handleSaveCorrection` が `result.ok=false` を返し、`ReviewPage` の `saveError`（「修正内容の保存に失敗しました。」）として表示される。
- `assignedTeamId` 未設定の COMPLETED セッションを TEAM_LEADER が差し戻す: `reopenSession` の `!session.assignedTeamId` 分岐で `forbiddenError`。ADMIN は通る。
- 空ボディ: reopen はボディ不使用のため影響なし。

---

### 2.8 不変条件と所有層

| 不変条件 | 所有層 | 理由 |
|---|---|---|
| 完了セッションは Correction/話者/CONFLICT 解決で変更不可 | バックエンド サービス層（+ consensus-resolve ハンドラ）経由の `assertSessionEditable` | UI 無効化は迂回可能。権威はサーバ。 |
| 差し戻しは ADMIN / 自チーム TEAM_LEADER のみ | `reopenSession`（サービス層）| aggregate と同じ権限モデルを単一箇所に。 |
| 差し戻しは COMPLETED からのみ | `reopenSession` | Req 5.11。 |
| 差し戻しは status のみ変更（ConsensusResult/Segment 保持） | `reopenSession` が `updateSessionStatus` だけ呼ぶ | policy A。CONSENSUS#*/SEGMENT#* に触れない設計で自然に保証。 |
| 差し戻しの監査記録 | ハンドラ `post-session-reopen.ts` | `patch-session-status` の `SESSION_COMPLETED` 記録と同じ配置。 |

---

## 3. テスト計画

### 3.1 バックエンド ユニットテスト（Vitest、`vi.mock` で AWS SDK / repository をモック）

共有ガード `backend/src/utils/session-guard.test.ts`:
- COMPLETED で `validationError`（code=VALIDATION_ERROR, statusCode=400, 日本語 message）を throw する。
- PENDING / IN_PROGRESS では何も throw しない。

`correction-service.test.ts`（既存に追記）:
- COMPLETED セッションで `createCorrection` が `assertSessionEditable` 由来の 400 を throw し、`saveCorrection` が呼ばれない（acceptance criterion 4）。
- IN_PROGRESS では従来どおり保存される（回帰）。

`session-service.test.ts`（既存に追記）:
- `addSpeakerLabel` / `deleteSpeakerLabel` が COMPLETED で 400（acceptance criterion 5）。
- `reopenSession`:
  - Reviewer → forbidden（403）。
  - TEAM_LEADER 自チーム COMPLETED → `updateSessionStatus(sessionId, 'IN_PROGRESS')` が呼ばれる（acceptance criterion 6/7）。
  - TEAM_LEADER 他チーム → forbidden（403, acceptance criterion 7）。
  - ADMIN 任意 COMPLETED → IN_PROGRESS（acceptance criterion 6）。
  - PENDING / IN_PROGRESS → validationError（400, acceptance criterion 11）。
  - セッション不存在 → notFound（404）。
  - policy A: `updateSessionStatus` のみ呼ばれ、consensus/segment を更新する repository 関数が呼ばれないことを assert（acceptance criterion 9）。

ハンドラ `post-session-reopen.test.ts`:
- 成功時 `SESSION_REOPENED` の `recordAuditLog` が 1 回呼ばれる（acceptance criterion 10）。
- `sessionId` 無しで 400。
- サービスが AppError を throw したら対応 HTTP で `errorResponse` される。

`post-consensus-resolve.test.ts`（既存に追記）:
- COMPLETED セッションで 400（acceptance criterion 5）。

### 3.2 バックエンド プロパティテスト（fast-check, `{ numRuns: 100 }`）

tech ステアリングの property-test 必須リストに Correction / Consensus が含まれるため、ガードの不変条件をプロパティ化する。
`backend/src/utils/session-guard.property.test.ts`:
```
describe('Feature: completed-session-readonly, Property 1: COMPLETED は常に編集不可', () => {
  /** **Validates: Requirements 2.20** 任意の非 COMPLETED は通過、COMPLETED は必ず 400。 */
```
- 任意のステータス arbitrary（PENDING/IN_PROGRESS/COMPLETED）とランダムなセッション属性に対し、COMPLETED のとき必ず throw・それ以外は throw しないことを検証。

### 3.3 フロントエンド ユニット / アクセシビリティテスト（Vitest + RTL + vitest-axe）

`SessionReopenControls.test.tsx`（`SessionAggregateControls.test.tsx` を鏡写し）:
- `toHaveNoViolations()`（ボタン + 展開した確認領域）（NFR-4）。
- Reviewer では何も描画しない（`container` 空、acceptance criterion 8）。
- ADMIN / TEAM_LEADER でボタン描画。
- 非 COMPLETED セッションでボタン disabled（補助テキスト表示）。
- 確認 → 実行で `onReopen(sessionId)` が呼ばれ、成功メッセージが出る（acceptance criterion 6）。
- `onReopen` が reject したらエラーメッセージ（`role="alert"`）表示。

`ReviewPage.test.tsx`（既存に追記）:
- `sessionStatus="COMPLETED"` のとき: 編集 UI（確定ボタン・話者ラベル管理ボタン・候補ボタン・修正前に戻す）が出ない。読み取り専用注記が `role="status"` で出る。`TranscriptionDownload` は描画される（acceptance criterion 1/2/3）。
- `sessionStatus="IN_PROGRESS"` のとき: 従来どおり編集 UI が出る（回帰）。
- `toHaveNoViolations()` を両状態で実行（NFR-4）。

`session-api.test.ts`（既存に追記）:
- `reopenSession` が `POST /sessions/{id}/reopen` を空ボディで呼ぶ。
- 失敗時 `result.ok === false` と AppError を返す。

`reopen-error.test.ts`:
- 403/404/400/その他 の各分岐が期待どおりの日本語を返す。

### 3.4 インフラテスト（`infra/test/`）

該当する既存 CDK スナップショット/アサーションテスト（api-stack 系）が存在すれば、`POST /sessions/{sessionId}/reopen` ルートと `PostSessionReopen` Lambda の存在をアサートする 1 ケースを追記する（既存の aggregate ルートのアサートに倣う）。スナップショット方式なら更新する。

### 3.5 テスト容易性メモ

- サービス関数（`reopenSession` / `assertSessionEditable`）は repository をモックすれば純粋にユニットtestできる（権限・状態分岐が全て関数内に閉じる）。
- 読み取り専用化はフロントの prop 分岐なので RTL で完結（統合不要）。
- UI 迂回拒否（FR-3）はバックエンド側の責務であり、サービス ユニットテストで直接検証できる（E2E 不要）。

---

## 4. 変更ファイル一覧

新規:
- `backend/src/utils/session-guard.ts`（+ `.test.ts` / `.property.test.ts`）
- `backend/src/handlers/post-session-reopen.ts`（+ `.test.ts`）
- `frontend/src/components/SessionReopenControls.tsx`（+ `.test.tsx`）
- `frontend/src/utils/reopen-error.ts`（+ `.test.ts`）

変更:
- `backend/src/services/correction-service.ts`（`createCorrection` にガード）
- `backend/src/services/session-service.ts`（`addSpeakerLabel`/`deleteSpeakerLabel` にガード、`reopenSession` 追加）
- `backend/src/handlers/post-consensus-resolve.ts`（完了ガード追加）
- `backend/src/repositories/audit-repository.ts`（`SESSION_REOPENED` を union に追加）
- `infra/lib/stacks/api-stack.ts`（`PostSessionReopen` Lambda + reopen ルート）
- `frontend/src/types/session.ts`（`ReopenSessionResult` 追加）
- `frontend/src/services/session-api.ts`（`reopenSession` 追加）
- `frontend/src/pages/ReviewPage.tsx`（`sessionStatus` prop + `isReadOnly` 配線）
- `frontend/src/App.tsx`（`ReviewPageWrapper` に status 伝搬、`SessionListPageWrapper` に `handleReopen` + `SessionReopenControls` 配線）
- 既存テスト追記: `correction-service.test.ts` / `session-service.test.ts` / `post-consensus-resolve.test.ts` / `ReviewPage.test.tsx` / `session-api.test.ts`、必要に応じ `infra/test` の api-stack テスト。
