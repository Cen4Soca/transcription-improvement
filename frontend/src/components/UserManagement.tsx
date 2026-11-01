import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, UserRole } from '../types/user';
import type { AppError } from '../types/api';
import { translateError } from '../utils/translateError';

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
  const { t } = useTranslation('admin');
  const roleLabel = (role: UserRole) => t(`user.role.${role}`);
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
      setEditError(t('user.validation.required'));
      return;
    }

    // Self-demotion guard: a logged-in ADMIN cannot change their own role away from ADMIN.
    const isSelfAdmin = currentUserId === user.userId && user.role === 'ADMIN';
    if (isSelfAdmin && editForm.role !== 'ADMIN') {
      setEditError(t('user.validation.selfAdmin'));
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
      setEditError(translateError(error));
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
        aria-label={t('user.loadingAriaLabel')}
      >
        <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label={t('user.managementAriaLabel')}>
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('user.heading')}</h2>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-expanded={showCreateForm}
          aria-controls="create-user-form"
        >
          {showCreateForm ? t('common:cancel') : t('user.addUser')}
        </button>
      </div>

      {/* Create user form */}
      {showCreateForm && (
        <form
          id="create-user-form"
          onSubmit={handleSubmit}
          className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3"
          aria-label={t('user.createFormAriaLabel')}
        >
          <div>
            <label htmlFor="user-email" className="block text-sm font-medium text-gray-700">
              {t('user.email')}
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
              {t('user.displayName')}
            </label>
            <input
              id="user-display-name"
              type="text"
              required
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={t('user.displayNamePlaceholder')}
            />
          </div>
          <div>
            <label htmlFor="user-role" className="block text-sm font-medium text-gray-700">
              {t('user.roleLabel')}
            </label>
            <select
              id="user-role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="REVIEWER">{t('user.role.REVIEWER')}</option>
              <option value="TEAM_LEADER">{t('user.role.TEAM_LEADER')}</option>
              <option value="ADMIN">{t('user.role.ADMIN')}</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {t('user.register')}
          </button>
        </form>
      )}

      {/* User list */}
      {users.length === 0 ? (
        <p className="text-center text-gray-500 py-8">{t('user.emptyState')}</p>
      ) : (
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200" aria-label={t('user.tableAriaLabel')}>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('user.column.displayName')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('user.column.email')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('user.column.role')}
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('user.column.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('user.column.actions')}
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
                        aria-label={t('user.editFormAriaLabel', { name: user.displayName })}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label
                              htmlFor={`edit-name-${user.userId}`}
                              className="block text-sm font-medium text-gray-700"
                            >
                              {t('user.displayName')}
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
                              {t('user.email')}
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
                              {t('user.roleLabel')}
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
                              <option value="REVIEWER">{t('user.role.REVIEWER')}</option>
                              <option value="TEAM_LEADER">{t('user.role.TEAM_LEADER')}</option>
                              <option value="ADMIN">{t('user.role.ADMIN')}</option>
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
                            {t('common:cancel')}
                          </button>
                          <button
                            type="submit"
                            disabled={isEditing}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {isEditing ? t('common:saving') : t('common:save')}
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
                        {roleLabel(user.role)}
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
                        {user.isActive ? t('user.status.active') : t('user.status.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onEditUser && (
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="text-sm text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
                            aria-label={t('user.editAriaLabel', { name: user.displayName })}
                          >
                            {t('user.edit')}
                          </button>
                        )}
                        {user.isActive ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDisableUserId(user.userId)}
                            className="text-sm text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
                            aria-label={t('user.disableAriaLabel', { name: user.displayName })}
                          >
                            {t('user.disable')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmEnableUserId(user.userId)}
                            className="text-sm text-green-600 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 rounded px-2 py-1"
                            aria-label={t('user.enableAriaLabel', { name: user.displayName })}
                          >
                            {t('user.enable')}
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
              {t('user.disableDialogTitle')}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {t('user.disableDialogDescription')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDisableUserId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleDisableConfirm(confirmDisableUserId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {t('user.disableConfirm')}
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
              {t('user.enableDialogTitle')}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {t('user.enableDialogDescription')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEnableUserId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleEnableConfirm(confirmEnableUserId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {t('user.enableConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
