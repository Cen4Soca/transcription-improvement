import type { ReviewSession } from '../types/session';

/** 選択チームに割り当てられた sessionId 集合で候補を絞る（Req 2.1） */
export function filterSessionsByAssignment(
  sessions: ReviewSession[],
  assignedSessionIds: Set<string>
): ReviewSession[] {
  return sessions.filter((s) => assignedSessionIds.has(s.sessionId));
}

/** 前回の選択を新しい割り当て集合に整合させる（= 積集合、Req 2.3） */
export function reconcileSelection(
  prevSelected: string[],
  assignedSessionIds: Set<string>
): string[] {
  return prevSelected.filter((id) => assignedSessionIds.has(id));
}
