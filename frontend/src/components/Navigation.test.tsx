import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from 'vitest-axe';
import i18n, { DEFAULT_LANGUAGE } from '../i18n';
import { Navigation } from './Navigation';

// 翻訳キー経由で期待値を得る（デフォルト ja なので表示は従来どおり日本語）。
const nav = (key: string) => i18n.t(`navigation:${key}`);
const common = (key: string) => i18n.t(`common:${key}`);

beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
  window.localStorage.clear();
});

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

    expect(screen.getByRole('menuitem', { name: nav('sessionList') })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: nav('mediaUpload') })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: nav('ranking') })).toBeInTheDocument();
  });

  test('Reviewer には言語モデル管理リンクが表示されない', () => {
    renderNavigation('REVIEWER');

    expect(screen.queryByRole('menuitem', { name: nav('languageModels') })).not.toBeInTheDocument();
  });

  test('Admin には言語モデル管理リンクが表示される', () => {
    renderNavigation('ADMIN');

    expect(screen.getByRole('menuitem', { name: nav('languageModels') })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: nav('admin') })).toBeInTheDocument();
  });

  test('TeamLeader には言語モデル管理リンクが表示される', () => {
    renderNavigation('TEAM_LEADER');

    expect(screen.getByRole('menuitem', { name: nav('languageModels') })).toBeInTheDocument();
  });

  test('TeamLeader には管理リンクが表示されない', () => {
    renderNavigation('TEAM_LEADER');

    expect(screen.queryByRole('menuitem', { name: nav('admin') })).not.toBeInTheDocument();
  });

  test('メディアアップロードリンクが /upload に遷移する', () => {
    renderNavigation('REVIEWER');

    const uploadLink = screen.getByRole('menuitem', { name: nav('mediaUpload') });
    expect(uploadLink).toHaveAttribute('href', '/upload');
  });

  test('言語モデル管理リンクが /language-models に遷移する', () => {
    renderNavigation('ADMIN');

    const modelLink = screen.getByRole('menuitem', { name: nav('languageModels') });
    expect(modelLink).toHaveAttribute('href', '/language-models');
  });

  test('ナビゲーションに aria-label が設定されている', () => {
    renderNavigation('REVIEWER');

    expect(screen.getByRole('navigation', { name: nav('ariaLabel') })).toBeInTheDocument();
  });

  test('onLogout 未指定時はログアウトボタンが表示されない', () => {
    renderNavigation('REVIEWER');

    expect(screen.queryByRole('button', { name: common('logout') })).not.toBeInTheDocument();
  });

  test('onLogout 指定時にログアウトボタンと表示名が表示される', () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <Navigation userRole="REVIEWER" displayName="山田太郎" onLogout={onLogout} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: common('logout') })).toBeInTheDocument();
    expect(screen.getByTestId('nav-display-name')).toHaveTextContent('山田太郎');
  });

  test('ログアウトボタンをクリックすると onLogout が呼ばれる', () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <Navigation userRole="REVIEWER" displayName="山田太郎" onLogout={onLogout} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: common('logout') }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test('言語セレクタが表示される（ログイン状態に依存しない）', () => {
    renderNavigation('REVIEWER');
    expect(screen.getByRole('combobox', { name: common('language') })).toBeInTheDocument();
  });

  test('言語を切り替えると onLanguageChange が呼ばれる', () => {
    const onLanguageChange = vi.fn();
    render(
      <MemoryRouter>
        <Navigation userRole="REVIEWER" onLanguageChange={onLanguageChange} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('combobox', { name: common('language') }), {
      target: { value: 'en' },
    });
    expect(onLanguageChange).toHaveBeenCalledWith('en');
  });

  test('英語に切り替えるとリンクラベルが英語になる', async () => {
    renderNavigation('ADMIN');
    await i18n.changeLanguage('en');

    expect(
      screen.getByRole('menuitem', { name: i18n.t('navigation:admin') })
    ).toBeInTheDocument();
    // en リソースの実値も確認
    expect(screen.getByRole('menuitem', { name: 'Admin' })).toBeInTheDocument();
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
