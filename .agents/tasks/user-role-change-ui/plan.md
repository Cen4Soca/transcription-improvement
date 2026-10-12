# Implementation Plan: ユーザー管理画面でのロール変更

管理者がユーザー管理画面のインライン編集フォームで、表示名・メールに加えてロール（REVIEWER / TEAM_LEADER / ADMIN）を変更できるようにする。自分自身の ADMIN ロール降格を防ぐガードを含む。バックエンドは変更しない。gitは使わない（ワークスペース直編集）。

## Commands (package.json より)
作業ディレクトリ: `/Users/toshiyahirasawa/Documents/gitProjects/transcription-improvement/frontend`
- 型チェック + ビルド: `npm run build`（= `tsc -b && vite build`）
- 型チェックのみ速く回すなら: `npx tsc -b`
- テスト: `npm run test`（= `vitest --run`）
- 対象ファイルのみ: `npx vitest --run src/components/UserManagement.test.tsx`

## 調査で確認した現状（事実）

- **`UpdateUserRequest`（admin-api.ts）には既に `role?: UserRole` がある。** 変更不要（タスクの「無ければ追加」は不要と確認済み）。`updateUser(userId, data)` は `PATCH /admin/users/${userId}` を呼ぶ。
- **`UserRole`** は `frontend/src/types/user.ts` で `'REVIEWER' | 'TEAM_LEADER' | 'ADMIN'` と定義。全箇所でこれを再利用（再定義しない）。
- **`ROLE_LABELS`**（UserManagement.tsx 内, module スコープ）: `{ REVIEWER: 'レビュアー', TEAM_LEADER: 'チームリーダー', ADMIN: '管理者' }`。
- **create-user フォームの role `<select>` スタイル**（ミラー元, UserManagement.tsx 内）:
  - `<label htmlFor="user-role" className="block text-sm font-medium text-gray-700">ロール</label>`
  - `<select id="user-role" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">` に3つの `<option value="REVIEWER|TEAM_LEADER|ADMIN">`。
- **編集フォームの現状 state/handler**（UserManagement.tsx 内）:
  - state: `const [editForm, setEditForm] = useState({ displayName: '', email: '' });`
  - `startEdit(user)`: `setEditForm({ displayName: user.displayName, email: user.email })`。
  - `handleEditSubmit(e, user)`: trim → 空チェック → `payload` に変更フィールドのみ追加 → 変更なしなら `cancelEdit()` → `onEditUser(user.userId, payload)`。
  - 既存の編集 input は `edit-name-${user.userId}` / `edit-email-${user.userId}` を `htmlFor`/`id` に使用。レイアウトは `grid grid-cols-1 sm:grid-cols-2 gap-3`。
- **data flow（確認済み）**:
  - `App.tsx` の `AdminPageWrapper({ user, getToken })` が `user: AuthUser | null` を受け取り、内部で `<AdminPage ... onEditUser={admin.editUser} />` を描画。ここに `currentUserId={user?.userId}` を足す。
  - `AuthUser`（types/auth.ts）は `.userId` を持つ。`AdminPageWrapper` 内の `admin = useAdmin(adminApi)`。
  - `AdminPage` は props を `<UserManagement ... onEditUser={onEditUser} />` に素通し。
  - `useAdmin.editUser` は `apiRef.current.updateUser(userId, data)` を呼び、`setUsers((prev) => prev.map(... { ...u, ...updated }))` でマージ後 `loadUsers()` で再取得。`updated` はサーバ返却の `User` 全体なので role もマージされる（追加ロジック不要、型だけ拡張）。
- **既存テスト**（UserManagement.test.tsx）は `MemoryRouter` でラップしていない（UserManagement はルーティング非依存。ラップ不要）。**現状この test ファイルには vitest-axe の `toHaveNoViolations()` アサートが無い。** タスク指示の「every component test asserts toHaveNoViolations」を満たすため a11y チェックを追加する（下記 item 7）。既存テストは壊さない。
- **vitest-axe の確立済みパターン（確認済み）**: マッチャは `frontend/src/test-setup.ts` が `vitest-axe/matchers` を `expect.extend` でグローバル登録済み。各 test では `import { axe } from 'vitest-axe'` し、`const results = await axe(container); expect(results).toHaveNoViolations();` と書くだけでよい（例: `DraftRecoveryDialog.test.tsx`, `SegmentEditor.test.tsx`, `SessionAssignmentControls.test.tsx`）。per-file の extend 設定は不要。

