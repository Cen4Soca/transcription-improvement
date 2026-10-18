/**
 * OfflineBanner - ネットワーク切断時に画面上部に「オフライン」バナーを表示するコンポーネント
 *
 * 接続復帰時に自動非表示になる。
 *
 * Requirements: 11.10, 11.11
 */

interface OfflineBannerProps {
  /** Whether the device is currently offline */
  isOffline: boolean;
}

export function OfflineBanner({ isOffline }: OfflineBannerProps) {
  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-50 bg-yellow-600 text-white text-center py-2 px-4 text-sm font-medium shadow-md"
    >
      オフライン — インターネット接続がありません
    </div>
  );
}
