import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useKeyboardShortcuts, UseKeyboardShortcutsOptions } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  const onTogglePlayPause = vi.fn();
  const onNextSegment = vi.fn();
  const onPreviousSegment = vi.fn();
  const onUndo = vi.fn();
  const onConfirmEdit = vi.fn();
  const onCancelEdit = vi.fn();
  const onFocusSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderShortcuts(overrides: Partial<UseKeyboardShortcutsOptions> = {}) {
    return renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlayPause,
        onNextSegment,
        onPreviousSegment,
        onUndo,
        onConfirmEdit,
        onCancelEdit,
        onFocusSearch,
        enabled: true,
        ...overrides,
      })
    );
  }

  function fireKeyDown(key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.dispatchEvent(event);
    return event;
  }

  function fireKeyDownOnElement(
    element: HTMLElement,
    key: string,
    options: Partial<KeyboardEventInit> = {}
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    element.dispatchEvent(event);
    return event;
  }

  describe('Space key - play/pause toggle', () => {
    it('should call onTogglePlayPause when Space is pressed', () => {
      renderShortcuts();

      fireKeyDown(' ');

      expect(onTogglePlayPause).toHaveBeenCalledTimes(1);
    });

    it('should not call onTogglePlayPause when Space is pressed in an input element', () => {
      renderShortcuts();

      const input = document.createElement('input');
      document.body.appendChild(input);

      fireKeyDownOnElement(input, ' ');

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('should not call onTogglePlayPause when Space is pressed in a textarea', () => {
      renderShortcuts();

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      fireKeyDownOnElement(textarea, ' ');

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });

    it('should not call onTogglePlayPause when Space is pressed in a contenteditable element', () => {
      renderShortcuts();

      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);

      fireKeyDownOnElement(div, ' ');

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });
  });

  describe('Tab key - segment navigation', () => {
    it('should call onNextSegment when Tab is pressed', () => {
      renderShortcuts();

      fireKeyDown('Tab');

      expect(onNextSegment).toHaveBeenCalledTimes(1);
      expect(onPreviousSegment).not.toHaveBeenCalled();
    });

    it('should call onPreviousSegment when Shift+Tab is pressed', () => {
      renderShortcuts();

      fireKeyDown('Tab', { shiftKey: true });

      expect(onPreviousSegment).toHaveBeenCalledTimes(1);
      expect(onNextSegment).not.toHaveBeenCalled();
    });

    it('should not intercept Tab when user is in an input element', () => {
      renderShortcuts();

      const input = document.createElement('input');
      document.body.appendChild(input);

      fireKeyDownOnElement(input, 'Tab');

      expect(onNextSegment).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('should not intercept Shift+Tab when user is in a textarea', () => {
      renderShortcuts();

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      fireKeyDownOnElement(textarea, 'Tab', { shiftKey: true });

      expect(onPreviousSegment).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });
  });

  describe('Ctrl+Z / Cmd+Z - undo', () => {
    it('should call onUndo when Ctrl+Z is pressed', () => {
      renderShortcuts();

      fireKeyDown('z', { ctrlKey: true });

      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('should call onUndo when Cmd+Z is pressed (Mac)', () => {
      renderShortcuts();

      fireKeyDown('z', { metaKey: true });

      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('should not call onUndo when Shift+Ctrl+Z is pressed (redo, not undo)', () => {
      renderShortcuts();

      fireKeyDown('z', { ctrlKey: true, shiftKey: true });

      expect(onUndo).not.toHaveBeenCalled();
    });

    it('should call preventDefault for Ctrl+Z', () => {
      renderShortcuts();

      const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      fireKeyDown('z', { ctrlKey: true });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Ctrl+Enter / Cmd+Enter - confirm edit', () => {
    it('should call onConfirmEdit when Ctrl+Enter is pressed', () => {
      renderShortcuts();

      fireKeyDown('Enter', { ctrlKey: true });

      expect(onConfirmEdit).toHaveBeenCalledTimes(1);
    });

    it('should call onConfirmEdit when Cmd+Enter is pressed (Mac)', () => {
      renderShortcuts();

      fireKeyDown('Enter', { metaKey: true });

      expect(onConfirmEdit).toHaveBeenCalledTimes(1);
    });

    it('should call preventDefault for Ctrl+Enter', () => {
      renderShortcuts();

      const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      fireKeyDown('Enter', { ctrlKey: true });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Escape - cancel edit', () => {
    it('should call onCancelEdit when Escape is pressed', () => {
      renderShortcuts();

      fireKeyDown('Escape');

      expect(onCancelEdit).toHaveBeenCalledTimes(1);
    });

    it('should call preventDefault for Escape', () => {
      renderShortcuts();

      const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      fireKeyDown('Escape');

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Ctrl+F / Cmd+F - focus search bar', () => {
    it('should call onFocusSearch when Ctrl+F is pressed', () => {
      renderShortcuts();

      fireKeyDown('f', { ctrlKey: true });

      expect(onFocusSearch).toHaveBeenCalledTimes(1);
    });

    it('should call onFocusSearch when Cmd+F is pressed (Mac)', () => {
      renderShortcuts();

      fireKeyDown('f', { metaKey: true });

      expect(onFocusSearch).toHaveBeenCalledTimes(1);
    });

    it('should call preventDefault for Ctrl+F to prevent browser find', () => {
      renderShortcuts();

      const preventDefaultSpy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
      fireKeyDown('f', { ctrlKey: true });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('IME composition handling', () => {
    it('should ignore keyboard shortcuts during IME composition (compositionstart)', () => {
      renderShortcuts();

      document.dispatchEvent(new Event('compositionstart'));

      fireKeyDown(' ');
      fireKeyDown('Tab');
      fireKeyDown('Tab', { shiftKey: true });
      fireKeyDown('z', { ctrlKey: true });
      fireKeyDown('Enter', { ctrlKey: true });
      fireKeyDown('Escape');
      fireKeyDown('f', { ctrlKey: true });

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      expect(onNextSegment).not.toHaveBeenCalled();
      expect(onPreviousSegment).not.toHaveBeenCalled();
      expect(onUndo).not.toHaveBeenCalled();
      expect(onConfirmEdit).not.toHaveBeenCalled();
      expect(onCancelEdit).not.toHaveBeenCalled();
      expect(onFocusSearch).not.toHaveBeenCalled();
    });

    it('should ignore shortcuts when event.isComposing is true', () => {
      renderShortcuts();

      fireKeyDown('z', { ctrlKey: true, isComposing: true } as KeyboardEventInit);

      expect(onUndo).not.toHaveBeenCalled();
    });

    it('should resume keyboard shortcuts after IME composition ends', () => {
      renderShortcuts();

      document.dispatchEvent(new Event('compositionstart'));
      document.dispatchEvent(new Event('compositionend'));

      fireKeyDown(' ');

      expect(onTogglePlayPause).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled option', () => {
    it('should not register event listeners when disabled', () => {
      renderShortcuts({ enabled: false });

      fireKeyDown(' ');
      fireKeyDown('Tab');
      fireKeyDown('z', { ctrlKey: true });
      fireKeyDown('Enter', { ctrlKey: true });
      fireKeyDown('Escape');
      fireKeyDown('f', { ctrlKey: true });

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      expect(onNextSegment).not.toHaveBeenCalled();
      expect(onUndo).not.toHaveBeenCalled();
      expect(onConfirmEdit).not.toHaveBeenCalled();
      expect(onCancelEdit).not.toHaveBeenCalled();
      expect(onFocusSearch).not.toHaveBeenCalled();
    });

    it('should clean up event listeners when disabled after being enabled', () => {
      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useKeyboardShortcuts({
            onTogglePlayPause,
            onNextSegment,
            onPreviousSegment,
            onUndo,
            onConfirmEdit,
            onCancelEdit,
            onFocusSearch,
            enabled,
          }),
        { initialProps: { enabled: true } }
      );

      fireKeyDown(' ');
      expect(onTogglePlayPause).toHaveBeenCalledTimes(1);

      rerender({ enabled: false });

      fireKeyDown(' ');
      expect(onTogglePlayPause).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe('cleanup on unmount', () => {
    it('should remove event listeners on unmount', () => {
      const { unmount } = renderShortcuts();

      unmount();

      fireKeyDown(' ');
      fireKeyDown('Tab');
      fireKeyDown('z', { ctrlKey: true });
      fireKeyDown('Escape');

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      expect(onNextSegment).not.toHaveBeenCalled();
      expect(onUndo).not.toHaveBeenCalled();
      expect(onCancelEdit).not.toHaveBeenCalled();
    });
  });

  describe('optional callbacks', () => {
    it('should not throw when optional callbacks are not provided', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          enabled: true,
        })
      );

      expect(() => {
        fireKeyDown(' ');
        fireKeyDown('Tab');
        fireKeyDown('z', { ctrlKey: true });
        fireKeyDown('Enter', { ctrlKey: true });
        fireKeyDown('Escape');
        fireKeyDown('f', { ctrlKey: true });
      }).not.toThrow();
    });
  });

  describe('unrelated keys', () => {
    it('should not trigger any callback for unrelated keys', () => {
      renderShortcuts();

      fireKeyDown('a');
      fireKeyDown('Enter');
      fireKeyDown('b');

      expect(onTogglePlayPause).not.toHaveBeenCalled();
      expect(onNextSegment).not.toHaveBeenCalled();
      expect(onPreviousSegment).not.toHaveBeenCalled();
      expect(onUndo).not.toHaveBeenCalled();
      expect(onConfirmEdit).not.toHaveBeenCalled();
      expect(onCancelEdit).not.toHaveBeenCalled();
      expect(onFocusSearch).not.toHaveBeenCalled();
    });
  });
});
