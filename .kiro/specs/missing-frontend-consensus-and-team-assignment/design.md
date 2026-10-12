# Missing Frontend: Consensus & Team Assignment Bugfix Design

## Overview

バックエンドに実装・ルート登録・デプロイ済みの2つの機能が、フロントエンドのコードパス欠落のためユーザーから利用できない。本バグ修正は、既存のバックエンド I/O 契約（レスポンス形状・権限・エラーコード）にフロントを合わせ、欠落している「API サービス層・カスタムフックの配線・画面/コンポーネント接続・ルーティング」を補填する。既存の正常機能（ユーザー管理・チーム CRUD・メンバー管理・IP 許可リスト・監査ログ・ランキング・セッション/校閲フロー）の挙動は一切変更しない。

対象の欠落機能は2つ:

- **バグ1 — Consensus 機能のフロント完全欠落。** バックエンド `GET /consensus/{sessionId}/segments`（`get-consensus.ts`, ADMIN 専用）と `POST /consensus/{sessionId}/resolve`（`post-consensus-resolve.ts`, ADMIN 専用）は実装・ルート登録済み（`api-stack.ts` L1277-1278）。フロントには対応する `consensus-api.ts`・表示/操作画面・ルートが存在しない。
- **バグ2 — チームへのセッション割り当ての API 連携未実装。** バックエンド `POST /admin/teams/{teamId}/assignments`（`createTeamAssignmentHandler`）と `DELETE /admin/teams/{teamId}/assignments/{sessionId}`（`deleteTeamAssignmentHandler`）は実装・ルート登録済み（`api-stack.ts` L1301-1302）。UI コンポーネント `TeamManagement.tsx` は存在するが、`admin-api.ts` に assignments メソッドが無く、`useAdmin.ts` の `assignSession`/`unassignSession` は空実装（`// TODO`）、`sessions`/`teamAssignments` は空配列で固定（state setter が未配線）。

修正アプローチは「薄い層の追加・配線のみ」。コンポーネントの既存インターフェース（`TeamManagement` の props、`AssignSessionSelect`/`AssignmentリストUI`）はすでに割り当て機能を想定した形になっているため、不足している配管（service → hook → props）を埋め、Consensus については既存パターン（`services/{domain}-api.ts` + `pages/{PageName}.tsx` + `App.tsx` の Wrapper/Route）に厳密に沿って新規追加する。

### 設計上の2つの判断（要件フェーズから持ち越した技術的事実への対応）

1. **未登録 GET ルート `GET /admin/teams/{teamId}/assignments` の扱い（決定: ルートを追加する）。**
   `listTeamAssignmentsHandler` はハンドラとして実装済みだが `api-stack.ts` に `addRoute` が無く到達不能。要件 2.7（割り当てセクションを開いたとき、現在のチーム割り当て一覧を取得して表示する）を満たすには現在の割り当てを取得する手段が必要。
   - 選択肢A（採用）: `api-stack.ts` に `this.addRoute('GET', '/admin/teams/{teamId}/assignments', ...)` を追加し、既存ハンドラを公開する。
   - 選択肢B（不採用）: GET を追加せず、`POST` の成功レスポンスのみでローカル状態を積み上げる。初回ロード時に既存の割り当てが取得できず、要件 2.7 を満たせない。
   - **判断根拠**: 選択肢Aは「既存ハンドラの公開（additive）」であり、既存エンドポイントのリクエスト/レスポンス契約・権限・挙動を一切変更しない。bugfix.md の非変更方針（3.5）は「既存バックエンド契約を変更しない。必要な場合の未登録 GET ルート追加は design.md で判断する」と明示的にこの判断を委ねており、未登録ルートの追加は契約の変更ではなく、実装済み機能の到達可能化にあたる。したがって選択肢Aを採用する。これは **Preservation（Property 2）の対象外**（既存の到達可能なルートの挙動は不変）であり、新たに1本のルートを足すだけで、同ハンドラのサービス層（`listAssignments` → `requireTeamAccess`）の権限ロジックをそのまま利用できる。

