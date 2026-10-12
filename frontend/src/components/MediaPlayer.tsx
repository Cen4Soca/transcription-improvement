import { useRef, useEffect, useState, useCallback, useMemo } from 'react';

export interface MediaPlayerProps {
  mediaUrl: string | null;
  mediaType?: 'audio' | 'video';
  onTimeUpdate?: (currentTime: number) => void;
  onError?: (error: string) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  seekTo?: number | null;
}

/**
 * Detect media type from URL extension.
 * Returns 'video' for known video extensions, 'audio' otherwise.
 */
function detectMediaType(url: string): 'audio' | 'video' {
  const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (videoExtensions.some((ext) => pathname.endsWith(ext))) {
      return 'video';
    }
  } catch {
    // If URL parsing fails, fall back to audio
  }
  return 'audio';
}

const PLAYBACK_SPEEDS = [0.5, 1.0, 1.25, 1.5, 2.0] as const;

/**
 * MediaPlayer - 音声・動画の再生コンポーネント
 * CloudFront Signed URL 経由でメディアストリーミングを行い、
 * 再生・一時停止・シーク・速度変更を提供する。
 * Requirements: 4.4, 4.7, 4.8
 */
export function MediaPlayer({
  mediaUrl,
  mediaType,
  onTimeUpdate,
  onError,
  onPlayStateChange,
  seekTo,
}: MediaPlayerProps) {
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Determine effective media type: explicit prop > URL detection > default 'audio'
  const effectiveMediaType = useMemo(() => {
    if (mediaType) return mediaType;
    if (mediaUrl) return detectMediaType(mediaUrl);
    return 'audio';
  }, [mediaType, mediaUrl]);

  // Handle seekTo prop changes from external sources (e.g., segment click)
  useEffect(() => {
    if (seekTo != null && mediaRef.current && !hasError) {
      mediaRef.current.currentTime = seekTo;
    }
  }, [seekTo, hasError]);

  // Handle playback rate changes
  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleTimeUpdate = useCallback(() => {
    if (mediaRef.current) {
      const time = mediaRef.current.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    }
  }, [onTimeUpdate]);

  const handleLoadedMetadata = useCallback(() => {
    if (mediaRef.current) {
      setDuration(mediaRef.current.duration);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    onPlayStateChange?.(true);
  }, [onPlayStateChange]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    onPlayStateChange?.(false);
  }, [onPlayStateChange]);

  const handleMediaError = useCallback(() => {
    setHasError(true);
    const message = 'メディアファイルの読み込みに失敗しました';
    setErrorMessage(message);
    onError?.(message);
  }, [onError]);

  const togglePlayPause = useCallback(() => {
    if (!mediaRef.current || hasError) return;
    if (isPlaying) {
      mediaRef.current.pause();
    } else {
      mediaRef.current.play();
    }
  }, [isPlaying, hasError]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!mediaRef.current || hasError) return;
    const newTime = parseFloat(e.target.value);
    mediaRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [hasError]);

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackRate(speed);
  }, []);

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // If there's an error, show error message
  if (hasError) {
    return (
      <div
        className="p-4 bg-red-50 border border-red-200 rounded-lg"
        role="alert"
        aria-label="メディアエラー"
      >
        <p className="text-sm text-red-700">
          {errorMessage || 'メディアファイルの読み込みに失敗しました'}
        </p>
      </div>
    );
  }

  // If no URL provided, show unavailable message
  if (!mediaUrl) {
    return (
      <div
        className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg"
        role="status"
        aria-label="メディア利用不可"
      >
        <p className="text-sm text-yellow-700">
          メディアファイルが利用できません。テキスト編集のみ可能です。
        </p>
      </div>
    );
  }

  const mediaProps = {
    ref: mediaRef as React.RefObject<HTMLAudioElement & HTMLVideoElement>,
    src: mediaUrl,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
    onPlay: handlePlay,
    onPause: handlePause,
    onError: handleMediaError,
    preload: 'metadata' as const,
    'aria-label': 'メディアプレイヤー',
  };

  return (
    <div
      className="flex flex-col gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200"
      role="region"
      aria-label="メディアプレイヤー"
    >
      {/* Media element */}
      {effectiveMediaType === 'video' ? (
        <video
          {...mediaProps}
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          className="w-full rounded bg-black max-h-64"
        />
      ) : (
        <audio
          {...mediaProps}
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          className="hidden"
        />
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Play/Pause button */}
        <button
          type="button"
          onClick={togglePlayPause}
          aria-label={isPlaying ? '一時停止' : '再生'}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
        >
          {isPlaying ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>

        {/* Time display */}
        <span
          className="text-xs font-mono text-gray-600 min-w-[90px]"
          aria-label="再生時間"
          aria-live="polite"
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Seek slider */}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          aria-label="シーク"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />

        {/* Playback speed selector */}
        <div className="flex items-center gap-1" role="group" aria-label="再生速度">
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => handleSpeedChange(speed)}
              aria-label={`再生速度 ${speed}倍`}
              aria-pressed={playbackRate === speed}
              className={`px-2 py-1 text-xs rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                playbackRate === speed
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
