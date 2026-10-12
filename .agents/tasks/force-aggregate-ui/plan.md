# Implementation Plan — 強制集約 UI (Force Aggregate)

セッション一覧画面に、ADMIN / TEAM_LEADER が「強制集約して確定」できるボタンを追加する。既存バックエンド `POST /sessions/{sessionId}/aggregate` を呼ぶ **フロントエンドのみ** の追加。バックエンド・インフラは変更しない。

## Design decisions (grounded in the code I read)

- **別コンポーネントに分離する（既存 `SessionAssignmentControls` には足さない）。** `App.tsx` の `renderSessionActions` は現状 `SessionAssignmentControls` を 1 つだけ返す。これを `<>...</>` フラグメントで `SessionAssignmentControls` と新規 `SessionAggregateControls` を並べて返す形にする。責務（引き受け/割り当て vs 強制集約）が別で、テストも独立させられるため。参照パターンは `SessionAssignmentControls.tsx`（props 形、`busy`/`error` の useState、role チェック `userRole === 'ADMIN' || userRole === 'TEAM_LEADER'`、Tailwind クラス、`role="alert"` のエラー表示）。
- **ロール取得は props 経由。** `SessionAssignmentControls` と同じく `userRole: UserRole` を prop で受ける。`App.tsx` の `SessionListPageWrapper` が既に `userRole`（`auth.user?.role`）を保持しており、`renderSessionActions` 内で渡せる。コンポーネント内で auth を直接触らない（既存コンポーネントの流儀に合わせる）。
- **成功後のリスト更新は「再取得」方式。** `SessionListPageWrapper` の既存ハンドラ（`handleClaim` / `handleAssign` 等）はすべて成功後に `await loadSessions()` を呼んで一覧を再取得している。強制集約も同じ `loadSessions()` 再取得で COMPLETED を反映する。局所 state 更新ではなく既存の慣習（再取得）に合わせる。
- **サービス戻り型は `Result<T, AppError>`。** `SessionApi` の全メソッドが `Promise<Result<..., AppError>>` を返し、`ApiClient.post` がエラーを `AppError` にパース済み。新メソッドもこれに倣う。`App.tsx` の `onClaim` 相当ハンドラは失敗時に `throw new Error(result.error.message)` しており、コンポーネント側は `catch (e) { e instanceof Error ? e.message : ... }` で拾う。強制集約も同じ契約にする。
- **日本語エラー変換は「バックエンドの日本語メッセージをそのまま表示 + フォールバック」。** 確認した `post-session-aggregate.ts` のエラーメッセージ（`このセッションは既に完了しています。`『自チームのセッションのみ集計できます。』等）と `ApiClient` のネットワーク/401/429 メッセージはすべて日本語。よって `App.tsx` 既存の `describeMediaUrlError` に倣い、コード/ステータス別の日本語フォールバック（403→権限、400→状態、その他→`error.message`）を用意しつつ、サーバーメッセージがあればそれを優先表示する。コンポーネントは受け取った文字列をそのまま出す。
- **成功フィードバックは件数を日本語で表示。** レスポンス `{ data: { sessionId, status, totalReviewers, confirmedCount, conflictCount } }` を使い「確定 N 件 / 不一致 N 件 / レビュアー N 名」を `role="status"` で表示する。
- **確認ステップはインライン展開方式（別 modal ライブラリを入れない）。** `SessionAssignmentControls` の「割り当てフォーム」トグルと同じく、押下で確認用の領域（`role="group"` と警告文、実行/キャンセルボタン）を展開する。ネイティブ `window.confirm` は jsdom/axe テストで扱いづらく既存にも例がないため採用しない。

## Verification (run from `frontend/`)

```bash
cd frontend
npm install            # 初回のみ（node_modules が無ければ）
npx vitest --run       # 単体テスト全体（新規テスト含む）
npm run build          # tsc -b による型チェック + vite build
npm run lint           # eslint
```

新規テストだけ回す場合: `npx vitest --run src/components/SessionAggregateControls.test.tsx src/services/session-api.test.ts`

---

## Steps

- [ ] 1. 強制集約レスポンスの型を `frontend/src/types/session.ts` に追加する。
      `ForceAggregateResult { sessionId: string; status: ReviewSessionStatus; totalReviewers: number; confirmedCount: number; conflictCount: number }` を named export で追記（バックエンド `post-session-aggregate.ts` の `data` 形に一致）。識別子・コメントは英語。
      Files: `frontend/src/types/session.ts`
      Verify: `cd frontend && npx vitest --run src/services/session-api.test.ts`（型参照が壊れていないこと）、最終的に step 7 の `npm run build` で型確認。

