import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
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
    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました');
  });

  it('returns loading initially', () => {
    mockFetchAuthSession.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
  });
});
