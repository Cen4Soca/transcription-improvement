# Implementation Plan — Custom Language Model Team Isolation & Management

All paths are absolute under the worktree:
`/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/.worktrees/language-model-team-isolation`
(abbreviated below as `<WT>`). NEVER write under the main checkout.

Source of truth: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/.agents/tasks/language-model-team-isolation/design.md`. The decisions there are settled — implement them, do not re-litigate.

## Verification commands (per package)

- Backend: `cd <WT>/backend && npm install` (first time) `&& npx vitest --run`
- Frontend: `cd <WT>/frontend && npm install` (first time) `&& npx vitest --run`
- Infra: `cd <WT>/infra && npm install` (first time) `&& npx cdk diff --all` (synth/diff ONLY — never `cdk deploy`)

Do NOT push, do NOT open a PR, do NOT run `cdk deploy`.

## GSI collision resolution (settled by investigation)

I inspected `<WT>/infra/lib/stacks/foundation-stack.ts` and every GSI1/GSI2 producer/consumer in `<WT>/backend/src`:

- Only **GSI1** and **GSI2** exist today (both `projectionType: ALL`). **GSI3 does not exist** and must be added.
- **GSI1 ride-on is SAFE.** `GSI1PK = TEAM#{teamId}` is already shared by MediaFile (`GSI1SK = MEDIA#...`, `media-file-repository.listByTeam`) and ReviewSession (`GSI1SK = SESSION#...`, `session-repository.getSessionsByTeamId`). Every existing team-partition query uses `begins_with(GSI1SK, 'MEDIA#')` or `begins_with(GSI1SK, 'SESSION#')`. The new LanguageModel item uses `GSI1SK = LANGUAGEMODEL#{modelName}` — a distinct SK prefix — so it is invisible to those queries, and the LanguageModel query filters on `begins_with(GSI1SK, 'LANGUAGEMODEL#')`. No collision.
- **GSI2 ride-on is SAFE.** Existing GSI2PK values are `USER#{userId}` (media/session/participant), `OPERATION#{operationType}` (audit), `TRANSCRIBE#{jobName}` (jobs). The new LanguageModel uniqueness item uses `GSI2PK = TEAM#{teamId}#DISPLAYNAME` — a partition no existing producer writes — so no existing GSI2 query can see it and it sees nothing else. No collision.

**Decision: ride on GSI1 and GSI2, add GSI3 new.** The implementer MUST still verify at test level that LanguageModel items never leak into media/session/audit/job queries (add assertions in the repository unit tests and keep existing repo tests green). If, during implementation, any existing `begins_with` assumption is found violated, switch the LanguageModel index(es) to dedicated GSIs and note the deviation in the FEAT `findings`.

## Key patterns to follow (verified in the codebase)

- Handler → Service → Repository, ESM `.js` import extensions, named exports, JSDoc `METHOD /path` over each handler, `successResponse`/`errorResponse`, `AppError` factories only. One handler per file, kebab-case filenames.
- `extractUser`, `requireRole(user,'TEAM_LEADER'|'ADMIN')`, `isAdmin`, `denyResourceAccess` from `utils/auth-middleware.js`.
- `getUserTeamIds(userId)`, `checkSessionAccess(user, sessionId)`, `requireTeamAccess` from `services/access-control-service.js`.
- `getTeamById(teamId)`, `getTeamsByUserId(userId)`, `getAllTeams()` from `repositories/team-repository.js`.
- `recordAuditLog({ actorUserId, actorRole, operationType, resourceId, resourceType, metadata })` from `services/audit-service.js`.
- `docClient` + `TABLE_NAME` from `utils/dynamodb-client.js` (DocumentClient with `removeUndefinedValues: true`).
- Rename reference: `handlers/patch-session-name.ts` + `session-service.renameSession` (trim, 1–100 length).
- Infra Lambda+route: `createLambda(...)` + per-fn `grant*` + `addRoute(method, path, fn, jwtAuthorizer)` in `infra/lib/stacks/api-stack.ts`.
- Frontend: `api-client` has `get/post/patch/delete` returning `Result<T,AppError>`; inline-edit UX reference `components/SessionNameEditor.tsx`; team list source resolved below.

