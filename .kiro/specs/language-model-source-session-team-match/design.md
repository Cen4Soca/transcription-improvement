# Design Document

## Overview

本機能は、CustomLanguageModel の作成時に「ソースとして指定した各 ReviewSession が、モデルの所属先として指定された Team（TargetTeam）に実際に TeamAssignment として割り当てられている」ことを保証する。これをバックエンド（LanguageModelService）とフロントエンド（ModelCreationForm = `LanguageModelPage`）の両方で実現する。

- **バックエンド（権威層・最終防衛線）**: `createModel` の `checkSessionAccess` ループ直後に、各 `sessionId` について `hasTeamAssignment(teamId, sessionId)` を検証するループを追加する。未割り当てを最初に検出した時点で `validationError`（日本語 message + 英語 details）を投げて中止する。ADMIN にも適用する（新ループは `isAdmin` 分岐の外に置く）。
- **フロントエンド（UX ガード）**: 作成フォームで、選択中の TargetTeam に TeamAssignment が存在する ReviewSession のみを候補として表示する。Team 選択変更時に候補を更新し、新 Team に属さない選択済みセッションを自動で選択解除する。

利用対象ロールは ADMIN / TEAM_LEADER のみ（既存の `requireRole(user, 'TEAM_LEADER')` と `hasAccess` ガードを踏襲）。

### 重要な概念整理: `assignedTeamId` と TeamAssignment は別物

調査の結果、「セッションとチームの結びつき」には **2 つの異なる概念** が存在することを確認した。設計上この区別が本機能の核心となる。

| 概念 | 格納場所 | カーディナリティ | 意味 | 問い合わせ手段 |
|------|----------|------------------|------|----------------|
| `ReviewSession.assignedTeamId` | セッションレコード自身の属性（`session-repository.ts`、GSI1 で `TEAM#` インデックス） | セッションにつき **1 つ**（既定はアップロード者のチーム） | Reviewer がそのセッションを「引き受け（claim/join）可能」なチーム | セッションレコードに含まれる |
| **TeamAssignment** | 独立アイテム `PK=TEAM#{teamId}` / `SK=ASSIGNMENT#{sessionId}`（`team-repository.ts`、GSI1 で `SESSION#` 逆引き） | セッション × チームの **多対多** | そのチームの全メンバーがセッションにアクセスできるという割り当て | `hasTeamAssignment(teamId, sessionId)` / `getTeamAssignments(teamId)` |

要件（1.1〜1.6）が指す「TeamAssignment が存在する」は後者（多対多の TeamAssignment アイテム）である。バックエンド検証は要件どおり `hasTeamAssignment` を使う。

したがってフロントエンドの候補絞り込みも、`session.assignedTeamId`（単一・別概念）ではなく、**TargetTeam の TeamAssignment 集合** を基準にしなければ、バックエンド検証と意味がずれる（フロントで通した候補がバックエンドで 400 になる、またはその逆が起こりうる）。この結論を踏まえたフロントエンドのデータ取得方法を「Components and Interfaces」で決定する。

## Architecture

レイヤリングは既存どおり `Handler → Service → Repository` を厳守する。本機能はサービス層とフロント層のみの変更で、新規 Lambda・新規リポジトリ関数・新規 CDK リソースは不要。

```
POST /language-models (既存)
  └─ handlers/language-model-create.ts (既存・無変更)
       └─ services/language-model-service.ts :: createModel  ← ★検証ループ追加
            ├─ access-control-service.ts :: checkSessionAccess   (既存)
            └─ access-control-service.ts :: hasTeamAssignment     ← ★新規利用(既存関数)

GET /admin/teams/{teamId}/assignments (既存)
  └─ handlers/team-assignments.ts :: listTeamAssignmentsHandler (既存・無変更)
       └─ services/team-service.ts :: listAssignments → getTeamAssignments (既存)

Frontend
  App.tsx :: LanguageModelPageWrapper (既存)
    └─ pages/LanguageModelPage.tsx :: ModelCreationForm  ← ★候補絞り込み state ロジック追加
         └─ services/language-model-api.ts :: listTeamAssignments  ← ★新規メソッド(既存エンドポイント)
```

