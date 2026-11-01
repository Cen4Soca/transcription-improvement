import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import i18n, { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE } from '../i18n';
import { useLanguage } from './useLanguage';

describe('useLanguage', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    // 各テストの初期状態を ja に固定する
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
    window.localStorage.clear();
  });

  it('現在の言語を正規化して返す（ja のとき ja）', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current.language).toBe('ja');
  });

  it('setLanguage で i18n の言語が変わる', async () => {
    const { result } = renderHook(() => useLanguage());

    await act(async () => {
      result.current.setLanguage('en');
    });

    expect(i18n.language).toBe('en');
    expect(result.current.language).toBe('en');
  });

  it('setLanguage で localStorage に保存される', async () => {
    const { result } = renderHook(() => useLanguage());

    await act(async () => {
      result.current.setLanguage('en');
    });

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('ja に戻すと localStorage も ja になる', async () => {
    const { result } = renderHook(() => useLanguage());

    await act(async () => {
      result.current.setLanguage('en');
    });
    await act(async () => {
      result.current.setLanguage('ja');
    });

    expect(i18n.language).toBe('ja');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ja');
  });
});
