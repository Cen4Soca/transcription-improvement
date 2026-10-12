# CDK context refactor: hardcoded values moved to cdk.json, Consensus min-reviewers made configurable

This change lifts eleven previously-hardcoded infra values into `cdk.json` context — WAF rate limits (three sites now unified), presigned-URL expiry, four monitoring alarm thresholds, CloudFront geoRestriction countries, and the Consensus minimum-reviewer count — and replaces hardcoded `ap-northeast-1` region literals in stack bodies with `this.region`. It also threads the Consensus min-reviewer count across packages: infra injects `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` into the ConsensusAggregation Lambda, and the handler reads it with the existing service constant preserved as a fallback. All new numeric reads use the `Number()` + `Number.isInteger` + `>= 1` guard + fallback pattern already established in the codebase. The intent is operability (tune limits/thresholds per environment without code changes) with zero behavioral drift at the default values.

Watch for: nothing blocking. The default values were chosen to reproduce the prior hardcoded behavior exactly, and the recorded verification (infra+backend `tsc`, infra `vitest` 154 tests, `cdk synth --all`, backend `vitest` 1162 passed) confirms the only template change is the single new env var on the consensus Lambda (confirmed via the plan's verification note and corroborated by reading every edited file). One cosmetic observation only: the `bedrock-comprehend.ts` construct still carries a `?? 'ap-northeast-1'` fallback, but it is deliberately out of scope and never exercised now that `api-stack` passes `this.region` (confirmed).

**Verdict**: APPROVED

## High-level view

The eleven context keys were appended to `cdk.json` with defaults that match the old literals one-for-one (`presignedUrlExpirySeconds: 300`, the WAF limits `25/500/2000`, alarm thresholds `5/10/10/1`, `cloudFrontGeoAllowlist: ["JP"]`, `minReviewersForAutoConsensus: 3`). Because the defaults are identical to what was hardcoded, synth output is unchanged except where a genuinely new resource attribute is introduced.

The three WAF rate-limit sites are now driven from a single trio of context values read in `bin/app.ts` and threaded into both the us-east-1 `CloudFrontWafStack` (auth/general) and the regional `CdnStack`. `CdnStack` gained explicit `wafAuthRateLimitPerFiveMinutes`, `wafGeneralRateLimitPerFiveMinutes`, and `wafRegionalIpRateLimitPerFiveMinutes` props; the previously-implicit regional-IP `2000` default is now passed explicitly rather than relying on an unset prop falling through to the construct default. The legacy `rateLimitPerFiveMinutes` prop is kept only as a `??` fallback behind the new regional prop.

Presigned-URL expiry is read in `ApiStack` and injected as `PRESIGNED_URL_EXPIRY_SECONDS` into the UploadUrl Lambda; backend upload code was correctly left untouched (it reads a service constant, not this env var — this change only parameterizes the injected value for future use). The four monitoring alarm thresholds became required `MonitoringStackProps` fields wired from context, and each alarm's `alarmDescription` now interpolates its configured threshold so the wording can never contradict the value.

CloudFront geoRestriction is computed from `geoAllowlistCountries`: a non-empty array produces an `allowlist(...)`, an empty array omits the `geoRestriction` property entirely via a conditional spread rather than calling `allowlist()` with no arguments. Region literals in stack bodies (`api-stack` Bedrock region + JWT issuer, `foundation-stack` SeedAdminUser `Region`) are now `this.region`, while the deliberate us-east-1 references, the `APAC_DESTINATION_REGIONS` list, the `bin/app.ts` region default, and explanatory comments are untouched. The Consensus min-reviewer count flows infra→Lambda env→handler, with the service's exported constant unchanged at `3` and used as the handler's fallback.

<details>
<summary>Issues (1)</summary>

1. **Non-blocking: residual construct-level region fallback** — `bedrock-comprehend.ts` keeps `region = props.region ?? 'ap-northeast-1'`. This was explicitly in-scope-to-leave per the plan and is now dead at runtime (api-stack passes `this.region`), so no action required; noted only for completeness.

</details>

<details>
<summary>Details</summary>

### Context keys and the numeric-validation pattern

All eleven keys are present in `infra/cdk.json` with the specified defaults and no existing key disturbed (confirmed). Every numeric read uses the robust pattern: `bin/app.ts` factors it into a `readPositiveIntContext(key, fallback)` helper (`Number(tryGetContext)` → `Number.isInteger && >= 1 ? parsed : fallback`), and `api-stack.ts` inlines the same shape for `presignedUrlExpirySeconds` and `minReviewersForAutoConsensus`. The `>= 1` lower bound is appropriate for all of these (percentages, counts, seconds, reviewer count are all `>= 1`). `cloudFrontGeoAllowlist` and `allowedUploadOrigins` are non-numeric and read directly with the existing array/string fallback idioms.

### WAF rate limits unified and the 2000 default made explicit

The three limits are read once in `bin/app.ts` and passed to both WAF sites. In `cdn-stack.ts`, `WafRateLimit` receives `props.wafAuthRateLimitPerFiveMinutes ?? 25` and `props.wafGeneralRateLimitPerFiveMinutes ?? 500`, and `WafIpAllowlist` receives `props.wafRegionalIpRateLimitPerFiveMinutes ?? props.rateLimitPerFiveMinutes`. Previously the regional-IP limit was left unset and silently inherited the construct's `?? 2000`; now `bin/app.ts` passes `wafGeneralIpRateLimitPer5Min` (default 2000) explicitly, so the operative value is visible at the call site. The construct's own `?? 2000` default is retained as defense-in-depth. The `Limit: 2000` snapshot assertion in `cdn-stack.test.ts` was migrated to the renamed prop and still holds.

### Presigned URL expiry — infra-only parameterization

`PRESIGNED_URL_EXPIRY_SECONDS: String(presignedUrlExpirySeconds)` replaces the literal `'300'` on the UploadUrl Lambda. The backend reader was correctly left alone: `upload-service.ts` exports a `PRESIGNED_URL_EXPIRY_SECONDS = 300` constant and the handler does not consume the env var, so this change is a no-op at runtime today and simply positions the value to be context-driven. Default stays `"300"` → no api-stack snapshot drift from this edit.

### Monitoring alarm thresholds and description consistency

The four thresholds are now required props on `MonitoringStackProps`, wired from `alarmLambdaErrorRatePercent/alarmDynamoThrottleCount/alarm4xxRatePercent/alarm5xxRatePercent`. Each alarm's `alarmDescription` interpolates its own prop (e.g. `` `Lambda error rate exceeds ${props.lambdaErrorRatePercent}% over 5 minutes` ``), so description and threshold can't diverge if an operator overrides a value. Defaults equal the prior literals (5/10/10/1), and the monitoring stack has no snapshot test, so no snapshot churn.

### CloudFront geoRestriction with empty-array omission

```ts
const geoAllowlistCountries = props.geoAllowlistCountries ?? ['JP'];
const geoRestriction = geoAllowlistCountries.length
  ? cloudfront.GeoRestriction.allowlist(...geoAllowlistCountries)
  : undefined;
// ...
...(geoRestriction ? { geoRestriction } : {}),
```

This is the correct shape: a non-empty list yields an allowlist, an empty list omits the property instead of invoking `allowlist()` with zero args (which would be invalid). Default `['JP']` reproduces the existing `GeoRestriction { Locations: ["JP"], RestrictionType: "whitelist" }`, so no cdn-stack snapshot diff.

### Region literals → this.region, deliberate us-east-1 preserved

The three in-body region literals are now `this.region`: the `BedrockComprehend` `region:` prop, the JWT issuer URL `https://cognito-idp.${this.region}.amazonaws.com/...`, and `foundation-stack`'s SeedAdminUser `Region: this.region`. A full-tree audit confirms the only remaining `ap-northeast-1` strings in `infra/{lib,bin}` are the intentional `bin/app.ts` default, the `bedrock-comprehend.ts` fallback + `APAC_DESTINATION_REGIONS` list, and comments — all explicitly out of scope. Every `us-east-1` reference (the CloudFrontWafStack env, the inline `CloudFrontClient({ region: 'us-east-1' })`) is untouched, as required. Since the CDK tests instantiate stacks with `env.region: 'ap-northeast-1'`, `this.region` resolves to the identical literal and produces no ARN/snapshot drift — consistent with the recorded synth output still showing `cognito-idp.ap-northeast-1.amazonaws.com`.

### Consensus min-reviewers across packages

Infra reads `minReviewersForAutoConsensus` (default 3) and injects it only onto the ConsensusAggregation Lambda via `{ ...commonEnv, MIN_REVIEWERS_FOR_AUTO_CONSENSUS: String(minReviewers) }` — correctly not added to `commonEnv`. The handler imports the service constant with the ESM `.js` extension (`from '../services/consensus-service.js'`), reads the env var through the same `Number()`/`Number.isInteger`/`>= 1` guard, and falls back to `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` when unset/invalid; the resolved `minReviewers` drives the `session.assignedReviewerCount < minReviewers` guard. The exported constant in `consensus-service.ts` remains `3`, so the `consensus-service.test.ts` assertion ('minimum-reviewer constant of 3') is preserved. This new env var is the single intended api-stack snapshot addition, matching the verification note.

### Verification evidence

The plan's verification note records concrete, specific results rather than a vague "tests pass": infra `tsc --noEmit` PASS; infra `vitest --run` PASS at 154 tests with a deliberate snapshot regen whose diff was exactly one added line (`"MIN_REVIEWERS_FOR_AUTO_CONSENSUS": "3"` on the consensus Lambda) and no region/geo/rate-limit/presigned drift; `cdk synth --all` exit 0 with the expected synthesized values; backend `tsc` PASS and `vitest --run` 1162 passed / 85 skipped. This evidence is detailed enough to trust, and reading each edited file corroborates every claim, so no suite re-run or spot-check was warranted.

### Not independently re-verified

Per the review scope, the test suites and `cdk synth` were not re-run; the recorded evidence was accepted after confirming it against the source. The snapshot file itself was not diffed line-by-line (the note's characterization of a one-line change is consistent with the single new env var being the only resource-shape change).

</details>

<details>
<summary>File map</summary>

- `infra/cdk.json` — appended 11 context keys with defaults.
- `infra/bin/app.ts` — `readPositiveIntContext` helper; WAF/alarm/geo context reads threaded into CloudFrontWafStack, CdnStack, MonitoringStack.
- `infra/lib/stacks/cdn-stack.ts` — three explicit WAF props + `geoAllowlistCountries`; empty-array geoRestriction omission; `this.region` in ARNs/config.
- `infra/lib/stacks/api-stack.ts` — presigned-expiry + min-reviewer context reads; `region: this.region` for Bedrock; `this.region` in JWT issuer; `MIN_REVIEWERS_FOR_AUTO_CONSENSUS` env on ConsensusAggregation; `PRESIGNED_URL_EXPIRY_SECONDS` from context.
- `infra/lib/stacks/monitoring-stack.ts` — four alarm-threshold props wired from context; descriptions interpolate thresholds.
- `infra/lib/stacks/foundation-stack.ts` — SeedAdminUser `Region: this.region`.
- `infra/test/cdn-stack.test.ts` — migrated to `wafRegionalIpRateLimitPerFiveMinutes: 2000`.
- `infra/test/__snapshots__/api-stack.test.ts.snap` — regenerated (one new env var).
- `backend/src/handlers/consensus-aggregation.ts` — env-driven `minReviewers` with service constant fallback; ESM `.js` import preserved.

No full-diff pointer available: the workspace is not a git repository, so this review was produced by reading the edited files directly.

</details>