### フロントエンドのセッション→チーム割り当て取得方法（調査結論）

3 つの選択肢を比較し、最小コスト案を採用する。

**調査事実:**
1. `LanguageModelPage` が props で受け取る `sessions: ReviewSession[]` の型（`frontend/src/types/session.ts`）には `assignedTeamId?: string` が含まれる。ただしこれは上表のとおり **単一の「引き受け可能チーム」であり、TeamAssignment（多対多）ではない**。よってこれをフィルタ基準にするとバックエンド検証と意味がずれるため不採用。
2. `sessions` は親 `LanguageModelPageWrapper` が `sessionApi.listSessions({ status: 'COMPLETED' })` で取得している。このレスポンス（`ReviewSession`）には TeamAssignment 集合は含まれない。
3. **既存エンドポイント `GET /admin/teams/{teamId}/assignments`（`listTeamAssignmentsHandler`）が、指定 Team の `TeamAssignmentRecord[]`（各 `sessionId` を含む）を返す。** 認可は `listAssignments → requireTeamAccess` により ADMIN は任意チーム、TEAM_LEADER は自チームのみ（本機能の利用対象ロールと完全に一致）。これは `hasTeamAssignment` と同一のデータソース（`PK=TEAM#{teamId}` / `SK=ASSIGNMENT#{sessionId}`）を読むため、**バックエンド検証と意味が一致する**。

**比較:**

| 案 | 内容 | コスト | バックエンドとの意味一致 | 判定 |
|----|------|--------|--------------------------|------|
| A. `session.assignedTeamId` でフィルタ | 既存 props のみで完結、追加 API なし | 最小 | ✗ 不一致（単一チーム概念） | 不採用 |
| B. `/me/teams` の拡張や `/sessions` にチーム情報を含める | セッション一覧 API 改修 | 中〜大（複数ハンドラ・型変更・ページング影響） | △ 要実装 | 不採用 |
| **C. 既存 `GET /admin/teams/{teamId}/assignments` を利用** | フロント API クライアントにメソッド追加、Team 選択時に TeamAssignment 集合を取得 | 小（フロント 1 メソッド + state ロジックのみ、バックエンド無変更） | ✓ 一致（同一データソース） | **採用** |

**採用案 C の要点:**
- `LanguageModelApi` に `listTeamAssignments(teamId)` を追加（既存 `/admin/teams/{teamId}/assignments` を叩くだけ。バックエンド無変更）。
- Team 選択時にそのチームの `TeamAssignmentRecord[]` を取得し、`sessionId` 集合を作る。
- 候補 = props の `sessions` のうち `sessionId` がその集合に含まれるもの。
- これにより「フロントの候補」と「バックエンドが `hasTeamAssignment` で通す集合」が一致する。

## Components and Interfaces

### Backend: `language-model-service.ts :: createModel`

`access-control-service.js` からは既に `checkSessionAccess` 等をインポート済み。`hasTeamAssignment` を同じ import 文に追加する。

```typescript
import {
  checkSessionAccess,
  checkLanguageModelAccess,
  isTeamMember,
  getUserTeamIds,
  hasTeamAssignment, // ★追加
} from './access-control-service.js';
```

`createModel` 内、既存の `checkSessionAccess` ループの **直後**（displayName バリデーションの前）に検証ループを追加する。`isAdmin` 分岐の外に置くことで ADMIN にも適用される（Req 1.5）。

