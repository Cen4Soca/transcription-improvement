import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useState, useEffect, useCallback } from 'react';
import type { AuthState } from '../services/auth-context-value';
import type { AuthUser } from '../types/auth';
import type { UserRole } from '../types/user';

/**
 * useAuth - Cognito Hosted UI (OAuth) ベースの認証状態管理フック
 *
 * Amplify SDK が OAuth コード交換を自動処理した後、
 * getCurrentUser / fetchAuthSession でセッション情報を取得する。
 * ロール情報はバックエンドの GET /me エンドポイントから取得。
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      // getCurrentUser throws if not authenticated
      const cognitoUser = await getCurrentUser();
      const email = cognitoUser.signInDetails?.loginId ?? '';

      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      if (!token) {
        setUser(null);
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      // Fetch role from backend /me API
      const apiBaseUrl = (window as unknown as Record<string, string>).__API_ENDPOINT__
        || import.meta.env.VITE_API_ENDPOINT || import.meta.env.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBaseUrl}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const body = await response.json();
        const data = body.data;
        setUser({
          userId: data.userId ?? cognitoUser.userId,
          email: data.email ?? email,
          displayName: data.displayName ?? email,
          role: data.role as UserRole,
        });
        setError(null);
      } else {
        setUser({
          userId: cognitoUser.userId,
          email,
          displayName: email,
          role: 'REVIEWER',
        });
        setError('ユーザー情報の取得に失敗しました');
      }

      setIsAuthenticated(true);
    } catch {
      // Not authenticated
      setUser(null);
      setIsAuthenticated(false);
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await checkAuth();
    })();

    // Listen for auth events (OAuth code exchange completion)
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'tokenRefresh') {
        checkAuth();
      }
      if (payload.event === 'signedOut') {
        setUser(null);
        setIsAuthenticated(false);
      }
    });

    return () => unsubscribe();
  }, [checkAuth]);

  const handleSignOut = useCallback(async () => {
    await amplifySignOut();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const getToken = useCallback(async () => {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  }, []);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    signIn: async () => { /* handled by signInWithRedirect in AuthGate */ },
    signOut: handleSignOut,
    getToken,
    refreshUser: checkAuth,
  };
}
