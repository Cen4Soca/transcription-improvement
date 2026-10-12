# Implementation Plan — Frontend ESLint Cleanup (44 errors + 1 warning → 0)

## Scope and hard constraints

- Package: `frontend/`. Run EVERY command with `cwd=/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend`.
- Goal: `npm run lint` = **0 errors, 0 warnings**; `npx vitest --run` = **all passing (1074)**; `npm run build` = **success, 0 type errors**.
- Behavior and UI must NOT change. These are pre-existing baseline errors; the app already works, builds, and all 1074 tests pass (verified at baseline).
- Do NOT weaken `eslint.config.js` or add `eslint-disable` to dodge errors, EXCEPT at most 1–2 structurally-unavoidable spots (only `vitest-axe.d.ts`, Stage 10) with an explanatory comment, and only after the correct fix is attempted first.
- Config fact (confirmed): `@typescript-eslint/no-unused-vars` is `"error"` with tseslint defaults — NO `argsIgnorePattern`/`varsIgnorePattern`. A leading `_` does NOT silence the rule here. Unused vars/params must be genuinely removed, not renamed.
- Structure rules: `components/` is flat (no subdirs). New shared files go under existing `src/` dirs (`utils/`, `services/`) with kebab-case names.
- Do NOT touch `.kiro/`, `node_modules/`, `dist/`, `backend/`, `infra/`, or test snapshots.
- NOT a git repo — no commits/branches/PRs.

## Regression discipline (applies after EVERY stage)

After completing each stage below, run BOTH and keep them green before moving on:

```
npx vitest --run          # must stay at 1074 passed
npm run build             # must exit 0 with no type errors
```

Also run `npm run lint` after each stage to confirm the stage's target errors are gone and NO new errors were introduced. The stages are ordered so each leaves the codebase buildable and test-green. Stages are mostly independent; do them in order to keep lint-count bookkeeping simple.

---

## Baseline enumeration (all 45 problems, confirmed via `npm run lint`)

- **no-unused-vars (12):** `main.tsx:24`, `pages/LanguageModelPage.tsx:37`, `pages/TranscriptionJobPage.test.tsx:2`, `components/TranscriptionJobStatus.test.tsx:2`, `components/IPAllowlistSettings.test.tsx:129`, `components/SegmentEditor.tsx:114`, `hooks/useMediaSync.test.ts:219`, `hooks/useAdmin.ts:281:38, 281:55, 285:40, 285:57`, `test-utils/vitest-axe.d.ts:5:23` (the `T`).
- **set-state-in-effect (10):** `App.tsx:778`, `components/DeleteConfirmDialog.tsx:49`, `components/JobStatusPoller.tsx:77`, `components/SessionAssignmentControls.tsx:78`, `hooks/useAuth.ts:76`, `hooks/useSearch.ts:35`, `hooks/useSessionTimeout.ts:190`, `pages/ReviewPage.tsx:141`, `pages/ReviewPage.tsx:336`, `services/auth-context.tsx:46`.
- **refs (7):** `components/JobStatusPoller.tsx:43,44,45`, `hooks/useAdmin.ts:79`, `hooks/useLanguageModels.ts:53`, `hooks/useMediaUpload.ts:46`, `hooks/useTranscriptionJob.ts:33`.
- **rules-of-hooks (5):** `components/SpeakerLabel.tsx:41,49,65,79,90`.
- **react-refresh/only-export-components (3):** `components/SegmentRow.tsx:19`, `pages/SessionListPage.tsx:27`, `services/auth-context.tsx:17`.
- **purity (2):** `hooks/useSessionTimeout.ts:78, 79`.
- **no-empty-object-type (2):** `test-utils/vitest-axe.d.ts:5:13, 6:13`.
- **preserve-manual-memoization (1):** `components/SpeakerLabelManager.tsx:118`.
- **immutability (1):** `components/SpeakerLabelManager.tsx:117`.
- **exhaustive-deps (1, warning):** `components/SpeakerLabelManager.tsx:115`.

---

## Stage 1 — no-unused-vars: plain deletions (8 of 12 errors)

**What:** Remove genuinely-unused identifiers. None are referenced after removal (verified by grep).

- `src/main.tsx`: delete the `cognitoDomain` local. Remove `let cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN as string || ''` (line ~24) AND the line inside the `try` block `cognitoDomain = config.cognitoDomain || cognitoDomain`. `cognitoDomain` is never consumed (only `userPoolId`, `userPoolClientId`, `apiEndpoint` are used in `Amplify.configure`). Removing the config read line has no side effects.
- `src/pages/TranscriptionJobPage.test.tsx` (line 2): remove `act` from `import { render, screen, waitFor, act } from '@testing-library/react'` → keep `render, screen, waitFor`.
- `src/components/TranscriptionJobStatus.test.tsx` (line 2): remove `waitFor` from `import { render, screen, waitFor } from '@testing-library/react'` → keep `render, screen`.
- `src/components/IPAllowlistSettings.test.tsx` (line ~129): delete the unused `const user = userEvent.setup();` inside the `it('shows max entries error when limit reached during add', …)` test (the test never uses `user`).
- `src/hooks/useMediaSync.test.ts` (line ~219): delete the unused `let isEditing = true;` (the `rerender` uses literal `{ editing: false }`; `isEditing` is never read).
- `src/pages/LanguageModelPage.tsx` (line ~37): in the destructured params, remove `languageModelApi: _languageModelApi,` entirely. The component body uses `useLanguageModelsHook`, never the api prop. KEEP the `languageModelApi: LanguageModelApi` field in `LanguageModelPageProps` (callers still pass it; it is simply not destructured) and KEEP the `LanguageModelApi` type import (still referenced by the interface).

