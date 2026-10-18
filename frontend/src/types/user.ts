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
}

export type UserRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
