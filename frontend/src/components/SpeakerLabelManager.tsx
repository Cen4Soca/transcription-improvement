import { useCallback, useState } from 'react';
import type { Segment } from '../types/segment';
import {
  countSegmentsWithLabel,
  mergeSpeakerLabels,
  renameSpeakerLabel,
} from '../utils/speaker-labels';

export interface SpeakerRenameResult {
  oldLabel: string;
  newLabel: string;
  affectedSegmentCount: number;
}

export interface SpeakerLabelManagerProps {
  /** All segments in the current session */
  segments: Segment[];
  /** Session speaker-label master list (union with segment-derived labels for display) */
  masterLabels?: string[];
  /** Called when a rename is confirmed with the updated segments and rename info */
  onRenameConfirm: (
    updatedSegments: Segment[],
    result: SpeakerRenameResult
  ) => void;
  /** Called when rename is cancelled */
  onCancel?: () => void;
  /**
   * Add a new speaker label. Resolves to null on success or a Japanese error
   * message on failure (e.g. duplicate rejected by the server).
   */
  onAddLabel?: (label: string) => Promise<string | null>;
  /**
   * Delete a speaker label. Resolves to null on success or a Japanese error
   * message on failure (e.g. the label is still in use).
   */
  onDeleteLabel?: (label: string) => Promise<string | null>;
  /** Whether to show the manager panel */
  isOpen: boolean;
  /** Called to close the panel */
  onClose: () => void;
}

/**
 * SpeakerLabelManager - Speaker label management panel (rename, bulk replace)
 *
 * Requirements:
 * - 2.13: Shows all unique speaker labels in the session, allows renaming
 * - 2.14: On rename confirmation, bulk replaces all segments with old label to new label
 * - 2.15: Records SPEAKER_RENAME Correction with affectedSegmentCount
 * - 2.16: Cancel reverts all labels
 * - 2.17: When new label name conflicts with existing label, show merge confirmation dialog
 */
