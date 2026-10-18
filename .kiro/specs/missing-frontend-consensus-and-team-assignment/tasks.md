# Implementation Plan

本タスクリストは探索的バグ修正ワークフロー（Explore → Preserve → Implement → Validate）に従う。各実装タスクは design.md の「Fix Implementation」セクション（変更 1〜9）と「Correctness Properties」（Property 1 / Property 2）、bugfix.md の要件番号（2.1〜2.8, 3.1〜3.5）を参照する。

テストは全て frontend で Vitest + React Testing Library + fast-check + vitest-axe を用い、`ApiClient` は `vi.mock()` でモックする（バックエンド AWS SDK は直叩きしない）。プロパティベーステストは `{ numRuns: 100 }` を既定とする。

---

- [x] 1. バグ条件の探索テストを作成する（修正前に実行）
  - **Property 1: Bug Condition** - 欠落フロント機能がバックエンドを駆動しない（反例の顕在化）
  - **CRITICAL**: このテストは未修正コードで FAIL すること。失敗がバグの存在（コードパス不在・空実装・空固定）を確認する
  - **DO NOT attempt to fix the test or the code when it fails** — 失敗は想定どおりの正しい結果
  - **NOTE**: このテストは期待挙動を符号化しており、修正後（タスク 3.2）に PASS させることで修正を検証する
  - **GOAL**: バグ条件に該当する操作が対応バックエンドルートを駆動しないことを反例として示す
  - **Scoped PBT Approach**: 決定的バグのため、プロパティを具体的な失敗ケースにスコープして再現性を担保する（例: 任意の `teamId`/`sessionId` に対して `assignSession` 呼び出しがモック API を 0 回しか呼ばない）
  - テスト対象（design.md「Exploratory Bug Condition Checking」の Test Cases に対応）:
    - Team 割り当て未発火: 未修正 `useAdmin.assignSession('t1','s1')` を呼んでも `AdminApi.assignSession` スパイが呼ばれない（空実装 `// TODO`）
    - Team 解除未発火: 未修正 `useAdmin.unassignSession` が `AdminApi.unassignSession`（DELETE）を呼ばない
    - 割り当て候補空: `useAdmin` の `sessions`/`teamAssignments` が常に空配列で、`TeamManagement` が「割り当て可能なセッションがありません」を表示する
    - Consensus 不在（エッジ）: `/consensus/{sessionId}` ルートと `consensus-api.ts` が存在せず画面に到達できない（`frontend/src/services/consensus-api.ts` が無い、`App.tsx` に当該ルートが無いことをアサート）
  - テストのアサーションは design.md の Expected Behavior（正しいルート・契約での呼び出し）に一致させる
  - **EXPECTED OUTCOME**: テストが FAIL する（バグの存在を証明する正しい結果）
  - 発見した反例を記録する（例: 「`AdminApi.assignSession` の呼び出し回数が 0」「候補/割り当てリストが空のまま」「`createdBy`→`assignedBy` マッピング欠落」）
  - テストを書き・実行し・失敗を記録した時点でタスク完了とする
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7_

