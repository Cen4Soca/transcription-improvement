import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitoAuthProvider, InMemoryKeyValueStorage } from './cognito-auth-provider';

vi.mock('aws-amplify', () => ({
  Amplify: {
    configure: vi.fn(),
  },
}));

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  confirmSignIn: vi.fn(),
  setUpTOTP: vi.fn(),
  verifyTOTPSetup: vi.fn(),
}));

vi.mock('aws-amplify/auth/cognito', () => ({
  cognitoUserPoolsTokenProvider: {
    setKeyValueStorage: vi.fn(),
  },
}));

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

const mockFetchAuthSession = vi.mocked(fetchAuthSession);
const mockFetchUserAttributes = vi.mocked(fetchUserAttributes);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockAmplifySignIn = vi.mocked(amplifySignIn);
const mockAmplifySignOut = vi.mocked(amplifySignOut);
const mockConfirmSignIn = vi.mocked(confirmSignIn);
const mockSetUpTOTP = vi.mocked(setUpTOTP);
const mockVerifyTOTPSetup = vi.mocked(verifyTOTPSetup);
const mockSetKeyValueStorage = vi.mocked(cognitoUserPoolsTokenProvider.setKeyValueStorage);

describe('CognitoAuthProvider', () => {
  let provider: CognitoAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CognitoAuthProvider({
      userPoolId: 'ap-northeast-1_testPool',
      userPoolClientId: 'testClientId',
    });
  });

  describe('constructor', () => {
    it('configures in-memory storage for token provider', () => {
      expect(mockSetKeyValueStorage).toHaveBeenCalledWith(expect.any(InMemoryKeyValueStorage));
    });
  });

  describe('getToken', () => {
    it('returns the ID token from the session', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: {
          idToken: { toString: () => 'test-id-token' },
        },
      } as never);

      const token = await provider.getToken();
      expect(token).toBe('test-id-token');
    });

    it('throws an error when no token is available', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: undefined,
      } as never);

      await expect(provider.getToken()).rejects.toThrow('認証トークンを取得できませんでした');
    });
  });

  describe('getCurrentUser', () => {
    it('returns user info from /me API', async () => {
      mockGetCurrentUser.mockResolvedValue({
        userId: 'user-123',
        username: 'testuser',
      } as never);
      mockFetchUserAttributes.mockResolvedValue({
        email: 'test@example.com',
        'custom:role': 'ADMIN',
        'custom:displayName': 'Test User',
      } as never);
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'test-token' } },
      } as never);

      // Mock fetch for /me API
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: { userId: 'db-user-123', email: 'test@example.com', displayName: 'Test User', role: 'ADMIN' },
        }),
      });

      const user = await provider.getCurrentUser();
      expect(user).toEqual({
        userId: 'db-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'ADMIN',
      });
    });

    it('defaults role to REVIEWER when /me API fails', async () => {
      mockGetCurrentUser.mockResolvedValue({
        userId: 'user-456',
        username: 'testuser2',
      } as never);
      mockFetchUserAttributes.mockResolvedValue({
        email: 'user2@example.com',
      } as never);
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'test-token' } },
      } as never);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      const user = await provider.getCurrentUser();
      expect(user.role).toBe('REVIEWER');
    });

    it('uses email as displayName when /me API fails', async () => {
      mockGetCurrentUser.mockResolvedValue({
        userId: 'user-789',
        username: 'testuser3',
      } as never);
      mockFetchUserAttributes.mockResolvedValue({
        email: 'user3@example.com',
      } as never);
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'test-token' } },
      } as never);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const user = await provider.getCurrentUser();
      expect(user.displayName).toBe('user3@example.com');
    });
  });

  describe('signIn', () => {
    it('calls Amplify signIn and returns signed-in result', async () => {
      mockAmplifySignIn.mockResolvedValue({
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as never);

      const result = await provider.signInWithResult('user@example.com', 'password123');
      expect(mockAmplifySignIn).toHaveBeenCalledWith({
        username: 'user@example.com',
        password: 'password123',
      });
      expect(result.isSignedIn).toBe(true);
    });

    it('returns TOTP_CODE challenge when MFA is required', async () => {
      mockAmplifySignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
      } as never);

      const result = await provider.signInWithResult('admin@example.com', 'password123');
      expect(result.isSignedIn).toBe(false);
      expect(result.nextStep?.challengeType).toBe('TOTP_CODE');
    });

    it('returns TOTP_SETUP challenge when MFA setup is needed', async () => {
      mockAmplifySignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP' },
      } as never);

      const result = await provider.signInWithResult('newadmin@example.com', 'password123');
      expect(result.isSignedIn).toBe(false);
      expect(result.nextStep?.challengeType).toBe('TOTP_SETUP');
    });

    it('handles signIn with empty credentials', async () => {
      mockAmplifySignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'DONE' },
      } as never);

      await provider.signIn();
      expect(mockAmplifySignIn).toHaveBeenCalledWith({
        username: '',
        password: '',
      });
    });
  });

  describe('signOut', () => {
    it('calls Amplify signOut and clears in-memory storage', async () => {
      mockAmplifySignOut.mockResolvedValue(undefined as never);

      // Set some data in storage first
      const storage = provider.getStorage();
      await storage.setItem('test-key', 'test-value');
      expect(await storage.getItem('test-key')).toBe('test-value');

      await provider.signOut();

      expect(mockAmplifySignOut).toHaveBeenCalled();
      expect(await storage.getItem('test-key')).toBeNull();
    });
  });

  describe('confirmMfaCode', () => {
    it('confirms TOTP code and completes sign-in', async () => {
      mockConfirmSignIn.mockResolvedValue({
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as never);

      const result = await provider.confirmMfaCode('123456');
      expect(mockConfirmSignIn).toHaveBeenCalledWith({ challengeResponse: '123456' });
      expect(result.isSignedIn).toBe(true);
    });

    it('handles additional challenges after MFA confirmation', async () => {
      mockConfirmSignIn.mockResolvedValue({
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
      } as never);

      const result = await provider.confirmMfaCode('000000');
      expect(result.isSignedIn).toBe(false);
      expect(result.nextStep?.challengeType).toBe('TOTP_CODE');
    });
  });

  describe('setupTOTP', () => {
    it('returns TOTP setup details with shared secret', async () => {
      const mockUri = new URL('otpauth://totp/App:user@example.com?secret=ABC123');
      mockSetUpTOTP.mockResolvedValue({
        sharedSecret: 'ABC123DEF456',
        getSetupUri: () => mockUri,
      } as never);

      const result = await provider.setupTOTP();
      expect(result.sharedSecret).toBe('ABC123DEF456');
      expect(result.getSetupUri('TestApp', 'user@example.com')).toEqual(mockUri);
    });
  });

  describe('verifyTOTPSetup', () => {
    it('verifies TOTP setup with code', async () => {
      mockVerifyTOTPSetup.mockResolvedValue(undefined as never);

      await provider.verifyTOTPSetup('654321');
      expect(mockVerifyTOTPSetup).toHaveBeenCalledWith({ code: '654321' });
    });
  });

  describe('confirmTOTPSetup', () => {
    it('confirms TOTP setup during sign-in flow', async () => {
      mockConfirmSignIn.mockResolvedValue({
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as never);

      const result = await provider.confirmTOTPSetup('789012');
      expect(mockConfirmSignIn).toHaveBeenCalledWith({ challengeResponse: '789012' });
      expect(result.isSignedIn).toBe(true);
    });
  });
});