2. **Consensus 画面の配置とルーティング（決定: 新規ページ `ConsensusPage` + 専用ルート `/consensus/:sessionId`、ADMIN ガード）。**
   - 選択肢A（採用）: 新規 `pages/ConsensusPage.tsx` と `App.tsx` の `ConsensusPageWrapper` + `<Route path="/consensus/:sessionId" />`。`AdminPageWrapper` と同じルートガード（`user.role !== 'ADMIN'` なら `<Navigate to="/" replace />`）を適用。校閲画面（ReviewPage）ヘッダに ADMIN 向けの導線（`/consensus/{sessionId}` へのリンク）を1つ足す。
   - 選択肢B（不採用）: AdminPage のタブに統合。AdminPage は session 非依存の全体設定画面で、Consensus は特定 `sessionId` に紐づくため、タブ内で sessionId を選ばせる UI が別途必要になり AdminPage の責務が肥大化する。
   - 選択肢C（不採用）: ReviewPage に埋め込み。ReviewPage は Reviewer 共通画面であり ADMIN 専用機能を混在させると権限境界が曖昧になる。
   - **判断根拠**: 選択肢Aは既存の「1 ルート = 1 Wrapper = 1 Page」パターン（`App.tsx` の `AdminPageWrapper`/`RankingPageWrapper` 等）に最も忠実で、ADMIN ガードを既存同様に適用でき、sessionId を URL パラメータから自然に受け取れる（`useParams`、ReviewPageWrapper と同じ）。react-router-dom v7 の既存 `<Routes>/<Route>` 構成にルートを1本追加するだけで済む。導線は、ADMIN が特定セッションの校閲画面から Consensus を確認する動線が自然なため、ReviewPage ヘッダに ADMIN 限定リンクを置く（Navigation グローバルメニューは sessionId を持たないため不適）。

## Glossary

- **Bug_Condition (C)**: バグが発動する入力。ユーザーが Consensus 閲覧/解決、またはチーム割り当て取得/割り当て/解除を利用しようとする操作（バックエンド API は到達可能だがフロントにコードパスが無い）。
- **Property (P)**: バグ条件に該当する操作に対する期待挙動。フロントが正しいルート・契約でバックエンドを呼び出し、成功時はレスポンスを UI に反映、失敗時は `Result` 型で捕捉して日本語表示（no crash）する。
- **Preservation**: バグ条件に該当しない既存機能（ユーザー管理・チーム CRUD・メンバー管理・IP 許可リスト・監査ログ・ランキング・セッション/校閲フロー）の挙動が修正前後で不変であること（F = F'）。
- **ConsensusApi**: 新規 `frontend/src/services/consensus-api.ts`。`GET /consensus/{sessionId}/segments` と `POST /consensus/{sessionId}/resolve` を `ApiClient` 経由で呼ぶ薄いサービス。
- **ConsensusSegment**: バックエンド `get-consensus.ts` が返す1セグメント。`consensusStatus`（`UNDECIDED`/`CONFIRMED`/`CONFLICT`）・`consensusText?`・CONFLICT のみ `reviewerAnswers[]`（`text`/`count`/`userIds`）を持つ。
- **TeamAssignment（フロント型）**: `frontend/src/types/team.ts` の `{ teamId, sessionId, assignedBy, assignedAt }`。
- **TeamAssignmentRecord（バックエンド型）**: `team-repository.ts` の `{ teamId, sessionId, createdBy, createdAt }`。フィールド名が `assignedBy`/`assignedAt` ではなく `createdBy`/`createdAt`。**サービス層でのマッピングが必要**。
- **useAdmin**: `frontend/src/hooks/useAdmin.ts`。AdminApi を通じて管理画面のデータ取得・操作を集約するフック。`sessions`/`teamAssignments` が空固定、`assignSession`/`unassignSession` が空実装。

## Bug Details

### Bug Condition

バグは、ユーザーが「バックエンドに実装・到達可能だがフロントにコードパスが存在しない」5種の機能のいずれかを利用しようとしたときに発動する。具体的には、Consensus 取得関数・解決関数・割り当て取得/作成/削除関数がフロントに存在しない、または `useAdmin` で空実装/空固定になっているため、ユーザー操作が対応するバックエンドルートを駆動しない。

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT:  X of type UserFeatureInteraction  // ユーザーが利用しようとする機能操作
  OUTPUT: boolean

  // バックエンド API は実装・ルート登録済み（または listTeamAssignments はハンドラ実装済み）
  // だが、フロントにコードパスが無い（service 欠落 / hook 空実装 / state 空固定）機能
  RETURN  X.feature = CONSENSUS_VIEW            // GET /consensus/{sessionId}/segments
       OR X.feature = CONSENSUS_RESOLVE         // POST /consensus/{sessionId}/resolve
       OR X.feature = TEAM_ASSIGN_SESSION       // POST /admin/teams/{teamId}/assignments
       OR X.feature = TEAM_UNASSIGN_SESSION     // DELETE /admin/teams/{teamId}/assignments/{sessionId}
       OR X.feature = TEAM_ASSIGNMENT_VIEW      // 割り当て候補セッション + 現在の割り当ての表示
