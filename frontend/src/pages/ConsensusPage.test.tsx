import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import i18n from '../i18n';
import { ConsensusPage } from './ConsensusPage';
import type { ConsensusSegment } from '../types/consensus';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`consensus:${key}`, opts);

/**
 * Unit tests for ConsensusPage (bugfix:
 * missing-frontend-consensus-and-team-assignment).
 *
 * Verifies status badges, CONFIRMED text rendering, CONFLICT reviewer-answer
 * rendering + resolve interaction, loading/error (Japanese) states and
 * accessibility (vitest-axe).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

const confirmedSegment: ConsensusSegment = {
  segmentId: 'seg-confirmed',
  sessionId: 'session-1',
  startTime: 0,
  endTime: 1.5,
  originalText: 'おはようございます',
  consensusStatus: 'CONFIRMED',
  consensusText: 'おはようございます（確定）',
};

const undecidedSegment: ConsensusSegment = {
  segmentId: 'seg-undecided',
  sessionId: 'session-1',
  startTime: 1.5,
  endTime: 3,
  originalText: '未確定テキスト',
  consensusStatus: 'UNDECIDED',
};

const conflictSegment: ConsensusSegment = {
  segmentId: 'seg-conflict',
  sessionId: 'session-1',
  startTime: 3,
  endTime: 5,
  originalText: 'さようなら',
  consensusStatus: 'CONFLICT',
  reviewerAnswers: [
    { text: 'さようなら', count: 2, userIds: ['u1', 'u2'] },
    { text: 'さよなら', count: 1, userIds: ['u3'] },
  ],
};

const allSegments = [confirmedSegment, undecidedSegment, conflictSegment];

describe('ConsensusPage', () => {
  it('renders Japanese status badges for each segment', () => {
    render(<ConsensusPage sessionId="session-1" segments={allSegments} />);

    expect(screen.getByText(t('status.confirmed'))).toBeInTheDocument();
    expect(screen.getByText(t('status.undecided'))).toBeInTheDocument();
    expect(screen.getByText(t('status.conflict'))).toBeInTheDocument();
  });

  it('renders the confirmed consensus text for CONFIRMED segments', () => {
    render(<ConsensusPage sessionId="session-1" segments={[confirmedSegment]} />);

    expect(screen.getByText(t('confirmedText'))).toBeInTheDocument();
    expect(screen.getByText('おはようございます（確定）')).toBeInTheDocument();
  });

  it('renders CONFLICT reviewer answers with per-answer counts', () => {
    render(<ConsensusPage sessionId="session-1" segments={[conflictSegment]} />);

    expect(screen.getByText(t('reviewerAnswers'))).toBeInTheDocument();
    expect(screen.getByText(t('answerCount', { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t('answerCount', { count: 1 }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('resolveAction') })).toBeInTheDocument();
  });

  it('calls onResolve with the selected answer for a CONFLICT segment', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(
      <ConsensusPage sessionId="session-1" segments={[conflictSegment]} onResolve={onResolve} />
    );

    // Default selection is the first answer; pick the second explicitly.
    const radios = screen.getAllByRole('radio');
    await user.click(radios[1]);
    await user.click(screen.getByRole('button', { name: t('resolveAction') }));

    expect(onResolve).toHaveBeenCalledWith('seg-conflict', 'さよなら');
  });

  it('shows the loading state', () => {
    render(<ConsensusPage sessionId="session-1" segments={[]} isLoading />);
    expect(screen.getByRole('status', { name: t('loadingAriaLabel') })).toBeInTheDocument();
  });

  it('shows a Japanese error message', () => {
    render(
      <ConsensusPage
        sessionId="session-1"
        segments={[]}
        error={{ message: 'Consensus 状態の取得に失敗しました。' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Consensus 状態の取得に失敗しました。'
    );
  });

  it('shows a Japanese resolve error message', () => {
    render(
      <ConsensusPage
        sessionId="session-1"
        segments={allSegments}
        resolveError="このセグメントは解決できません。競合解決待ちのセグメントのみ確定できます。"
      />
    );
    expect(
      screen.getByText(
        'このセグメントは解決できません。競合解決待ちのセグメントのみ確定できます。'
      )
    ).toBeInTheDocument();
  });

  it('shows an empty state when there are no segments', () => {
    render(<ConsensusPage sessionId="session-1" segments={[]} />);
    expect(screen.getByText(t('emptyState'))).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ConsensusPage sessionId="session-1" segments={allSegments} onResolve={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
