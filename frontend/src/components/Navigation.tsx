import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { UserRole } from '../types/user';
import { LanguageSelector } from './LanguageSelector';
import type { SupportedLanguage } from '../i18n';

interface NavItem {
  to: string;
  /** Translation key in the `navigation` namespace. */
  labelKey: string;
  /** If set, only these roles can see the link */
  allowedRoles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'sessionList' },
  { to: '/assigned', labelKey: 'myTasks' },
  { to: '/joinable', labelKey: 'joinableSessions' },
  { to: '/upload', labelKey: 'mediaUpload' },
  { to: '/language-models', labelKey: 'languageModels', allowedRoles: ['ADMIN', 'TEAM_LEADER'] },
  { to: '/ranking', labelKey: 'ranking' },
  { to: '/admin', labelKey: 'admin', allowedRoles: ['ADMIN'] },
];

export interface NavigationProps {
  userRole?: UserRole;
  /** Display name of the currently authenticated user */
  displayName?: string;
  /** Called when the user clicks the logout button */
  onLogout?: () => void;
  /**
   * 言語セレクタで言語が変更されたときに呼ばれる。
   * ログイン時のみプロファイルへ永続化するために使用する。
   */
  onLanguageChange?: (lng: SupportedLanguage) => void;
}

/**
 * Navigation - アプリケーション共通ナビゲーションメニュー
 *
 * - 全ユーザー向けリンク: セッション一覧、メディアアップロード、ランキング
 * - Admin/TeamLeader 向け: 言語モデル管理
 * - Admin 向け: 管理
 * - 右端にユーザー表示名とログアウトボタンを表示
 *
 * Requirements: 2.1, 6.1, 7.1
 */
export function Navigation({ userRole, displayName, onLogout, onLanguageChange }: NavigationProps) {
  const { t } = useTranslation('common');
  const { t: tNav } = useTranslation('navigation');
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.allowedRoles) return true;
    if (!userRole) return false;
    return item.allowedRoles.includes(userRole);
  });

  return (
    <nav className="bg-white border-b border-gray-200" aria-label={tNav('ariaLabel')}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          <span className="text-sm font-semibold text-gray-900 mr-6">
            Transcription Review
          </span>
          <ul className="flex items-center gap-1" role="menubar">
            {visibleItems.map((item) => (
              <li key={item.to} role="none">
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  role="menuitem"
                  className={({ isActive }) =>
                    `px-3 py-2 text-sm rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`
                  }
                >
                  {tNav(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSelector onChange={onLanguageChange} />
            {onLogout && (
              <>
                {displayName && (
                  <NavLink
                    to="/profile"
                    className={({ isActive }) =>
                      `text-sm rounded-md px-2 py-1 transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                      }`
                    }
                    data-testid="nav-display-name"
                  >
                    {displayName}
                  </NavLink>
                )}
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-3 py-2 text-sm rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                >
                  {t('logout')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
