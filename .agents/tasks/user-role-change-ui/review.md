# Role change in the admin user-management inline edit form

The change adds a role `<select>` to the admin user-management inline edit row and threads a `role?: UserRole` field through every layer that already carries `displayName`/`email`: `UserManagement` props and edit state, `AdminPage` props, the `AdminPageWrapper` wiring in `App.tsx`, and `useAdmin.editUser`. The service layer (`admin-api.ts`) was correctly left untouched because `UpdateUserRequest.role?` already existed. A self-demotion guard prevents a logged-in ADMIN from changing their own role away from ADMIN, implemented twice as specified: the select is `disabled` for the self-admin row, and `handleEditSubmit` rejects a self-admin demotion with a Japanese error before calling `onEditUser`. Role is added to the submit payload only when it differs from the current value, and the all-unchanged path still cancels without an API call.

Watch for: nothing blocking. One behavioral asymmetry worth noting — the submit-time guard fires on any self-admin whose selected role is not ADMIN, regardless of whether the role actually changed, but this is unreachable through the UI and harmless (confirmed). Type threading, accessibility, conventions, and test coverage all match the plan.

**Verdict**: APPROVED

## High-level view

The role field rides the same rails as `displayName` and `email`: `editForm` gains a `role` seeded from `user.role` in `startEdit`, the payload includes `role` only on diff, and the nothing-changed branch now also checks `payload.role === undefined` before cancelling.

The self-demotion guard is genuinely double-layered. The select carries `disabled={isSelfAdmin}` where `isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN'`, computed per row. Independently, `handleEditSubmit` re-derives the same `isSelfAdmin` and, if the chosen role is not ADMIN, sets the error `自分自身の管理者ロールは変更できません。` and returns before `onEditUser`. Both layers use identical trigger conditions, so the control and the validation never disagree.

Types thread the shared `UserRole` from `types/user.ts` at every layer — `UserManagement`, `AdminPage`, `useAdmin` — with no redefinition and `import type` throughout. The `currentUserId` prop is added to both `UserManagement` and `AdminPage` and wired from `user?.userId` in `App.tsx`.

Accessibility holds: the new select has a bound `<label htmlFor={edit-role-${user.userId}}>`, mirrors the create-form control, preserves existing focus-ring and `role="alert"` attributes, and the new test asserts `toHaveNoViolations()` on the open edit form. Conventions (extensionless imports, named exports, Japanese UI text, flat components, no new files) are respected. Verification evidence shows `tsc -b` clean and 1079 tests passing; the targeted file reports 20 passing (15 existing + 5 new).

<details>
<summary>Issues (1)</summary>

1. **Submit guard not gated on role change (non-blocking)** — The submit-time self-admin guard triggers whenever a self-admin's selected role is not ADMIN, not strictly when the role changed. Unreachable via the UI (the select is disabled and seeded to ADMIN) and matches the plan's defensive intent, so no action required; optionally gate on `editForm.role !== user.role` for symmetry with the payload logic.

</details>

<details>
<summary>Details</summary>

### Self-demotion guard: disabled select plus submit validation

`isSelfAdmin` is computed once per row inside the `users.map` body as `currentUserId === user.userId && user.role === 'ADMIN'`, and the edit `<select>` receives `disabled={isSelfAdmin}` plus `disabled:opacity-50 disabled:cursor-not-allowed`. `handleEditSubmit` re-derives the identical condition and, when `isSelfAdmin && editForm.role !== 'ADMIN'`, sets `editError` to `自分自身の管理者ロールは変更できません。` and returns before touching `onEditUser`. Both layers key off the same two facts — the row belongs to the current user and that user is currently ADMIN — so there is no path where the control is enabled but the validation would miss, or vice versa (confirmed).

The guard keys on `user.role === 'ADMIN'` (the server-truth current role), not `editForm.role`, which is the correct anchor: a self-admin cannot escape the guard by first editing the stale form value. The submit branch does not additionally require `editForm.role !== user.role`, so it fires on any non-ADMIN selection rather than strictly on a change. Because the select is disabled and seeded to `ADMIN` in `startEdit`, this branch is unreachable through the UI and the one test that exercises it has to strip the `disabled` attribute by hand to reach it. Harmless, and consistent with the plan's stated "両方実装し防御する" intent (confirmed).