END FUNCTION
```

### Examples

- **CONSENSUS_VIEW**: ADMIN がセッションの Consensus 状態を確認したい。期待: `GET /consensus/{sessionId}/segments` を呼び、各セグメントの状態（確定/競合/未確定）と CONFLICT の各 Reviewer 回答が表示される。実際: フロントに `consensus-api.ts` も画面もルートも無く、閲覧手段が皆無。
- **CONSENSUS_RESOLVE**: ADMIN が CONFLICT セグメントの正答を選んで確定したい。期待: `POST /consensus/{sessionId}/resolve` に `{ segmentId, selectedText }` を送り、成功で当該セグメントが CONFIRMED に変わる。実際: 解決操作を発行する UI も呼び出しも存在しない。
- **TEAM_ASSIGN_SESSION**: TeamLeader/Admin が `TeamManagement` でセッションを選び「割り当て」を押す。期待: `POST /admin/teams/{teamId}/assignments` に `{ sessionId }` を送り、201 の `TeamAssignmentRecord` を割り当て済みリストに反映。実際: `useAdmin.assignSession` が `// TODO` の空関数で何も起きない。
- **TEAM_UNASSIGN_SESSION**: 「解除」を押す。期待: `DELETE /admin/teams/{teamId}/assignments/{sessionId}` を呼び、`{ deleted: true }` でリストから除去。実際: `useAdmin.unassignSession` が空実装。
- **TEAM_ASSIGNMENT_VIEW**（エッジ）: 割り当てセクションを開く。期待: 割り当て可能なセッション候補（`sessions`）と現在の割り当て（`teamAssignments`）が表示される。実際: `useAdmin` の `sessions`/`teamAssignments` が空配列で固定されており、`AssignSessionSelect` は「割り当て可能なセッションがありません」を常に表示する。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- ユーザー管理（作成/同期/更新/有効化・無効化、`/admin/users` 系）が現在どおり動作する。
- チーム CRUD（作成/編集/削除）およびメンバー追加・削除（`/admin/teams`・`/admin/teams/{teamId}/members` 系）が現在どおり動作する。`useAdmin` の該当アクションのシグネチャと副作用は不変。
- IP 許可リスト・監査ログ・ランキング・Consensus/ランキング設定（`/admin/ip-allowlist`・`/admin/audit-logs`・`/ranking`・`/admin/settings/*`）が現在どおり動作する。
- セッション一覧/詳細/セグメント/メディア URL/修正（Correction）/話者ラベル/集約/再開など既存フローが現在どおり動作する。
- 既存バックエンドの各ハンドラ・サービス・リポジトリ、既存の API Gateway ルート、権限階層（ADMIN > TEAM_LEADER > REVIEWER）が不変。
- `ApiClient`（401 リダイレクト・429 リトライ・`Result` 変換）の挙動が不変。
- 既存の各 service / 各ページ / `App.tsx` の既存ルート（`/`, `/assigned`, `/joinable`, `/sessions/:sessionId`, `/upload`, `/language-models`, `/admin`, `/ranking`, `/profile`）が不変。

**Scope:**
バグ条件に該当しない全操作は本修正の影響を受けない。新規追加（`consensus-api.ts`・`ConsensusPage`・新ルート・`admin-api.ts` への assignments メソッド追加）は既存コードパスに割り込まず、`useAdmin` の変更は `sessions`/`teamAssignments`/`assignSession`/`unassignSession` の4点に限定し、他のアクション・state・初期ロード順序を変えない。`api-stack.ts` への変更は GET assignments ルートの1行追加に限定する（既存ルート・Lambda・権限は不変）。

> 期待される「正しい」挙動そのものは Correctness Properties（Property 1）で定義する。本セクションは「変えてはならないもの」に焦点を当てる。

## Hypothesized Root Cause

バグ記述とコード調査（実ファイル確認済み）に基づく根本原因:

