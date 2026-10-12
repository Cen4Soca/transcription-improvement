import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';

/**
 * SearchBarHandle - 親から検索入力にフォーカスするための ref ハンドル
 * Requirement 11.1 (Ctrl+F で検索バーにフォーカス)
 */
export interface SearchBarHandle {
  focus: () => void;
}

/**
 * SearchBarProps - 検索バーコンポーネントのプロパティ
 */
export interface SearchBarProps {
  /** 検索キーワード変更時のコールバック */
  onSearch: (keyword: string) => void;
  /** 「次へ」ボタン押下時のコールバック */
  onNext: () => void;
  /** 「前へ」ボタン押下時のコールバック */
  onPrevious: () => void;
  /** 検索クリア時のコールバック (Requirement 6.5) */
  onClear: () => void;
  /** 未修正フィルタ切り替え時のコールバック */
  onToggleUncorrectedOnly: (enabled: boolean) => void;
  /** 一致件数 */
  matchCount: number;
  /** 現在のインデックス（-1は未選択） */
  currentIndex: number;
}

/**
 * SearchBar - キーワード検索・ナビゲーション・未修正フィルタコンポーネント
 *
 * Requirements:
 * - 6.1: キーワード検索機能
 * - 6.2: 一致件数表示
 * - 6.3: 次へ・前へナビゲーション
 * - 6.4: 未修正フィルタ
 * - 6.5: 検索クリア時のハイライト解除
 */
export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar({
  onSearch,
  onNext,
  onPrevious,
  onClear,
  onToggleUncorrectedOnly,
  matchCount,
  currentIndex,
}: SearchBarProps, ref) {
  const [keyword, setKeyword] = useState('');
  const [uncorrectedOnly, setUncorrectedOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setKeyword(value);
      onSearch(value);
    },
    [onSearch]
  );

  const handleClear = useCallback(() => {
    setKeyword('');
    onClear();
    inputRef.current?.focus();
  }, [onClear]);

  const handleToggleUncorrected = useCallback(() => {
    const newValue = !uncorrectedOnly;
    setUncorrectedOnly(newValue);
    onToggleUncorrectedOnly(newValue);
  }, [uncorrectedOnly, onToggleUncorrectedOnly]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
    },
    [onNext, onPrevious, handleClear]
  );

  const matchLabel =
    keyword.length > 0
      ? `${matchCount}件一致`
      : '';

  const positionLabel =
    keyword.length > 0 && matchCount > 0 && currentIndex >= 0
      ? `${currentIndex + 1}/${matchCount}`
      : '';

  const hasMatches = matchCount > 0;
  const hasKeyword = keyword.length > 0;

  return (
    <div
      className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg shadow-sm"
      role="search"
      aria-label="テキスト検索"
    >
      {/* 検索入力 */}
      <div className="relative flex-1 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={keyword}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="検索キーワード..."
          aria-label="検索キーワード"
          className="w-full text-sm text-gray-900 border border-gray-300 rounded px-3 py-1.5 pr-16 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-colors"
        />
        {/* 一致件数・位置表示 */}
        {hasKeyword && (
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none"
            aria-live="polite"
            aria-atomic="true"
          >
            {positionLabel || matchLabel}
          </span>
        )}
      </div>

      {/* ナビゲーションボタン */}
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasMatches}
        aria-label="前へ"
        title="前へ (Shift+Enter)"
        className="p-1.5 text-gray-600 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasMatches}
        aria-label="次へ"
        title="次へ (Enter)"
        className="p-1.5 text-gray-600 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* クリアボタン (Requirement 6.5) */}
      <button
        type="button"
        onClick={handleClear}
        disabled={!hasKeyword}
        aria-label="検索クリア"
        title="検索クリア (Escape)"
        className="p-1.5 text-gray-600 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
          />
        </svg>
      </button>

      {/* 区切り線 */}
      <div className="w-px h-6 bg-gray-200" aria-hidden="true" />

      {/* 未修正フィルタ (Requirement 6.4) */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={uncorrectedOnly}
          onChange={handleToggleUncorrected}
          aria-label="未修正のみ表示"
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-600 whitespace-nowrap">
          未修正のみ
        </span>
      </label>
    </div>
  );
});
