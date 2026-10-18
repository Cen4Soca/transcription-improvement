import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Segment } from '../types/segment';
import { searchSegments, filterUncorrectedSegments } from '../utils/search';

export interface UseSearchReturn {
  keyword: string;
  setKeyword: (keyword: string) => void;
  results: Segment[];
  matchCount: number;
  isSearching: boolean;
  showUncorrectedOnly: boolean;
  setShowUncorrectedOnly: (value: boolean) => void;
}

/**
 * useSearch - Custom hook for searching segments with debounce.
 * Debounces keyword changes by 300ms before executing search.
 * Supports uncorrected-only filter.
 *
 * Requirements: 6.1, 6.2, 6.4
 */
export function useSearch(
  segments: Segment[],
  correctedSegmentIds: Set<string>
): UseSearchReturn {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [showUncorrectedOnly, setShowUncorrectedOnly] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Searching is true while the live keyword differs from the debounced one.
  const isSearching = keyword !== debouncedKeyword;

  // Debounce keyword changes by 300ms
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setDebouncedKeyword(keyword);
    }, 300);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [keyword, debouncedKeyword]);

  const handleSetKeyword = useCallback((value: string) => {
    setKeyword(value);
  }, []);

  const handleSetShowUncorrectedOnly = useCallback((value: boolean) => {
    setShowUncorrectedOnly(value);
  }, []);

  // Compute results based on debounced keyword and filters
  const results = useMemo(() => {
    let filtered = segments;

    if (showUncorrectedOnly) {
      filtered = filterUncorrectedSegments(filtered, correctedSegmentIds);
    }

    if (debouncedKeyword !== '') {
      filtered = searchSegments(filtered, debouncedKeyword);
    }

    return filtered;
  }, [segments, debouncedKeyword, showUncorrectedOnly, correctedSegmentIds]);

  const matchCount = useMemo(() => {
    if (debouncedKeyword === '') {
      return segments.length;
    }
    return results.length;
  }, [debouncedKeyword, results.length, segments.length]);

  return {
    keyword,
    setKeyword: handleSetKeyword,
    results,
    matchCount,
    isSearching,
    showUncorrectedOnly,
    setShowUncorrectedOnly: handleSetShowUncorrectedOnly,
  };
}
