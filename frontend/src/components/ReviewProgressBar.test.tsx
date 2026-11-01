import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ReviewProgressBar } from './ReviewProgressBar';

describe('ReviewProgressBar', () => {
  it('renders the progress label with done / total / percent', () => {
    render(
      <ReviewProgressBar progress={{ total: 100, done: 40, ratio: 0.4 }} />
    );
    // デフォルト言語(ja)の文言: "40 / 100 件 修正済み（40%）"
    expect(screen.getByText('40 / 100 件 修正済み（40%）')).toBeInTheDocument();
  });

  it('exposes progressbar role with aria value attributes', () => {
    render(
      <ReviewProgressBar progress={{ total: 100, done: 40, ratio: 0.4 }} />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('rounds the percentage for display', () => {
    render(
      <ReviewProgressBar progress={{ total: 3, done: 1, ratio: 1 / 3 }} />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '33');
  });

  it('handles zero total gracefully', () => {
    render(<ReviewProgressBar progress={{ total: 0, done: 0, ratio: 0 }} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ReviewProgressBar progress={{ total: 100, done: 40, ratio: 0.4 }} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
