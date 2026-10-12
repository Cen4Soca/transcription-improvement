# Verification: ユーザー管理画面でのロール変更

実装イテレーション: 第1回（`review.json` は存在しなかったため最初からの実装）。

## 変更ファイルと内容

### 1. `frontend/src/components/UserManagement.tsx`
- `UserManagementProps.onEditUser` の `data` 型を `{ displayName?: string; email?: string; role?: UserRole }` に拡張。
- `currentUserId?: string` prop を追加（JSDoc 付き）し、関数シグネチャの分割代入に追加。
- `editForm` の useState を `{ displayName: '', email: '', role: 'REVIEWER' as UserRole }` に拡張。
- `startEdit` で `role: user.role` を初期化。
- `handleEditSubmit`:
  - 自己降格ガード (b): `isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN'` かつ `editForm.role !== 'ADMIN'` の場合、`editError` に「自分自身の管理者ロールは変更できません。」を設定し return（`onEditUser` を呼ばない）。
  - payload 型に `role?: UserRole` を追加。`editForm.role !== user.role` のときのみ `payload.role` に設定。
  - 「全フィールド変更なし」判定に `payload.role === undefined` を追加。
- インライン編集フォームの `users.map` を関数ボディに変更し、行ごとに `isSelfAdmin` を算出。
- grid 内に create フォームの select スタイルをミラーした role `<select>` を追加。`htmlFor`/`id` は `edit-role-${user.userId}`、label「ロール」、option は レビュアー/チームリーダー/管理者。
  - 自己降格ガード (a): `disabled={isSelfAdmin}` を付与（`disabled:opacity-50 disabled:cursor-not-allowed` スタイル追加）。
- JSDoc（onEditUser）を「表示名・メールアドレス・ロールを更新する」に更新。

### 2. `frontend/src/pages/AdminPage.tsx`
- `AdminPageProps.onEditUser` の `data` 型に `role?: UserRole` を追加。
- `currentUserId?: string` prop を追加して分割代入に含め、`<UserManagement ... currentUserId={currentUserId} />` に渡す。
- `UserRole` は既存 import を再利用（追加 import なし）。

### 3. `frontend/src/App.tsx`
- `AdminPageWrapper` 内の `<AdminPage ... />` に `currentUserId={user?.userId}` を追加（`user: AuthUser | null` は既存 props）。

### 4. `frontend/src/hooks/useAdmin.ts`
- `UseAdminReturn.editUser` の型と `editUser` useCallback 引数の `data` 型に `role?: UserRole` を追加。
- ロジック変更なし。`setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, ...updated } : u)))` はサーバ返却の `User` 全体をマージするため role も反映される。

### 5. `frontend/src/services/admin-api.ts`
- 変更なし。`UpdateUserRequest` は既に `role?: UserRole` を含むことを確認済み。

### 6. 型
- `UserRole` は `frontend/src/types/user.ts` のものを全箇所で再利用。再定義なし。新規ファイルなし。

### テスト `frontend/src/components/UserManagement.test.tsx`
- `import { axe } from 'vitest-axe'` を追加（マッチャは `src/test-setup.ts` でグローバル登録済み）。
- 追加テストケース:
  1. ロール変更時に `onEditUser` が `{ role: 'TEAM_LEADER' }` で呼ばれる（REVIEWER の user-2 を対象）。
  2. ロール未変更（表示名のみ変更）時に payload に `role` が含まれない。
  3. 自己降格ガード (a): `currentUserId="user-1"`（ADMIN）で user-1 を編集すると role select が `disabled`。
  4. 自己降格ガード (b): self-admin が降格 submit するとエラー「自分自身の管理者ロールは変更できません。」が表示され `onEditUser` が呼ばれない（UI の disabled を外して submit 経路を検証）。
  5. a11y: 編集フォームを開いた状態の `container` に対し `expect(results).toHaveNoViolations()`。
- 既存の displayName/email テストはそのまま維持。

## 実行コマンドと結果

作業ディレクトリ: `frontend/`

1. 型チェック: `npx tsc -b`
   - 結果: **PASS**（Exit Code 0、エラーなし）。

2. 対象テスト: `npx vitest --run src/components/UserManagement.test.tsx`
   - 結果: **PASS** — Test Files 1 passed、Tests 20 passed（既存 15 + 新規 5）。

3. 全テスト: `npx vitest --run`
   - 結果: **PASS** — Test Files 89 passed (89)、Tests 1079 passed (1079)。失敗ゼロ。
   - 備考: `HTMLCanvasElement's getContext()` / `navigation to another Document` の "Not implemented" 警告は jsdom 由来の既存ノイズでテスト失敗ではない。

新規に導入した失敗・既存の失敗ともに **なし**。
