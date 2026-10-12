# Speaker-label add/delete on the review screen

Adds the ability to create and remove speaker-label entries from the review-screen's `SpeakerLabelManager` panel. A session now carries an explicit `speakerLabels` master list alongside the pre-existing segment-derived labels, and the UI displays the union of both. Two new one-per-file handlers (`POST /sessions/{sessionId}/speaker-labels`, `DELETE /sessions/{sessionId}/speaker-labels/{label}`) route through the session service, where deletion is gated on the label being unused by any segment. Add and delete are both recorded in the audit log by reusing the existing `SPEAKER_LABEL_CHANGED` operation type with an `action` discriminator.

Watch for: nothing blocking. The in-use check is correctly enforced in the service layer (not just the frontend), the deletion property test holds the key invariant at numRuns:100, and the component test asserts no axe violations. One minor markup smell in the disabled-delete affordance (a `<button disabled>` nested in a `<span title>`) is cosmetic (confirmed).

**Verdict**: APPROVED

## High-level view

The master list lives on the Session METADATA item as a `speakerLabels` string array, round-tripped through `session-repository` (`mapItemToSessionRecord`, `updateSessionSpeakerLabels`) and surfaced to the UI unchanged because `GET /sessions/{sessionId}` already returns the session object. The displayed set is the union of this master list and the distinct `speakerLabel` values collected from the session's segments via the new `getSegmentSpeakerLabels` repository read.

Deletion correctness is enforced where it matters: `deleteSpeakerLabel` in `session-service` queries segment labels and throws `validationError` if the target is still in use, before any write. The frontend's disabled delete button is UX sugar only; the backend is the source of truth. This is covered by a fast-check property test (numRuns:100) asserting that an in-use label is never deleted and an unused label is removed in isolation.

The API surface follows the existing session REST conventions. Both handlers run `extractUser` → sessionId validation → `checkSessionAccess` (which denies with 404 to hide existence) → service call → `recordAuditLog` → `successResponse`. The DELETE handler URL-decodes the path label once and rejects an empty value; the frontend encodes it with `encodeURIComponent`. Both Lambdas are registered in the API stack with per-function roles via `createLambda` and `grantCommonPermissions`.

Audit logging reuses `SPEAKER_LABEL_CHANGED` with `metadata.action` of `'ADD'`/`'DELETE'` rather than introducing a new operation type, consistent with the existing `post-corrections` usage of the same type for `SPEAKER_RENAME`.

<details>
<summary>Issues (1)</summary>

1. **Disabled-delete markup nesting** — the in-use delete affordance renders a `<button disabled>` inside a `<span title>`; harmless but the `title` tooltip belongs on the button and the wrapping span is redundant. Cosmetic, non-blocking.

</details>

<details>
<summary>Details</summary>

### Master list storage and the union read

The master list is persisted on the Session METADATA item (`PK=SESSION#{id}`, `SK=METADATA`) as a `speakerLabels` attribute. `mapItemToSessionRecord` reads it back as `string[] | undefined`, and `updateSessionSpeakerLabels` overwrites the whole attribute with `SET speakerLabels = :labels, updatedAt = :now` and `ReturnValues: ALL_NEW`. Because `GET /sessions/{sessionId}` returns the session record as-is, the master list reaches the frontend with no handler change — matching the plan's D7.

`getSegmentSpeakerLabels` queries `begins_with(SK, 'SEGMENT#')` and collects distinct non-empty `speakerLabel` values in first-appearance order. The service's `unionLabels` helper and the frontend's `mergeSpeakerLabels` independently compute the same union (segment-derived first, then master-only labels), so a master label never assigned to a segment still shows up — the point of allowing an empty label to be added.

### Deletion gating in the service layer

`deleteSpeakerLabel` loads the session (404 via `notFoundError` if absent), then calls `getSegmentSpeakerLabels` and throws `validationError('Speaker label is in use and cannot be deleted.')` if the target appears among segment labels — before any write. Only if unused and present in the master list is it filtered out and persisted. A label present on segments but not in the master list is therefore always rejected as in-use rather than 404, which is the safe ordering: usage is checked first.

This satisfies the explicit requirement that the usage check live in the backend service, not only the frontend. The frontend disables the delete button when `countSegmentsWithLabel > 0`, but that is advisory; a client that bypasses the UI still hits the service guard.

### Property test for deletion

`session-service.property.test.ts` carries `describe('Feature: speaker-label-delete, Property 1: ...')` with two `it` cases at `numRuns: 100`, each with a docstring referencing 確認済み要件3. The in-use case asserts `deleteSpeakerLabel` rejects with `VALIDATION_ERROR` and never calls `updateSessionSpeakerLabels`; the unused case asserts exactly the target label is removed and the remaining order is preserved. Repository functions are stubbed via `vi.mock`. This matches the required describe/docstring form and the 'Deletion' property-test target.

