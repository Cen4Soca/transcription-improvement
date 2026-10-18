import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineEdit } from './useInlineEdit';

describe('useInlineEdit', () => {
  it('starts with no editing entries', () => {
    const { result } = renderHook(() => useInlineEdit());

    expect(result.current.editingEntries.size).toBe(0);
    expect(result.current.editingCount).toBe(0);
  });

  describe('startEdit (Requirement 2.1)', () => {
    it('adds a segment to editing state with original text', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'テストテキスト');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
      const entry = result.current.editingEntries.get('seg-1');
      expect(entry).toBeDefined();
      expect(entry!.originalText).toBe('テストテキスト');
      expect(entry!.editText).toBe('テストテキスト');
    });

    it('supports multiple segments editing simultaneously (Requirement 2.5)', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'テキスト1');
        result.current.startEdit('seg-2', 'テキスト2');
        result.current.startEdit('seg-3', 'テキスト3');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
      expect(result.current.isEditing('seg-2')).toBe(true);
      expect(result.current.isEditing('seg-3')).toBe(true);
      expect(result.current.editingCount).toBe(3);
    });
  });

  describe('updateEditText', () => {
    it('updates the edit text for an editing segment', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'original');
      });
      act(() => {
        result.current.updateEditText('seg-1', 'updated');
      });

      expect(result.current.editingEntries.get('seg-1')!.editText).toBe('updated');
      // originalText should remain unchanged
      expect(result.current.editingEntries.get('seg-1')!.originalText).toBe('original');
    });

    it('does nothing for a non-editing segment', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.updateEditText('seg-nonexistent', 'text');
      });

      expect(result.current.editingEntries.size).toBe(0);
    });
  });

  describe('confirmEdit (Requirement 2.3, 2.6)', () => {
    it('returns original and new text when text has changed', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'original');
      });
      act(() => {
        result.current.updateEditText('seg-1', 'modified');
      });

      let confirmed: { originalText: string; newText: string } | null = null;
      act(() => {
        confirmed = result.current.confirmEdit('seg-1');
      });

      expect(confirmed).toEqual({ originalText: 'original', newText: 'modified' });
      expect(result.current.isEditing('seg-1')).toBe(false);
    });

    it('returns null when text has not changed (Requirement 2.6)', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'same text');
      });

      let confirmed: { originalText: string; newText: string } | null = null;
      act(() => {
        confirmed = result.current.confirmEdit('seg-1');
      });

      expect(confirmed).toBeNull();
      expect(result.current.isEditing('seg-1')).toBe(false);
    });

    it('returns null for a non-editing segment', () => {
      const { result } = renderHook(() => useInlineEdit());

      let confirmed: { originalText: string; newText: string } | null = null;
      act(() => {
        confirmed = result.current.confirmEdit('seg-nonexistent');
      });

      expect(confirmed).toBeNull();
    });

    it('allows confirming with empty text', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'some text');
      });
      act(() => {
        result.current.updateEditText('seg-1', '');
      });

      let confirmed: { originalText: string; newText: string } | null = null;
      act(() => {
        confirmed = result.current.confirmEdit('seg-1');
      });

      expect(confirmed).toEqual({ originalText: 'some text', newText: '' });
    });
  });

  describe('cancelEdit (Requirement 2.4)', () => {
    it('removes segment from editing state', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'original');
      });
      act(() => {
        result.current.cancelEdit('seg-1');
      });

      expect(result.current.isEditing('seg-1')).toBe(false);
      expect(result.current.editingCount).toBe(0);
    });

    it('does not affect other editing segments', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'text 1');
        result.current.startEdit('seg-2', 'text 2');
      });
      act(() => {
        result.current.cancelEdit('seg-1');
      });

      expect(result.current.isEditing('seg-1')).toBe(false);
      expect(result.current.isEditing('seg-2')).toBe(true);
      expect(result.current.editingCount).toBe(1);
    });

    it('does nothing for a non-editing segment', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'text');
      });
      act(() => {
        result.current.cancelEdit('seg-nonexistent');
      });

      expect(result.current.editingCount).toBe(1);
    });
  });

  describe('isEditing', () => {
    it('returns true for editing segments', () => {
      const { result } = renderHook(() => useInlineEdit());

      act(() => {
        result.current.startEdit('seg-1', 'text');
      });

      expect(result.current.isEditing('seg-1')).toBe(true);
    });

    it('returns false for non-editing segments', () => {
      const { result } = renderHook(() => useInlineEdit());

      expect(result.current.isEditing('seg-1')).toBe(false);
    });
  });
});
