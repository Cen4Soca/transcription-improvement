# DataBucket transcriptions/ expiration lifecycle rule

Adds a single S3 lifecycle EXPIRATION rule to the DataBucket in `foundation-stack.ts`, scoped to the `transcriptions/` prefix, so Amazon Transcribe raw-output JSON is deleted M days after creation. M is driven by a new `cdk.json` context key `dataTranscriptionExpirationDays` (default 30), read and validated with the exact same style as the pre-existing `mediaGlacierTransitionDays` (N) helper. The change is additive: the DataBucket keeps its 7-day `AbortIncompleteMultipartUpload` rule, and only the `transcriptions/` prefix is targeted — `training-data/` is left untouched. This is the user-approved implementation of a policy that an earlier task deferred.

Watch for: nothing blocking (confirmed). The expiration/abort/prefix scoping, the Number→integer≥1 validation mirroring N, and the untouched MediaBucket/StaticBucket/versioning state all check out against source, synth output, and the regenerated snapshot.

**Verdict**: APPROVED

## High-level view

The configurable-days plumbing follows the established pattern precisely: `tryGetContext('dataTranscriptionExpirationDays')` → `Number(...)` → `Number.isInteger(x) && x >= 1 ? x : 30`. A reviewer who trusts the N helper can trust this one; it is a structural copy with a new key and a new default.

The lifecycle rule is correctly scoped. It carries `prefix: 'transcriptions/'` and `expiration: Duration.days(M)`, added as a second entry in the DataBucket's `lifecycleRules` array rather than replacing the abort rule. Synth output and the committed snapshot both show the DataBucket resolving to exactly two rules (abort + expiration), and no rule anywhere references `training-data/`.

Blast radius is contained. MediaBucket (GIR/Deep Archive transitions, abort), StaticBucket (abort only), versioning (absent on all buckets), and every other bucket's abort rule are byte-for-byte unchanged — the snapshot diff is limited to the one added rule under `DataBucketE3889A50`.

Test coverage directly asserts the three things that matter: the `transcriptions/` prefix with `ExpirationInDays: 30` and `Status: 'Enabled'`, that the bucket carrying that rule still has the 7-day abort rule, and that no bucket expires `training-data/`. Verification evidence (`tsc --noEmit`, `cdk synth --all`, `vitest --run -u`) is present and all steps exited 0.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking findings. The change matches the approved scope exactly.

</details>

<details>
<summary>Details</summary>

### Configurable M mirrors the N helper

The new helper sits directly below the Media Glacier block and is a faithful copy of the N pattern:

```typescript
const dataTranscriptionExpirationDaysRaw = this.node.tryGetContext('dataTranscriptionExpirationDays');
const parsedExpirationDays = Number(dataTranscriptionExpirationDaysRaw);
const dataTranscriptionExpirationDays =
  Number.isInteger(parsedExpirationDays) && parsedExpirationDays >= 1 ? parsedExpirationDays : 30;
```

Same `tryGetContext → Number → Number.isInteger(x) && x >= 1 ? x : default` shape as `mediaGirTransitionDays`, with the task-specified default of 30. `cdk.json` carries `"dataTranscriptionExpirationDays": 30` as the last context key, immediately after `mediaGlacierTransitionDays`. A non-integer, zero, negative, or missing value falls back to 30 (confirmed: the guard rejects `NaN` from `Number(undefined)` and anything `< 1`).

### Prefix-scoped expiration, abort rule preserved

The DataBucket's `lifecycleRules` array now holds both rules, abort first and expiration second:

```typescript
lifecycleRules: [
  { id: 'abort-incomplete-multipart-upload', abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
  { id: 'transcriptions-expiration', prefix: 'transcriptions/', expiration: cdk.Duration.days(dataTranscriptionExpirationDays) },
],
```

The synthesized template and both snapshot blocks (new-creation and import mode) render the DataBucket with exactly these two rules — the abort rule as `AbortIncompleteMultipartUpload.DaysAfterInitiation: 7` and the expiration as `ExpirationInDays: 30`, `Prefix: 'transcriptions/'`, `Status: 'Enabled'`. No rule targets `training-data/`, so that prefix is retained indefinitely as required.

### Containment of blast radius

MediaBucket retains its `media-glacier-transitions` rule (GIR at 14 days, Deep Archive at 104) and its abort rule; StaticBucket retains only its abort rule; no bucket carries a `VersioningConfiguration`. The snapshot grep surfaced only `transcriptions-expiration`/`transcriptions/` as new content, with no `training-data` entry and no churn to Media/Static/KMS/DynamoDB/Cognito resources.

### Tests assert the behavior, not just the shape

Three new assertions in the `S3 Buckets` block match the existing `hasResourceProperties`/`findResources` + `Match` idiom:

- `data bucket expires transcriptions/ objects after 30 days` — asserts a rule with `Prefix: 'transcriptions/'`, `ExpirationInDays: 30`, `Status: 'Enabled'`.
- `data bucket keeps its 7-day AbortIncompleteMultipartUpload rule alongside the expiration rule` — isolates the single bucket carrying the `transcriptions/` rule and confirms it still has the 7-day abort rule.
- `does not expire the training-data/ prefix on any bucket` — iterates all buckets and asserts no rule has `Prefix === 'training-data/'`.

The pre-existing `all buckets have a 7-day AbortIncompleteMultipartUpload rule` test continues to cover the abort rule across all three buckets. Verification reports 154 tests passing (151 prior + 3 new) with 2 snapshots intentionally regenerated.

### Verification evidence

`verification.md` records `npx tsc --noEmit` (exit 0), `npx cdk synth --all` (exit 0, only pre-existing informational warnings), and `npx vitest --run -u` (exit 0, 154 passed, 2 snapshots updated), with the synthesized DataBucket `LifecycleConfiguration` quoted and matching source. Per task instructions these suites were not re-run; the quoted synth output and snapshot content were spot-checked against the source files and agree.

</details>

<details>
<summary>File map</summary>

- `infra/cdk.json` — added `dataTranscriptionExpirationDays: 30` context key.
- `infra/lib/stacks/foundation-stack.ts` — added M-days helper (mirrors N); added `transcriptions-expiration` rule to DataBucket alongside the preserved abort rule.
- `infra/test/foundation-stack.test.ts` — added three assertions (expiration rule, preserved abort rule, training-data not expired).
- `infra/test/__snapshots__/foundation-stack.test.ts.snap` — regenerated; sole change is the added expiration rule under DataBucket in both snapshots.

Workspace is not a git repo; review performed against working-tree source files and task evidence.

</details>
