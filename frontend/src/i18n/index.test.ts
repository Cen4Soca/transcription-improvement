import { describe, it, expect } from 'vitest';
import i18n, {
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  resources,
  NAMESPACES,
} from './index';

describe('i18n: normalizeLanguage', () => {
  it('サポート言語コードはそのまま返す', () => {
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage('en')).toBe('en');
  });

  it('地域付きコードは言語サブタグに丸める', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('ja-JP')).toBe('ja');
    expect(normalizeLanguage('EN')).toBe('en');
  });

  it('サポート外・空値は null を返す', () => {
    expect(normalizeLanguage('fr')).toBeNull();
    expect(normalizeLanguage('zh-CN')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
});

describe('i18n: 初期化設定', () => {
  it('サポート言語とフォールバックが設定されている', () => {
    expect(i18n.options.supportedLngs).toEqual(
      expect.arrayContaining([...SUPPORTED_LANGUAGES])
    );
    // fallbackLng は配列で正規化される
    expect(i18n.options.fallbackLng).toEqual([DEFAULT_LANGUAGE]);
  });

  it('言語検出は localStorage を最優先し、次に navigator を使う', () => {
    const detection = i18n.options.detection as {
      order?: string[];
      lookupLocalStorage?: string;
      caches?: string[];
    };
    expect(detection.order).toEqual(['localStorage', 'navigator']);
    expect(detection.lookupLocalStorage).toBe(LANGUAGE_STORAGE_KEY);
    // 自動キャッシュは無効（保存は useLanguage が明示的に行う）
    expect(detection.caches).toEqual([]);
  });

  it('ja / en の common リソースが登録されている', () => {
    expect(resources.ja.common).toBeDefined();
    expect(resources.en.common).toBeDefined();
    expect(i18n.getResource('ja', 'common', 'logout')).toBe('ログアウト');
    expect(i18n.getResource('en', 'common', 'logout')).toBe('Log out');
  });

  it('全 namespace が ja / en の両方に登録されている', () => {
    for (const ns of NAMESPACES) {
      expect(resources.ja[ns], `ja.${ns}`).toBeDefined();
      expect(resources.en[ns], `en.${ns}`).toBeDefined();
    }
  });
});

/** ネストしたオブジェクトのキーをドット区切りでフラット化する。 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe('i18n: ja / en のキー集合の一致', () => {
  it.each([...NAMESPACES])(
    'namespace "%s" は ja / en で同じキー集合を持つ',
    (ns) => {
      const jaKeys = flattenKeys(resources.ja[ns] as Record<string, unknown>).sort();
      const enKeys = flattenKeys(resources.en[ns] as Record<string, unknown>).sort();

      const missingInEn = jaKeys.filter((k) => !enKeys.includes(k));
      const missingInJa = enKeys.filter((k) => !jaKeys.includes(k));

      expect(missingInEn, `en.${ns} に不足しているキー`).toEqual([]);
      expect(missingInJa, `ja.${ns} に不足しているキー`).toEqual([]);
    }
  );
});
