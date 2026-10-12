# Verification — Layer 1: Resilient & Idempotent S3 Deletion Cascade

## What changed

- `backend/src/services/deletion-service.ts`
  - Rewrote the private helper `deleteTranscriptionJobsForMedia` (the ONLY
    multi-object S3 cascade, Path B in the investigation). It no longer aborts on
    the first failure. Every job's two-step deletion (S3 output first, THEN the
    DynamoDB job record) runs via `Promise.allSettled`; failures are collected and,
    if any job failed, a single aggregated `Error` is thrown after all settle:
    `Failed to delete N of M transcription job(s): <messages>`.
  - Per-job order preserved (S3 → DynamoDB). If a job's S3 delete throws, its
    `deleteById` is skipped and the job counts as failed; the S3 key is retried on
    re-run (S3 DeleteObject + DynamoDB DeleteCommand are idempotent).
  - Expanded the helper doc comment noting this is the only all-settled path and
    the idempotency guarantee.
  - No change to `deleteMediaFile`'s catch/reason string, `deleteTranscription`
    (single-object Path D), or `cascadeDeleteSession` (DynamoDB-only). Scope not
    broadened.
- `backend/src/services/deletion-service.test.ts`
  - Added two regression unit tests in the `deleteMediaFile` block:
    (1) one job's S3 output delete fails mid-cascade → both jobs' S3 deletes
    attempted, surviving job's record still deleted, failing job's record skipped,
    `PARTIAL_DELETION_FAILURE` recorded (reason still contains
    `S3=deleted` and `metadata=deleted`), error re-thrown.
    (2) one job's DynamoDB record delete fails → other job still fully deleted,
    `PARTIAL_DELETION_FAILURE` recorded.
- `backend/src/services/deletion-service.property.test.ts`
  - Added `vi.mock` for `transcription-job-repository.js`
    (`listByMediaFileId`, `deleteById`, `updateStatus`) and
    `access-control-service.js` (`canAccessMediaFile`) so `deleteMediaFile` runs.
  - Added a new property (Feature: deletion, Property 33 — cascade resilience,
    Requirements 21.6): for 1–10 jobs with a random failing index, every
    non-failing job has its S3 output delete attempted and its record deleted, the
    failing job's record is skipped, `deleteMediaFile` rejects, and exactly one
    `PARTIAL_DELETION_FAILURE` is recorded. `{ numRuns: 100 }`.
  - Property 11, 33 (original cascade completeness), 34, 40 unchanged in intent and
    still pass.

## Preserved observable contracts

- `PARTIAL_DELETION_FAILURE` is still recorded via `recordAuditLog` on partial
  failure, and the error is still re-thrown to the handler.
- Reason strings unchanged: media cascade `S3=deleted, metadata=deleted`;
  transcription `S3=deleted, DynamoDB=pending` (Property 40 untouched).
- Idempotency reasoning (S3 DeleteObject / DynamoDB DeleteCommand succeed on
  already-deleted keys) documented in the helper comment.

## Regression evidence (test is a real regression test)

Temporarily restored the OLD fail-fast `for` loop and ran only the new tests:

```
npx vitest --run src/services/deletion-service -t "mid-cascade"
  -> 2 failed  (both new unit regression tests FAIL against old loop)
npx vitest --run src/services/deletion-service.property.test.ts -t "non-failing job"
  -> 1 failed  (new property FAILS against old loop)
```

Restored the all-settled implementation → all pass again.

## Commands run and results

```
cd backend && npx vitest --run src/services/deletion-service
  -> Test Files 2 passed (2);  Tests 42 passed (42)

cd backend && npx vitest --run
  -> Test Files 95 passed | 6 skipped (101)
     Tests 1162 passed | 85 skipped (1247)
  (stderr lines from response-builder.test.ts are intentional error-path logging)

cd backend && npm run build   # tsc -p tsconfig.build.json
  -> exit 0, no errors
```

Integration suite (`audit-operations.integration.test.ts`) requires LocalStack and
was NOT run; the investigation confirms it writes its own
`PARTIAL_DELETION_FAILURE` record directly and never invokes the cascade helper,
so it is independent of this change. No temp files left behind.
