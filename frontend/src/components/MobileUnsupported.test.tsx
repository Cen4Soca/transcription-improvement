import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../i18n';
import { MobileUnsupported } from './MobileUnsupported';

describe('MobileUnsupported', () => {
  it('renders the unsupported message', () => {
    render(<MobileUnsupported />);

    expect(
      screen.getByText(i18n.t('common:mobileUnsupported.title'))
    ).toBeInTheDocument();
  });

  it('renders a description about supported viewports', () => {
    render(<MobileUnsupported />);

    expect(
      screen.getByText(i18n.t('common:mobileUnsupported.description'))
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
      i18n.t('common:mobileUnsupported.ariaLabel')
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
