import { describe, it, expect } from 'vitest';
import { SearchNavigator } from './search-navigator';

describe('SearchNavigator', () => {
  describe('initial state', () => {
    it('starts with currentIndex -1', () => {
      const nav = new SearchNavigator();
      expect(nav.getCurrentIndex()).toBe(-1);
    });

    it('starts with matchCount 0', () => {
      const nav = new SearchNavigator();
      expect(nav.getMatchCount()).toBe(0);
    });
  });

  describe('setMatchCount', () => {
    it('updates the match count', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(5);
      expect(nav.getMatchCount()).toBe(5);
    });

    it('resets currentIndex to -1 when count is 0', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next(); // index = 0
      nav.setMatchCount(0);
      expect(nav.getCurrentIndex()).toBe(-1);
    });

    it('clamps currentIndex when new count is smaller', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(5);
      nav.next(); // 0
      nav.next(); // 1
      nav.next(); // 2
      nav.next(); // 3
      nav.setMatchCount(2);
      expect(nav.getCurrentIndex()).toBe(0);
    });

    it('keeps currentIndex when new count is larger', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next(); // 0
      nav.next(); // 1
      nav.setMatchCount(10);
      expect(nav.getCurrentIndex()).toBe(1);
    });
  });

  describe('next', () => {
    it('returns -1 when matchCount is 0', () => {
      const nav = new SearchNavigator();
      expect(nav.next()).toBe(-1);
    });

    it('moves from -1 to 0 on first call', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      expect(nav.next()).toBe(0);
    });

    it('increments index sequentially', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      expect(nav.next()).toBe(0);
      expect(nav.next()).toBe(1);
      expect(nav.next()).toBe(2);
    });

    it('wraps from last to first (circular navigation)', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next(); // 0
      nav.next(); // 1
      nav.next(); // 2
      expect(nav.next()).toBe(0);
    });

    it('works with single match', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(1);
      expect(nav.next()).toBe(0);
      expect(nav.next()).toBe(0);
    });
  });

  describe('previous', () => {
    it('returns -1 when matchCount is 0', () => {
      const nav = new SearchNavigator();
      expect(nav.previous()).toBe(-1);
    });

    it('wraps from initial state to last match', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      expect(nav.previous()).toBe(2);
    });

    it('decrements index sequentially', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next(); // 0
      nav.next(); // 1
      nav.next(); // 2
      expect(nav.previous()).toBe(1);
      expect(nav.previous()).toBe(0);
    });

    it('wraps from first to last (circular navigation)', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next(); // 0
      expect(nav.previous()).toBe(2);
    });

    it('works with single match', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(1);
      expect(nav.previous()).toBe(0);
      expect(nav.previous()).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets currentIndex to -1', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(5);
      nav.next();
      nav.next();
      nav.reset();
      expect(nav.getCurrentIndex()).toBe(-1);
    });

    it('resets matchCount to 0', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(5);
      nav.reset();
      expect(nav.getMatchCount()).toBe(0);
    });

    it('next returns -1 after reset', () => {
      const nav = new SearchNavigator();
      nav.setMatchCount(3);
      nav.next();
      nav.reset();
      expect(nav.next()).toBe(-1);
    });
  });

  describe('circular navigation completeness', () => {
    it('next N times returns to start position', () => {
      const nav = new SearchNavigator();
      const count = 5;
      nav.setMatchCount(count);
      nav.next(); // start at 0
      for (let i = 0; i < count; i++) {
        nav.next();
      }
      expect(nav.getCurrentIndex()).toBe(0);
    });

    it('previous N times returns to start position', () => {
      const nav = new SearchNavigator();
      const count = 5;
      nav.setMatchCount(count);
      nav.previous(); // start at last (4)
      for (let i = 0; i < count; i++) {
        nav.previous();
      }
      expect(nav.getCurrentIndex()).toBe(4);
    });
  });
});
