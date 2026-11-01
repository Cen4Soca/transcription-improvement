---
inclusion: always
---

# i18n・エラーコード規約（新規コードは必ず準拠）

フロントエンドは react-i18next による多言語対応（日本語 / 英語）へ移行中です。
基盤は導入済みのため、**新規に追加・改修するコードは最初から以下の規約に従うこと**。
既存コードのキー化・英語化は触れた画面/エンドポイントから順次進める（一括完了は前提にしない）。

## 1. フロントエンド UI テキスト（必須）

- **日本語ハードコード禁止**。JSX テキスト、`label` / `aria-label` / `placeholder` / `title` などの
  ユーザー可視文字列はすべて翻訳キー化する。
- `useTranslation(ns)` を使い、機能別 namespace のキーを参照する。
  ```tsx
  const { t } = useTranslation('review');
  return <button aria-label={t('saveCorrection')}>{t('save')}</button>;
  ```
- namespace は機能別に分割する: `common`, `navigation`, `review`, `admin`, `ranking`,
  `consensus`, `upload`, `languageModel`, `profile`, `transcriptionJob`, `errors`。
  新しい機能領域を追加する場合は namespace を増やしてよい。
- リソースは `frontend/src/i18n/locales/{ja,en}/<namespace>.json`。
  **キーを追加するときは ja / en の両方へ必ず追加する**（キー集合は一致させる）。
- 動的な値は i18n の補間を使う（文字列連結しない）: `t('itemCount', { count })`。
- 翻訳キー命名: キャメルケースのネスト。意味単位で命名する（`sessionList`, `emptyState.noData` 等）。

## 2. 言語決定の優先順位

優先順位は **プロファイル値 > localStorage > ブラウザ言語 > 既定(ja)**。

- 初期化（`frontend/src/i18n/index.ts`）が localStorage > navigator > ja を担う。
- ログイン後、`GET /me` の `preferredLanguage` があれば `i18n.changeLanguage` で上書きし
  localStorage も同期する（`hooks/useAuth.ts` / `services/auth-context.tsx`）。
- 手動切替（`components/LanguageSelector.tsx` / `hooks/useLanguage.ts`）は localStorage を更新し、
  ログイン時は `PATCH /me { preferredLanguage }` でプロファイルにも保存する。
- サポート言語・既定・正規化は `frontend/src/i18n/constants.ts` を正とする。

## 3. バックエンドのエラー（必須）

- **新規エラーは英語メッセージ + 詳細エラーコードで throw する**。
  日本語メッセージの新規追加は禁止（既存の日本語は順次英語化する）。
  ```ts
  import { notFoundError } from '../utils/error-handler.js';
  import { ERROR_CODES } from '../utils/error-codes.js';

  throw notFoundError('Session not found', undefined, ERROR_CODES.SESSION_NOT_FOUND);
  ```
- エラーファクトリのシグネチャは `(message, details?, errorCode?)`。
  `details` はサーバー内部向けの技術詳細（第2引数、従来どおり）、
  `errorCode` は意味単位の詳細コード（第3引数、`utils/error-codes.ts` の定数）。
- 新しい失敗パターンには `ERROR_CODES` に新コードを追加する（SCREAMING_SNAKE_CASE、ドメイン別）。
- レスポンス形状: `{ error: { code, message, details?, errorCode? } }`。
  `code` は HTTP カテゴリ（NOT_FOUND 等、後方互換のため維持）、`errorCode` が詳細コード。

## 4. フロントエンドのエラー表示（必須）

- バックエンドのエラーは `errorCode`（詳細コード）をキーに `errors` namespace で翻訳する。
  未知コードは返却された `message` にフォールバックする。
  ```tsx
  // 例: t(`errors.${error.errorCode}`, { defaultValue: error.message })
  ```
- 表示用の翻訳ヘルパが用意されている場合はそれを使う（重複実装しない）。

## 5. テスト

- i18n はテストセットアップ（`frontend/src/test-setup.ts`）でグローバル初期化され、
  デフォルト言語は ja に固定される。コンポーネントは `I18nextProvider` 無しで
  `useTranslation` を利用できる。
- テストはキー経由の表示結果（デフォルト ja）で期待値を書く。日本語リテラル直書きの期待は避け、
  翻訳キー基準に合わせる。
- 全フロントコンポーネントテストで `vitest-axe` の違反ゼロを維持する。

> 言語ルール（UI=日本語、コード/コメント=英語、など）の原則は `product.md` の Language Rules を正とする。
> 本ファイルはその原則を i18n/エラー実装へ落とし込む具体規約である。
