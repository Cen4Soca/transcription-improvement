/**
 * Team - 複数のUserをグループ化した単位
 * ReviewSessionはチーム単位で割り当てられる
 */
export interface Team {
  teamId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/**
 * TeamMembership - TeamとUserの所属関係
 */
export interface TeamMembership {
  teamId: string;
  userId: string;
  joinedAt: string;
  /** バックエンドがメンバー一覧に付与する表示名（割り当てドロップダウン用） */
  displayName?: string;
  /** バックエンドがメンバー一覧に付与するメールアドレス */
  email?: string;
}

/**
 * TeamAssignment - ReviewSessionを特定のTeamに割り当てる設定
 */
export interface TeamAssignment {
  teamId: string;
  sessionId: string;
  assignedBy: string;
  assignedAt: string;
}

/**
 * ReviewAssignment - 特定のReviewSessionを特定のUserに割り当てる設定
 */
export interface ReviewAssignment {
  userId: string;
  sessionId: string;
  assignedBy: string;
  assignedAt: string;
}
