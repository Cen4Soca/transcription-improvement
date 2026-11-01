import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../hooks/useLanguage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

export interface LanguageSelectorProps {
  /**
   * 言語切替時に呼ばれる任意のコールバック。
   * Task 4 でプロファイルへの永続化を接続するために使用する。
   */
  onChange?: (lng: SupportedLanguage) => void;
}

/**
 * LanguageSelector - 表示言語を手動で切り替えるセレクタ。
 *
 * - ja / en を選択できる
 * - 選択すると即座に i18n の表示言語が変わり、localStorage に保存される
 * - onChange が渡された場合は選択後に呼び出す（プロファイル永続化用）
 */
export function LanguageSelector({ onChange }: LanguageSelectorProps) {
  const { t } = useTranslation('common');
  const { language, setLanguage } = useLanguage();
  const selectId = useId();

  const handleChange = (value: string) => {
    const next = value as SupportedLanguage;
    setLanguage(next);
    onChange?.(next);
  };

  const labelFor = (lng: SupportedLanguage): string =>
    lng === 'ja' ? t('languageJa') : t('languageEn');

  return (
    <div className="flex items-center gap-1">
      <label htmlFor={selectId} className="sr-only">
        {t('language')}
      </label>
      <select
        id={selectId}
        value={language}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={t('language')}
        className="text-sm rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {labelFor(lng)}
          </option>
        ))}
      </select>
    </div>
  );
}
