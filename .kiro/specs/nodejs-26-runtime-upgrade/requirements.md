# Requirements Document

## Introduction

本ドキュメントは、本ソリューションが内部で使用する Node.js を 24.x から 26.x へ更新するための要件を定義します。

直近のセキュリティ対応で Lambda ランタイムを Node.js 20.x から 24.x へ移行済みです（`nodejs24.x`、esbuild `target: 'node24'`、`@types/node ^24`）。本件はその次段として、Node.js 26.x（偶数メジャーのため LTS ライン）へ揃えます。

Node.js のバージョンは Lambda 実行環境だけでなく、バンドル、型定義、CDK、デプロイスクリプト、フロントエンドのビルドにも関わるため、対象範囲を明確にして一括で整合させます。

> **関連ドキュメント**: 技術スタックと規約は `.kiro/steering/tech.md`、ディレクトリ構成は `.kiro/steering/structure.md` を正とします。本書は要件（WHAT）の定義に集中し、実装方法（HOW）は design.md で扱います。

---

## 調査済みの前提（2026年時点で確認できた事実）

- AWS Lambda の `nodejs26.x` は 2026-11-20 に GA となり、Lambda が提供される全リージョンで利用可能。ap-northeast-1 を名指しした記載は未確認のため、dev 環境へのデプロイで最終確認する。
- `aws-cdk-lib` 2.257.0 には `Runtime.NODEJS_26_X` が存在しない。2.277.0 以降で利用可能。
- `esbuild` 0.28.1 は `target: 'node26'` を受け付ける（実測確認済み）。
- 開発マシンの Node.js は既に v26.13.1。
- リポジトリには `.nvmrc`、`engines`、CI 設定による Node.js バージョン固定が存在しない。

---

## Glossary

- **Lambda_Runtime**: AWS Lambda のマネージドランタイム識別子（例: `nodejs24.x`、`nodejs26.x`）。
- **Bundling_Target**: esbuild の `target` 指定（例: `node24`）。
- **Inline_Handler**: CDK の `Code.fromInline` で埋め込まれた Custom Resource 用 Lambda（SeedAdmin、CloudFrontKeyPair、S3Notification、UpdateDistribution、CallbackUrl など）。
- **Deploy_Environment**: `deploy.sh` を実行するマシン（Node.js、CDK、frontend ビルドを含む）。
- **Developer（開発者）**: CDK を使用して App をデプロイする技術者。

---

## Requirements

### Requirement 1: Lambda 提供状況の事前確認

**User Story:** Developer として、デプロイ先リージョンで `nodejs26.x` が本番利用可能であることを事前に確認したい。未提供のランタイムを指定したデプロイ失敗を避けるためである。

#### Acceptance Criteria

1. WHEN 移行作業を開始する前、THE Developer SHALL ap-northeast-1 で `nodejs26.x` が GA（プレビューではない）であることを AWS 公式ドキュメントで確認し、結果を design.md に記録する。
2. IF `nodejs26.x` が ap-northeast-1 で GA でない、THEN THE 移行作業 SHALL 本番環境への適用を行わず、dev 環境での検証に留める。

### Requirement 2: Lambda ランタイムの更新

**User Story:** Developer として、全 Lambda 関数を Node.js 26.x で実行したい。最新のセキュリティ修正を受け取るためである。

#### Acceptance Criteria

1. THE CDK SHALL すべての Lambda 関数（共通 LambdaFunction コンストラクト、MalwareScan、Inline_Handler を含む）の Lambda_Runtime を `nodejs26.x` にする。
2. THE CDK SHALL 合成後のテンプレートに、アプリケーションが定義した `nodejs24.x` および `nodejs20.x` の Lambda 関数が残らないようにする。CDK ライブラリのコンストラクトが生成する Lambda（BucketDeployment、AwsCustomResource、LogRetention など）は、アプリケーションがランタイムを指定できないため対象外とする。
3. WHERE CDK ライブラリに `NODEJS_26_X` 定数が存在しない場合、THE CDK SHALL ライブラリ更新または `nodejs26.x` を直接指定する方法のいずれかで 2.1 を満たす（採用方法は design.md で決定する）。
4. THE ランタイム指定 SHALL 全箇所で同一の値になるよう、定数または共通ヘルパーに集約される。

### Requirement 3: バンドルと型定義の整合

