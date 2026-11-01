/**
 * jsdom は既定で localStorage を提供しないため、メモリベースの実装を用意する。
 *
 * このモジュールは副作用として window.localStorage を定義する。
 * i18n 初期化（LanguageDetector が localStorage を参照する）より前に
 * import される必要があるため、test-setup の先頭で読み込む。
 */
if (typeof window !== 'undefined' && !('localStorage' in window && window.localStorage)) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage,
    writable: true,
    configurable: true,
  });
}
