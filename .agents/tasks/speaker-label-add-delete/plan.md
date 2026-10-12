# Implementation Plan — 話者ラベルの追加・削除（校閲画面）

## Goal

校閲画面（ReviewPage の SpeakerLabelManager パネル）で話者ラベルを追加・削除できるようにする。
削除時はサービス層でそのセッション内のどの Segment にもそのラベルが使われていないことを確認してから削除する。追加・削除は監査ログに記録する。

## Design decisions (grounded in the codebase)

- **D1 — Speaker-label master on Session.** 既存の暗黙ラベル（Segment.speakerLabel の集合）に加え、`ReviewSession` に明示マスタ `speakerLabels: string[]` を追加する。これにより、どの Segment にも割り当てられていない空ラベルを追加・保持できる（確認済み要件1）。既存の Segment.speakerLabel 機構はそのまま維持する。
- **D2 — DynamoDB 格納先.** マスタは Session の METADATA アイテム（PK=`SESSION#{sessionId}`, SK=`METADATA`）の `speakerLabels` 属性として格納する。`session-repository.ts` の `mapItemToSessionRecord` / `createSession` に追加し、`DynamoDBDocumentClient` は `removeUndefinedValues: true` 前提なので未設定時は属性を省略できる。
- **D3 — レイヤー配置.** 使用チェック（business logic）は `session-service.ts` に実装する。Segment の読み取りは専用リポジトリが存在しない（get-segments.ts / download-service.ts がインラインで Query している）ため、`session-repository.ts` に Segment の話者ラベルを取得する読み取り関数 `getSegmentSpeakerLabels(sessionId)` を追加し、service はそれを呼ぶ（Handler→Service→Repository を厳守）。
- **D4 — ラベル一覧の UNION.** 画面に出すラベル一覧は「Session.speakerLabels（マスタ）」∪「Segment 由来のラベル」。フロントのこの合成は `frontend/src/utils/speaker-labels.ts` の新ヘルパー `mergeSpeakerLabels(segments, masterLabels)` で行い、SpeakerLabelManager はそれを使う。
- **D5 — エンドポイント.** 既存の session REST 規約（`POST /sessions/{sessionId}/join`, `PATCH /sessions/{sessionId}/name` 等）に合わせ、`POST /sessions/{sessionId}/speaker-labels`（追加）と `DELETE /sessions/{sessionId}/speaker-labels/{label}`（削除）を 1 ファイル 1 ハンドラで追加する。認可は `checkSessionAccess(user, sessionId)`（アクセス不可は 404）。
  - DELETE のラベルはパスパラメータ。API Gateway は URL デコード済みの値を `pathParameters` に渡すが、スラッシュ等を含むラベルはパス解決で壊れるため、ハンドラ側で `decodeURIComponent` を1回適用し、空文字は validationError とする。フロントは `encodeURIComponent(label)` で送る。
- **D6 — 監査ログ.** 追加・削除は書き込み操作なので `recordAuditLog` で記録する。既存の `AuditOperationType` に `SPEAKER_LABEL_CHANGED` が既にあるため**それを再利用**し、`metadata` に `{ action: 'ADD' | 'DELETE', label }` を入れる（新 operationType は追加しない）。resourceType は `'ReviewSession'`、resourceId は sessionId。
- **D7 — フロント配線.** マスタ `speakerLabels` は GET /sessions/{sessionId}（get-session-detail）のレスポンス `session` に含めて返す（session をそのまま返しているので D2 の変更で自動的に含まれる）。App.tsx が state で保持し、追加/削除成功時に更新、SpeakerLabelManager に渡す。API 呼び出しは `session-api.ts` に `addSpeakerLabel` / `deleteSpeakerLabel` を追加。
- **D8 — 検証ルール（追加）.** トリム後の空文字は拒否。既存ラベル（マスタ∪Segment 由来）と重複する名前は拒否。いずれも英語 message の AppError（フロントで日本語表示）。
- **D9 — プロパティテスト.** 'Deletion' は property-based-test 必須対象。削除の正しさ（未使用ラベルのみ削除でき、使用中ラベルは必ず拒否される）を `session-service.property.test.ts` でカバーする。

