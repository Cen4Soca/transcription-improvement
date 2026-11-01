import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ConsensusStatus } from '../types/segment';

/**
 * Reviewer answer with aggregated count for a conflict segment.
 */
export interface ReviewerAnswer {
  text: string;
  count: number;
  userIds: string[];
}

/**
 * Segment with consensus information for the conflict resolution panel.
 */
export interface ConsensusSegment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: ConsensusStatus;
  consensusText?: string;
  reviewerAnswers?: ReviewerAnswer[];
}

export interface ConflictResolutionPanelProps {
  segments: ConsensusSegment[];
  isLoading?: boolean;
  onResolve?: (segmentId: string, selectedText: string) => void;
}

/**
 * Status styling and translation-key configuration for each consensus status.
 */
const STATUS_CONFIG: Record<ConsensusStatus, { labelKey: string; className: string }> = {
  CONFIRMED: {
    labelKey: 'conflictPanel.status.confirmed',
    className: 'bg-green-100 text-green-800',
  },
  UNDECIDED: {
    labelKey: 'conflictPanel.status.undecided',
    className: 'bg-gray-100 text-gray-800',
  },
  CONFLICT: {
    labelKey: 'conflictPanel.status.conflict',
    className: 'bg-yellow-100 text-yellow-800',
  },
};

/**
 * ConflictResolutionPanel - Admin向け競合解決UIコンポーネント
 *
 * Shows segments in CONFLICT state with each reviewer's answer and count.
 * Admin selects the final answer to resolve the conflict.
 * Displays segment status labels: 確定済み / 未確定 / 競合解決待ち
 *
 * Requirements: 10.6, 10.7, 10.8, 10.9
 */
export function ConflictResolutionPanel({
  segments,
  isLoading = false,
  onResolve,
}: ConflictResolutionPanelProps) {
  const { t } = useTranslation('consensus');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [resolvingSegmentId, setResolvingSegmentId] = useState<string | null>(null);

  const conflictSegments = segments.filter((s) => s.consensusStatus === 'CONFLICT');

  const handleSelectAnswer = (segmentId: string, text: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [segmentId]: text }));
  };

  const handleResolve = (segmentId: string) => {
    const selectedText = selectedAnswers[segmentId];
    if (selectedText === undefined) return;

    setResolvingSegmentId(segmentId);
    onResolve?.(segmentId, selectedText);
    setResolvingSegmentId(null);
  };

  if (isLoading) {
    return (
      <div className="p-4" role="status" aria-label={t('conflictPanel.loadingAriaLabel')}>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label={t('conflictPanel.panelAriaLabel')}>
      <h2 className="text-lg font-semibold text-gray-900">{t('conflictPanel.heading')}</h2>

      {/* Summary of all segments with status labels */}
      <section aria-label={t('conflictPanel.segmentStatusListAriaLabel')}>
        <h3 className="text-sm font-medium text-gray-700 mb-2">{t('conflictPanel.segmentStatusHeading')}</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {segments.map((segment) => (
            <SegmentStatusBadge
              key={segment.segmentId}
              segment={segment}
              t={t}
            />
          ))}
        </div>
      </section>

      {/* Conflict segments requiring resolution */}
      {conflictSegments.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {t('conflictPanel.noConflicts')}
        </p>
      ) : (
        <section aria-label={t('conflictPanel.conflictListAriaLabel')}>
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {t('conflictPanel.conflictHeading', { count: conflictSegments.length })}
          </h3>
          <ul className="space-y-4">
            {conflictSegments.map((segment) => (
              <li
                key={segment.segmentId}
                className="border border-yellow-200 rounded-lg p-4 bg-yellow-50"
              >
                <ConflictSegmentCard
                  segment={segment}
                  selectedText={selectedAnswers[segment.segmentId]}
                  isResolving={resolvingSegmentId === segment.segmentId}
                  onSelectAnswer={(text) =>
                    handleSelectAnswer(segment.segmentId, text)
                  }
                  onResolve={() => handleResolve(segment.segmentId)}
                  t={t}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Badge showing the consensus status of a segment.
 */
function SegmentStatusBadge({ segment, t }: { segment: ConsensusSegment; t: TFunction }) {
  const { labelKey, className } = STATUS_CONFIG[segment.consensusStatus];
  const statusText = t(labelKey);

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${className}`}
      title={t('conflictPanel.badgeTitle', { segmentId: segment.segmentId, status: statusText })}
    >
      {t('conflictPanel.badgeLabel', { time: formatTime(segment.startTime), status: statusText })}
    </span>
  );
}

/**
 * Card for a single conflict segment showing reviewer answers.
 */
function ConflictSegmentCard({
  segment,
  selectedText,
  isResolving,
  onSelectAnswer,
  onResolve,
  t,
}: {
  segment: ConsensusSegment;
  selectedText?: string;
  isResolving: boolean;
  onSelectAnswer: (text: string) => void;
  onResolve: () => void;
  t: TFunction;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-600">
          <span className="font-mono">{formatTime(segment.startTime)}</span>
          {segment.speakerLabel && (
            <span className="ml-2 text-gray-500">[{segment.speakerLabel}]</span>
          )}
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          {t('conflictPanel.conflictPending')}
        </span>
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {t('conflictPanel.originalText')} <span className="text-gray-700">{segment.originalText}</span>
      </p>

      {/* Reviewer answers */}
      {segment.reviewerAnswers && segment.reviewerAnswers.length > 0 ? (
        <div className="space-y-2 mb-3">
          <p className="text-xs font-medium text-gray-600">{t('conflictPanel.reviewerAnswers')}</p>
          <ul className="space-y-1" role="radiogroup" aria-label={t('conflictPanel.answerSelectAriaLabel')}>
            {segment.reviewerAnswers.map((answer, index) => (
              <li key={index}>
                <label
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                    selectedText === answer.text
                      ? 'bg-blue-50 border border-blue-300'
                      : 'bg-white border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`answer-${segment.segmentId}`}
                    value={answer.text}
                    checked={selectedText === answer.text}
                    onChange={() => onSelectAnswer(answer.text)}
                    className="text-blue-600 focus:ring-blue-500"
                    aria-label={t('conflictPanel.answerOptionAriaLabel', { text: answer.text, count: answer.count })}
                  />
                  <span className="flex-1 text-sm text-gray-900">
                    {answer.text || <em className="text-gray-400">{t('conflictPanel.emptyText')}</em>}
                  </span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {t('conflictPanel.voteCount', { count: answer.count })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-gray-400 mb-3">{t('conflictPanel.noAnswerData')}</p>
      )}

      {/* Resolve button */}
      <button
        type="button"
        onClick={onResolve}
        disabled={selectedText === undefined || isResolving}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t('conflictPanel.resolve')}
      >
        {isResolving ? t('conflictPanel.resolving') : t('conflictPanel.resolve')}
      </button>
    </div>
  );
}

/**
 * Format seconds to HH:MM:SS display.
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
