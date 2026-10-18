import { useState } from 'react';
import type { ConsensusSegment, ConsensusStatus } from '../types/consensus.js';

export interface ConsensusPageProps {
  sessionId?: string;
  segments: ConsensusSegment[];
  isLoading?: boolean;
  error?: { message: string } | null;
  resolveError?: string | null;
  onResolve?: (segmentId: string, selectedText: string) => Promise<void>;
}

const STATUS_LABELS: Record<ConsensusStatus, string> = {
  UNDECIDED: '未確定',
  CONFIRMED: '確定',
  CONFLICT: '競合解決待ち',
};

const STATUS_BADGE_CLASSES: Record<ConsensusStatus, string> = {
  UNDECIDED: 'bg-gray-100 text-gray-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  CONFLICT: 'bg-amber-100 text-amber-800',
};

/**
 * ConsensusPage - Consensus（合意形成）状態の閲覧・競合解決画面（ADMIN 専用）
 *
 * props 駆動のプレゼンテーション層（データ取得は行わない）。
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
export function ConsensusPage({
  sessionId,
  segments,
  isLoading = false,
  error,
  resolveError,
  onResolve,
}: ConsensusPageProps) {
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label="読み込み中"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">読み込み中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64" role="alert">
        <p className="text-red-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="main" aria-label="Consensus 状態">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">Consensus 状態</h1>
        {sessionId && (
          <p className="mt-1 text-sm text-gray-500">セッション: {sessionId}</p>
        )}
      </div>

      {/* Resolve error (surfaced from onResolve failures) */}
      {resolveError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200" role="alert">
          <p className="text-sm text-red-600">{resolveError}</p>
        </div>
      )}

      {/* Segment list */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {segments.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-gray-500">セグメントがありません</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="セグメント一覧">
            {segments.map((segment) => (
              <ConsensusSegmentRow
                key={segment.segmentId}
                segment={segment}
                onResolve={onResolve}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ConsensusSegmentRowProps {
  segment: ConsensusSegment;
  onResolve?: (segmentId: string, selectedText: string) => Promise<void>;
}

function ConsensusSegmentRow({ segment, onResolve }: ConsensusSegmentRowProps) {
  const answers = segment.reviewerAnswers ?? [];
  const [selectedText, setSelectedText] = useState<string | null>(
    answers.length > 0 ? answers[0].text : null
  );
  const [isResolving, setIsResolving] = useState(false);

  const handleResolve = async () => {
    if (!onResolve || selectedText === null) return;
    setIsResolving(true);
    try {
      await onResolve(segment.segmentId, selectedText);
    } finally {
      setIsResolving(false);
    }
  };

  const radioGroupName = `consensus-answer-${segment.segmentId}`;

  return (
    <li
      className="border border-gray-200 rounded-md bg-white p-4"
      aria-label={`セグメント ${segment.segmentId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-700 flex-1">{segment.originalText}</p>
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${STATUS_BADGE_CLASSES[segment.consensusStatus]}`}
        >
          {STATUS_LABELS[segment.consensusStatus]}
        </span>
      </div>

      {/* CONFIRMED: show the confirmed consensus text */}
      {segment.consensusStatus === 'CONFIRMED' && segment.consensusText && (
        <div className="mt-3 rounded-md bg-green-50 px-3 py-2">
          <p className="text-xs font-medium text-green-700">確定テキスト</p>
          <p className="mt-1 text-sm text-gray-900">{segment.consensusText}</p>
        </div>
      )}

      {/* CONFLICT: present reviewer answers for manual resolution */}
      {segment.consensusStatus === 'CONFLICT' && (
        <div className="mt-3">
          <fieldset>
            <legend className="text-xs font-medium text-gray-700 mb-2">
              Reviewer の回答
            </legend>
            <div
              className="flex flex-col gap-2"
              role="radiogroup"
              aria-label={`セグメント ${segment.segmentId} の回答候補`}
            >
              {answers.map((answer, index) => {
                const inputId = `${radioGroupName}-${index}`;
                return (
                  <label
                    key={`${answer.text}-${index}`}
                    htmlFor={inputId}
                    className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={radioGroupName}
                      value={answer.text}
                      checked={selectedText === answer.text}
                      onChange={() => setSelectedText(answer.text)}
                      className="h-4 w-4 text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="flex-1 text-sm text-gray-900">{answer.text}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {answer.count}名
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={handleResolve}
            disabled={isResolving || selectedText === null || !onResolve}
            className="mt-3 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            この回答で確定
          </button>
        </div>
      )}
    </li>
  );
}
