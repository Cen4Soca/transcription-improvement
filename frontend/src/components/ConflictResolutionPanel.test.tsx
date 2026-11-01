import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConflictResolutionPanel } from './ConflictResolutionPanel';
import type { ConsensusSegment } from './ConflictResolutionPanel';
import i18n from '../i18n';

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(`consensus:${key}`, vars);

const sampleSegments: ConsensusSegment[] = [
  {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 1.0,
    endTime: 5.0,
    originalText: 'Hello world',
    consensusStatus: 'CONFIRMED',
    consensusText: 'Hello world',
  },
  {
    segmentId: 'seg-2',
    sessionId: 'session-1',
    startTime: 5.0,
    endTime: 10.0,
    originalText: 'Good morning',
    consensusStatus: 'CONFLICT',
    reviewerAnswers: [
      { text: 'Good morning everyone', count: 2, userIds: ['u1', 'u2'] },
      { text: 'Good morning all', count: 1, userIds: ['u3'] },
    ],
  },
  {
    segmentId: 'seg-3',
    sessionId: 'session-1',
    startTime: 10.0,
    endTime: 15.0,
    originalText: 'Thank you',
    consensusStatus: 'UNDECIDED',
  },
];

describe('ConflictResolutionPanel', () => {
  describe('ステータスラベル表示', () => {
    it('displays 確定済み label for CONFIRMED segments', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByText(new RegExp(t('conflictPanel.status.confirmed')))).toBeInTheDocument();
    });

    it('displays 未確定 label for UNDECIDED segments', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByText(new RegExp(t('conflictPanel.status.undecided')))).toBeInTheDocument();
    });

    it('displays 競合解決待ち label for CONFLICT segments', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getAllByText(new RegExp(t('conflictPanel.status.conflict'))).length).toBeGreaterThan(0);
    });
  });

  describe('競合セグメントの回答表示', () => {
    it('shows reviewer answers with vote counts', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByText('Good morning everyone')).toBeInTheDocument();
      expect(screen.getByText('Good morning all')).toBeInTheDocument();
      expect(screen.getByText(t('conflictPanel.voteCount', { count: 2 }))).toBeInTheDocument();
      expect(screen.getByText(t('conflictPanel.voteCount', { count: 1 }))).toBeInTheDocument();
    });

    it('shows conflict count in section header', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByText(t('conflictPanel.conflictHeading', { count: 1 }))).toBeInTheDocument();
    });

    it('shows original text for conflict segments', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByText('Good morning')).toBeInTheDocument();
    });
  });

  describe('回答選択と確定', () => {
    it('allows selecting an answer via radio button', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      const radio = screen.getByLabelText(t('conflictPanel.answerOptionAriaLabel', { text: 'Good morning everyone', count: 2 }));
      fireEvent.click(radio);

      expect(radio).toBeChecked();
    });

    it('calls onResolve with segmentId and selected text', () => {
      const onResolve = vi.fn();
      render(
        <ConflictResolutionPanel segments={sampleSegments} onResolve={onResolve} />
      );

      // Select an answer
      const radio = screen.getByLabelText(t('conflictPanel.answerOptionAriaLabel', { text: 'Good morning everyone', count: 2 }));
      fireEvent.click(radio);

      // Click resolve button
      const resolveButton = screen.getByLabelText(t('conflictPanel.resolve'));
      fireEvent.click(resolveButton);

      expect(onResolve).toHaveBeenCalledWith('seg-2', 'Good morning everyone');
    });

    it('disables resolve button when no answer is selected', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      const resolveButton = screen.getByLabelText(t('conflictPanel.resolve'));
      expect(resolveButton).toBeDisabled();
    });
  });

  describe('ローディング状態', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(<ConflictResolutionPanel segments={[]} isLoading={true} />);

      expect(screen.getByRole('status', { name: t('conflictPanel.loadingAriaLabel') })).toBeInTheDocument();
    });
  });

  describe('競合なしの場合', () => {
    it('shows message when no conflict segments exist', () => {
      const noConflictSegments: ConsensusSegment[] = [
        {
          segmentId: 'seg-1',
          sessionId: 'session-1',
          startTime: 1.0,
          endTime: 5.0,
          originalText: 'Hello',
          consensusStatus: 'CONFIRMED',
          consensusText: 'Hello',
        },
      ];

      render(<ConflictResolutionPanel segments={noConflictSegments} />);

      expect(
        screen.getByText(t('conflictPanel.noConflicts'))
      ).toBeInTheDocument();
    });
  });

  describe('アクセシビリティ', () => {
    it('has proper aria-label on the panel', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByLabelText(t('conflictPanel.panelAriaLabel'))).toBeInTheDocument();
    });

    it('has radiogroup role for answer selection', () => {
      render(<ConflictResolutionPanel segments={sampleSegments} />);

      expect(screen.getByRole('radiogroup', { name: t('conflictPanel.answerSelectAriaLabel') })).toBeInTheDocument();
    });
  });
});