```typescript
// Verify the caller can access every source session (other-team session -> 404)
for (const sessionId of sessionIds) {
  await checkSessionAccess(user, sessionId);
}

// ★ Verify every source session is actually assigned to the target team.
//   Applies to ADMIN as well (outside the isAdmin branch). Fail-fast: throw on
//   the first unassigned session (Req 1.1, 1.3, 1.5, 1.6).
for (const sessionId of sessionIds) {
  const assigned = await hasTeamAssignment(teamId, sessionId);
  if (!assigned) {
    throw validationError(
      '選択した校閲セッションの中に、指定チームに割り当てられていないものがあります。チームに割り当てられた校閲セッションのみを選択してください。',
      `Session ${sessionId} is not assigned to team ${teamId}`,
    );
  }
}

// Validate displayName (trim, 1-100 chars) ... (以降は既存のまま)
```

- 日本語 `message` + 英語 `details`（Req 4.1）。
- `validationError` は既存ファクトリ（400 / `VALIDATION_ERROR`）を使用（Req 1.2）。
- `sessionIds` の反復順でループし、最初の未割り当てで `return`（throw）するため、それ以降の `hasTeamAssignment` は呼ばれない（Req 1.3）。
- すべて割り当て済みならループを抜けて既存の後続処理（displayName 検証 → トレーニングデータ生成 → S3 → Transcribe → putModel → 監査ログ）が継続する（Req 1.6）。

ハンドラ（`language-model-create.ts`）・リポジトリ・CDK はいずれも変更不要。

### Frontend: `language-model-api.ts :: listTeamAssignments`

既存の `TeamAssignmentRecord` 形状（`team-repository.ts` の `{ teamId, sessionId, createdBy, createdAt }`）に合わせた型を追加し、既存エンドポイントを呼ぶメソッドを追加する。

```typescript
export interface TeamAssignmentRecord {
  teamId: string;
  sessionId: string;
  createdBy: string;
  createdAt: string;
}

// LanguageModelApi クラス内
/**
 * 指定チームの TeamAssignment 一覧を取得する（候補絞り込み用）
 * （ADMIN は任意チーム、TEAM_LEADER は自チームのみ。バックエンドで認可）
 */
async listTeamAssignments(
  teamId: string
): Promise<Result<{ data: TeamAssignmentRecord[] }, AppError>> {
  return this.client.get<{ data: TeamAssignmentRecord[] }>(
    `/admin/teams/${encodeURIComponent(teamId)}/assignments`
  );
}
```

### Frontend: `LanguageModelPage.tsx` の候補絞り込み state ロジック

純粋ヘルパを 2 つ切り出し、プロパティテスト可能にする（コンポーネント内に定義、もしくは同ファイルで `export`）。

```typescript
/** 選択チームに割り当てられた sessionId 集合で候補を絞る（Req 2.1） */
export function filterSessionsByAssignment(
  sessions: ReviewSession[],
  assignedSessionIds: Set<string>
): ReviewSession[] {
  return sessions.filter((s) => assignedSessionIds.has(s.sessionId));
}

/** 前回の選択を新しい割り当て集合に整合させる（= 積集合、Req 2.3） */
export function reconcileSelection(
  prevSelected: string[],
  assignedSessionIds: Set<string>
): string[] {
  return prevSelected.filter((id) => assignedSessionIds.has(id));
}
```

state と副作用:

