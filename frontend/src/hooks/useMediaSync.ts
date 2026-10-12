import { useState, useCallback, useRef, useEffect } from 'react';
import type { Segment } from '../types/segment';

export interface UseMediaSyncOptions {
  /** When true, auto-scroll is paused (e.g., during text editing) */
  isEditing?: boolean;
}

export interface UseMediaSyncReturn {
  currentTime: number;
  highlightedSegmentId: string | null;
  handleTimeUpdate: (time: number) => void;
  handleSegmentClick: (segmentId: string) => void;
  seekTo: number | null;
}

/**
 * useMediaSync - メディア再生位置とSegmentハイライトを同期するカスタムフック
 *
 * - 再生位置に対応するSegmentを特定してハイライト
 * - Segmentクリック時にMediaPlayerへのシーク指示を発行
 * - ハイライト変更時に自動スクロールを実行
 * - テキスト編集中は自動スクロールを一時停止
 *
 * Requirements: 4.5, 4.6, 4.9, 4.10
 */
export function useMediaSync(
  segments: Segment[],
  options: UseMediaSyncOptions = {}
): UseMediaSyncReturn {
  const { isEditing = false } = options;
  const [currentTime, setCurrentTime] = useState(0);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const highlightedRef = useRef<string | null>(null);

  // Find the segment that corresponds to the current playback time
  const findSegmentAtTime = useCallback(
    (time: number): string | null => {
      if (segments.length === 0) return null;

      // Linear scan for simplicity; segments are expected to be sorted by startTime
      for (let i = segments.length - 1; i >= 0; i--) {
        if (time >= segments[i].startTime) {
          if (time <= segments[i].endTime) {
            return segments[i].segmentId;
          }
          // If time is past endTime but before next segment's startTime,
          // still highlight this segment
          if (i < segments.length - 1 && time < segments[i + 1].startTime) {
            return segments[i].segmentId;
          }
          // If it's the last segment and time is past its startTime
          if (i === segments.length - 1) {
            return segments[i].segmentId;
          }
          return null;
        }
      }

      return null;
    },
    [segments]
  );

  // Handle time updates from MediaPlayer (called at ~100ms intervals)
  const handleTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time);
      const segmentId = findSegmentAtTime(time);
      if (segmentId !== highlightedRef.current) {
        highlightedRef.current = segmentId;
        setHighlightedSegmentId(segmentId);
      }
    },
    [findSegmentAtTime]
  );

  // Handle segment click - seek MediaPlayer to segment's startTime
  const handleSegmentClick = useCallback(
    (segmentId: string) => {
      const segment = segments.find((s) => s.segmentId === segmentId);
      if (segment) {
        setSeekTo(segment.startTime);
        // Reset seekTo after a tick so it can be triggered again for the same segment
        setTimeout(() => setSeekTo(null), 0);
      }
    },
    [segments]
  );

  // Auto-scroll to highlighted segment when it changes
  // Paused during text editing (Requirement 4.10)
  useEffect(() => {
    if (isEditing) return;
    if (highlightedSegmentId) {
      const element = document.querySelector(
        `[data-segment-id="${highlightedSegmentId}"]`
      );
      if (element) {
        const rect = element.getBoundingClientRect();
        const parent = element.closest('[data-scroll-container]');
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          const isVisible =
            rect.top >= parentRect.top && rect.bottom <= parentRect.bottom;
          if (!isVisible) {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }
    }
  }, [highlightedSegmentId, isEditing]);

  return {
    currentTime,
    highlightedSegmentId,
    handleTimeUpdate,
    handleSegmentClick,
    seekTo,
  };
}