1. **Consensus: サービス層・UI・ルートの三点欠落（確定事実）**
   - `frontend/src/services/` に `consensus-api.ts` が存在しない（`grep` で consensus 呼び出し 0 件）。
   - `pages/` に Consensus 画面が無く、`App.tsx` に `/consensus/*` ルートが無い。
   - バックエンド側は `get-consensus.ts`・`post-consensus-resolve.ts` が実装され、`api-stack.ts` L1277-1278 でルート登録済み。→ フロントの新規追加のみで到達可能。

2. **Team Assignment: service メソッド欠落 + hook 空実装 + state 空固定（確定事実）**
   - `admin-api.ts` に assignments を呼ぶメソッドが無い（`TeamAssignmentsResponse`/`SessionsResponse` 型だけ定義済みで未使用）。
   - `useAdmin.ts` の `assignSession`/`unassignSession` が `// TODO` の空 `useCallback`。
   - `useAdmin.ts` の `const [sessions] = useState<ReviewSession[]>([])` と `const [teamAssignments] = useState<TeamAssignment[]>([])` が setter を持たず空配列固定。初期ロード（`loadAll`）がこれらを取得していない。

3. **型の不一致（確定事実、マッピング必須）**
   - バックエンド `TeamAssignmentRecord` は `createdBy`/`createdAt`。フロント `TeamAssignment` は `assignedBy`/`assignedAt`。`admin-api.ts` の `TeamAssignmentsResponse` は `TeamAssignment[]` を期待するため、生のバックエンドレスポンスをそのまま流すと `assignedBy`/`assignedAt` が `undefined` になる。→ サービス層でフィールド名マッピングが必要。

4. **未登録 GET ルート（確定事実）**
   - `listTeamAssignmentsHandler` は実装済みだが `api-stack.ts` に `addRoute('GET', '/admin/teams/{teamId}/assignments', ...)` が無く到達不能。→ Overview の判断1に従いルートを追加する。

## Correctness Properties

Property 1: Bug Condition - 欠落していたフロント機能がバックエンドを正しく駆動する

_For any_ 操作 X でバグ条件が成立する（`isBugCondition(X)` が true）とき、修正後フロント `frontend'(X)` は SHALL 当該機能に対応する正しいバックエンドルート（`expectedRoute(X.feature)`）を正しい契約（メソッド・パス・ボディ）で呼び出し、成功時はレスポンスを UI に反映し、失敗時は `Result` 型でエラーを捕捉して日本語メッセージで表示する（UI をクラッシュさせない）。具体的には:
- CONSENSUS_VIEW → `GET /consensus/{sessionId}/segments`、各セグメントの `consensusStatus`・`consensusText`・CONFLICT の `reviewerAnswers` を表示。
- CONSENSUS_RESOLVE → `POST /consensus/{sessionId}/resolve` body `{ segmentId, selectedText }`、成功で当該セグメントを CONFIRMED として反映。CONFLICT 以外/COMPLETED は `VALIDATION_ERROR`/編集不可を捕捉して日本語表示。
- TEAM_ASSIGN_SESSION → `POST /admin/teams/{teamId}/assignments` body `{ sessionId }`、201 の `TeamAssignmentRecord` を割り当て済みリストへ反映。
- TEAM_UNASSIGN_SESSION → `DELETE /admin/teams/{teamId}/assignments/{sessionId}`、`{ deleted: true }` で割り当て済みリストから除去。
- TEAM_ASSIGNMENT_VIEW → 割り当て候補セッション一覧（`GET /sessions`）と現在の割り当て（`GET /admin/teams/{teamId}/assignments`）を取得し、`createdBy`/`createdAt` を `assignedBy`/`assignedAt` にマッピングして `TeamManagement` に空でないデータを渡す。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

Property 2: Preservation - 既存フロント機能の挙動不変

_For any_ 操作 X でバグ条件が成立しない（`isBugCondition(X)` が false）とき、修正後フロント `frontend'(X)` は SHALL 修正前フロント `frontend(X)` と同一の結果を生成し、既存のユーザー管理・チーム CRUD・メンバー管理・IP 許可リスト・監査ログ・ランキング・セッション/校閲フロー、および既存の各ルート・`ApiClient` の挙動を保全する。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

