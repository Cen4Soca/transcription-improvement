# Verification — DataBucket transcriptions/ expiration rule

## Scope implemented

Added a single S3 lifecycle **EXPIRATION** rule to **DataBucket** in
`infra/lib/stacks/foundation-stack.ts`, scoped to the `transcriptions/` prefix, deleting
Transcribe raw-output JSON after M days. M is read from `cdk.json` context key
`dataTranscriptionExpirationDays` (default 30), validated with the same style as the
existing `mediaGlacierTransitionDays` (N) helper.

This is the user-approved, previously-deferred DataBucket policy. The prior review
(`review.json` verdict APPROVED, `findings: []`) covered the earlier state where this rule
was intentionally removed; the user has since explicitly decided to implement it, so this is
a clean re-add of only the DataBucket expiration. No prior findings required fixing.

## Changes

- `infra/cdk.json` — added `"dataTranscriptionExpirationDays": 30` to the top-level
  `context` object, immediately after `"mediaGlacierTransitionDays": 14`.
- `infra/lib/stacks/foundation-stack.ts`:
  - Added M-days helper (`tryGetContext('dataTranscriptionExpirationDays')` → `Number(...)`
    → `Number.isInteger(x) && x >= 1 ? x : 30`), mirroring the N helper exactly.
  - Added a second lifecycle rule to DataBucket:
    `{ id: 'transcriptions-expiration', prefix: 'transcriptions/', expiration: cdk.Duration.days(dataTranscriptionExpirationDays) }`.
    The existing 7-day `abort-incomplete-multipart-upload` rule is kept intact.
  - No rule targets `training-data/`.
- `infra/test/foundation-stack.test.ts` — added three assertions in the `S3 Buckets` block:
  1. a bucket has a lifecycle rule `Prefix: 'transcriptions/'`, `ExpirationInDays: 30`, `Status: 'Enabled'`;
  2. the bucket carrying the `transcriptions/` rule still has the 7-day abort rule (exactly one such bucket);
  3. no bucket has any rule with `Prefix === 'training-data/'`.
- `infra/test/__snapshots__/foundation-stack.test.ts.snap` — regenerated with `vitest --run -u`;
  the only change is the added `transcriptions-expiration` rule under DataBucket's
  `LifecycleConfiguration` in both the new-creation and import-mode snapshots.

MediaBucket, StaticBucket, versioning (removed by omission), and all abort rules are unchanged.

## Commands run (from `infra/`) and results

### `npx tsc --noEmit`
Exit code: **0** (no TypeScript errors).

### `npx cdk synth --all`
Exit code: **0**. Synthesized successfully to `cdk.out`. Only pre-existing informational
warnings (resource-count approaching max on ApiStack, imported-bucket OAC policy notes,
Cognito advancedSecurityMode deprecation) — none related to this change.

Synthesized DataBucket `LifecycleConfiguration` in `cdk.out/dev-FoundationStack.template.json`:

```json
{
  "Rules": [
    {
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 },
      "Id": "abort-incomplete-multipart-upload",
      "Status": "Enabled"
    },
    {
      "ExpirationInDays": 30,
      "Id": "transcriptions-expiration",
      "Prefix": "transcriptions/",
      "Status": "Enabled"
    }
  ]
}
```

Confirmed:
- TWO lifecycle rules on DataBucket: the pre-existing AbortIncompleteMultipartUpload (7 days)
  and the new Expiration with `Prefix: 'transcriptions/'` and `ExpirationInDays: 30` (matching
  the cdk.json value).
- No rule expires `training-data/`.

### `npx vitest --run` (run as `npx vitest --run -u` to regenerate committed snapshots)
Exit code: **0**.

```
Test Files  3 passed (3)
      Tests  154 passed (154)
  Snapshots  2 updated
```

(151 previously-passing tests + 3 new DataBucket assertions = 154. The 2 updated snapshots
are the new-creation and import-mode FoundationStack snapshots; the diff is limited to the
added `transcriptions-expiration` rule on DataBucket — verified by grepping the snapshot:
only `transcriptions-expiration` / `transcriptions/` appear, no `training-data` entry.)

## Outcome

All three verification steps pass. The DataBucket now expires `transcriptions/` objects after
`dataTranscriptionExpirationDays` (default 30) days while retaining its 7-day abort rule, and
`training-data/` is left unexpired. Workspace is not a git repo; no commit made.
