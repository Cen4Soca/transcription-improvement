import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressIndicator } from './ProgressIndicator';

describe('ProgressIndicator', () => {
  describe('5名以上の場合（具体的人数表示）', () => {
    it('displays specific remaining count when totalReviewers >= 5', () => {
      render(<ProgressIndicator totalReviewers={7} completedCount={4} />);

      expect(screen.getByText('あと3人が回答待ち')).toBeInTheDocument();
    });

    it('displays remaining count for exactly 5 reviewers', () => {
      render(<ProgressIndicator totalReviewers={5} completedCount={2} />);

      expect(screen.getByText('あと3人が回答待ち')).toBeInTheDocument();
    });

    it('has correct aria-label with remaining count', () => {
      render(<ProgressIndicator totalReviewers={10} completedCount={7} />);

      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'あと3人が回答待ち'
      );
    });
  });

  describe('5名未満の場合（汎用メッセージ）', () => {
    it('displays generic message when totalReviewers < 5', () => {
      render(<ProgressIndicator totalReviewers={3} completedCount={1} />);

      expect(screen.getByText('まだ回答が集まっています')).toBeInTheDocument();
    });

    it('displays generic message for 4 reviewers', () => {
      render(<ProgressIndicator totalReviewers={4} completedCount={2} />);

      expect(screen.getByText('まだ回答が集まっています')).toBeInTheDocument();
    });

    it('has correct aria-label for generic message', () => {
      render(<ProgressIndicator totalReviewers={3} completedCount={1} />);

      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'まだ回答が集まっています'
      );
    });
  });

  describe('全員回答済みの場合', () => {
    it('displays completion message when all reviewers have answered', () => {
      render(<ProgressIndicator totalReviewers={5} completedCount={5} />);

      expect(screen.getByText('全員回答済み')).toBeInTheDocument();
    });

    it('displays completion message when completedCount exceeds totalReviewers', () => {
      render(<ProgressIndicator totalReviewers={3} completedCount={4} />);

      expect(screen.getByText('全員回答済み')).toBeInTheDocument();
    });

    it('has correct aria-label for completion', () => {
      render(<ProgressIndicator totalReviewers={5} completedCount={5} />);

      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        '全員回答済み'
      );
    });
  });

  describe('表示制御', () => {
    it('renders nothing when visible is false', () => {
      const { container } = render(
        <ProgressIndicator totalReviewers={5} completedCount={3} visible={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders when visible is true (default)', () => {
      render(<ProgressIndicator totalReviewers={5} completedCount={3} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
