# Implementation Plan: nodejs-26-runtime-upgrade

## Overview

ソリューションが内部で使用する Node.js を 24.x から 26.x へ更新する。ベースラインの記録、依存バージョンの更新、Lambda ランタイムの定数集約と 26 への更新、`.nvmrc` とバージョン検査の追加、ドキュメント更新、全体検証の順に進める。ランタイムと検査スクリプトはテストを先に書き、各段階を `npx vitest --run` で検証する。AWS への実デプロイを伴う検証（タスク 8）はオプションとして分離し、ユーザーが実施する。

## Tasks

- [x] 1. ベースラインを記録する
  - 変更前のコードで backend、infra、frontend のビルドとテストを実行し、件数を記録する。ファイルは作らず、完了報告に記載する
  - 設計時の実測値: backend 1387 passed / 90 skipped、infra 185 passed、frontend 1282 passed / 2 failed
  - frontend の 2 件の失敗は `src/i18n/errorCodes.test.ts`（`ROLE_CHANGE_SESSION_INVALIDATION_FAILED` の翻訳キー未登録）。Node のバージョンとは無関係の既存不具合で、本 spec では修正しない
  - 実行コマンド: `cd backend && npx vitest --run`、`cd infra && npx vitest --run`、`cd frontend && npx vitest --run`
  - 設計時の値と大きく異なる場合は、その差を報告して以降の基準値にする
  - _Requirements: 4.2, 4.3_

- [x] 2. 依存バージョンを更新する

  - [x] 2.1 infra の依存を更新する
    - `infra/package.json` の `aws-cdk-lib` を `^2.277.0` 以上に変更する（`Runtime.NODEJS_26_X` を持つ最初の版は 2.277.0）
    - `aws-cdk`（CLI）を、`npm view aws-cdk version` で確認した最新版に合わせて更新する（設計時点は 2.1149.0）。CLI がライブラリより古いと cloud assembly のスキーマ不一致で `cdk synth` が失敗する
    - `@types/node` を `^26.6.0` に変更する
    - `npm install` を実行して `package-lock.json` を更新する
    - 確認: `node -e "console.log(require('aws-cdk-lib/aws-lambda').Runtime.NODEJS_26_X.name)"` が `nodejs26.x` を出力する。`npm run build` が成功する
    - _Requirements: 2.3, 3.3, 3.4_

  - [x] 2.2 backend の依存を更新する
    - `backend/package.json` の `@types/node` を `^26.6.0` に変更し、`npm install` を実行する
    - 確認: `npm run build` が成功し、`npx vitest --run` の件数がタスク 1 の基準値から減っていない
    - _Requirements: 3.3, 3.4, 4.2_

  - [x] 2.3 frontend の依存を更新する
    - `frontend/package.json` の `@types/node` を `^26.6.0` に変更し、`npm install` を実行する。`deploy.sh` と同じく ERESOLVE が出る場合は `--legacy-peer-deps` を付ける
    - 確認: `npm run build`（`tsc -b && vite build`）が成功する
    - 確認: `npx vitest --run` で失敗が既知の 2 件（`errorCodes.test.ts`）のみである
    - 確認: `dist/index.html` が basePath 付きでアセットを参照すること。ビルド時に `VITE_BASE_PATH=transcription-improvement-dev` を指定して `grep -oE 'src="[^"]*assets[^"]*"' dist/index.html` で確認する
    - _Requirements: 3.3, 5.3_

