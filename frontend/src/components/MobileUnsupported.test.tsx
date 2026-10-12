import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileUnsupported } from './MobileUnsupported';

describe('MobileUnsupported', () => {
  it('renders the unsupported message', () => {
    render(<MobileUnsupported />);

    expect(
      screen.getByText('デスクトップブラウザをご利用ください')
    ).toBeInTheDocument();
  });

  it('renders a description about supported viewports', () => {
    render(<MobileUnsupported />);

    expect(
      screen.getByText(/デスクトップブラウザ（横幅1024px以上）/)
    ).toBeInTheDocument();
  });

  it('has role="alert" for accessibility', () => {
    render(<MobileUnsupported />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    render(<MobileUnsupported />);

    expect(screen.getByRole('alert')).toHaveAttribute(
      'aria-label',
      'モバイルデバイス非対応'
    );
  });

  it('uses md:hidden class to hide on tablet and desktop', () => {
    render(<MobileUnsupported />);

    const container = screen.getByRole('alert');
    expect(container.className).toContain('md:hidden');
  });

  it('uses flex class to show on mobile', () => {
    render(<MobileUnsupported />);

    const container = screen.getByRole('alert');
    expect(container.className).toContain('flex');
  });
});
