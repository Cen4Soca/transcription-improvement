import { useEffect, useState } from 'react';

/**
 * useOnlineStatus - ブラウザのオンライン/オフライン状態を購読するフック
 *
 * `navigator.onLine` を初期値とし、window の `online` / `offline` イベントを
 * 購読して状態を更新する。アンマウント時にリスナーを解除する。
 *
 * SSR 環境向けに `navigator` の存在を防御的にチェックするが、本アプリは
 * Vite の SPA なので実行時には常に window が存在する。
 *
 * @returns 現在オンラインなら true、オフラインなら false
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
