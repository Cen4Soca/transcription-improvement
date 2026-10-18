import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UploadProgress } from './UploadProgress';

describe('UploadProgress', () => {
  it('displays progress percentage', () => {
    render(<UploadProgress progress={45} isCompleted={false} />);

    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('shows "アップロード中..." when not completed', () => {
    render(<UploadProgress progress={60} isCompleted={false} />);

    expect(screen.getByText('アップロード中...')).toBeInTheDocument();
  });

  it('shows "アップロード完了" when completed', () => {
    render(<UploadProgress progress={100} isCompleted={true} />);

    expect(screen.getByText('アップロード完了')).toBeInTheDocument();
  });

  it('has proper ARIA progressbar attributes', () => {
    render(<UploadProgress progress={75} isCompleted={false} />);

    const progressBar = screen.getByRole('progressbar', { name: 'アップロード進捗' });
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
