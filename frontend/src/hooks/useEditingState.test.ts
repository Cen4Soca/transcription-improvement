import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditingState } from './useEditingState';

describe('useEditingState', () => {
  it('starts with no editing segments', () => {
    const { result } = renderHook(() => useEditingState());

    expect(result.current.editingSegments.size).toBe(0);
  });

  describe('startEditing', () => {
    it('adds a segment to editing state', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'original text');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
      expect(result.current.editingSegments.get('seg-1')).toBe('original text');
    });

    it('supports multiple segments editing simultaneously (Requirement 2.5)', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'text 1');
        result.current.startEditing('seg-2', 'text 2');
        result.current.startEditing('seg-3', 'text 3');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
      expect(result.current.isEditing('seg-2')).toBe(true);
      expect(result.current.isEditing('seg-3')).toBe(true);
      expect(result.current.editingSegments.size).toBe(3);
    });
  });

  describe('updateText', () => {
    it('updates the text for an editing segment', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'original');
      });
      act(() => {
        result.current.updateText('seg-1', 'updated');
      });

      expect(result.current.editingSegments.get('seg-1')).toBe('updated');
    });

    it('does nothing for a non-editing segment', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.updateText('seg-nonexistent', 'text');
      });

      expect(result.current.editingSegments.size).toBe(0);
    });
  });

  describe('confirmEdit', () => {
    it('returns the current text and removes segment from editing state', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'original');
      });
      act(() => {
        result.current.updateText('seg-1', 'modified');
      });

      let confirmedText: string | null = null;
      act(() => {
        confirmedText = result.current.confirmEdit('seg-1');
      });

      expect(confirmedText).toBe('modified');
      expect(result.current.isEditing('seg-1')).toBe(false);
    });

    it('returns null for a non-editing segment', () => {
      const { result } = renderHook(() => useEditingState());

      let confirmedText: string | null = null;
      act(() => {
        confirmedText = result.current.confirmEdit('seg-nonexistent');
      });

      expect(confirmedText).toBeNull();
    });
  });

  describe('cancelEdit', () => {
    it('removes segment from editing state', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'original');
      });
      act(() => {
        result.current.cancelEdit('seg-1');
      });

      expect(result.current.isEditing('seg-1')).toBe(false);
      expect(result.current.editingSegments.size).toBe(0);
    });

    it('does nothing for a non-editing segment', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'text');
      });
      act(() => {
        result.current.cancelEdit('seg-nonexistent');
      });

      expect(result.current.editingSegments.size).toBe(1);
    });
  });

  describe('isEditing', () => {
    it('returns true for editing segments', () => {
      const { result } = renderHook(() => useEditingState());

      act(() => {
        result.current.startEditing('seg-1', 'text');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
    });

    it('returns false for non-editing segments', () => {
      const { result } = renderHook(() => useEditingState());

      expect(result.current.isEditing('seg-1')).toBe(false);
    });
  });
});