---

## Step 1 — Data model + metadata foundation + create-flow changes

- [ ] 1. Add GSI3 to the DynamoDB table (ride-on GSI1/GSI2 need no schema change).
      In `foundationStack`, after the GSI2 `addGlobalSecondaryIndex`, add GSI3: `indexName: 'GSI3'`, partitionKey `GSI3PK` (STRING), sortKey `GSI3SK` (STRING), `projectionType: ALL`.
      Files: `<WT>/infra/lib/stacks/foundation-stack.ts`
      Verify: `cd <WT>/infra && npm install && npx cdk diff --all` — diff shows GSI3 added to the table, synth succeeds, no errors. Update `<WT>/infra/test/__snapshots__/foundation-stack.test.ts.snap` by running `npx vitest --run` in infra if snapshot tests exist (regenerate intentionally and confirm the only change is GSI3).

- [ ] 2. Add types and the audit operation types.
      In `types/index.ts`: add `LanguageModelMetadata` interface (fields: `modelName`, `teamId`, `displayName`, `displayNameLower`, `baseModelName`, `createdBy`, `createdAt`, `sessionIds: string[]`, `s3Key`, `deletionStatus: 'ACTIVE' | 'PENDING'`) and add `LANGUAGE_MODEL_DELETED`, `LANGUAGE_MODEL_TEAM_CHANGED`, `LANGUAGE_MODEL_NAME_CHANGED` to the `AuditOperationType` union. The audit repository defines its own `AuditOperationType` too — update `repositories/audit-repository.ts` union to match (grep for the union and keep both in sync).
      Files: `<WT>/backend/src/types/index.ts`, `<WT>/backend/src/repositories/audit-repository.ts`
      Verify: `cd <WT>/backend && npx vitest --run` passes (type-check via vitest/tsc as configured).

- [ ] 3. Update the audit property-test arbitrary to include the 3 new operation types.
      In `audit-service.property.test.ts`, extend the `operationTypeArb` `fc.constantFrom(...)` with `'LANGUAGE_MODEL_DELETED'`, `'LANGUAGE_MODEL_TEAM_CHANGED'`, `'LANGUAGE_MODEL_NAME_CHANGED'` (as `const`).
      Files: `<WT>/backend/src/services/audit-service.property.test.ts`
      Verify: `cd <WT>/backend && npx vitest --run audit-service.property` passes.

- [ ] 4. Add `quotaExceededError` factory.
      In `utils/error-handler.ts` add `export function quotaExceededError(message: string, details?: string): AppError` → `code: 'QUOTA_EXCEEDED'`, `statusCode: 429`. Add a unit test in `utils/error-handler.test.ts` asserting code/statusCode.
      Files: `<WT>/backend/src/utils/error-handler.ts`, `<WT>/backend/src/utils/error-handler.test.ts`
      Verify: `cd <WT>/backend && npx vitest --run error-handler` passes.

