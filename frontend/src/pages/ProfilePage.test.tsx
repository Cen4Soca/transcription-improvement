import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import i18n, { DEFAULT_LANGUAGE } from '../i18n';
import { ProfilePage } from './ProfilePage';

const t = (key: string) => i18n.t(`profile:${key}`);
const tCommon = (key: string) => i18n.t(`common:${key}`);

describe('ProfilePage', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
    user = userEvent.setup();
  });

  afterEach(async () => {
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
    window.localStorage.clear();
  });

  it('renders current display name and email', () => {
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />);

    expect((screen.getByLabelText(t('displayName')) as HTMLInputElement).value).toBe('山田太郎');
    expect((screen.getByLabelText(t('email')) as HTMLInputElement).value).toBe('taro@example.com');
  });

  it('disables save button when nothing has changed', () => {
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: tCommon('save') })).toBeDisabled();
  });

  it('sends only changed fields on save', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const nameInput = screen.getByLabelText(t('displayName'));
    await user.clear(nameInput);
    await user.type(nameInput, '山田次郎');
    await user.click(screen.getByRole('button', { name: tCommon('save') }));

    expect(onSave).toHaveBeenCalledWith({ displayName: '山田次郎' });
  });

  it('shows success message after a successful save', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const emailInput = screen.getByLabelText(t('email'));
    await user.clear(emailInput);
    await user.type(emailInput, 'jiro@example.com');
    await user.click(screen.getByRole('button', { name: tCommon('save') }));

    expect(await screen.findByText(t('updateSuccess'))).toBeInTheDocument();
  });

  it('shows error message when save fails', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ code: 'VALIDATION_ERROR', message: 'このメールアドレスは既に使用されています。' });
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const emailInput = screen.getByLabelText(t('email'));
    await user.clear(emailInput);
    await user.type(emailInput, 'dup@example.com');
    await user.click(screen.getByRole('button', { name: tCommon('save') }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このメールアドレスは既に使用されています。');
  });

  it('shows the display-language section with a language selector', () => {
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />);

    expect(screen.getByRole('heading', { name: t('languageSection') })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: tCommon('language') })).toBeInTheDocument();
  });

  it('calls onLanguageChange and switches UI language when a language is selected', async () => {
    const onLanguageChange = vi.fn();
    render(
      <ProfilePage
        displayName="山田太郎"
        email="taro@example.com"
        onSave={vi.fn()}
        onLanguageChange={onLanguageChange}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: tCommon('language') }), {
      target: { value: 'en' },
    });

    expect(onLanguageChange).toHaveBeenCalledWith('en');
    await vi.waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