## 設計判断（このタスク固有）

- **ロール変更の payload 条件**: displayName/email と同じく「`user.role` から変わった時だけ」`payload.role` に入れる。変更ゼロなら `cancelEdit()`。
- **自己降格ガード（二重）**: `currentUserId === user.userId && user.role === 'ADMIN'` の時、(a) role `<select>` を `disabled`（ADMIN固定表示）にして非ADMIN値を選べなくする。加えて (b) submit 時に `editForm.role !== 'ADMIN'` を検出したら `editError` に「自分自身の管理者ロールは変更できません。」を設定し `onEditUser` を呼ばない。(a)で基本的に(b)は発火しないが、仕様通り両方実装し防御する。
- **editForm に role を追加**: `useState({ displayName: '', email: '', role: 'REVIEWER' as UserRole })`。`startEdit` で `user.role` を初期化。
- 既存の空チェック（表示名・メール必須）はそのまま維持。

---

# Implementation Plan

- [ ] 1. UserManagement.tsx: props 型と editForm state を role 対応に拡張する。
      `UserManagementProps.onEditUser` の `data` 型を `{ displayName?: string; email?: string; role?: UserRole }` に変更。`currentUserId?: string` prop を追加（関数シグネチャの分割代入にも追加）。`editForm` の useState を `{ displayName: '', email: '', role: 'REVIEWER' as UserRole }` に拡張し、`startEdit` で `setEditForm({ displayName: user.displayName, email: user.email, role: user.role })` に更新。`UserRole` は既存 import を再利用。JSDoc の「表示名・メールアドレスを更新する」も role を含む旨に軽く更新。
      Files: `frontend/src/components/UserManagement.tsx`
      Verify: `npx tsc -b` が通る（この時点で未使用の currentUserId 警告が出ないよう、item 2 の select で使用するまで一時的な未使用は許容。tsc の noUnusedParameters 設定次第。もし未使用エラーになるなら item 1〜3 を一括で編集してからビルドする）。

- [ ] 2. UserManagement.tsx: インライン編集フォームに role `<select>` を追加する。
      `editUserId === user.userId` 分岐の grid 内（表示名・メールの隣）に、create フォームの select スタイルをミラーした role select を追加。`htmlFor`/`id` は `edit-role-${user.userId}`、label テキストは「ロール」。`value={editForm.role}`、`onChange` で `setEditForm({ ...editForm, role: e.target.value as UserRole })`。3つの option は ROLE_LABELS に合わせ REVIEWER=レビュアー / TEAM_LEADER=チームリーダー / ADMIN=管理者。自己ADMINガード用に `const isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN';` を分岐先頭で算出し、select に `disabled={isSelfAdmin}` を付与。既存 Tailwind・a11y 属性は踏襲。
      Files: `frontend/src/components/UserManagement.tsx`
      Verify: `npx vitest --run src/components/UserManagement.test.tsx` の既存テストが全て green（既存の表示名/メール編集テストが壊れていないこと）。

- [ ] 3. UserManagement.tsx: handleEditSubmit に role の差分検出と自己降格ガードを入れる。
      payload 型を `{ displayName?: string; email?: string; role?: UserRole }` に変更。自己ADMIN（`currentUserId === user.userId && user.role === 'ADMIN'`）かつ `editForm.role !== 'ADMIN'` の場合は `setEditError('自分自身の管理者ロールは変更できません。')` して return（onEditUser を呼ばない）。`editForm.role !== user.role` の時だけ `payload.role = editForm.role`。「全フィールド変更なし」判定に role も含める（`payload.displayName === undefined && payload.email === undefined && payload.role === undefined` なら `cancelEdit()`）。
      Files: `frontend/src/components/UserManagement.tsx`
      Verify: `npx tsc -b` が通り、`npx vitest --run src/components/UserManagement.test.tsx` の既存テストが green。

