# Implementation Plan: 完了セッションの読み取り専用化 と 進行中への差し戻し

Source of truth: `.agents/tasks/completed-session-readonly-reopen/design.md` (APPROVED). This plan
sequences that design against the actual repository. No git operations (repo is not under git).

Verification commands (run at the stage noted on each item):
- Backend: `cd backend && npm install` (first time only) `&& npx vitest --run`
- Frontend: `cd frontend && npm install` (first time only) `&& npx vitest --run && npm run build && npm run lint`
- Infra: `cd infra && npm install` (first time only) `&& npx vitest --run && npx cdk synth`

Dependency order: backend guard util → guarded services/handlers → audit type → reopen
service/handler → api-stack route → frontend types/service → error util → SessionReopenControls →
App wiring → ReviewPage read-only.

---

## Feature 1 — COMPLETED session read-only (backend guard + review-screen read-only)

- [ ] 1. Create the shared editable-session guard.
      Add `assertSessionEditable(session: SessionRecord): void` that throws `validationError('このセッションは既に完了しているため編集できません。')` when `session.status === 'COMPLETED'`, and does nothing otherwise. Import `validationError` from `../utils/error-handler.js` and `type SessionRecord` from `../repositories/session-repository.js`.
      Files: `backend/src/utils/session-guard.ts`, `backend/src/utils/session-guard.test.ts`, `backend/src/utils/session-guard.property.test.ts`
      Tests: unit — COMPLETED throws AppError (code `VALIDATION_ERROR`, statusCode 400, the JP message); PENDING/IN_PROGRESS do not throw. Property (`{ numRuns: 100 }`, describe title `Feature: completed-session-readonly, Property 1: COMPLETED は常に編集不可`, docstring `**Validates: Requirements 2.20**`) — over an arbitrary status in {PENDING, IN_PROGRESS, COMPLETED} with random session attributes, throws iff COMPLETED.
      Verify: `cd backend && npx vitest --run src/utils/session-guard` — new tests pass.

- [ ] 2. Guard `createCorrection` in the correction service (covers TEXT create/update/revert and SPEAKER_RENAME, which all flow through POST /sessions/{id}/corrections).
      In `createCorrection`, before the timestamp/`try` block, add: `const session = await getSessionById(sessionId); if (!session) throw validationError('指定されたセッションが見つかりません。'); assertSessionEditable(session);`. Import `getSessionById` from `../repositories/session-repository.js` (same module `addParticipant` already comes from) and `assertSessionEditable` from `../utils/session-guard.js`.
      Files: `backend/src/services/correction-service.ts`, `backend/src/services/correction-service.test.ts`
      Tests: COMPLETED → `createCorrection` throws 400 and `saveCorrection` repository is NOT called; IN_PROGRESS → saves as before (regression). Mock `session-repository.js`/`correction-repository.js` via `vi.mock`.
      Verify: `cd backend && npx vitest --run src/services/correction-service` — pass.

- [ ] 3. Guard `addSpeakerLabel` and `deleteSpeakerLabel` in the session service.
      In each function, immediately after the existing `const session = await getSessionById(...)` + `notFoundError` check, add `assertSessionEditable(session);`. Import `assertSessionEditable` from `../utils/session-guard.js`.
      Files: `backend/src/services/session-service.ts`, `backend/src/services/session-service.test.ts`
      Tests: `addSpeakerLabel`/`deleteSpeakerLabel` on COMPLETED → 400; IN_PROGRESS unchanged (regression).
      Verify: `cd backend && npx vitest --run src/services/session-service` — pass.

- [ ] 4. Guard CONFLICT resolution in `post-consensus-resolve` handler (minimal, no new docClient calls).
      Before the existing `getSegment` call, add `const session = await getSessionById(sessionId); if (!session) throw notFoundError('指定されたセッションが見つかりません。'); assertSessionEditable(session);`. Import `getSessionById` from `../repositories/session-repository.js` and `assertSessionEditable` from `../utils/session-guard.js` (`notFoundError` is already imported).
      Files: `backend/src/handlers/post-consensus-resolve.ts`, `backend/src/handlers/post-consensus-resolve.test.ts`
      Tests: COMPLETED session → 400 with `VALIDATION_ERROR`; existing CONFLICT-resolve success path (non-COMPLETED) still works (regression). Mock `session-repository.js` + `dynamodb-client.js`.
      Verify: `cd backend && npx vitest --run src/handlers/post-consensus-resolve` — pass.