---

## Ordered items

- [x] 1. Add `speakerLabels` to the backend Session type and shared types.
      `ReviewSession` インターフェースに `speakerLabels?: string[]` を追加（JSDoc で「master list; union with segment-derived labels in UI」を明記）。
      Files: `backend/src/types/index.ts`
      Verify: `cd backend && npx vitest --run` が型エラーなく通る（この時点では挙動変更なし）。

- [x] 2. Persist and read `speakerLabels` in the session repository.
      `SessionRecord` に `speakerLabels?: string[]` を追加。`mapItemToSessionRecord` で `item['speakerLabels']` を読む。`createSession` では未指定時は属性を書かない（`removeUndefinedValues` 前提）。マスタ更新用に `updateSessionSpeakerLabels(sessionId, labels: string[]): Promise<SessionRecord>`（UpdateCommand, `SET speakerLabels = :labels, updatedAt = :now`, ReturnValues ALL_NEW）を追加。Segment の話者ラベル取得用に `getSegmentSpeakerLabels(sessionId): Promise<string[]>`（PK=`SESSION#{sessionId}`, begins_with(SK,'SEGMENT#') を Query し、`speakerLabel` が存在する項目を集めて重複排除）を追加。
      Files: `backend/src/repositories/session-repository.ts`, `backend/src/repositories/session-repository.test.ts`
      Verify: `cd backend && npx vitest --run src/repositories/session-repository` が通る（新規ユニットテスト: speakerLabels の round-trip、updateSessionSpeakerLabels の UpdateExpression、getSegmentSpeakerLabels の重複排除）。

- [x] 3. Implement add/delete speaker-label business logic in the session service.
      `addSpeakerLabel(sessionId, rawLabel)`: トリム→空なら `validationError`→現マスタ（session.speakerLabels ?? []）と Segment 由来ラベル（`getSegmentSpeakerLabels`）の UNION に対して重複チェック（重複なら `validationError`）→マスタに追加して `updateSessionSpeakerLabels` を呼び、更新後 session を返す。session 不在は `notFoundError`。
      `deleteSpeakerLabel(sessionId, label)`: session 不在は `notFoundError`。使用チェック: `getSegmentSpeakerLabels(sessionId)` にそのラベルが含まれるなら `validationError('Speaker label is in use and cannot be deleted.')`。マスタに無ければ `notFoundError`（存在しないラベル）。未使用かつマスタに有れば、マスタから除いて `updateSessionSpeakerLabels` を呼び、更新後 session を返す。英語 message を使う。
      Files: `backend/src/services/session-service.ts`, `backend/src/services/session-service.test.ts`
      Verify: `cd backend && npx vitest --run src/services/session-service` が通る（追加の重複拒否/空拒否、削除の使用中拒否・未使用許可・不在 404 を網羅）。

- [x] 4. Add the deletion-correctness property test (required 'Deletion' target).
      `describe('Feature: speaker-label-delete, Property N: ...')` 形式で fast-check（numRuns:100）。性質例: 任意のラベル集合・Segment 集合に対し、(a) あるラベルが Segment に 1 件でも使われていれば `deleteSpeakerLabel` は必ず `validationError` を投げる、(b) 使われていなければマスタから当該ラベルだけが取り除かれ他は不変。docstring に「Validates: 確認済み要件3（削除前の未使用チェック）」を記載。repository 関数は `vi.mock` でスタブする。
      Files: `backend/src/services/session-service.property.test.ts`
      Verify: `cd backend && npx vitest --run src/services/session-service.property.test.ts` が通る。

- [x] 5. Add the `post-speaker-label` handler (add).
      `POST /sessions/{sessionId}/speaker-labels`。テンプレは `patch-session-name.ts` に倣う: extractUser→sessionId 検証→`checkSessionAccess`→body の `label`（string）検証→`addSpeakerLabel`→`recordAuditLog`（operationType `SPEAKER_LABEL_CHANGED`, metadata `{ action: 'ADD', label }`）→`successResponse({ data: session })`。JSDoc 必須。named export `handler`。
      Files: `backend/src/handlers/post-speaker-label.ts`, `backend/src/handlers/post-speaker-label.test.ts`
      Verify: `cd backend && npx vitest --run src/handlers/post-speaker-label` が通る（成功、空 body 400、access 拒否 404、重複 400 を service モックで）。

