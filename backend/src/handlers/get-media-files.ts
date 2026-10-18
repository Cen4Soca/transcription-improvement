import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { extractUser, isAdmin, type AuthUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';
import { internalError } from '../utils/error-handler.js';
import { getUserTeamIds } from '../services/access-control-service.js';
import * as mediaFileRepository from '../repositories/media-file-repository.js';
import { getAllUsers } from '../repositories/user-repository.js';
import { getTeamMembers } from '../repositories/team-repository.js';
import type { MediaFile } from '../types/media-file.js';

/**
 * GET /media-files
 * List media files accessible to the authenticated user.
 * - ADMIN: all media files
 * - TEAM_LEADER: files uploaded by their team members (including themselves)
 * - REVIEWER: only files they uploaded themselves
 *
 * Each item includes uploadedByName (the display name of the uploader),
 * resolved from the User records.
 *
 * Response:
 *   { data: { mediaFiles: MediaFileResponse[] } }
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);

    try {
      const mediaFiles = await getAccessibleMediaFiles(user);

      // Resolve uploader display names in one pass.
      const nameById = await buildUserNameMap();

      const response: MediaFileResponse[] = mediaFiles.map((file) =>
        mapToResponse(file, nameById.get(file.uploadedBy))
      );

      // Sort by createdAt descending
      response.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return successResponse({ data: { mediaFiles: response } });
    } catch (queryError: unknown) {
      throw internalError(
        'メディアファイル一覧の取得に失敗しました。',
        queryError instanceof Error ? queryError.message : undefined
      );
    }
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

interface MediaFileResponse {
  mediaFileId: string;
  filename: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  /** Display name of the uploader (falls back to uploadedBy if not found) */
  uploadedByName: string;
  teamId?: string;
  status: string;
  scanStatus?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get media files accessible to the given user, based on role.
 * - ADMIN: all
 * - TEAM_LEADER: files uploaded by any member of their teams (plus own)
 * - REVIEWER: own uploads only
 */
async function getAccessibleMediaFiles(user: AuthUser): Promise<MediaFile[]> {
  if (isAdmin(user)) {
    return mediaFileRepository.listAll();
  }

  if (user.role === 'TEAM_LEADER') {
    return getTeamLeaderMediaFiles(user.userId);
  }

  // REVIEWER: only own uploads
  return mediaFileRepository.listByUploader(user.userId);
}

/**
 * Get media files uploaded by any member of the TeamLeader's teams (including
 * the leader themselves). Deduplicated by mediaFileId.
 */
async function getTeamLeaderMediaFiles(leaderId: string): Promise<MediaFile[]> {
  // Collect all member userIds across the leader's teams (plus the leader).
  const teamIds = await getUserTeamIds(leaderId);

  const uploaderIds = new Set<string>();
  uploaderIds.add(leaderId);

  await Promise.all(
    teamIds.map(async (teamId) => {
      const members = await getTeamMembers(teamId);
      for (const member of members) {
        uploaderIds.add(member.userId);
      }
    })
  );

  const fileMap = new Map<string, MediaFile>();
  await Promise.all(
    Array.from(uploaderIds).map(async (uploaderId) => {
      const files = await mediaFileRepository.listByUploader(uploaderId);
      for (const file of files) {
        fileMap.set(file.mediaFileId, file);
      }
    })
  );

  return Array.from(fileMap.values());
}

/**
 * Build a userId -> displayName map from all User records.
 */
async function buildUserNameMap(): Promise<Map<string, string>> {
  const users = await getAllUsers();
  const map = new Map<string, string>();
  for (const u of users) {
    map.set(u.userId, u.displayName);
  }
  return map;
}

function mapToResponse(file: MediaFile, uploaderName: string | undefined): MediaFileResponse {
  return {
    mediaFileId: file.mediaFileId,
    filename: file.filename,
    s3Key: file.s3Key,
    contentType: file.contentType,
    fileSize: file.fileSize,
    uploadedBy: file.uploadedBy,
    uploadedByName: uploaderName ?? file.uploadedBy,
    teamId: file.teamId,
    status: file.status,
    scanStatus: file.scanStatus,
    sessionId: file.sessionId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}
