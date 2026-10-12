import { useId, useRef, useState } from 'react';
import type { AppError } from '../types/api';
import {
  validateSessionName,
  describeRenameError,
  SESSION_NAME_RULE_TEXT,
} from '../utils/session-name';

export interface SessionNameEditorProps {
  /** 現在のセッション名 */
  name: string;
  /** 保存コールバック。成功時は null、失敗時は AppError を返す。 */
  onSave: (name: string) => Promise<AppError | null>;
  /**
   * トランスクリプションから名前候補を取得するコールバック。
   * 指定された場合のみ「トランスクリプションから名前を提案」ボタンを表示する。
   */
  onRequestSuggestion?: () => Promise<{
    suggestion: string | null;
    hasExternalApiError: boolean;
  } | null>;
  className?: string;
}

/**
 * SessionNameEditor - セッション名のインライン編集コンポーネント
 *
 * - 表示モード: 名前テキスト + 編集ボタン
 * - 編集モード: 入力欄 + 保存/キャンセル + バリデーションルールのツールチップ(ⓘ)
 *   + （onRequestSuggestion 指定時）トランスクリプションからの名前提案ボタン
 * - ⓘ はホバーとキーボードフォーカスの両方でルール文を表示し、
 *   aria-describedby でスクリーンリーダーから参照できる。
 *
 * UI テキストは全て日本語。API エラー（英語）は describeRenameError で日本語に変換する。
 */
export function SessionNameEditor({
  name,
  onSave,
  onRequestSuggestion,
  className,
}: SessionNameEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const ruleTextId = useId();

  const startEditing = () => {
    setDraft(name);
    setErrorMessage(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(name);
    setErrorMessage(null);
    setTooltipVisible(false);
    setIsEditing(false);
  };

  const handleSave = async () => {
    const validation = validateSessionName(draft);
    if (!validation.ok) {
      setErrorMessage(validation.message);
      return;
    }
    setErrorMessage(null);
    setIsSaving(true);
    try {
      const error = await onSave(validation.value);
      if (error) {
        setErrorMessage(describeRenameError(error));
        return;
      }
      setTooltipVisible(false);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestSuggestion = async () => {
    if (!onRequestSuggestion) return;
    setErrorMessage(null);
    setIsSuggesting(true);
    try {
      const result = await onRequestSuggestion();
      if (!result || result.suggestion === null || result.hasExternalApiError) {
        setErrorMessage('提案を取得できませんでした。');
        return;
      }
      setDraft(result.suggestion);
      inputRef.current?.focus();
    } catch {
      setErrorMessage('提案を取得できませんでした。');
    } finally {
      setIsSuggesting(false);
    }
  };

  if (!isEditing) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className="font-medium text-gray-900">{name}</span>
        <button
          type="button"
          onClick={startEditing}
          aria-label="セッション名を編集"
          className="inline-flex items-center p-1 text-gray-500 rounded hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="セッション名"
          aria-invalid={errorMessage !== null}
          disabled={isSaving}
          className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />

        {/* バリデーションルールのツールチップ (ⓘ) */}
        <span className="relative inline-flex">
          <button
            type="button"
            aria-label="バリデーションルール"
            aria-describedby={ruleTextId}
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            onFocus={() => setTooltipVisible(true)}
            onBlur={() => setTooltipVisible(false)}
            className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-700 bg-blue-50 rounded-full hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span aria-hidden="true">ⓘ</span>
          </button>
          <span
            id={ruleTextId}
            role="tooltip"
            className={`absolute left-0 top-full z-10 mt-1 w-64 px-3 py-2 text-xs text-white bg-gray-800 rounded-md shadow-lg ${
              tooltipVisible ? 'block' : 'hidden'
            }`}
          >
            {SESSION_NAME_RULE_TEXT}
          </span>
        </span>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          onClick={cancelEditing}
          disabled={isSaving}
          className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>

      {onRequestSuggestion && (
        <div>
          <button
            type="button"
            onClick={handleRequestSuggestion}
            disabled={isSuggesting || isSaving}
            className="inline-flex items-center px-3 py-1 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {isSuggesting ? '提案を取得中...' : 'トランスクリプションから名前を提案'}
          </button>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
