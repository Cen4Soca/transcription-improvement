import { highlightText } from '../utils/highlight-text';
import type { Segment } from '../types/segment';
import { formatTimestamp } from '../utils/segments';

export interface SegmentRowProps {
  segment: Segment;
  isHighlighted?: boolean;
  isEditing?: boolean;
  searchQuery?: string;
  onEdit?: (segmentId: string) => void;
  onClick?: (segmentId: string) => void;
}

/**
 * SegmentRow - 単一Segmentの表示コンポーネント
 * テキスト・開始時刻・話者ラベルを表示し、クリックで編集モードに遷移する
 * 検索ハイライトはDOMテキストノード分割 + <mark>要素で実装（innerHTML不使用）
 * Requirements: 1.2, 1.3, 2.1, 14.20
 */
export function SegmentRow({
  segment,
  isHighlighted = false,
  isEditing = false,
  searchQuery,
  onEdit,
  onClick,
}: SegmentRowProps) {
  const handleClick = () => {
    onClick?.(segment.segmentId);
    onEdit?.(segment.segmentId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      role="listitem"
      data-segment-id={segment.segmentId}
      aria-label={`セグメント ${formatTimestamp(segment.startTime)}`}
      aria-current={isHighlighted || isEditing ? 'true' : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-gray-200 transition-colors ${
        isHighlighted
          ? 'bg-yellow-50 border-l-4 border-l-yellow-400'
          : 'hover:bg-gray-50'
      } ${isEditing ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}
    >
      <span
        className="text-xs text-gray-500 font-mono whitespace-nowrap pt-0.5 min-w-[60px]"
        aria-label="開始時刻"
      >
        {formatTimestamp(segment.startTime)}
      </span>

      {segment.speakerLabel && (
        <span
          className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded whitespace-nowrap"
          aria-label="話者ラベル"
        >
          {segment.speakerLabel}
        </span>
      )}

      <span className="flex-1 text-sm text-gray-900 leading-relaxed">
        {highlightText(segment.originalText, searchQuery ?? '')}
      </span>
    </div>
  );
}
