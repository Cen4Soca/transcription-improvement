# Implementation Plan — DataBucket transcriptions/ expiration rule

## Scope & context

Add a single S3 lifecycle EXPIRATION rule to **DataBucket** in
`infra/lib/stacks/foundation-stack.ts`, scoped to the `transcriptions/` prefix, deleting
the Transcribe raw-output JSON (`transcriptions/{jobId}/output.json`) after M days.
M is configurable via `cdk.json` context key `dataTranscriptionExpirationDays` (default 30),
read/validated with the **exact same style** as the existing `mediaGlacierTransitionDays`
helper.

This is the user-approved standalone implementation of the previously-deferred DataBucket
policy. A prior attempt added this but was reverted; this task re-adds it cleanly.

### Hard constraints (do NOT touch)
- MediaBucket (GIR/Deep Archive transitions, abort rule) — unchanged.
- StaticBucket — unchanged.
- Versioning (already removed from all buckets) — unchanged.
- The existing 7-day `AbortIncompleteMultipartUpload` rule on all three buckets — keep intact; ADD the expiration as an additional rule, do not replace it.
- `training-data/` prefix must NOT be expired — only `transcriptions/` is expired.

### Facts discovered during exploration (ground truth for the implementer)

1. **Existing N helper** (foundation-stack.ts, constructor, ~lines 40-47). Mirror this exactly for M:
   ```typescript
   const mediaGlacierTransitionDaysRaw = this.node.tryGetContext('mediaGlacierTransitionDays');
   const parsedGlacierDays = Number(mediaGlacierTransitionDaysRaw);
   const mediaGirTransitionDays =
     Number.isInteger(parsedGlacierDays) && parsedGlacierDays >= 1 ? parsedGlacierDays : 14;
   ```
   Pattern = `tryGetContext` → `Number(...)` → `Number.isInteger(x) && x >= 1 ? x : <default>`.

2. **DataBucket construct** (`new s3.Bucket(this, 'DataBucket', ...)`, ~lines 119-131).
   Currently its `lifecycleRules` array has exactly ONE entry:
   ```typescript
   lifecycleRules: [
     {
       id: 'abort-incomplete-multipart-upload',
       abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
     },
   ],
   ```

3. **`cdk.json`** top-level `context` object already contains `"mediaGlacierTransitionDays": 14` as its last key. Add the new key alongside it.

4. **Test file** `infra/test/foundation-stack.test.ts`:
   - Uses `Template.fromStack(...)`, `hasResourceProperties`, `findResources`, `Match.arrayWith`/`Match.objectLike`.
   - The `media bucket transitions...` test (~line 199) is the model for lifecycle assertions using `LifecycleConfiguration.Rules` with `Match.arrayWith([Match.objectLike({ Prefix: ..., ... })])`.
   - The `all buckets have a 7-day AbortIncompleteMultipartUpload rule` test iterates `findResources` and checks each bucket still has the abort rule — this must keep passing.
   - CloudFormation renders expiration as `Expiration: { ExpirationInDays: M }` inside a rule object (CDK L2 `expiration: Duration.days(M)` → `ExpirationInDays`). Prefix renders as `Prefix: 'transcriptions/'`.

5. **Snapshot tests** — IMPORTANT. `infra/test/__snapshots__/foundation-stack.test.ts.snap` is COMMITTED and captures `DataBucketE3889A50.Properties` (including its current `LifecycleConfiguration`). The two `toMatchSnapshot()` tests (new-creation mode, import mode) WILL FAIL after adding the rule because the DataBucket resource changes. The snapshot MUST be regenerated with `vitest --run -u`. This is expected and correct, not a regression.

6. **Test command**: `cd infra && npm run test` (= `vitest --run`). Update snapshot: `cd infra && npx vitest --run -u`. Type-check/build: `cd infra && npm run build`. Synth sanity: `cd infra && npm run synth` (optional).

---

## Steps

- [ ] 1. Add the `dataTranscriptionExpirationDays` context key to `cdk.json`.
      Add `"dataTranscriptionExpirationDays": 30` to the top-level `context` object in
      `infra/cdk.json`, immediately after the existing `"mediaGlacierTransitionDays": 14`
      entry (add a comma after the 14 line). This mirrors the existing configurable-days pattern.
      Files: `infra/cdk.json`
      Verify: `cd infra && npm run build` succeeds (JSON stays valid; parsed by CDK at synth).
      Confirm the key reads back via step 4's test run.