export function SpeakerLabelManager({
  segments,
  masterLabels,
  onRenameConfirm,
  onCancel,
  onAddLabel,
  onDeleteLabel,
  isOpen,
  onClose,
}: SpeakerLabelManagerProps) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [newLabelName, setNewLabelName] = useState('');
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{
    oldLabel: string;
    newLabel: string;
  } | null>(null);
  // Add-label input and its validation / server error message (Japanese).
  const [addLabelName, setAddLabelName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  // Per-label delete error message (Japanese), keyed by label.
  const [deleteError, setDeleteError] = useState<{ label: string; message: string } | null>(null);

  const uniqueLabels = mergeSpeakerLabels(segments, masterLabels);

  const handleStartRename = useCallback((label: string) => {
    setEditingLabel(label);
    setNewLabelName(label);
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingLabel(null);
    setNewLabelName('');
    // Requirement 2.16: Cancel reverts all labels
    onCancel?.();
  }, [onCancel]);

  const executeRename = useCallback(
    (oldLabel: string, newLabel: string) => {
      const affectedCount = countSegmentsWithLabel(segments, oldLabel);
      const updatedSegments = renameSpeakerLabel(segments, oldLabel, newLabel);

      onRenameConfirm(updatedSegments, {
        oldLabel,
        newLabel,
        affectedSegmentCount: affectedCount,
      });

      setEditingLabel(null);
      setNewLabelName('');
      setShowMergeDialog(false);
      setMergeTarget(null);
    },
    [segments, onRenameConfirm]
  );

  const handleConfirmRename = useCallback(() => {
    if (!editingLabel || !newLabelName.trim()) return;

    const trimmedNewLabel = newLabelName.trim();

    // No change
    if (trimmedNewLabel === editingLabel) {
      setEditingLabel(null);
      setNewLabelName('');
      return;
    }

    // Requirement 2.17: Check for label name conflict
    if (
      uniqueLabels.includes(trimmedNewLabel) &&
      trimmedNewLabel !== editingLabel
    ) {
      setMergeTarget({ oldLabel: editingLabel, newLabel: trimmedNewLabel });
      setShowMergeDialog(true);
      return;
    }

    // Perform rename
    executeRename(editingLabel, trimmedNewLabel);
  }, [editingLabel, newLabelName, uniqueLabels, executeRename]);

  const handleMergeConfirm = useCallback(() => {
    if (mergeTarget) {
      executeRename(mergeTarget.oldLabel, mergeTarget.newLabel);
    }
  }, [mergeTarget, executeRename]);

  const handleMergeCancel = useCallback(() => {
    setShowMergeDialog(false);
    setMergeTarget(null);
    // Keep editing state so user can try a different name
  }, []);

  // --- Add a new speaker label ---
  const handleAddLabel = useCallback(async () => {
    if (!onAddLabel) return;
    const trimmed = addLabelName.trim();
    if (trimmed.length === 0) {
      setAddError('話者ラベルを入力してください。');
      return;
    }
    // Client-side duplicate check (server is the source of truth).
    if (uniqueLabels.includes(trimmed)) {
      setAddError('同じ名前の話者ラベルが既に存在します。');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    try {
      const errorMessage = await onAddLabel(trimmed);
      if (errorMessage) {
        setAddError(errorMessage);
        return;
      }
      setAddLabelName('');
    } finally {
      setIsAdding(false);
    }
  }, [onAddLabel, addLabelName, uniqueLabels]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAddLabel();
      }
    },
    [handleAddLabel]
  );

  // --- Delete an unused speaker label ---
  const handleDeleteLabel = useCallback(
    async (label: string) => {
      if (!onDeleteLabel) return;
      setDeleteError(null);
      const errorMessage = await onDeleteLabel(label);
      if (errorMessage) {
        setDeleteError({ label, message: errorMessage });
      }
    },
    [onDeleteLabel]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelRename();
      }
    },
    [handleConfirmRename, handleCancelRename]
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="話者ラベル管理"
      aria-modal="false"
      className="bg-white border border-gray-200 rounded-lg shadow-lg p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          話者ラベル管理
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="話者ラベル管理を閉じる"
          className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 rounded p-1 transition-colors"
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

      {uniqueLabels.length === 0 ? (
        <p className="text-sm text-gray-500">話者ラベルがありません</p>
      ) : (
        <ul
          role="list"
          aria-label="話者ラベル一覧"
          className="space-y-2"
        >
          {uniqueLabels.map((label) => (
            <li
              key={label}
              className="flex items-center gap-2 p-2 rounded border border-gray-100 hover:border-gray-200 transition-colors"
            >
              {editingLabel === label ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label={`${label} の新しいラベル名`}
                    autoFocus
                    className="flex-1 text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmRename}
                    aria-label="ラベル名変更を確定"
                    className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                  >
                    確定
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRename}
                    aria-label="ラベル名変更をキャンセル"
                    className="px-2 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    {label}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({countSegmentsWithLabel(segments, label)}件)
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleStartRename(label)}
                      aria-label={`${label} の名前変更`}
                      className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
                    >
                      名前変更
                    </button>
                    {onDeleteLabel &&
                      (countSegmentsWithLabel(segments, label) > 0 ? (
                        <button
                          type="button"
                          disabled
                          title="このラベルは使用中のため削除できません"
                          aria-label={`${label} を削除（使用中のため不可）`}
                          className="px-2 py-1 text-xs font-medium text-gray-400 cursor-not-allowed"
                        >
                          削除
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeleteLabel(label)}
                          aria-label={`${label} を削除`}
                          className="px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
                        >
                          削除
                        </button>
                      ))}
                  </div>
                </>
              )}
              {deleteError && deleteError.label === label && (
                <p role="alert" className="w-full text-xs text-red-600 mt-1">
                  {deleteError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add a new speaker label */}
      {onAddLabel && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={addLabelName}
              onChange={(e) => {
                setAddLabelName(e.target.value);
                if (addError) setAddError(null);
              }}
              onKeyDown={handleAddKeyDown}
              aria-label="追加する話者ラベル名"
              placeholder="話者ラベルを追加"
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={handleAddLabel}
              disabled={isAdding}
              aria-label="話者ラベルを追加"
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              追加
            </button>
          </div>
          {addError && (
            <p role="alert" className="text-xs text-red-600 mt-1">
              {addError}
            </p>
          )}
        </div>
      )}

      {/* Requirement 2.17: Merge confirmation dialog */}
      {showMergeDialog && mergeTarget && (
        <div
          role="alertdialog"
          aria-labelledby="merge-confirm-title"
          aria-describedby="merge-confirm-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3
              id="merge-confirm-title"
              className="text-lg font-semibold text-gray-900 mb-2"
            >
              ラベル統合の確認
            </h3>
            <p
              id="merge-confirm-desc"
              className="text-sm text-gray-600 mb-4"
            >
              「{mergeTarget.newLabel}」は既に存在します。「
              {mergeTarget.oldLabel}」を「{mergeTarget.newLabel}
              」に統合しますか？この操作により、「{mergeTarget.oldLabel}
              」のすべてのセグメント（
              {countSegmentsWithLabel(segments, mergeTarget.oldLabel)}
              件）が「{mergeTarget.newLabel}」に変更されます。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleMergeCancel}
                aria-label="統合をキャンセル"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleMergeConfirm}
                aria-label="統合する（話者ラベルを統合して確定）"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
              >
                統合する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
