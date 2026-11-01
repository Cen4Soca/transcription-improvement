import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import i18n from '../i18n';
import { useAuth } from './useAuth';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  it('returns not authenticated when no session exists', async () => {
    mockFetchAuthSession.mockRejectedValue(new Error('No session'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('fetches user profile from /me API when session exists', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token' } },
    } as never);

    mockGetCurrentUser.mockResolvedValue({
      userId: 'cognito-sub-123',
      signInDetails: { loginId: 'admin@example.com' },
    } as never);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: { userId: 'db-user-id', email: 'admin@example.com', displayName: 'Admin', role: 'ADMIN' },
      }),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual({
      userId: 'db-user-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'ADMIN',
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('defaults to REVIEWER role when /me API fails', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token' } },
    } as never);

    mockGetCurrentUser.mockResolvedValue({
      userId: 'cognito-sub-123',
      signInDetails: { loginId: 'user@example.com' },
    } as never);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.role).toBe('REVIEWER');
    expect(result.current.error).toBe(i18n.t('common:auth.userInfoFetchFailed'));
  });

  it('returns loading initially', () => {
    mockFetchAuthSession.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
  });

  it('applies preferredLanguage from /me and exposes it on the user', async () => {
    const i18n = (await import('../i18n')).default;
    await i18n.changeLanguage('ja');

    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token' } },
    } as never);
    mockGetCurrentUser.mockResolvedValue({
      userId: 'cognito-sub-123',
      signInDetails: { loginId: 'user@example.com' },
    } as never);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            userId: 'db-user-id',
            email: 'user@example.com',
            displayName: 'User',
            role: 'REVIEWER',
            preferredLanguage: 'en',
          },
        }),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.preferredLanguage).toBe('en');
    await waitFor(() => expect(i18n.language).toBe('en'));

    // クリーンアップ（他テストへの影響を避ける）
    await i18n.changeLanguage('ja');
  });

  it('does not change language when /me omits preferredLanguage', async () => {
    const i18n = (await import('../i18n')).default;
    await i18n.changeLanguage('ja');

    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token' } },
    } as never);
    mockGetCurrentUser.mockResolvedValue({
      userId: 'cognito-sub-123',
      signInDetails: { loginId: 'user@example.com' },
    } as never);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            userId: 'db-user-id',
            email: 'user@example.com',
            displayName: 'User',
            role: 'REVIEWER',
          },
        }),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.preferredLanguage).toBeUndefined();
    expect(i18n.language).toBe('ja');
  });
});
