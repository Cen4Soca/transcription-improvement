# Design Document

## Overview

本設計は、ソリューションが内部で使用する Node.js を 24.x から 26.x へ更新するための技術設計です。対象は Lambda ランタイム、esbuild バンドル、型定義、CDK ライブラリ、デプロイスクリプト、フロントエンドのビルド環境、ドキュメントです。

方針は次の 4 点です。

1. Lambda ランタイムと esbuild ターゲットを 1 ファイルの定数に集約し、散在する指定をなくす。
2. CDK ライブラリを `NODEJS_26_X` 対応版へ引き上げる。
3. Node.js のメジャーバージョンを `.nvmrc` 1 箇所で宣言し、`deploy.sh` が不一致を検出して中止する。
4. 変更は 1 PR にまとめ、定数を 24 に戻すだけでロールバックできる形にする。

---

## 調査結果（Requirement 1, 4 の根拠）

### 提供状況

| 項目 | 結果 | 出典 |
|------|------|------|
| Lambda `nodejs26.x` | 2026-11-20 に GA。Lambda が提供される全リージョンで利用可能 | AWS What's New（2026/11） |
| Lambda サポート期限 | 2029-04-30（Node.js 26 の EOL と同日） | Lambda ドキュメント（Node.js ランタイム一覧） |
| Node.js 26 | 2026-10-28 に LTS 入り。EOL は 2029-04-30 | Node.js リリーススケジュール |
| Node.js 24 | 2026-10-20 に Maintenance へ移行。EOL は 2028-04-30 | 同上 |
| ap-northeast-1 | 「全リージョンで利用可能」の記載による。ap-northeast-1 を名指しした記載は未確認 | AWS What's New |

Requirement 1.1 の GA 確認は完了とする。ap-northeast-1 での実際の利用可否は、dev 環境へのデプロイ結果で最終確認する（Requirement 1.2 の保険として維持）。

### ツールチェーン

| 項目 | 現状 | 必要な状態 |
|------|------|-----------|
| `aws-cdk-lib` | インストール済み 2.257.0（`package.json` は `^2.150.0`） | `NODEJS_26_X` を持つ **2.277.0 以降**（2.276.0 は未対応、2.277.0 で対応を実測確認） |
| `esbuild` | 0.28.1 | `--target=node26` を受け付けることを実測確認済み。更新不要 |
| `@types/node` | backend / infra とも `^24.0.0`、frontend は `^24.12.4` | 26 系が公開済み（26.6.x） |
| 開発マシンの Node | v26.13.1 | 変更不要 |

重要な点として、`deploy.sh` は infra で `rm -rf node_modules package-lock.json` のあとに `npm install` を実行する。このため CDK のバージョンは `package.json` の範囲で毎回浮動する。下限を `^2.277.0` に引き上げないと、再現性のない解決結果になる。

### 互換性チェック（Requirement 4.1）

Node.js 26 の破壊的変更と、本リポジトリへの該当有無を実測した結果は次のとおり。

| 変更点 | 該当確認 | 結果 |
|--------|---------|------|
| `http.Server.prototype.writeHeader()` 削除 | `backend/src`、`infra`、`frontend/src` を grep | 該当なし |
| `_stream_*` 内部モジュール削除 | 3 パッケージの `node_modules` の `require('_stream_*')` を grep | 該当なし |
| `module.register()` の実行時非推奨 | ソースを grep | 該当なし |
| `--experimental-transform-types` 削除 | ソースとスクリプトを grep | 該当なし |
| Undici 8（`fetch` のヘッダー検証厳格化） | `backend/src` のグローバル `fetch(` 使用を grep | 該当なし（AWS SDK 経由のみ） |
| ネイティブアドオンの再ビルド（ABI 147） | `*.node` を検索 | rollup、rolldown、lightningcss、tailwindcss-oxide のみ。いずれも npm が OS 別プリビルドを提供する依存で、`npm install` で解決される |
| Brotli / zlib の直接利用 | `backend/src` を grep | 該当なし |
| ESM 内の拡張子なし CJS 読み込み | `backend/src` の `require(` を grep | 該当なし |

