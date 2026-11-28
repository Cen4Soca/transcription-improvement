import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('exposes progressbar semantics with the rounded value', () => {
    render(<ProgressBar percent={33.4} label="Alice progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Alice progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it.each([
    [-5, '0'],
    [150, '100'],
  ])('clamps %s to %s', (percent, expected) => {
    render(<ProgressBar percent={percent} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ProgressBar percent={50} label="Progress" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
