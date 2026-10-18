import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AppError } from '../types/api';

export interface ProfilePageProps {
  /** 現在の表示名 */
  displayName: string;
  /** 現在のメールアドレス */
  email: string;
  /**
   * プロファイルを保存する。変更されたフィールドのみ渡される。
   * 成功時は null、失敗時は AppError を返す。
   */
  onSave: (data: { displayName?: string; email?: string }) => Promise<AppError | null>;
}

/**
 * ProfilePage - ログイン中ユーザーが自身の表示名・メールアドレスを編集する画面
 *
 * - 変更があったフィールドのみをバックエンド（PATCH /me）へ送信する
 * - 保存成功・失敗をユーザーに通知する
 */
export function ProfilePage({ displayName, email, onSave }: ProfilePageProps) {
  const [nameInput, setNameInput] = useState(displayName);
  const [emailInput, setEmailInput] = useState(email);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedName = nameInput.trim();
  const trimmedEmail = emailInput.trim();
  const isDirty = trimmedName !== displayName || trimmedEmail !== email;
  const isValid = trimmedName.length > 0 && trimmedEmail.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    if (!isValid || !isDirty) {
      return;
    }

    const payload: { displayName?: string; email?: string } = {};
    if (trimmedName !== displayName) payload.displayName = trimmedName;
    if (trimmedEmail !== email) payload.email = trimmedEmail;

    setIsSaving(true);
    const error = await onSave(payload);
    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
    } else {
      setSuccessMessage('プロファイルを更新しました。');
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-8" aria-label="プロファイル編集">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">プロファイル編集</h1>

      {successMessage && (
        <div
          className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800"
          role="status"
        >
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div
          className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="profile-display-name" className="block text-sm font-medium text-gray-700 mb-1">
            表示名
          </label>
          <input
            id="profile-display-name"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={100}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700 mb-1">
            メールアドレス
          </label>
          <input
            id="profile-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            メールアドレスを変更すると、次回以降のログインに使用するアドレスが変わります。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!isDirty || !isValid || isSaving}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </main>
  );
}
