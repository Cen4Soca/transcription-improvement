import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  it('should display offline banner when isOffline is true', () => {
    render(<OfflineBanner isOffline={true} />);

    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('オフライン');
  });

  it('should not render when isOffline is false', () => {
    render(<OfflineBanner isOffline={false} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should auto-hide when connection is restored (isOffline changes to false)', () => {
    const { rerender } = render(<OfflineBanner isOffline={true} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<OfflineBanner isOffline={false} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should have aria-live="assertive" for screen readers', () => {
    render(<OfflineBanner isOffline={true} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('should be positioned at the top of the screen', () => {
    render(<OfflineBanner isOffline={true} />);

    const banner = screen.getByRole('alert');
    expect(banner.className).toContain('fixed');
    expect(banner.className).toContain('top-0');
  });

  it('should display the full offline message text', () => {
    render(<OfflineBanner isOffline={true} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('オフライン — インターネット接続がありません');
  });

  it('should have z-50 to appear above other content', () => {
    render(<OfflineBanner isOffline={true} />);

    const banner = screen.getByRole('alert');
    expect(banner.className).toContain('z-50');
  });
});