```typescript
// 選択中チームに割り当てられた sessionId 集合
const [assignedSessionIds, setAssignedSessionIds] = useState<Set<string>>(new Set());
const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

// チーム選択が変わるたびに TeamAssignment を取得（Req 2.2）
useEffect(() => {
  if (!teamId) {
    setAssignedSessionIds(new Set());
    return;
  }
  let cancelled = false;
  setIsLoadingAssignments(true);
  (async () => {
    const result = await languageModelApi.listTeamAssignments(teamId);
    if (cancelled) return;
    const ids = result.ok
      ? new Set(result.value.data.map((a) => a.sessionId))
      : new Set<string>();
    setAssignedSessionIds(ids);
    setIsLoadingAssignments(false);
  })();
  return () => { cancelled = true; };
}, [teamId, languageModelApi]);

// 候補 = props sessions を割り当て集合で絞ったもの（Req 2.1）
const candidateSessions = useMemo(
  () => filterSessionsByAssignment(sessions, assignedSessionIds),
  [sessions, assignedSessionIds]
);

// 割り当て集合が変わったら、新チームに属さない選択を解除（Req 2.3）。
// ★ ここは「セッション選択の縮小」に反応する単一の責務箇所であり、
//   Req 2.4（選択解除に連動した依存入力のリセット）の拡張点でもある。
//   現状の作成フォームには SourceReviewSession の選択に依存する付随入力は存在しないため、
//   今は selectedSessionIds の整合のみを行う。将来そうした派生 state（例: セッション
//   単位の付随設定）を追加する場合は、この useEffect 内で reconcileSelection により
//   除外された sessionId に紐づく派生 state も合わせてリセットすること（選択解除と
//   同一のトリガ・同一の箇所で連動させ、整合の責務を一箇所に集約する）。
useEffect(() => {
  setSelectedSessionIds((prev) => {
    const next = reconcileSelection(prev, assignedSessionIds);
    // 選択が縮小した（next ⊊ prev）場合、この分岐が将来の依存入力リセットの起点となる。
    // 依存入力が存在する時点で、ここで removed = prev - next を算出し派生 state を整合させる。
    return next.length === prev.length ? prev : next;
  });
}, [assignedSessionIds]);
```

- セッション一覧の描画（チェックボックス群）は `sessions` ではなく `candidateSessions` を使う。
- Team 未選択時は候補なし（空集合）とし、「チームを選択してください」の旨を案内（既存の空状態 UI を流用し文言のみ調整）。
- `handleSessionToggle`・`validateForm`・`handleSubmit` は既存のまま。送信時の `selectedSessionIds` は `reconcileSelection` により常に割り当て集合の部分集合であることが保証される。
- **Req 2.4（依存入力の連動リセット）**: SourceReviewSession の選択に依存する付随入力項目は現状のフォームには存在しない。本要件は「将来そうした依存入力が追加された場合に、選択解除と連動してリセットする」ための拡張点として、上記の整合用 `useEffect`（`reconcileSelection` で `selectedSessionIds` を縮小する箇所）に集約する。選択解除の検出と依存入力のリセットを同一箇所・同一トリガで行うことで、整合ロジックの分散を防ぐ。現時点では依存入力がないため追加のランタイム挙動はない。
- アクセシビリティ: 既存の `aria-label` / `role="alert"` / ローディングの `role="status"` を踏襲。読み込み中は既存のスピナー文言パターン（「セッション読み込み中...」に倣い「割り当て読み込み中...」）。

## Data Models

新規データモデルなし。既存のみ使用。

- **TeamAssignment**（`PK=TEAM#{teamId}` / `SK=ASSIGNMENT#{sessionId}`、GSI1 `SESSION#` 逆引き）: `hasTeamAssignment` と `getTeamAssignments` が読む。単一の正。
- **ReviewSession**（`assignedTeamId` 含む）: フロントの候補母集合（props `sessions`）として使うのみ。フィルタ基準には使わない。

## Error Handling

| 状況 | 層 | 応答 | コード |
|------|----|------|--------|
| いずれかのソースセッションが TargetTeam 未割り当て | Service | 400 + 日本語 message / 英語 details | `VALIDATION_ERROR` |
| 要求者が ADMIN/TEAM_LEADER 以外 | Service（既存 `requireRole`） | 403 | `FORBIDDEN` |
| 他チーム／不存在セッションへのアクセス（既存 `checkSessionAccess`） | Service | 404 | `NOT_FOUND` |
| フロント: TeamAssignment 取得失敗 | Frontend | 候補を空集合にフォールバック（作成はバックエンドが最終検証） | — |

バックエンドは常に権威（最終防衛線）であり、フロントの絞り込みは UX 上のガードに過ぎない。フロントの取得が失敗しても、バックエンド検証により不正なセッション指定は 400 で拒否される。

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: TeamAssignment 一致ゲートは「全セッション割り当て済み」と同値（ロール非依存・エラー形状つき）

