import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('renders current display name and email', () => {
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />);

    expect((screen.getByLabelText('表示名') as HTMLInputElement).value).toBe('山田太郎');
    expect((screen.getByLabelText('メールアドレス') as HTMLInputElement).value).toBe('taro@example.com');
  });

  it('disables save button when nothing has changed', () => {
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('sends only changed fields on save', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const nameInput = screen.getByLabelText('表示名');
    await user.clear(nameInput);
    await user.type(nameInput, '山田次郎');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledWith({ displayName: '山田次郎' });
  });

  it('shows success message after a successful save', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const emailInput = screen.getByLabelText('メールアドレス');
    await user.clear(emailInput);
    await user.type(emailInput, 'jiro@example.com');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('プロファイルを更新しました。')).toBeInTheDocument();
  });

  it('shows error message when save fails', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ code: 'VALIDATION_ERROR', message: 'このメールアドレスは既に使用されています。' });
    render(<ProfilePage displayName="山田太郎" email="taro@example.com" onSave={onSave} />);

    const emailInput = screen.getByLabelText('メールアドレス');
    await user.clear(emailInput);
    await user.type(emailInput, 'dup@example.com');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('このメールアドレスは既に使用されています。');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ProfilePage displayName="山田太郎" email="taro@example.com" onSave={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