**User Story:** Developer として、ビルド成果物と型定義を実行環境と一致させたい。実行時に存在しない構文や API に依存しないためである。

#### Acceptance Criteria

1. THE esbuild の Bundling_Target SHALL `node26` に更新される。
2. IF 使用中の esbuild が `node26` を受け付けない、THEN THE Developer SHALL esbuild を `node26` 対応版へ更新するか、受け付ける最大の Node ターゲットを design.md に記録する。
3. THE backend、infra、frontend の `@types/node` SHALL `^26` 系に更新される。
4. WHEN `npm run build` を backend と infra で実行する、THE ビルド SHALL 型エラーなく成功する。

### Requirement 4: 互換性の確認

**User Story:** Developer として、Node.js 24 から 26 への変更で既存機能が壊れないことを確認したい。

#### Acceptance Criteria

1. THE Developer SHALL Node.js 25 および 26 のリリースノートから、本リポジトリが使用する API（`node:crypto`、`node:zlib`、`node:http`、`fetch`、ESM 解決など）に影響する破壊的変更を洗い出し、design.md に記録する。
2. THE backend の既存ユニット・プロパティテスト SHALL 変更前と同じ件数が成功する。
3. THE infra の既存 CDK テスト SHALL 成功する（ランタイム値のスナップショット更新は許容する）。
4. THE Inline_Handler SHALL `cfn-response` と `@aws-sdk/*` を従来どおり解決できる。
5. THE `externalModules: ['@aws-sdk/*']` の前提 SHALL `nodejs26.x` の Lambda に AWS SDK v3 が同梱されていることを確認したうえで維持される。同梱されない場合は、バンドルに含める方式へ変更する。
6. WHEN dev 環境へデプロイする、THE 主要 API（認証、セッション一覧、メディア URL 取得、アップロード URL 発行、Bedrock 候補取得）SHALL 正常応答する。
7. THE Developer SHALL dev 環境で、副作用のない疑似イベントによる呼び出しを行い、Inline_Handler が使う `cfn-response` が `nodejs26.x` 上で CloudFormation の `ResponseURL` へ応答を送信してから終了することを確認する。

### Requirement 5: デプロイ環境とフロントエンドビルドの整合

**User Story:** Developer として、デプロイ環境のどのマシンでも同じ Node.js メジャーでビルドしたい。環境差によるビルド不整合を避けるためである。

#### Acceptance Criteria

1. THE リポジトリ SHALL Node.js のメジャーバージョンを 1 箇所で宣言する（`.nvmrc` または `engines`）。
2. WHEN `deploy.sh` が Deploy_Environment の Node.js メジャーが宣言値と異なることを検出する、THEN THE `deploy.sh` SHALL エラーメッセージを出力してデプロイ前に中止する。
3. THE frontend ビルド（Vite 8、TypeScript 6）SHALL Node.js 26 で成功し、`dist/index.html` が basePath 付きのアセット参照を持つ。
4. THE `deploy.sh` の既存のフェイルセーフ検証（basePath 検証）SHALL 変更後も機能する。

### Requirement 6: 段階的適用とロールバック

**User Story:** Developer として、問題が出た場合に直前の状態へ戻せるようにしたい。

#### Acceptance Criteria

1. THE 適用手順 SHALL dev 環境で検証してから staging、prod の順に進める。
2. THE 変更 SHALL ランタイム指定を 24.x に戻すだけで元に戻せる単位（1 コミットまたは 1 PR）で提供される。
3. WHEN `cdk diff --all` を実行する、THE 差分 SHALL ランタイム、バンドル設定、依存バージョン以外の意図しない変更を含まない。

### Requirement 7: ドキュメントの更新

**User Story:** Developer として、Node.js のバージョン情報が各ドキュメントで一致していてほしい。

#### Acceptance Criteria

1. THE `.kiro/steering/tech.md` の技術スタック記述 SHALL Lambda の Node.js バージョンを明記する。
2. THE ソリューションマニュアル（`.kiro/specs/solution-manual`）に Node.js バージョンの記述がある場合、それ SHALL 更新される。

---

## スコープ外

- Node.js 26 固有の新機能（Temporal など）を活用するリファクタリング
- AWS SDK v3 のメジャー更新
- Lambda アーキテクチャ（arm64 など）の変更
- CloudFront Function のランタイム（`cloudfront-js-2.0`）