- [ ] 5. Create the LanguageModel repository.
      New `repositories/language-model-repository.ts` using `docClient` + `TABLE_NAME`. Item keys: `PK=LANGUAGEMODEL#{modelName}`, `SK=METADATA`, `GSI1PK=TEAM#{teamId}`, `GSI1SK=LANGUAGEMODEL#{modelName}`, `GSI2PK=TEAM#{teamId}#DISPLAYNAME`, `GSI2SK={displayNameLower}`, `GSI3PK='LANGUAGEMODEL'`, `GSI3SK={modelName}`, `entityType='LanguageModel'`. Functions: `putModel(meta)`, `getModel(modelName)`, `queryByTeam(teamId)` (GSI1 `begins_with(GSI1SK,'LANGUAGEMODEL#')`), `queryAll()` (GSI3 `GSI3PK='LANGUAGEMODEL'`), `findByDisplayName(teamId, displayNameLower)` (GSI2 exact), `updateTeamId(modelName, newTeamId)` (rewrites GSI1PK + GSI2PK), `updateDisplayName(modelName, displayName, displayNameLower)` (rewrites displayName/displayNameLower + GSI2SK), `setDeletionStatus(modelName, status)`, `hardDelete(modelName)`. All returns typed as `LanguageModelMetadata`.
      Files: `<WT>/backend/src/repositories/language-model-repository.ts`, `<WT>/backend/src/repositories/language-model-repository.test.ts` (mock `docClient.send`; assert key shapes and that LanguageModel items use the LANGUAGEMODEL# SK prefix so they can't collide with MEDIA#/SESSION# GSI1 queries).
      Verify: `cd <WT>/backend && npx vitest --run language-model-repository` passes.

- [ ] 6. Rework the create flow: required teamId/displayName, session ownership, within-team uniqueness, metadata write, quota capture.
      In `services/language-model-service.ts` extend `createModel` params with `teamId: string`, `displayName: string`, and `user: AuthUser` (or pass `userId`,`role`,plus a way to call access control). Order: validate role (TEAM_LEADER+); validate `teamId` exists via `getTeamById` (else `validationError`); for non-ADMIN verify caller is a member of `teamId` via `isTeamMember`/`requireTeamAccess` (ADMIN any team); call `checkSessionAccess(user, sessionId)` for EVERY `sessionId` (other-team → 404 via `denyResourceAccess`); trim displayName and enforce 1–100; enforce within-team uniqueness via `findByDisplayName(teamId, displayName.toLowerCase())` (else `validationError` prompting a different name); generate training data; upload to S3; call Transcribe `CreateLanguageModelCommand` wrapped in try/catch that maps `LimitExceededException`/quota errors (inspect `error.name`/`$metadata`/HTTP 429) to `quotaExceededError('カスタム言語モデルの作成上限に達しています...')`; on success `putModel(...)` the metadata (`deletionStatus:'ACTIVE'`, `s3Key: training-data/{modelName}/training.txt`); extend `LANGUAGE_MODEL_CREATED` audit metadata with `teamId` and `displayName`.
      In `handlers/create-language-model.ts`: parse+require `teamId` and `displayName`; pass `user` through; keep `fetchConfirmedSegments` but move the per-session `checkSessionAccess` into the service (or call it in the handler before fetching — pick service-level so the property test can target it) — place the ownership check in the service and document it.
      Files: `<WT>/backend/src/services/language-model-service.ts`, `<WT>/backend/src/handlers/create-language-model.ts`, and update `<WT>/backend/src/services/language-model-service.test.ts` + `<WT>/backend/src/handlers/create-language-model.test.ts` for the new signature.
      Verify: `cd <WT>/backend && npx vitest --run language-model-service create-language-model` passes.

- [ ] 7. Property tests for create-flow (fast-check, numRuns 100).
      In `language-model-service.property.test.ts` add: (a) **Feature: language-model-team-isolation, Property N: session ownership on create** — for any mix of owned/other-team sessionIds, creation is rejected (404) whenever any sessionId is not accessible, and proceeds only when all are; docstring `**Validates: Requirements 20.x**`. (b) **within-team displayName uniqueness** — if a model with the same `displayNameLower` exists in the same team, creation is rejected; different team with same name is allowed. (c) **quota-exceeded handling** — when the Transcribe client throws a LimitExceeded/quota error, the service throws an AppError with `code === 'QUOTA_EXCEEDED'` and `statusCode === 429`.
      Files: `<WT>/backend/src/services/language-model-service.property.test.ts`
      Verify: `cd <WT>/backend && npx vitest --run language-model-service.property` passes.

- [ ] 8. Step 1 gate: `cd <WT>/backend && npx vitest --run` and `cd <WT>/infra && npx vitest --run` and `npx cdk diff --all` all pass/succeed.

## Step 2 — List filtering + job-usage team check (core leak closure)

- [ ] 9. Add `checkLanguageModelAccess` to access-control-service.
      `export async function checkLanguageModelAccess(user: AuthUser, modelName: string): Promise<LanguageModelMetadata>`: load via `getModel`; if missing or `deletionStatus==='PENDING'` → `denyResourceAccess()` (404); if `isAdmin(user)` return it; else if `model.teamId ∈ await getUserTeamIds(user.userId)` return it; else `denyResourceAccess()`.
      Files: `<WT>/backend/src/services/access-control-service.ts`, `<WT>/backend/src/services/access-control-service.test.ts`
      Verify: `cd <WT>/backend && npx vitest --run access-control-service` passes.

- [ ] 10. Team-scoped list filtering cross-referenced with Transcribe COMPLETED.
      In `services/language-model-service.listModels` accept `user: AuthUser`. ADMIN → `queryByTeam` across all via `queryAll()` (GSI3); others → union of `queryByTeam(teamId)` over `getUserTeamIds`. Exclude `deletionStatus==='PENDING'`. Fetch Transcribe `ListLanguageModels`, keep only `COMPLETED`, and return only models present in BOTH the metadata set and the Transcribe COMPLETED set (match by `modelName`). Response items include `modelName`, `displayName`, `teamId`, `modelStatus` (and `baseModelName`/`createTime` if available).
      In `handlers/list-language-models.ts` pass `user` into `listModels`.
      Files: `<WT>/backend/src/services/language-model-service.ts`, `<WT>/backend/src/handlers/list-language-models.ts`, update `list-language-models.test.ts` + `language-model-service.test.ts`.
      Verify: `cd <WT>/backend && npx vitest --run list-language-models language-model-service` passes.

- [ ] 11. Property test: team-scoped list filtering.
      **Feature: language-model-team-isolation, Property N: team-scoped list filtering** — for arbitrary sets of models across teams and arbitrary caller team memberships, a non-ADMIN caller sees exactly the intersection of (models whose teamId ∈ caller teams) ∩ (Transcribe COMPLETED) and never a PENDING model; ADMIN sees all COMPLETED. Docstring `**Validates: Requirements 18.4**`.
      Files: `<WT>/backend/src/services/language-model-service.property.test.ts`
      Verify: `cd <WT>/backend && npx vitest --run language-model-service.property` passes.

- [ ] 12. Job-usage team check + ADMIN cross-team audit.
      In `services/transcription-job-service.startJob` add `user: AuthUser` to params. When `languageModelName` is provided: call `checkLanguageModelAccess(user, languageModelName)` (404 on violation). Record a job-start audit log (reuse `recordAuditLog`; if a job-start log already exists verify and extend it, else add one) with `metadata.languageModelName` and, when `isAdmin(user)` and the model's `teamId` is not in `getUserTeamIds(user.userId)`, `metadata.crossTeamModelUsage: true`.
      In `handlers/start-transcription.ts` pass the full `user` object into `startJob`.
      Files: `<WT>/backend/src/services/transcription-job-service.ts`, `<WT>/backend/src/handlers/start-transcription.ts`, update `transcription-job-service.test.ts` + `start-transcription.test.ts`.
      Verify: `cd <WT>/backend && npx vitest --run transcription-job-service start-transcription` passes.
      NOTE: Treat the existing "no team check on job usage" as a confirmed leak — add a test proving an other-team model name yields 404; do not assume it is already handled.

- [ ] 13. Step 2 gate: `cd <WT>/backend && npx vitest --run` passes.

## Step 3 — Display-name edit (mirror patch-session-name)

- [ ] 14. Add `renameModelDisplayName` to the service.
      In `language-model-service.ts`: `renameModelDisplayName(user, modelName, rawName)` → `checkLanguageModelAccess` (ownership), `requireRole(user,'TEAM_LEADER')`, trim+validate 1–100 (reuse the session rule style/messages), within-team uniqueness via `findByDisplayName(model.teamId, newLower)` excluding self, then `updateDisplayName`. Return updated metadata.
      Files: `<WT>/backend/src/services/language-model-service.ts`, tests.

- [ ] 15. New handler `patch-language-model-name.ts` (mirror `patch-session-name.ts`).
      JSDoc `PATCH /language-models/{modelName}/name`. `extractUser`; require `modelName` path param; body `{ name }` string; call `renameModelDisplayName`; record `LANGUAGE_MODEL_NAME_CHANGED` audit (`resourceType:'LanguageModel'`, metadata `{ displayName }`); return `successResponse({ data: updated })`. Add `patch-language-model-name.test.ts`.
      Files: `<WT>/backend/src/handlers/patch-language-model-name.ts`, `<WT>/backend/src/handlers/patch-language-model-name.test.ts`

- [ ] 16. Property test: within-team displayName uniqueness (rename path).
      **Feature: language-model-team-isolation, Property N: within-team displayName uniqueness** — renaming to a name already used by another model in the same team is rejected; renaming to a self-name or a name used only in other teams succeeds. Docstring `**Validates: Requirements (new display-name-edit requirement)**`.
      Files: `<WT>/backend/src/services/language-model-service.property.test.ts`

- [ ] 17. Infra: add the PATCH name route + least-privilege Lambda.
      In `api-stack.ts` add `patchLanguageModelNameFn = createLambda('PatchLanguageModelName', { entry: handlersDir, description: 'PATCH /language-models/{modelName}/name - Rename model display name', environment: commonEnv })`, grant DynamoDB read/write + KMS only (no Transcribe), then `addRoute('PATCH','/language-models/{modelName}/name', patchLanguageModelNameFn, jwtAuthorizer)`.
      Files: `<WT>/infra/lib/stacks/api-stack.ts`, update `<WT>/infra/test/api-stack.test.ts` snapshot intentionally.

- [ ] 18. Step 3 gate: backend `npx vitest --run`, infra `npx vitest --run` + `npx cdk diff --all` succeed.

## Step 4 — teamId edit (ADMIN only)

- [ ] 19. Add `changeModelTeam` to the service.
      `changeModelTeam(user, modelName, newTeamId)` → `requireRole(user,'ADMIN')`; load metadata (`notFoundError` if missing); validate `newTeamId` exists via `getTeamById` (else `validationError`); collision check: if `findByDisplayName(newTeamId, model.displayNameLower)` returns another model → reject with a clear message prompting rename; else `updateTeamId`. Record old→new in return.
      Files: `<WT>/backend/src/services/language-model-service.ts`, tests.

- [ ] 20. New handler `patch-language-model-team.ts`.
      JSDoc `PATCH /language-models/{modelName}/team`. `extractUser`; `modelName` path param; body `{ teamId }`; call `changeModelTeam`; record `LANGUAGE_MODEL_TEAM_CHANGED` audit (metadata `{ oldTeamId, newTeamId }`); `successResponse`. Add test.
      Files: `<WT>/backend/src/handlers/patch-language-model-team.ts`, `<WT>/backend/src/handlers/patch-language-model-team.test.ts`

- [ ] 21. Infra: add PATCH team route + Lambda (DynamoDB read/write + KMS only).
      Mirror task 17 with `PatchLanguageModelTeam` and `addRoute('PATCH','/language-models/{modelName}/team', ...)`.
      Files: `<WT>/infra/lib/stacks/api-stack.ts`, update snapshot.

- [ ] 22. Step 4 gate: backend + infra vitest + `cdk diff --all` succeed.

## Step 5 — Delete (soft→hard, idempotent, re-runnable recovery)

- [ ] 23. Add delete-eligibility + ordered deletion to the service.
      In `language-model-service.ts`: `deleteModel(user, modelName)` → `checkLanguageModelAccess` (ownership) + `requireRole(user,'TEAM_LEADER')`. Eligibility: `DescribeLanguageModelCommand` — reject (`validationError`) if `ModelStatus === 'IN_PROGRESS'` (training). Then `ListTranscriptionJobsCommand` with `Status: 'IN_PROGRESS'`, paginate via `NextToken`; the summary may omit `LanguageModelName`, so for jobs where it is absent call `GetTranscriptionJobCommand` to read `Settings.LanguageModelName`; reject if any in-progress job references this model. This Transcribe check is authoritative — do NOT consult DynamoDB for in-use. Deletion order, each idempotent, with bounded retry/backoff: (1) `setDeletionStatus(modelName,'PENDING')` (immediately hides from list/usage); (2) `DeleteLanguageModelCommand` (treat already-absent / NotFound as success); (3) S3 `DeleteObjectCommand` on `training-data/{modelName}/training.txt` (already-absent = success); (4) `hardDelete(modelName)`. If step 2/3/4 ultimately fails, leave the record PENDING and rethrow so re-invoking the same DELETE resumes from the remaining steps (re-invocation on an already-PENDING record skips straight to Transcribe/S3/hard-delete). Record `LANGUAGE_MODEL_DELETED` audit after success.
      Files: `<WT>/backend/src/services/language-model-service.ts`, tests.

- [ ] 24. New handler `delete-language-model.ts`.
      JSDoc `DELETE /language-models/{modelName}`. `extractUser`; `modelName` path param; call `deleteModel`; `successResponse({ data: { deleted: true } })`. Add test.
      Files: `<WT>/backend/src/handlers/delete-language-model.ts`, `<WT>/backend/src/handlers/delete-language-model.test.ts`

- [ ] 25. Property test: delete order + idempotency.
      **Feature: language-model-team-isolation, Property N: delete order and idempotency** — soft-delete (PENDING) always precedes Transcribe delete which precedes S3 delete which precedes hard-delete; re-invoking after a mid-sequence failure never skips the soft-delete and converges to hard-deleted without error when steps are already-absent (idempotent). Docstring `**Validates: Requirements (new delete requirement)**`.
      Files: `<WT>/backend/src/services/language-model-service.property.test.ts`

- [ ] 26. Infra: DELETE route + least-privilege Lambda.
      `deleteLanguageModelFn = createLambda('DeleteLanguageModel', { entry: handlersDir, description: 'DELETE /language-models/{modelName} - Delete custom language model', environment: { ...commonEnv, ...transcribeEnv } })`; grant DynamoDB read/write + KMS; grant S3 delete on the data bucket training-data prefix (`grantS3ReadWrite` or a scoped `s3:DeleteObject` policy on `${dataBucket.bucketArn}/training-data/*`); add IAM policy for `transcribe:DeleteLanguageModel`, `transcribe:DescribeLanguageModel`, `transcribe:ListTranscriptionJobs`, `transcribe:GetTranscriptionJob`. `addRoute('DELETE','/language-models/{modelName}', deleteLanguageModelFn, jwtAuthorizer)`.
      Files: `<WT>/infra/lib/stacks/api-stack.ts`, update snapshot.

- [ ] 27. Step 5 gate: backend + infra vitest + `cdk diff --all` succeed.

## Step 6 — Frontend + requirements doc + integration

- [ ] 28. Backend: expose the caller's teams for the create-form selector.
      Add new handler `get-my-teams.ts` JSDoc `GET /me/teams`: `extractUser`; ADMIN → `getAllTeams()`; others → `getTeamsByUserId(user.userId)`; `successResponse({ data: teams })`. Add route `addRoute('GET','/me/teams', getMyTeamsFn, jwtAuthorizer)` with DynamoDB read + KMS. (Rationale: `/me` returns no memberships and `/admin/teams` is ADMIN-only; a TEAM_LEADER needs their own teams without admin scope.) Add handler test.
      Files: `<WT>/backend/src/handlers/get-my-teams.ts`, `<WT>/backend/src/handlers/get-my-teams.test.ts`, `<WT>/infra/lib/stacks/api-stack.ts` (+snapshot).
      Verify: backend vitest + infra `cdk diff --all`.

- [ ] 29. Frontend API client: extend language-model-api.
      In `services/language-model-api.ts`: add `teamId` + `displayName` to `LanguageModelSummary`; add `teamId: string` + `displayName: string` to `CreateLanguageModelRequest`; add methods `deleteModel(modelName)`, `updateModelName(modelName, name)`, `updateModelTeam(modelName, teamId)` using `client.delete`/`client.patch`. Add a `getMyTeams()` to `profile-api.ts` (or a small typed call) returning the caller's teams for the selector.
      Files: `<WT>/frontend/src/services/language-model-api.ts`, `<WT>/frontend/src/services/profile-api.ts` (+ tests if present).
      Verify: `cd <WT>/frontend && npx vitest --run` passes.

- [ ] 30. Frontend hook: extend useLanguageModels.
      Add `deleteModel`, `renameModel`, `changeModelTeam`, and a `reDelete` (re-invoke delete on a PENDING model) action with loading/error state; reload the list on success.
      Files: `<WT>/frontend/src/hooks/useLanguageModels.ts`, `<WT>/frontend/src/hooks/useLanguageModels.test.ts`
      Verify: `cd <WT>/frontend && npx vitest --run useLanguageModels` passes.

- [ ] 31. Frontend page: LanguageModelPage.
      Add a REQUIRED team selector (ADMIN → all teams from `getMyTeams`; TEAM_LEADER → own teams) and a REQUIRED displayName input to the create form; show `displayName` + team column in the list; inline display-name edit mirroring `SessionNameEditor`; delete button + confirm dialog; ADMIN-only teamId edit control; an ADMIN management view listing PENDING models with a re-delete affordance; map `QUOTA_EXCEEDED` backend errors to a Japanese message. Keep all UI text Japanese.
      Files: `<WT>/frontend/src/pages/LanguageModelPage.tsx`, `<WT>/frontend/src/pages/LanguageModelPage.test.tsx`
      Verify: `cd <WT>/frontend && npx vitest --run LanguageModelPage` passes incl. `expect(container).toHaveNoViolations()`.

- [ ] 32. Frontend: TranscriptionJobForm model options show displayName.
      Render `model.displayName` (fallback `model.modelName`) as the option label while keeping `value={model.modelName}`.
      Files: `<WT>/frontend/src/components/TranscriptionJobForm.tsx`, its test.
      Verify: `cd <WT>/frontend && npx vitest --run TranscriptionJobForm` passes incl. axe.

- [ ] 33. Requirements doc (Japanese).
      In `.kiro/specs/transcription-review-app/requirements.md`: revise Requirement 18 item 4 (COMPLETED-all → only the caller's team's COMPLETED models; ADMIN all); add to Req 18 the job-usage team check and ADMIN cross-team audit; revise Requirement 20 (required teamId/displayName, session-ownership check, within-team uniqueness, QUOTA_EXCEEDED 429 error); add new requirements for delete / teamId-edit / display-name-edit.
      Files: `<WT>/.kiro/specs/transcription-review-app/requirements.md`

- [ ] 34. Final gate: backend `npx vitest --run`, frontend `npx vitest --run`, infra `npx vitest --run` + `npx cdk diff --all` all pass/succeed. Clean up any temp files.

## Notes / assumptions

- `startJob` and `listModels` signatures change to take `user`/`AuthUser`; every caller and test must be updated in the same step to keep the build green.
- The job-start audit may not exist yet as a discrete record; the implementer verifies and either extends an existing one or adds a new `recordAuditLog` call carrying `languageModelName` + `crossTeamModelUsage`.
- Do not weaken existing media/session/audit queries; prove non-collision at test level (ride-on decision above).
