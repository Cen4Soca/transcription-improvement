import { useTranslation } from 'react-i18next';
import type { ReviewProgress } from '../utils/review-progress';

export interface ReviewProgressBarProps {
  progress: ReviewProgress;
}

/**
 * ReviewProgressBar - セッション全体の校閲進捗バー
 *
 * 全セグメント中、何件が校閲済み（修正済み / CONFIRMED）かを割合付きで表示する。
 * ツールバーに配置し、レビュアーが「どこまで進んだか」を把握できるようにする。
 *
 * - role="progressbar" + aria-valuenow/min/max でスクリーンリーダー対応。
 * - 表示テキストは i18n（review namespace）。
 */
export function ReviewProgressBar({ progress }: ReviewProgressBarProps) {
  const { t } = useTranslation('review');
  const { total, done, ratio } = progress;
  const percent = Math.round(ratio * 100);
  const label = t('progress.label', { done, total, percent });

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <div
        role="progressbar"
        aria-label={t('progress.ariaLabel')}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={label}
        className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-green-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap">{label}</span>
    </div>
  );
}