本修正はフロントの欠落補填に限定し、バックエンドは「未登録 GET ルートの公開」1点のみを追加する。構造規約（`services/{domain}-api.ts`、`components/` フラット、`hooks/use*.ts`、`pages/{PageName}.tsx`、`Result` 型、名前付きエクスポート、JSDoc、日本語 UI/英語コード、vitest-axe）に厳密に準拠する。

#### 1. 新規 `frontend/src/services/consensus-api.ts`（バグ1）

**ファイル**: `frontend/src/services/consensus-api.ts`（kebab-case、`services/` 直下）

`ranking-api.ts`/`session-api.ts` と同一パターン（`ApiClient` を受け取るクラス、`Result<T, AppError>` を返す、名前付きエクスポート、レスポンス型を同ファイルで定義）。

```typescript
import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { ConsensusSegment } from '../types/consensus';

export interface ConsensusSegmentsResponse {
  data: ConsensusSegment[];
}

export interface ResolveConsensusResponse {
  data: {
    sessionId: string;
    segmentId: string;
    consensusText: string;
    confirmedBy: string;
    confirmedAt: string;
  };
}

export class ConsensusApi {
  constructor(private client: ApiClient) {}

  /** GET /consensus/{sessionId}/segments — Consensus 状態と各 Reviewer 回答を取得（ADMIN 専用） */
  async getConsensusSegments(sessionId: string): Promise<Result<ConsensusSegmentsResponse, AppError>> {
    return this.client.get<ConsensusSegmentsResponse>(`/consensus/${sessionId}/segments`);
  }

  /** POST /consensus/{sessionId}/resolve — CONFLICT セグメントを手動解決（ADMIN 専用） */
  async resolveConsensus(
    sessionId: string,
    input: { segmentId: string; selectedText: string }
  ): Promise<Result<ResolveConsensusResponse, AppError>> {
    return this.client.post<ResolveConsensusResponse>(`/consensus/${sessionId}/resolve`, input);
  }
}
```

#### 2. 新規フロント型 `frontend/src/types/consensus.ts`（バグ1）

**ファイル**: `frontend/src/types/consensus.ts`（kebab-case、構造規約の「Frontend shared types → `{domain}.ts`」）

バックエンド `get-consensus.ts` の `ConsensusSegment`/`ReviewerAnswer` に一致させる（フロントはバックエンドと型を共有しない方針のため複製する）。

```typescript
export type ConsensusStatus = 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';

export interface ReviewerAnswer {
  text: string;
  count: number;
  userIds: string[];
}

export interface ConsensusSegment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: ConsensusStatus;
  consensusText?: string;
  reviewerAnswers?: ReviewerAnswer[];
}
```

#### 3. 新規 `frontend/src/pages/ConsensusPage.tsx`（バグ1）

**ファイル**: `frontend/src/pages/ConsensusPage.tsx`（PascalCase、`pages/` 直下）

props 駆動のプレゼンテーション層（既存 `AdminPage`/`RankingPage` と同様、データ取得はしない）。表示:
- セグメント一覧。各行に状態バッジ（`UNDECIDED`=未確定 / `CONFIRMED`=確定 / `CONFLICT`=競合解決待ち）を日本語で表示。
- CONFIRMED は `consensusText` を表示。
- CONFLICT は `reviewerAnswers`（各 `text` と `count`「N名」）をラジオ/ボタンで提示し、「この回答で確定」操作で `onResolve(segmentId, selectedText)` を呼ぶ。
- `isLoading`/`error`（日本語メッセージ）/空状態を表示。
- アクセシビリティ: 状態一覧は `role` と `aria-label` を付与、ボタンは `focus:ring`、`vitest-axe` 準拠。

props（概略）:
```typescript
export interface ConsensusPageProps {
  sessionId?: string;
  segments: ConsensusSegment[];
  isLoading?: boolean;
  error?: { message: string } | null;
  resolveError?: string | null;
  onResolve?: (segmentId: string, selectedText: string) => Promise<void>;
}
```

#### 4. 新規コンポーネント `frontend/src/components/ConsensusSegmentList.tsx`（任意・バグ1）

一覧描画が肥大化する場合、`components/` 直下フラットに切り出す（`TeamManagement` 内の `AssignSessionSelect` と同様の分割方針）。ページ側に収まるなら省略可。

#### 5. `frontend/src/App.tsx` に `ConsensusPageWrapper` と `/consensus/:sessionId` ルート追加（バグ1）

