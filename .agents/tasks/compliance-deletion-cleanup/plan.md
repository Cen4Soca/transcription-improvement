# Implementation Plan — Layer 1: Resilient & Idempotent S3 Deletion Cascade

Scope: Layer 1 ONLY. Harden the multi-object S3 cascade so one transient failure
does not strand the remaining `transcriptions/{jobId}/output.json` objects. No
sweep / reconciliation / EventBridge job / audit-metadata schema change /
lifecycle rule. Single-file logic change plus its co-located tests.

Primary file: `backend/src/services/deletion-service.ts`
Tests: `backend/src/services/deletion-service.test.ts`,
`backend/src/services/deletion-service.property.test.ts`

## Grounding facts (verified by reading the code)

- The ONLY genuine multi-object S3 loop is the private helper
  `deleteTranscriptionJobsForMedia(mediaFileId)` (currently ~L390-424). It is called
  from `deleteMediaFile` step 5b (currently ~L197), AFTER both `s3Deleted = true`
  (media S3 object) and `metadataDeleted = true` have already been set.
- Current loop is fail-fast: `for (const job of jobs)` deletes S3 output
  (`job.outputS3Key ?? \`transcriptions/${job.jobId}/output.json\``) then
  `transcriptionJobRepository.deleteById(job.jobId)`; the first thrown error
  propagates, aborting all remaining jobs and the rest of `deleteMediaFile`.
- When the helper throws, `deleteMediaFile`'s existing `catch` sees
  `s3Deleted=true, metadataDeleted=true` and records `PARTIAL_DELETION_FAILURE`
  with `reason: "Partial deletion failure: S3=deleted, metadata=deleted. <msg>"`,
  then re-throws. This observable behavior MUST be preserved — do not touch the
  catch block or the reason string format in `deleteMediaFile`.
- `deleteTranscription` deletes a SINGLE S3 object before its DynamoDB cascade; it
  falls to the DynamoDB-orphan side (Path D) and is NOT a multi-object S3 loop.
  Its reason string format `S3=${...}, DynamoDB=${...}` is asserted by Property 40
  (`reason` contains `S3=deleted` and `DynamoDB=pending`). DO NOT change
  `deleteTranscription` or its `cascadeDeleteSession` batching loop (that loop
  deletes DynamoDB items only, not S3, so it carries no S3-stranding risk).
- `S3Client.send(DeleteObjectCommand)` on a missing key succeeds (idempotent), so a
  re-run after partial failure is safe for already-deleted output keys.
  `transcriptionJobRepository.deleteById` issues a DynamoDB `DeleteCommand`, which
  is idempotent for an already-deleted key.
- Integration test `backend/src/__tests__/integration/audit-operations.integration.test.ts`
  writes its own `PARTIAL_DELETION_FAILURE` record directly and never invokes the
  cascade helper — it does NOT depend on this change. No update required unless an
  assertion breaks (it will not).

## Exact strings the implementer MUST preserve

- `deleteMediaFile` catch (unchanged):
  `` `Partial deletion failure: S3=${s3Deleted ? 'deleted' : 'pending'}, metadata=${metadataDeleted ? 'deleted' : 'pending'}. ${error instanceof Error ? error.message : 'Unknown error'}` ``
- `deleteTranscription` catch (unchanged):
  `` `Partial deletion failure: S3=${s3Deleted ? 'deleted' : 'pending'}, DynamoDB=${dynamoDeleted ? 'deleted' : 'pending'}. ${error instanceof Error ? error.message : 'Unknown error'}` ``
- Property 40 asserts the `deleteTranscription` reason contains `S3=deleted` and
  `DynamoDB=pending`. Property 40 drives `deleteTranscription` only, so leaving that
  function untouched keeps Property 40 green.

## Items

