import { useEffect, useRef } from 'react';
import { DraftStorage } from '../services/draft-storage';

const AUTO_SAVE_INTERVAL_MS = 5000; // 5 seconds

export interface UseAutoSaveOptions {
  sessionId: string;
  segmentId: string;
  text: string;
  enabled: boolean;
}

/**
 * useAutoSave - 編集中テキストを5秒間隔でlocalStorageに自動保存するカスタムフック
 *
 * - テキストが変更された場合のみ保存を実行
 * - enabled が false の場合は保存しない
 * - アンマウント時にクリーンアップ
 *
 * Requirements: 11.9
 */
export function useAutoSave(
  options: UseAutoSaveOptions,
  draftStorage: DraftStorage = new DraftStorage()
): void {
  const { sessionId, segmentId, text, enabled } = options;
  const lastSavedTextRef = useRef<string | null>(null);
  const storageRef = useRef(draftStorage);

  // Keep storage ref up to date
  useEffect(() => {
    storageRef.current = draftStorage;
  }, [draftStorage]);

  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      if (text !== lastSavedTextRef.current) {
        storageRef.current.saveDraft(sessionId, segmentId, text);
        lastSavedTextRef.current = text;
      }
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [sessionId, segmentId, text, enabled]);
}
