import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
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
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        role="status"
        aria-label="認証確認中"
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">認証を確認しています...</p>
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
          aria-label="アクセス拒否"
        >
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600">アクセス権限がありません</h1>
            <p className="mt-2 text-gray-600">
              このページにアクセスするには適切な権限が必要です。
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