- [x] 3. Lambda ランタイムを定数に集約し、26 へ更新する

  - [x] 3.1 ランタイムの検証テストを先に書く
    - `infra/test/lambda-runtime.test.ts` を新規作成する（`structure.md` の規則に従い `infra/test/` に置く）
    - **Property 1: ランタイムの単一性** — `FoundationStack`、`ApiStack`、`CdnStack` を合成し、すべての `AWS::Lambda::Function` の `Runtime` が `nodejs26.x` であることを検証する
    - 合成の構成は既存の `foundation-stack.test.ts`、`api-stack.test.ts`、`cdn-stack.test.ts` のセットアップを流用する。Custom Resource 用 Lambda（SeedAdmin、CloudFrontKeyPair、S3Notification、UpdateDistribution、CallbackUrl）が実際に合成結果に含まれる構成を選ぶ。含まれない構成だと検証が空振りするため、各ハンドラーがテンプレートに存在することも同じテストで確認する
    - **Property 2: ランタイムとバンドルターゲットの整合** — `ESBUILD_NODE_TARGET` のメジャー番号が `APP_LAMBDA_RUNTIME` のメジャー番号と等しいこと。あわせて `infra/lib` 配下のファイルを走査し、`lambda-runtime.ts` 以外に `NODEJS_\d+_X` や `'node\d+'` の直書きがないことを検証する
    - describe は `Feature: nodejs-26-runtime-upgrade, Property 1: ...` の形式にし、docstring に `**Validates: Requirements 2.1, 2.2, 2.4, 3.1**` を記載する
    - この時点では `lambda-runtime.ts` が存在しないため、テストは失敗する（失敗を確認して次へ進む）
    - _Requirements: 2.1, 2.2, 2.4, 3.1_

  - [x] 3.2 ランタイム定数ファイルを作成する
    - `infra/lib/constructs/lambda-runtime.ts` を新規作成する
    - `export const APP_LAMBDA_RUNTIME = lambda.Runtime.NODEJS_26_X;` と `export const ESBUILD_NODE_TARGET = 'node26';` を定義し、JSDoc で「唯一の指定箇所」「両者は同じメジャーに保つ」ことを記載する
    - _Requirements: 2.3, 2.4_

  - [x] 3.3 全 Lambda 定義を定数参照に置き換える
    - 次の 5 ファイル、計 9 箇所の `NODEJS_24_X` を `APP_LAMBDA_RUNTIME` に、`target: 'node24'` を `ESBUILD_NODE_TARGET` に置き換える
      - `infra/lib/constructs/lambda-function.ts`（runtime 2 箇所 + target 1 箇所）
      - `infra/lib/constructs/malware-scan.ts`（runtime 2 箇所 + target 1 箇所）
      - `infra/lib/stacks/foundation-stack.ts`（`SeedAdminHandler`）
      - `infra/lib/stacks/api-stack.ts`（`CloudFrontKeyPairHandler`、`S3NotificationHandler`）
      - `infra/lib/stacks/cdn-stack.ts`（`UpdateDistributionHandler`、`CallbackUrlHandler`）
    - 既存の import 規則に従い、相対 import は拡張子なしの既存スタイルに合わせる（`infra` は CommonJS ビルドのため、既存ファイルの書き方を踏襲する）
    - 確認: `grep -rnE "NODEJS_[0-9]+_X|'node[0-9]+'" infra/lib` の結果が `lambda-runtime.ts` のみである
    - 確認: `cd infra && npm run build` が成功する
    - _Requirements: 2.1, 2.4, 3.1_

  - [x] 3.4 既存テストのランタイム期待値を更新する
    - `infra/test/api-stack.test.ts` の「Node.js 24.x ランタイム」のテスト名と `Runtime: 'nodejs24.x'` を 26 に更新する
    - ほかのテストに `nodejs24.x` の直書きがないか `grep -rn "nodejs2[0-9]" infra/test` で確認し、あれば更新する
    - _Requirements: 2.2_

  - [x] 3.5 テストを実行し、スナップショットを更新する
    - `cd infra && npx vitest --run` を実行し、タスク 3.1 のテストが成功することを確認する
    - スナップショットの差分（`api-stack`、`cdn-stack`）を確認する。許容する差分はランタイム値（`nodejs26.x`）と esbuild 関連のみ。それ以外の差分がある場合は原因を調べ、意図しない変更であれば元に戻す
    - 差分が妥当であることを確認してから `npx vitest --run -u` で更新する
    - 更新後に件数がタスク 1 の基準値から減っていないこと（新規テスト分は増える）
    - _Requirements: 4.3, 6.3_

