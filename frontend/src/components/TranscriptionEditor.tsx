import { Fragment } from 'react';
import type { Segment } from '../types/segment';
import { sortSegmentsByTimestamp } from '../utils/segments';
import { getUniqueSpeakerLabels } from '../utils/speaker-labels';
import { SegmentEditor } from './SegmentEditor';
import { SuggestionPopup } from './SuggestionPopup';
import type { SuggestionCandidate } from '../hooks/useSuggestionPopup';

export interface TranscriptionEditorProps {
  segments: Segment[];
  error?: { message: string } | null;
  isLoading?: boolean;
  highlightedSegmentId?: string | null;
  searchQuery?: string;
  /**
   * 修正済みセグメントの表示専用データ（segmentId -> 修正前/修正後）。
   * 該当する segmentId を持つ SegmentEditor に渡し、修正前/修正後の並列表示に使う（Req 1, 2）。
   */
  displayCorrections?: Map<string, { originalText: string; correctedText: string }>;
  /**
   * 修正済み（確定操作済み）の segmentId 集合。
   * テキストが変化していなくても確定された Segment を「修正済」として表示するために使う。
   */
  correctedSegmentIds?: Set<string>;
  /** 編集中Segmentごとの編集テキスト（useInlineEdit の editingEntries 由来） */
  editTexts?: Map<string, string>;
  /** 編集開始（Segmentクリック / キーボード） */
  onStartEdit?: (segmentId: string, originalText: string) => void;
  /** 編集テキスト更新 */
  onUpdateText?: (segmentId: string, text: string) => void;
  /** 編集確定 */
  onConfirmEdit?: (segmentId: string, newText: string) => void;
  /** 編集キャンセル */
  onCancelEdit?: (segmentId: string) => void;
  /** Segmentクリック（メディアシーク用） */
  onSegmentClick?: (segmentId: string) => void;
  /** 修正候補ボタンクリック */
  onSuggestionRequest?: (segmentId: string, originalText: string) => void;
  /** 修正済みセグメントを修正前テキストに戻す（要件A） */
  onRevert?: (segmentId: string) => void;
  /** 話者ラベル変更確定 */
  onSpeakerChange?: (segmentId: string, beforeSpeaker: string, afterSpeaker: string) => void;
  /** Segmentホバー開始（候補自動表示） */
  onSegmentHoverStart?: (segmentId: string, originalText: string) => void;
  /** Segmentホバー終了 */
  onSegmentHoverEnd?: () => void;
  /** 修正候補ポップアップの表示状態（対象セグメント直下に表示, Req 8.x） */
  suggestion?: {
    isVisible: boolean;
    segmentId: string | null;
    suggestions: SuggestionCandidate[];
    isLoading: boolean;
    hasError: boolean;
    onSelect: (text: string) => void;
    onClose: () => void;
    onEditMode: () => void;
  };
}

/**
 * TranscriptionEditor - Segment一覧の表示・編集コンポーネント
 *
 * スクロール可能な形式でSegmentを表示し、空状態・エラー状態・ローディング状態を処理する。
 * 各SegmentはSegmentEditorとしてインライン編集可能で、話者ラベル編集・修正候補ボタンを統合する。
 *
 * Requirements: 1.4, 1.5, 1.6, 2.1, 2.2, 2.8, 2.9, 8.1, 8.2
 */
export function TranscriptionEditor({
  segments,
  error,
  isLoading = false,
  highlightedSegmentId,
  searchQuery,
  displayCorrections,
  correctedSegmentIds,
  editTexts,
  onStartEdit,
  onUpdateText,
  onConfirmEdit,
  onCancelEdit,
  onSegmentClick,
  onSuggestionRequest,
  onRevert,
  onSpeakerChange,
  onSegmentHoverStart,
  onSegmentHoverEnd,
  suggestion,
}: TranscriptionEditorProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="読み込み中"
        className="flex items-center justify-center h-full p-8"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"
            aria-hidden="true"
          />
          <span className="text-sm text-gray-600">読み込み中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        aria-label="エラー"
        className="flex items-center justify-center h-full p-8"
      >
        <div className="text-center max-w-md">
          <p className="text-red-600 font-medium mb-1">
            データの取得に失敗しました
          </p>
          <p className="text-sm text-red-500">{error.message}</p>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div
        role="status"
        aria-label="空の文字起こし"
        className="flex items-center justify-center h-full p-8"
      >
        <p className="text-gray-500">文字起こし結果がありません</p>
      </div>
    );
  }

  const sortedSegments = sortSegmentsByTimestamp(segments);
  // Requirement 2.8: 話者ラベル編集用の既存ラベル一覧
  const availableSpeakerLabels = getUniqueSpeakerLabels(segments);

  return (
    <div
      role="list"
      aria-label="文字起こしセグメント一覧"
      data-scroll-container
      className="overflow-y-auto h-full"
    >
      {sortedSegments.map((segment) => {
        const isEditing = editTexts?.has(segment.segmentId) ?? false;
        const displayCorrection = displayCorrections?.get(segment.segmentId);
        const isCorrected = correctedSegmentIds?.has(segment.segmentId) ?? false;
        const showSuggestion =
          suggestion?.isVisible === true &&
          suggestion.segmentId === segment.segmentId;
        return (
          <Fragment key={segment.segmentId}>
            <SegmentEditor
              segment={segment}
              isHighlighted={highlightedSegmentId === segment.segmentId}
              isEditing={isEditing}
              editText={editTexts?.get(segment.segmentId)}
              searchQuery={searchQuery}
              displayCorrection={displayCorrection}
              isCorrected={isCorrected}
              availableSpeakerLabels={availableSpeakerLabels}
              onStartEdit={onStartEdit}
              onUpdateText={onUpdateText}
              onConfirm={onConfirmEdit}
              onCancel={onCancelEdit}
              onClick={onSegmentClick}
              onSuggestionRequest={onSuggestionRequest}
              onRevert={onRevert}
              onSpeakerChange={onSpeakerChange}
              onHoverStart={onSegmentHoverStart}
              onHoverEnd={onSegmentHoverEnd}
            />
            {/* 修正候補は対象セグメントの直下に表示する (Req 8.x) */}
            {showSuggestion && suggestion && (
              <SuggestionPopup
                segmentId={segment.segmentId}
                suggestions={suggestion.suggestions}
                isLoading={suggestion.isLoading}
                hasError={suggestion.hasError}
                onSelect={suggestion.onSelect}
                onClose={suggestion.onClose}
                onEditMode={suggestion.onEditMode}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