**Files:** `src/main.tsx`, `src/pages/TranscriptionJobPage.test.tsx`, `src/components/TranscriptionJobStatus.test.tsx`, `src/components/IPAllowlistSettings.test.tsx`, `src/hooks/useMediaSync.test.ts`, `src/pages/LanguageModelPage.tsx`.

**Verify:** `npm run lint` shows these 8 no-unused-vars gone; `npx vitest --run` 1074 pass; `npm run build` exits 0.

---

## Stage 2 — no-unused-vars: SegmentEditor + useAdmin stubs (4 of 12 errors)

**What:** Drop unused parameters while preserving each function's type compatibility. In TypeScript a `() => void` (or `(a) => void`) is assignable to a wider `(a, b) => void` signature, so dropping trailing unused params does not break the prop/interface types or callers.

- `src/components/SegmentEditor.tsx` (line ~114): `handleSuggestionClick` ignores its `_segmentId` param and uses the closure's `segment.segmentId`. Change the callback to take no params:
  ```ts
  const handleSuggestionClick = useCallback(() => {
    onSuggestionRequest?.(segment.segmentId, segment.originalText);
  }, [segment.segmentId, segment.originalText, onSuggestionRequest]);
  ```
  `SuggestionButton`'s `onClick: (segmentId: string) => void` still accepts a `() => void`. Behavior identical (it already used the closure id).
- `src/hooks/useAdmin.ts` (lines ~281, ~285): `assignSession`/`unassignSession` are TODO stubs whose `_teamId`/`_sessionId` params are unused. Drop both params:
  ```ts
  const assignSession = useCallback(() => {
    // TODO: Implement when team assignment API is available
  }, []);
  const unassignSession = useCallback(() => {
    // TODO: Implement when team unassignment API is available
  }, []);
  ```
  KEEP the `UseAdminReturn` interface fields `assignSession: (teamId: string, sessionId: string) => void` and `unassignSession: (…) => void` unchanged — a `() => void` is assignable to them, so `App.tsx`/`AdminPage`/`TeamManagement` callers that invoke `onAssignSession(teamId, sessionId)` compile and behave identically (the args are ignored exactly as before).

**Files:** `src/components/SegmentEditor.tsx`, `src/hooks/useAdmin.ts`.

