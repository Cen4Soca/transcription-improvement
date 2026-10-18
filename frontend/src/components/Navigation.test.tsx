import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Navigation } from './Navigation';

function renderNavigation(userRole?: 'ADMIN' | 'TEAM_LEADER' | 'REVIEWER') {
  return render(
    <MemoryRouter>
      <Navigation userRole={userRole} />
    </MemoryRouter>,
  );
}

describe('Navigation', () => {
  test('全ユーザー向けリンクが表示される（Reviewer）', () => {
    renderNavigation('REVIEWER');

    expect(screen.getByRole('menuitem', { name: 'セッション一覧' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'メディアアップロード' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ランキング' })).toBeInTheDocument();
  });

  test('Reviewer には言語モデル管理リンクが表示されない', () => {
    renderNavigation('REVIEWER');

    expect(screen.queryByRole('menuitem', { name: '言語モデル管理' })).not.toBeInTheDocument();
  });

  test('Admin には言語モデル管理リンクが表示される', () => {
    renderNavigation('ADMIN');

    expect(screen.getByRole('menuitem', { name: '言語モデル管理' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '管理' })).toBeInTheDocument();
  });

  test('TeamLeader には言語モデル管理リンクが表示される', () => {
    renderNavigation('TEAM_LEADER');

    expect(screen.getByRole('menuitem', { name: '言語モデル管理' })).toBeInTheDocument();
  });

  test('TeamLeader には管理リンクが表示されない', () => {
    renderNavigation('TEAM_LEADER');

    expect(screen.queryByRole('menuitem', { name: '管理' })).not.toBeInTheDocument();
  });

  test('メディアアップロードリンクが /upload に遷移する', () => {
    renderNavigation('REVIEWER');

    const uploadLink = screen.getByRole('menuitem', { name: 'メディアアップロード' });
    expect(uploadLink).toHaveAttribute('href', '/upload');
  });

  test('言語モデル管理リンクが /language-models に遷移する', () => {
    renderNavigation('ADMIN');

    const modelLink = screen.getByRole('menuitem', { name: '言語モデル管理' });
    expect(modelLink).toHaveAttribute('href', '/language-models');
  });

  test('ナビゲーションに aria-label が設定されている', () => {
    renderNavigation('REVIEWER');

    expect(screen.getByRole('navigation', { name: 'メインナビゲーション' })).toBeInTheDocument();
  });

  test('onLogout 未指定時はログアウトボタンが表示されない', () => {
    renderNavigation('REVIEWER');

    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
  });

  test('onLogout 指定時にログアウトボタンと表示名が表示される', () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <Navigation userRole="REVIEWER" displayName="山田太郎" onLogout={onLogout} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-display-name')).toHaveTextContent('山田太郎');
  });

  test('ログアウトボタンをクリックすると onLogout が呼ばれる', () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <Navigation userRole="REVIEWER" displayName="山田太郎" onLogout={onLogout} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test('アクセシビリティ違反がない（ログアウトボタン含む）', async () => {
    const { container } = render(
      <MemoryRouter>
        <Navigation userRole="ADMIN" displayName="山田太郎" onLogout={vi.fn()} />
      </MemoryRouter>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
