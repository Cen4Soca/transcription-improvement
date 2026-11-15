const API_ENDPOINT = process.env.API_ENDPOINT!;

interface ApiOptions {
  method: string;
  path: string;
  token: string;
  body?: unknown;
}

/**
 * API Gateway へリクエストを送信するヘルパー
 */
export async function apiRequest<T>(options: ApiOptions): Promise<T> {
  const { method, path, token, body } = options;

  const res = await fetch(`${API_ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `API request failed: ${method} ${path} → ${res.status} ${errorBody}`
    );
  }

  return (await res.json()) as T;
}

/**
 * Admin API でユーザーを作成する
 */
export async function createUser(
  token: string,
  data: { email: string; displayName: string; role: string }
): Promise<{ data: { userId: string; email: string; role: string } }> {
  return apiRequest({
    method: 'POST',
    path: '/admin/users',
    token,
    body: data,
  });
}

/**
 * Admin API でユーザーを無効化する
 */
export async function disableUser(
  token: string,
  userId: string
): Promise<void> {
  await apiRequest({
    method: 'PATCH',
    path: `/admin/users/${userId}`,
    token,
    body: { isActive: false },
  });
}

/**
 * Admin API でチームを作成する
 */
export async function createTeam(
  token: string,
  name: string
): Promise<{ data: { teamId: string; name: string } }> {
  return apiRequest({
    method: 'POST',
    path: '/admin/teams',
    token,
    body: { name },
  });
}

/**
 * Admin API でチームにメンバーを追加する
 */
export async function addTeamMember(
  token: string,
  teamId: string,
  userId: string
): Promise<void> {
  await apiRequest({
    method: 'POST',
    path: `/admin/teams/${teamId}/members`,
    token,
    body: { userId },
  });
}

/**
 * Admin API でチームからメンバーを削除する。
 *
 * `DELETE /admin/teams/{teamId}/members/{userId}`（`removeTeamMemberHandler`
 * → `removeMemberFromTeam` → `revokeReviewAssignmentsIfOrphaned`）をトリガーする。
 * 対象ユーザーが最後のチームから外れて全チーム離脱状態になると revoke が発火する
 * （team-departure-revokes-uploaded-session-visibility bugfix の実コード経路）。
 */
export async function removeTeamMember(
  token: string,
  teamId: string,
  userId: string
): Promise<void> {
  await apiRequest({
    method: 'DELETE',
    path: `/admin/teams/${teamId}/members/${userId}`,
    token,
  });
}

/**
 * Admin API でセッションをチームにアサインする（TeamAssignment を作成する）。
 *
 * `POST /admin/teams/{teamId}/assignments`（body `{ sessionId }`,
 * `createTeamAssignmentHandler` → `createAssignment` → `createTeamAssignment`）。
 * これによりセッションの所有権がチームへ移り、以後そのセッションの
 * ReviewAssignment は全チーム離脱時に revoke される（所有権移転モデル）。
 */
export async function createTeamAssignment(
  token: string,
  teamId: string,
  sessionId: string
): Promise<void> {
  await apiRequest({
    method: 'POST',
    path: `/admin/teams/${teamId}/assignments`,
    token,
    body: { sessionId },
  });
}

/**
 * Admin API でチームを削除する
 */
export async function deleteTeam(
  token: string,
  teamId: string
): Promise<void> {
  await apiRequest({
    method: 'DELETE',
    path: `/admin/teams/${teamId}`,
    token,
  });
}
