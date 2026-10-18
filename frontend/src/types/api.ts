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
 */
export interface AppError {
  code: string;
  message: string;
  details?: string;
  statusCode?: number;
}
