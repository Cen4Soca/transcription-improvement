// ============================================================
// Domain Types
// ============================================================

/**
 * ReviewSession - 校閲セッション
 * 一つのTranscriptionJobに対するReviewの作業単位。
 * 複数のReviewerが同一セッションに参加（join）して校閲し、多数決でConsensusを確定する。
 */
export interface ReviewSession {
  sessionId: string;
  transcriptionJobId: string;
  name: string;
  status: ReviewSessionStatus;
  /**
   * 現在このセッションに参加しているReviewerの人数。
   * Reviewerがセッションに参加（join）またはCorrectionを提出するたびに増加する。
   * Consensus集計時の totalReviewers として使用される。
   */
  assignedReviewerCount: number;
  consensusThreshold: number;
  partialAggregationEnabled: boolean;
  /**
   * Master list of speaker labels for this session.
   * The labels shown in the review UI are the UNION of this master list and the
   * labels derived from each Segment.speakerLabel. The master list lets a
   * reviewer add a speaker label that is not yet assigned to any segment.
   */
  speakerLabels?: string[];
  createdAt: string;
  updatedAt: string;
}

export type ReviewSessionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * SessionParticipant - ReviewSessionに参加しているReviewer
 * 1つのReviewSessionに複数のReviewerが参加できる（多数決による校閲のため）。
 * セッションへの参加は排他的ではなく、参加済みユーザーの再参加は冪等に扱われる。
 */
export interface SessionParticipant {
  sessionId: string;
  userId: string;
  joinedAt: string;
}

/**
 * Segment - 文字起こしの最小単位
 * 開始時刻・終了時刻・テキスト・話者情報を持つ
 */
export interface Segment {
  segmentId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  originalText: string;
  speakerLabel?: string;
  consensusStatus: ConsensusStatus;
  consensusText?: string;
}

export type ConsensusStatus = 'UNDECIDED' | 'CONFIRMED' | 'CONFLICT';

/**
 * ConsensusResult - 合意結果
 * 複数ReviewerのCorrectionを集計し、ConsensusThresholdを超えた回答として確定したテキスト
 */
export interface ConsensusResult {
  sessionId: string;
  segmentId: string;
  consensusText: string;
  confirmedAt: string;
  confirmedBy: 'AUTO' | string;
  totalReviewers: number;
  agreementCount: number;
  agreementRate: number;
}

/**
 * Correction - Reviewerが加えた文字起こしテキストまたは話者情報への変更内容
 */
export interface Correction {
  correctionId: string;
  sessionId: string;
  segmentId: string;
  userId: string;
  correctionType: CorrectionType;
  beforeText: string;
  afterText: string;
  beforeSpeaker?: string;
  afterSpeaker?: string;
  affectedSegmentCount?: number;
  createdAt: string;
}

export type CorrectionType = 'TEXT' | 'SPEAKER' | 'SPEAKER_RENAME';

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

/**
 * AuditLog - 操作の監査記録
 */
export interface AuditLog {
  logId: string;
  createdAt: string;
  actorUserId: string;
  actorRole: UserRole;
  operationType: AuditOperationType;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

export type AuditOperationType =
  | 'IP_ALLOWLIST_CHANGE'
  | 'USER_MANAGEMENT'
  | 'TEAM_MANAGEMENT'
  | 'REVIEW_ASSIGNMENT_CHANGE'
  | 'TEAM_ASSIGNMENT_CHANGE'
  | 'SESSION_COMPLETED'
  | 'SESSION_NAME_CHANGED'
  | 'SESSION_MANUAL_AGGREGATED'
  | 'SESSION_REOPENED'
  | 'CONSENSUS_MANUAL_CONFIRM'
  | 'CORRECTION_CONFIRMED'
  | 'SPEAKER_LABEL_CHANGED'
  | 'LOGIN_FAILURE'
  | 'MEDIA_DELETED'
  | 'TRANSCRIPTION_DELETED'
  | 'PARTIAL_DELETION_FAILURE'
  | 'LANGUAGE_MODEL_CREATED'
  | 'LANGUAGE_MODEL_DELETED'
  | 'LANGUAGE_MODEL_TEAM_CHANGED'
  | 'LANGUAGE_MODEL_NAME_CHANGED'
  | 'TRANSCRIPTION_JOB_STARTED'
  | 'AUDIT_LOG_DELETED';

/**
 * LanguageModelMetadata - カスタム言語モデルのアプリ側メタデータ
 * Transcribe のモデル（不変・グローバル）に対し、チーム所有情報・表示名などを
 * DynamoDB 側で別レコードとして管理する二層構造。
 */
export interface LanguageModelMetadata {
  modelName: string;
  teamId: string;
  displayName: string;
  displayNameLower: string;
  baseModelName: string;
  createdBy: string;
  createdAt: string;
  sessionIds: string[];
  s3Key: string;
  deletionStatus: 'ACTIVE' | 'PENDING';
}

/**
 * IPAllowlistEntry - IPアドレス許可リストのエントリ
 */
export interface IPAllowlistEntry {
  entryId: string;
  cidr: string;
  description?: string;
  createdAt: string;
  createdBy: string;
}

/**
 * ContributorScore - コントリビュータースコア
 * Userの回答数と正答率を掛け合わせて算出した総合スコア
 */
export interface ContributorScore {
  userId: string;
  displayName: string;
  period: RankingPeriod;
  answerCount: number;
  accuracyRate: number;
  score: number;
  rank: number;
  updatedAt: string;
}

export type RankingPeriod =
  | 'ALL'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS';

/**
 * RankingSettings - ランキング表示範囲設定（Admin設定）
 */
export interface RankingSettings {
  displayScope: RankingDisplayScope;
  topN?: number;
  updatedAt: string;
  updatedBy: string;
}

export type RankingDisplayScope = 'ALL_USERS' | 'TEAM_ONLY' | 'TOP_N';

// Re-export entity types from dedicated files
export type { MediaFile, MediaFileStatus } from './media-file.js';
export type { TranscriptionJob, TranscriptionJobStatus } from './transcription-job.js';

// ============================================================
// Auth Types
// ============================================================

/**
 * AuthUser - 認証済みユーザー情報
 * JWT クレームから抽出される
 */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
}

/**
 * AuthProvider - 認証プロバイダーインターフェース
 * Cognito → IAM Identity Center 移行に対応するための抽象化レイヤー
 *
 * 現在: CognitoAuthProvider implements AuthProvider
 * 将来: IAMIdentityCenterAuthProvider implements AuthProvider
 */
export interface AuthProvider {
  getToken(): Promise<string>;
  getCurrentUser(): Promise<AuthUser>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

// ============================================================
// API Response Types
// ============================================================

/**
 * ApiSuccessResponse - API 成功レスポンス型
 */
export interface ApiSuccessResponse<T> {
  data: T;
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
 * ErrorResponse - API エラーレスポンス型
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * AppErrorOptions - AppError 生成オプション
 */
export interface AppErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  details?: string;
}