*For any* 呼び出し元ロール（ADMIN または TEAM_LEADER）、*for any* ソース `sessionIds` の集合、および *for any* 「TargetTeam に割り当て済みセッション」の部分集合について、`createModel` は、すべての `sessionId` が割り当て済みである場合に限り（IFF）TeamAssignment 検証を通過して後続処理（`putModel` に到達）へ進む。少なくとも 1 つが未割り当ての場合は、必ず `statusCode` 400・コード `VALIDATION_ERROR` のエラーを投げ、`message` は固定の日本語文字列、`details` は該当 `sessionId` と `teamId` を含む英語文字列であり、S3 アップロード・Transcribe `CreateLanguageModel`・`putModel` などの下流副作用は一切発生しない。

**Validates: Requirements 1.1, 1.2, 1.5, 1.6, 4.1**

### Property 2: 未割り当て検出時のフェイルファスト（短絡）

*For any* 順序付き `sessionIds` リストであって少なくとも 1 つが未割り当てのものについて、`createModel` は最初に未割り当てとなる `sessionId` を検出した時点で検証を終了する。すなわち `hasTeamAssignment` は、最初に失敗する `sessionId` までしか呼ばれず、それより後ろに位置する `sessionId` に対しては一度も呼ばれない。

**Validates: Requirements 1.3**

### Property 3: 候補絞り込みは割り当て集合に一致

*For any* セッション一覧と *for any* 割り当て済み `sessionId` 集合について、`filterSessionsByAssignment` が返す候補は、`sessionId` が割り当て集合に含まれるセッションのみからなり（含まれないものは必ず除外され）、かつ一覧中に存在し割り当て集合にも含まれるセッションは必ず残る。

**Validates: Requirements 2.1**

### Property 4: 選択整合は「前回選択 ∩ 新割り当て集合」

*For any* 前回の選択済み `sessionId` リストと *for any* 新しい割り当て済み `sessionId` 集合について、`reconcileSelection` の結果は前回選択と新割り当て集合の積集合に等しい。結果は常に新割り当て集合の部分集合であり（新チームに属さない選択は解除され）、前回選択かつ新割り当て集合に含まれる要素は 1 つも落とされない。

**Validates: Requirements 2.3**

## Testing Strategy

tech steering のプロパティテスト対象に **Language Model** が含まれるため、バックエンド検証ロジックとフロントの純粋ヘルパの双方にプロパティテストを用意する。プロパティテストは最低 `{ numRuns: 100 }`、describe ブロックは `Feature: language-model-source-session-team-match, Property N: ...` 形式で参照する。

### Backend unit tests — `backend/src/services/language-model-service.test.ts`

既存の `createModel` スイートに追記（AWS SDK / リポジトリは `vi.mock()`、`access-control-service.js` の `hasTeamAssignment` をモック）。

- EXAMPLE（Req 1.4 — 呼び出し順序）: すべての `checkSessionAccess` 呼び出しが完了した後に `hasTeamAssignment` が呼ばれ、いずれも `putModel` / Transcribe `CreateLanguageModel` より前に実行されることをモック呼び出し順で検証する。
- EXAMPLE（Req 1.2 失敗の代表例）: 2 件中 1 件が未割り当てのとき 400 `VALIDATION_ERROR` を投げ、`PutObjectCommand` / `CreateLanguageModelCommand` / `putModel` が呼ばれないこと。
- EXAMPLE（Req 1.6 成功の代表例）: 全件割り当て済みのとき検証を通過し後続処理へ進むこと。
- EXAMPLE（Req 3.1）: REVIEWER 呼び出しで 403 `FORBIDDEN`、下流未実行（既存の role ガードの回帰）。
- EDGE_CASE: `sessionIds` が空配列のとき TeamAssignment 検証ループは 0 回で通過する（既存の「確定済み Segment なし」などの後続検証に委ねる）。

### Backend property tests — `backend/src/services/language-model-service.property.test.ts`

既存のモック構成（`access-control-service.js` をモック）に `hasTeamAssignment: vi.fn()` を追加する。

