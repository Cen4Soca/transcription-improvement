import { Amplify } from 'aws-amplify';
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  confirmSignIn,
  setUpTOTP,
  verifyTOTPSetup,
} from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import type { AuthProvider, AuthUser } from '../types/auth';
import type { UserRole } from '../types/user';

export interface CognitoConfig {
  userPoolId: string;
  userPoolClientId: string;
  region?: string;
  loginWith?: {
    oauth?: {
      domain: string;
      scopes: string[];
      redirectSignIn: string[];
      redirectSignOut: string[];
      responseType: 'code' | 'token';
    };
  };
}

/**
 * MFA challenge types returned by Amplify during sign-in
 */
export type MfaChallengeType = 'TOTP_SETUP' | 'TOTP_CODE';

/**
 * MFA setup result containing the shared secret for TOTP configuration
 */
export interface MfaSetupResult {
  sharedSecret: string;
  getSetupUri: (appName: string, accountName: string) => URL;
}

/**
 * Sign-in result that may require MFA challenge completion
 */
export interface SignInResult {
  isSignedIn: boolean;
  nextStep?: {
    signInStep: string;
    challengeType?: MfaChallengeType;
  };
}

/**
 * InMemoryKeyValueStorage - Amplify v6 用のインメモリストレージアダプター
 *
 * JWT トークンをメモリ（JavaScript 変数）に保持し、
 * localStorage・sessionStorage・Cookie には保存しない（Requirement 14.19）
 *
 * RefreshToken は Cognito SDK のセキュアストレージ（このインメモリストレージ）に保持する。
 * ページリロード時は RefreshToken が失われるため再認証が必要になるが、
 * セキュリティ要件を優先する設計。
 */
export class InMemoryKeyValueStorage {
  private storage: Map<string, string> = new Map();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.storage.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  removeItem(key: string): Promise<void> {
    this.storage.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.storage.clear();
    return Promise.resolve();
  }
}

/**
 * CognitoAuthProvider - Amazon Cognito User Pools を使用した認証プロバイダー
 * AuthProvider インターフェースに準拠し、将来の IAM Identity Center 移行に対応
 *
 * セキュリティ要件:
 * - JWT トークンはメモリ保持のみ（localStorage/sessionStorage/Cookie 不使用）
 * - RefreshToken は Cognito SDK セキュアストレージ（インメモリ）に保持
 * - MFA: Admin は必須、Reviewer/TeamLeader はオプション（TOTP）
 */
export class CognitoAuthProvider implements AuthProvider {
  private inMemoryStorage: InMemoryKeyValueStorage;

  constructor(config: CognitoConfig) {
    this.inMemoryStorage = new InMemoryKeyValueStorage();

    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
          ...(config.loginWith && { loginWith: config.loginWith }),
        },
      },
    });

    // Configure token provider to use in-memory storage
    // This ensures JWT tokens are never persisted to localStorage/sessionStorage/Cookie
    cognitoUserPoolsTokenProvider.setKeyValueStorage(this.inMemoryStorage);
  }

  /**
   * getToken - 現在のセッションから JWT トークンを取得
   * トークンはメモリ内にのみ保持される
   */
  async getToken(): Promise<string> {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) {
      throw new Error('認証トークンを取得できませんでした');
    }
    return token;
  }

  /**
   * getCurrentUser - 現在認証済みのユーザー情報を取得
   * バックエンドの GET /me エンドポイントからロールと表示名を取得する。
   * 共有 Cognito User Pool には custom:role 属性がないため、
   * DynamoDB に保存されたロール情報を使用する。
   */
  async getCurrentUser(): Promise<AuthUser> {
    const user = await getCurrentUser();
    const attributes = await fetchUserAttributes();
    const email = attributes['email'] ?? '';

    // Fetch role from backend API
    try {
      const token = await this.getToken();
      const apiBaseUrl = (window as unknown as Record<string, string>).__API_ENDPOINT__
        || import.meta.env.VITE_API_ENDPOINT || import.meta.env.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBaseUrl}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const body = await response.json();
        const data = body.data;
        return {
          userId: data.userId ?? user.userId,
          email: data.email ?? email,
          displayName: data.displayName ?? email,
          role: data.role as UserRole,
        };
      }
    } catch {
      // Fall through to default
    }

    return {
      userId: user.userId,
      email,
      displayName: email,
      role: 'REVIEWER',
    };
  }

  /**
   * signIn - AuthProvider インターフェース準拠のサインイン
   * 詳細な結果が必要な場合は signInWithResult を使用
   */
  async signIn(): Promise<void> {
    await this.signInWithResult();
  }

  /**
   * signInWithResult - ユーザーのサインインを開始し詳細な結果を返す
   * MFA チャレンジが必要な場合は nextStep 情報を含む結果を返す
   */
  async signInWithResult(username?: string, password?: string): Promise<SignInResult> {
    const result = await amplifySignIn({
      username: username ?? '',
      password: password ?? '',
    });

    return {
      isSignedIn: result.isSignedIn,
      nextStep: result.nextStep
        ? {
            signInStep: result.nextStep.signInStep,
            challengeType: this.mapChallengeType(result.nextStep.signInStep),
          }
        : undefined,
    };
  }

  /**
   * signOut - ユーザーのサインアウトを実行
   * インメモリストレージをクリアしてトークンを完全に破棄
   */
  async signOut(): Promise<void> {
    await amplifySignOut();
    this.inMemoryStorage.clear();
  }

  /**
   * confirmMfaCode - MFA TOTP コードを確認してサインインを完了
   */
  async confirmMfaCode(totpCode: string): Promise<SignInResult> {
    const result = await confirmSignIn({ challengeResponse: totpCode });
    return {
      isSignedIn: result.isSignedIn,
      nextStep: result.nextStep
        ? {
            signInStep: result.nextStep.signInStep,
            challengeType: this.mapChallengeType(result.nextStep.signInStep),
          }
        : undefined,
    };
  }

  /**
   * setupTOTP - TOTP MFA のセットアップを開始
   * QR コード生成用の shared secret と URI を返す
   */
  async setupTOTP(): Promise<MfaSetupResult> {
    const totpSetupDetails = await setUpTOTP();
    return {
      sharedSecret: totpSetupDetails.sharedSecret,
      getSetupUri: (appName: string, accountName: string) =>
        totpSetupDetails.getSetupUri(appName, accountName),
    };
  }

  /**
   * verifyTOTPSetup - TOTP セットアップを検証コードで確認
   */
  async verifyTOTPSetup(totpCode: string): Promise<void> {
    await verifyTOTPSetup({ code: totpCode });
  }

  /**
   * confirmTOTPSetup - MFA セットアップチャレンジ中に TOTP コードを確認
   * signIn 後に CONTINUE_SIGN_IN_WITH_TOTP_SETUP が返された場合に使用
   */
  async confirmTOTPSetup(totpCode: string): Promise<SignInResult> {
    const result = await confirmSignIn({ challengeResponse: totpCode });
    return {
      isSignedIn: result.isSignedIn,
      nextStep: result.nextStep
        ? {
            signInStep: result.nextStep.signInStep,
            challengeType: this.mapChallengeType(result.nextStep.signInStep),
          }
        : undefined,
    };
  }

  /**
   * getStorage - テスト用にインメモリストレージへのアクセスを提供
   */
  getStorage(): InMemoryKeyValueStorage {
    return this.inMemoryStorage;
  }

  private mapChallengeType(signInStep: string): MfaChallengeType | undefined {
    switch (signInStep) {
      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP':
        return 'TOTP_SETUP';
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        return 'TOTP_CODE';
      default:
        return undefined;
    }
  }
}
