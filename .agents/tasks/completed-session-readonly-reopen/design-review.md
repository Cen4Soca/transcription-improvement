# Design Review: 完了セッションの読み取り専用化 と 進行中への差し戻し

Reviewed document: `.agents/tasks/completed-session-readonly-reopen/design.md`
Reviewer: design-review subagent (fresh read, claims verified against source)
Verdict: **APPROVED** (0 HIGH, 0 MEDIUM, 4 NIT)

---

## Scope of verification

This design was reviewed against the actual repository source, not taken at its
word. Every structural claim it makes about existing files was opened and
checked. The design is unusually precise; the vast majority of its assertions
about the current codebase are correct.

---

## Findings

All findings below are NIT. None block implementation.

### 1. NIT — `reopenSession` frontend return type is described two ways

In §2.6 the design first shows the service function returning
`Result<{ data: { sessionId: string; status: ReviewSessionStatus } }, AppError>`
(inline shape) and then, under "型", defines `ReopenSessionResult { sessionId, status }`
and says the return should be `Result<{ data: ReopenSessionResult }, AppError>`.
The two are structurally identical, so this is a cosmetic inconsistency, not a
behavioral conflict.

Concrete fix: use the named alias in both places —
```ts
async reopenSession(
  sessionId: string
): Promise<Result<{ data: ReopenSessionResult }, AppError>> {
  return this.client.post<{ data: ReopenSessionResult }>(
    `/sessions/${sessionId}/reopen`,
    {}
  );
}
```

### 2. NIT — `reopen-error.ts` AppError import path not stated

The `describeReopenError` snippet references `AppError` but does not specify the
import. The sibling file it mirrors (`frontend/src/utils/aggregate-error.ts`)
imports from `../types/api` (verified). State it explicitly:
```ts
import type { AppError } from '../types/api';
```

### 3. NIT — `describeReopenError` collapses all 400s to one message

The 400 / `VALIDATION_ERROR` branch always returns
「完了していないセッションは差し戻しできません。」. A 400 can also originate from a
missing `sessionId` path param (`'sessionId パスパラメータが必要です。'`). Because the
frontend always supplies `sessionId`, this is acceptable in practice, but the
mapping is slightly imprecise. Optionally key the message on
`error.message`/`details` when a non-state 400 is distinguishable, or leave as-is
and accept the generic fallback.

### 4. NIT — `ReviewPage` JSDoc Requirements list not updated

The design adds `sessionStatus?: ReviewSessionStatus` to `ReviewPageProps` but
does not mention updating the component JSDoc `Requirements:` line (currently
lists `5.8` among others). Adding `2.18, 2.19` to that JSDoc keeps the
requirement-trace convention intact. Trivial.

---

## Verified Assumptions (checked against source)

1. **`SessionRecord` lives in `session-repository.ts`** — confirmed. The guard's
   `import type { SessionRecord } from '../repositories/session-repository.js'`
   is correct (it is NOT in `types/index.ts`).
2. **`SessionRecord.status` union is `'PENDING' | 'IN_PROGRESS' | 'COMPLETED'`** —
   confirmed. The `=== 'COMPLETED'` guard is type-safe.
3. **`correction-service.ts` already imports `addParticipant` from
   `session-repository.js`** — confirmed. Adding `getSessionById` from the same
   module is a natural extension and is a service-layer repository call
   (layering-compliant, NFR-1).
4. **Placing `assertSessionEditable` BEFORE the `try` in `createCorrection` is
   required** — confirmed and important. The existing catch re-throws only when
   `error.name === 'AppError'` and otherwise wraps in `internalError`. `AppError`
   sets `name = 'AppError'` (verified in `error-handler.ts`), so even if the
   guard throw landed inside the try it would propagate as-is; placing it before
   the try (as the design states, "タイムスタンプ生成前") is cleaner and correct.
5. **`validationError` → 400 / `VALIDATION_ERROR`** — confirmed in
   `error-handler.ts`. Acceptance criteria 4/5 response shape is accurate.
6. **`addSpeakerLabel` / `deleteSpeakerLabel` both load the session via
   `getSessionById` and `notFoundError` on miss** — confirmed. The guard slots in
   "直後" exactly as described, one line each.
7. **`post-consensus-resolve.ts` is ADMIN-only and calls docClient directly
   (pre-existing NFR-1 violation)** — confirmed. The design's minimal approach
   (add `getSessionById` + guard without a full service extraction) is a
   reasonable, clearly justified exception.
8. **`post-session-aggregate.ts` pattern: `requireRole(user,'TEAM_LEADER')` +
   `isAdmin` branch + `!assignedTeamId → forbiddenError` + `isTeamMember` +
   `recordAuditLog`** — confirmed. `reopenSession` mirrors it faithfully. The
   `assignSession` service in `session-service.ts` uses the same shape, so
   putting `reopenSession` in that service is consistent.
9. **`VALID_STATUS_TRANSITIONS.COMPLETED = []`** — confirmed in
   `session-service.ts`. The rationale for NOT routing reopen through
   `changeSessionStatus` (it would be blocked by the transition table, and the
   permission model differs) is correct.
