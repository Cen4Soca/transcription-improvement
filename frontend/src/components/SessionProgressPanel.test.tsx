import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { SessionProgressPanel } from './SessionProgressPanel';
import type { SessionProgress } from '../types/monitoring';

const progress: SessionProgress = {
  sessionId: 's1',
  name: 'Session 1',
  status: 'IN_PROGRESS',
  totalSegments: 4,
  isStalled: false,
  lastActivityAt: '2026-11-25T00:00:00.000Z',
  reviewers: [
    {
      userId: 'u1', displayName: '山田太郎', correctedSegments: 1, totalSegments: 4,
      progressPercent: 25, lastActivityAt: '2026-11-25T00:00:00.000Z',
    },
    {
      userId: 'u2', displayName: '佐藤花子', correctedSegments: 0, totalSegments: 4,
      progressPercent: 0, lastActivityAt: null,
    },
  ],
};

describe('SessionProgressPanel', () => {
  it('shows a loading state, then per-reviewer progress bars', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: progress } });
    render(<SessionProgressPanel sessionId="s1" loadProgress={load} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('山田太郎')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('s1');

    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '25');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
  });

  it('shows "no activity" for a reviewer who has not corrected anything', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: progress } });
    render(<SessionProgressPanel sessionId="s1" loadProgress={load} />);
    expect(await screen.findByText('活動なし')).toBeInTheDocument();
  });

  it('shows an empty message when there are no reviewers', async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      value: { data: { ...progress, reviewers: [] } },
    });
    render(<SessionProgressPanel sessionId="s1" loadProgress={load} />);
    expect(await screen.findByText('参加している Reviewer がいません。')).toBeInTheDocument();
  });

  it('translates the error by errorCode', async () => {
    const load = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'raw', errorCode: 'SESSION_PROGRESS_FETCH_FAILED' },
    });
    render(<SessionProgressPanel sessionId="s1" loadProgress={load} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('セッションの進捗の取得に失敗しました。');
  });

  it('has no accessibility violations', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { data: progress } });
    const { container } = render(<SessionProgressPanel sessionId="s1" loadProgress={load} />);
    await screen.findByText('山田太郎');
    expect(await axe(container)).toHaveNoViolations();
  });
});
