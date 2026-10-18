# .kiro — Kiro ドキュメント

Kiro によるこのプロジェクトの継続的開発で参照する仕様・ガイダンス・設定をまとめています。
各ドキュメントの役割と「単一の正（single source of truth）」の所在を以下に示します。

## ディレクトリ構成

```
.kiro/
├── steering/   # 常時適用ルール（Kiro が全やり取りで自動参照）
├── specs/      # 機能仕様（requirements → design → tasks）
├── agents/     # Playwright 用エージェント定義
└── settings/   # Kiro 設定（mcp.json）
```

## steering/ — 常時適用ルール

Kiro が全てのやり取りで自動的に読み込む、プロジェクト横断のルールです。
以下の 3 ファイルが各テーマの**単一の正**です。

| ファイル | 役割（single source of truth） |
|---------|------|
| `steering/product.md` | プロダクト概要・ドメインモデル・ロール/権限・ビジネスルール・言語ルール |
| `steering/tech.md` | 技術スタック・コマンド・アーキテクチャ規約・コーディング/テスト規約・Bedrock リージョン方針 |
| `steering/structure.md` | ディレクトリ構成・ファイル配置ルール・構造的制約 |

> バージョン・コマンド・規約などの運用ルールは steering を正とし、specs 側は重複させず steering を参照します。

## specs/ — 機能仕様

| スペック | 種別 | 状態 | 内容 |
|---------|------|------|------|
| `specs/transcription-review-app/` | 機能（requirements / design / tasks） | 実装完了（178/178） | 本体アプリの全要件・設計・実装計画 |
| `specs/missing-frontend-consensus-and-team-assignment/` | バグ修正（bugfix / design / tasks） | 修正完了（14/14） | Consensus 閲覧・チーム割り当てのフロント欠落に対する修正 |

- 用語定義の**単一の正**は `specs/transcription-review-app/requirements.md` の Glossary です。
- `specs/transcription-review-app/design.md` は設計上の意思決定記録（なぜその技術/構成を選んだか）に焦点を当て、運用ルールは steering を参照します。

## 新しい機能・修正を Kiro で進めるには

1. steering（product / tech / structure）に目を通し、既存ルールを把握する。
2. `specs/` に新しいスペックディレクトリを作成し、requirements → design → tasks の順で合意する。
3. 既存の規約・用語は steering と `requirements.md` の Glossary を正として再利用し、重複定義を作らない。
4. コードと乖離が生じたら、まず steering と該当 spec を最新化してからコミットする。

## 関連

- プロジェクト全体の README・セットアップ・デプロイ手順はリポジトリ直下の `README.md`。
- Playwright テストプランの置き場所はリポジトリ直下の `specs/`（`.kiro/specs/` とは別物）。