- [ ] 1. Rewrite the body of `deleteTranscriptionJobsForMedia` to attempt ALL jobs
      instead of aborting on the first failure. Keep the per-job order (delete S3
      output first, then `transcriptionJobRepository.deleteById(job.jobId)`). Wrap
      each job's two-step deletion in an async closure and run all closures with
      `Promise.allSettled`. Collect the rejected results; if any rejected, throw ONE
      aggregated `Error` after all settle (message e.g.
      `` `Failed to delete ${failures.length} of ${jobs.length} transcription job(s): ${messages.join('; ')}` ``)
      so the caller's existing `catch` still records `PARTIAL_DELETION_FAILURE` and
      re-throws. Preserve the early `return` when `jobs.length === 0` and the
      `const dataBucket = getDataBucketName()` guard (skip S3 delete when unset).
      Keep using `job.outputS3Key ?? \`transcriptions/${job.jobId}/output.json\``.
      Do NOT catch-and-swallow inside a job's own two steps: if the S3 delete throws,
      that job's `deleteById` should be skipped and the job counted as failed (the
      S3 object is retried on re-run; order within a job stays S3-then-DynamoDB).
      Files: `backend/src/services/deletion-service.ts`
      Verify: `cd backend && npx vitest --run src/services/deletion-service` — all
      existing tests still pass (especially `cascade deletes all transcription jobs
      and their S3 output`, which asserts both jobs' S3 keys and `deleteById` calls).

- [ ] 2. Confirm no other multi-object S3 loop needs the same treatment, and leave
      `deleteMediaFile`'s single media-object delete, `deleteTranscription`'s single
      output delete, and `cascadeDeleteSession`'s DynamoDB-only batch loop unchanged.
      This is a review/no-op guard item — document in the code comment on the helper
      that only the job-cascade is all-settled; do not broaden scope.
      Files: `backend/src/services/deletion-service.ts` (comment only, if anything)
      Verify: `cd backend && npx vitest --run src/services/deletion-service` passes;
      `cd backend && npm run build` compiles with no new errors.

- [ ] 3. Add unit tests to `deletion-service.test.ts` proving the cascade now
      continues past a mid-loop failure. In the existing `deleteMediaFile` describe
      block, add a test that mocks `listByMediaFileId` to return two jobs
      (`job-fail`, `job-ok`) and makes the S3 `send` reject ONLY for the first job's
      output key (match on `command.input.Key`), resolve otherwise. Assert: (a) BOTH
      jobs' S3 deletes were attempted (`mockS3Send` called with each
      `transcriptions/<id>/output.json`), (b) the surviving job's record is still
      deleted (`mockedDeleteJobById` called with `job-ok`), (c) `deleteMediaFile`
      rejects (aggregated error propagates), (d) `recordAuditLog` was called with
      `operationType: 'PARTIAL_DELETION_FAILURE'`, `resourceType: 'MediaFile'`, and
      `metadata.reason` containing `'Partial deletion failure'` and `'S3=deleted'`
      and `'metadata=deleted'`. Add a second test where a job's `deleteById` rejects
      (not S3) and assert the other job's S3 output + record are still deleted and
      `PARTIAL_DELETION_FAILURE` is recorded. Reset `mockS3Send` default
      (`mockResolvedValue({})`) in these tests so cross-test state does not leak.
      Files: `backend/src/services/deletion-service.test.ts`
      Verify: `cd backend && npx vitest --run src/services/deletion-service.test.ts`
      — new tests pass, no regressions.

- [ ] 4. Update/extend the property tests in `deletion-service.property.test.ts`.
      Property 40 drives `deleteTranscription` (unchanged) — keep it as-is and
      confirm it still passes. For Property 33 (cascade completeness), it currently
      drives `deleteTranscription`'s DynamoDB batch and does NOT encode the Path-B
      fail-fast, so it needs no semantic change; keep it passing. ADD a new
      property-based test (co-located, under a `Feature: deletion` describe
      referencing the cascade helper via `deleteMediaFile`) that generates a random
      list of N jobs (1-10) with a randomly chosen single failing index, mocks
      `listByMediaFileId`/S3 accordingly, and asserts the INVARIANT: every job except
      the failing one has BOTH its S3 output delete attempted and its `deleteById`
      called, AND `deleteMediaFile` rejects, AND `PARTIAL_DELETION_FAILURE` is
      recorded exactly once. Use `{ numRuns: 100 }` and the required docstring
      referencing the validated requirement (reuse Property 33's requirement tag for
      cascade completeness). Follow the existing mocking style in this file
      (`vi.mock` for repositories, `setS3Client` for S3). Note this file currently
      mocks `media-file-repository.js` with only `getById`/`deleteById` and does NOT
      mock `transcription-job-repository.js` or `access-control-service.js`; add the
      needed `vi.mock` for `../repositories/transcription-job-repository.js`
      (`listByMediaFileId`, `deleteById`) and `./access-control-service.js`
      (`canAccessMediaFile`) so `deleteMediaFile` can run, mirroring
      `deletion-service.test.ts`.
      Files: `backend/src/services/deletion-service.property.test.ts`
      Verify: `cd backend && npx vitest --run src/services/deletion-service.property.test.ts`
      — all properties pass with `numRuns: 100`.

- [ ] 5. Full verification pass. Run the whole deletion-service suite and the build.
      Confirm the three preserved contracts: PARTIAL_DELETION_FAILURE still recorded
      on partial failure, error still re-thrown, reason strings unchanged
      (`S3=deleted, metadata=deleted` for media cascade; `S3=deleted, DynamoDB=pending`
      for transcription). Confirm idempotency reasoning holds (S3 DeleteObject and
      DynamoDB DeleteCommand succeed on already-deleted keys) and is noted in the
      helper's doc comment.
      Files: none (verification only)
      Verify: `cd backend && npx vitest --run src/services/deletion-service` passes;
      `cd backend && npm run build` succeeds. Optionally
      `cd backend && npx vitest --run` to confirm no wider regressions.

## Notes / assumptions

- No change to `audit-service.ts`, `transcription-job-repository.ts`, repositories,
  handlers, or infra — I/F unchanged, so their tests need no updates.
- The aggregated error from item 1 keeps the handler-facing behavior (a thrown
  error) identical; the handler already maps thrown errors via `errorResponse`.
- `audit-operations.integration.test.ts` requires LocalStack and is independent of
  this change; do not run it as part of normal verification unless LocalStack is up.
