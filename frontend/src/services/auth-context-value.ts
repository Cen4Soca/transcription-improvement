import { createContext } from 'react';
import type { AuthUser } from '../types/auth';

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string>;
  /** Re-fetch the current user's profile (e.g. after a self profile update). */
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);
