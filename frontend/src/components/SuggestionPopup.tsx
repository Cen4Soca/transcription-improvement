import { useEffect, useRef } from 'react';

export interface SuggestionPopupProps {
  segmentId: string;
  suggestions: Array<{ text: string; source: string }>;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (text: string) => void;
  onClose: () => void;
  onEditMode: () => void;
}

/**
 * SuggestionPopup - 修正候補の表示コンポーネント
 * 500ms ホバーまたはボタンクリックで起動し、最大5件の候補を表示する。
 * 対象セグメントの直下にインラインブロックとして差し込まれる。
 * Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 6.6
 */
export function SuggestionPopup({
  segmentId,
  suggestions,
  isLoading,
  hasError,
  onSelect,
  onClose,
  onEditMode,
}: SuggestionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Close on outside click (Req 8.8)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Limit to max 5 candidates (Req 8.1, 8.2)
  const displayedSuggestions = suggestions.slice(0, 5);

  const showNoCandidates = !isLoading && !hasError && displayedSuggestions.length === 0;

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="修正候補"
      aria-busy={isLoading}
      data-segment-id={segmentId}
      className="border-b border-gray-200 border-l-4 border-l-blue-300 bg-blue-50/40"
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">修正候補</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Loading indicator (Req 8.5) */}
        {isLoading && (
          <div
            role="status"
            aria-label="読み込み中"
            className="flex items-center justify-center py-4"
          >
            <svg
              className="animate-spin h-5 w-5 text-blue-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="ml-2 text-sm text-gray-500">候補を取得中...</span>
          </div>
        )}

        {/* Error message (Req 8.7) */}
        {hasError && !isLoading && (
          <div
            role="alert"
            className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700"
          >
            外部APIからの候補取得に失敗しました。履歴からの候補のみ表示しています。
          </div>
        )}

        {/* Suggestion candidates list (Req 8.4) */}
        {!isLoading && displayedSuggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="候補一覧"
            className="space-y-1"
          >
            {displayedSuggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.text}-${index}`}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => onSelect(suggestion.text)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(suggestion.text);
                  }
                }}
                className="flex items-start justify-between gap-2 px-3 py-2 rounded cursor-pointer hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <span className="flex-1 min-w-0 text-sm text-gray-800 whitespace-normal break-words">
                  {suggestion.text}
                </span>
                <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">
                  {suggestion.source}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* No candidates message (Req 8.6) */}
        {showNoCandidates && (
          <div className="py-3 text-center">
            <p className="text-sm text-gray-500 mb-2">候補がありません</p>
            <button
              type="button"
              onClick={onEditMode}
              className="text-sm text-blue-600 hover:text-blue-800 underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded"
            >
              直接編集する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface SuggestionButtonProps {
  segmentId: string;
  onClick: (segmentId: string) => void;
}

/**
 * SuggestionButton - 修正候補表示用の専用ボタン
 * ホバー自動表示が無効の場合、このボタンのみで候補を表示する (Req 8.2, 8.10)
 */
export function SuggestionButton({ segmentId, onClick }: SuggestionButtonProps) {
  return (
    <button
      type="button"
      aria-label="修正候補を表示"
      onClick={(e) => {
        e.stopPropagation();
        onClick(segmentId);
      }}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    </button>
  );
}