- **Property 1**: `fc.record` で `{ role: ADMIN|TEAM_LEADER, sessionIds: string[], assignedSubset: Set<string> }` を生成。`hasTeamAssignment` を「`assignedSubset` に含まれる `sessionId` のとき true」を返すよう実装。`isTeamMember` / `getTeamById` 等の先行ゲートは常に通過させる。全件 ⊆ `assignedSubset` のとき `putModel` 到達、そうでなければ `statusCode === 400 && code === 'VALIDATION_ERROR'`、`message` が固定日本語文字列、`details` に該当 `sessionId`・`teamId` を含み、`putModel` / Transcribe create が未呼び出しであること。ADMIN でも同一挙動（ゲートが `isAdmin` 分岐外）であることを role 生成で担保。
- **Property 2**: `sessionIds` と「最初に失敗するインデックス」を生成。`hasTeamAssignment` 呼び出しの引数列を記録し、最後に問い合わせた `sessionId` が最初の失敗要素で、それ以降の要素が一度も問い合わされないことを検証。

### Frontend component tests — `frontend/src/pages/LanguageModelPage.test.tsx`

既存スイート（`MemoryRouter` は不要なスタンドアロンだが、既存テストの `render` 方針に合わせる）に追記。`languageModelApi.listTeamAssignments` をモックする。全コンポーネントテストで `expect(container).toHaveNoViolations()`（vitest-axe、WCAG 2.1 AA）を含める。

- EXAMPLE（Req 2.1）: Team A 選択 → `listTeamAssignments('A')` が A の `sessionId` 集合を返す → 候補チェックボックスが A の割り当てセッションのみ表示。
- EXAMPLE（Req 2.2）: Team A → B へ選択変更 → `listTeamAssignments` が B で再呼び出しされ、候補一覧が B の割り当てに更新される。
- EXAMPLE（Req 2.3）: A の候補を 1 件選択 → B（その選択を含まない）へ変更 → 当該選択が解除され、`selectedSessionIds` が空になる。
- NOTE（Req 2.4）: SourceReviewSession 選択に依存する付随入力は現状存在しないため専用テストは追加しない。将来そうした依存入力が追加された場合は、選択解除と連動して当該依存入力がリセットされることをこのコンポーネントテスト節で検証する。
- EXAMPLE（Req 3.2）: ADMIN / TEAM_LEADER はフォームを表示、REVIEWER はアクセス拒否（既存）。
- EXAMPLE: TeamAssignment 取得失敗時に候補が空集合となり、UI がクラッシュしないこと。
- アクセシビリティ: 新規のローディング表示（`role="status"`）および空状態メッセージが axe 違反を出さないこと。

### Frontend property tests — `frontend/src/pages/LanguageModelPage.property.test.ts`（純粋ヘルパ対象）

`filterSessionsByAssignment` / `reconcileSelection` を `export` し、UI から切り離してプロパティ検証する（`{ numRuns: 100 }`）。

- **Property 3**: `fc` で任意の `ReviewSession[]` と任意の `assignedSessionIds: Set<string>` を生成し、`filterSessionsByAssignment` の結果が「割り当て集合に含まれるセッションのみ」かつ「一覧内で割り当て集合に含まれるものを漏らさない」ことを検証。
- **Property 4**: 任意の `prevSelected: string[]` と `assignedSessionIds: Set<string>` を生成し、`reconcileSelection` の結果が積集合（新割り当て集合の部分集合であり、前回選択かつ割り当て済みの要素を落とさない）であることを検証。

### Integration

バックエンド無変更（新規ハンドラ・リポジトリ・テーブルアクセスパターンなし）のため、本機能専用の LocalStack 統合テストは不要。既存の `dynamodb-crud.integration.test.ts` が TeamAssignment アイテム（`PK=TEAM#` / `SK=ASSIGNMENT#`）の読み書きを既にカバーしており、`hasTeamAssignment` が読むデータ形状はそれと同一である。
