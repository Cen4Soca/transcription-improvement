# Resilient, idempotent S3 deletion cascade for the job-output path

The multi-object cascade helper `deleteTranscriptionJobsForMedia` was the only place in `deletion-service.ts` where one transient failure could strand the *remaining* jobs' `transcriptions/{jobId}/output.json` objects (and their DynamoDB records) in S3. The fail-fast `for` loop was replaced with a `Promise.allSettled` fan-out: every job's two-step deletion (S3 output first, then the DynamoDB job record) is attempted, failures are collected, and a single aggregated `Error` is thrown only after all jobs settle. The caller's existing `catch` is untouched, so `PARTIAL_DELETION_FAILURE` is still recorded via `recordAuditLog` and the error still re-throws to the handler. Two unit regression tests and one new property (Property 33, cascade resilience) prove remaining jobs are still deleted after a mid-cascade failure.

Watch for: nothing blocking. The change is tightly scoped to Path B; single-object paths, the reason-string format, and `cascadeDeleteSession`'s DynamoDB-only batch loop are all untouched (confirmed). Idempotency rests on S3 `DeleteObject` and DynamoDB `DeleteCommand` succeeding on already-deleted keys — correct, and now documented in the helper comment.

**Verdict**: APPROVED

## High-level view

The orphan-stranding fix is exactly where it belongs. `deleteTranscriptionJobsForMedia` is the only genuine multi-object S3 loop in the service; the investigation identified it as Path B, the sole path that can leave physical S3 objects behind on partial failure. Swapping its fail-fast loop for `Promise.allSettled` means a single job's S3 throttle or DynamoDB error no longer aborts the siblings — each surviving job still gets its output deleted and its record removed. Per-job ordering (S3 then DynamoDB) is preserved, so a job whose S3 delete throws correctly skips its own `deleteById` and is counted failed, to be retried idempotently on re-run.

The observable contract to the caller is unchanged. The helper still throws when any job fails — now a single aggregated `Error` carrying the failure count and messages — which lands in `deleteMediaFile`'s existing catch untouched. That catch still writes `PARTIAL_DELETION_FAILURE` with the same `S3=deleted, metadata=deleted` reason string and re-throws. Nothing downstream (handler mapping, audit schema) needed to change.

Idempotency is reasoned, not just asserted: S3 `DeleteObject` on a missing key and DynamoDB `DeleteCommand` on an already-deleted item both succeed, so re-invoking deletion after a partial failure cleans up the stragglers without erroring. This is now stated in the helper's doc comment.

Scope held the line. The single-object delete in `deleteMediaFile`, the single-output delete and `cascadeDeleteSession` reset path in `deleteTranscription`, and the DynamoDB-only batch loop are all unchanged in ordering and behavior — no sweep, no reconciliation, no EventBridge job, no audit-metadata schema change, no lifecycle rule. The two Layer-2-flavored ideas from the investigation (sweep service, metadata extension) did not leak in.

Test coverage is real. One unit test fails the surviving job's S3 delete, another fails its DynamoDB record delete, and both assert the sibling job is still fully deleted and `PARTIAL_DELETION_FAILURE` is recorded — these fail against the old fail-fast loop (confirmed in the verification notes). The new property drives 1–10 jobs with a random failing index and asserts every non-failing job is attempted and deleted. Property 40 is deliberately left driving `deleteTranscription` (unchanged) and stays green.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings. The change matches the plan and preserves all three stated contracts (audit record on partial failure, re-throw, reason-string format).

</details>

<details>
<summary>Details</summary>

### Orphan-stranding fix: all-settled fan-out in Path B

The rewritten helper maps each job to an async closure that deletes the S3 output (`job.outputS3Key ?? \`transcriptions/${job.jobId}/output.json\``) and then calls `transcriptionJobRepository.deleteById(job.jobId)`, and runs the whole set through `Promise.allSettled`. Because the two steps live inside one closure with no inner `try`, a job whose S3 delete rejects never reaches its own `deleteById` — that job is counted failed and its record is intentionally left for a retry, while every other closure runs to completion independently. This is the precise behavior the orphan-stranding fix requires: a single transient S3 throttle on `job-fail` no longer prevents `job-ok`'s output and record from being removed.

The `jobs.length === 0` early return and the `getDataBucketName()` guard (S3 delete skipped when the bucket env var is unset) are preserved, so the no-jobs and no-bucket cases behave as before.

After all settle, rejected results are filtered and, if any exist, one aggregated error is thrown:

```typescript
throw new Error(
  `Failed to delete ${failures.length} of ${jobs.length} transcription job(s): ${messages.join('; ')}`,
);
```

This is the only structural change needed to turn fail-fast into attempt-all while still signalling partial failure upward.

### Preserved contract: caller catch and reason string untouched

