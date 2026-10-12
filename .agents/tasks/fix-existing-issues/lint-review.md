# Frontend ESLint cleanup: 44 errors + 1 warning → 0

The change resolves the entire pre-existing ESLint baseline in `frontend/` (44 errors + 1 warning across 12 rule categories) without altering application behavior or UI. The fixes are behavior-preserving refactors: unused identifiers removed, render-time ref assignments and synchronous `setState`-in-effect patterns moved into effects or converted to render-time derivation (the officially-sanctioned "adjust state when a value changes" and "derive instead of store" patterns), one hook-order violation fixed by relocating an early return past all hooks, and three non-component exports extracted into new kebab-case files under existing `src/` dirs to satisfy `react-refresh/only-export-components`. The lint config was not weakened; the only `eslint-disable` additions are two lines in a third-party type-augmentation `.d.ts` where an empty interface body is structurally required for declaration merging.

Watch for: (1) an `eslint-disable-next-line react-hooks/exhaustive-deps` at `useAdmin.ts:177` that is **pre-existing** (not in the baseline enumeration, and the arithmetic confirms it) — out of scope but noted (confirmed); (2) `useSearch` `isSearching` converted from stored state to derived value, which removes a potential one-render lag — equivalent in practice and test-green (confirmed); (3) the SpeakerLabel click-outside effect now runs on renders that return `null`, but it self-guards on `!isOpen` so it is inert (confirmed).

**Verdict**: APPROVED

## High-level view

The scope is a pure lint cleanup against a known 45-problem baseline, and the evidence (`plan.md` with a per-rule baseline enumeration, `verification.md` with the final gate results) maps every fix to a specific rule category. A narrow spot-check re-ran `npm run lint` and reproduced 0 errors / 0 warnings, exit 0, confirming the central claim rather than trusting it blind.

The risky class of fix here is the `set-state-in-effect` conversions, because moving or deriving state can change render timing. Each was done with a behavior-preserving pattern: ref assignments moved into dependency-less effects (same every-render semantics), reset-on-prop-change handled during render via a `prev` comparison, and `isSearching`/`mediaDeleted` turned into derived values that equal their former stored values every render. The two type-sensitive signature drops (`SegmentEditor`/`useAdmin` unused params, `Assertion<T>` → `Assertion`) rely on `() => void` being assignable to wider signatures and on declaration-merge arity, both validated by the passing build.

The API surface is unchanged: hook return types, component props, and context exports keep their shapes. The three extracted files (`highlight-text.tsx`, `session-format.ts`, `auth-context-value.ts`) move implementations byte-for-byte and only redirect import paths; no `useContext(AuthContext)` consumer exists in app code, so relocating the context is inert at runtime.