### 既存テストの実測（Node v26.13.1 上）

| 対象 | 結果 |
|------|------|
| backend | 1387 passed / 90 skipped（107 files passed, 7 skipped） |
| infra（`SKIP_BUNDLING=true`） | 185 passed |
| frontend | 1282 passed / 2 failed |

frontend の 2 件の失敗は `src/i18n/errorCodes.test.ts` で、`ROLE_CHANGE_SESSION_INVALIDATION_FAILED` が `errors` namespace（ja / en）に未登録であることが原因。Node.js のバージョンとは無関係の既存不具合であり、本 spec のスコープ外とする。Requirement 4.2 の基準値は上表の件数とし、frontend は「この 2 件以外は成功」を維持条件とする。

---

## Architecture

変更は既存のレイヤ構成を保ったまま、バージョン指定の集約点を 1 つ追加する形にとどめる。

```
.nvmrc (26)  ──────────────►  deploy.sh（メジャー一致を検査、不一致なら中止）
                              開発者の nvm / fnm（任意）

infra/lib/constructs/lambda-runtime.ts   ← 新規（唯一の指定箇所）
   ├─ APP_LAMBDA_RUNTIME  = lambda.Runtime.NODEJS_26_X
   └─ ESBUILD_NODE_TARGET = 'node26'
        ▲ import
        ├─ constructs/lambda-function.ts   （共通 Lambda、2 分岐）
        ├─ constructs/malware-scan.ts      （2 分岐）
        ├─ stacks/foundation-stack.ts      （SeedAdminHandler）
        ├─ stacks/api-stack.ts             （CloudFrontKeyPairHandler、S3NotificationHandler）
        └─ stacks/cdn-stack.ts             （UpdateDistributionHandler、CallbackUrlHandler）
```

新規ファイルは `infra/lib/constructs/` に置く。`structure.md` の「新規ディレクトリを作らない」「kebab-case」の規則に従う。

---

## Components and Interfaces

### 1. ランタイム定数（Requirement 2.3, 2.4）

`infra/lib/constructs/lambda-runtime.ts` を新規作成する。

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';

/** Single source of truth for the Lambda runtime used by every function in this app. */
export const APP_LAMBDA_RUNTIME = lambda.Runtime.NODEJS_26_X;

