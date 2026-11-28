export interface ProgressBarProps {
  /** 進捗（%）。0〜100 に丸めて表示する。 */
  percent: number;
  /** スクリーンリーダー向けラベル（必須） */
  label: string;
}

/**
 * ProgressBar - 進捗バー（role="progressbar"）
 *
 * 色だけに依存せず、数値（%）も併記する。
 */
export function ProgressBar({ percent, label }: ProgressBarProps) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
        className="h-2 w-28 overflow-hidden rounded bg-gray-200"
      >
        <div className="h-full bg-blue-600" style={{ width: `${value}%` }} />
      </div>
      <span className="w-10 text-xs text-gray-700">{value}%</span>
    </div>
  );
}
