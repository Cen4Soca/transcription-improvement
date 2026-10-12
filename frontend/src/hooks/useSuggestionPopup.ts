import { useState, useRef, useCallback } from 'react';

export interface SuggestionCandidate {
  text: string;
  source: string;
}

export interface SuggestionPopupState {
  isVisible: boolean;
  segmentId: string | null;
  suggestions: SuggestionCandidate[];
  isLoading: boolean;
  hasError: boolean;
}

export interface UseSuggestionPopupOptions {
  /** Disable hover auto-show; only show via button click (Req 8.10) */
  disableHoverAutoShow?: boolean;
  /** Fetch suggestions for a given segment */
  fetchSuggestions: (segmentId: string) => Promise<{
    suggestions: SuggestionCandidate[];
    hasError: boolean;
  }>;
  /** Callback when a suggestion is selected (Req 8.4) */
  onSelect: (segmentId: string, text: string) => void;
  /** Callback to enter edit mode (Req 8.6) */
  onEditMode: (segmentId: string) => void;
}

/**
 * useSuggestionPopup - 修正候補ポップアップの表示制御フック
 *
 * - 500ms ホバーでポップアップ表示 (Req 8.1)
 * - ボタンクリックで即時表示 (Req 8.2)
 * - ホバー自動表示無効化オプション (Req 8.10)
 * - 別 Segment ホバー時に既存ポップアップを閉じて新規表示 (Req 8.9)
 * - ポップアップ外クリックで閉じる (Req 8.8)
 */
export function useSuggestionPopup({
  disableHoverAutoShow = false,
  fetchSuggestions,
  onSelect,
  onEditMode,
}: UseSuggestionPopupOptions) {
  const [state, setState] = useState<SuggestionPopupState>({
    isVisible: false,
    segmentId: null,
    suggestions: [],
    isLoading: false,
    hasError: false,
  });

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSegmentRef = useRef<string | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const openPopup = useCallback(
    async (segmentId: string) => {
      // Close existing popup and open for new segment (Req 8.9)
      currentSegmentRef.current = segmentId;

      setState({
        isVisible: true,
        segmentId,
        suggestions: [],
        isLoading: true,
        hasError: false,
      });

      try {
        const result = await fetchSuggestions(segmentId);

        // Only update if this segment is still the current one
        if (currentSegmentRef.current === segmentId) {
          setState((prev) => ({
            ...prev,
            suggestions: result.suggestions,
            isLoading: false,
            hasError: result.hasError,
          }));
        }
      } catch {
        if (currentSegmentRef.current === segmentId) {
          setState((prev) => ({
            ...prev,
            suggestions: [],
            isLoading: false,
            hasError: true,
          }));
        }
      }
    },
    [fetchSuggestions]
  );

  /** Handle segment hover start - triggers 500ms delay (Req 8.1) */
  const handleSegmentHoverStart = useCallback(
    (segmentId: string) => {
      if (disableHoverAutoShow) {
        return;
      }

      clearHoverTimer();

      // If hovering a different segment while popup is open, close and reopen (Req 8.9)
      if (state.isVisible && state.segmentId !== segmentId) {
        clearHoverTimer();
      }

      hoverTimerRef.current = setTimeout(() => {
        openPopup(segmentId);
      }, 500);
    },
    [disableHoverAutoShow, clearHoverTimer, openPopup, state.isVisible, state.segmentId]
  );

  /** Handle segment hover end - cancels pending timer */
  const handleSegmentHoverEnd = useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  /** Handle button click - immediate show (Req 8.2) */
  const handleButtonClick = useCallback(
    (segmentId: string) => {
      clearHoverTimer();
      openPopup(segmentId);
    },
    [clearHoverTimer, openPopup]
  );

  /** Close popup (Req 8.8) */
  const closePopup = useCallback(() => {
    clearHoverTimer();
    currentSegmentRef.current = null;
    setState({
      isVisible: false,
      segmentId: null,
      suggestions: [],
      isLoading: false,
      hasError: false,
    });
  }, [clearHoverTimer]);

  /** Handle suggestion selection (Req 8.4) */
  const handleSelect = useCallback(
    (text: string) => {
      if (state.segmentId) {
        onSelect(state.segmentId, text);
        closePopup();
      }
    },
    [state.segmentId, onSelect, closePopup]
  );

  /** Handle edit mode transition (Req 8.6) */
  const handleEditMode = useCallback(() => {
    if (state.segmentId) {
      onEditMode(state.segmentId);
      closePopup();
    }
  }, [state.segmentId, onEditMode, closePopup]);

  return {
    state,
    handleSegmentHoverStart,
    handleSegmentHoverEnd,
    handleButtonClick,
    closePopup,
    handleSelect,
    handleEditMode,
  };
}
