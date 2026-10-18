import { useState } from 'react';
import type { IPAllowlistEntry } from '../types/audit';

export interface IPAllowlistSettingsProps {
  entries: IPAllowlistEntry[];
  isLoading?: boolean;
  maxEntries?: number;
  onAddEntry?: (data: { cidr: string; description: string }) => void;
  onDeleteEntry?: (entryId: string) => void;
}

const CIDR_V4_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const CIDR_V6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\/\d{1,3}$/;

function validateCIDR(value: string): string | null {
  if (!value.trim()) {
    return 'CIDRブロックを入力してください';
  }

  const trimmed = value.trim();

  if (CIDR_V4_REGEX.test(trimmed)) {
    const [ip, prefix] = trimmed.split('/');
    const octets = ip.split('.').map(Number);
    const prefixNum = Number(prefix);

    if (octets.some((o) => o < 0 || o > 255)) {
      return '無効なIPv4アドレスです。各オクテットは0〜255の範囲で指定してください。';
    }
    if (prefixNum < 0 || prefixNum > 32) {
      return '無効なプレフィックス長です。IPv4の場合は0〜32の範囲で指定してください。';
    }
    return null;
  }

  if (CIDR_V6_REGEX.test(trimmed)) {
    const [, prefix] = trimmed.split('/');
    const prefixNum = Number(prefix);
    if (prefixNum < 0 || prefixNum > 128) {
      return '無効なプレフィックス長です。IPv6の場合は0〜128の範囲で指定してください。';
    }
    return null;
  }

  return '無効なCIDR形式です。例: 192.168.1.0/24 または 2001:db8::/32';
}

/**
 * IPAllowlistSettings - IPアドレス許可リスト管理コンポーネント
 *
 * Requirements: 14.3, 14.15
 */
export function IPAllowlistSettings({
  entries,
  isLoading = false,
  maxEntries = 1000,
  onAddEntry,
  onDeleteEntry,
}: IPAllowlistSettingsProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [cidr, setCidr] = useState('');
  const [description, setDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateCIDR(cidr);
    if (error) {
      setValidationError(error);
      return;
    }

    if (entries.length >= maxEntries) {
      setValidationError(`エントリ数が上限（${maxEntries}件）に達しています。`);
      return;
    }

    onAddEntry?.({ cidr: cidr.trim(), description: description.trim() });
    setCidr('');
    setDescription('');
    setValidationError(null);
    setShowAddForm(false);
  };

  const handleCidrChange = (value: string) => {
    setCidr(value);
    if (validationError) {
      setValidationError(null);
    }
  };

  const handleDeleteConfirm = (entryId: string) => {
    onDeleteEntry?.(entryId);
    setConfirmDeleteId(null);
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
    <div className="space-y-4" aria-label="IPアドレス許可リスト管理">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">IPアドレス許可リスト</h2>
          <p className="text-sm text-gray-500 mt-1">
            登録数: {entries.length} / {maxEntries}件
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          disabled={entries.length >= maxEntries}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-expanded={showAddForm}
          aria-controls="add-ip-form"
        >
          {showAddForm ? 'キャンセル' : 'エントリ追加'}
        </button>
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <form
          id="add-ip-form"
          onSubmit={handleSubmit}
          className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3"
          aria-label="IPエントリ追加フォーム"
          noValidate
        >
          <div>
            <label htmlFor="ip-cidr" className="block text-sm font-medium text-gray-700">
              CIDRブロック
            </label>
            <input
              id="ip-cidr"
              type="text"
              required
              value={cidr}
              onChange={(e) => handleCidrChange(e.target.value)}
              className={`mt-1 block w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                validationError
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300'
              }`}
              placeholder="192.168.1.0/24"
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'cidr-error' : undefined}
            />
            {validationError && (
              <p
                id="cidr-error"
                className="mt-1 text-sm text-red-600"
                role="alert"
              >
                {validationError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="ip-description" className="block text-sm font-medium text-gray-700">
              説明（任意）
            </label>
            <input
              id="ip-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="オフィスネットワーク"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            追加
          </button>
        </form>
      )}

      {/* Entry list */}
      {entries.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          IPアドレス許可リストが空です。すべてのIPアドレスからのアクセスが許可されています。
        </p>
      ) : (
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200" aria-label="IPアドレス許可リストテーブル">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  CIDRブロック
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  説明
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  追加日時
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {entries.map((entry) => (
                <tr key={entry.entryId}>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">
                    {entry.cidr}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {entry.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(entry.createdAt).toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(entry.entryId)}
                      className="text-sm text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
                      aria-label={`${entry.cidr}を削除`}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-ip-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 id="delete-ip-dialog-title" className="text-lg font-semibold text-gray-900">
              エントリ削除の確認
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              このIPアドレスエントリを削除しますか？削除すると、このCIDRブロックからのアクセスが拒否される可能性があります。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(confirmDeleteId)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
