import { useState, useEffect, useCallback } from 'react';
import type { TranscriptionApi, StartTranscriptionJobRequest } from '../services/transcription-api';
import type { LanguageModelApi, LanguageModelSummary } from '../services/language-model-api';
import type { MediaFile } from '../services/media-api';

export interface TranscriptionJobFormProps {
  transcriptionApi: TranscriptionApi;
  languageModelApi: LanguageModelApi;
  mediaFiles: MediaFile[];
  onJobStarted?: (jobId: string) => void;
}

interface FormErrors {
  mediaFileId?: string;
  maxSpeakerLabels?: string;
  languageCode?: string;
  submit?: string;
}

const LANGUAGE_CODES = [
  { code: 'ja-JP', label: '日本語' },
  { code: 'en-US', label: '英語 (US)' },
  { code: 'en-GB', label: '英語 (UK)' },
  { code: 'zh-CN', label: '中国語 (簡体字)' },
  { code: 'ko-KR', label: '韓国語' },
  { code: 'fr-FR', label: 'フランス語' },
  { code: 'de-DE', label: 'ドイツ語' },
  { code: 'es-ES', label: 'スペイン語' },
];

const MIN_SPEAKERS = 2;
const MAX_SPEAKERS = 10;
const DEFAULT_SPEAKERS = 2;
const DEFAULT_LANGUAGE_CODE = 'ja-JP';

/**
 * TranscriptionJobForm - Transcription ジョブ作成フォームコンポーネント
 *
 * - メディアファイル選択
 * - MaxSpeakerLabels 入力（2〜10）
 * - 言語コード選択
 * - カスタム言語モデル選択（利用可能なモデル一覧から選択、0 件時は「利用可能なモデルなし」表示）
 * - バリデーションエラー表示
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5
 */