/** esbuild target. Must stay in step with APP_LAMBDA_RUNTIME. */
export const ESBUILD_NODE_TARGET = 'node26';
```

CDK 定数を使う案（A）と、`new lambda.Runtime('nodejs26.x', lambda.RuntimeFamily.NODEJS)` で直接指定する案（B）を比較した。

| 案 | 長所 | 短所 |
|----|------|------|
| A: CDK を 2.277.0 以降へ更新して定数を使う | 型安全。`supportsInlineCode` などのランタイム属性が正しく設定される | CDK の更新が必要（ただし `deploy.sh` は既に最新へ浮動している） |
| B: `Runtime` を直接生成する | CDK の更新が不要 | 属性（インラインコード対応など）を手動で合わせる必要があり、誤りやすい |

**採用: A。** `deploy.sh` が毎回最新の 2.x を解決するため、下限を明示するコストは小さい。

### 2. 各 Lambda 定義の置換（Requirement 2.1, 2.2）

全 9 箇所の `NODEJS_24_X` を `APP_LAMBDA_RUNTIME` に、`target: 'node24'` を `ESBUILD_NODE_TARGET` に置き換える。

| ファイル | 箇所 |
|---------|------|
| `constructs/lambda-function.ts` | `SKIP_BUNDLING` 分岐、通常分岐（runtime 2 + target 1） |
| `constructs/malware-scan.ts` | 同上（runtime 2 + target 1） |
| `stacks/foundation-stack.ts` | `SeedAdminHandler` |
| `stacks/api-stack.ts` | `CloudFrontKeyPairHandler`、`S3NotificationHandler` |
| `stacks/cdn-stack.ts` | `UpdateDistributionHandler`、`CallbackUrlHandler` |

置換後は `grep -rn "NODEJS_[0-9]*_X\|'node[0-9]*'" infra/lib` が `lambda-runtime.ts` のみを返すことを確認する。

### 3. 依存バージョン（Requirement 3）

| ファイル | 変更 |
|---------|------|
| `infra/package.json` | `aws-cdk-lib` を `^2.277.0`、`aws-cdk`（CLI）を lib と整合する版へ、`@types/node` を `^26.6.0` |
| `backend/package.json` | `@types/node` を `^26.6.0` |
| `frontend/package.json` | `@types/node` を `^26.6.0` |
| 各 `package-lock.json` | `npm install` で再生成 |

CLI（`aws-cdk`）はライブラリより古いと cloud assembly のスキーマ不一致で `cdk synth` が失敗する。`aws-cdk` も同時に更新し、`npx cdk synth --all` で確認する。

`@types/node` は、実行・ビルドを行う Node と一致させるため 3 パッケージとも `^26` に揃える。frontend はブラウザ向け成果物で Lambda では動かないが、ビルドと型検査を Node 26 で行うため同じ基準にする。更新後に frontend の `npm run build` と `vitest` が通ることを確認する（Requirement 3.3, 5.3）。

### 4. Node.js バージョン宣言と検査（Requirement 5）

**宣言場所は `.nvmrc` に一本化する（Requirement 5.1）。** `engines` フィールドを各 `package.json` に併記すると宣言が 2 系統になるため採用しない。

リポジトリ直下の `.nvmrc`:

```
26
```

検査ロジックは単体でテストできるよう、`infra/scripts/check-node-version.sh` に切り出す（`infra/scripts/` は運用スクリプトの置き場）。第 1 引数は `.nvmrc` のパス。環境変数 `NODE_MAJOR_OVERRIDE` が設定されている場合は、テスト用に実行環境の Node メジャーとして使う。

```bash
#!/bin/bash
# Usage: check-node-version.sh <path-to-.nvmrc>
set -e
required_node_major=$(tr -d '[:space:]v' < "${1:-.nvmrc}" | cut -d. -f1)
actual_node_major="${NODE_MAJOR_OVERRIDE:-$(node -p "process.versions.node.split('.')[0]")}"
if [[ "$required_node_major" != "$actual_node_major" ]]; then
    echo "ERROR: Node.js ${required_node_major}.x is required (found ${actual_node_major}.x)." >&2
    echo "       Switch with: nvm install ${required_node_major} && nvm use ${required_node_major}" >&2
    exit 1