The guardrails hold: `eslint.config.js` is untouched (recommended configs plus the project's `react/no-danger` rule, no rule downgraded), `components/` stays flat, no new top-level directories, and nothing under `.kiro/`, `backend/`, `infra/`, `node_modules/`, `dist/`, or snapshots was modified. The only disable usage is the two sanctioned lines in `vitest-axe.d.ts`, within the ≤1–2 allowance and each carrying an explanatory comment.

<details>
<summary>Issues (1)</summary>

1. **Pre-existing exhaustive-deps disable in useAdmin** — `useAdmin.ts:177` carries an `eslint-disable-next-line react-hooks/exhaustive-deps`. It is not part of this cleanup (absent from the baseline enumeration; counting it would make the baseline 45 errors, not 44) and is therefore out of scope. No action required for this task; flagged only so it is not mistaken for a new dodge.

</details>

<details>
<summary>Details</summary>

### Lint result verified, not assumed

The verdict turns entirely on the 0/0 claim, so it got a direct spot-check: `npm run lint` (`eslint .`) was re-run and returned a clean output with exit 0 — no "problems" summary line. This matches `verification.md`'s recorded gate (`0 errors, 0 warnings`). The test (1074 passed) and build (0 type errors) results were taken from the recorded evidence per the review mandate, not re-run.

### set-state-in-effect conversions preserve render timing

The ten `set-state-in-effect` violations were resolved with patterns that keep observable state identical every render. The `apiRef.current = api` render-time assignments (seven `refs` sites plus `JobStatusPoller`'s three callback refs) moved into dependency-less effects, which run after every render exactly as the former render-time assignment did; all consumers read `apiRef.current` inside callbacks, never during render.

`useSearch` is the one worth looking at closely:

```ts
// Searching is true while the live keyword differs from the debounced one.
const isSearching = keyword !== debouncedKeyword;
```

Previously `isSearching` was stored state set `true` synchronously on keyword divergence and `false` in the 300ms timer alongside `setDebouncedKeyword(keyword)`. The invariant was always `isSearching === (keyword !== debouncedKeyword)`, so the derived form is equivalent. The one difference is that the stored version could lag by a render on the setState; the derived version is exact. This is strictly more correct, not a behavior regression, and the debounce/`isSearching` tests pass.

`ReviewPage` `mediaDeleted` became `isMediaDeleted || locallyDeleted` (a monotonic latch, same as before), and `currentMatchIndex` reset uses the render-time `prevSearchKey` comparison. `DeleteConfirmDialog`, `SessionAssignmentControls`, and `useSessionTimeout` reset-on-prop-change cases use the same `prev`-comparison-during-render pattern, leaving genuine external-system work (timers, focus, DOM listeners) in effects. The async-init effects (`auth-context`, `useAuth`, `App` ranking) run their fetch through an inline async wrapper so no synchronous `setState` precedes the first `await`; initial loading flags already initialize to `true`, so the first paint is unchanged.

### SpeakerLabel hook-order fix

The `rules-of-hooks` violation was the early `return null` sitting before four `useCallback`s and a `useEffect`. The guard now sits after all hook declarations:

```ts
  // ...all hooks declared above...
  if (!hasSpeakerIdentification || !speakerLabel) {
    return null;
  }
  return ( /* button + dropdown */ );
```

Hook call order is now unconditional. The click-outside effect runs even on renders that will return `null`, but it early-returns on `!isOpen` and the dropdown can only open after the button renders (past the guard), so it is inert in the null case. Rendered output is identical to before.

### Non-component export extraction

Three files triggered `react-refresh/only-export-components`. `highlightText` moved to `utils/highlight-text.tsx` (keeps the `.tsx` extension because it returns `<mark>` JSX; the regex escaping and `bg-yellow-200 rounded-sm` markup are preserved verbatim), `formatSessionDate` to `utils/session-format.ts` (identical date formatting), and `AuthContext` + `AuthState` to `services/auth-context-value.ts`. Import sites and their tests were repointed. No app code uses `useContext(AuthContext)`, so relocating the context changes nothing at runtime; the extracted files are byte-equivalent implementations.

### Type-signature drops rely on assignability, confirmed by build

`SegmentEditor.handleSuggestionClick` and `useAdmin`'s `assignSession`/`unassignSession` dropped unused parameters; the interface fields keep their wider `(a, b) => void` signatures, and a `() => void` is assignable to those, so callers compile unchanged. In `vitest-axe.d.ts`, `Assertion<T>` dropped its unused `<T>` to `interface Assertion extends AxeMatchers {}` — the clean fix for the unused-var rather than a disable. The passing build (0 type errors in the recorded evidence) is what validates these did not break type-checking.

### eslint-disable usage within the sanctioned exception

Two `eslint-disable` lines were added, both in `vitest-axe.d.ts`, both for `@typescript-eslint/no-empty-object-type`, each with an explanatory comment noting the empty body is required for the declaration-merging augmentation — within the ≤1–2 unavoidable-spot allowance. The separate `useAdmin.ts:177` disable is pre-existing (see Issues) and not attributable to this change.

</details>

<details>
<summary>File map</summary>

New files (all under existing `src/` dirs, kebab-case):
- `frontend/src/utils/highlight-text.tsx` — extracted `highlightText` (JSX helper), byte-equivalent.
- `frontend/src/utils/session-format.ts` — extracted `formatSessionDate`, byte-equivalent.
- `frontend/src/services/auth-context-value.ts` — extracted `AuthContext` + `AuthState`.

Representative modified files (lint fixes only, no behavior change):
- `frontend/src/components/SpeakerLabel.tsx` — early-return moved past all hooks.
- `frontend/src/hooks/useSearch.ts` — `isSearching` derived instead of stored.
- `frontend/src/pages/ReviewPage.tsx` — `mediaDeleted` derived; `currentMatchIndex` reset via render-time prev-key.
- `frontend/src/components/JobStatusPoller.tsx` — callback refs + reset moved out of render/effect.
- `frontend/src/hooks/{useAdmin,useLanguageModels,useMediaUpload,useTranscriptionJob}.ts` — ref assignment into effect.
- `frontend/src/hooks/useSessionTimeout.ts` — `Date.now()` out of render; warning reset via prev-enabled.
- `frontend/src/services/auth-context.tsx`, `frontend/src/hooks/useAuth.ts`, `frontend/src/App.tsx`, `frontend/src/components/{DeleteConfirmDialog,SessionAssignmentControls}.tsx` — async-init / reset effect fixes.
- `frontend/src/components/{SegmentEditor,SegmentRow,SpeakerLabelManager}.tsx` — unused-param drops, import repoint, memoization reorder.
- `frontend/src/pages/{LanguageModelPage,SessionListPage}.tsx`, `frontend/src/main.tsx` — unused removals, import repoint.
- `frontend/src/test-utils/vitest-axe.d.ts` — `Assertion<T>`→`Assertion`; 2 sanctioned `eslint-disable` lines.
- Various `*.test.tsx` — unused import removal and import-path repoints for the extracted modules.

No diff tool available (not a git repo); file map derived from `plan.md`, `verification.md`, and direct file inspection.

</details>