- [x] 6. Add the `delete-speaker-label` handler (delete).
      `DELETE /sessions/{sessionId}/speaker-labels/{label}`。extractUser→sessionId 検証→`label = decodeURIComponent(pathParameters.label)`（空なら validationError）→`checkSessionAccess`→`deleteSpeakerLabel`→`recordAuditLog`（metadata `{ action: 'DELETE', label }`）→`successResponse({ data: session })`。JSDoc 必須。named export `handler`。
      Files: `backend/src/handlers/delete-speaker-label.ts`, `backend/src/handlers/delete-speaker-label.test.ts`
      Verify: `cd backend && npx vitest --run src/handlers/delete-speaker-label` が通る（成功、使用中 400、access 拒否 404、label 欠落 400 を service モックで）。

- [x] 7. Run the full backend suite to confirm no regressions.
      Files: （変更なし — 検証のみ）
      Verify: `cd backend && npm install`（必要時）→ `npx vitest --run` が全件パス、TS/型エラーなし。

- [x] 8. Register the two new routes + Lambdas in the API stack.
      `createLambda('PostSpeakerLabel', { entry: handlersDir, description: 'POST /sessions/{sessionId}/speaker-labels - Add speaker label', environment: commonEnv })` と `createLambda('DeleteSpeakerLabel', { ..., description: 'DELETE /sessions/{sessionId}/speaker-labels/{label} - Delete speaker label', ... })` を追加し、それぞれ `grantCommonPermissions(fn, props)`（DynamoDB RW + KMS; 監査ログ書き込みに必要）。ルートは Segments 近辺に `addRoute('POST', '/sessions/{sessionId}/speaker-labels', ...)` と `addRoute('DELETE', '/sessions/{sessionId}/speaker-labels/{label}', ...)` を追加。既存の least-privilege per-Lambda ロール規約（createLambda が個別ロールを作る）に従う。
      Files: `infra/lib/stacks/api-stack.ts`
      Verify: `cd infra && npm install`（必要時）→ `npx vitest --run -u` でスナップショット更新 → 再度 `npx vitest --run` が全件パス（route アサーションと個別 IAM ロールのテストが通ること）。

- [x] 9. Add `speakerLabels` to the frontend Session type and merge helper.
      `ReviewSession`（frontend）に `speakerLabels?: string[]` を追加。`speaker-labels.ts` に `mergeSpeakerLabels(segments: Segment[], masterLabels?: string[]): string[]`（Segment 由来ラベル∪マスタ、出現順を保ちつつマスタの空ラベルも含める、重複排除）を追加。
      Files: `frontend/src/types/session.ts`, `frontend/src/utils/speaker-labels.ts`, `frontend/src/utils/speaker-labels.test.ts`
      Verify: `cd frontend && npx vitest --run src/utils/speaker-labels` が通る（UNION・重複排除・順序のユニットテスト）。

- [x] 10. Add add/delete API calls to the frontend session API client.
      `SessionApi` に `addSpeakerLabel(sessionId, label): Promise<Result<{ data: ReviewSession }, AppError>>`（`POST /sessions/${sessionId}/speaker-labels`, body `{ label }`）と `deleteSpeakerLabel(sessionId, label)`（`DELETE /sessions/${sessionId}/speaker-labels/${encodeURIComponent(label)}`）を追加。JSDoc に日本語概要。
      Files: `frontend/src/services/session-api.ts`
      Verify: `cd frontend && npx vitest --run` の該当範囲が型エラーなく通る（既存 session-api テストがあれば緑のまま）。

