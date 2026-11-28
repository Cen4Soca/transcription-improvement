import { useCallback, useEffect, useState } from 'react';
import type { MonitoringApi } from '../services/monitoring-api';
import type { UserWorkloadItem } from '../types/monitoring';

/**
 * useUserWorkload - ユーザー別の担当数 / 進行中数 / 滞留数を取得する
 *
 * - `enabled` が false の間は取得しない（ADMIN 以外の誤呼び出し防止）。
 * - 取得に失敗してもユーザー管理画面本体は使えるよう、失敗時は空の集計にフォールバックする
 *   （列は 0 表示になる）。
 */
export function useUserWorkload(api: Pick<MonitoringApi, 'listUserWorkload' | 'listUserSessions'>, enabled: boolean) {
  const [workload, setWorkload] = useState<Record<string, UserWorkloadItem> | undefined>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const result = await api.listUserWorkload();
      if (cancelled) return;
      const items = result.ok ? result.value.data.items : [];
      setWorkload(Object.fromEntries(items.map((item) => [item.userId, item])));
    })();
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);

  const loadUserSessions = useCallback((userId: string) => api.listUserSessions(userId), [api]);

  return { workload, loadUserSessions };
}