- [ ] 5. Propagate `sessionStatus` to `ReviewPage` and derive read-only mode (keeps download enabled).
      In `ReviewPageProps` add `sessionStatus?: ReviewSessionStatus` (import `ReviewSessionStatus` from `../types/session`). Compute `const isReadOnly = sessionStatus === 'COMPLETED';` then change the switches: `const editingEnabled = Boolean(onSaveCorrection) && !isReadOnly;`, `const suggestionEnabled = Boolean(onFetchSuggestions) && !isReadOnly;`, change `onRevert={onRevertCorrection ? handleRevert : undefined}` to `onRevert={!isReadOnly && onRevertCorrection ? handleRevert : undefined}`, and gate the speaker-manager panel render with `{speakerManagerOpen && !isReadOnly && (...)}`. Add a `role="status"` toolbar note (e.g. `完了したセッションのため編集できません。`) when `isReadOnly`. Leave `TranscriptionDownload` render condition untouched. Add `2.18, 2.19` to the component JSDoc `Requirements:` line.
      Files: `frontend/src/pages/ReviewPage.tsx`, `frontend/src/pages/ReviewPage.test.tsx`
      Tests (vitest-axe `toHaveNoViolations()` in each): `sessionStatus="COMPLETED"` → no 確定/話者ラベル管理/候補/修正前に戻す UI, read-only `role="status"` note present, `TranscriptionDownload` still rendered; `sessionStatus="IN_PROGRESS"` → editing UI present (regression). Wrap in `MemoryRouter`.
      Verify: `cd frontend && npx vitest --run src/pages/ReviewPage` — pass.

- [ ] 6. Pass the live session status from `ReviewPageWrapper` to `ReviewPage`.
      In `ReviewPageWrapper` add `const [sessionStatus, setSessionStatus] = useState<ReviewSessionStatus | undefined>();`, set it in the `detailResult.ok` block via `setSessionStatus(detailResult.value.data.session.status)`, and pass `sessionStatus={sessionStatus}` on the `<ReviewPage ... />` element. Import `ReviewSessionStatus` type if not already in scope (reuse `./types/session`).
      Files: `frontend/src/App.tsx`
      Verify: `cd frontend && npx vitest --run && npm run build && npm run lint` — all pass (full suite + typecheck/lint for the wiring change).

## Feature 2 — ADMIN/TEAM_LEADER reopen COMPLETED → IN_PROGRESS

- [ ] 7. Add the `SESSION_REOPENED` audit operation type.
      Append `| 'SESSION_REOPENED'` to the `AuditOperationType` union. `audit-service.ts` re-exports the type, so no change there.
      Files: `backend/src/repositories/audit-repository.ts`
      Verify: `cd backend && npx vitest --run src/repositories` — existing audit tests pass (typecheck via vitest compile).