**Verify:** `npm run lint` shows these 4 no-unused-vars gone; `npx vitest --run` 1074 pass (notably `TeamManagement.test.tsx` `onAssignSession` assertion still passes — it asserts on the prop passed in, not on `useAdmin`'s stub); `npm run build` exits 0.

---

## Stage 3 — refs: move render-time `apiRef.current = api` into effects (4 of 7 errors)

**What:** Four hooks assign `apiRef.current = <api prop>` during render. Move each assignment into an effect so the ref is updated outside render. Same "keep latest prop in a ref" semantics; all consumers read `apiRef.current` inside callbacks/effects (never during render), so behavior is unchanged.

For each hook, replace the render-time line `apiRef.current = <api>;` with:
```ts
useEffect(() => {
  apiRef.current = <api>;
});
```
(no dependency array — runs after every render, matching the previous every-render assignment).

- `src/hooks/useTranscriptionJob.ts` (line 33): `apiRef.current = transcriptionApi;` → effect. (`useEffect` already imported.)
- `src/hooks/useLanguageModels.ts` (line 53): `apiRef.current = languageModelApi;` → effect. (`useEffect` already imported.)
- `src/hooks/useAdmin.ts` (line 79): `apiRef.current = adminApi;` → effect. (`useEffect` already imported.)
- `src/hooks/useMediaUpload.ts` (line 46): `apiRef.current = mediaApi;` → effect. **Add `useEffect` to the react import** (`import { useState, useCallback, useRef, useEffect } from 'react';`).

**Files:** `src/hooks/useTranscriptionJob.ts`, `src/hooks/useLanguageModels.ts`, `src/hooks/useAdmin.ts`, `src/hooks/useMediaUpload.ts`.

**Verify:** `npm run lint` shows these 4 refs errors gone; `npx vitest --run` 1074 pass; `npm run build` exits 0.

---

## Stage 4 — refs + set-state-in-effect: JobStatusPoller (3 refs + 1 set-state)

**What:** `JobStatusPoller.tsx` assigns three callback refs during render (lines 43–45) and resets state synchronously in the polling effect (line 77).

1. **refs (43–45):** The three lines `onStatusChangeRef.current = onStatusChange;` / `onCompletedRef.current = onCompleted;` / `onFailedRef.current = onFailed;` run during render. Move all three into a single effect (no deps array, runs every render):
   ```ts
   useEffect(() => {
     onStatusChangeRef.current = onStatusChange;
     onCompletedRef.current = onCompleted;
     onFailedRef.current = onFailed;
   });
   ```
   Place it right after the ref declarations. (`useEffect` already imported.)

2. **set-state-in-effect (77):** The polling effect begins with synchronous `setIsPolling(true); setError(null); setJob(null);` on `[jobId, pollingIntervalMs, fetchStatus]` change — a reset-on-jobId pattern. Behavior-preserving fix using the officially-sanctioned "adjust state during render when a key changes" pattern (NOT in an effect): track the previous `jobId` and reset during render.
   - Add state: `const [prevJobId, setPrevJobId] = useState(jobId);`
   - During render (before the polling effect), add:
     ```ts
     if (prevJobId !== jobId) {
       setPrevJobId(jobId);
       setIsPolling(true);
       setError(null);
       setJob(null);
     }
     ```
   - Remove the `setIsPolling(true); setError(null); setJob(null);` lines from the top of the polling effect, leaving it to only call `fetchStatus()` and set up/tear down the interval. The interval setup still depends on `[jobId, pollingIntervalMs, fetchStatus]`.
   - Note the initial render: previously `isPolling`/`job`/`error` init to `true`/`null`/`null`, and on first mount the effect re-set them to the same values — so initializing `prevJobId` to `jobId` (no reset on first render) preserves identical initial state and first-fetch behavior.

**Files:** `src/components/JobStatusPoller.tsx`.

**Verify:** `npm run lint` shows the 3 refs + 1 set-state gone for this file; `npx vitest --run` 1074 pass (watch `JobStatusPoller`/`TranscriptionJobStatus` tests: polling start, terminal-state stop, jobId change reset); `npm run build` exits 0.

---

## Stage 5 — rules-of-hooks: SpeakerLabel early return before hooks (5 errors)

**What:** `SpeakerLabel.tsx` has an early `return null` at line ~36 (`if (!hasSpeakerIdentification || !speakerLabel) return null;`) placed BEFORE the `useCallback`/`useEffect` hooks (lines 41–90), so those hooks are called conditionally.

**Fix:** Move the early-return guard to AFTER all hook declarations. Reorder the component body so the order is: `useState`/`useRef` (already first) → all `useCallback`s (`handleToggleDropdown`, `handleKeyDown`, `handleSelectLabel`, `handleLabelKeyDown`) → the `useEffect` (click-outside) → THEN the guard `if (!hasSpeakerIdentification || !speakerLabel) { return null; }` → then the JSX `return (...)`.

- The hooks' bodies reference `speakerLabel`/`onCancel`/`isOpen` which remain in scope; keep dependency arrays unchanged.
- The click-outside `useEffect` already early-returns internally when `!isOpen`, so running it even when the component would render null is harmless (dropdown can only be open when the component rendered its button, which only happens past the guard). Behavior and rendered output are identical: when `!hasSpeakerIdentification || !speakerLabel`, the component still renders `null`.

**Files:** `src/components/SpeakerLabel.tsx`.

**Verify:** `npm run lint` shows all 5 rules-of-hooks gone; `npx vitest --run` 1074 pass (SpeakerLabel tests: hidden when no speaker id, dropdown open/close, select/cancel); `npm run build` exits 0.

---

## Stage 6 — purity + set-state-in-effect: useSessionTimeout (2 purity + 1 set-state)

**What:** `useSessionTimeout.ts` calls `Date.now()` during render in two `useRef` initializers (lines 78, 79) and resets `showWarning` synchronously in the init effect's disabled branch (line 190).

1. **purity (78, 79):** `const lastActivityRef = useRef<number>(Date.now());` and `const loginTimeRef = useRef<number>(loginTime ?? Date.now());` evaluate `Date.now()` during render. (`useRef(() => …)` lazy init is NOT supported.) Fix:
   - Initialize both refs to `0`: `const lastActivityRef = useRef<number>(0);` and `const loginTimeRef = useRef<number>(0);`
   - `lastActivityRef` is already assigned `Date.now()` inside `startIdleTimer()` before any read (the countdown reads it only after `startCountdown()`, which runs after `startIdleTimer()`), so no extra init is needed for correctness.
   - `loginTimeRef` is read in the init effect (`const elapsed = Date.now() - loginTimeRef.current;`). Initialize it at the top of that same init effect, before the read, guarding so it is set once from the intended source:
     ```ts
     useEffect(() => {
       if (loginTimeRef.current === 0) {
         loginTimeRef.current = loginTime ?? Date.now();
       }
       if (!enabled) { … }  // existing body continues
     ```
     Keep the existing `loginTime` prop semantics (use `loginTime` when provided, else capture a timestamp once). This preserves the absolute-session countdown math exactly.

2. **set-state-in-effect (190):** In the init effect's `if (!enabled)` branch, `setShowWarning(false)` runs synchronously. This is a reset when `enabled` flips to false. Fix with the "adjust state during render on prop change" pattern:
   - Add: `const [prevEnabled, setPrevEnabled] = useState(enabled);`
   - During render (before the init effect):
     ```ts
     if (prevEnabled !== enabled) {
       setPrevEnabled(enabled);
       if (!enabled) {
         setShowWarning(false);
       }
     }
     ```
   - Remove `setShowWarning(false);` from the `!enabled` branch of the init effect; keep `clearAllTimers()` and the `return;` there. Clearing timers in the effect is a legitimate external-system teardown (not setState) and must stay.
   - Rationale: `showWarning` initializes to `false`; the only way it becomes `true` is `startIdleTimer`/the warning timer (enabled path). When `enabled` goes false, the render-time reset sets it back to `false` exactly as the effect did. When `enabled` is true, `startIdleTimer()` still calls `setShowWarning(false)` as before (that call is inside a user-triggered/timer callback, not an effect body, so it is not flagged).

**Files:** `src/hooks/useSessionTimeout.ts`.

**Verify:** `npm run lint` shows the 2 purity + 1 set-state gone; `npx vitest --run` 1074 pass (useSessionTimeout tests: idle warning fires, countdown, absolute-session expiry using `loginTime`, enabled toggling resets warning); `npm run build` exits 0.

---

## Stage 7 — set-state-in-effect: derive instead of store (useSearch, ReviewPage ×2)

**What:** Three cases where the effect+setState can be replaced by render-time derivation (eliminating the flagged setState entirely), preserving behavior exactly.

1. **`src/hooks/useSearch.ts` (line 35):** `isSearching` is set `true` synchronously whenever `keyword !== debouncedKeyword` and `false` in the 300ms timer (which also sets `debouncedKeyword = keyword`). Thus `isSearching` is exactly `keyword !== debouncedKeyword` at all times. Fix:
   - Delete the `isSearching` state (`const [isSearching, setIsSearching] = useState(false);`).
   - Derive during render: `const isSearching = keyword !== debouncedKeyword;`
   - In the debounce effect, remove the `if (keyword !== debouncedKeyword) setIsSearching(true);` block and the `setIsSearching(false)` call; the effect keeps only the timer that calls `setDebouncedKeyword(keyword)` and the cleanup. Keep deps `[keyword, debouncedKeyword]` (or `[keyword]` — keep `[keyword, debouncedKeyword]` to preserve existing re-arm timing).
   - `isSearching` is still returned in `UseSearchReturn`; the derived value is identical to the former stored value every render.

2. **`src/pages/ReviewPage.tsx` (line 141):** `mediaDeleted` is a one-way latch set from the `isMediaDeleted` prop via an effect and from `handleDeleteMedia`. Replace the mirrored state with a local-delete flag plus derivation:
   - Replace `const [mediaDeleted, setMediaDeleted] = useState(isMediaDeleted);` with `const [locallyDeleted, setLocallyDeleted] = useState(false);`
   - Delete the effect `useEffect(() => { if (isMediaDeleted) setMediaDeleted(true); }, [isMediaDeleted]);`
   - Add derivation: `const mediaDeleted = isMediaDeleted || locallyDeleted;`
   - In `handleDeleteMedia`, change `setMediaDeleted(true);` to `setLocallyDeleted(true);` (keep its deps array as-is).
   - Semantics preserved: `mediaDeleted` is true once either the prop is true (incl. async flip after detail fetch) or a local delete happened; it never goes back to false, same as the latch.

3. **`src/pages/ReviewPage.tsx` (line 336):** `currentMatchIndex` is reset to `0`/`-1` when `search.keyword` or `sortedResults.length` changes, but is otherwise genuinely stateful (next/prev navigation). Use the "adjust state during render when a value changes" pattern:
   - Add: `const [prevSearchKey, setPrevSearchKey] = useState('');` and build the current key `const searchKey = `${search.keyword}|${sortedResults.length}`;` (compute after `sortedResults` is defined via its existing `useMemo`).
   - During render (replacing the effect at 335–338):
     ```ts
     if (prevSearchKey !== searchKey) {
       setPrevSearchKey(searchKey);
       setCurrentMatchIndex(search.keyword ? (sortedResults.length > 0 ? 0 : -1) : -1);
     }
     ```
   - Delete the `useEffect(() => { setCurrentMatchIndex(...); }, [search.keyword, sortedResults.length]);`.
   - Initial render: previously the effect ran on mount and set `currentMatchIndex` to `-1` (keyword empty at start) — `currentMatchIndex` already inits to `-1`, and `prevSearchKey` init `''` vs mount `searchKey` `"|0"` (empty keyword) triggers one render-time set to `-1`, matching the old mount behavior. `handleSearchNext/Previous/Clear` keep using `setCurrentMatchIndex` directly; those are event handlers (allowed).

**Files:** `src/hooks/useSearch.ts`, `src/pages/ReviewPage.tsx`.

**Verify:** `npm run lint` shows these 3 set-state errors gone; `npx vitest --run` 1074 pass (useSearch debounce/`isSearching`, ReviewPage media-deleted notice + delete button hiding, search navigation next/prev/clear and `currentIndex` display); `npm run build` exits 0.

---

## Stage 8 — set-state-in-effect: async-init / data-fetch effects (auth-context, useAuth, App, SessionAssignmentControls, DeleteConfirmDialog)

These are legitimate "sync with an external system" effects, but the current code calls `setState` synchronously before the first `await` (loading flags / resets). Fix each so the synchronous setState is removed or deferred past an `await`, without changing observable behavior. After each sub-fix, re-run lint for that file to confirm it clears; if a specific sub-fix cannot clear the rule without a behavior change, STOP and surface it (do not add eslint-disable here — the only sanctioned disable is Stage 10).

1. **`src/services/auth-context.tsx` (line 46):** The init effect calls `checkAuth()`, whose first synchronous statements are `setIsLoading(true); setError(null);` before `await authProvider.getCurrentUser()`. `isLoading` already initializes to `true` and `error` to `null`, so on the initial mount these synchronous sets are redundant. Fix: have the mount effect run the async work without the leading synchronous resets on first run.
   - Simplest behavior-preserving fix: inside the effect, call an inline async function that awaits first, e.g.:
     ```ts
     useEffect(() => {
       let cancelled = false;
       (async () => {
         try {
           const currentUser = await authProvider.getCurrentUser();
           if (!cancelled) setUser(currentUser);
         } catch {
           if (!cancelled) setUser(null);
         } finally {
           if (!cancelled) setIsLoading(false);
         }
       })();
       return () => { cancelled = true; };
     }, [authProvider]);
     ```
   - Keep the separate `checkAuth` useCallback (still exposed as `refreshUser` and used by `signIn`) with its existing body INCLUDING `setIsLoading(true)` — `refreshUser`/`signIn` invoke it from event handlers / async actions, which are NOT effect bodies and are not flagged. The initial-mount `isLoading` stays `true` from the initializer until the awaited result resolves, exactly as before.
   - This changes NO observable behavior: initial render shows loading, then resolves to user/null.

2. **`src/hooks/useAuth.ts` (line 76):** The mount effect calls `checkAuth()` and registers a `Hub.listen` subscription. `checkAuth`'s first statement is `await getCurrentUser()` (already async — no synchronous setState before the first await), so the flag is triggered by the analyzer treating the called callback as a potential synchronous setter. Fix: keep the `Hub.listen` subscription in the effect (external subscription is the correct use of an effect), but invoke the auth check through an inline async wrapper so the analyzer sees the awaited boundary:
     ```ts
     useEffect(() => {
       void (async () => { await checkAuth(); })();
       const unsubscribe = Hub.listen('auth', ({ payload }) => { … existing … });
       return unsubscribe;
     }, [checkAuth]);
     ```
   - The `Hub.listen` callback's `setUser(null)/setIsAuthenticated(false)` on `signedOut` stays (it is a subscription callback, not a synchronous effect body — allowed). Behavior unchanged: auth checked on mount and on auth events.
   - If the rule still flags the wrapper, the equivalent accepted form is to move the `checkAuth` body inline into the async wrapper. Prefer the minimal wrapper first.

3. **`src/App.tsx` (line 778) — `RankingPageWrapper`:** The effect `useEffect(() => { fetchRanking(selectedPeriod); }, [fetchRanking, selectedPeriod])` triggers because `fetchRanking` begins with synchronous `setIsLoading(true)` before `await rankingApi.getRanking(...)`. `isLoading` already initializes to `true`. Fix: run the fetch via an inline async wrapper and set the loading flag AFTER the first await is not viable (loading must show immediately), so instead keep the loading flag but defer it so it is not the first synchronous statement of the effect:
   - Preferred: inline the fetch in the effect so the setState sits inside the async body after an await is not required — the accepted pattern here is to initialize `isLoading` to `true` (already true) and only call `setIsLoading(true)` for *subsequent* fetches from event handlers (`handlePageChange`). Restructure:
     - Keep `fetchRanking` useCallback but remove the leading `setIsLoading(true)` from it; instead set loading at the two call sites that are NOT the initial effect: wrap `handlePageChange` to `setIsLoading(true)` before calling `fetchRanking`. For the mount/`selectedPeriod`-change effect, call an inline async wrapper that sets `setIsLoading(true)` only when it is not the first run.
   - Simpler equivalent that preserves the spinner on every (re)fetch and satisfies the rule: in the effect, use a ref to detect first run and derive loading from render for the first paint; however, to avoid overcomplicating, implement the "previous selectedPeriod" render-time pattern:
     - Add `const [prevPeriod, setPrevPeriod] = useState(selectedPeriod);`
     - Keep `fetchRanking` WITHOUT the leading `setIsLoading(true)` (move `setIsLoading(true)` to just before each `await` is still synchronous; instead set it at call sites).
     - During render: `if (prevPeriod !== selectedPeriod) { setPrevPeriod(selectedPeriod); setIsLoading(true); }` so a period change shows the spinner at render time (same visual result), then the effect performs the fetch.
     - `handlePageChange`: add `setIsLoading(true);` before `fetchRanking(selectedPeriod, page);`.
     - Initial mount: `isLoading` already `true`; effect fetches; on success `setIsLoading(false)` (inside the async result handler — allowed). Net visible behavior (spinner during load, data after) is identical.
   - Implement whichever of the above the implementer finds cleanest; both preserve the "spinner while loading, then rankings" UX exactly. The invariant to preserve: a spinner is visible on initial load, on period change, and on page change, and disappears when the response resolves.

4. **`src/components/SessionAssignmentControls.tsx` (line 78):** The effect loads team members when `mode === 'user'` and a team is selected; its `!condition` branch synchronously calls `setMembers([])`, and the loading branch calls `setMembersLoading(true); setSelectedUserId('');` before `loadTeamMembers(...)`. Fix:
   - The `setMembers([])` reset when `mode !== 'user' || !selectedTeamId || !loadTeamMembers`: convert the empty-members condition to render-time derivation is not clean because `members` is also populated async. Instead keep the effect but gate the synchronous resets behind the "previous selection" render-time pattern:
     - Track `const [prevSel, setPrevSel] = useState<string>('');` with key `const selKey = `${mode}|${selectedTeamId ?? ''}`;`
     - During render: `if (prevSel !== selKey) { setPrevSel(selKey); setMembers([]); setSelectedUserId(''); }` (reset list + selected user whenever mode/team changes — matches the old synchronous resets).
     - In the effect, remove `setMembers([])` from the early-return branch and remove `setMembersLoading(true); setSelectedUserId('');` from before the fetch; keep `setMembersLoading(true)` ONLY if needed — move it so the fetch path sets loading via the render-time block or just before awaiting. Since `setMembersLoading(true)` must precede the async load, set it in the same render-time block when entering a user-mode+team selection: `if (prevSel !== selKey) { …; setMembersLoading(mode === 'user' && !!selectedTeamId && !!loadTeamMembers); }`.
     - The effect then only: if conditions met, call `loadTeamMembers(selectedTeamId).then(list => !cancelled && (setMembers(list), setMembersLoading(false))).catch(...)` with cleanup `cancelled`. The `.then/.catch` setStates are post-await (allowed).
   - Preserve exactly: when not in user mode / no team, members list is empty and loading false; when a team is picked in user mode, loading shows then members populate. Keep the `cancelled` guard.

5. **`src/components/DeleteConfirmDialog.tsx` (line 49):** The effect `useEffect(() => { if (!isOpen) { setError(null); setIsDeleting(false); } }, [isOpen])` resets state when the dialog closes. Use the "adjust state during render on prop change" pattern:
   - Add `const [prevIsOpen, setPrevIsOpen] = useState(isOpen);`
   - During render: `if (prevIsOpen !== isOpen) { setPrevIsOpen(isOpen); if (!isOpen) { setError(null); setIsDeleting(false); } }`
   - Delete the reset `useEffect` at lines ~46–51. KEEP the focus-management `useEffect` (lines ~37–45) — it touches the DOM/focus (external system), which is a correct effect and is not flagged.
   - Behavior preserved: on close, `error` and `isDeleting` reset to defaults before the next open.

**Files:** `src/services/auth-context.tsx`, `src/hooks/useAuth.ts`, `src/App.tsx`, `src/components/SessionAssignmentControls.tsx`, `src/components/DeleteConfirmDialog.tsx`.

**Verify:** `npm run lint` shows these 5 set-state errors gone; `npx vitest --run` 1074 pass (auth loading→resolved, useAuth Hub events + signOut, Ranking page spinner/data/pagination, SessionAssignmentControls team→member loading and resets, DeleteConfirmDialog reset-on-close + focus); `npm run build` exits 0. If any single file's rule cannot be cleared without altering a passing test's expected behavior, stop and report that file rather than forcing it.

---

## Stage 9 — react-refresh/only-export-components: extract non-component exports (3 errors)

**What:** Move non-component exports out of component/page files into kebab-case files under `utils/` (helpers) and `services/` (context), then update every import site and test.

1. **`src/components/SegmentRow.tsx` (line 19) — `highlightText`:** It returns JSX, so the new file is `.tsx`.
   - Create `src/utils/highlight-text.tsx` containing the moved `highlightText` function and its doc comment, with `import type { ReactNode } from 'react';` at the top. (Keep the exact implementation — the regex escaping and `<mark className="bg-yellow-200 rounded-sm">` output must be byte-identical to preserve UI/behavior and the `highlightText` unit tests.)
   - In `src/components/SegmentRow.tsx`: delete the `highlightText` definition; add `import { highlightText } from '../utils/highlight-text';`. REMOVE the now-unused `import type { ReactNode } from 'react';` (it was only used by `highlightText`) to avoid a new no-unused-vars error.
   - Update importers:
     - `src/components/SegmentEditor.tsx`: change `import { highlightText } from './SegmentRow';` → `import { highlightText } from '../utils/highlight-text';`.
     - `src/components/SegmentRow.test.tsx`: change `import { SegmentRow, highlightText } from './SegmentRow';` → `import { SegmentRow } from './SegmentRow';` + `import { highlightText } from '../utils/highlight-text';` (the `describe('highlightText', …)` block then exercises the moved function).

2. **`src/pages/SessionListPage.tsx` (line 27) — `formatSessionDate`:**
   - Create `src/utils/session-format.ts` with the moved `formatSessionDate` function (exact implementation; the YYYY-MM-DD HH:MM local-time formatting must stay identical for its unit tests).
   - In `src/pages/SessionListPage.tsx`: delete the `formatSessionDate` definition and its doc comment; add `import { formatSessionDate } from '../utils/session-format';`. The internal call at line ~191 (`{formatSessionDate(session.createdAt)}`) now uses the import.
   - Update importer: `src/pages/SessionListPage.test.tsx`: change `import { SessionListPage, formatSessionDate } from './SessionListPage';` → `import { SessionListPage } from './SessionListPage';` + `import { formatSessionDate } from '../utils/session-format';`.

3. **`src/services/auth-context.tsx` (line 17) — `AuthContext` + `AuthState`:** Move the React context (and the types it needs) into a non-component file so the `.tsx` only exports the `AuthContextProvider` component.
   - Create `src/services/auth-context-value.ts` containing: `import { createContext } from 'react';`, the `AuthUser` type import (`import type { AuthUser } from '../types/auth';`), the `AuthState` interface (moved verbatim), and `export const AuthContext = createContext<AuthState | undefined>(undefined);`.
   - In `src/services/auth-context.tsx`: delete the `AuthState` interface and the `AuthContext` creation; add `import { AuthContext } from './auth-context-value'; import type { AuthState } from './auth-context-value';`. Keep the `AuthContextProvider` component (its JSX `<AuthContext.Provider>` now uses the import, and `const value: AuthState` uses the imported type). After this, `auth-context.tsx` exports only the component → rule clears.
   - Update importers of `AuthState`/`AuthContext`:
     - `src/hooks/useAuth.ts`: change `import type { AuthState } from '../services/auth-context';` → `from '../services/auth-context-value';`.
     - `src/components/AuthGuard.test.tsx`: change `import type { AuthState } from '../services/auth-context';` → `from '../services/auth-context-value';`.
     - `src/__tests__/accessibility.test.tsx`: it `vi.mock('../services/auth-context', () => ({ AuthContext: {…}, … }))`. Since `AuthContext` now lives in `auth-context-value`, update this mock: keep mocking whatever `ReviewPage` actually imports. Verify what the test needs — if `ReviewPage`/children import `AuthContext` from `auth-context`, repoint the mock to `../services/auth-context-value`; if they do not consume `AuthContext` at all (the app uses the standalone `useAuth` hook, not `useContext`), the `AuthContext` key in the mock is dead and the mock can stay as-is or be trimmed. Do NOT change test behavior — only adjust the module path so the mock still intercepts the module the component imports. Run the accessibility test to confirm it still passes.

   Note: no app code uses `useContext(AuthContext)` (confirmed by grep), so moving the context does not change runtime behavior.

**Files:** new `src/utils/highlight-text.tsx`, new `src/utils/session-format.ts`, new `src/services/auth-context-value.ts`; modified `src/components/SegmentRow.tsx`, `src/components/SegmentEditor.tsx`, `src/components/SegmentRow.test.tsx`, `src/pages/SessionListPage.tsx`, `src/pages/SessionListPage.test.tsx`, `src/services/auth-context.tsx`, `src/hooks/useAuth.ts`, `src/components/AuthGuard.test.tsx`, `src/__tests__/accessibility.test.tsx`.

**Verify:** `npm run lint` shows all 3 only-export-components gone and NO new no-unused-vars (esp. `ReactNode` removed from SegmentRow); `npx vitest --run` 1074 pass (highlightText tests, formatSessionDate tests, AuthGuard tests, accessibility test); `npm run build` exits 0 (type imports resolve from new paths).

---

## Stage 10 — no-empty-object-type + the unused `T`: vitest-axe.d.ts (2 + 1 errors)

**What:** `src/test-utils/vitest-axe.d.ts` augments vitest with `AxeMatchers`:
```ts
declare module 'vitest' {
  interface Assertion<T> extends AxeMatchers {}            // 5:13 empty-object-type, 5:23 unused T
  interface AsymmetricMatchersContaining extends AxeMatchers {}  // 6:13 empty-object-type
}
```
vitest declares `interface Assertion<T = any> …` (generic) and `interface AsymmetricMatchersContaining …`; the augmentation must stay `interface` (type aliases cannot participate in module/interface declaration merging), and `Assertion<T>` must keep its type parameter to merge with the generic original.

**Fix order (try the correct fix first, fall back to a single documented disable only if TS breaks):**

1. **First attempt (no disable) — make the interfaces non-empty via `extends` of two supertypes:** the rule explicitly does NOT report interfaces that extend from MULTIPLE interfaces. If a second, zero-cost supertype is available (e.g. `extends AxeMatchers, AxeMatchers` is invalid; but `extends AxeMatchers` is single), this is usually not viable because only `AxeMatchers` is the intended supertype. Therefore attempt instead: give each interface a body that references `AxeMatchers` members, e.g. an index/mapped member — NOT clean for a matcher interface. Because neither multi-extends nor adding real members is appropriate for a pure augmentation, proceed to step 2.

   For the unused `T` (5:23): the type parameter is structurally required to merge with `Assertion<T = any>` (merging a generic interface requires matching type params). Confirm whether dropping it breaks the merge: temporarily change to `interface Assertion extends AxeMatchers {}` and run `npm run build`. If the build/tests still pass and `expect(container).toHaveNoViolations()` still type-checks across component tests, dropping `<T>` is the clean fix for the unused-var and should be kept. If dropping `<T>` causes a type error (augmentation arity mismatch), the `<T>` must stay and the unused-var on `T` is then only resolvable via the disable in step 2 (the disable comment that silences the empty-object-type on that line can be scoped to also cover the unused param by placing `// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars`).

2. **Sanctioned fallback (the task's explicit ≤1–2 exception for third-party type defs):** if step 1 cannot satisfy the rules without breaking the vitest type augmentation, add a single `eslint-disable-next-line` above each of the two interface lines with an explanatory comment, e.g.:
   ```ts
   declare module 'vitest' {
     // Augment vitest's generic Assertion<T> with vitest-axe matchers. The empty
     // body is required for declaration merging; T must match vitest's Assertion<T = any>.
     // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
     interface Assertion<T> extends AxeMatchers {}
     // eslint-disable-next-line @typescript-eslint/no-empty-object-type
     interface AsymmetricMatchersContaining extends AxeMatchers {}
   }
   ```
   This is the only place in the task permitted to use `eslint-disable`, and only after step 1 is attempted. If step 1 succeeded in dropping `<T>`, omit `@typescript-eslint/no-unused-vars` from the first disable.

**Files:** `src/test-utils/vitest-axe.d.ts`.

**Verify:** `npm run lint` shows the 2 no-empty-object-type and the `T` unused-var gone; `npx vitest --run` 1074 pass with axe matchers still typed (`toHaveNoViolations`); `npm run build` exits 0.

---

## Stage 11 — exhaustive-deps + immutability + preserve-manual-memoization: SpeakerLabelManager (1 warning + 2 errors)

**What:** All three problems in `src/components/SpeakerLabelManager.tsx` stem from `handleConfirmRename` (useCallback, line ~91) calling `executeRename`, which is defined AFTER it (line ~118). The deps array `[editingLabel, newLabelName, uniqueLabels]` omits `executeRename` (exhaustive-deps warning at 115), and because `executeRename` is referenced before its declaration the compiler cannot preserve the memoization (immutability 117, preserve-manual-memoization 118).

**Fix:** Reorder so `executeRename` is declared BEFORE `handleConfirmRename`, then add `executeRename` to `handleConfirmRename`'s dependency array.
- Move the `const executeRename = useCallback((oldLabel, newLabel) => { … }, [segments, onRenameConfirm]);` block up so it sits ABOVE `handleConfirmRename`.
- Update `handleConfirmRename`'s deps to `[editingLabel, newLabelName, uniqueLabels, executeRename]`.
- `handleMergeConfirm` already depends on `executeRename` (unchanged). No other reordering needed; `uniqueLabels`/state setters remain in scope.
- Behavior is identical: `handleConfirmRename` still calls `executeRename` with the same arguments under the same conditions (no-change short-circuit, conflict→merge dialog, else rename).

**Files:** `src/components/SpeakerLabelManager.tsx`.

**Verify:** `npm run lint` shows the exhaustive-deps warning and both memoization/immutability errors gone; `npx vitest --run` 1074 pass (SpeakerLabelManager: rename confirm, merge-on-conflict dialog, cancel, add/delete label); `npm run build` exits 0.

---

## Stage 12 — Final full verification (acceptance)

**What:** Run the complete gate from a clean state and confirm the end conditions.

```
npm run lint        # EXPECT: 0 errors, 0 warnings (no "problems" summary line, clean exit)
npx vitest --run    # EXPECT: Test Files 89 passed, Tests 1074 passed
npm run build       # EXPECT: tsc -b clean + vite build success, exit 0
```

**Acceptance criteria (all must hold):**
- `npm run lint` reports zero problems.
- `npx vitest --run` reports 1074 passed, 0 failed.
- `npm run build` exits 0 with no TypeScript errors.
- No changes to `eslint.config.js`/`.eslintrc*`; at most the two documented `eslint-disable` lines in `src/test-utils/vitest-axe.d.ts` (Stage 10), and only if step 1 there was insufficient.
- No files touched under `.kiro/`, `node_modules/`, `dist/`, `backend/`, `infra/`, or snapshots.
- New files only: `src/utils/highlight-text.tsx`, `src/utils/session-format.ts`, `src/services/auth-context-value.ts` (all under existing `src/` dirs, kebab-case).
- No behavior/UI change: the only observable surface is lint output; test suite (incl. accessibility and property tests) is unchanged and green.

If any stage's correct fix is found to require a behavior change to pass, STOP and report the specific file and the conflict rather than altering app behavior or weakening lint config.
