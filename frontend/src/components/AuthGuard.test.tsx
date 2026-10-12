import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import type { AuthState } from '../services/auth-context-value';

// Mock useAuth hook
vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../hooks/useAuth';
const mockUseAuth = vi.mocked(useAuth);

describe('AuthGuard', () => {
  const mockAuthState: AuthState = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    getToken: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  it('shows loading state while checking authentication', () => {
    mockUseAuth.mockReturnValue({ ...mockAuthState, isLoading: true });

    render(
      <AuthGuard><div>Protected Content</div></AuthGuard>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('認証を確認しています...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when user is authenticated', () => {
    mockUseAuth.mockReturnValue({
      ...mockAuthState,
      isAuthenticated: true,
      user: {
        userId: 'user-1',
        email: 'test@example.com',
        displayName: 'Test',
        role: 'REVIEWER',
      },
    });

    render(
      <AuthGuard><div>Protected Content</div></AuthGuard>,
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to login page when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({ ...mockAuthState, isAuthenticated: false, isLoading: false });

    render(
      <MemoryRouter>
        <AuthGuard><div>Protected Content</div></AuthGuard>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects to custom login path when specified', () => {
    mockUseAuth.mockReturnValue({ ...mockAuthState, isAuthenticated: false, isLoading: false });

    render(
      <MemoryRouter>
        <AuthGuard loginPath="/auth/signin">
          <div>Protected Content</div>
        </AuthGuard>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  describe('role-based access control', () => {
    it('renders children when user has required role', () => {
      mockUseAuth.mockReturnValue({
        ...mockAuthState,
        isAuthenticated: true,
        user: {
          userId: 'admin-1',
          email: 'admin@example.com',
          displayName: 'Admin',
          role: 'ADMIN',
        },
      });

      render(
        <AuthGuard requiredRoles={['ADMIN']}><div>Admin Content</div></AuthGuard>,
      );

      expect(screen.getByText('Admin Content')).toBeInTheDocument();
    });

    it('shows access denied when user lacks required role', () => {
      mockUseAuth.mockReturnValue({
        ...mockAuthState,
        isAuthenticated: true,
        user: {
          userId: 'reviewer-1',
          email: 'reviewer@example.com',
          displayName: 'Reviewer',
          role: 'REVIEWER',
        },
      });

      render(
        <AuthGuard requiredRoles={['ADMIN']}><div>Admin Content</div></AuthGuard>,
      );

      expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('アクセス権限がありません')).toBeInTheDocument();
    });

    it('allows access when user has one of multiple required roles', () => {
      mockUseAuth.mockReturnValue({
        ...mockAuthState,
        isAuthenticated: true,
        user: {
          userId: 'tl-1',
          email: 'tl@example.com',
          displayName: 'Team Leader',
          role: 'TEAM_LEADER',
        },
      });

      render(
        <AuthGuard requiredRoles={['ADMIN', 'TEAM_LEADER']}><div>Management Content</div></AuthGuard>,
      );

      expect(screen.getByText('Management Content')).toBeInTheDocument();
    });

    it('renders children when no requiredRoles specified (any authenticated user)', () => {
      mockUseAuth.mockReturnValue({
        ...mockAuthState,
        isAuthenticated: true,
        user: {
          userId: 'user-1',
          email: 'user@example.com',
          displayName: 'User',
          role: 'REVIEWER',
        },
      });

      render(
        <AuthGuard><div>General Content</div></AuthGuard>,
      );

      expect(screen.getByText('General Content')).toBeInTheDocument();
    });
  });
});