- [ ] 8. Add `reopenSession` to the session service.
      New `reopenSession(user: AuthUser, sessionId: string): Promise<SessionRecord>`: `requireRole(user, 'TEAM_LEADER')`; load via `getSessionById` → `notFoundError` on miss; if `!isAdmin(user)`: require `session.assignedTeamId` else `forbiddenError`, then `isTeamMember(user.userId, session.assignedTeamId)` else `forbiddenError`; if `session.status !== 'COMPLETED'` → `validationError('完了していないセッションは差し戻しできません。')`; return `updateSessionStatus(sessionId, 'IN_PROGRESS')` (policy A — status flip only, never touches CONSENSUS#*/SEGMENT#*). `requireRole`, `isAdmin` already imported; `isTeamMember` already imported from `./access-control-service.js`.
      Files: `backend/src/services/session-service.ts`, `backend/src/services/session-service.test.ts`
      Tests: Reviewer → 403; TEAM_LEADER own-team COMPLETED → calls `updateSessionStatus(id,'IN_PROGRESS')`; TEAM_LEADER other-team → 403; ADMIN any COMPLETED → IN_PROGRESS; PENDING/IN_PROGRESS → 400; not found → 404; policy A — only `updateSessionStatus` called, no consensus/segment repository writes.
      Verify: `cd backend && npx vitest --run src/services/session-service` — pass.

- [ ] 9. Add the reopen handler.
      `POST /sessions/{sessionId}/reopen`: `extractUser` → validate `sessionId` (`validationError` on miss) → `const updated = await reopenSession(user, sessionId)` → `recordAuditLog({ actorUserId, actorRole, operationType: 'SESSION_REOPENED', resourceId: sessionId, resourceType: 'ReviewSession' })` → `successResponse({ data: { sessionId, status: updated.status } })`; outer `catch` → `errorResponse(error)`. Mirror imports/JSDoc style of `post-session-aggregate.ts`. Named export `handler`.
      Files: `backend/src/handlers/post-session-reopen.ts`, `backend/src/handlers/post-session-reopen.test.ts`
      Tests: success records `SESSION_REOPENED` once and returns `{ data: { sessionId, status:'IN_PROGRESS' } }`; missing `sessionId` → 400; service AppError (403/404/400) surfaces via `errorResponse` with matching statusCode. Mock `session-service.js` + `audit-service.js`.
      Verify: `cd backend && npx vitest --run src/handlers/post-session-reopen` — pass; then `cd backend && npx vitest --run` — full backend suite green.

- [ ] 10. Register the reopen route in the API stack.
      After `postSessionAggregateFn`, add `const postSessionReopenFn = this.createLambda('PostSessionReopen', { entry: handlersDir, description: 'POST /sessions/{sessionId}/reopen - ADMIN/TEAM_LEADER reopen COMPLETED → IN_PROGRESS', environment: commonEnv });` + `this.grantCommonPermissions(postSessionReopenFn, props);`. After the aggregate `addRoute`, add `this.addRoute('POST', '/sessions/{sessionId}/reopen', postSessionReopenFn, jwtAuthorizer);`.
      Files: `infra/lib/stacks/api-stack.ts`, `infra/test/api-stack.test.ts`
      Tests: add a `hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /sessions/{sessionId}/reopen' })` assertion mirroring the existing route assertions.
      Verify: `cd infra && npx vitest --run && npx cdk synth` — pass; update `__snapshots__` if the api-stack snapshot test changed.

- [ ] 11. Add the frontend reopen type and service function.
      In `types/session.ts` add `export interface ReopenSessionResult { sessionId: string; status: ReviewSessionStatus; }`. In `session-api.ts` add `reopenSession(sessionId): Promise<Result<{ data: ReopenSessionResult }, AppError>>` posting an empty body to `/sessions/${sessionId}/reopen` (mirror `forceAggregateSession`); import `ReopenSessionResult` from `../types/session`.
      Files: `frontend/src/types/session.ts`, `frontend/src/services/session-api.ts`, `frontend/src/services/session-api.test.ts`
      Tests: `reopenSession` calls `POST /sessions/{id}/reopen` with empty body; failure returns `{ ok:false }` AppError.
      Verify: `cd frontend && npx vitest --run src/services/session-api` — pass.

- [ ] 12. Add the Japanese reopen-error mapper.
      `describeReopenError(error: AppError): string` with branches: 403/`FORBIDDEN` → 'このセッションを差し戻す権限がありません。'; 404/`NOT_FOUND` → 'セッションが見つかりません。'; 400/`VALIDATION_ERROR` → '完了していないセッションは差し戻しできません。'; else → '差し戻しに失敗しました。時間をおいて再度お試しください。'. Import `type { AppError } from '../types/api'`.
      Files: `frontend/src/utils/reopen-error.ts`, `frontend/src/utils/reopen-error.test.ts`
      Tests: each branch returns the expected JP string.
      Verify: `cd frontend && npx vitest --run src/utils/reopen-error` — pass.

- [ ] 13. Create `SessionReopenControls` (flat component, mirror of `SessionAggregateControls`).
      Props `{ session: ReviewSession; userRole: UserRole; onReopen: (sessionId: string) => Promise<ReopenSessionResult> }`. `canManage = userRole==='ADMIN'||'TEAM_LEADER'` else `return null`. Button 「進行中に戻す」 disabled unless `session.status==='COMPLETED'` (show supplemental text when not). Confirmation step (`role="group"`, `aria-controls`/`aria-expanded`) with text 「このセッションを進行中に戻します。確定済みの結果は保持されます。実行してよろしいですか。」 and 実行する/キャンセル. Success → `role="status"` 「進行中に戻しました。」; failure → `role="alert"` with `e.message`.
      Files: `frontend/src/components/SessionReopenControls.tsx`, `frontend/src/components/SessionReopenControls.test.tsx`
      Tests (vitest-axe `toHaveNoViolations()`): Reviewer → renders nothing; ADMIN/TEAM_LEADER → button shown; non-COMPLETED → disabled + supplemental text; confirm→execute calls `onReopen(sessionId)` and shows success; rejected `onReopen` shows `role="alert"`.
      Verify: `cd frontend && npx vitest --run src/components/SessionReopenControls` — pass.

- [ ] 14. Wire reopen into the session list via `renderSessionActions`.
      In `SessionListPageWrapper` add `const handleReopen = useCallback(async (sessionId) => { const r = await sessionApi.reopenSession(sessionId); if (!r.ok) throw new Error(describeReopenError(r.error)); await loadSessions(); return r.value.data; }, [sessionApi, loadSessions])`. In `renderSessionActions`, inside the existing `canManage && (...)` area (next to `SessionAggregateControls`), render `<SessionReopenControls session={session} userRole={userRole} onReopen={handleReopen} />`; add `handleReopen` to the `renderSessionActions` useCallback deps. Import `SessionReopenControls` and `describeReopenError`.
      Files: `frontend/src/App.tsx`
      Verify: `cd frontend && npx vitest --run && npm run build && npm run lint` — full frontend suite, typecheck, and lint pass.

---

## Final verification (all stages)

- [ ] 15. Run the complete suites end to end.
      Verify: `cd backend && npx vitest --run` (green); `cd frontend && npx vitest --run && npm run build && npm run lint` (green); `cd infra && npx vitest --run && npx cdk synth` (green).

## Notes / assumptions
- Correction has no dedicated UPDATE/DELETE endpoint; revert and overwrite both POST a new correction through `createCorrection`, so item 2 covers Req 2.20 "作成・更新・削除". (Confirmed in `correction-service.ts` / `App.tsx`.)
- `post-consensus-resolve.ts` keeps its pre-existing docClient usage; only a `getSessionById` + guard is added (no new direct docClient calls), per design NFR-1.
- `updateSessionStatus(sessionId, status)` updates only `status`/`updatedAt` on `SESSION#{id}/METADATA`, so policy A (preserve ConsensusResult/Segment) holds automatically. (Confirmed in `session-repository.ts`.)
- `infra/test/api-stack.test.ts` exists and asserts routes via `hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey })`; add the reopen route assertion there.