export function TranscriptionJobForm({
  transcriptionApi,
  languageModelApi,
  mediaFiles,
  onJobStarted,
}: TranscriptionJobFormProps) {
  const [mediaFileId, setMediaFileId] = useState('');
  const [maxSpeakerLabels, setMaxSpeakerLabels] = useState<string>(String(DEFAULT_SPEAKERS));
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const [languageModelName, setLanguageModelName] = useState('');
  const [models, setModels] = useState<LanguageModelSummary[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load available language models on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      setIsLoadingModels(true);
      const result = await languageModelApi.listModels();
      if (cancelled) return;

      if (result.ok) {
        setModels(result.value.models);
      }
      setIsLoadingModels(false);
    }

    fetchModels();

    return () => {
      cancelled = true;
    };
  }, [languageModelApi]);

  const validate = useCallback((): FormErrors => {
    const newErrors: FormErrors = {};

    if (!mediaFileId) {
      newErrors.mediaFileId = 'メディアファイルを選択してください';
    }

    const speakerCount = parseInt(maxSpeakerLabels, 10);
    if (isNaN(speakerCount)) {
      newErrors.maxSpeakerLabels = '話者数を入力してください';
    } else if (speakerCount < MIN_SPEAKERS || speakerCount > MAX_SPEAKERS) {
      newErrors.maxSpeakerLabels = `話者数は${MIN_SPEAKERS}〜${MAX_SPEAKERS}の範囲で指定してください`;
    }

    if (!languageCode) {
      newErrors.languageCode = '言語を選択してください';
    }

    return newErrors;
  }, [mediaFileId, maxSpeakerLabels, languageCode]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const validationErrors = validate();
      setErrors(validationErrors);

      if (Object.keys(validationErrors).length > 0) {
        return;
      }

      setIsSubmitting(true);
      setErrors({});

      const params: StartTranscriptionJobRequest = {
        mediaFileId,
        maxSpeakerLabels: parseInt(maxSpeakerLabels, 10),
        languageCode,
      };

      if (languageModelName) {
        params.languageModelName = languageModelName;
      }

      const result = await transcriptionApi.startJob(params);

      if (result.ok) {
        onJobStarted?.(result.value.jobId);
        // Reset form
        setMediaFileId('');
        setMaxSpeakerLabels(String(DEFAULT_SPEAKERS));
        setLanguageCode(DEFAULT_LANGUAGE_CODE);
        setLanguageModelName('');
      } else {
        setErrors({ submit: result.error.message });
      }

      setIsSubmitting(false);
    },
    [mediaFileId, maxSpeakerLabels, languageCode, languageModelName, transcriptionApi, onJobStarted, validate],
  );

  const uploadedFiles = mediaFiles.filter(
    (f) => f.status === 'UPLOADED' || f.status === 'COMPLETED',
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 bg-white border border-gray-200 rounded-lg p-6"
      aria-label="Transcription ジョブ作成フォーム"
      noValidate
    >
      <h2 className="text-lg font-semibold text-gray-900">文字起こしジョブ作成</h2>

      {/* Media file selection */}
      <div>
        <label htmlFor="media-file-select" className="block text-sm font-medium text-gray-700">
          メディアファイル <span className="text-red-500">*</span>
        </label>
        <select
          id="media-file-select"
          value={mediaFileId}
          onChange={(e) => {
            setMediaFileId(e.target.value);
            if (errors.mediaFileId) setErrors((prev) => ({ ...prev, mediaFileId: undefined }));
          }}
          className={`mt-1 block w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            errors.mediaFileId ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          aria-invalid={!!errors.mediaFileId}
          aria-describedby={errors.mediaFileId ? 'media-file-error' : undefined}
          disabled={isSubmitting}
        >
          <option value="">ファイルを選択...</option>
          {uploadedFiles.map((file) => (
            <option key={file.mediaFileId} value={file.mediaFileId}>
              {file.filename}
            </option>
          ))}
        </select>
        {errors.mediaFileId && (
          <p id="media-file-error" className="mt-1 text-xs text-red-600" role="alert">
            {errors.mediaFileId}
          </p>
        )}
      </div>

      {/* MaxSpeakerLabels input */}
      <div>
        <label htmlFor="max-speaker-labels" className="block text-sm font-medium text-gray-700">
          最大話者数 <span className="text-red-500">*</span>
        </label>
        <input
          id="max-speaker-labels"
          type="number"
          min={MIN_SPEAKERS}
          max={MAX_SPEAKERS}
          value={maxSpeakerLabels}
          onChange={(e) => {
            setMaxSpeakerLabels(e.target.value);
            if (errors.maxSpeakerLabels) setErrors((prev) => ({ ...prev, maxSpeakerLabels: undefined }));
          }}
          className={`mt-1 block w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            errors.maxSpeakerLabels ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          aria-invalid={!!errors.maxSpeakerLabels}
          aria-describedby="max-speaker-labels-help max-speaker-labels-error"
          disabled={isSubmitting}
        />
        <p id="max-speaker-labels-help" className="mt-1 text-xs text-gray-500">
          音声内の話者数を指定します（{MIN_SPEAKERS}〜{MAX_SPEAKERS}）
        </p>
        {errors.maxSpeakerLabels && (
          <p id="max-speaker-labels-error" className="mt-1 text-xs text-red-600" role="alert">
            {errors.maxSpeakerLabels}
          </p>
        )}
      </div>

      {/* Language code selection */}
      <div>
        <label htmlFor="language-code-select" className="block text-sm font-medium text-gray-700">
          言語 <span className="text-red-500">*</span>
        </label>
        <select
          id="language-code-select"
          value={languageCode}
          onChange={(e) => {
            setLanguageCode(e.target.value);
            if (errors.languageCode) setErrors((prev) => ({ ...prev, languageCode: undefined }));
          }}
          className={`mt-1 block w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            errors.languageCode ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          aria-invalid={!!errors.languageCode}
          aria-describedby={errors.languageCode ? 'language-code-error' : undefined}
          disabled={isSubmitting}
        >
          {LANGUAGE_CODES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label} ({lang.code})
            </option>
          ))}
        </select>
        {errors.languageCode && (
          <p id="language-code-error" className="mt-1 text-xs text-red-600" role="alert">
            {errors.languageCode}
          </p>
        )}
      </div>

      {/* Custom language model selection */}
      <div>
        <label htmlFor="language-model-select" className="block text-sm font-medium text-gray-700">
          カスタム言語モデル（オプション）
        </label>
        {isLoadingModels ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <span>モデル一覧を読み込み中...</span>
          </div>
        ) : models.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500 italic">利用可能なモデルなし</p>
        ) : (
          <select
            id="language-model-select"
            value={languageModelName}
            onChange={(e) => setLanguageModelName(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isSubmitting}
          >
            <option value="">モデルを使用しない</option>
            {models.map((model) => (
              <option key={model.modelName} value={model.modelName}>
                {model.modelName}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Submit error */}
      {errors.submit && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert" aria-live="assertive">
          <p className="text-sm text-red-700">{errors.submit}</p>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? '作成中...' : '文字起こしジョブを開始'}
      </button>
    </form>
  );
}