- [ ] 2. `SessionApi` に `forceAggregateSession` メソッドを追加する。
      シグネチャ: `async forceAggregateSession(sessionId: string): Promise<Result<{ data: ForceAggregateResult }, AppError>>`。実装は `return this.client.post<{ data: ForceAggregateResult }>(\`/sessions/${sessionId}/aggregate\`, {});`（`claimSession` の `POST .../join` と同じ空ボディ形）。`ForceAggregateResult` を `../types/session` から `import type` する。JSDoc に `POST /sessions/{sessionId}/aggregate`（ADMIN は全セッション、TEAM_LEADER は自チームのみ）を記す。
      Files: `frontend/src/services/session-api.ts`
      Verify: step 3 のテストで検証。

- [ ] 3. `session-api.test.ts` に `forceAggregateSession` の単体テストを追加する。
      既存 `describe('claimSession')` と同じモック client 流儀（`mockClient.post`）で: (a) `POST /sessions/{id}/aggregate` を空ボディで呼ぶこと、成功時 `result.ok === true` かつ `value.data.status === 'COMPLETED'`; (b) 400（既に完了, `VALIDATION_ERROR`）で `result.ok === false`; (c) 403（`FORBIDDEN`）で `result.ok === false` かつ `error.code === 'FORBIDDEN'`。
      Files: `frontend/src/services/session-api.test.ts`
      Verify: `cd frontend && npx vitest --run src/services/session-api.test.ts` — 新規 3 ケースがパス。

- [ ] 4. 日本語エラー変換ヘルパー付きで新規コンポーネント `SessionAggregateControls` を作成する。
      Props: `{ session: ReviewSession; userRole: UserRole; onAggregate: (sessionId: string) => Promise<ForceAggregateResult> }`。構造は `SessionAssignmentControls` に倣う:
      - `canManage = userRole === 'ADMIN' || userRole === 'TEAM_LEADER'`。false なら `null` を返す（Reviewer 非表示, Req 1）。
      - `isCompleted = session.status === 'COMPLETED'`。ボタンは常に表示しつつ `disabled={isCompleted || busy}`、完了時は補助テキスト「このセッションは既に完了しています。」を併記（Req 2）。
      - ボタン「強制集約して確定」。押下で確認領域を展開（`showConfirm` state）。確認領域に警告文（例「集約を実行するとセッションは完了となり、元に戻せません。」）と「実行する」「キャンセル」ボタン（Req 3）。
      - 「実行する」で `busy=true` → `await onAggregate(session.sessionId)` → 成功時 `result` を保持し `showConfirm=false`、`role="status"` で「集約が完了しました。確定 {confirmedCount} 件 / 不一致 {conflictCount} 件 / レビュアー {totalReviewers} 名」を表示（Req 4）。
      - エラーは try/catch。`onAggregate` が投げた `Error.message`（App 側で日本語化済み文字列）を `role="alert"` で表示。メッセージが無い場合のフォールバック「集約に失敗しました。」(Req 5)。
      - a11y（Req 6）: ボタンに `aria-label`、確認領域は `role="group"` + `aria-label`、トグルボタンに `aria-expanded`、`focus:ring` クラス。ユーザー向けテキストは日本語、識別子/コメントは英語。
      - 複数項目で id 衝突しないよう、必要なら `session.sessionId` を id サフィックスに使う（`SessionAssignmentControls` の `assign-team-${session.sessionId}` 流儀）。
      Files: `frontend/src/components/SessionAggregateControls.tsx`
      Verify: step 5 のテストで検証。