### Payload diffing and the nothing-changed path

`payload.role` is assigned only when `editForm.role !== user.role`, matching the existing `displayName`/`email` diff pattern. The all-unchanged short-circuit was correctly extended to include `payload.role === undefined` alongside the other two, so opening the edit row and saving without changes still calls `cancelEdit()` and never invokes `onEditUser` (confirmed by the "submits only changed fields" and "does not include role" tests).

### Type threading through the stack

`UserManagement`, `AdminPage`, `useAdmin`, and `admin-api` all import `UserRole` from `../types/user` via `import type` and reuse it; the field is uniformly typed `{ displayName?: string; email?: string; role?: UserRole }` at the `onEditUser`/`editUser` boundaries. `admin-api.ts` is unchanged and its pre-existing `UpdateUserRequest.role?: UserRole` carries the value to `PATCH /admin/users/{userId}`. `useAdmin.editUser` passes `data` straight through and merges the server-returned `User` (`{ ...u, ...updated }`) then re-fetches, so the role update reflects without extra logic. `currentUserId?: string` is added to both component prop interfaces and fed from `user?.userId` in `AdminPageWrapper` (confirmed).

### Accessibility

The new control mirrors the create-form select: `<label htmlFor={edit-role-${user.userId}}>ロール</label>` bound to `<select id={edit-role-${user.userId}}>`, with the same focus-ring classes. Existing a11y attributes on the edit form (`aria-label` on the form, `role="alert"` on the error paragraph, scoped table headers) are untouched. The new `has no accessibility violations when the edit form is open` test renders with the edit row open and asserts `expect(results).toHaveNoViolations()`, satisfying the per-component-test a11y requirement that the file previously lacked (confirmed).

### Conventions and structure

Extensionless relative imports, named exports only, Japanese UI strings with English identifiers/comments, flat `components/` placement, and no new files — all respected. The edit `<select>` option labels (レビュアー / チームリーダー / 管理者) match `ROLE_LABELS`. The JSDoc on `onEditUser` was updated to mention ロール (confirmed).

### Test coverage

The five new cases cover the required surface: role-change payload (`{ role: 'TEAM_LEADER' }` on user-2), role omitted when unchanged, disabled select for the self-admin (user-1 with `currentUserId="user-1"`), the submit-guard error message with `onEditUser` not called, and the a11y assertion. All existing displayName/email edit tests and the create/disable/enable suites remain in place. Verification evidence (`tsc -b` clean, 20/20 in the target file, 1079/1079 overall) is present and specific, so no re-run was warranted.

Not tested: the end-to-end thread through `useAdmin.editUser`/`AdminPage` for role (the component test mocks `onEditUser` directly), and the `App.tsx` `currentUserId={user?.userId}` wiring. These are low-risk pass-through assignments verified by the type checker, so the gap is acceptable.

</details>

<details>
<summary>File map</summary>

- `frontend/src/components/UserManagement.tsx` — role added to props type, edit state, `startEdit`, payload diffing, double self-demotion guard, and the edit-form role `<select>`.
- `frontend/src/pages/AdminPage.tsx` — `onEditUser` type gains `role?`, new `currentUserId?` prop passed to `UserManagement`.
- `frontend/src/App.tsx` — `AdminPageWrapper` passes `currentUserId={user?.userId}` to `AdminPage`.
- `frontend/src/hooks/useAdmin.ts` — `editUser` data type gains `role?`; logic unchanged.
- `frontend/src/services/admin-api.ts` — unchanged (`UpdateUserRequest.role?` already present).
- `frontend/src/components/UserManagement.test.tsx` — `vitest-axe` import plus five new cases (role change, role unchanged, disabled self-admin select, submit guard, a11y).

No unified diff available: the project directory is not a git repository (plan: "git は使わない / ワークスペース直編集"). Review done against working-tree files.

</details>
