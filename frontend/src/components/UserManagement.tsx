import { useState } from 'react';
import type { User, UserRole } from '../types/user';
import type { AppError } from '../types/api';

export interface UserManagementProps {
  users: User[];
  isLoading?: boolean;
  onCreateUser?: (data: { email: string; displayName: string; role: UserRole }) => void;
  onDisableUser?: (userId: string) => void;
  onEnableUser?: (userId: string) => void;
  /**
   * ユーザーの表示名・メールアドレス・ロールを更新する。
   * 成功時は null、失敗時は AppError を返す。
   */
  onEditUser?: (
    userId: string,
    data: { displayName?: string; email?: string; role?: UserRole }
  ) => Promise<AppError | null>;
  /** 現在ログイン中のユーザー ID（自己ロール降格ガード用）。 */
  currentUserId?: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  REVIEWER: 'レビュアー',
  TEAM_LEADER: 'チームリーダー',
  ADMIN: '管理者',
};

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  REVIEWER: 'bg-gray-100 text-gray-700',
  TEAM_LEADER: 'bg-blue-100 text-blue-700',
  ADMIN: 'bg-purple-100 text-purple-700',
};

/**
 * UserManagement - ユーザー一覧・登録・無効化・有効化コンポーネント
 *
 * Requirements: 9.2
 */
