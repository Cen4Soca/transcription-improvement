import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponsiveLayout } from './ResponsiveLayout';

describe('ResponsiveLayout', () => {
  const primary = <div data-testid="primary-content">Primary</div>;
  const secondary = <div data-testid="secondary-content">Secondary</div>;

  it('renders the MobileUnsupported message', () => {
    render(<ResponsiveLayout primary={primary} secondary={secondary} />);

    expect(
      screen.getByText('デスクトップブラウザをご利用ください')
    ).toBeInTheDocument();
  });

  it('renders primary content', () => {
    render(<ResponsiveLayout primary={primary} secondary={secondary} />);

    expect(screen.getByTestId('primary-content')).toBeInTheDocument();
  });

  it('renders secondary content', () => {
    render(<ResponsiveLayout primary={primary} secondary={secondary} />);

    expect(screen.getByTestId('secondary-content')).toBeInTheDocument();
  });

  describe('responsive classes', () => {
    it('hides content layout on mobile with hidden class', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const contentLayout = screen.getByTestId('primary-content').parentElement!.parentElement!;
      expect(contentLayout.className).toContain('hidden');
      expect(contentLayout.className).toContain('md:flex');
    });

    it('uses vertical (column) layout for tablet with md:flex-col', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const contentLayout = screen.getByTestId('primary-content').parentElement!.parentElement!;
      expect(contentLayout.className).toContain('md:flex-col');
    });

    it('uses horizontal (row) layout for desktop with lg:flex-row', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const contentLayout = screen.getByTestId('primary-content').parentElement!.parentElement!;
      expect(contentLayout.className).toContain('lg:flex-row');
    });

    it('primary panel uses half height on tablet (md:h-1/2)', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const primaryPanel = screen.getByTestId('primary-content').parentElement!;
      expect(primaryPanel.className).toContain('md:h-1/2');
    });

    it('primary panel uses half width on desktop (lg:w-1/2)', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const primaryPanel = screen.getByTestId('primary-content').parentElement!;
      expect(primaryPanel.className).toContain('lg:w-1/2');
    });

    it('secondary panel uses half height on tablet (md:h-1/2)', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const secondaryPanel = screen.getByTestId('secondary-content').parentElement!;
      expect(secondaryPanel.className).toContain('md:h-1/2');
    });

    it('secondary panel uses half width on desktop (lg:w-1/2)', () => {
      render(<ResponsiveLayout primary={primary} secondary={secondary} />);

      const secondaryPanel = screen.getByTestId('secondary-content').parentElement!;
      expect(secondaryPanel.className).toContain('lg:w-1/2');
    });
  });
});
