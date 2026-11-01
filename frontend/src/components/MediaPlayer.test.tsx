import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n';
import { MediaPlayer } from './MediaPlayer';

const tm = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(`review:mediaPlayer.${key}`, opts);
const speedName = (speed: number) => tm('speedAriaLabel', { speed });

// Mock HTMLMediaElement methods
beforeEach(() => {
  // Mock play/pause on HTMLMediaElement prototype
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    get() {
      return 120;
    },
    configurable: true,
  });
});

describe('MediaPlayer', () => {
  const defaultProps = {
    mediaUrl: 'https://cdn.example.com/media/test.mp3',
    mediaType: 'audio' as const,
  };

  it('renders media player when mediaUrl is provided', () => {
    render(<MediaPlayer {...defaultProps} />);

    expect(screen.getByRole('region', { name: tm('playerAriaLabel') })).toBeInTheDocument();
  });

  it('shows unavailable message when mediaUrl is null', () => {
    render(<MediaPlayer mediaUrl={null} />);

    expect(screen.queryByRole('region', { name: tm('playerAriaLabel') })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: tm('unavailableAriaLabel') })).toBeInTheDocument();
    expect(screen.getByText(tm('unavailable'))).toBeInTheDocument();
  });

  it('renders play button initially', () => {
    render(<MediaPlayer {...defaultProps} />);

    expect(screen.getByRole('button', { name: tm('play') })).toBeInTheDocument();
  });

  it('renders all playback speed buttons', () => {
    render(<MediaPlayer {...defaultProps} />);

    expect(screen.getByRole('button', { name: speedName(0.5) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: speedName(1) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: speedName(1.25) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: speedName(1.5) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: speedName(2) })).toBeInTheDocument();
  });

  it('marks 1.0x speed as active by default', () => {
    render(<MediaPlayer {...defaultProps} />);

    const activeButton = screen.getByRole('button', { name: speedName(1) });
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders seek slider', () => {
    render(<MediaPlayer {...defaultProps} />);

    expect(screen.getByRole('slider', { name: tm('seek') })).toBeInTheDocument();
  });

  it('calls onPlayStateChange when play is triggered', async () => {
    const onPlayStateChange = vi.fn();
    render(<MediaPlayer {...defaultProps} onPlayStateChange={onPlayStateChange} />);

    const playButton = screen.getByRole('button', { name: tm('play') });
    await userEvent.click(playButton);

    // Simulate the play event firing
    const audio = document.querySelector('audio')!;
    fireEvent.play(audio);

    expect(onPlayStateChange).toHaveBeenCalledWith(true);
  });

  it('calls onPlayStateChange when pause is triggered', () => {
    const onPlayStateChange = vi.fn();
    render(<MediaPlayer {...defaultProps} onPlayStateChange={onPlayStateChange} />);

    const audio = document.querySelector('audio')!;
    fireEvent.pause(audio);

    expect(onPlayStateChange).toHaveBeenCalledWith(false);
  });

  it('calls onTimeUpdate during playback', () => {
    const onTimeUpdate = vi.fn();
    render(<MediaPlayer {...defaultProps} onTimeUpdate={onTimeUpdate} />);

    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'currentTime', { value: 42.5, writable: true });
    fireEvent.timeUpdate(audio);

    expect(onTimeUpdate).toHaveBeenCalledWith(42.5);
  });

  it('changes playback speed when speed button is clicked', async () => {
    render(<MediaPlayer {...defaultProps} />);

    const speedButton = screen.getByRole('button', { name: speedName(1.5) });
    await userEvent.click(speedButton);

    expect(speedButton).toHaveAttribute('aria-pressed', 'true');
    // Previous active button should no longer be pressed
    const prevButton = screen.getByRole('button', { name: speedName(1) });
    expect(prevButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies playbackRate to media element for all speeds (0.5x, 1.0x, 1.25x, 1.5x, 2.0x)', async () => {
    render(<MediaPlayer {...defaultProps} />);
    const audio = document.querySelector('audio')!;

    const speeds = [0.5, 1.0, 1.25, 1.5, 2.0];
    for (const speed of speeds) {
      const speedButton = screen.getByRole('button', { name: speedName(speed) });
      await userEvent.click(speedButton);
      expect(audio.playbackRate).toBe(speed);
    }
  });

  it('updates currentTime when seek slider is changed', () => {
    render(<MediaPlayer {...defaultProps} />);

    const audio = document.querySelector('audio')!;
    // Verify the audio element exists (mediaRef.current is set)
    expect(audio).toBeInTheDocument();

    // Simulate seek via slider - use fireEvent which directly sets target.value
    const slider = screen.getByRole('slider', { name: tm('seek') });

    // fireEvent.change triggers React's onChange with the specified target value
    Object.defineProperty(slider, 'value', { value: '45.5', writable: true, configurable: true });
    fireEvent.change(slider, { target: { value: '45.5' } });

    // The component's handleSeek sets mediaRef.current.currentTime and calls setCurrentTime
    // Verify the time display updated
    expect(screen.getByLabelText(tm('playbackTime'))).toHaveTextContent('00:45');
  });

  it('shows error message and calls onError when media fails to load', () => {
    const onError = vi.fn();
    render(<MediaPlayer {...defaultProps} onError={onError} />);

    const audio = document.querySelector('audio')!;
    fireEvent.error(audio);

    expect(onError).toHaveBeenCalledWith(tm('loadError'));
    // After re-render, the player controls should be replaced by error message
    expect(screen.queryByRole('region', { name: tm('playerAriaLabel') })).not.toBeInTheDocument();
    expect(screen.getByRole('alert', { name: tm('errorAriaLabel') })).toBeInTheDocument();
    expect(screen.getByText(tm('loadError'))).toBeInTheDocument();
  });

  it('seeks to specified time when seekTo prop changes', () => {
    const { rerender } = render(<MediaPlayer {...defaultProps} seekTo={null} />);

    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });

    rerender(<MediaPlayer {...defaultProps} seekTo={30} />);

    expect(audio.currentTime).toBe(30);
  });

  it('renders video element when mediaType is video', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/video.mp4" mediaType="video" />);

    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('renders audio element when mediaType is audio', () => {
    render(<MediaPlayer {...defaultProps} mediaType="audio" />);

    expect(document.querySelector('audio')).toBeInTheDocument();
  });

  it('auto-detects video type from URL extension (.mp4)', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/media/file.mp4" />);

    expect(document.querySelector('video')).toBeInTheDocument();
    expect(document.querySelector('audio')).not.toBeInTheDocument();
  });

  it('auto-detects video type from URL extension (.webm)', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/media/file.webm" />);

    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('auto-detects video type from URL extension (.mov)', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/media/file.mov" />);

    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('auto-detects audio type for non-video extensions (.mp3)', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/media/file.mp3" />);

    expect(document.querySelector('audio')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });

  it('explicit mediaType prop overrides URL detection', () => {
    render(<MediaPlayer mediaUrl="https://cdn.example.com/media/file.mp4" mediaType="audio" />);

    expect(document.querySelector('audio')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(<MediaPlayer {...defaultProps} />);

    const region = screen.getByRole('region', { name: tm('playerAriaLabel') });
    expect(region).toBeInTheDocument();

    const speedGroup = screen.getByRole('group', { name: tm('playbackSpeed') });
    expect(speedGroup).toBeInTheDocument();
  });

  it('displays time display element', () => {
    render(<MediaPlayer {...defaultProps} />);

    expect(screen.getByLabelText(tm('playbackTime'))).toBeInTheDocument();
  });

  // --- 再生速度変更テスト (Requirement 4.7) ---
  describe('再生速度変更 (Requirement 4.7)', () => {
    it('maintains playback rate after seeking', async () => {
      render(<MediaPlayer {...defaultProps} />);
      const audio = document.querySelector('audio')!;

      // Set speed to 1.5x
      await userEvent.click(screen.getByRole('button', { name: speedName(1.5) }));
      expect(audio.playbackRate).toBe(1.5);

      // Seek to a different position
      const slider = screen.getByRole('slider', { name: tm('seek') });
      fireEvent.change(slider, { target: { value: '60' } });

      // Playback rate should remain 1.5x after seek
      expect(audio.playbackRate).toBe(1.5);
    });

    it('only one speed button is active at a time', async () => {
      render(<MediaPlayer {...defaultProps} />);

      // Click 2.0x
      await userEvent.click(screen.getByRole('button', { name: speedName(2) }));

      // Verify only 2.0x is pressed
      expect(screen.getByRole('button', { name: speedName(0.5) })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: speedName(1) })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: speedName(1.25) })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: speedName(1.5) })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: speedName(2) })).toHaveAttribute('aria-pressed', 'true');
    });

    it('can switch between speeds rapidly', async () => {
      render(<MediaPlayer {...defaultProps} />);
      const audio = document.querySelector('audio')!;

      await userEvent.click(screen.getByRole('button', { name: speedName(0.5) }));
      expect(audio.playbackRate).toBe(0.5);

      await userEvent.click(screen.getByRole('button', { name: speedName(2) }));
      expect(audio.playbackRate).toBe(2.0);

      await userEvent.click(screen.getByRole('button', { name: speedName(1.25) }));
      expect(audio.playbackRate).toBe(1.25);
    });
  });

  // --- シーク操作テスト (Requirement 4.7) ---
  describe('シーク操作 (Requirement 4.7)', () => {
    it('does not seek when in error state', () => {
      const { rerender } = render(<MediaPlayer {...defaultProps} seekTo={null} />);

      const audio = document.querySelector('audio')!;
      Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });

      // Trigger error
      fireEvent.error(audio);

      // Try to seek - should not work since player is in error state
      rerender(<MediaPlayer {...defaultProps} seekTo={50} />);

      // The error state renders a different UI, so audio element is gone
      expect(document.querySelector('audio')).not.toBeInTheDocument();
    });

    it('seeks to beginning (time 0)', () => {
      const { rerender } = render(<MediaPlayer {...defaultProps} seekTo={null} />);

      const audio = document.querySelector('audio')!;
      Object.defineProperty(audio, 'currentTime', { value: 60, writable: true, configurable: true });

      rerender(<MediaPlayer {...defaultProps} seekTo={0} />);

      expect(audio.currentTime).toBe(0);
    });

    it('updates time display after seek via slider', () => {
      render(<MediaPlayer {...defaultProps} />);

      const audio = document.querySelector('audio')!;
      // Trigger loadedmetadata so duration state is set
      Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });
      fireEvent.loadedMetadata(audio);

      const slider = screen.getByRole('slider', { name: tm('seek') });
      fireEvent.change(slider, { target: { value: '90' } });

      expect(screen.getByLabelText(tm('playbackTime'))).toHaveTextContent('01:30');
    });

    it('calls onTimeUpdate when media time updates after seek', () => {
      const onTimeUpdate = vi.fn();
      render(<MediaPlayer {...defaultProps} onTimeUpdate={onTimeUpdate} />);

      const audio = document.querySelector('audio')!;
      Object.defineProperty(audio, 'currentTime', { value: 75, writable: true, configurable: true });
      fireEvent.timeUpdate(audio);

      expect(onTimeUpdate).toHaveBeenCalledWith(75);
    });

    it('maintains play state after external seekTo', async () => {
      const onPlayStateChange = vi.fn();
      const { rerender } = render(
        <MediaPlayer {...defaultProps} seekTo={null} onPlayStateChange={onPlayStateChange} />
      );

      const audio = document.querySelector('audio')!;
      Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });

      // Start playing
      fireEvent.play(audio);
      expect(onPlayStateChange).toHaveBeenCalledWith(true);

      // Seek via prop - should not trigger pause
      rerender(<MediaPlayer {...defaultProps} seekTo={30} onPlayStateChange={onPlayStateChange} />);

      // play state change should not have been called with false
      expect(onPlayStateChange).not.toHaveBeenCalledWith(false);
    });
  });

  // --- エラー時の MediaPlayer 非表示テスト (Requirement 4.8) ---
  describe('エラー時の MediaPlayer 非表示 (Requirement 4.8)', () => {
    it('hides all player controls on error', () => {
      render(<MediaPlayer {...defaultProps} />);

      const audio = document.querySelector('audio')!;
      fireEvent.error(audio);

      // Player controls should be gone
      expect(screen.queryByRole('button', { name: tm('play') })).not.toBeInTheDocument();
      expect(screen.queryByRole('slider', { name: tm('seek') })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: tm('playbackSpeed') })).not.toBeInTheDocument();
    });

    it('shows error alert with descriptive message', () => {
      render(<MediaPlayer {...defaultProps} />);

      const audio = document.querySelector('audio')!;
      fireEvent.error(audio);

      const alert = screen.getByRole('alert', { name: tm('errorAriaLabel') });
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(tm('loadError'));
    });

    it('does not allow play/pause toggle after error', () => {
      render(<MediaPlayer {...defaultProps} />);

      const audio = document.querySelector('audio')!;
      fireEvent.error(audio);

      // Play button should not exist
      expect(screen.queryByRole('button', { name: tm('play') })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: tm('pause') })).not.toBeInTheDocument();
    });

    it('invokes onError callback with error message', () => {
      const onError = vi.fn();
      render(<MediaPlayer {...defaultProps} onError={onError} />);

      const audio = document.querySelector('audio')!;
      fireEvent.error(audio);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(tm('loadError'));
    });
  });
});