- [x] 4. Node.js バージョンの宣言と検査を追加する

  - [x] 4.1 `.nvmrc` を作成する
    - リポジトリ直下に `.nvmrc` を作成し、内容を `26` とする（Node のメジャーバージョンの唯一の宣言場所）
    - 各 `package.json` に `engines` は追加しない（宣言が 2 系統になるため）
    - _Requirements: 5.1_

  - [x] 4.2 バージョン検査スクリプトとテストを作成する
    - `infra/test/check-node-version.test.ts` を先に作成する。`infra/scripts/check-node-version.sh` を `child_process` で実行し、`NODE_MAJOR_OVERRIDE` で実行環境のメジャーを差し替えて検証する
    - **Property 3: デプロイ環境のバージョン検査** — 次の組み合わせを検証する。一致（`26` と 26）は終了コード 0。不一致（`26` と 24、`24` と 26）は非 0 で、標準エラーに必要なメジャーと実際のメジャーが含まれる。`.nvmrc` が `v26.13.1` や `26.13.1` の形式でもメジャーを正しく抽出して一致扱いになる。`.nvmrc` の末尾に改行や空白があっても動作する
    - 一時ファイルは `os.tmpdir()` 配下に作成し、テスト後に削除する
    - docstring に `**Validates: Requirements 5.1, 5.2**` を記載する
    - `infra/scripts/check-node-version.sh` を作成し、`chmod +x` する。仕様は design.md の「4. Node.js バージョン宣言と検査」のとおり（第 1 引数は `.nvmrc` のパス、`NODE_MAJOR_OVERRIDE` で実行環境のメジャーを差し替え可能、不一致なら `exit 1`）
    - このテストファイルのみを実行して成功することを確認する: `cd infra && npx vitest --run test/check-node-version.test.ts`（並行して進むタスク 3.1 のテストが失敗状態のため、全体実行では判定できない）
    - _Requirements: 5.1, 5.2_

  - [x] 4.3 `deploy.sh` に検査を組み込む
    - リポジトリ直下の `deploy.sh` で、`pushd transcription-improvement` の直後、`cdk.json` を上書きする処理の前に `bash infra/scripts/check-node-version.sh .nvmrc` を追加する
    - 既存の basePath 検証ブロック（ビルド後の `dist/index.html` 検査）と `AWS_PROFILE` の値（プレースホルダ `xxxxx`）は変更しない
    - 確認: `bash -n deploy.sh` が成功する
    - 確認: 変更後の `deploy.sh` の差分が、検査の呼び出し追加のみであること
    - `destroy.sh` には検査を追加しない
    - _Requirements: 5.2, 5.4_

- [x] 5. ドキュメントを更新する

  - [x] 5.1 steering の技術スタックを更新する
    - `.kiro/steering/tech.md` の「Backend」セクションに、Lambda ランタイムが Node.js 26（`nodejs26.x`）であること、定数が `infra/lib/constructs/lambda-runtime.ts` にあること、Node のバージョン宣言が `.nvmrc` であることを追記する
    - _Requirements: 7.1_

  - [x] 5.2 README の前提条件を更新する
    - `README.md` の「前提条件」の `Node.js 20 以上（CDK は Node 20 系推奨）` を、`Node.js 26（バージョンは .nvmrc を参照）` に変更する
    - _Requirements: 7.1_

  - [x] 5.3 ソリューションマニュアルを確認する
    - `.kiro/specs/solution-manual` 配下で `Node`、`nodejs` を検索する。設計時点では該当なし
    - 該当があれば Node 26 に更新する。なければ変更しない
    - _Requirements: 7.2_

- [x] 6. 全体を検証する

  - [x] 6.1 旧バージョンの残存を確認する
    - `grep -rnE "NODEJS_(20|22|24)_X|nodejs(20|22|24)\.x|node(20|22|24)\b" infra/lib infra/bin infra/test deploy.sh .kiro/steering README.md` の結果が空であること（`cdk.out` と `dist` は除外）
    - 過去の spec（`.kiro/specs` 配下の他ディレクトリ）の記述は履歴のため変更しない
    - _Requirements: 2.2, 2.4_

  - [x] 6.2 実バンドルで合成できることを確認する
    - `SKIP_BUNDLING` を指定せずに `cd infra && npx cdk synth dev-ApiStack --context env=dev` を実行し、esbuild が `target: 'node26'` でバンドルでき、エラーがないことを確認する（テストは `SKIP_BUNDLING=true` で動くため、実バンドルはこの手順でしか検証できない）
    - 合成後の `cdk.out/dev-ApiStack.template.json` の `AWS::Lambda::Function` が、すべて `nodejs26.x` であることを確認する
    - `backend/node_modules` がない場合は先に `cd backend && npm install` を実行する
    - _Requirements: 2.2, 3.1, 3.2_

  - [x] 6.3 全パッケージのビルドとテストを実行する
    - `backend`: `npm run build`、`npx vitest --run`
    - `infra`: `npm run build`、`npx vitest --run`
    - `frontend`: `npm run build`、`npx vitest --run`
    - **Property 4: 既存挙動の維持** — backend と infra の件数がタスク 1 の基準値から減っていないこと（infra は新規テスト分だけ増える）。frontend は既知の 2 件以外が成功すること
    - 不明な失敗がある場合は、Node 26 起因かを切り分けて報告する。既知の 2 件以外の失敗を放置して完了にしない
    - _Requirements: 4.2, 4.3, 5.3_

- [x] 7. Checkpoint - 自動検証の完了を確認する
  - タスク 1 から 6 の結果を報告し、すべてのテストが成功していることを確認する。疑問点があればユーザーに確認する
  - 変更は 1 つの PR にまとめられる単位になっていること（ランタイム定数を 24 に戻せば元に戻せること）を確認する
  - _Requirements: 6.2_