fi
```

`deploy.sh` は、`pushd transcription-improvement` の直後、`cdk.json` 上書きの前に `bash infra/scripts/check-node-version.sh .nvmrc` を呼ぶ。`destroy.sh` は Node のバージョン差でリソース削除の結果が変わらないため対象外とする。

既存の basePath フェイルセーフ検証（Requirement 5.4）には手を入れない。ビルド後の `dist/index.html` を検査する独立したブロックのため影響を受けない。

### 5. フロントエンド（Requirement 5.3）

フロントエンドはブラウザ向けの成果物で、Lambda のランタイムとは無関係である。Node.js 26 はビルド実行環境としてのみ関わる。Node v26.13.1 での `npm run build`（`tsc -b && vite build`）が成功し、`dist/index.html` が basePath 付きでアセットを参照することを確認済み。

### 6. ドキュメント（Requirement 7）

| ファイル | 変更 |
|---------|------|
| `.kiro/steering/tech.md` | Backend の節に「Lambda ランタイム: Node.js 26（`nodejs26.x`）。定数は `infra/lib/constructs/lambda-runtime.ts`、宣言は `.nvmrc`」を追記 |
| `README.md` 59 行目 | 「Node.js 20 以上（CDK は Node 20 系推奨）」を「Node.js 26（`.nvmrc` 参照）」に変更 |
| `.kiro/specs/solution-manual` | Node のバージョン記述なし。変更不要（確認済み） |

---

## Data Models

データモデルの変更はない。DynamoDB スキーマ、API 契約、環境変数は変更しない。

---

## Correctness Properties

本変更で常に成り立たせる性質を次に定める。いずれも自動テストまたはスクリプトの検査で確認できる形にしている。

### Property 1: ランタイムの単一性

*For any* 合成されたスタック（`ApiStack`、`FoundationStack`、`CdnStack`）に含まれる、アプリケーションが定義した `AWS::Lambda::Function` について、`Runtime` は `nodejs26.x` と等しい。Custom Resource 用の Lambda も含む。CDK ライブラリのコンストラクトが生成する Lambda（BucketDeployment、AwsCustomResource、LogRetention など）は、アプリケーションがランタイムを指定できないため対象外とし、論理 ID の接頭辞で除外する。

**Validates: Requirements 2.1, 2.2**

### Property 2: ランタイムとバンドルターゲットの整合

`ESBUILD_NODE_TARGET` のメジャー番号は `APP_LAMBDA_RUNTIME` のメジャー番号と等しい。両者は `lambda-runtime.ts` 内で隣接して定義され、`infra/lib` 内でほかの箇所にバージョン番号の直書きが存在しない。

**Validates: Requirements 2.4, 3.1**

### Property 3: デプロイ環境のバージョン検査

*For any* `.nvmrc` のメジャー値 R と実行環境の Node メジャー値 A について、R と A が等しいときに限り `deploy.sh` の検査は成功し、異なるときは非ゼロで終了してデプロイ処理に進まない。

**Validates: Requirements 5.1, 5.2**

### Property 4: 既存挙動の維持

backend、infra の既存テストは、実測した基準件数（backend 1387 passed、infra 185 passed）から減らない。frontend は既知の 2 件（`errorCodes.test.ts`）以外が成功する。

**Validates: Requirements 4.2, 4.3**

---

## Error Handling

| 事象 | 検出 | 動作 |
|------|------|------|
| デプロイ環境の Node が `.nvmrc` と不一致 | `deploy.sh` | 切り替え手順を表示して `exit 1`（デプロイ前に中止） |
| CDK が `NODEJS_26_X` を持たない | TypeScript ビルド | `Runtime.NODEJS_26_X` が存在しないためコンパイルエラー。`package.json` の下限で防止 |
| `nodejs26.x` が対象リージョンで未提供 | `cdk deploy`（CloudFormation の検証エラー） | スタックがロールバックされ、旧ランタイムのまま残る |
| 実行時に SDK モジュールが解決できない | dev 環境のスモークテスト | 定数を 24 に戻して再デプロイ |

---

## Testing Strategy

### 自動テスト

| テスト | 内容 |
|--------|------|
| `infra/test/api-stack.test.ts`（更新） | 既存の「Node.js 24.x ランタイム」アサーションを `nodejs26.x` に更新 |
| `infra/test/lambda-runtime.test.ts`（新規） | `ApiStack`、`FoundationStack`、`CdnStack` を合成し、すべての `AWS::Lambda::Function` の `Runtime` が `nodejs26.x` であることを検証する（Requirement 2.2。Custom Resource 用 Lambda も対象に含める） |
| `infra/test/check-node-version.test.ts`（新規） | `check-node-version.sh` を `NODE_MAJOR_OVERRIDE` 付きで実行し、メジャー一致なら終了コード 0、不一致なら非 0 でエラーメッセージを出すことを複数の組み合わせで検証する（Property 3） |
| スナップショット | `api-stack`、`cdn-stack` のスナップショットを更新。差分がランタイム値と esbuild 設定のみであることを目視確認する |
| backend / infra / frontend の既存テスト | 上記「実測」の件数を基準に、増減がないこと |

`lambda-runtime.test.ts` は `CdnStack` の合成に必要な props（`cdn-stack.test.ts` の既存セットアップ）を流用する。

### 手動検証（dev 環境）

1. `npx cdk diff --all` の差分が、ランタイム、バンドル設定、依存以外を含まない（Requirement 6.3）。
2. `cdk deploy` 後、全関数の Runtime が `nodejs26.x` であることを AWS CLI で確認する。
3. 認証（`GET /me`）、セッション一覧、メディア URL 取得、アップロード URL 発行、Bedrock 候補取得を実行して正常応答を確認する（Requirement 4.6）。
4. Custom Resource 用 Lambda の応答送信を疑似イベントで確認する（Requirement 4.7。手順は次項）。

### Custom Resource ハンドラーの検証方法（Requirement 4.7）

**なぜ必要か。** CloudFormation は Custom Resource のハンドラーを、リソースの作成時、プロパティ変更時の更新、削除時にしか呼ばない。ランタイムを変えても ServiceToken（関数 ARN）もプロパティも変わらないため、`cdk deploy` ではどのハンドラーも実行されない。本リポジトリの 5 つの Custom Resource には、デプロイごとに値が変わるプロパティもない（`UpdateDistribution` は固定の `Version: '4'`）。つまり、ランタイム更新が成功しても、ハンドラーが 26 で動くかどうかは分からない。

**何を確認するか。** 5 つのハンドラーはすべて `async` で、`await response.send(...)` を呼ぶ。`cfn-response` には、非同期ハンドラー用（`send` が Promise を返す）と同期ハンドラー用（コールバックで終了する）の 2 種類の実装がある（AWS ドキュメント）。`nodejs26.x` でどちらが提供されるかは明記されていない。Promise を返さない実装だと、`await` が即座に解決してハンドラーが戻り、HTTPS の PUT が終わる前に Lambda が凍結される。CloudFormation に応答が届かず、スタック操作が最大 1 時間ハングしてから失敗する。

**確認方法（副作用なしの疑似呼び出し）。**

1. テスト用の S3 署名付き PUT URL を発行する（有効期限 5 分。`@aws-sdk/s3-request-presigner` は backend の既存依存）。
2. 対象関数を `aws lambda invoke` で、`RequestType: "Delete"` の疑似イベントとともに呼ぶ。`ResponseURL` には手順 1 の URL を指定する。
3. S3 に応答 JSON（`Status: SUCCESS`）が書き込まれていれば正常。書き込まれないまま関数が終了すれば異常。

この挙動は個別のハンドラーではなく、ランタイムと `cfn-response` の組み合わせで決まる。副作用のないハンドラー 1 つで確認できれば、ほかのハンドラーにも当てはまる。

| ハンドラー | Delete 時の動作 | 疑似呼び出し |
|-----------|----------------|-------------|
| SeedAdmin | 即座に SUCCESS を返す（副作用なし） | 実施する |
| UpdateDistribution | 即座に SUCCESS を返す（副作用なし） | 実施する |
| CloudFrontKeyPair | `PhysicalResourceId` が指すキーグループ、公開鍵、SSM パラメータを削除する | 呼ばない。実在する `SsmParamName` を渡すと実際の署名用秘密鍵が消えるため |
| S3Notification | 対象バケットの通知設定を書き換える | 呼ばない。実バケットを変更するため |
| CallbackUrl | 未確認 | 呼ばない。Delete 時の動作を確認してから判断する |

**応答が届かない場合の対処。** 各ハンドラーのインラインコードに、Promise を返す最小限の `send` 関数（`https.request` で `ResponseURL` へ PUT する数十行）を自前で定義し、`cfn-response` への依存を外す。実施するかどうかは、確認結果を見て決める。

Create と Update のコード経路（SDK クライアントの呼び出し、`crypto` の利用）は、疑似呼び出しでは実行されない。これらは Node 26 で削除された API を使っていないことを静的に確認済みで、実行での確認は `destroy.sh` による dev の作り直しの機会に行う。

---

---

## Rollout and Rollback

### 適用順序（Requirement 6.1）

1. 開発マシンで `npm install`、ビルド、テストを実行する。
2. dev 環境へデプロイし、上記の手動検証を行う。
3. 問題がなければ staging、prod の順に同じ手順で適用する。

関数のランタイム更新は既存関数への更新であり、関数の置き換えや API Gateway の再作成を伴わない。

`deploy.sh` は GitHub から `git clone` してビルドするため、`.nvmrc` と `check-node-version.sh` は変更をマージ（または対象ブランチへ push）してからでないと clone 先に含まれない。また、ローカルで実行する `deploy.sh` 自体の更新（バージョン検査の呼び出し）も、実行する場所のコピーへ反映する必要がある。

### ロールバック（Requirement 6.2）

`lambda-runtime.ts` の 2 つの定数を `NODEJS_24_X` と `'node24'` に戻して再デプロイする。変更は 1 PR にまとめ、PR 全体の revert でも戻せる状態を保つ。`.nvmrc` を戻す場合は、同時に `deploy.sh` の実行環境の Node も 24 に戻す必要がある。

---

## Risks and Open Items

| 項目 | 内容 | 対応 |
|------|------|------|
| ランタイム同梱 SDK のバージョン | Lambda に同梱される SDK v3 は特定のマイナー版で、バージョンはランタイムとリージョンに依存する。`externalModules: ['@aws-sdk/*']` のため、`backend/package.json` の `client-bedrock-runtime ^3.1137` より古い SDK が使われる可能性がある。これは Node 24 でも同じ前提で、新規のリスクではない | dev で Bedrock 候補取得を必ず確認する。問題があれば `externalModules` から対象クライアントを外してバンドルに含める |
| Custom Resource 用 Lambda | ランタイム変更だけではハンドラーが実行されず、`cfn-response` の挙動（Promise を返すか）が 26 で変わっていても気づけない。応答が届かないとスタック操作が最大 1 時間ハングする | 上記「Custom Resource ハンドラーの検証方法」の疑似呼び出しで確認する。異常時は自前の `send` 関数に置き換える |
| CDK CLI とライブラリの組み合わせ | CLI がライブラリより古いと synth が失敗する | `aws-cdk` を同時に更新し、`cdk synth --all` で確認する |
| CDK ライブラリが生成する管理 Lambda（AwsCustomResource のシングルトン、BucketDeployment、LogRetention） | ランタイムを指定できず CDK のデフォルトに従う。AwsCustomResource は nodejs24.x のまま残る（`AwsCustomResourceProps` に `runtime` がない） | 対象外とし、CDK の更新で追随する。テストでは論理 ID の接頭辞で除外する |
| aws-cdk-lib 2.257.0 → 2.278.0 による管理リソースの差分 | CDK 管理の BucketDeployment ハンドラーが arm64 / 1024 MB（`Architectures: arm64`、`MemorySize: 1024`）に変わり、アセットハッシュも更新される。`cdk diff` に現れる | 想定内の差分として、タスク 8.2 の `cdk diff` レビューで確認する |
| frontend の既存テスト失敗 2 件 | Node 26 とは無関係。`ROLE_CHANGE_SESSION_INVALIDATION_FAILED` の翻訳キー未登録 | 本 spec のスコープ外。別途対応する |

---

## Requirements Traceability

| Requirement | 設計上の対応 |
|-------------|-------------|
| 1 提供状況の確認 | 「調査結果」の提供状況（GA 確認済み）と dev デプロイでの最終確認 |
| 2 Lambda ランタイム更新 | `lambda-runtime.ts` への集約、9 箇所の置換、`lambda-runtime.test.ts` |
| 3 バンドルと型定義 | `ESBUILD_NODE_TARGET`、3 パッケージの `@types/node ^26`、esbuild の `node26` 対応を実測確認 |
| 4 互換性の確認 | 互換性チェック表、テスト実測、SDK 同梱のリスク整理、dev のスモークテスト、Custom Resource ハンドラーの疑似呼び出し |
| 5 デプロイ環境の整合 | `.nvmrc` と `deploy.sh` の検査、フロントエンドのビルド確認 |
| 6 段階的適用とロールバック | Rollout and Rollback、`cdk diff` の確認 |
| 7 ドキュメント更新 | `tech.md`、`README.md` の更新。solution-manual は変更不要 |