### Handlers and audit

Both handlers are thin and follow the mandated template: `extractUser`, sessionId validation with `validationError`, `checkSessionAccess` (404 on no access), service call, `recordAuditLog`, `successResponse`. They wrap the service call in a try/catch that re-throws `AppError`s (anything with `statusCode`) and otherwise maps to `internalError`, so service-level validation/404 codes propagate intact while unexpected failures become 500s. Named exports, `.js` import extensions, and JSDoc headers are all present.

The DELETE handler decodes the `label` path parameter once with `decodeURIComponent` and rejects an empty result — consistent with the frontend sending `encodeURIComponent(label)`. The ADD handler records `metadata.label` as `body.label.trim()`, aligning the logged value with what the service actually stores (the trimmed label) rather than the raw input.

Audit entries reuse `SPEAKER_LABEL_CHANGED` with `resourceType: 'ReviewSession'`, `resourceId: sessionId`, and `metadata: { action, label }`. No new operation type was added, consistent with how `post-corrections` already maps `SPEAKER_RENAME` onto the same type.

### Infra registration

`PostSpeakerLabel` and `DeleteSpeakerLabel` are created through `createLambda`, which kebab-cases the name to resolve the entry file — `post-speaker-label.ts` and `delete-speaker-label.ts`, both of which exist. Each gets `grantCommonPermissions` (DynamoDB RW + KMS, needed for audit writes) and an individual role per the least-privilege convention. Routes `POST /sessions/{sessionId}/speaker-labels` and `DELETE /sessions/{sessionId}/speaker-labels/{label}` are wired with the JWT authorizer alongside the other session routes.

### Frontend add/delete UX

`SpeakerLabelManager` gains an add input with a 追加 button: empty input yields 「話者ラベルを入力してください。」 and a client-side duplicate yields 「同じ名前の話者ラベルが既に存在します。」, with server errors surfaced in the same `role="alert"` region. Each label row gets a 削除 button that is disabled (with a Japanese reason) when the label is in use, and on server rejection the returned Japanese message renders in a per-label `role="alert"`. `App.tsx` holds `masterSpeakerLabels` state, seeds it from the session detail, and refreshes it from the `speakerLabels` returned by the add/delete responses. The component test asserts `toHaveNoViolations()` via vitest-axe.

The disabled-delete affordance wraps a `<button disabled>` inside a `<span title="...">`; the button carries its own `aria-label`, but the tooltip belongs on the button and the span is redundant. Non-blocking.

### Verification evidence

`verification.md` records backend `npx vitest --run` (1119 passed / 85 skipped) plus `tsc --noEmit` clean, frontend `npx vitest --run` (1031 passed) plus `tsc -b` clean, and infra `npx vitest --run -u` (143 passed) plus `cdk synth` confirming the two routes and Lambda descriptions. The evidence names the specific new test files and their case counts, and is consistent with the code read during this review, so the suites were not re-run.

</details>

<details>
<summary>File map</summary>

- `backend/src/types/index.ts` — (audit op type already had `SPEAKER_LABEL_CHANGED`; no new type).
- `backend/src/repositories/session-repository.ts` — `speakerLabels` on `SessionRecord`/`mapItemToSessionRecord`; `updateSessionSpeakerLabels`, `getSegmentSpeakerLabels`.
- `backend/src/services/session-service.ts` — `addSpeakerLabel`, `deleteSpeakerLabel`, `unionLabels` helper.
- `backend/src/services/session-service.property.test.ts` — deletion-correctness property (numRuns:100).
- `backend/src/handlers/post-speaker-label.ts` / `delete-speaker-label.ts` — new handlers (+ co-located tests).
- `infra/lib/stacks/api-stack.ts` — two Lambdas + routes.
- `frontend/src/types/session.ts` — `speakerLabels` on `ReviewSession`.
- `frontend/src/utils/speaker-labels.ts` — `mergeSpeakerLabels`.
- `frontend/src/services/session-api.ts` — `addSpeakerLabel`, `deleteSpeakerLabel`.
- `frontend/src/components/SpeakerLabelManager.tsx` — add/delete UI (+ test with vitest-axe).
- `frontend/src/pages/ReviewPage.tsx` — prop passthrough.
- `frontend/src/App.tsx` — `masterSpeakerLabels` state + add/delete handlers.

Full changes are in the working tree (not a git repo); see the files above.

</details>
