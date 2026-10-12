# Team-scope model-status endpoint and allow filtering new language-model audit types

Two scoped backend follow-ups land in a single commit (74c2daf) on top of `main`. First, the audit-log operation-type allowlist in `audit-logs.ts` gains the three `LANGUAGE_MODEL_*` types (plus the previously-missing `SESSION_NAME_CHANGED`, `SESSION_MANUAL_AGGREGATED`, `SESSION_REOPENED`, and `TRANSCRIPTION_JOB_STARTED`), so entries those features already record can actually be used as filter values on both GET and DELETE `/admin/audit-logs` instead of being rejected as an invalid operation type. Second, `GET /language-models/{modelName}` becomes team-scoped: it now runs `checkLanguageModelAccess` after the role gate and before fetching status, so a REVIEWER gets 403 and a wrong-team TEAM_LEADER gets 404, matching the list/job-usage/name-edit/delete paths. Requirements doc gets a Japanese note on both behaviors.

Watch for: the task brief says the allowlist should mirror the `AuditOperationType` union in `types/index.ts`, but the allowlist is actually typed against the union in `audit-repository.ts` (re-exported through `audit-service.ts`) — the `types/index.ts` copy is a separate, stale duplicate not in this import path (possible — pre-existing, out of scope). No blocking concerns.

**Verdict**: APPROVED

## High-level view

The audit-log fix is a one-line-per-value allowlist extension. The authoritative `AuditOperationType` lives in `audit-repository.ts` and is re-exported via `audit-service.ts`, which is exactly what `audit-logs.ts` imports and types `VALID_OPERATION_TYPES` against. The extended array is now a complete, in-order mirror of that union (21 members, one-to-one), so the array type-checks and the validator (`isValidOperationType`) accepts the three new `LANGUAGE_MODEL_*` values on both the GET query param and the DELETE body. The task brief's reference to `types/index.ts` points at a different, stale copy of the union that is not in this code path; that duplication pre-dates this change and is out of scope.

The model-status fix inserts `checkLanguageModelAccess(user, modelName)` between the `requireRole(user, 'TEAM_LEADER')` gate and the `getModelStatus` call. Ordering is what makes the status codes correct: REVIEWER is rejected by the role gate (403) before the access check runs; a missing path param still 400s before the access check; and a wrong-team / missing / PENDING model is hidden with a 404 by `denyResourceAccess()` inside the service. ADMIN bypasses the team filter and reads any model. This is the same access primitive the other language-model mutating handlers use.

The requirements update adds Req 19 (team-scoped status retrieval with the 403/404 split spelled out) and extends Req 11 AC to state the three `LANGUAGE_MODEL_*` types are selectable filters for both GET and DELETE audit-log searches. Both notes are concise Japanese integrated into existing requirements rather than bolted on as a new section.

Test evidence recorded in the commit message: `cd backend && npx vitest --run => 1257 passed | 85 skipped (1342), 0 failed`. The two touched test files add exactly the cases the brief asks for.

<details>
<summary>Issues (1)</summary>

