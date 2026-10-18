import type { Result, AppError } from '../types/api';

/**
 * ApiClient - 共通エラーハンドラ付き API クライアント
 *
 * - JWT トークンを Authorization ヘッダーに付与
 * - 401 → ログイン画面にリダイレクト
 * - 429 → リトライ待機（Retry-After ヘッダー対応、指数バックオフ）
 * - ネットワークエラーのグレースフルハンドリング
 * - エラーレスポンスを AppError 型にパース
 *
 * Requirements: 1.1, 5.4, 9.9, 14.17
 */

/** 429 レートリミット超過時のエラー。retryAfterMs で待機時間を通知 */
export interface RateLimitError extends AppError {
  code: 'RATE_LIMITED';
  retryAfterMs: number;
}

export class ApiClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;
  private loginPath: string;
  private maxRetries: number;

  constructor(options: {
    baseUrl: string;
    getToken: () => Promise<string>;
    loginPath?: string;
    maxRetries?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getToken = options.getToken;
    this.loginPath = options.loginPath ?? '/login';
    this.maxRetries = options.maxRetries ?? 2;
  }

  async get<T>(path: string): Promise<Result<T, AppError>> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<Result<T, AppError>> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async patch<T>(path: string, body: unknown): Promise<Result<T, AppError>> {
    return this.request<T>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async delete<T>(path: string): Promise<Result<T, AppError>> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    attempt = 0
  ): Promise<Result<T, AppError>> {
    try {
      const token = await this.getToken();

      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });

      if (response.status === 401) {
        window.location.href = this.loginPath;
        return {
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です。ログイン画面にリダイレクトします。',
            statusCode: 401,
          },
        };
      }

      if (response.status === 429) {
        const retryAfterMs = this.parseRetryAfter(response);

        if (attempt < this.maxRetries) {
          await this.sleep(retryAfterMs);
          return this.request<T>(path, init, attempt + 1);
        }

        return {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'リクエスト回数の上限に達しました。しばらく待ってから再試行してください。',
            statusCode: 429,
            retryAfterMs,
          } as RateLimitError,
        };
      }

      if (!response.ok) {
        return { ok: false, error: await this.parseErrorResponse(response) };
      }

      // レスポンスの Content-Type に応じて JSON / テキストをパースする。
      // ダウンロード API の SRT など text/plain を返すエンドポイントは
      // JSON パースできないため、テキストとして扱う必要がある。
      // Content-Type が取得できない場合は JSON を既定とする。
      const contentType = response.headers?.get('Content-Type') ?? '';
      const isText =
        contentType.includes('text/') ||
        contentType.includes('application/octet-stream');
      const data = isText
        ? ((await response.text()) as T)
        : ((await response.json()) as T);
      return { ok: true, value: data };
    } catch (error) {
      return { ok: false, error: this.toNetworkError(error) };
    }
  }

  private parseRetryAfter(response: Response): number {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    // Default: 60 seconds if no Retry-After header
    return 60_000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async parseErrorResponse(response: Response): Promise<AppError> {
    try {
      const body = await response.json();
      if (body?.error) {
        return {
          code: body.error.code ?? 'UNKNOWN_ERROR',
          message: body.error.message ?? 'エラーが発生しました',
          details: body.error.details,
          statusCode: response.status,
        };
      }
      return {
        code: 'UNKNOWN_ERROR',
        message: `エラーが発生しました (${response.status})`,
        statusCode: response.status,
      };
    } catch {
      return {
        code: 'PARSE_ERROR',
        message: `エラーレスポンスの解析に失敗しました (${response.status})`,
        statusCode: response.status,
      };
    }
  }

  private toNetworkError(error: unknown): AppError {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'ネットワークに接続できません。接続を確認してください。',
      };
    }
    const message =
      error instanceof Error ? error.message : 'エラーが発生しました';
    return {
      code: 'NETWORK_ERROR',
      message,
    };
  }
}
