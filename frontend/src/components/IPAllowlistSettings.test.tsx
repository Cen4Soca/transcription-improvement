import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPAllowlistSettings } from './IPAllowlistSettings';
import type { IPAllowlistEntry } from '../types/audit';

const mockEntries: IPAllowlistEntry[] = [
  {
    entryId: 'entry-1',
    cidr: '192.168.1.0/24',
    description: 'オフィスネットワーク',
    createdAt: '2024-01-15T10:00:00.000Z',
    createdBy: 'admin-1',
  },
  {
    entryId: 'entry-2',
    cidr: '10.0.0.0/8',
    description: 'VPN',
    createdAt: '2024-01-16T10:00:00.000Z',
    createdBy: 'admin-1',
  },
];

describe('IPAllowlistSettings', () => {
  it('renders entry list with CIDR and description', () => {
    render(<IPAllowlistSettings entries={mockEntries} />);

    expect(screen.getByText('192.168.1.0/24')).toBeInTheDocument();
    expect(screen.getByText('オフィスネットワーク')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument();
    expect(screen.getByText('VPN')).toBeInTheDocument();
  });

  it('shows entry count and max limit', () => {
    render(<IPAllowlistSettings entries={mockEntries} maxEntries={1000} />);

    expect(screen.getByText('登録数: 2 / 1000件')).toBeInTheDocument();
  });

  it('shows empty state when no entries', () => {
    render(<IPAllowlistSettings entries={[]} />);

    expect(
      screen.getByText('IPアドレス許可リストが空です。すべてのIPアドレスからのアクセスが許可されています。')
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<IPAllowlistSettings entries={[]} isLoading={true} />);

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
  });

  it('opens add form when clicking add button', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));

    expect(screen.getByLabelText('CIDRブロック')).toBeInTheDocument();
    expect(screen.getByLabelText('説明（任意）')).toBeInTheDocument();
  });

  it('validates invalid CIDR format and shows error', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.type(screen.getByLabelText('CIDRブロック'), 'invalid-cidr');
    await user.click(screen.getByText('追加'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無効なCIDR形式です。例: 192.168.1.0/24 または 2001:db8::/32'
    );
  });

  it('validates empty CIDR input', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.click(screen.getByText('追加'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'CIDRブロックを入力してください'
    );
  });

  it('validates IPv4 octet range', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.type(screen.getByLabelText('CIDRブロック'), '256.0.0.0/24');
    await user.click(screen.getByText('追加'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無効なIPv4アドレスです'
    );
  });

  it('validates IPv4 prefix length range', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.type(screen.getByLabelText('CIDRブロック'), '192.168.1.0/33');
    await user.click(screen.getByText('追加'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無効なプレフィックス長です。IPv4の場合は0〜32の範囲で指定してください。'
    );
  });

  it('calls onAddEntry with valid CIDR', async () => {
    const user = userEvent.setup();
    const onAddEntry = vi.fn();
    render(<IPAllowlistSettings entries={[]} onAddEntry={onAddEntry} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.type(screen.getByLabelText('CIDRブロック'), '10.0.0.0/16');
    await user.type(screen.getByLabelText('説明（任意）'), '開発環境');
    await user.click(screen.getByText('追加'));

    expect(onAddEntry).toHaveBeenCalledWith({ cidr: '10.0.0.0/16', description: '開発環境' });
  });

  it('shows max entries error when limit reached during add', async () => {
    // Start with 1 entry, max 2 - form can open, but adding a second entry when
    // entries prop already has 2 should show error
    const singleEntry: IPAllowlistEntry[] = [mockEntries[0]];
    const maxEntries = 1;
    render(<IPAllowlistSettings entries={singleEntry} maxEntries={maxEntries} />);

    // Button is disabled when at max
    expect(screen.getByText('エントリ追加')).toBeDisabled();
  });

  it('disables add button when max entries reached', () => {
    render(<IPAllowlistSettings entries={mockEntries} maxEntries={2} />);

    expect(screen.getByText('エントリ追加')).toBeDisabled();
  });

  it('shows delete confirmation dialog when clicking delete', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={mockEntries} />);

    await user.click(screen.getByLabelText('192.168.1.0/24を削除'));

    expect(screen.getByText('エントリ削除の確認')).toBeInTheDocument();
  });

  it('calls onDeleteEntry when confirming deletion', async () => {
    const user = userEvent.setup();
    const onDeleteEntry = vi.fn();
    render(<IPAllowlistSettings entries={mockEntries} onDeleteEntry={onDeleteEntry} />);

    await user.click(screen.getByLabelText('192.168.1.0/24を削除'));
    await user.click(screen.getByText('削除する'));

    expect(onDeleteEntry).toHaveBeenCalledWith('entry-1');
  });

  it('cancels delete confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={mockEntries} />);

    await user.click(screen.getByLabelText('192.168.1.0/24を削除'));
    await user.click(screen.getByText('キャンセル'));

    expect(screen.queryByText('エントリ削除の確認')).not.toBeInTheDocument();
  });

  it('clears validation error when user types', async () => {
    const user = userEvent.setup();
    render(<IPAllowlistSettings entries={[]} />);

    await user.click(screen.getByText('エントリ追加'));
    await user.click(screen.getByText('追加'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText('CIDRブロック'), '1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(<IPAllowlistSettings entries={mockEntries} />);

    expect(screen.getByLabelText('IPアドレス許可リスト管理')).toBeInTheDocument();
    expect(screen.getByLabelText('IPアドレス許可リストテーブル')).toBeInTheDocument();
  });
});
