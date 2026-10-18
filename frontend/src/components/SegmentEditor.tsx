import { useCallback, useRef, useState } from 'react';
import type { Segment } from '../types/segment';
import { formatTimestamp } from '../utils/segments';
import { highlightText } from '../utils/highlight-text';
import { SpeakerLabelEditor } from './SpeakerLabelEditor';
import { SuggestionButton } from './SuggestionPopup';

export interface SegmentEditorProps {
  segment: Segment;
  isHighlighted?: boolean;
  isEditing?: boolean;
  editText?: string;
  searchQuery?: string;
  /**
   * 修正済みセグメントの表示専用データ（修正前/修正後を並べて表示するため）。
   * undefined の場合は未修正として扱い、修正後行を表示しない。
   */
  displayCorrection?: { originalText: string; correctedText: string };
  /**
   * テキスト変化を伴わない確定も含め、この Segment が「修正済」状態かどうか。
   * displayCorrection が無い（テキスト未変化）場合でも true なら「修正済」ラベルを表示する。
   */
  isCorrected?: boolean;
  /** セッション内の既存話者ラベル一覧（話者編集ドロップダウン用, Req 2.8） */
  availableSpeakerLabels?: string[];
  onStartEdit?: (segmentId: string, originalText: string) => void;
  onUpdateText?: (segmentId: string, text: string) => void;
  onConfirm?: (segmentId: string, newText: string) => void;
  onCancel?: (segmentId: string) => void;
  onClick?: (segmentId: string) => void;
  /** 修正候補ボタンクリック（Req 8.2） */
  onSuggestionRequest?: (segmentId: string, originalText: string) => void;
  /**
   * 修正済みセグメントを修正前テキストに戻す（要件A）。
   * 未指定の場合は「修正前に戻す」ボタンを表示しない。
   */
  onRevert?: (segmentId: string) => void;
  /** 話者ラベル変更確定（Req 2.10） */
  onSpeakerChange?: (segmentId: string, beforeSpeaker: string, afterSpeaker: string) => void;
  /** Segmentホバー開始（候補自動表示, Req 8.1） */
  onHoverStart?: (segmentId: string, originalText: string) => void;
  /** Segmentホバー終了 */
  onHoverEnd?: () => void;
}

/**
 * SegmentEditor - Segmentのインライン編集を統合したコンポーネント
 *
 * SegmentRowの表示機能とInlineEditorの編集機能を統合し、
 * クリックで編集モードに遷移、編集前テキストと編集中テキストの同時表示、
 * 確定・キャンセル操作、空文字列確認ダイアログを提供する。
 *
 * Requirements:
 * - 2.1: クリックで編集モード
 * - 2.2: 編集前テキストと編集中テキストの同時表示
 * - 2.3: 編集確定操作（Ctrl+Enter / 確定ボタン）
 * - 2.4: 編集キャンセル操作（Escape / キャンセルボタン）
 * - 2.5: 複数Segmentの同時編集（各SegmentEditorが独立して動作）
 * - 2.7: 空文字列確定時の確認ダイアログ
 * - 14.20: dangerouslySetInnerHTML不使用、Reactデフォルトエスケープで全テキスト表示
 */
