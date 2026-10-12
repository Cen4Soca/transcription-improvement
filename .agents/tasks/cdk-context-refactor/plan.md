# Implementation Plan — CDK Context Refactor

Refactor the `infra/` CDK app so currently-hardcoded values are read from `cdk.json`
context, plus one cross-package change making the Consensus minimum-reviewer count
configurable via a Lambda env var. Work directly in the repo (no worktree). Keep each
step buildable.

## Context discovered during exploration (read this first)

- **Numeric-context parsing pattern** (reuse verbatim for every new numeric key) lives in
  `infra/lib/stacks/foundation-stack.ts` (~lines 42-55):
  ```ts
  const raw = this.node.tryGetContext('key');
  const parsed = Number(raw);
  const value = Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT;
  ```
  In `bin/app.ts` use `app.node.tryGetContext('key')` instead of `this.node...`.
  Preserve this `Number()` + `Number.isInteger` + lower-bound-guard + fallback style.
- **Region is safe to swap to `this.region`.** `infra/lib/constructs/bedrock-comprehend.ts`
  uses its `region` prop only to build ARN strings and the `aws:RequestedRegion` Comprehend
  condition. Each stack is created with an explicit `env.region` (from context `region`,
  default `ap-northeast-1`), so `this.region` resolves to that literal at synth time. In the
  CDK tests the stacks are instantiated with `env.region: 'ap-northeast-1'`, so `this.region`
  resolves to the identical string — **the TASK F region edits produce no snapshot/ARN diff.**
- **Snapshot tests are full-template `toMatchSnapshot()`** (`infra/test/*.test.ts` call
  `expect(template.toJSON()).toMatchSnapshot()`), snapshots in
  `infra/test/__snapshots__/`. Any resource-shape change (notably the two NEW Lambda env
  vars in TASK C/G) WILL diff the `api-stack` snapshot and must be regenerated with `-u`
  after visual review. See the per-task "snapshot impact" notes and Step 11.