- [ ] 5. `SessionAggregateControls` の単体テストを作成する（`SessionAssignmentControls.test.tsx` のスタイル）。
      `createSession` ファクトリ（status 既定 `PENDING`）を用意。`vi.fn()` で `onAggregate` をモック。ケース（各 Req 対応）:
      - a11y: `const { container } = render(...)` → `expect(await axe(container)).toHaveNoViolations()`（TEAM_LEADER で展開前・展開後の両方、または確認領域展開後に 1 回）(Req 6)。
      - Reviewer では「強制集約して確定」ボタンが出ない（`queryByRole('button', { name: /強制集約/ })` が null）(Req 1)。
      - ADMIN / TEAM_LEADER では出る (Req 1)。
      - `status: 'COMPLETED'` ではボタンが `disabled`、完了テキスト表示 (Req 2)。
      - 押下で確認領域が出る → 「キャンセル」で消える / 「実行する」で初めて `onAggregate` が `sessionId` で呼ばれる（確認なしでは呼ばれないこと）(Req 3)。
      - 成功: `onAggregate` が `{ sessionId, status:'COMPLETED', totalReviewers:2, confirmedCount:1, conflictCount:1 }` を resolve → 「確定 1 件」「不一致 1 件」「レビュアー 2 名」が表示される（`findByText` / 正規表現）(Req 4)。
      - エラー: `onAggregate` が `new Error('このセッションは既に完了しています。')` を reject → `role="alert"` にそのメッセージ (Req 5)。
      `MemoryRouter` は props に navigation が無ければ不要（`SessionAssignmentControls.test.tsx` も未使用）。ルーティング依存を入れた場合のみラップ。
      Files: `frontend/src/components/SessionAggregateControls.test.tsx`
      Verify: `cd frontend && npx vitest --run src/components/SessionAggregateControls.test.tsx` — 全ケースパス、a11y 違反なし。

- [ ] 6. `App.tsx` の `SessionListPageWrapper` に強制集約を配線する。
      - import に `SessionAggregateControls` と（必要なら）型 `ForceAggregateResult` を追加。
      - `describeAggregateError(error: AppError): string` ヘルパーを追加（`describeMediaUrlError` に倣う）: 403/`FORBIDDEN`→「このセッションを集約する権限がありません。」、400/`VALIDATION_ERROR`→`error.message`（既に完了等の日本語をそのまま）、その他→`error.message` があればそれ、無ければ「集約に失敗しました。」。
      - `handleForceAggregate = useCallback(async (sessionId) => { const result = await sessionApi.forceAggregateSession(sessionId); if (!result.ok) { throw new Error(describeAggregateError(result.error)); } await loadSessions(); return result.value.data; }, [sessionApi, loadSessions])`。成功後 `loadSessions()` で COMPLETED 反映（Req 4）。戻り値 `data` を UI の成功表示に使う。
      - `renderSessionActions` の返り値を `<> <SessionAssignmentControls .../> {userRole && (userRole==='ADMIN'||userRole==='TEAM_LEADER') && <SessionAggregateControls session={session} userRole={userRole} onAggregate={handleForceAggregate} />} </>` に変更。`useCallback` の依存配列に `handleForceAggregate` を追加。
      - `SessionListPage` の props シグネチャ（`renderSessionActions` 等）は一切変更しない。
      Files: `frontend/src/App.tsx`
      Verify: `cd frontend && npm run build`（型チェック）、`npx vitest --run`（既存 `SessionListPage.test.tsx` / `SessionAssignmentControls.test.tsx` の回帰なし）。

- [ ] 7. 全体検証とクリーンアップ。
      フロントエンド全体の型チェック・テスト・lint を通す。生成した一時ファイルがあれば削除。
      Files: （検証のみ）
      Verify: `cd frontend && npx vitest --run` 全パス、`npm run build` 成功（型エラー 0）、`npm run lint` 違反 0。

## Requirement → test coverage map

| Req | 内容 | 検証ステップ |
|-----|------|--------------|
| 1 | ADMIN/TEAM_LEADER のみ表示、Reviewer 非表示 | step 5（role 表示/非表示）、step 6（配線） |
| 2 | COMPLETED は無効化 | step 5（disabled + 完了テキスト） |
| 3 | 確認ステップ後に API 呼び出し | step 5（確認なしで未呼び出し、実行で呼び出し） |
| 4 | 成功時に件数表示 + 一覧 COMPLETED 反映 | step 5（件数表示）、step 6（`loadSessions` 再取得） |
| 5 | エラー時に日本語表示 | step 3（サービス）、step 5（alert）、step 6（`describeAggregateError`） |
| 6 | WCAG 2.1 AA（`toHaveNoViolations`） | step 5（axe、aria 属性） |

## Verification note (iteration 1 — implemented)

実装完了。実行コマンドと結果（cwd: `frontend/`、`node_modules` は既存）:

- `npx vitest --run src/components/SessionAggregateControls.test.tsx src/services/session-api.test.ts`
  → 2 files / 20 tests PASS（新規コンポーネント 7 + サービス追加 3 を含む）。
- `npx vitest --run src/pages/SessionListPage.test.tsx src/components/SessionAssignmentControls.test.tsx src/components/SessionAggregateControls.test.tsx src/services/session-api.test.ts src/App.test.tsx`
  → 5 files / 74 tests PASS（セッション周りの回帰なし）。
- `npx vitest --run`（全体）→ 1050 tests 中 1048 PASS / 2 FAIL。失敗は `src/App.test.tsx`（login route）と
  `src/services/offline-sync-queue.property.test.ts` の **5000ms タイムアウト**で、本変更と無関係。
  両ファイルを単独再実行すると `2 files / 5 tests PASS`（全体同時実行時のリソース競合による flaky タイムアウトと判断）。
- `npm run build`（`tsc -b && vite build`）→ 型エラー 0、ビルド成功。
- `npm run lint` → 既存の lint エラーのみ（`auth-context.tsx`, `vitest-axe.d.ts`, `App.tsx:773` の RankingPageWrapper 等）。
  本変更で追加・編集したファイル（`SessionAggregateControls.tsx` / `.test.tsx`, `session-api.ts` / `.test.ts`,
  `types/session.ts`, `App.tsx` の追加箇所）には新規 lint エラーなし。

a11y: `SessionAggregateControls.test.tsx` に確認領域展開後の `expect(await axe(container)).toHaveNoViolations()` を含む。

## Verification note (iteration 2 — review fix)

レビュー指摘（`review.json` / `review.md`, blocking / confirmed「英語 API エラーの素通し」）に対応した。

- 問題: `App.tsx` の `describeAggregateError` が必須の `error.message` をコード／ステータス判定より
  先に `return` していたため、`FORBIDDEN`(403) / `VALIDATION_ERROR`(400) が英語メッセージの場合そのまま
  利用者へ露出し、英語→日本語変換を求める Req 5 に反していた。
- 修正:
  1. 変換ロジックをコード／ステータス優先の判定順に直し、既知分岐（403→権限、400→状態）は常に
     日本語定型文を返す。その他は英語メッセージを素通ししない日本語の汎用文を返す。
  2. 変換ヘルパーを `frontend/src/utils/aggregate-error.ts`（既存 `session-name.ts` の
     `describeRenameError` と同じ流儀）へ切り出し、`App.tsx` はそれを import する形に変更。
     （`App.tsx` から非コンポーネントを named export すると `react-refresh/only-export-components`
     の新規 lint エラーになるため、utils へ移設してテスト可能性と lint 清潔性を両立。）
  3. 英語メッセージ入力の変換テストを `frontend/src/utils/aggregate-error.test.ts` に追加
     （403 英語 / 400 英語 / statusCode 欠落時の code 判定 / 未知コードのフォールバック）。

実行コマンドと結果（cwd: `frontend/`、`node_modules` は既存）:

- `npx vitest --run src/utils/aggregate-error.test.ts src/components/SessionAggregateControls.test.tsx src/services/session-api.test.ts src/App.test.tsx`
  → 4 files / 28 tests PASS（新規変換テスト 4 を含む）。
- `npm run build`（`tsc -b && vite build`）→ 型エラー 0、ビルド成功。
- `npx vitest --run`（全体）→ 87 files / 1054 tests ALL PASS（前回報告の 2 件 flaky タイムアウトも含め今回は全緑）。
- `npx eslint src/App.tsx src/utils/aggregate-error.ts src/utils/aggregate-error.test.ts src/App.test.tsx`
  → 追加・編集ファイルに新規 lint エラーなし。`App.tsx` に残るのは既存の `RankingPageWrapper` の
  `react-hooks/set-state-in-effect`（本変更と無関係）のみ。前イテレーションで混入していた
  `App.tsx:62 react-refresh/only-export-components` は utils 移設により解消。

## Guardrails confirmed

- `backend/` と `infra/` は変更しない（呼ぶだけ）。
- `SessionListPage` の既存 props を破壊しない（`renderSessionActions` 経由で注入）。
- 新規トップレベルディレクトリ・`components/` 配下のサブディレクトリを作らない（`components/` はフラット）。
- フロント/バックでの型共有はしない（型は `frontend/src/types/session.ts` に独自定義）。
