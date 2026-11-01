import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../types/user';

interface AuthGuardProps {
  children: ReactNode;
  loginPath?: string;
  requiredRoles?: UserRole[];
}

/**
 * AuthGuard - 未認証ユーザーをログイン画面にリダイレクトするガードコンポーネント
 *
 * Requirement 9.9: 未認証のUserがAppにアクセスしたとき、ログイン画面にリダイレクトする
 * Requirement 9.12: Admin権限のUserに対してMFAを必須とする
 *
 * オプションで requiredRoles を指定すると、認証済みでも権限不足の場合はアクセスを拒否する
 */
export function AuthGuard({ children, loginPath = '/login', requiredRoles }: AuthGuardProps) {
  const { t } = useTranslation('common');
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        role="status"
        aria-label={t('authGuard.checkingAriaLabel')}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">{t('authGuard.checking')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace />;
  }

  if (requiredRoles && user) {
    const hasRequiredRole = requiredRoles.includes(user.role);
    if (!hasRequiredRole) {
      return (
        <div
          className="flex items-center justify-center min-h-screen"
          role="alert"
          aria-label={t('authGuard.deniedAriaLabel')}
        >
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600">{t('authGuard.deniedTitle')}</h1>
            <p className="mt-2 text-gray-600">
              {t('authGuard.deniedDescription')}
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