`deleteMediaFile` reaches the helper at step 5b with `s3Deleted = true` and `metadataDeleted = true` already set, so when the aggregated error propagates, the existing catch records `PARTIAL_DELETION_FAILURE` with the unchanged reason `Partial deletion failure: S3=deleted, metadata=deleted. <msg>` and re-throws. The catch block, the reason-string template, and the audit metadata shape were not modified — verified by reading the function. The aggregated error is a plain `Error`, which the handler already maps through `errorResponse`, so the handler-facing behavior (a thrown error) is identical.

`deleteTranscription` and its `S3=deleted, DynamoDB=pending` reason are untouched, which is why Property 40 (driving `deleteTranscription`) needs no change and stays green.

### Idempotency on re-invocation

The helper comment now records the reasoning that makes re-running deletion safe: S3 `DeleteObject` on a missing key returns success, and the DynamoDB `DeleteCommand` behind `deleteById` is a no-op on an already-deleted item. So after a partial failure, re-invoking `deleteMediaFile` re-attempts the stranded `output.json` keys and leftover records without erroring on the ones already removed. No code path asserts prior existence before deleting, so there is nothing that would throw on the second pass.

### Scope: single-object paths and the DynamoDB batch loop unchanged

Reading the full service confirms the all-settled treatment is confined to Path B. `deleteMediaFile`'s own media-object `DeleteObjectCommand`, `deleteTranscription`'s single `transcriptions/{jobId}/output.json` delete, the `updateStatus(..., 'IN_PROGRESS')` reset, and `cascadeDeleteSession`'s 25-item `BatchWriteCommand` loop (DynamoDB only, no S3) are all byte-for-byte the same in ordering and behavior. The helper doc comment explicitly notes it is the *only* all-settled path, discouraging future broadening. No sweep service, reconciliation, EventBridge schedule, audit-metadata key addition, or lifecycle rule appears in the diff — the Layer 2 ideas from the investigation stayed out. File-modification times corroborate that only the three `deletion-service.*` files changed for this work; `audit-service.ts` and `transcription-job-repository.ts` were not touched.

### Test coverage

The regression is genuine. The first unit test rejects only `transcriptions/job-fail/output.json` and asserts both jobs' S3 deletes were attempted, `job-ok`'s record is still deleted, `job-fail`'s record is *not* deleted (S3 came first and threw), `deleteMediaFile` rejects, and `PARTIAL_DELETION_FAILURE` is recorded with a reason containing `S3=deleted` and `metadata=deleted`. The second unit test rejects `job-fail`'s `deleteById` instead and asserts the sibling is still fully deleted. The verification notes record that restoring the old fail-fast loop makes both tests (and the new property) fail — so they bind the new behavior rather than passing vacuously.

The new Property 33 (cascade resilience) generates 1–10 unique jobs with a random failing index, runs `deleteMediaFile`, and asserts every job's S3 delete is attempted, every non-failing job's record is deleted, the failing job's record is skipped, and exactly one `PARTIAL_DELETION_FAILURE` is recorded — `{ numRuns: 100 }`, with a docstring tagging Requirement 21.6, matching the fast-check conventions in the file. It correctly adds the `vi.mock` for `transcription-job-repository.js` and `access-control-service.js` that `deleteMediaFile` needs. Property 40 and the original Property 33 (DynamoDB batch completeness) remain meaningful and unchanged in intent.

Not tested: the double-failure case (two jobs failing in the same cascade) is not asserted directly, but the aggregated-error path handles `failures.length > 1` by construction and the message format covers it; this is a minor gap, not a correctness risk. The LocalStack integration suite was not run, which is correct — the investigation and plan both confirm `audit-operations.integration.test.ts` writes its own `PARTIAL_DELETION_FAILURE` record and never invokes the cascade helper, so it is independent of this change.

</details>

<details>
<summary>File map</summary>

- `backend/src/services/deletion-service.ts` — `deleteTranscriptionJobsForMedia` rewritten from a fail-fast loop to a `Promise.allSettled` fan-out with an aggregated error; helper doc comment expanded to note it is the only all-settled path and to record the idempotency guarantee. No other function changed.
- `backend/src/services/deletion-service.test.ts` — two new regression unit tests in the `deleteMediaFile` block (S3-fail and DynamoDB-fail mid-cascade), each asserting the surviving job is still deleted and `PARTIAL_DELETION_FAILURE` is recorded.
- `backend/src/services/deletion-service.property.test.ts` — added `vi.mock` for `transcription-job-repository.js` and `access-control-service.js`; added Property 33 (cascade resilience, Req 21.6, `numRuns: 100`). Properties 11, 34, 40 and the original Property 33 unchanged.

No git repository is present in the workspace, so this review was derived from the current file state read directly, cross-checked against the recorded plan (base behavior documented) and verification evidence rather than a `git diff`.

</details>
