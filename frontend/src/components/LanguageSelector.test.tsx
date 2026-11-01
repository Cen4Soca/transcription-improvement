import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { axe } from 'vitest-axe';
import i18n, { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE } from '../i18n';
import { LanguageSelector } from './LanguageSelector';

describe('LanguageSelector', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
    window.localStorage.clear();
  });

  it('ja / en の選択肢が表示される', () => {
    render(<LanguageSelector />);
    expect(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
  });

  it('セレクタに aria-label（言語）が設定されている', () => {
    render(<LanguageSelector />);
    // 既定(ja)では「言語」
    expect(screen.getByRole('combobox', { name: '言語' })).toBeInTheDocument();
  });

  it('en を選ぶと i18n の言語が変わり localStorage に保存される', async () => {
    render(<LanguageSelector />);

    const select = screen.getByRole('combobox', { name: '言語' });
    fireEvent.change(select, { target: { value: 'en' } });

    // changeLanguage は非同期なので反映を待つ
    await vi.waitFor(() => expect(i18n.language).toBe('en'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('切替時に onChange が選択された言語で呼ばれる', () => {
    const onChange = vi.fn();
    render(<LanguageSelector onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: '言語' });
    fireEvent.change(select, { target: { value: 'en' } });

    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('アクセシビリティ違反がない', async () => {
    const { container } = render(<LanguageSelector />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
