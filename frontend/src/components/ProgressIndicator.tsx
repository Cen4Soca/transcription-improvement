/**
 * ProgressIndicator - 匿名化進捗情報表示コンポーネント
 *
 * Correction確定後にReviewerに表示する匿名化された進捗情報。
 * プライバシー保護のため、割り当てReviewer数に応じて表示を切り替える:
 * - 5名以上: 「あと{remaining}人が回答待ち」（具体的人数表示）
 * - 5名未満: 「まだ回答が集まっています」（個人特定防止）
 *
 * Requirements: 10.11
 */

export interface ProgressIndicatorProps {
  /** 割り当てReviewer総数 */
  totalReviewers: number;
  /** 回答済みReviewer数 */
  completedCount: number;
  /** コンポーネントの表示/非表示 */
  visible?: boolean;
}

export function ProgressIndicator({
  totalReviewers,
  completedCount,
  visible = true,
}: ProgressIndicatorProps) {
  if (!visible) {
    return null;
  }

  const remaining = totalReviewers - completedCount;

  // All reviewers have completed
  if (remaining <= 0) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
        role="status"
        aria-label="全員回答済み"
      >
        <CheckIcon />
        <span>全員回答済み</span>
      </div>
    );
  }

  // Privacy-preserving display logic
  if (totalReviewers >= 5) {
    // 5名以上: show specific remaining count
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
        role="status"
        aria-label={`あと${remaining}人が回答待ち`}
      >
        <ClockIcon />
        <span>あと{remaining}人が回答待ち</span>
      </div>
    );
  }

  // 5名未満: generic message to prevent individual identification
  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
      role="status"
      aria-label="まだ回答が集まっています"
    >
      <ClockIcon />
      <span>まだ回答が集まっています</span>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
