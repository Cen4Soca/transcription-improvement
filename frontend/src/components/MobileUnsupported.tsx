/**
 * MobileUnsupported - モバイルデバイス非対応メッセージコンポーネント
 *
 * 768px未満のビューポートで表示され、デスクトップブラウザの使用を促すメッセージを表示する。
 * TailwindCSS 4 のレスポンシブプレフィックス md: で表示/非表示を制御。
 *
 * Requirements: 11.6
 */

export function MobileUnsupported() {
  return (
    <div
      className="flex md:hidden items-center justify-center min-h-screen bg-gray-50 p-6"
      role="alert"
      aria-label="モバイルデバイス非対応"
    >
      <div className="text-center max-w-sm">
        <DeviceIcon />
        <h1 className="mt-4 text-lg font-semibold text-gray-900">
          デスクトップブラウザをご利用ください
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          本アプリケーションはデスクトップブラウザ（横幅1024px以上）での利用を推奨しています。タブレット（横幅768px以上）では簡易編集が可能です。
        </p>
      </div>
    </div>
  );
}

function DeviceIcon() {
  return (
    <svg
      className="mx-auto w-12 h-12 text-gray-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}