- [x] 2. 保全プロパティテストを作成する（修正前に実行）
  - **Property 2: Preservation** - 既存フロント機能の挙動不変
  - **IMPORTANT**: 観測優先（observation-first）方法論に従う
  - 未修正コードでバグ条件に該当しない既存操作の挙動（呼び出しルート・ボディ・state 遷移）を観測し記録する:
    - ユーザー管理: `createUser`/`disableUser`/`editUser` が `/admin/users` 系を従来どおり呼び state を更新する
    - チーム CRUD / メンバー: `createTeam`/`editTeam`/`deleteTeam`/`addMember`/`removeMember` が `/admin/teams`・`/admin/teams/{teamId}/members` 系を従来どおり呼ぶ
    - 既存ルート: `/admin`・`/ranking`・`/sessions/:sessionId` 等が `MemoryRouter` で従来どおりレンダリングされる
  - 観測した挙動を符号化するプロパティベーステスト（fast-check, `{ numRuns: 100 }`）を作成する:
    - ランダムな既存操作列に対し、修正前後で呼び出しルート・ボディ・state 遷移が一致すること（Preservation）
    - fast-check は多数入力を自動生成し、手動では見落とす端ケースを捕捉する
  - **EXPECTED OUTCOME**: テストが未修正コードで PASS する（保全すべきベースライン挙動を確認）
  - テストを書き・実行し・未修正コードで PASS することを確認した時点でタスク完了とする
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. バグ修正の実装（Consensus フロント欠落 + チーム割り当て API 連携）

  - [x] 3.1 Consensus フロント型とサービス層を新規追加する（バグ1）
    - `frontend/src/types/consensus.ts` を新規作成（design.md 変更2）: `ConsensusStatus`（`UNDECIDED`/`CONFIRMED`/`CONFLICT`）・`ReviewerAnswer`（`text`/`count`/`userIds`）・`ConsensusSegment`。バックエンド `get-consensus.ts` の型に一致させる（名前付きエクスポート、`import type` 使用）
    - `frontend/src/services/consensus-api.ts` を新規作成（design.md 変更1）: `ConsensusApi` クラス（`ApiClient` を受け取る）。`getConsensusSegments(sessionId)` → `GET /consensus/{sessionId}/segments`、`resolveConsensus(sessionId, { segmentId, selectedText })` → `POST /consensus/{sessionId}/resolve`。`Result<T, AppError>` を返す。`ranking-api.ts`/`session-api.ts` と同一パターン、レスポンス型を同ファイルで定義
    - _Bug_Condition: isBugCondition(X) where X.feature ∈ {CONSENSUS_VIEW, CONSENSUS_RESOLVE}_
    - _Expected_Behavior: CONSENSUS_VIEW → GET /consensus/{sessionId}/segments; CONSENSUS_RESOLVE → POST /consensus/{sessionId}/resolve body { segmentId, selectedText }（Property 1）_
    - _Preservation: 既存 service を変更しない。新規追加は既存コードパスに割り込まない（Property 2）_
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Consensus 画面とコンポーネントを新規追加する（バグ1）
    - `frontend/src/pages/ConsensusPage.tsx` を新規作成（design.md 変更3）: props 駆動のプレゼンテーション層（`AdminPage`/`RankingPage` と同様データ取得しない）。セグメント一覧に状態バッジ（未確定/確定/競合解決待ち）を日本語表示、CONFIRMED は `consensusText` 表示、CONFLICT は `reviewerAnswers`（各 `text` と `count`「N名」）を提示し「この回答で確定」で `onResolve(segmentId, selectedText)` を呼ぶ。`isLoading`/`error`（日本語）/空状態を表示。アクセシビリティ（`role`/`aria-label`/`focus:ring`）
    - 一覧描画が肥大化する場合のみ `frontend/src/components/ConsensusSegmentList.tsx` に切り出す（design.md 変更4、`components/` 直下フラット、任意）
    - props: `ConsensusPageProps`（`sessionId?`, `segments`, `isLoading?`, `error?`, `resolveError?`, `onResolve?`）
    - _Bug_Condition: isBugCondition(X) where X.feature ∈ {CONSENSUS_VIEW, CONSENSUS_RESOLVE}_
    - _Expected_Behavior: 各セグメントの consensusStatus・consensusText・CONFLICT の reviewerAnswers を表示、CONFLICT 解決で CONFIRMED 反映（Property 1）_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 App.tsx に Consensus ルートと ReviewPage 導線を配線する（バグ1）
    - `frontend/src/App.tsx` に `ConsensusPageWrapper` を追加（design.md 変更5）: `useParams<{ sessionId }>()` で sessionId 取得、`useMemo` で `new ConsensusApi(new ApiClient(...))`、`useEffect` で `getConsensusSegments` 取得し `Result` 捕捉（失敗時は日本語メッセージを `error`/`resolveError` に設定）。ADMIN ガード（`user.role !== 'ADMIN'` → `<Navigate to="/" replace />`）を `AdminPageWrapper` と同一に適用。`onResolve` は `resolveConsensus` を呼び成功で該当セグメントをローカル CONFIRMED 更新、`VALIDATION_ERROR`/編集不可は捕捉し日本語表示
    - `<Routes>` に `<Route path="/consensus/:sessionId" ... />` を追加（既存ルートは不変）
    - ReviewPage ヘッダに ADMIN 限定の Consensus 導線を追加（design.md 変更6）: `userRole === 'ADMIN'` のときだけ `/consensus/{sessionId}` へのリンクを表示。非 ADMIN 挙動は不変
    - _Bug_Condition: isBugCondition(X) where X.feature ∈ {CONSENSUS_VIEW, CONSENSUS_RESOLVE}_
    - _Expected_Behavior: 非 ADMIN は提示しない/FORBIDDEN を捕捉して日本語通知（Property 1）_
    - _Preservation: 既存ルート（/, /assigned, /joinable, /sessions/:sessionId, /upload, /language-models, /admin, /ranking, /profile）と ReviewPage の非 ADMIN 挙動は不変（Property 2）_
    - _Requirements: 2.1, 2.4_

  - [x] 3.4 admin-api.ts に assignments メソッドを追加する（バグ2）
    - `frontend/src/services/admin-api.ts` に追記（design.md 変更7）: `RawTeamAssignment`（`createdBy`/`createdAt`）→ `TeamAssignment`（`assignedBy`/`assignedAt`）の `mapAssignment` をサービス層に実装
    - `getTeamAssignments(teamId)` → `GET /admin/teams/{teamId}/assignments`（成功時 `data` を `mapAssignment` でマッピング）
    - `assignSession(teamId, sessionId)` → `POST /admin/teams/{teamId}/assignments` body `{ sessionId }`（201, 単一 Record を `mapAssignment`）
    - `unassignSession(teamId, sessionId)` → `DELETE /admin/teams/{teamId}/assignments/{sessionId}`（`{ deleted: true }`）
    - 全メソッド `Result<T, AppError>` を返す。割り当て候補セッションは既存 `SessionApi.listSessions()` を利用（AdminApi に重複メソッドを足さない）
    - _Bug_Condition: isBugCondition(X) where X.feature ∈ {TEAM_ASSIGN_SESSION, TEAM_UNASSIGN_SESSION, TEAM_ASSIGNMENT_VIEW}_
    - _Expected_Behavior: 正しいルート・契約で呼び出し、createdBy/createdAt → assignedBy/assignedAt マッピング（Property 1）_
    - _Preservation: admin-api.ts の既存メソッド（users/teams/members/ip/audit）は不変（Property 2）_
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 3.5 useAdmin.ts の配線を実装する（バグ2・4点限定）
    - `frontend/src/hooks/useAdmin.ts` を変更（design.md 変更8、変更は4点に限定し他 state・アクション・初期ロード順序は不変）:
      - `const [sessions, setSessions] = useState<ReviewSession[]>([])` に setter を付与
      - `const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([])` に setter を付与
      - 初期ロード（`loadAll`）に、割り当て候補セッション取得（`SessionApi.listSessions()`）とロード済み各チームの `getTeamAssignments(teamId)` を追加し `setSessions`/`setTeamAssignments` を満たす。既存 users/teams/ipAllowlist/auditLogs の `Promise.all` 順序・エラーサーフェスは維持
      - `assignSession`/`unassignSession` を実装: 成功時 `setTeamAssignments` に追加/除去、失敗時 `setError`（Result で捕捉し日本語表示）。`UseAdminReturn` の既存シグネチャは維持し `TeamManagement`/`AdminPage`/`App.tsx` の props 配線（`onAssignSession`/`onUnassignSession`）をそのまま機能させる
    - _Bug_Condition: isBugCondition(X) where X.feature ∈ {TEAM_ASSIGN_SESSION, TEAM_UNASSIGN_SESSION, TEAM_ASSIGNMENT_VIEW}_
    - _Expected_Behavior: 成功時 teamAssignments 追加/除去、失敗時 error 設定、初期ロードで sessions/teamAssignments を満たす（Property 1）_
    - _Preservation: useAdmin の他 state・既存アクション・初期ロード順序は不変（Property 2）_
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 3.6 api-stack.ts に GET assignments ルートを追加する（バグ2・判断1）
    - `infra/lib/stacks/api-stack.ts` に追記（design.md 変更9）: 既存 POST/DELETE assignments Lambda と同じ `createLambda`（`fileName: 'team-assignments'`, `exportedHandler: 'listTeamAssignmentsHandler'`）を1つ足し、`this.addRoute('GET', '/admin/teams/{teamId}/assignments', getTeamAssignmentsFn, jwtAuthorizer)` を追加
    - 既存ルート・Lambda・権限・レイヤリング（Foundation → API → CDN → Monitoring）は不変。CDK スナップショットテストの差分は本追加分のみを許容
    - _Bug_Condition: isBugCondition(X) where X.feature = TEAM_ASSIGNMENT_VIEW（listTeamAssignmentsHandler 到達不能）_
    - _Expected_Behavior: GET /admin/teams/{teamId}/assignments が到達可能になり現在の割り当てを取得できる（Property 1）_
    - _Preservation: 既存ルート・Lambda・権限は不変（additive, Property 2）_
    - _Requirements: 2.7, 3.5_

  - [x] 3.7 ユニットテストを作成する（各 service / hook / component）
    - `consensus-api.test.ts`: `getConsensusSegments`/`resolveConsensus` が正しいパス・メソッド・ボディで `ApiClient` を呼び `Result` を返す（成功 / `VALIDATION_ERROR` / `FORBIDDEN` / 編集不可）。co-located、`vi.mock()`
    - `admin-api.test.ts`（追記）: `getTeamAssignments`/`assignSession`/`unassignSession` が正しい契約で呼び、`createdBy`/`createdAt` → `assignedBy`/`assignedAt` マッピングが正しいこと
    - `useAdmin.test.ts`: `assignSession`/`unassignSession` 成功時の `teamAssignments` 追加・除去、失敗時の `error` 設定、初期ロードで `sessions`/`teamAssignments` が満たされること、既存アクションが不変であること
    - `ConsensusPage.test.tsx` / `TeamManagement.test.tsx`（追記）: 状態バッジ・CONFLICT 回答表示・割り当て UI の描画と操作、エラー時の日本語表示。各テストで vitest-axe `expect(container).toHaveNoViolations()`
    - `App.test.tsx`（または対応するルーティングテスト）: `/consensus/:sessionId` の ADMIN ガード（非 ADMIN は `/` へリダイレクト）、`MemoryRouter` でラップ
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.8 プロパティベーステストを作成する（fast-check, numRuns: 100）
    - **Consensus 解決プロパティ**: `consensus-api.property.test.ts`（co-located）。ランダムな `ConsensusSegment[]`（状態・`reviewerAnswers` を生成）に対し、CONFLICT セグメントの解決操作が常に `{ segmentId, selectedText }` を正しいパスへ送り、成功で当該セグメントのみ CONFIRMED になる。CONFLICT 以外への解決はエラーを `Result` で捕捉し UI を壊さない。describe は `Feature: missing-frontend-consensus-and-team-assignment, Property N: ...` 形式、docstring に Validates 要件を記載
    - **割り当て/解除プロパティ**: `admin-api.property.test.ts` または `useAdmin.property.test.ts`。ランダムな `teamId`/`sessionId`/既存割り当て集合に対し、割り当て→解除の往復で `teamAssignments` が整合（重複追加しない、解除で確実に除去、他チームの割り当てに影響しない）し、`createdBy`→`assignedBy` マッピングが保存される
    - **保全プロパティ**: ランダムな既存操作列に対し、修正前後で呼び出しルート・ボディ・state 遷移が一致する（Preservation）
    - 全プロパティ `{ numRuns: 100 }`
    - _Requirements: 2.2, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.9 バグ条件探索テストが PASS することを検証する
    - **Property 1: Expected Behavior** - 欠落フロント機能がバックエンドを正しく駆動する
    - **IMPORTANT**: タスク 1 と同じテストを再実行する — 新しいテストを書かない
    - タスク 1 のテストは期待挙動を符号化しており、PASS することで期待挙動の充足を確認する
    - タスク 1 のバグ条件探索テストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認）
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7（Property 1 の Expected Behavior）_

  - [x] 3.10 保全テストが引き続き PASS することを検証する
    - **Property 2: Preservation** - 既存フロント機能の挙動不変
    - **IMPORTANT**: タスク 2 と同じテストを再実行する — 新しいテストを書かない
    - タスク 2 の保全プロパティテストを実行する
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションが無いことを確認）
    - 修正後も全テストが PASS することを確認する（既存機能のリグレッションなし）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. チェックポイント - 全テストが PASS することを確認する
  - `cd frontend && npx vitest --run` でユニット・プロパティ・アクセシビリティテストを実行
  - フロント統合（RTL）フローを確認: `/consensus/:sessionId` を ADMIN で開く → 一覧表示 → CONFLICT 解決 → CONFIRMED 反映 / AdminPage「チーム管理」タブで候補表示 → 割り当て → 反映 → 解除 → 除去
  - CDK（`cd infra && npx vitest --run` または対応するスナップショットテスト）で GET assignments ルート追加の差分が本追加分のみ（既存ルート不変）であることを確認
  - 全テストが PASS することを確認し、疑問が生じた場合はユーザーに確認する
