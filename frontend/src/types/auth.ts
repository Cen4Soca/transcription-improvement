import type { UserRole } from './user';

/**
 * AuthUser - 認証済みユーザー情報
 */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
}

/**
 * AuthProvider - 認証プロバイダーインターフェース
 * Cognito → IAM Identity Center 移行に対応するための抽象化レイヤー
 *
 * 現在: CognitoAuthProvider implements AuthProvider
 * 将来: IAMIdentityCenterAuthProvider implements AuthProvider
 */
export interface AuthProvider {
  getToken(): Promise<string>;
  getCurrentUser(): Promise<AuthUser>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