既存 `AdminPageWrapper`/`ReviewPageWrapper` と同じ Wrapper パターン:
- `useParams<{ sessionId: string }>()` で sessionId を取得。
- `useMemo` で `new ConsensusApi(new ApiClient({ baseUrl: getApiBaseUrl(), getToken }))`。
- `useEffect` で `getConsensusSegments(sessionId)` を取得し、`Result` を捕捉。失敗時は `error`/`resolveError` に日本語メッセージを設定。
- ADMIN ガード: `AdminPageWrapper` と同一の `if (user && user.role !== 'ADMIN') return <Navigate to="/" replace />;`。
- `onResolve` は `resolveConsensus` を呼び、成功時に該当セグメントの状態をローカルで CONFIRMED に更新（または再取得）。`VALIDATION_ERROR`/編集不可は捕捉して日本語表示。
- `<Routes>` に `<Route path="/consensus/:sessionId" element={<><Navigation {...navProps} /><ConsensusPageWrapper user={auth.user} getToken={auth.getToken} /></>} />` を既存ルート群に追加。既存ルートは不変。

#### 6. ReviewPage ヘッダに ADMIN 向け Consensus 導線（バグ1）

ReviewPage のヘッダ（セッション名表示付近）に、`userRole === 'ADMIN'` のときだけ `/consensus/{sessionId}` へのリンク（例: 「Consensus を確認」）を表示する。Navigation グローバルメニューは sessionId を持たないため使わない。既存の非 ADMIN 挙動は不変。

#### 7. `frontend/src/services/admin-api.ts` に assignments メソッド追加（バグ2）

**ファイル**: `frontend/src/services/admin-api.ts`（既存に追記）

既存の型 `TeamAssignmentsResponse`（`data: TeamAssignment[]`）・`SessionsResponse` を活用。**バックエンドの `createdBy`/`createdAt` → フロント `assignedBy`/`assignedAt` マッピングをサービス層で実施**（バックエンドの生レスポンスは `createdBy`/`createdAt` のため）。

```typescript
// バックエンド生レコード（team-assignments.ts / team-repository.ts）
interface RawTeamAssignment {
  teamId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}
function mapAssignment(raw: RawTeamAssignment): TeamAssignment {
  return {
    teamId: raw.teamId,
    sessionId: raw.sessionId,
    assignedBy: raw.createdBy,
    assignedAt: raw.createdAt,
  };
}

// GET /admin/teams/{teamId}/assignments（Overview 判断1 で api-stack.ts に追加）
async getTeamAssignments(teamId: string): Promise<Result<TeamAssignmentsResponse, AppError>> {
  const result = await this.client.get<{ data: RawTeamAssignment[] }>(`/admin/teams/${teamId}/assignments`);
  if (!result.ok) return result;
  return { ok: true, value: { data: result.value.data.map(mapAssignment) } };
}

// POST /admin/teams/{teamId}/assignments（成功 201, data は単一 Record）
async assignSession(teamId: string, sessionId: string): Promise<Result<{ data: TeamAssignment }, AppError>> {
  const result = await this.client.post<{ data: RawTeamAssignment }>(`/admin/teams/${teamId}/assignments`, { sessionId });
  if (!result.ok) return result;
  return { ok: true, value: { data: mapAssignment(result.value.data) } };
}

// DELETE /admin/teams/{teamId}/assignments/{sessionId}
async unassignSession(teamId: string, sessionId: string): Promise<Result<{ data: { deleted: true } }, AppError>> {
  return this.client.delete<{ data: { deleted: true } }>(`/admin/teams/${teamId}/assignments/${sessionId}`);
}
```

割り当て候補セッションは既存の `SessionApi.listSessions()` を利用する（AdminApi に重複メソッドを足さず、`useAdmin` 側で `SessionApi` を使うか、`App.tsx` の `AdminPageWrapper` で取得して渡す。既存 `SessionsResponse` 型と整合）。

#### 8. `frontend/src/hooks/useAdmin.ts` の配線（バグ2）

