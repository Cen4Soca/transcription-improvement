import { useState } from 'react';
import type { TranscriptionApi, DownloadFormat, TranscriptionJsonResponse } from '../services/transcription-api';

export interface TranscriptionDownloadProps {
  transcriptionApi: TranscriptionApi;
  sessionId: string;
  sessionName: string;
}

/**
 * TranscriptionDownload - 修正後 Transcription ダウンロードコンポーネント
 *
 * - ダウンロード形式選択（JSON / SRT）
 * - ブラウザダウンロード機能でファイル提供
 * - 確定済み Segment が 0 件の場合のエラー表示
 *
 * Requirements: 5.1, 5.2, 5.3, 5.7, 5.8
 */
export function TranscriptionDownload({
  transcriptionApi,
  sessionId,
  sessionName,
}: TranscriptionDownloadProps) {
  const [format, setFormat] = useState<DownloadFormat>('json');
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generateFilename(ext: string): string {
    const now = new Date();
    const dateStr = now.getFullYear().toString()
      + (now.getMonth() + 1).toString().padStart(2, '0')
      + now.getDate().toString().padStart(2, '0');
    return `${sessionName}_${dateStr}.${ext}`;
  }

  function triggerBrowserDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // click() 直後に同期的に revoke するとブラウザがダウンロードを
    // 開始する前に Blob URL が無効化され、ファイルが保存されない場合がある。
    // 次のイベントループまで遅延させて確実にダウンロードを開始させる。
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handleDownload() {
    setIsDownloading(true);
    setError(null);

    try {
      if (format === 'json') {
        const result = await transcriptionApi.downloadJson(sessionId);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        const jsonData = result.value as TranscriptionJsonResponse;
        const content = JSON.stringify(jsonData, null, 2);
        const filename = generateFilename('json');
        triggerBrowserDownload(content, filename, 'application/json');
      } else {
        const result = await transcriptionApi.downloadSrt(sessionId);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        const content = result.value as string;
        const filename = generateFilename('srt');
        triggerBrowserDownload(content, filename, 'text/plain; charset=utf-8');
      }
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="space-y-4" aria-label="Transcription ダウンロード">
      <h3 className="text-base font-semibold text-gray-900">
        修正後 Transcription ダウンロード
      </h3>

      <div className="flex items-center gap-4">
        <fieldset>
          <legend className="sr-only">ダウンロード形式</legend>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="downloadFormat"
                value="json"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">JSON</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="downloadFormat"
                value="srt"
                checked={format === 'srt'}
                onChange={() => setFormat('srt')}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">SRT</span>
            </label>
          </div>
        </fieldset>

        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-busy={isDownloading}
        >
          {isDownloading ? (
            <>
              <svg
                className="w-4 h-4 mr-2 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              ダウンロード中...
            </>
          ) : (
            'ダウンロード'
          )}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
