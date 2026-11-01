/**
 * ApiResponse - API レスポンスラッパー型
 * 成功時のレスポンスを統一的に扱う
 */
export interface ApiResponse<T> {
  data: T;
  pagination?: PaginationMeta;
}

/**
 * PaginatedResponse - ページネーション付きレスポンス型
 * リスト系APIのレスポンスに使用
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * PaginationMeta - ページネーション情報
 */
export interface PaginationMeta {
  totalCount: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
}

/**
 * ApiError - API エラーレスポンス型
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: string;
    errorCode?: string;
  };
}

/**
 * Result - 成功/失敗を表す型
 * フロントエンドでのエラーハンドリングに使用
 */
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * AppError - アプリケーションエラー型
 *
 * `code` は HTTP カテゴリ（NOT_FOUND 等、後方互換）。
 * `errorCode` はバックエンドが返す意味単位の詳細コード（SCREAMING_SNAKE_CASE）。
 * 表示時は errorCode をキーに errors namespace で翻訳し、未知コードは message に
 * フォールバックする（`utils/translateError.ts` を参照）。
 */
export interface AppError {
  code: string;
  message: string;
  details?: string;
  statusCode?: number;
  errorCode?: string;
}