export function SegmentEditor({
  segment,
  isHighlighted = false,
  isEditing = false,
  editText,
  searchQuery,
  displayCorrection,
  isCorrected = false,
  availableSpeakerLabels,
  onStartEdit,
  onUpdateText,
  onConfirm,
  onCancel,
  onClick,
  onSuggestionRequest,
  onRevert,
  onSpeakerChange,
  onHoverStart,
  onHoverEnd,
}: SegmentEditorProps) {
  const [showEmptyConfirmDialog, setShowEmptyConfirmDialog] = useState(false);
  const [isEditingSpeaker, setIsEditingSpeaker] = useState(false);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleClick = useCallback(() => {
    onClick?.(segment.segmentId);
    if (!isEditing) {
      onStartEdit?.(segment.segmentId, segment.originalText);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [segment.segmentId, segment.originalText, isEditing, onClick, onStartEdit]);

  // Requirement 2.10, 2.11: 話者ラベル変更の確定・キャンセル
  const handleSpeakerSelect = useCallback(
    (newSpeaker: string) => {
      setIsEditingSpeaker(false);
      const beforeSpeaker = segment.speakerLabel ?? '';
      if (newSpeaker !== beforeSpeaker) {
        onSpeakerChange?.(segment.segmentId, beforeSpeaker, newSpeaker);
      }
    },
    [segment.segmentId, segment.speakerLabel, onSpeakerChange]
  );

  const handleSpeakerCancel = useCallback(() => {
    setIsEditingSpeaker(false);
  }, []);

  const handleSuggestionClick = useCallback(() => {
    onSuggestionRequest?.(segment.segmentId, segment.originalText);
  }, [segment.segmentId, segment.originalText, onSuggestionRequest]);

  // 要件A: 修正済みセグメントを修正前テキストに戻す。
  // 行クリックの編集開始と競合しないよう stopPropagation する。
  const handleRevertClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRevert?.(segment.segmentId);
    },
    [segment.segmentId, onRevert]
  );

  // Requirement 8.1: 500ms ホバーで候補表示のためのホバーイベント
  const handleMouseEnter = useCallback(() => {
    if (!isEditing) {
      onHoverStart?.(segment.segmentId, segment.originalText);
    }
  }, [isEditing, segment.segmentId, segment.originalText, onHoverStart]);

  const handleMouseLeave = useCallback(() => {
    onHoverEnd?.();
  }, [onHoverEnd]);

  // 話者編集が可能か: 話者ラベルが存在し、変更ハンドラと候補一覧が渡されている（Req 2.8, 2.9）
  const speakerEditable =
    Boolean(segment.speakerLabel) &&
    Boolean(onSpeakerChange) &&
    Boolean(availableSpeakerLabels && availableSpeakerLabels.length > 0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleClick();
      }
    },
    [isEditing, handleClick]
  );

  const handleConfirm = useCallback(() => {
    const currentText = editText ?? '';
    if (currentText === '') {
      setShowEmptyConfirmDialog(true);
      return;
    }
    onConfirm?.(segment.segmentId, currentText);
  }, [editText, segment.segmentId, onConfirm]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME入力中はキーイベントを無視 (Requirement 11.5)
      if (isComposingRef.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.(segment.segmentId);
      }

      // Ctrl+Enter / Cmd+Enter で確定 (Requirement 2.3, 11.1)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [segment.segmentId, onCancel, handleConfirm]
  );

  const handleEmptyConfirm = useCallback(() => {
    setShowEmptyConfirmDialog(false);
    onConfirm?.(segment.segmentId, '');
  }, [segment.segmentId, onConfirm]);

  const handleEmptyCancel = useCallback(() => {
    setShowEmptyConfirmDialog(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    onCancel?.(segment.segmentId);
  }, [segment.segmentId, onCancel]);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  // 未修正セグメント（修正後テキストが無く、確定操作もされていない）を見分けるフラグ（Req 2: 色分け）。
  // テキスト変化が無くても確定済み（isCorrected）なら未修正扱いにしない。
  const isUncorrected = !displayCorrection && !isCorrected;

  return (
    <div
      role="listitem"
      data-segment-id={segment.segmentId}
      aria-label={`セグメント ${formatTimestamp(segment.startTime)}`}
      aria-current={isHighlighted || isEditing ? 'true' : undefined}
      tabIndex={isEditing ? undefined : 0}
      onClick={!isEditing ? handleClick : undefined}
      onKeyDown={!isEditing ? handleKeyDown : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-200 transition-colors ${
        isEditing
          ? 'ring-2 ring-blue-400 bg-blue-50'
          : isHighlighted
            ? 'bg-yellow-50 border-l-4 border-l-yellow-400'
            : isUncorrected
              ? 'cursor-pointer border-l-4 border-l-amber-300 bg-amber-50/40 hover:bg-amber-50'
              : 'cursor-pointer hover:bg-gray-50'
      }`}
    >
      {/* タイムスタンプ */}
      <span
        className="text-xs text-gray-500 font-mono whitespace-nowrap pt-0.5 min-w-[60px]"
        aria-label="開始時刻"
      >
        {formatTimestamp(segment.startTime)}
      </span>

      {/* 話者ラベル (Req 2.8, 2.9: 話者情報がある場合のみ表示。編集可能なら SpeakerLabelEditor) */}
      {segment.speakerLabel &&
        (speakerEditable && !isEditing ? (
          isEditingSpeaker ? (
            <div onClick={(e) => e.stopPropagation()}>
              <SpeakerLabelEditor
                currentLabel={segment.speakerLabel}
                availableLabels={availableSpeakerLabels ?? []}
                onSelect={handleSpeakerSelect}
                onCancel={handleSpeakerCancel}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingSpeaker(true);
              }}
              aria-label="話者ラベル"
              className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded whitespace-nowrap cursor-pointer hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors"
            >
              {segment.speakerLabel}
            </button>
          )
        ) : (
          <span
            className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded whitespace-nowrap"
            aria-label="話者ラベル"
          >
            {segment.speakerLabel}
          </span>
        ))}

      {/* テキスト表示 / 編集エリア */}
      {isEditing ? (
        <div className="flex-1 space-y-2" role="group" aria-label="インライン編集">
          {/* Requirement 2.2: 編集前テキストの表示（取り消し線付き） */}
          <div
            className="text-sm text-gray-400 line-through px-2 py-1"
            aria-label="編集前テキスト"
          >
            {segment.originalText}
          </div>

          {/* Requirement 2.2: 編集中テキストの表示 */}
          <textarea
            ref={textareaRef}
            value={editText ?? ''}
            onChange={(e) => onUpdateText?.(segment.segmentId, e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            aria-label="編集テキスト"
            className="w-full text-sm text-gray-900 border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y min-h-[2.5rem]"
            rows={2}
          />

          {/* Requirement 2.3, 2.4: 確定・キャンセルボタン */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              aria-label="編集を確定"
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
            >
              確定
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              aria-label="編集をキャンセル"
              className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
            >
              キャンセル
            </button>
            <span className="text-xs text-gray-400 self-center ml-2">
              Ctrl+Enter で確定 / Esc でキャンセル
            </span>
          </div>
        </div>
      ) : (
        <>
          {displayCorrection ? (
            // 修正済み: 修正前（取り消し線/グレー）と修正後（通常色）を並べて表示する（Req 1）
            <div className="flex-1 space-y-1">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-xs font-medium text-gray-500 whitespace-nowrap"
                  aria-hidden="true"
                >
                  修正前
                </span>
                <span
                  className="text-sm text-gray-400 line-through leading-relaxed"
                  aria-label="修正前のテキスト"
                >
                  {displayCorrection.originalText}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-xs font-medium text-green-700 whitespace-nowrap"
                  aria-hidden="true"
                >
                  修正後
                </span>
                <span
                  className="text-sm text-gray-900 leading-relaxed"
                  aria-label="修正後のテキスト"
                >
                  {highlightText(displayCorrection.correctedText, searchQuery ?? '')}
                </span>
              </div>
              {/* 要件A: 修正済みセグメントを修正前テキストに戻すアクション */}
              {onRevert && (
                <div className="flex">
                  <button
                    type="button"
                    onClick={handleRevertClick}
                    aria-label="修正前に戻す"
                    className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
                  >
                    修正前に戻す
                  </button>
                </div>
              )}
            </div>
          ) : (
            // 単一テキスト表示 + ステータスラベル（色だけに依存しない, Req 2）。
            // テキスト変化を伴わず確定された Segment は「修正済」、それ以外は「未修正」。
            <div className="flex-1 flex items-baseline gap-2">
              {isCorrected ? (
                <span
                  className="text-xs font-medium text-green-700 whitespace-nowrap"
                  aria-label="修正済"
                >
                  修正済
                </span>
              ) : (
                <span
                  className="text-xs font-medium text-amber-700 whitespace-nowrap"
                  aria-label="未修正"
                >
                  未修正
                </span>
              )}
              <span className="text-sm text-gray-900 leading-relaxed">
                {highlightText(segment.originalText, searchQuery ?? '')}
              </span>
            </div>
          )}
          {/* Req 8.2: 修正候補表示用の専用ボタン */}
          {onSuggestionRequest && (
            <SuggestionButton
              segmentId={segment.segmentId}
              onClick={handleSuggestionClick}
            />
          )}
        </>
      )}

      {/* Requirement 2.7: 空文字列確定時の確認ダイアログ */}
      {showEmptyConfirmDialog && (
        <div
          role="alertdialog"
          aria-labelledby={`empty-confirm-title-${segment.segmentId}`}
          aria-describedby={`empty-confirm-desc-${segment.segmentId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3
              id={`empty-confirm-title-${segment.segmentId}`}
              className="text-lg font-semibold text-gray-900 mb-2"
            >
              確認
            </h3>
            <p
              id={`empty-confirm-desc-${segment.segmentId}`}
              className="text-sm text-gray-600 mb-4"
            >
              空のテキストで確定しますか？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleEmptyCancel}
                aria-label="空文字列確定をキャンセル"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleEmptyConfirm}
                aria-label="空のテキストで確定"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
