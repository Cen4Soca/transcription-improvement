# E2E テスト実行 事前準備ガイド

## 目次

1. [前提条件](#1-前提条件)
2. [Playwright のインストール](#2-playwright-のインストール)
3. [環境変数の設定](#3-環境変数の設定)
4. [テスト対象環境の準備](#4-テスト対象環境の準備)
5. [Admin テストユーザーの準備](#5-admin-テストユーザーの準備)
6. [シードデータの投入](#6-シードデータの投入)
7. [globalSetup / globalTeardown の実装](#7-globalsetup--globalteardown-の実装)
8. [Playwright 設定ファイル](#8-playwright-設定ファイル)
9. [認証フィクスチャ](#9-認証フィクスチャ)
10. [実行手順](#10-実行手順)
11. [トラブルシューティング](#11-トラブルシューティング)

### 補足

- [MediaFile シードデータの投入方法](#補足-mediafile-シードデータの投入方法)

---

## 1. 前提条件

以下がローカル環境にインストールされていること：

| ツール | 最低バージョン | 確認コマンド |
|--------|--------------|-------------|
| Node.js | 20.x | `node --version` |
| npm | 10.x | `npm --version` |
| AWS CLI | 2.x | `aws --version` |

### AWS 認証情報

テスト対象の AWS アカウントに対する認証情報が設定されていること：

```bash
# プロファイル確認
aws sts get-caller-identity --profile <your-profile>
```

必要な IAM 権限（テストデータ投入・Cognito ユーザー操作用）:
- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminSetUserPassword`
- `cognito-idp:AdminDisableUser`
- `cognito-idp:AdminDeleteUser`
- `cognito-idp:AdminUpdateUserAttributes`
- `cognito-idp:AdminInitiateAuth`
- `dynamodb:PutItem`, `dynamodb:BatchWriteItem`, `dynamodb:DeleteItem`

---

## 2. Playwright のインストール

`e2e/` ディレクトリに独立した `package.json` を作成する：

```bash
cd e2e
npm init -y
npm install -D @playwright/test @aws-sdk/client-cognito-identity-provider dotenv
npx playwright install --with-deps chromium
```

> **補足**: `chromium` のみインストールすることで CI の時間とストレージを節約。
> マルチブラウザテストが必要な場合は `npx playwright install` で全ブラウザを追加。

### ディレクトリ構成（最終形）

```
e2e/
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── .env                      # ローカル用（.gitignore 対象）
├── .env.example              # テンプレート（Git 管理）
├── .gitignore
├── global-setup.ts
├── global-teardown.ts
├── .auth/                    # 認証状態保存（.gitignore 対象）
│   └── test-users.json
├── fixtures/
│   └── auth.ts
├── helpers/
│   ├── cognito-helper.ts     # Cognito Admin SDK ラッパー
│   └── api-helper.ts         # テスト用 API 直接呼び出し
├── seed/
│   └── seed-data.ts          # DynamoDB シードデータ投入
└── tests/
    └── ...
```

---

## 3. 環境変数の設定

`.env.example` を `.env` にコピーし、各値を設定する：

```bash
cp .env.example .env
```

### `.env.example` の内容

```env
# テスト対象のフロントエンド URL
BASE_URL=https://dev.example.com

# API エンドポイント URL（Admin API 直接呼び出し用）
API_ENDPOINT=https://api-dev.example.com

# Cognito 設定（Admin SDK 操作用）
COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=ap-northeast-1

# Admin ユーザー認証情報（事前に Cognito に登録済み）
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=YourSecurePassword123!

# テストユーザーに設定するパスワード
TEST_USER_PASSWORD=E2eTest@Password789

# AWS プロファイル（DynamoDB シード投入に使用）
AWS_PROFILE=dev
AWS_REGION=ap-northeast-1

# DynamoDB テーブル名
DYNAMODB_TABLE_NAME=TranscriptionReviewApp
```

### 値の取得方法

| 変数 | 取得方法 |
|------|---------|
| `BASE_URL` | `aws cloudformation describe-stacks --stack-name CdnStack` の Outputs から CloudFront URL |
| `API_ENDPOINT` | `aws cloudformation describe-stacks --stack-name ApiStack` の Outputs から API URL |
| `COGNITO_USER_POOL_ID` | `aws cognito-idp list-user-pools --max-results 10` |
| `COGNITO_CLIENT_ID` | `aws cognito-idp list-user-pool-clients --user-pool-id <pool-id>` |

---

## 4. テスト対象環境の準備

### 方式 A: デプロイ済み dev 環境に対してテスト（推奨）

```bash
# dev 環境にデプロイ済みであることを確認
cd infra
npx cdk diff --all --context env=dev
```

テストは CloudFront 経由で配信されたフロントエンド + API Gateway に対して実行する。
この場合 `BASE_URL` はデプロイ済みの CloudFront URL を設定する。

### 方式 B: ローカル開発サーバーに対してテスト

```bash
# フロントエンド起動
cd frontend
npm install
npm run dev
# → http://localhost:5173

# .env に設定
# BASE_URL=http://localhost:5173
# API_ENDPOINT は dev 環境の API Gateway URL を指定
```

> **注意**: ローカルの場合でも API は dev 環境（AWS）のものを使用する。
> Cognito 認証も実際の User Pool に対して行われる。

---

## 5. Admin テストユーザーの準備

テスト実行には **1 名の Admin ユーザー** が Cognito に事前登録されている必要がある。
このユーザーは `globalSetup` で TeamLeader / Reviewer を作成するために使用する。

### 5.1 Cognito に Admin ユーザーを作成（初回のみ）

```bash
# ユーザー作成
aws cognito-idp admin-create-user \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --username admin-e2e@example.com \
  --user-attributes \
    Name=email,Value=admin-e2e@example.com \
    Name=email_verified,Value=true \
    Name=custom:role,Value=ADMIN \
    Name=custom:displayName,Value="E2E Admin" \
  --temporary-password 'TempPass123!' \
  --message-action SUPPRESS \
  --region ap-northeast-1
```

### 5.2 パスワードを確定する（FORCE_CHANGE_PASSWORD 解除）

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --username admin-e2e@example.com \
  --password 'E2eAdmin@Password123' \
  --permanent \
  --region ap-northeast-1
```

### 5.3 DynamoDB にも Admin ユーザーレコードを登録

```bash
aws dynamodb put-item \
  --table-name TranscriptionReviewApp \
  --item '{
    "PK": {"S": "USER#<userId>"},
    "SK": {"S": "PROFILE"},
    "userId": {"S": "<userId>"},
    "email": {"S": "admin-e2e@example.com"},
    "displayName": {"S": "E2E Admin"},
    "role": {"S": "ADMIN"},
    "isActive": {"BOOL": true},
    "createdAt": {"S": "2024-01-01T00:00:00.000Z"},
    "GSI1PK": {"S": "ROLE#ADMIN"},
    "GSI1SK": {"S": "USER#<userId>"}
  }' \
  --region ap-northeast-1
```

> `<userId>` は UUID v4 で生成: `uuidgen | tr '[:upper:]' '[:lower:]'`

### 5.4 ログイン確認

```bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --client-id <client-id> \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters \
    USERNAME=admin-e2e@example.com,PASSWORD='E2eAdmin@Password123' \
  --region ap-northeast-1
```

`AuthenticationResult.IdToken` が返れば準備完了。

---

## 6. シードデータの投入

テストが依存するデータを DynamoDB に事前投入する。
`e2e/seed/seed-data.ts` にスクリプトを用意する。

### 必要なシードデータ

| データ種別 | 件数 | 用途 |
|-----------|------|------|
| ReviewSession (PENDING) | 20+ | フィルターテスト |
| ReviewSession (IN_PROGRESS) | 20+ | フィルターテスト |
| ReviewSession (COMPLETED) | 20+ | フィルターテスト + ページネーション |
| MediaFile (音声) | 3+ | 校閲画面テスト |
| MediaFile (動画) | 1+ | 動画再生テスト |
| Transcription + Segments | 3+ | セグメント編集テスト |
| Correction | 10+ | Consensus テスト |
| Team | 2+ | チーム管理テスト |
| ランキングデータ | 30+ | ページネーション・フィルターテスト |
| IP Allowlist エントリ | 3+ | IP 管理テスト |
| 監査ログ | 50+ | 監査ログ検索・ページネーションテスト |

### シードスクリプトの実行

```bash
cd e2e
npx tsx seed/seed-data.ts
```

> **注意**: シードデータは冪等に設計する（再実行しても重複しない）。
> テスト固有の ID プレフィックス `e2e-` を付与して本番データと区別する。

---

## 7. globalSetup / globalTeardown の実装

### 7.1 globalSetup の処理フロー

```typescript
// e2e/global-setup.ts
import { chromium } from '@playwright/test';

export default async function globalSetup() {
  // 1. Admin で Cognito にログイン（Admin SDK 経由）
  // 2. Admin API 経由で TeamLeader ユーザーを作成
  //    POST /admin/users { email, displayName, role: "TEAM_LEADER" }
  // 3. Admin API 経由で Reviewer ユーザーを作成
  //    POST /admin/users { email, displayName, role: "REVIEWER" }
  // 4. Cognito で作成されたユーザーのパスワードを確定
  //    aws cognito-idp admin-set-user-password --permanent
  // 5. ユーザー情報を .auth/test-users.json に保存
  // 6. 必要に応じてチーム作成 + メンバー割り当て
}
```

### 7.2 globalSetup の詳細実装ポイント

#### ユーザー作成の流れ

```
Admin ログイン (Cognito AdminInitiateAuth)
     ↓ IdToken 取得
POST /admin/users (API Gateway 経由)
     ↓ Cognito にユーザー作成 + DynamoDB に登録
     ↓ 初期状態: FORCE_CHANGE_PASSWORD
Cognito AdminSetUserPassword (--permanent)
     ↓ パスワード確定 → CONFIRMED 状態
.auth/test-users.json に保存
```

#### `.auth/test-users.json` の構造

```json
{
  "createdAt": "2024-12-01T10:00:00.000Z",
  "teamLeader": {
    "userId": "uuid-xxx",
    "email": "e2e-leader-1701424800@test.example.com",
    "displayName": "E2E テストリーダー",
    "role": "TEAM_LEADER",
    "password": "E2eTest@Password789"
  },
  "reviewer": {
    "userId": "uuid-yyy",
    "email": "e2e-reviewer-1701424800@test.example.com",
    "displayName": "E2E テストレビュアー",
    "role": "REVIEWER",
    "password": "E2eTest@Password789"
  },
  "teamId": "e2e-team-xxx"
}
```

### 7.3 globalTeardown の処理フロー

```typescript
// e2e/global-teardown.ts
export default async function globalTeardown() {
  // 1. .auth/test-users.json を読み込み
  // 2. Admin で Cognito にログイン
  // 3. Admin API 経由で Reviewer を無効化
  //    PATCH /admin/users/{userId} { isActive: false }
  // 4. Admin API 経由で TeamLeader を無効化
  //    PATCH /admin/users/{userId} { isActive: false }
  // 5. Cognito からユーザーを完全削除
  //    aws cognito-idp admin-delete-user
  // 6. テスト中に作成したチーム・データを削除
  // 7. .auth/test-users.json を削除
}
```

> **重要**: teardown は必ず try-catch でラップし、一部が失敗しても残りのクリーンアップが続行されるようにする。

---

## 8. Playwright 設定ファイル

### `e2e/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,          // 認証状態の共有があるため順次実行
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

### `e2e/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### `e2e/.gitignore`

```
node_modules/
dist/
.auth/
.env
test-results/
playwright-report/
blob-report/
```

---

## 9. 認証フィクスチャ

### `e2e/helpers/cognito-helper.ts`

Cognito Admin SDK を使った認証ヘルパー：

```typescript
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || 'ap-northeast-1',
});

/**
 * Admin SDK でログインし、IdToken を取得する
 */
export async function adminAuth(
  email: string,
  password: string
): Promise<{ idToken: string; accessToken: string }> {
  const res = await client.send(new AdminInitiateAuthCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID!,
    ClientId: process.env.COGNITO_CLIENT_ID!,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  }));

  return {
    idToken: res.AuthenticationResult!.IdToken!,
    accessToken: res.AuthenticationResult!.AccessToken!,
  };
}

/**
 * ユーザーのパスワードを永続的に設定する
 */
export async function setUserPassword(
  email: string,
  password: string
): Promise<void> {
  await client.send(new AdminSetUserPasswordCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID!,
    Username: email,
    Password: password,
    Permanent: true,
  }));
}

/**
 * Cognito からユーザーを完全削除する
 */
export async function deleteUser(email: string): Promise<void> {
  await client.send(new AdminDeleteUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID!,
    Username: email,
  }));
}
```

### `e2e/fixtures/auth.ts`

Playwright テストで使う認証フィクスチャ：

```typescript
import { test as base, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface TestUsers {
  teamLeader: { email: string; password: string; userId: string };
  reviewer: { email: string; password: string; userId: string };
}

// globalSetup で作成されたユーザー情報を読み込む
function loadTestUsers(): TestUsers {
  const filePath = path.resolve(__dirname, '../.auth/test-users.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

type AuthFixtures = {
  loginAsAdmin: (page: Page) => Promise<void>;
  loginAsTeamLeader: (page: Page) => Promise<void>;
  loginAsReviewer: (page: Page) => Promise<void>;
};

export const test = base.extend<AuthFixtures>({
  loginAsAdmin: async ({}, use) => {
    const login = async (page: Page) => {
      await page.goto('/');
      // Cognito Hosted UI をバイパスして直接ログイン
      // または LoginForm を使用
      await page.getByLabel('メールアドレス').fill(process.env.ADMIN_EMAIL!);
      await page.getByLabel('パスワード').fill(process.env.ADMIN_PASSWORD!);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await page.waitForURL('/');
    };
    await use(login);
  },

  loginAsTeamLeader: async ({}, use) => {
    const users = loadTestUsers();
    const login = async (page: Page) => {
      await page.goto('/');
      await page.getByLabel('メールアドレス').fill(users.teamLeader.email);
      await page.getByLabel('パスワード').fill(users.teamLeader.password);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await page.waitForURL('/');
    };
    await use(login);
  },

  loginAsReviewer: async ({}, use) => {
    const users = loadTestUsers();
    const login = async (page: Page) => {
      await page.goto('/');
      await page.getByLabel('メールアドレス').fill(users.reviewer.email);
      await page.getByLabel('パスワード').fill(users.reviewer.password);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await page.waitForURL('/');
    };
    await use(login);
  },
});

export { expect } from '@playwright/test';
```

> **注意**: アプリが Cognito Hosted UI (signInWithRedirect) を使用する場合、
> テスト用の Cognito App Client で `ALLOW_USER_PASSWORD_AUTH` フローを有効にし、
> LoginForm コンポーネント経由でログインする必要がある。
> または、テスト環境専用に `VITE_AUTH_MODE=form` のような環境変数で
> LoginForm を強制表示する仕組みを用意する。

---

## 10. 実行手順

### 初回セットアップ（一度だけ）

```bash
# 1. e2e ディレクトリに移動
cd e2e

# 2. 依存関係インストール
npm install

# 3. Playwright ブラウザインストール
npx playwright install --with-deps chromium

# 4. 環境変数ファイル作成
cp .env.example .env
# → .env を実際の値で埋める

# 5. Admin ユーザーが Cognito + DynamoDB に存在することを確認
# （セクション5参照）

# 6. シードデータ投入
npx tsx seed/seed-data.ts
```

### テスト実行

```bash
# 全テスト実行
npx playwright test

# 特定スイートのみ
npx playwright test tests/auth/
npx playwright test tests/admin/

# UI モードで実行（デバッグ用）
npx playwright test --ui

# headed モードで実行（ブラウザ表示）
npx playwright test --headed

# 特定テストのみ
npx playwright test -g "セッション一覧"
```

### テストレポート確認

```bash
npx playwright show-report
```

### CI/CD での実行

```yaml
# GitHub Actions 例
- name: Run E2E tests
  working-directory: e2e
  env:
    BASE_URL: ${{ secrets.E2E_BASE_URL }}
    API_ENDPOINT: ${{ secrets.E2E_API_ENDPOINT }}
    COGNITO_USER_POOL_ID: ${{ secrets.COGNITO_USER_POOL_ID }}
    COGNITO_CLIENT_ID: ${{ secrets.COGNITO_CLIENT_ID }}
    COGNITO_REGION: ap-northeast-1
    ADMIN_EMAIL: ${{ secrets.E2E_ADMIN_EMAIL }}
    ADMIN_PASSWORD: ${{ secrets.E2E_ADMIN_PASSWORD }}
    TEST_USER_PASSWORD: ${{ secrets.E2E_TEST_USER_PASSWORD }}
  run: |
    npm ci
    npx playwright install --with-deps chromium
    npx playwright test
```

---

## 11. トラブルシューティング

### 認証関連

| 問題 | 原因 | 対処 |
|------|------|------|
| `NotAuthorizedException` | パスワード不一致 or ユーザー無効 | `.env` の認証情報を確認。Cognito コンソールでユーザー状態を確認 |
| `UserNotFoundException` | ユーザーが存在しない | セクション 5 の手順で Admin ユーザーを再作成 |
| `InvalidParameterException` | Client に AUTH_FLOW 未設定 | Cognito App Client で `ALLOW_USER_PASSWORD_AUTH` を有効化 |
| Hosted UI にリダイレクトされる | LoginForm が表示されない | テスト環境で LoginForm を強制表示する設定を追加 |
| `FORCE_CHANGE_PASSWORD` | パスワード未確定 | `admin-set-user-password --permanent` を実行 |

### globalSetup 失敗

| 問題 | 原因 | 対処 |
|------|------|------|
| ユーザー作成 API が 403 | Admin トークン期限切れ | `.env` のパスワードが正しいか確認 |
| ユーザー作成 API が 400 | メールアドレス重複 | 前回の teardown が失敗している。手動でクリーンアップ |
| `.auth/test-users.json` がない | globalSetup 未実行 or 失敗 | `npx playwright test` で自動実行される。ログを確認 |

### 手動クリーンアップ（teardown 失敗時）

```bash
# Cognito からテストユーザーを手動削除
aws cognito-idp admin-delete-user \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --username "e2e-leader-XXXXXXXXXX@test.example.com" \
  --region ap-northeast-1

aws cognito-idp admin-delete-user \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --username "e2e-reviewer-XXXXXXXXXX@test.example.com" \
  --region ap-northeast-1

# DynamoDB からテストデータを削除（e2e- プレフィックスで検索）
aws dynamodb scan \
  --table-name TranscriptionReviewApp \
  --filter-expression "begins_with(PK, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"USER#e2e-"}}' \
  --region ap-northeast-1
```

### テスト実行時

| 問題 | 原因 | 対処 |
|------|------|------|
| タイムアウト | ページ読み込み遅延 | `timeout` を増やす。ネットワーク状態を確認 |
| 要素が見つからない | UI テキスト変更 | aria-label やロールベースのロケータを使用 |
| テストが不安定 (flaky) | アニメーション・非同期処理 | `waitForSelector` / `waitForResponse` を追加 |
| スクリーンショットが真っ白 | SPA ルーティング未完了 | `waitForURL` で遷移完了を待つ |

---

## チェックリスト（実行前確認）

- [ ] Node.js 20+ がインストールされている
- [ ] `e2e/` で `npm install` 済み
- [ ] Playwright ブラウザがインストール済み
- [ ] `.env` ファイルが全項目設定済み
- [ ] Cognito に Admin ユーザーが存在し、ログインできる
- [ ] API エンドポイントにアクセスできる（CORS / WAF 設定確認）
- [ ] DynamoDB にシードデータが投入済み
- [ ] テスト対象の Web アプリがアクセス可能（`BASE_URL` に疎通確認）
- [ ] Cognito App Client で `ALLOW_USER_PASSWORD_AUTH` が有効
- [ ] テスト実行元の IP が WAF 許可リストに含まれている


---

## 補足: MediaFile シードデータの投入方法

MediaFile のシードデータは **DynamoDB レコード投入 + S3 オブジェクト配置** の 2 ステップが必要。

### アーキテクチャ概要

```
通常フロー:
  ユーザー → POST /upload-url → presignedURL 取得
  ユーザー → PUT (S3) → ファイルアップロード
  S3 Event → process-upload Lambda → DynamoDB に MediaFile レコード作成

シードデータ投入:
  手動で DynamoDB にレコードを直接作成
  手動で S3 にサンプルファイルを配置
  （process-upload Lambda はスキップ）
```

### ステップ 1: サンプルメディアファイルの準備

テスト用の短い音声・動画ファイルを用意する（著作権フリーのもの）。

```
e2e/seed/media-files/
├── sample-audio.mp3     # 5秒程度の音声ファイル
├── sample-audio.wav     # WAV 形式のサンプル
└── sample-video.mp4     # 5秒程度の動画ファイル
```

> **Tips**: `ffmpeg` で無音のダミーファイルを生成できる：
> ```bash
> # 5秒の無音 MP3
> ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -q:a 9 seed/media-files/sample-audio.mp3
> # 5秒の無音 WAV
> ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 seed/media-files/sample-audio.wav
> # 5秒のダミー動画（黒画面＋無音）
> ffmpeg -f lavfi -i color=c=black:s=320x240:d=5 -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -shortest seed/media-files/sample-video.mp4
> ```

---

### ステップ 2: S3 にメディアファイルをアップロード

S3 のキー構造は `media/{mediaFileId}/{filename}` である。

```bash
# バケット名の取得
MEDIA_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name FoundationStack \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" \
  --output text \
  --region ap-northeast-1)

echo "Media Bucket: $MEDIA_BUCKET"

# サンプルファイルのアップロード
aws s3 cp seed/media-files/sample-audio.mp3 \
  "s3://${MEDIA_BUCKET}/media/e2e-media-001/sample-audio.mp3" \
  --content-type "audio/mpeg" \
  --region ap-northeast-1

aws s3 cp seed/media-files/sample-audio.wav \
  "s3://${MEDIA_BUCKET}/media/e2e-media-002/sample-audio.wav" \
  --content-type "audio/wav" \
  --region ap-northeast-1

aws s3 cp seed/media-files/sample-video.mp4 \
  "s3://${MEDIA_BUCKET}/media/e2e-media-003/sample-video.mp4" \
  --content-type "video/mp4" \
  --region ap-northeast-1

aws s3 cp seed/media-files/sample-audio.mp3 \
  "s3://${MEDIA_BUCKET}/media/e2e-media-004/sample-audio-for-delete.mp3" \
  --content-type "audio/mpeg" \
  --region ap-northeast-1
```

> **注意**: S3 アップロードすると `process-upload` Lambda が自動トリガーされ、
> DynamoDB にレコードが作成される。ただし `uploadedBy` は `"system"` になる。
> テストで特定ユーザーの所有として扱いたい場合は、ステップ 3 で上書きする。

---

### ステップ 3: DynamoDB に MediaFile レコードを投入（上書き or 直接作成）

S3 トリガーで自動作成されたレコードをテスト用に上書きするか、
トリガーを待たずに直接 DynamoDB にレコードを作成する。

#### DynamoDB の MediaFile レコード構造

| 属性 | 型 | 値の例 | 説明 |
|------|------|--------|------|
| `PK` | String | `MEDIA#e2e-media-001` | パーティションキー |
| `SK` | String | `METADATA` | ソートキー（固定値） |
| `entityType` | String | `MediaFile` | エンティティ識別子 |
| `mediaFileId` | String | `e2e-media-001` | UUID（テスト用プレフィックス付き） |
| `filename` | String | `sample-audio.mp3` | 元のファイル名 |
| `s3Key` | String | `media/e2e-media-001/sample-audio.mp3` | S3 オブジェクトキー |
| `s3Bucket` | String | `transcription-review-media-123456789012` | S3 バケット名 |
| `contentType` | String | `audio/mpeg` | MIME タイプ |
| `fileSize` | Number | `48000` | バイト数 |
| `uploadedBy` | String | `<admin-userId>` | アップロードユーザーの userId |
| `teamId` | String | `e2e-team-001` | チーム ID（オプション） |
| `status` | String | `COMPLETED` | ステータス |
| `scanStatus` | String | `CLEAN` | マルウェアスキャン結果 |
| `sessionId` | String | `e2e-session-001` | 紐づくセッション ID（オプション） |
| `createdAt` | String | `2024-06-01T00:00:00.000Z` | ISO 8601 |
| `updatedAt` | String | `2024-06-01T00:00:00.000Z` | ISO 8601 |
| `uploadedAt` | String | `2024-06-01T00:00:00.000Z` | アップロード日時 |
| `GSI1PK` | String | `TEAM#e2e-team-001` | GSI1 パーティションキー |
| `GSI1SK` | String | `MEDIA#2024-06-01T00:00:00.000Z#e2e-media-001` | GSI1 ソートキー |
| `GSI2PK` | String | `USER#<admin-userId>` | GSI2 パーティションキー |
| `GSI2SK` | String | `MEDIA#2024-06-01T00:00:00.000Z#e2e-media-001` | GSI2 ソートキー |

---

#### AWS CLI での投入例

```bash
TABLE_NAME="TranscriptionReviewApp"
MEDIA_BUCKET="transcription-review-media-123456789012"  # 実際のバケット名に置き換え
ADMIN_USER_ID="<admin-userId>"                          # Admin の userId
TEAM_ID="e2e-team-001"
TIMESTAMP="2024-06-01T00:00:00.000Z"

# MediaFile #1: 音声 (mp3) — COMPLETED + CLEAN
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item "{
    \"PK\": {\"S\": \"MEDIA#e2e-media-001\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"entityType\": {\"S\": \"MediaFile\"},
    \"mediaFileId\": {\"S\": \"e2e-media-001\"},
    \"filename\": {\"S\": \"sample-audio.mp3\"},
    \"s3Key\": {\"S\": \"media/e2e-media-001/sample-audio.mp3\"},
    \"s3Bucket\": {\"S\": \"$MEDIA_BUCKET\"},
    \"contentType\": {\"S\": \"audio/mpeg\"},
    \"fileSize\": {\"N\": \"48000\"},
    \"uploadedBy\": {\"S\": \"$ADMIN_USER_ID\"},
    \"teamId\": {\"S\": \"$TEAM_ID\"},
    \"status\": {\"S\": \"COMPLETED\"},
    \"scanStatus\": {\"S\": \"CLEAN\"},
    \"sessionId\": {\"S\": \"e2e-session-001\"},
    \"createdAt\": {\"S\": \"$TIMESTAMP\"},
    \"updatedAt\": {\"S\": \"$TIMESTAMP\"},
    \"uploadedAt\": {\"S\": \"$TIMESTAMP\"},
    \"GSI1PK\": {\"S\": \"TEAM#$TEAM_ID\"},
    \"GSI1SK\": {\"S\": \"MEDIA#${TIMESTAMP}#e2e-media-001\"},
    \"GSI2PK\": {\"S\": \"USER#$ADMIN_USER_ID\"},
    \"GSI2SK\": {\"S\": \"MEDIA#${TIMESTAMP}#e2e-media-001\"}
  }" \
  --region ap-northeast-1

# MediaFile #2: 音声 (wav) — COMPLETED + CLEAN
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item "{
    \"PK\": {\"S\": \"MEDIA#e2e-media-002\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"entityType\": {\"S\": \"MediaFile\"},
    \"mediaFileId\": {\"S\": \"e2e-media-002\"},
    \"filename\": {\"S\": \"sample-audio.wav\"},
    \"s3Key\": {\"S\": \"media/e2e-media-002/sample-audio.wav\"},
    \"s3Bucket\": {\"S\": \"$MEDIA_BUCKET\"},
    \"contentType\": {\"S\": \"audio/wav\"},
    \"fileSize\": {\"N\": \"441044\"},
    \"uploadedBy\": {\"S\": \"$ADMIN_USER_ID\"},
    \"teamId\": {\"S\": \"$TEAM_ID\"},
    \"status\": {\"S\": \"COMPLETED\"},
    \"scanStatus\": {\"S\": \"CLEAN\"},
    \"sessionId\": {\"S\": \"e2e-session-002\"},
    \"createdAt\": {\"S\": \"2024-06-02T00:00:00.000Z\"},
    \"updatedAt\": {\"S\": \"2024-06-02T00:00:00.000Z\"},
    \"uploadedAt\": {\"S\": \"2024-06-02T00:00:00.000Z\"},
    \"GSI1PK\": {\"S\": \"TEAM#$TEAM_ID\"},
    \"GSI1SK\": {\"S\": \"MEDIA#2024-06-02T00:00:00.000Z#e2e-media-002\"},
    \"GSI2PK\": {\"S\": \"USER#$ADMIN_USER_ID\"},
    \"GSI2SK\": {\"S\": \"MEDIA#2024-06-02T00:00:00.000Z#e2e-media-002\"}
  }" \
  --region ap-northeast-1

# MediaFile #3: 動画 (mp4) — COMPLETED + CLEAN
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item "{
    \"PK\": {\"S\": \"MEDIA#e2e-media-003\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"entityType\": {\"S\": \"MediaFile\"},
    \"mediaFileId\": {\"S\": \"e2e-media-003\"},
    \"filename\": {\"S\": \"sample-video.mp4\"},
    \"s3Key\": {\"S\": \"media/e2e-media-003/sample-video.mp4\"},
    \"s3Bucket\": {\"S\": \"$MEDIA_BUCKET\"},
    \"contentType\": {\"S\": \"video/mp4\"},
    \"fileSize\": {\"N\": \"1024000\"},
    \"uploadedBy\": {\"S\": \"$ADMIN_USER_ID\"},
    \"teamId\": {\"S\": \"$TEAM_ID\"},
    \"status\": {\"S\": \"COMPLETED\"},
    \"scanStatus\": {\"S\": \"CLEAN\"},
    \"sessionId\": {\"S\": \"e2e-session-003\"},
    \"createdAt\": {\"S\": \"2024-06-03T00:00:00.000Z\"},
    \"updatedAt\": {\"S\": \"2024-06-03T00:00:00.000Z\"},
    \"uploadedAt\": {\"S\": \"2024-06-03T00:00:00.000Z\"},
    \"GSI1PK\": {\"S\": \"TEAM#$TEAM_ID\"},
    \"GSI1SK\": {\"S\": \"MEDIA#2024-06-03T00:00:00.000Z#e2e-media-003\"},
    \"GSI2PK\": {\"S\": \"USER#$ADMIN_USER_ID\"},
    \"GSI2SK\": {\"S\": \"MEDIA#2024-06-03T00:00:00.000Z#e2e-media-003\"}
  }" \
  --region ap-northeast-1

# MediaFile #4: 削除テスト用 — COMPLETED + CLEAN
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item "{
    \"PK\": {\"S\": \"MEDIA#e2e-media-004\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"entityType\": {\"S\": \"MediaFile\"},
    \"mediaFileId\": {\"S\": \"e2e-media-004\"},
    \"filename\": {\"S\": \"sample-audio-for-delete.mp3\"},
    \"s3Key\": {\"S\": \"media/e2e-media-004/sample-audio-for-delete.mp3\"},
    \"s3Bucket\": {\"S\": \"$MEDIA_BUCKET\"},
    \"contentType\": {\"S\": \"audio/mpeg\"},
    \"fileSize\": {\"N\": \"48000\"},
    \"uploadedBy\": {\"S\": \"$ADMIN_USER_ID\"},
    \"teamId\": {\"S\": \"$TEAM_ID\"},
    \"status\": {\"S\": \"COMPLETED\"},
    \"scanStatus\": {\"S\": \"CLEAN\"},
    \"sessionId\": {\"S\": \"e2e-session-004\"},
    \"createdAt\": {\"S\": \"2024-06-04T00:00:00.000Z\"},
    \"updatedAt\": {\"S\": \"2024-06-04T00:00:00.000Z\"},
    \"uploadedAt\": {\"S\": \"2024-06-04T00:00:00.000Z\"},
    \"GSI1PK\": {\"S\": \"TEAM#$TEAM_ID\"},
    \"GSI1SK\": {\"S\": \"MEDIA#2024-06-04T00:00:00.000Z#e2e-media-004\"},
    \"GSI2PK\": {\"S\": \"USER#$ADMIN_USER_ID\"},
    \"GSI2SK\": {\"S\": \"MEDIA#2024-06-04T00:00:00.000Z#e2e-media-004\"}
  }" \
  --region ap-northeast-1
```

---

### ステップ 4: シードスクリプト化（推奨）

上記を TypeScript スクリプトにまとめて再利用可能にする：

```typescript
// e2e/seed/seed-media-files.ts
import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;
const MEDIA_BUCKET = process.env.MEDIA_BUCKET_NAME!;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID!;
const TEAM_ID = 'e2e-team-001';

interface MediaSeedItem {
  mediaFileId: string;
  filename: string;
  localPath: string;
  contentType: string;
  sessionId: string;
  createdAt: string;
}

const SEED_ITEMS: MediaSeedItem[] = [
  {
    mediaFileId: 'e2e-media-001',
    filename: 'sample-audio.mp3',
    localPath: 'seed/media-files/sample-audio.mp3',
    contentType: 'audio/mpeg',
    sessionId: 'e2e-session-001',
    createdAt: '2024-06-01T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-002',
    filename: 'sample-audio.wav',
    localPath: 'seed/media-files/sample-audio.wav',
    contentType: 'audio/wav',
    sessionId: 'e2e-session-002',
    createdAt: '2024-06-02T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-003',
    filename: 'sample-video.mp4',
    localPath: 'seed/media-files/sample-video.mp4',
    contentType: 'video/mp4',
    sessionId: 'e2e-session-003',
    createdAt: '2024-06-03T00:00:00.000Z',
  },
  {
    mediaFileId: 'e2e-media-004',
    filename: 'sample-audio-for-delete.mp3',
    localPath: 'seed/media-files/sample-audio.mp3',
    contentType: 'audio/mpeg',
    sessionId: 'e2e-session-004',
    createdAt: '2024-06-04T00:00:00.000Z',
  },
];

async function seedMediaFiles() {
  for (const item of SEED_ITEMS) {
    const s3Key = `media/${item.mediaFileId}/${item.filename}`;
    const filePath = path.resolve(__dirname, '..', item.localPath);

    // 1. S3 にファイルをアップロード
    console.log(`Uploading to S3: ${s3Key}`);
    const fileBody = readFileSync(filePath);
    await s3.send(new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: s3Key,
      Body: fileBody,
      ContentType: item.contentType,
    }));

    // 2. process-upload Lambda が自動でレコードを作成するが、
    //    テスト用のフィールドで上書きする（少し待ってから上書き）
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`Writing DynamoDB record: ${item.mediaFileId}`);
    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: { S: `MEDIA#${item.mediaFileId}` },
        SK: { S: 'METADATA' },
        entityType: { S: 'MediaFile' },
        mediaFileId: { S: item.mediaFileId },
        filename: { S: item.filename },
        s3Key: { S: s3Key },
        s3Bucket: { S: MEDIA_BUCKET },
        contentType: { S: item.contentType },
        fileSize: { N: String(fileBody.length) },
        uploadedBy: { S: ADMIN_USER_ID },
        teamId: { S: TEAM_ID },
        status: { S: 'COMPLETED' },
        scanStatus: { S: 'CLEAN' },
        sessionId: { S: item.sessionId },
        createdAt: { S: item.createdAt },
        updatedAt: { S: item.createdAt },
        uploadedAt: { S: item.createdAt },
        GSI1PK: { S: `TEAM#${TEAM_ID}` },
        GSI1SK: { S: `MEDIA#${item.createdAt}#${item.mediaFileId}` },
        GSI2PK: { S: `USER#${ADMIN_USER_ID}` },
        GSI2SK: { S: `MEDIA#${item.createdAt}#${item.mediaFileId}` },
      },
    }));

    console.log(`✓ ${item.mediaFileId} seeded`);
  }

  console.log('\nAll media files seeded successfully.');
}

seedMediaFiles().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

#### 実行

```bash
cd e2e
npx tsx seed/seed-media-files.ts
```

---

### ステップ 5: クリーンアップ

テスト完了後（`globalTeardown` またはシードリセット時）にメディアデータを削除：

```bash
# S3 からテスト用メディアファイルを削除
aws s3 rm "s3://${MEDIA_BUCKET}/media/e2e-media-001/" --recursive --region ap-northeast-1
aws s3 rm "s3://${MEDIA_BUCKET}/media/e2e-media-002/" --recursive --region ap-northeast-1
aws s3 rm "s3://${MEDIA_BUCKET}/media/e2e-media-003/" --recursive --region ap-northeast-1
aws s3 rm "s3://${MEDIA_BUCKET}/media/e2e-media-004/" --recursive --region ap-northeast-1

# DynamoDB からテスト用レコードを削除
for ID in e2e-media-001 e2e-media-002 e2e-media-003 e2e-media-004; do
  aws dynamodb delete-item \
    --table-name "$TABLE_NAME" \
    --key "{\"PK\": {\"S\": \"MEDIA#${ID}\"}, \"SK\": {\"S\": \"METADATA\"}}" \
    --region ap-northeast-1
done
```

---

### 注意事項

| 項目 | 説明 |
|------|------|
| S3 トリガーとの競合 | S3 にファイルをアップロードすると `process-upload` Lambda が自動実行される。DynamoDB レコードを直接作成する場合は、S3 アップロード後に 3〜5 秒待ってから PutItem で上書きすること |
| マルウェアスキャン | `scanStatus: 'CLEAN'` を設定しないと、CloudFront 経由のメディアアクセスが S3 バケットポリシーでブロックされる |
| KMS 暗号化 | メディアバケットは KMS 暗号化されている。`aws s3 cp` は自動で暗号化するが、SDK から直接アップロードする場合は `ServerSideEncryption: 'aws:kms'` と `SSEKMSKeyId` の指定が必要な場合がある |
| ID のプレフィックス | テストデータには必ず `e2e-` プレフィックスを付与し、本番データと区別する |
| 冪等性 | DynamoDB の PutItem は同じキーで再実行すると上書きされるため、シードスクリプトは何度実行しても安全 |