describe('InMemoryKeyValueStorage', () => {
  let storage: InMemoryKeyValueStorage;

  beforeEach(() => {
    storage = new InMemoryKeyValueStorage();
  });

  it('stores and retrieves values', async () => {
    await storage.setItem('key1', 'value1');
    expect(await storage.getItem('key1')).toBe('value1');
  });

  it('returns null for non-existent keys', async () => {
    expect(await storage.getItem('nonexistent')).toBeNull();
  });

  it('removes items', async () => {
    await storage.setItem('key1', 'value1');
    await storage.removeItem('key1');
    expect(await storage.getItem('key1')).toBeNull();
  });

  it('clears all items', async () => {
    await storage.setItem('key1', 'value1');
    await storage.setItem('key2', 'value2');
    await storage.clear();
    expect(await storage.getItem('key1')).toBeNull();
    expect(await storage.getItem('key2')).toBeNull();
  });

  it('overwrites existing values', async () => {
    await storage.setItem('key1', 'value1');
    await storage.setItem('key1', 'value2');
    expect(await storage.getItem('key1')).toBe('value2');
  });

  it('does not use localStorage', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    await storage.setItem('key1', 'value1');
    expect(localStorageSpy).not.toHaveBeenCalled();
    localStorageSpy.mockRestore();
  });

  it('does not use sessionStorage', async () => {
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    await storage.setItem('key1', 'value1');
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    sessionStorageSpy.mockRestore();
  });
});
