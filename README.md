# Transcription Review App

Amazon Transcribe が生成した文字起こし結果を、人間の校閲者（Reviewer）が確認・修正するための Web アプリケーションです。複数の Reviewer による多数決（Consensus）で信頼性の高い正答を確定し、AI による修正候補の提示やチームベースのアクセス制御を備えています。

> UI 表示テキストは日本語、コード・コメント・コミットメッセージは英語で統一しています。

## 主な機能

- セグメント単位での文字起こしテキストの閲覧・インライン編集
- 音声・動画との同期再生による校閲
- AI 修正候補の自動提示（Amazon Bedrock (Claude) + Amazon Comprehend + 過去の修正履歴）
- 複数 Reviewer の修正を集約した Consensus（多数決）による正答確定
- チームベースのアクセス制御と監査ログ
- コントリビューターランキング

## ロールと権限

ロール階層: **ADMIN > TEAM_LEADER > REVIEWER**（上位ロールは下位の権限を包含）

| Role | 権限 | スコープ |
|------|------|----------|
| Reviewer | 文字起こしの閲覧・修正、自分のセッション管理 | 自分のデータのみ |
| TeamLeader | Reviewer 権限 + メンバー管理、レビュー割り当て | 自チーム内 |
| Admin | 全権限（ユーザー管理、Consensus 設定、IP 制御、監査ログ） | システム全体 |

## アーキテクチャ

```
React 19 SPA (Vite 8) ──> API Gateway (HTTP API + JWT Authorizer) ──> Lambda (Handler → Service → Repository)
        │                                                                      │
   Cognito (認証)                                              DynamoDB (single-table) / S3 + CloudFront
        │                                                      Bedrock (Claude) / Comprehend / EventBridge
      WAF v2                                                              KMS (CMK)
```

### 技術スタック

- **Frontend**: React 19 + TypeScript (ESM), Vite 8, TailwindCSS 4, react-router-dom v7, aws-amplify v6 (Cognito)
- **Backend**: AWS Lambda (TypeScript, ESM), API Gateway HTTP API + JWT Authorizer, DynamoDB (single-table), S3 + CloudFront (署名付き URL), Bedrock (Claude) + Comprehend, EventBridge
- **Infrastructure**: AWS CDK (TypeScript), WAF v2, KMS (CMK), Cognito User Pools
- **Region**: `ap-northeast-1`（Bedrock はジオ別クロスリージョン推論プロファイルを使用）
- **Testing**: Vitest + React Testing Library + fast-check（Property-based）+ vitest-axe（WCAG 2.1 AA）, Playwright (E2E)

## リポジトリ構成

```
transcription-improvement/
├── frontend/   # React 19 SPA (Vite 8, TailwindCSS 4)
├── backend/    # AWS Lambda handlers (ESM, TypeScript) — Handler → Service → Repository
├── infra/      # AWS CDK (TypeScript) — Foundation → API → CDN → Monitoring
├── e2e/        # Playwright E2E テスト
└── .kiro/      # Spec / Steering / 設定
```

モノレポですが workspace レベルのパッケージマネージャは使いません。各パッケージ（`frontend/`, `backend/`, `infra/`, `e2e/`）で個別に `npm install` を実行してください。

## 前提条件

- Node.js 20 以上（CDK は Node 20 系推奨）
- npm
- AWS アカウントと認証情報（AWS CLI プロファイル等）
- デプロイ先リージョンでの Amazon Bedrock モデルアクセスの有効化

## セットアップ

```bash
# 各パッケージで個別に依存をインストール
cd frontend && npm install
cd ../backend && npm install
cd ../infra   && npm install
cd ../e2e     && npm install   # E2E を実行する場合のみ
```

### 環境変数（Frontend）

`frontend/.env.example` をコピーして `frontend/.env` を作成し、デプロイ済みリソースの値を設定します。

```bash
cp frontend/.env.example frontend/.env
```

| 変数 | 説明 |
|------|------|
| `VITE_BASE_PATH` | SPA のベースパス（ルート配信なら空） |
| `VITE_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_USER_POOL_CLIENT_ID` | Cognito App Client ID |
| `VITE_API_ENDPOINT` | API Gateway HTTP API のエンドポイント |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI ドメイン（任意） |

> `.env` および `.env.production` は実際の AWS リソース ID を含むため、リポジトリにはコミットされません（`.gitignore` 対象）。

### CDK コンテキスト（Infrastructure）

`infra/cdk.json` の `context` にデプロイ対象のアカウント ID やリソース ID を設定します。公開リポジトリでは値は空のプレースホルダになっています。環境ごとに別ファイルを用意し、デプロイ時に差し替えることもできます（`deploy.sh -c <path>`）。

主なコンテキストキー:

| キー | 説明 |
|------|------|
| `env` | 環境名（`dev` / `staging` / `prod`） |
| `account` / `region` | デプロイ先アカウント・リージョン |
| `cognitoUserPoolId` / `cognitoUserPoolClientId` / `cognitoDomain` | Cognito 設定 |
| `cloudFrontDistributionId` / `cloudFrontKeyPairId` / `cloudFrontPrivateKeyParam` | CloudFront 署名付き URL 設定 |
| `bedrockModelId` | 使用する Bedrock モデル（既定: JP ジオの Claude Haiku） |
| `allowedIpCidrs` | WAF の許可 IP CIDR |
| `initialAdminEmail` | 初期管理者のメールアドレス |

## 開発

```bash
# Frontend 開発サーバー
cd frontend && npm run dev

# ビルド
cd frontend && npm run build
cd backend  && npm run build
cd infra    && npm run build
```

## テスト

```bash
# Frontend（ユニット + プロパティ + アクセシビリティ）
cd frontend && npm test

# Backend（ユニット + プロパティ）
cd backend && npm test

# Backend 統合テスト（LocalStack が必要）
cd backend && npx vitest --run --config vitest.integration.config.ts

# Infrastructure（CDK スナップショット / アサーション）
cd infra && npm test

# E2E（Playwright。デプロイ済み環境と e2e/.env が必要）
cd e2e && npm test
```

Correction / Consensus / Score / Search / IP filtering / Upload / Download / Deletion / Language Model / Transcription Job などの重要ロジックは fast-check による Property-based テストで要件との整合を検証しています。

## デプロイ

```bash
cd infra

# 差分確認
npm run diff

# 全スタックをデプロイ（Foundation → API → CDN → Monitoring）
npm run deploy
```

ルートの `deploy.sh` はフロントエンドのビルドから CDK デプロイまでを一括実行するスクリプトです。使用前に `AWS_PROFILE` を自分の環境に合わせて設定してください（リポジトリ上はプレースホルダになっています）。

```bash
./deploy.sh                       # 既定の cdk.json を使用
./deploy.sh -c path/to/cdk.json   # 別の CDK コンテキストで上書き
```

## ドキュメント

- 詳細な仕様・設計は `.kiro/specs/` を参照してください。
- E2E テストのセットアップは `e2e/SETUP.md` を参照してください。

## ライセンス

本プロジェクトは [GNU General Public License v3.0](LICENSE)（GPL-3.0）の下で公開されています。詳細は `LICENSE` ファイルを参照してください。