- [ ] 4. AdminPage.tsx: onEditUser 型拡張と currentUserId の受け渡し。
      `AdminPageProps.onEditUser` の `data` 型に `role?: UserRole` を追加。`currentUserId?: string` prop を追加して分割代入に含め、`<UserManagement ... currentUserId={currentUserId} />` に渡す。`UserRole` は既にインポート済み（追加 import 不要）。
      Files: `frontend/src/pages/AdminPage.tsx`
      Verify: `npx tsc -b` が通る。

- [ ] 5. App.tsx: AdminPageWrapper から currentUserId を AdminPage に渡す。
      `AdminPageWrapper` 内の `<AdminPage ... />` に `currentUserId={user?.userId}` を追加（`user: AuthUser | null` は既に props で受領済み）。`UserRole` は App.tsx で既に import 済みのため追加不要。
      Files: `frontend/src/App.tsx`
      Verify: `npx tsc -b` が通る。

- [ ] 6. useAdmin.ts: editUser の data 型に role を追加。
      `UseAdminReturn.editUser` の型と `editUser` useCallback 引数の `data` 型を `{ displayName?: string; email?: string; role?: UserRole }` に変更。本体は `updateUser(userId, data)` に素通し＋`{ ...u, ...updated }` マージのままで role も反映されるため、ロジック変更なし。`UserRole` は既に import 済み。
      Files: `frontend/src/hooks/useAdmin.ts`
      Verify: `npx tsc -b` が通る。

- [ ] 7. UserManagement.test.tsx: ロール変更テストを追加（既存カバレッジは保持）。
      `import { axe } from 'vitest-axe'` を追加（マッチャは test-setup.ts でグローバル登録済みのため per-file setup 不要）。追加するケース:
      (a) ロール変更時: `管理者太郎を編集` を開き（user-1 は ADMIN。ただし currentUserId を渡さず別人として編集可能にするため、REVIEWER の user-2 を編集対象にする）、`edit-role-${userId}` の select を TEAM_LEADER に変更して保存 → `onEditUser` が `{ role: 'TEAM_LEADER' }` を含む payload で呼ばれる。
      (b) ロール未変更時: 編集を開いて表示名だけ変更して保存 → payload に `role` が含まれない。
      (c) 自己降格ガード: `currentUserId="user-1"`（ADMIN の user-1）を渡して user-1 を編集 → role select が `disabled`（アサート）。可能なら submit 経路でもエラー文言「自分自身の管理者ロールは変更できません。」が出て `onEditUser` が呼ばれないことを確認（disabled のため UI 操作では到達しないので、必要なら別ユーザーで submit ガードは state 直叩きではなくUIで検証可能な範囲に留める。少なくとも disabled を必須アサート）。
      (d) a11y: 編集フォームを開いた状態の `container` に対し `expect(await axe(container)).toHaveNoViolations()`（タスクの a11y 要件を満たす最低1件）。
      既存の displayName/email テストはそのまま green を維持。
      Files: `frontend/src/components/UserManagement.test.tsx`
      Verify: `npx vitest --run src/components/UserManagement.test.tsx` で新規・既存テストが全て green。

- [ ] 8. 全体検証。
      Files: （なし）
      Verify: `frontend` で `npm run test`（全テスト green）と `npm run build`（`tsc -b && vite build` が成功）。型エラー・ビルドエラー・テスト失敗ゼロを確認。

## 注意 / 前提
- 新規ファイルは作らない。components はフラット構成。
- UI 文言は日本語、識別子・コメントは英語。
- ESM / named export / `import type` を踏襲。フロントの相対 import は拡張子なし。
- `vitest-axe` は `import { axe } from 'vitest-axe'` のみでよい（マッチャは `src/test-setup.ts` 登録済み）。既存の `DraftRecoveryDialog.test.tsx` などの `await axe(container)` → `expect(results).toHaveNoViolations()` パターンをミラーする。