- **TASK C subtlety:** the backend does NOT currently read `PRESIGNED_URL_EXPIRY_SECONDS`
  from env — `backend/src/services/upload-service.ts` hardcodes
  `export const PRESIGNED_URL_EXPIRY_SECONDS = 300;` and `handlers/upload-url.ts` never
  reads the env var. The task scopes TASK C to infra only ("Do not change the backend
  reader"), so leave all backend upload code untouched; just make the injected value
  context-driven in `api-stack.ts`.
- **TASK G import rule:** `backend/src/handlers/consensus-aggregation.ts` already imports
  `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` from `../services/consensus-service.js` (ESM `.js`).
  Keep that import (it is the fallback). Do NOT change the exported constant in
  `consensus-service.ts` — `consensus-service.test.ts` asserts it equals `3`.
- **Confirmed hardcoded `ap-northeast-1` literals to convert** (TASK F): `api-stack.ts`
  BedrockComprehend `region:` (~line 67) and the JWT issuer URL (~line 1214);
  `foundation-stack.ts` SeedAdminUser `Region:` (~line 431). LEAVE AS-IS: `bin/app.ts`
  region-derivation default (~line 15, intentional default), the `us-east-1` references
  (CloudFrontWafStack env, CallbackUrlHandler `CloudFrontClient({ region: 'us-east-1' })`),
  the `APAC_DESTINATION_REGIONS` list in `bedrock-comprehend.ts`, and all explanatory
  comments mentioning `ap-northeast-1`.
- **Build/verify commands:**
  - infra typecheck: `cd infra && npm install && npx tsc --noEmit`
  - infra synth: `cd infra && npx cdk synth --all` (uses `cdk.json` context)
  - infra tests: `cd infra && npx vitest --run` (snapshot update: `npx vitest --run -u`)
  - backend tests: `cd backend && npm install && npx vitest --run`

---

- [ ] 1. Add the 11 new context keys to `infra/cdk.json`.
      Append to the existing `context` object (keep every existing key untouched):
      `"allowedUploadOrigins": ""`, `"presignedUrlExpirySeconds": 300`,
      `"wafAuthRateLimitPer5Min": 25`, `"wafGeneralRateLimitPer5Min": 500`,
      `"wafGeneralIpRateLimitPer5Min": 2000`, `"alarmLambdaErrorRatePercent": 5`,
      `"alarmDynamoThrottleCount": 10`, `"alarm4xxRatePercent": 10`,
      `"alarm5xxRatePercent": 1`, `"cloudFrontGeoAllowlist": ["JP"]`,
      `"minReviewersForAutoConsensus": 3`. (`allowedUploadOrigins` is already read by
      foundation-stack.ts; this just supplies the key — do not change that stack's reading
      logic, its `''`→`['*']` fallback already works.)
      Files: `infra/cdk.json`
      Verify: `cd infra && npx tsc --noEmit` succeeds (JSON parses; no code change yet).

- [ ] 2. TASK B — read WAF rate-limit context in `bin/app.ts` and thread it through.
      Near the other `tryGetContext` reads at the top of `bin/app.ts`, add validated numeric
      reads (reuse the `Number()`/`Number.isInteger`/`>= 1`/fallback pattern) for
      `wafAuthRateLimitPer5Min` (default 25), `wafGeneralRateLimitPer5Min` (default 500),
      `wafGeneralIpRateLimitPer5Min` (default 2000). Pass auth/general into the existing
      `new CloudFrontWafStack(...)` call (replacing the hardcoded `25`/`500`). Pass auth,
      general, and general-ip into `new CdnStack(...)` using the new props added in Step 3
      (`wafAuthRateLimitPerFiveMinutes`, `wafGeneralRateLimitPerFiveMinutes`,
      `wafRegionalIpRateLimitPerFiveMinutes`). Do NOT change CloudFrontWafStack's internal
      `?? 25` / `?? 500` fallbacks.
      Files: `infra/bin/app.ts`
      Verify: `cd infra && npx tsc --noEmit` (will fail until Step 3 adds the CdnStack props;
      do Steps 2 and 3 together before typechecking).

- [ ] 3. TASK B — add explicit WAF props to `CdnStack` and wire both WAF constructs.
      In `infra/lib/stacks/cdn-stack.ts` add three props to `CdnStackProps`:
      `wafAuthRateLimitPerFiveMinutes?: number`, `wafGeneralRateLimitPerFiveMinutes?: number`,
      `wafRegionalIpRateLimitPerFiveMinutes?: number` (keep the now-legacy
      `rateLimitPerFiveMinutes?` field for backward compat but stop relying on it; the test in
      Step 10 will migrate to the new name). Pass auth/general into
      `new WafRateLimit(this, 'WafRateLimit', { ... })` (replacing hardcoded `25`/`500`), and
      pass the general-ip value as `rateLimitPerFiveMinutes` into
      `new WafIpAllowlist(this, 'WafIpAllowlist', { ... })` (replacing the currently-unset
      `props.rateLimitPerFiveMinutes` so the construct's 2000 default is now explicit). Keep
      the construct-level defaults (WafRateLimit 25/500, WafIpAllowlist 2000) unchanged.
      Snapshot impact: none expected when defaults 25/500/2000 are preserved; confirm in Step 11.
      Files: `infra/lib/stacks/cdn-stack.ts`
      Verify: `cd infra && npx tsc --noEmit` passes (Steps 2+3 complete).

- [ ] 4. TASK C — inject context-driven PresignedURL expiry into the UploadUrl Lambda.
      In `infra/lib/stacks/api-stack.ts`, near where `bedrockModelId` is read at the top of the
      `ApiStack` constructor, add a validated numeric read of `presignedUrlExpirySeconds`
      (default 300, `Number.isInteger` + `>= 1` guard). In the `UploadUrl` Lambda definition
      (~line 772), replace `PRESIGNED_URL_EXPIRY_SECONDS: '300'` with
      `PRESIGNED_URL_EXPIRY_SECONDS: String(presignedUrlExpirySeconds)`. Do NOT touch any
      backend upload code (the backend reads a constant, not this env var — see context notes).
      Snapshot impact: value stays `"300"` by default → no `api-stack` snapshot diff from this
      change alone.
      Files: `infra/lib/stacks/api-stack.ts`
      Verify: `cd infra && npx tsc --noEmit` passes.

- [ ] 5. TASK D — make monitoring alarm thresholds context-driven.
      In `infra/lib/stacks/monitoring-stack.ts` add four fields to `MonitoringStackProps`:
      `lambdaErrorRatePercent: number`, `dynamoThrottleCount: number`,
      `fourxxRatePercent: number`, `fivexxRatePercent: number`. Replace the four hardcoded
      alarm `threshold:` values (Lambda error rate `5`, DynamoDB throttle `10`, API 4xx `10`,
      API 5xx `1`) with the corresponding props. Keep alarm `alarmDescription` strings
      consistent with the configured value — either interpolate the prop (e.g.
      `` `Lambda error rate exceeds ${props.lambdaErrorRatePercent}% over 5 minutes` ``) or
      make the wording generic; do not leave a description that contradicts the threshold.
      Files: `infra/lib/stacks/monitoring-stack.ts`
      Verify: `cd infra && npx tsc --noEmit` (will fail until Step 6 passes the new props;
      do Steps 5 and 6 together before typechecking).

- [ ] 6. TASK D — read alarm context in `bin/app.ts` and pass into `MonitoringStack`.
      In `infra/bin/app.ts`, add validated numeric reads for `alarmLambdaErrorRatePercent`
      (default 5), `alarmDynamoThrottleCount` (default 10), `alarm4xxRatePercent` (default 10),
      `alarm5xxRatePercent` (default 1) using the standard parsing pattern. Pass them into
      `new MonitoringStack(...)` as `lambdaErrorRatePercent`, `dynamoThrottleCount`,
      `fourxxRatePercent`, `fivexxRatePercent`.
      Snapshot impact: `monitoring-stack` has NO snapshot test today, so no snapshot update
      needed; defaults match current literals anyway.
      Files: `infra/bin/app.ts`
      Verify: `cd infra && npx tsc --noEmit` passes (Steps 5+6 complete).

- [ ] 7. TASK E — make CloudFront geoRestriction context-driven.
      In `infra/lib/stacks/cdn-stack.ts` add `geoAllowlistCountries?: string[]` to
      `CdnStackProps`. In the new-distribution branch, replace
      `geoRestriction: cloudfront.GeoRestriction.allowlist('JP')` with logic that: if the
      countries array is non-empty, sets
      `geoRestriction: cloudfront.GeoRestriction.allowlist(...countries)`; if empty, OMITS the
      `geoRestriction` property entirely (do not call `allowlist()` with no args). Simplest
      shape: compute `const geo = countries.length ? cloudfront.GeoRestriction.allowlist(...countries) : undefined;`
      and spread `...(geo ? { geoRestriction: geo } : {})` into the Distribution props. In
      `infra/bin/app.ts`, read `cloudFrontGeoAllowlist` (default `['JP']`:
      `app.node.tryGetContext('cloudFrontGeoAllowlist') as string[] || ['JP']`) and pass as
      `geoAllowlistCountries` to `new CdnStack(...)`.
      Snapshot impact: default `['JP']` reproduces the existing
      `GeoRestriction { Locations: ["JP"], RestrictionType: "whitelist" }` → no `cdn-stack`
      snapshot diff from this change alone.
      Files: `infra/lib/stacks/cdn-stack.ts`, `infra/bin/app.ts`
      Verify: `cd infra && npx tsc --noEmit` passes.

- [ ] 8. TASK F — remove hardcoded region, use `this.region`.
      In `infra/lib/stacks/api-stack.ts`: change the `BedrockComprehend` prop
      `region: 'ap-northeast-1'` (~line 67) to `region: this.region`; change the JWT issuer URL
      `` `https://cognito-idp.ap-northeast-1.amazonaws.com/${props.userPool.userPoolId}` ``
      (~line 1214) to use `${this.region}`. In `infra/lib/stacks/foundation-stack.ts`: change the
      SeedAdminUser CustomResource property `Region: 'ap-northeast-1'` (~line 431) to
      `Region: this.region`. Do NOT touch the `us-east-1` references, the
      `APAC_DESTINATION_REGIONS` list, the `bin/app.ts` region default, or comments.
      Snapshot impact: because tests instantiate stacks with `env.region: 'ap-northeast-1'`,
      `this.region` resolves to the same literal → no snapshot/ARN diff expected.
      Files: `infra/lib/stacks/api-stack.ts`, `infra/lib/stacks/foundation-stack.ts`
      Verify: `cd infra && npx tsc --noEmit` passes.

- [ ] 9. TASK G — make the Consensus minimum-reviewer count configurable (cross-package).
      Backend: in `backend/src/handlers/consensus-aggregation.ts`, keep the existing ESM import
      of `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` from `../services/consensus-service.js`. Add a
      resolved value, e.g.:
      ```ts
      const parsedMin = Number(process.env.MIN_REVIEWERS_FOR_AUTO_CONSENSUS);
      const minReviewers = Number.isInteger(parsedMin) && parsedMin >= 1
        ? parsedMin
        : MIN_REVIEWERS_FOR_AUTO_CONSENSUS;
      ```
      and use `minReviewers` in the guard
      `if (session.assignedReviewerCount < minReviewers) return;`. Do NOT change the exported
      constant in `consensus-service.ts` (test depends on `3`), and do not touch the service's
      pure functions or any other handler.
      Infra: in `infra/lib/stacks/api-stack.ts`, add a validated read of
      `minReviewersForAutoConsensus` (default 3, `Number.isInteger` + `>= 1`) near the
      `bedrockModelId` read. In the `ConsensusAggregation` Lambda definition (~line 1056) change
      `environment: commonEnv` to
      `environment: { ...commonEnv, MIN_REVIEWERS_FOR_AUTO_CONSENSUS: String(minReviewers) }`.
      Do NOT add this var to `commonEnv` (scope to the consensus aggregation function only).
      Snapshot impact: this ADDS an env var to the ConsensusAggregation Lambda → the
      `api-stack` snapshot WILL diff and must be regenerated in Step 11.
      Files: `backend/src/handlers/consensus-aggregation.ts`, `infra/lib/stacks/api-stack.ts`
      Verify: `cd infra && npx tsc --noEmit` passes; `cd backend && npx tsc --noEmit` passes
      (or rely on the vitest run in Step 12).

- [ ] 10. Update the CDN CDK test to use the renamed WAF prop.
      `infra/test/cdn-stack.test.ts` instantiates `CdnStack` with `rateLimitPerFiveMinutes: 2000`
      (lines ~21 and ~57) and asserts the regional WebACL `RateLimitRule` has `Limit: 2000`
      (line ~147). Since Step 3 drives the WafIpAllowlist rate limit from the new
      `wafRegionalIpRateLimitPerFiveMinutes` prop, update both instantiations to pass
      `wafRegionalIpRateLimitPerFiveMinutes: 2000` (keep the value 2000 so the `Limit: 2000`
      assertion stays valid). Leave the `WafRateLimit` construct unit tests (explicit 25/500) as
      they are — that construct is unchanged.
      Files: `infra/test/cdn-stack.test.ts`
      Verify: part of the vitest run in Step 11.

- [ ] 11. Run the infra CDK tests and regenerate snapshots deliberately.
      Run `cd infra && npx vitest --run`. Expected failures: the `api-stack` full-template
      snapshot (new `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` env var on ConsensusAggregation; the
      `PRESIGNED_URL_EXPIRY_SECONDS` value is unchanged at "300"). Inspect the diff to confirm
      the ONLY template changes are the intended ones (new env var on the consensus Lambda; no
      unexpected ARN/region/geoRestriction/rate-limit drift — the region swap and `['JP']`/300/
      25/500/2000 defaults should produce no diff). After confirming, regenerate with
      `cd infra && npx vitest --run -u`, then re-run `npx vitest --run` to confirm green.
      If the diff shows anything beyond the consensus env var, stop and reconcile before updating.
      Files: `infra/test/__snapshots__/api-stack.test.ts.snap` (and `cdn-stack` snap only if an
      intended diff appears)
      Verify: `cd infra && npx vitest --run` passes.

- [ ] 12. Final build + backend verification.
      Run `cd infra && npx tsc --noEmit` and `cd infra && npx cdk synth --all` (synth reads
      real `cdk.json` context — confirms all new keys parse and stacks assemble). Run
      `cd backend && npm install && npx vitest --run` — the existing
      `consensus-service.test.ts` ('exposes a minimum-reviewer constant of 3') and
      `upload-service` presigned tests must still pass (TASK G left the constant at 3; TASK C
      left backend upload code untouched).
      Files: none (verification only)
      Verify: `npx cdk synth --all` succeeds; `cd backend && npx vitest --run` passes;
      `cd infra && npx vitest --run` passes.

## Verification note (executed)

Workspace is NOT a git repository, so no commit was created; evidence recorded here.

Commands run and results:
- `cd infra && npx tsc --noEmit` → PASS (no type errors).
- `cd infra && npx vitest --run` → PASS (154 tests, 3 files) after a deliberate
  snapshot update. Only `test/api-stack.test.ts` snapshot changed.
  - Snapshot diff (whitespace-ignored, old vs regenerated) was exactly ONE added
    line: `"MIN_REVIEWERS_FOR_AUTO_CONSENSUS": "3"` on the ConsensusAggregation
    Lambda environment. No region/geoRestriction/rate-limit/presigned-URL drift.
    (The `-u` run also reflowed the snapshot file's indentation; cosmetic only.)
  - `test/cdn-stack.test.ts` updated to pass `wafRegionalIpRateLimitPerFiveMinutes: 2000`
    (was `rateLimitPerFiveMinutes: 2000`); the `Limit: 2000` assertion still holds.
- `cd infra && npx cdk synth --all` → PASS (exit 0). Synthesized templates confirm:
  `MIN_REVIEWERS_FOR_AUTO_CONSENSUS: "3"` on the consensus Lambda, CloudFront
  `GeoRestriction.Locations: ["JP"]`, and JWT issuer still
  `cognito-idp.ap-northeast-1.amazonaws.com` (this.region resolves to context region).
- `cd backend && npx tsc --noEmit` → PASS.
- `cd backend && npx vitest --run` → PASS (1162 passed, 85 skipped). The
  `consensus-service.test.ts` 'minimum-reviewer constant of 3' assertion still passes;
  upload presigned tests untouched and green.
- Region audit: remaining `ap-northeast-1` literals in infra/lib|bin are only the
  intentional `bin/app.ts` region default and `bedrock-comprehend.ts`
  (`APAC_DESTINATION_REGIONS` + plain-string fallback default). All `us-east-1`
  references (CloudFrontWafStack env, CallbackUrlHandler CloudFrontClient) left untouched.

## Notes / assumptions

- Steps are ordered so each leaves the tree buildable, with two intentional pairings that
  must land together before typechecking: Steps 2+3 (CdnStack WAF props) and Steps 5+6
  (MonitoringStack alarm props).
- All new numeric context values use the lower-bound `>= 1` guard consistent with the
  existing `mediaGlacierTransitionDays` pattern; alarm percentages (5/10/1) and counts
  (10) and reviewer count (3) are all `>= 1`, so this guard is appropriate.
- `allowedUploadOrigins` reading logic in `foundation-stack.ts` is deliberately left
  unchanged (Step 1 only adds the key).
- Keep each file's existing comment language (foundation-stack has Japanese comments around
  the upload-origins block; api-stack/monitoring use English).
