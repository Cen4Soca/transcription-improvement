import { NavLink } from 'react-router-dom';
import type { UserRole } from '../types/user';

interface NavItem {
  to: string;
  label: string;
  /** If set, only these roles can see the link */
  allowedRoles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'セッション一覧' },
  { to: '/assigned', label: '自分のタスク' },
  { to: '/joinable', label: '参加可能なセッション' },
  { to: '/upload', label: 'メディアアップロード' },
  { to: '/language-models', label: '言語モデル管理', allowedRoles: ['ADMIN', 'TEAM_LEADER'] },
  { to: '/ranking', label: 'ランキング' },
  { to: '/admin', label: '管理', allowedRoles: ['ADMIN'] },
];

export interface NavigationProps {
  userRole?: UserRole;
  /** Display name of the currently authenticated user */
  displayName?: string;
  /** Called when the user clicks the logout button */
  onLogout?: () => void;
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
export function Navigation({ userRole, displayName, onLogout }: NavigationProps) {
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.allowedRoles) return true;
    if (!userRole) return false;
    return item.allowedRoles.includes(userRole);
  });

  return (
    <nav className="bg-white border-b border-gray-200" aria-label="メインナビゲーション">
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
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {onLogout && (
            <div className="ml-auto flex items-center gap-3">
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
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
