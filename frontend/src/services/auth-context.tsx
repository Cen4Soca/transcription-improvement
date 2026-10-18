import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthProvider, AuthUser } from '../types/auth';
import { AuthContext } from './auth-context-value';
import type { AuthState } from './auth-context-value';

interface AuthContextProviderProps {
  authProvider: AuthProvider;
  children: ReactNode;
}

/**
 * AuthContextProvider - 認証状態をアプリ全体に提供する React Context Provider
 */
export function AuthContextProvider({ authProvider, children }: AuthContextProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const currentUser = await authProvider.getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [authProvider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const currentUser = await authProvider.getCurrentUser();
        if (!cancelled) setUser(currentUser);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authProvider]);

  const signIn = useCallback(async () => {
    try {
      setError(null);
      await authProvider.signIn();
      await checkAuth();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'ログインに失敗しました';
      setError(message);
      throw e;
    }
  }, [authProvider, checkAuth]);

  const signOut = useCallback(async () => {
    try {
      setError(null);
      await authProvider.signOut();
      setUser(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'ログアウトに失敗しました';
      setError(message);
      throw e;
    }
  }, [authProvider]);

  const getToken = useCallback(async () => {
    return authProvider.getToken();
  }, [authProvider]);

  const value: AuthState = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    error,
    signIn,
    signOut,
    getToken,
    refreshUser: checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