export function UserManagement({
  users,
  isLoading = false,
  onCreateUser,
  onDisableUser,
  onEnableUser,
  onEditUser,
  currentUserId,
}: UserManagementProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmDisableUserId, setConfirmDisableUserId] = useState<string | null>(null);
  const [confirmEnableUserId, setConfirmEnableUserId] = useState<string | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    email: '',
    role: 'REVIEWER' as UserRole,
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    role: 'REVIEWER' as UserRole,
  });

  const startEdit = (user: User) => {
    setEditUserId(user.userId);
    setEditForm({ displayName: user.displayName, email: user.email, role: user.role });
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditUserId(null);
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent, user: User) => {
    e.preventDefault();
    if (!onEditUser) return;

    const displayName = editForm.displayName.trim();
    const email = editForm.email.trim();
    if (!displayName || !email) {
      setEditError('表示名とメールアドレスを入力してください。');
      return;
    }

    // Self-demotion guard: a logged-in ADMIN cannot change their own role away from ADMIN.
    const isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN';
    if (isSelfAdmin && editForm.role !== 'ADMIN') {
      setEditError('自分自身の管理者ロールは変更できません。');
      return;
    }

    const payload: { displayName?: string; email?: string; role?: UserRole } = {};
    if (displayName !== user.displayName) payload.displayName = displayName;
    if (email !== user.email) payload.email = email;
    if (editForm.role !== user.role) payload.role = editForm.role;

    if (
      payload.displayName === undefined &&
      payload.email === undefined &&
      payload.role === undefined
    ) {
      cancelEdit();
      return;
    }

    setIsEditing(true);
    setEditError(null);
    const error = await onEditUser(user.userId, payload);
    setIsEditing(false);

    if (error) {
      setEditError(error.message);
    } else {
      cancelEdit();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.displayName) return;
    onCreateUser?.(formData);
    setFormData({ email: '', displayName: '', role: 'REVIEWER' });
    setShowCreateForm(false);
  };

  const handleDisableConfirm = (userId: string) => {
    onDisableUser?.(userId);
    setConfirmDisableUserId(null);
  };

  const handleEnableConfirm = (userId: string) => {
    onEnableUser?.(userId);
    setConfirmEnableUserId(null);
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-48"
        role="status"
        aria-label="読み込み中"
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="ユーザー管理">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">ユーザー一覧</h2>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-expanded={showCreateForm}
          aria-controls="create-user-form"
        >
          {showCreateForm ? 'キャンセル' : 'ユーザー追加'}
        </button>
      </div>

      {/* Create user form */}
      {showCreateForm && (
        <form
          id="create-user-form"
          onSubmit={handleSubmit}
          className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3"
          aria-label="ユーザー登録フォーム"
        >
          <div>
            <label htmlFor="user-email" className="block text-sm font-medium text-gray-700">
              メールアドレス
            </label>
            <input
              id="user-email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label htmlFor="user-display-name" className="block text-sm font-medium text-gray-700">
              表示名
            </label>
            <input
              id="user-display-name"
              type="text"
              required
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="山田太郎"
            />
          </div>
          <div>
            <label htmlFor="user-role" className="block text-sm font-medium text-gray-700">
              ロール
            </label>
            <select
              id="user-role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="REVIEWER">レビュアー</option>
              <option value="TEAM_LEADER">チームリーダー</option>
              <option value="ADMIN">管理者</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            登録
          </button>
        </form>
      )}

      {/* User list */}
      {users.length === 0 ? (
        <p className="text-center text-gray-500 py-8">ユーザーがいません</p>
      ) : (
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200" aria-label="ユーザー一覧テーブル">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  表示名
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  メール
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  ロール
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  ステータス
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => {
                const isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN';
                return editUserId === user.userId ? (
                  <tr key={user.userId} className="bg-blue-50">
                    <td className="px-4 py-3" colSpan={5}>
                      <form
                        onSubmit={(e) => handleEditSubmit(e, user)}
                        className="space-y-3"
                        aria-label={`${user.displayName}の編集フォーム`}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label
                              htmlFor={`edit-name-${user.userId}`}
                              className="block text-sm font-medium text-gray-700"
                            >
                              表示名
                            </label>
                            <input
                              id={`edit-name-${user.userId}`}
                              type="text"
                              required
                              maxLength={100}
                              value={editForm.displayName}
                              onChange={(e) =>
                                setEditForm({ ...editForm, displayName: e.target.value })
                              }
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`edit-email-${user.userId}`}
                              className="block text-sm font-medium text-gray-700"
                            >
                              メールアドレス
                            </label>
                            <input
                              id={`edit-email-${user.userId}`}
                              type="email"
                              required
                              value={editForm.email}
                              onChange={(e) =>
                                setEditForm({ ...editForm, email: e.target.value })
                              }
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`edit-role-${user.userId}`}
                              className="block text-sm font-medium text-gray-700"
                            >
                              ロール
                            </label>
                            <select
                              id={`edit-role-${user.userId}`}
                              value={editForm.role}
                              disabled={isSelfAdmin}
                              onChange={(e) =>
                                setEditForm({ ...editForm, role: e.target.value as UserRole })
                              }
                              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="REVIEWER">レビュアー</option>
                              <option value="TEAM_LEADER">チームリーダー</option>
                              <option value="ADMIN">管理者</option>
                            </select>
                          </div>
                        </div>
                        {editError && (
                          <p className="text-sm text-red-600" role="alert">
                            {editError}
                          </p>
                        )}
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
                          >
                            キャンセル
                          </button>
                          <button
                            type="submit"
                            disabled={isEditing}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {isEditing ? '保存中...' : '保存'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={user.userId}>
                    <td className="px-4 py-3 text-sm text-gray-900">{user.displayName}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{user.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${ROLE_BADGE_COLORS[user.role]}`}
                      >
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                          user.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {user.isActive ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onEditUser && (
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="text-sm text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                            aria-label={`${user.displayName}を編集`}
                          >
                            編集
                          </button>
                        )}
                        {user.isActive ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDisableUserId(user.userId)}
                            className="text-sm text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
                            aria-label={`${user.displayName}を無効化`}
                          >
                            無効化
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmEnableUserId(user.userId)}
                            className="text-sm text-green-600 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 rounded px-2 py-1"
                            aria-label={`${user.displayName}を有効化`}
                          >
                            有効化
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Disable confirmation dialog */}
      {confirmDisableUserId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disable-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 id="disable-dialog-title" className="text-lg font-semibold text-gray-900">
              ユーザー無効化の確認
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              このユーザーを無効化しますか？無効化するとログインできなくなります。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDisableUserId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleDisableConfirm(confirmDisableUserId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                無効化する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enable confirmation dialog */}
      {confirmEnableUserId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="enable-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 id="enable-dialog-title" className="text-lg font-semibold text-gray-900">
              ユーザー有効化の確認
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              このユーザーを有効化しますか？有効化すると再びログインできるようになります。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEnableUserId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleEnableConfirm(confirmEnableUserId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                有効化する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