変更は4点に限定（他の state・アクション・初期ロード順序は不変）:
- `const [sessions, setSessions] = useState<ReviewSession[]>([])` に setter を付与。
- `const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([])` に setter を付与。
- 初期ロード（`loadAll`）に、割り当て候補セッション取得（`SessionApi.listSessions()`、または `AdminApi` 経由）と、ロード済み各チームの `getTeamAssignments(teamId)` を追加し、`setSessions`/`setTeamAssignments` を満たす。既存の users/teams/ipAllowlist/auditLogs のロードと `Promise.all` の順序・エラーサーフェスは維持。
- `assignSession`/`unassignSession` を実装:
```typescript
const assignSession = useCallback(async (teamId: string, sessionId: string) => {
  const result = await apiRef.current.assignSession(teamId, sessionId);
  if (result.ok) {
    setTeamAssignments((prev) => [...prev, result.value.data]);
  } else {
    setError(result.error); // Result で捕捉し日本語表示
  }
}, []);

const unassignSession = useCallback(async (teamId: string, sessionId: string) => {
  const result = await apiRef.current.unassignSession(teamId, sessionId);
  if (result.ok) {
    setTeamAssignments((prev) => prev.filter((a) => !(a.teamId === teamId && a.sessionId === sessionId)));
  } else {
    setError(result.error);
  }
}, []);
```
`UseAdminReturn` の既存シグネチャ（`assignSession: (teamId, sessionId) => void` 等）は維持し、`TeamManagement`/`AdminPage`/`App.tsx` の props 配線（すでに `onAssignSession`/`onUnassignSession` を渡し済み）はそのまま機能する。

> `useAdmin` が `SessionApi` を必要とする場合、`useAdmin(adminApi, sessionApi)` のように引数追加するか、`App.tsx` の `AdminPageWrapper` で `sessions` を取得して `useAdmin` に渡す選択肢がある。既存 `AdminPageWrapper` が `admin.sessions` を `AdminPage` に流している構造を壊さないよう、`useAdmin` 内で取得し `sessions` を返す方式を基本とする（配線の局所化）。

#### 9. `infra/lib/stacks/api-stack.ts` に GET assignments ルート追加（バグ2・判断1）

**ファイル**: `infra/lib/stacks/api-stack.ts`（既存 API レイヤー）

既存の POST/DELETE assignments Lambda と同じ `createLambda`（`fileName: 'team-assignments'`, `exportedHandler: 'listTeamAssignmentsHandler'`）を1つ足し、`this.addRoute('GET', '/admin/teams/{teamId}/assignments', getTeamAssignmentsFn, jwtAuthorizer)` を追加。既存ルート・Lambda・権限・レイヤリング（Foundation → API → CDN → Monitoring）は不変。CDK スナップショットテスト（`infra/test/`）の差分は本追加分のみを許容する。

## Testing Strategy

### Validation Approach

二段構え: まず未修正コードでバグ（コードパス不在・空実装・空固定）を顕在化させる反例を得て根本原因を確認し、次に修正が正しく動作し既存挙動を保全することを検証する。フロントは Vitest + React Testing Library + fast-check + vitest-axe、`ApiClient` は `vi.mock()` でモックする（バックエンド AWS SDK 直叩きはしない）。

### Exploratory Bug Condition Checking

**Goal**: 修正前に、ユーザー操作が対応バックエンドルートを駆動しないこと（＝バグ）を反例として顕在化し、根本原因（service 欠落 / hook 空実装 / state 空固定）を確認する。反証されれば再仮説を立てる。

**Test Plan**: 未修正の `useAdmin`/`TeamManagement`/（Consensus は不在のため追加予定の）配線に対し、割り当て/解除/Consensus 呼び出しがモック API を呼ばないことを観測する。

**Test Cases**:
1. **Team 割り当て未発火テスト**: `useAdmin.assignSession('t1','s1')` を呼んでも `AdminApi.assignSession` が呼ばれない（未修正では空実装）。(will fail intent — 修正後は呼ばれる)
2. **Team 解除未発火テスト**: `unassignSession` が `DELETE` を呼ばない。(will fail intent)
3. **割り当て候補空テスト**: `useAdmin` の `sessions`/`teamAssignments` が常に空で、`TeamManagement` が「割り当て可能なセッションがありません」を表示する。(will fail intent)
4. **Consensus 不在テスト（エッジ）**: `/consensus/{sessionId}` ルートが存在せず画面に到達できない。(will fail intent)

**Expected Counterexamples**:
- モック API のスパイが呼ばれない（呼び出し回数 0）。
- 候補/割り当てリストが空のまま。
- 原因候補: service メソッド欠落、`useCallback` 空実装、`useState` 空固定・初期ロード欠落、ルート/画面不在、`createdBy`→`assignedBy` マッピング欠落。

