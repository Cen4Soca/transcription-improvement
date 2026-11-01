import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../i18n';
import { UploadProgress } from './UploadProgress';

const uploading = () => i18n.t('upload:progress.uploading');
const completed = () => i18n.t('upload:progress.completed');
const progressAriaLabel = () => i18n.t('upload:progress.ariaLabel');

describe('UploadProgress', () => {
  it('displays progress percentage', () => {
    render(<UploadProgress progress={45} isCompleted={false} />);

    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('shows uploading label when not completed', () => {
    render(<UploadProgress progress={60} isCompleted={false} />);

    expect(screen.getByText(uploading())).toBeInTheDocument();
  });

  it('shows completed label when completed', () => {
    render(<UploadProgress progress={100} isCompleted={true} />);

    expect(screen.getByText(completed())).toBeInTheDocument();
  });

  it('has proper ARIA progressbar attributes', () => {
    render(<UploadProgress progress={75} isCompleted={false} />);

    const progressBar = screen.getByRole('progressbar', { name: progressAriaLabel() });
    expect(progressBar).toHaveAttribute('aria-valuenow', '75');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders green bar when completed', () => {
    const { container } = render(<UploadProgress progress={100} isCompleted={true} />);

    const innerBar = container.querySelector('[style*="width: 100%"]');
    expect(innerBar).toHaveClass('bg-green-500');
  });

  it('renders blue bar when uploading', () => {
    const { container } = render(<UploadProgress progress={50} isCompleted={false} />);

    const innerBar = container.querySelector('[style*="width: 50%"]');
    expect(innerBar).toHaveClass('bg-blue-600');
  });

  it('sets correct width style based on progress', () => {
    const { container } = render(<UploadProgress progress={33} isCompleted={false} />);

    const innerBar = container.querySelector('.bg-blue-600');
    expect(innerBar).toHaveStyle({ width: '33%' });
  });
});