- [x]* 8. 手動検証と展開（ユーザーが実施する。サブエージェントは実行しない）
  - AWS への実デプロイと実環境の操作を伴うため、オプション扱いにしている。自動実行の対象外

  - [ ]* 8.1 変更をマージし、`deploy.sh` を反映する
    - `deploy.sh` は GitHub から `git clone` してビルドするため、`.nvmrc` と `infra/scripts/check-node-version.sh` を含む変更をマージ（または対象ブランチへ push）する
    - ローカルで実行する `deploy.sh` のコピー（`$HOME` 配下など）にも、バージョン検査の呼び出しを反映する
    - デプロイを行うマシンの Node を 26 にする（例: `nvm install 26 && nvm use 26`）
    - _Requirements: 5.2, 6.1_

  - [ ]* 8.2 dev 環境で差分を確認する
    - `cd infra && npx cdk diff --all -c ~/cdk.json` を実行し、差分がランタイム、バンドル設定、依存以外を含まないことを確認する
    - `-c ~/cdk.json` を付け忘れると、リポジトリ同梱の `cdk.json`（`basePath` 空）で合成されるので注意する
    - _Requirements: 6.3_

  - [x]* 8.3 dev 環境へデプロイし、ランタイムを確認する
    - `./deploy.sh -c ~/cdk.json` を実行する
    - `nodejs26.x` が ap-northeast-1 で使えない場合は CloudFormation がエラーを返してロールバックされる。その場合は本番へ進まず、原因を確認する
    - デプロイ後、このアプリのスタックが作成した関数の Runtime がすべて `nodejs26.x` であることを AWS CLI で確認する（同じアカウントの別アプリの関数は対象外）
    - _Requirements: 1.2, 2.1_

  - [x]* 8.4 dev 環境で主要 API のスモークテストを行う
    - 認証（`GET /me`）、セッション一覧、メディア URL 取得、アップロード URL 発行、Bedrock 候補取得を実行し、正常応答を確認する
    - Bedrock 候補取得が失敗する場合は、ランタイム同梱の AWS SDK が `backend/package.json` の版より古い可能性がある。`externalModules` から `@aws-sdk/client-bedrock-runtime` を外してバンドルに含めることを検討する
    - _Requirements: 4.5, 4.6_

  - [x]* 8.5 Custom Resource ハンドラーを疑似呼び出しで確認する
    - design.md の「Custom Resource ハンドラーの検証方法」に従う
    - テスト用の S3 署名付き PUT URL（有効期限 5 分）を発行し、`SeedAdmin` と `UpdateDistribution` のハンドラーを `RequestType: "Delete"` の疑似イベントで `aws lambda invoke` する。`ResponseURL` に署名付き URL を指定する
    - S3 に `Status: SUCCESS` の応答 JSON が書き込まれれば正常。書き込まれない場合は、各ハンドラーのインラインコードに Promise を返す `send` 関数を自前で定義し、`cfn-response` への依存を外す
    - `CloudFrontKeyPair`（実在する SSM パラメータ名を渡すと署名用秘密鍵が消える）、`S3Notification`（バケットの通知設定を書き換える）、`CallbackUrl`（Delete 時の動作が未確認）は呼ばない
    - _Requirements: 4.4, 4.7_

  - [x]* 8.6 staging、prod の順に適用する
    - dev での検証（8.3 から 8.5）が完了してから staging、続いて prod に同じ手順（8.2、8.3、8.4）で適用する
    - _Requirements: 6.1_

  - [ ]* 8.7 dev を作り直して Custom Resource の作成と削除の経路を確認する（任意）
    - `destroy.sh` で dev を削除し、再作成する機会に実施する。Create と Delete の経路（SDK クライアントの呼び出し、`crypto` の利用）が Node 26 で動くことを、スタックイベントで確認する
    - _Requirements: 4.4_

## Notes

- タスク 8 は AWS への実デプロイを伴うため、オプション（`*`）にしてある。一括実行ではキューに入らない
- タスク 1 から 7 はローカルで完結する。AWS 認証情報は不要
- `deploy.sh` は GitHub から clone してビルドするため、タスク 4 の成果物（`.nvmrc`、検査スクリプト）はマージ後でないとデプロイ時の clone に含まれない

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "4.1", "5.1", "5.2", "5.3"] },
    { "id": 2, "tasks": ["3.1", "4.2"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3", "4.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5"] },
    { "id": 7, "tasks": ["6.1", "6.2"] },
    { "id": 8, "tasks": ["6.3"] },
    { "id": 9, "tasks": ["7"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["8.3"] },
    { "id": 13, "tasks": ["8.4", "8.5"] },
    { "id": 14, "tasks": ["8.6", "8.7"] }
  ]
}
```