- [ ] 2. Add the M-days helper in the FoundationStack constructor, mirroring the N helper exactly.
      In `infra/lib/stacks/foundation-stack.ts`, directly below the existing
      `mediaDeepArchiveTransitionDays` line (end of the Media Glacier block, ~line 47), add:
      ```typescript
      // DataBucket transcription-output expiration (days from object creation).
      // Deletes transcriptions/{jobId}/output.json M days after creation.
      // M is configurable via cdk.json context; falls back to 30 if unset/invalid; guarded >= 1.
      const dataTranscriptionExpirationDaysRaw = this.node.tryGetContext('dataTranscriptionExpirationDays');
      const parsedExpirationDays = Number(dataTranscriptionExpirationDaysRaw);
      const dataTranscriptionExpirationDays =
        Number.isInteger(parsedExpirationDays) && parsedExpirationDays >= 1 ? parsedExpirationDays : 30;
      ```
      Files: `infra/lib/stacks/foundation-stack.ts`
      Verify: `cd infra && npm run build` compiles with no TypeScript errors.

- [ ] 3. Add the expiration lifecycle rule to the DataBucket construct (as an ADDITIONAL rule).
      In the `new s3.Bucket(this, 'DataBucket', ...)` `lifecycleRules` array, add a new rule
      object BEFORE or AFTER the existing abort rule (keep the abort rule intact):
      ```typescript
      {
        id: 'transcriptions-expiration',
        prefix: 'transcriptions/',
        expiration: cdk.Duration.days(dataTranscriptionExpirationDays),
      },
      ```
      Do NOT add any rule targeting `training-data/`; that prefix must remain unexpired.
      Files: `infra/lib/stacks/foundation-stack.ts`
      Verify: `cd infra && npm run build` compiles; `cd infra && npm run synth` renders the
      DataBucket with a `LifecycleConfiguration` containing both the abort rule and a rule with
      `Prefix: transcriptions/` and `Expiration.ExpirationInDays: 30`.

- [ ] 4. Add/extend DataBucket lifecycle assertions in the test file.
      In `infra/test/foundation-stack.test.ts`, inside the existing `describe('S3 Buckets', ...)`
      block (alongside the media-transitions test), add tests matching the existing
      `hasResourceProperties` / `findResources` + `Match` style:
      - **Expiration rule present**: assert a bucket has
        ```typescript
        template.hasResourceProperties('AWS::S3::Bucket', {
          LifecycleConfiguration: {
            Rules: Match.arrayWith([
              Match.objectLike({
                Prefix: 'transcriptions/',
                ExpirationInDays: 30,
                Status: 'Enabled',
              }),
            ]),
          },
        });
        ```
        (Confirm the exact rendered shape from the step-3 synth output; CDK renders
        `expiration: Duration.days(30)` as `ExpirationInDays: 30` on the rule. If synth shows
        `Expiration: { ExpirationInDays: 30 }` nested instead, match that shape — adjust to the
        actual synthesized JSON.)
      - **DataBucket keeps its abort rule**: the existing
        `all buckets have a 7-day AbortIncompleteMultipartUpload rule` test already covers this
        for all three buckets; leave it and confirm it still passes.
      - **training-data/ is NOT expired**: iterate `findResources('AWS::S3::Bucket')` and assert
        no lifecycle rule has `Prefix === 'training-data/'`, e.g.:
        ```typescript
        it('does not expire the training-data/ prefix', () => {
          const buckets = template.findResources('AWS::S3::Bucket');
          for (const [, bucket] of Object.entries(buckets)) {
            const props = (bucket as { Properties: Record<string, unknown> }).Properties;
            const lifecycle = props.LifecycleConfiguration as
              { Rules: Array<Record<string, unknown>> } | undefined;
            const rules = lifecycle?.Rules ?? [];
            expect(rules.some((r) => r.Prefix === 'training-data/')).toBe(false);
          }
        });
        ```
      Files: `infra/test/foundation-stack.test.ts`
      Verify: `cd infra && npm run test` — the new assertions pass (snapshot tests addressed in step 5).

- [ ] 5. Regenerate the committed snapshot and run the full suite green.
      Adding the DataBucket rule changes `foundation-stack.test.ts.snap`, so the two
      `toMatchSnapshot()` tests fail until regenerated. Run `cd infra && npx vitest --run -u`
      to update the snapshot, then inspect the diff in
      `infra/test/__snapshots__/foundation-stack.test.ts.snap` to confirm the ONLY change is the
      added `transcriptions-expiration` rule under `DataBucketE3889A50`'s
      `LifecycleConfiguration` (no unexpected churn to Media/Static/KMS/DynamoDB/Cognito).
      Files: `infra/test/__snapshots__/foundation-stack.test.ts.snap` (regenerated)
      Verify: `cd infra && npm run test` — all tests pass with zero failures, and the snapshot
      diff is limited to the DataBucket expiration rule.

---

## Assumptions
- CDK L2 `expiration` renders as `ExpirationInDays` on the lifecycle rule; the implementer must
  confirm the exact synthesized key/shape from step 3's `npm run synth` output before finalizing
  the step-4 matcher.
- Default M = 30 (per task). The byte-for-byte snapshot in step 5 is regenerated intentionally;
  updating it is the correct action, not a masking of a regression.
- The workspace is not a git repo and must not be committed.