10. **`updateSessionStatus(sessionId, status)` updates only `status` +
    `updatedAt` on `SESSION#{id}/METADATA`** — confirmed. It never touches
    `CONSENSUS#*` or `SEGMENT#*` items, so policy A (preserve ConsensusResult /
    Segment consensusStatus) holds automatically. Acceptance criterion 9 is
    satisfiable as described.
11. **`recordAuditLog` generates `logId` + `createdAt` internally** — confirmed in
    `audit-service.ts`. The handler call without those fields is correct, and the
    `SESSION_REOPENED` audit (resourceId=sessionId, no metadata) satisfies
    criterion 10. `AuditOperationType` does NOT currently include
    `SESSION_REOPENED` — the design correctly flags adding it to the union.
12. **`patch-session-status.ts` records `SESSION_COMPLETED` in the handler** —
    confirmed. The design's choice to place the `SESSION_REOPENED` audit in the
    handler (not the service) matches this precedent.
13. **api-stack.ts: `createLambda('PostSessionAggregate', …)` +
    `grantCommonPermissions` + `addRoute('POST', '/sessions/{sessionId}/aggregate', …, jwtAuthorizer)`
    and `toPascalToKebab` filename resolution** — all confirmed. `PostSessionReopen`
    → `post-session-reopen.ts` resolves correctly. Routes are registered in a
    separate block (~line 1229), matching the design's "addRoute の直後".
14. **`ReviewPage` editability switches** — confirmed exactly:
    `editingEnabled = Boolean(onSaveCorrection)`,
    `suggestionEnabled = Boolean(onFetchSuggestions)`,
    `onRevert={onRevertCorrection ? handleRevert : undefined}`,
    `onSpeakerChange={editingEnabled ? handleSpeakerChange : undefined}`,
    話者ラベル管理ボタン `{editingEnabled && hasSpeakerLabels && …}`,
    話者管理パネル `{speakerManagerOpen && …}`,
    `TranscriptionDownload` guarded only by `transcriptionApi && sessionId && sessionName`
    (independent of edit state). The read-only strategy (gate the existing
    switches; leave download untouched) is sound and minimal.
15. **`ReviewPageWrapper` already fetches `getSessionDetail` and reads
    `session.name` / `session.speakerLabels`; `SessionDetailResponse.data.session`
    is a `ReviewSession` that includes `status`** — confirmed in `App.tsx` and
    `session-api.ts`. No new fetch is needed; `setSessionStatus(...session.status)`
    fits the existing `detailResult.ok` block.
16. **`renderSessionActions?: (session: ReviewSession) => ReactNode` is an
    existing prop on `SessionListPage`** — confirmed. Adding `SessionReopenControls`
    there (not via new props) avoids prop breakage. `canManage` is already
    computed in `App.tsx` and already gates `SessionAggregateControls` inside
    `renderSessionActions`.
17. **`forceAggregateSession` posts an empty body and returns
    `Result<{ data: ForceAggregateResult }, AppError>`** — confirmed. `reopenSession`
    mirrors it. `ReviewSessionStatus` and `ForceAggregateResult` exist in
    `types/session.ts`; `UserRole` in `types/user.ts`; `SessionAggregateControls`
    uses `canManage` + `return null` for Reviewer, confirmation toggle with
    `role="group"`/`aria-controls`/`aria-expanded`, `role="status"`/`role="alert"` —
    all matching the design's `SessionReopenControls` contract.
18. **Requirements alignment** — Req 2.18/2.19/2.20 and Req 5.8/5.9/5.10/5.11
    (verified in `requirements.md`) map directly onto FR-1..FR-7 and acceptance
    criteria 1–11. No scope creep: `ConflictResolutionPanel` (AdminPage) is
    correctly excluded from the ReviewPage read-only surface, with the backend
    guard on `post-consensus-resolve` providing the authoritative CONFLICT-op
    rejection.

---

## Unverified / Wrong Assumptions

- **Infra snapshot test (§3.4)** — the design hedges "既存の api-stack テストが存在すれば".
  Not verified whether `infra/test` currently contains an api-stack assertion/
  snapshot test. This does not block implementation; the hedge is appropriate.
- No wrong assumptions were found. Every concrete claim about existing source
  that was checkable was checked and held true.

---

## Conclusion

The design names the exact mutation surfaces to guard (`createCorrection`,
`addSpeakerLabel`, `deleteSpeakerLabel`, `post-consensus-resolve`), centralizes
the check in a single `src/utils/session-guard.ts` helper invoked from the
service layer (handlers never call it directly), decides new-handler-vs-extend
with sound justification, preserves policy A, records a `SESSION_REOPENED`
audit, rejects non-COMPLETED reopen, keeps download enabled, propagates
`sessionStatus` to `ReviewPage` without new fetches, adds a flat
`SessionReopenControls` via `renderSessionActions`, returns
`Result<…, AppError>`, surfaces Japanese errors, and specifies a vitest-axe test
plan. It aligns with Requirement 2 (18–20) and Requirement 5 (8–11).

The four findings are all cosmetic (NIT). Zero HIGH/MEDIUM → **APPROVED**.