1. **Stale duplicate union in types/index.ts** — `types/index.ts` carries its own `AuditOperationType` that lacks `SESSION_NAME_CHANGED`/`SESSION_REOPENED`; it is not the union the allowlist is typed against (that's `audit-repository.ts`), so it does not affect this change. Pre-existing and out of scope, but worth collapsing to one source of truth in a later cleanup (non-blocking).

</details>

<details>
<summary>Details</summary>

### Audit-type allowlist now mirrors the repository union

`audit-logs.ts` imports `AuditOperationType` from `../services/audit-service.js`, which re-exports the union defined in `../repositories/audit-repository.ts`. That repository union is the authoritative list and already contains all 21 operation types, including the three `LANGUAGE_MODEL_*` entries and the session-lifecycle entries. Before this change `VALID_OPERATION_TYPES` had drifted behind that union, so recorded entries of those types were rejected with "無効な操作種別です。" when used as a filter. The diff brings the array back in sync — it is now a complete, same-order mirror of the repository union, which is why it type-checks as `AuditOperationType[]` and why `isValidOperationType` lets the values through.

Both entry points share one allowlist: the GET handler validates `queryStringParameters.operationType` and the DELETE handler validates the body `operationType` against the same `isValidOperationType`/`VALID_OPERATION_TYPES`. The new tests exercise both — iterating the three `LANGUAGE_MODEL_*` values as a GET query param (expects 200 and the value forwarded to `searchAuditLogs`) and as a DELETE body field (expects 200 and the value forwarded to `removeAuditLogs`) — so the fix is proven on both paths, not just one.

The brief frames the union as living in `types/index.ts`. That file does have a near-identical `AuditOperationType`, but it is a stale duplicate (missing `SESSION_NAME_CHANGED` and `SESSION_REOPENED`) and is not in the import path for the allowlist. The allowlist being in sync with the union it is actually typed against is what matters for correctness; the duplicate is a pre-existing maintainability wrinkle, not a regression introduced here.

### Model-status endpoint becomes team-scoped

```
handler
  ├─ extractUser(event)
  ├─ requireRole(user, 'TEAM_LEADER')        → REVIEWER ⇒ 403 (before access check)
  ├─ modelName = pathParameters.modelName
  │    └─ missing ⇒ validationError 400       (before access check)
  ├─ checkLanguageModelAccess(user, modelName)
  │    ├─ missing / PENDING ⇒ denyResourceAccess() 404
  │    ├─ ADMIN ⇒ return model (any team)
  │    ├─ team match ⇒ return model
  │    └─ other team ⇒ denyResourceAccess() 404
  └─ getModelStatus(modelName)                → only runs once access is granted
```

The ordering is the substance of the fix. Because `requireRole` throws before `checkLanguageModelAccess` runs, a REVIEWER never reaches the access check and gets a role 403 — the test asserts `checkLanguageModelAccess` was *not* called in that case, which pins the ordering down. A wrong-team TEAM_LEADER passes the role gate but is rejected by the service with a 404, and the test also asserts `getModelStatus` never runs after denial, so status is not leaked for a model the caller cannot see. ADMIN skips the team filter inside the service. The missing-`modelName` 400, the JSDoc, and the `successResponse`/`errorResponse` shape are all preserved.

One deviation from the brief's "mirroring patch-language-model-name.ts": the name-patch handler delegates team isolation into its service (`renameModelDisplayName`), whereas this handler calls `checkLanguageModelAccess` directly before the thin `getModelStatus` call. That is the right adaptation — `getModelStatus` is a pass-through to Transcribe with no metadata lookup of its own, so the access gate has to sit in the handler. The externally observable contract (403 on role, 404 on access, existence hidden) is identical to the sibling paths, which is what the requirement asks for.

### Conventions and layering

Verified against the brief's convention checklist: `.js` extensions on all relative imports (including the new `access-control-service` import in handler and test), named exports only, errors via `validationError`/`AppError` (`denyResourceAccess`) with no raw throws, JSDoc retained and extended for team isolation, kebab-case filenames, and handler→service layering intact (no repository called directly). No deviations.

### Test evidence

The commit message records `npx vitest --run => 1257 passed | 85 skipped (1342), 0 failed`. The two test files in the diff add the required coverage: audit-logs gains "accepts the new language-model operation types as query param" and "...in the body"; get-model-status gains ADMIN-any-team, owning-team TEAM_LEADER success, other-team TEAM_LEADER 404 (with `getModelStatus` not called), REVIEWER 403 (with `checkLanguageModelAccess` not called), and the pre-existing missing-modelName 400 case is retained. Not re-run per instructions; the evidence is present and shows 0 failures, so no spot-check was warranted.

</details>

<details>
<summary>File map</summary>

- `backend/src/handlers/audit-logs.ts` — add 6 operation types (3 `LANGUAGE_MODEL_*` + 3 session-lifecycle) to `VALID_OPERATION_TYPES`, resyncing it with the repository union.
- `backend/src/handlers/audit-logs.test.ts` — new tests accepting the three `LANGUAGE_MODEL_*` types on GET query param and DELETE body.
- `backend/src/handlers/get-model-status.ts` — import and call `checkLanguageModelAccess` after the role gate and before `getModelStatus`; JSDoc extended for team isolation.
- `backend/src/handlers/get-model-status.test.ts` — mock access-control service; add ADMIN/owning-TL/other-TL-404/REVIEWER-403 cases.
- `.kiro/specs/transcription-review-app/requirements.md` — Req 11 AC (audit types filterable in GET/DELETE) and new Req 19 (team-scoped status retrieval).

Full diff: `git -C <worktree> diff main...feat/language-model-followups`

</details>
