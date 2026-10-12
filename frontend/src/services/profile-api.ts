import type { ApiClient } from './api-client';
import type { Result, AppError } from '../types/api';
import type { User } from '../types/user';

/**
 * ProfileApi - 自身のプロファイル操作用 API クライアント
 *
 * - PATCH /me: ログイン中ユーザーが自身の表示名・メールアドレスを更新する
 *
 * Requirements: ユーザープロファイル編集
 */

export interface UpdateProfileRequest {
  displayName?: string;
  email?: string;
}

export interface ProfileResponse {
  data: User;
}

export class ProfileApi {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * 自身のプロファイル（表示名・メールアドレス）を更新する
   */
  async updateProfile(
    data: UpdateProfileRequest
  ): Promise<Result<ProfileResponse, AppError>> {
    return this.client.patch<ProfileResponse>('/me', data);
  }
}