### Fix Checking

**Goal**: バグ条件に該当する全入力で、修正後フロントが期待挙動（正しいルート・契約での呼び出しと UI 反映、失敗時の `Result` 捕捉）を満たすことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := frontend_fixed(X)
  ASSERT result.invokesBackendRoute = expectedRoute(X.feature)
     AND result.requestContract     = backendContract(X.feature)
     AND result.rendersResponse     = true
     AND result.handlesErrorAsResult = true
END FOR
```

### Preservation Checking

**Goal**: バグ条件に該当しない全入力で、修正後フロントが修正前と同一に振る舞うことを検証する。

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT frontend_original(X) = frontend_fixed(X)
END FOR
```

**Testing Approach**: プロパティベーステスト（fast-check）を推奨。多数の入力を自動生成して既存機能（ユーザー管理・チーム CRUD・メンバー管理・IP・監査ログ・ランキング）の呼び出し契約と state 遷移が不変であることを広くカバーし、手動では見落とす端ケースを捕捉する。

**Test Plan**: 未修正コードで既存操作の挙動（どのルートをどのボディで呼ぶか、state がどう変わるか）を観測し、それを固定するプロパティ/ユニットテストを書く。

**Test Cases**:
1. **ユーザー管理保全**: `createUser`/`disableUser`/`editUser` が従来どおり `/admin/users` 系を呼び state を更新することを確認。
2. **チーム CRUD/メンバー保全**: `createTeam`/`editTeam`/`deleteTeam`/`addMember`/`removeMember` が従来どおり動作。
3. **既存ルート保全**: `/admin`・`/ranking`・`/sessions/:sessionId` 等が従来どおりレンダリングされる（新ルート追加で既存ルートが壊れない）。

### Unit Tests

- `consensus-api.ts`: `getConsensusSegments`/`resolveConsensus` が正しいパス・メソッド・ボディで `ApiClient` を呼び、`Result` を返す（成功/各エラーコード: `VALIDATION_ERROR`・`FORBIDDEN`・編集不可）。
- `admin-api.ts`: `getTeamAssignments`/`assignSession`/`unassignSession` が正しい契約で呼び、`createdBy`/`createdAt` → `assignedBy`/`assignedAt` マッピングが正しいこと。
- `useAdmin.ts`: `assignSession`/`unassignSession` 成功時の `teamAssignments` 追加・除去、失敗時の `error` 設定、初期ロードで `sessions`/`teamAssignments` が満たされること。既存アクションが不変であること。
- `ConsensusPage.tsx` / `TeamManagement.tsx`: 状態バッジ・CONFLICT 回答表示・割り当て UI の描画と操作。エラー時の日本語表示。各コンポーネントテストで `vitest-axe` の `toHaveNoViolations()`。
- `App.tsx`: `/consensus/:sessionId` の ADMIN ガード（非 ADMIN は `/` へリダイレクト）、`MemoryRouter` でラップ。

### Property-Based Tests（fast-check, numRuns: 100）

- **Consensus 解決プロパティ**: ランダムな `ConsensusSegment[]`（状態・reviewerAnswers を生成）に対し、CONFLICT セグメントの解決操作が常に `{ segmentId, selectedText }` を正しいパスへ送り、成功で当該セグメントのみ CONFIRMED になる。CONFLICT 以外への解決はエラーを `Result` で捕捉し UI を壊さない。
- **割り当て/解除プロパティ**: ランダムな `teamId`/`sessionId`/既存割り当て集合に対し、割り当て→解除の往復で `teamAssignments` が整合（重複追加しない、解除で確実に除去、他チームの割り当てに影響しない）し、`createdBy`→`assignedBy` マッピングが保存される。
- **保全プロパティ**: ランダムな既存操作列に対し、修正前後で呼び出しルート・ボディ・state 遷移が一致する（Preservation）。

### Integration Tests

- フロント統合（RTL）: `/consensus/:sessionId` を ADMIN で開く → 一覧表示 → CONFLICT を解決 → CONFIRMED 反映、までの一連フロー。
- フロント統合: AdminPage「チーム管理」タブで割り当てセクションを開く → 候補表示 → 割り当て → 割り当て済みへ反映 → 解除 → 除去、の一連フロー。
- CDK（`infra/test/`）: GET assignments ルート追加後、API スタックのスナップショット差分が本追加分のみであること（既存ルート不変）。