- [x] 11. Add add/delete UI to SpeakerLabelManager.
      props に `masterLabels?: string[]`、`onAddLabel?: (label: string) => Promise<string | null>`（成功時 null、失敗時は日本語エラーメッセージ）、`onDeleteLabel?: (label: string) => Promise<string | null>` を追加。一覧は `mergeSpeakerLabels(segments, masterLabels)` を使う。入力+「追加」ボタンで追加（トリム後空・重複はクライアント側でも日本語エラー表示し、サーバーエラーメッセージも表示）。各ラベル行に「削除」ボタンを追加し、使用中（`countSegmentsWithLabel > 0`）はボタンを `disabled`＋理由（例: 「このラベルは使用中のため削除できません」）を表示。削除失敗時はサーバーからの文言を日本語で表示。既存の rename UI/マージダイアログは維持。すべてのインタラクティブ要素に `aria-label` を付与。
      Files: `frontend/src/components/SpeakerLabelManager.tsx`, `frontend/src/components/SpeakerLabelManager.test.tsx`
      Verify: `cd frontend && npx vitest --run src/components/SpeakerLabelManager` が通る。コンポーネントテストで `expect(container).toHaveNoViolations()`（vitest-axe, WCAG 2.1 AA）を含める。追加/削除/使用中無効化/重複拒否の各ケースを検証。

- [x] 12. Wire add/delete handlers through ReviewPage.
      `ReviewPageProps` に `masterSpeakerLabels?: string[]`、`onAddSpeakerLabel?`, `onDeleteSpeakerLabel?` を追加し、`SpeakerLabelManager` に渡す。`hasSpeakerLabels`（話者管理パネルの表示条件）は「Segment にラベルがある **または** マスタが非空」に拡張（マスタだけ存在する場合でもパネルを開けるように）。既存の rename 配線は変更しない。
      Files: `frontend/src/pages/ReviewPage.tsx`, `frontend/src/pages/ReviewPage.test.tsx`
      Verify: `cd frontend && npx vitest --run src/pages/ReviewPage` が通る（props 伝播と a11y）。

- [x] 13. Wire state + handlers in App.tsx (ReviewPageWrapper).
      session 詳細取得時に `detailResult.value.data.session.speakerLabels` を state（`masterSpeakerLabels`）に保存。`handleAddSpeakerLabel(label)` は `apis.session.addSpeakerLabel` を呼び、成功時 `setMasterSpeakerLabels(result.value.data.speakerLabels ?? [])` を更新して null を返し、失敗時はエラーメッセージ（`result.error.message` を日本語化方針に沿って）を返す。`handleDeleteSpeakerLabel` も同様。これらと `masterSpeakerLabels` を `ReviewPage` に渡す。
      Files: `frontend/src/App.tsx`
      Verify: `cd frontend && npx vitest --run` が全件パス、TS/型エラーなし。

- [x] 14. Run the full frontend suite to confirm no regressions.
      Files: （変更なし — 検証のみ）
      Verify: `cd frontend && npm install`（必要時）→ `npx vitest --run` が全件パス。

- [x] 15. Final cross-package verification.
      Files: （変更なし — 検証のみ）
      Verify: backend `cd backend && npx vitest --run` 全件パス、frontend `cd frontend && npx vitest --run` 全件パス、infra `cd infra && npx vitest --run` 全件パス（または `npx cdk diff --all` が新 route/Lambda のみの差分を示す）。LocalStack 統合テストは対象外。

## Notes / assumptions

- 新 operationType は追加しない。既存 `SPEAKER_LABEL_CHANGED` を add/delete 双方で再利用し、`metadata.action` で区別する（D6）。もしレビューで「追加と削除を監査上明確に分けたい」要望が出た場合のみ `types/index.ts` に operationType を追加する軽微な拡張で対応可能。
- 削除の使用チェックは **サービス層のみ** が正とする（フロントの disabled はあくまで UX 補助で、最終判定はバックエンド）。
- マスタ `speakerLabels` を get-session-detail が返すのは、session オブジェクトをそのまま返しているため repository 変更（item 2）だけで自動的に成立する。別途ハンドラ改修は不要だが、item 12 の `hasSpeakerLabels` 拡張でマスタのみのケースも UI に反映する。
- Git は使用しない（当該ディレクトリは Git リポジトリではない）。すべての編集は作業ツリー内で直接行う。
