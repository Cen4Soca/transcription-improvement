import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthProvider, AuthUser } from '../types/auth';
import { AuthContext } from './auth-context-value';
import type { AuthState } from './auth-context-value';
import i18n, { LANGUAGE_STORAGE_KEY, normalizeLanguage } from '../i18n';

/**
 * プロファイルの優先言語で i18n を上書きし、localStorage も同期する。
 * 優先順位（プロファイル > localStorage > ブラウザ > ja）のうち、
 * ログイン後の「プロファイル最優先」を担う。
 */
function applyProfileLanguage(user: AuthUser | null): void {
  const lang = normalizeLanguage(user?.preferredLanguage);
  if (!lang) {
    return;
  }
  if (i18n.language !== lang) {
    void i18n.changeLanguage(lang);
  }
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // localStorage が使えない環境では無視する
  }
}

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
      applyProfileLanguage(currentUser);
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
        if (!cancelled) {
          setUser(currentUser);
          applyProfileLanguage(currentUser);
        }
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
      const message = e instanceof Error ? e.message : i18n.t('common:login.signInFailed');
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
      const message = e instanceof Error ? e.message : i18n.t('common:login.signOutFailed');
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
