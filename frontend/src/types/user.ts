/**
 * User - Appに登録されたReviewerまたは管理者アカウント
 */
export interface User {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  /** ユーザーの優先表示言語（'ja' | 'en'）。未設定の場合は undefined。 */
  preferredLanguage?: 'ja' | 'en';
}

export type UserRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
