import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api-client';

describe('ApiClient', () => {
  const mockGetToken = vi.fn().mockResolvedValue('test-jwt-token');
  let client: ApiClient;
  let originalFetch: typeof globalThis.fetch;
  let originalLocation: Location;

  beforeEach(() => {
    client = new ApiClient({
      baseUrl: 'https://api.example.com',
      getToken: mockGetToken,
      loginPath: '/login',
    });
    originalFetch = globalThis.fetch;
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '', reload: vi.fn() },
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  test('GET request attaches JWT token to Authorization header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
    });

    await client.get('/sessions');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/sessions',
      expect.objectContaining({
        method: 'GET',
      })
    );

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token');
  });

  test('POST request sends JSON body with Authorization header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '123' }),
    });

    const result = await client.post('/sessions/1/corrections', {
      segmentId: 'seg-1',
      text: 'corrected',
    });

    expect(result).toEqual({ ok: true, value: { id: '123' } });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const init = callArgs[1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ segmentId: 'seg-1', text: 'corrected' })
    );
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token');
  });

  test('PATCH request sends JSON body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ updated: true }),
    });

    const result = await client.patch('/sessions/1/status', {
      status: 'COMPLETED',
    });

    expect(result).toEqual({ ok: true, value: { updated: true } });
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(callArgs[1]?.method).toBe('PATCH');
  });

  test('DELETE request sends without body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ deleted: true }),
    });

    const result = await client.delete('/admin/ip-allowlist/entry-1');

    expect(result).toEqual({ ok: true, value: { deleted: true } });
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(callArgs[1]?.method).toBe('DELETE');
  });

  test('401 response redirects to login page', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }),
    });

    const result = await client.get('/sessions');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.statusCode).toBe(401);
    }
    expect(window.location.href).toBe('/login');
  });

  test('error response is parsed into AppError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: {
            code: 'FORBIDDEN',
            message: '権限がありません',
            details: 'Admin role required',
          },
        }),
    });

    const result = await client.get('/admin/users');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
      expect(result.error.message).toBe('権限がありません');
      expect(result.error.details).toBe('Admin role required');
      expect(result.error.statusCode).toBe(403);
    }
  });

  test('text/plain success response is parsed as text (e.g. SRT download)', async () => {
    const srtContent = '1\n00:00:00,000 --> 00:00:03,500\n[spk_0] テスト\n';
    const headers = new Headers();
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      text: () => Promise.resolve(srtContent),
      json: () => Promise.reject(new Error('should not be called')),
    });

    const result = await client.get<string>('/sessions/1/download?format=srt');

    expect(result).toEqual({ ok: true, value: srtContent });
  });

  test('application/json success response is parsed as JSON', async () => {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      json: () => Promise.resolve({ sessionName: 'テスト', segments: [] }),
    });

    const result = await client.get('/sessions/1/download?format=json');

    expect(result).toEqual({ ok: true, value: { sessionName: 'テスト', segments: [] } });
  });

  test('non-JSON error response returns parse error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const result = await client.get('/sessions');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR');
      expect(result.error.statusCode).toBe(500);
    }
  });

  test('network error returns NETWORK_ERROR', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    const result = await client.get('/sessions');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('ネットワーク');
    }
  });

  test('trailing slash in baseUrl is removed', async () => {
    const clientWithSlash = new ApiClient({
      baseUrl: 'https://api.example.com/',
      getToken: mockGetToken,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await clientWithSlash.get('/sessions');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/sessions',
      expect.anything()
    );
  });

  describe('429 Rate Limit Handling', () => {
    test('retries on 429 and succeeds on second attempt', async () => {
      vi.useFakeTimers();

      const clientWithRetry = new ApiClient({
        baseUrl: 'https://api.example.com',
        getToken: mockGetToken,
        maxRetries: 2,
      });

      const mockHeaders = new Headers();
      mockHeaders.set('Retry-After', '1');

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'success' }),
        });

      const resultPromise = clientWithRetry.get('/sessions');
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, value: { data: 'success' } });
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    test('returns RATE_LIMITED error after max retries exceeded', async () => {
      vi.useFakeTimers();

      const clientWithRetry = new ApiClient({
        baseUrl: 'https://api.example.com',
        getToken: mockGetToken,
        maxRetries: 1,
      });

      const mockHeaders = new Headers();
      mockHeaders.set('Retry-After', '2');

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
          json: () => Promise.resolve({}),
        });

      const resultPromise = clientWithRetry.get('/sessions');
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.statusCode).toBe(429);
        expect(result.error.message).toContain('リクエスト回数の上限');
      }

      vi.useRealTimers();
    });

    test('uses default 60s retry delay when no Retry-After header', async () => {
      vi.useFakeTimers();

      const clientWithRetry = new ApiClient({
        baseUrl: 'https://api.example.com',
        getToken: mockGetToken,
        maxRetries: 1,
      });

      const mockHeaders = new Headers(); // No Retry-After header

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'ok' }),
        });

      const resultPromise = clientWithRetry.get('/sessions');

      // Should not resolve before 60s
      await vi.advanceTimersByTimeAsync(59_000);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Should resolve after 60s
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true, value: { data: 'ok' } });
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
