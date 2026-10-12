# destroy.sh 修正 — 検証結果

対象ファイル: `infra/scripts/destroy.sh`（唯一の修正対象）
実施内容: 監査レポート `findings.md` の削除漏れ C1〜M2 を一括修正。静的検証のみ（AWS API を伴う破壊的操作は未実施）。

---

## 実装した finding

| ID | 内容 | 実装箇所 |
|----|------|----------|
| C1 [Critical] | `ALL_STACKS` に `CloudFrontWafStack` を追加（CdnStack の後・FoundationStack の前）。`cdk destroy` は stack 埋め込み region(us-east-1) を使うため追加 `--region` 不要。dry_run にも us-east-1 表示を追加。 | `ALL_STACKS`、`stack_region()`、`show_stack_status()`（region 引数化）、`dry_run()`、`execute_destroy()` 検証ループ |
| H1 [High] | prod RETAIN リソースを cdk destroy 後に明示削除（DynamoDB delete-table / S3 空化+delete-bucket / KMS schedule-key-deletion 7日 / Cognito は CDK 作成プールのみ削除、import は保持）。 | `cleanup_retained_prod_resources()`、`execute_destroy()` から prod 時のみ呼び出し |
| H2 [High] | SSM `/transcription-review/${ENV}/cloudfront-private-key`(ap-northeast-1) と `/transcription-review/${ENV}-CloudFrontWafStack/web-acl-arn`(us-east-1) をフォールバック削除。両リージョンで `/transcription-review/` 配下の残存を警告。 | `delete_ssm_parameters()` |
| M1 [Medium] | 自動生成 Lambda ロググループを 3 prefix（`/aws/lambda/transcription-review-`、`/aws/lambda/${ENV}-ApiStack-`、`/aws/lambda/${ENV}-CdnStack-`）で列挙削除。us-east-1 の CloudFrontWafStack 側は Lambda 無しのため 0 件確認のみ。 | `delete_log_groups()` |
| M2 [Medium] | Transcribe カスタム言語モデルを `list-language-models` 全件削除（GenU はカスタム言語モデル非対応という確認済み前提に基づき絞り込み不要）。リージョン ap-northeast-1。 | `delete_language_models()` |

検証フェーズ: `execute_destroy()` 末尾に ap-northeast-1 / us-east-1 両リージョンの削除後検証を追加（スタックは per-stack region で `describe-stacks`、SSM 2 件・ロググループ 3 prefix・言語モデルの残存チェック）。

### ソースとの突き合わせ（命名確定）
- `bin/app.ts`: `CloudFrontWafStack` は id=`${env}-CloudFrontWafStack`、`region: 'us-east-1'`。CdnStack は `cloudFrontWebAclArn` 経由で WebACL を参照（削除順の根拠）。
- `cloudfront-waf-stack.ts`: SSM `parameterName = /transcription-review/${id}/web-acl-arn`（id=`${env}-CloudFrontWafStack`、us-east-1）。
- `api-stack.ts`: SSM `/transcription-review/${envName}/cloudfront-private-key`（ap-northeast-1）。
- `foundation-stack.ts`: KMS alias `transcription-review-app`、バケット `transcription-review-{media,data,static}-${ACCOUNT_ID}`、UserPool 名 `TranscriptionReviewAppUserPool`、Output `UserPoolId`、import 判定は context `cognitoUserPoolId`。
- `malware-scan.ts`: `functionName: 'transcription-review-malware-scan'` → ロググループは `/aws/lambda/transcription-review-` prefix に合致。

---

## 過剰削除防止の確認（コードレビュー）
- CDK Bootstrap（CDKToolkit / cdk-* バケット）に触れる処理は無い。
- GenU（`GenerativeAiUseCasesStack*`）に合致する削除処理は無い。ロググループは本ソリューション 3 prefix のみ。
- SSM は `/transcription-review/*` のみ対象。列挙時の prefix 外は警告のみ（削除しない）。
- Cognito は context `cognitoUserPoolId` 設定時（import）は削除せず保持。
- Transcribe 全件削除は「GenU はカスタム言語モデル非対応」前提をコメントで明記。

---

## 実行した検証コマンドと結果

### 1. bash 構文チェック
```
cd infra && bash -n scripts/destroy.sh
```
結果: **成功**（`SYNTAX_OK`、exit 0）。構文エラーなし。

### 2. shellcheck
```
which shellcheck
```
結果: **未導入**（`shellcheck not found`）。環境に shellcheck が無いためスキップ。

### 3. --help 出力確認
```
bash scripts/destroy.sh --help
```
結果: **成功**（exit 0）。Usage/Options/Examples/Notes/Requirements を表示。追記で行数がずれたため `usage()` の `head -25` を `head -31` に調整し、コメントブロック末尾（`# Requirements:`）までを正しく表示、`set -euo` 以降の非コメント行は混入しないことを確認。

### 4. dry-run レポート確認（aws/node をスタブして実行）
AWS 資格情報が無い環境のため、`get_account_id` を通すために `aws`/`node` を最小スタブ化（PATH 差し替え）して dry_run の表示を検証。破壊的 AWS 操作は一切発生しない。

- `--dryrun --env dev`: 以下を確認（exit 0）。
  - "CloudFormation Stacks to delete" に `dev-CloudFrontWafStack (us-east-1)` が CdnStack と FoundationStack の**間**に表示。
  - "Additional cleanup on --execute" に SSM 2 件（private-key=ap-northeast-1 / web-acl-arn=us-east-1）、ロググループ 3 prefix、言語モデル全件が表示。
  - KMS 表示が「7-day waiting period (minimum)」に修正されている。
  - prod 専用の RETAIN ブロックは dev では**非表示**。
- `--dryrun --env prod`: "PROD RETAIN resources" ブロックに DynamoDB / S3 / KMS(7-day) / Cognito(import は保持) が表示されることを確認。

---

## 注記 / 限界
- 本検証はコードと dry_run 表示の静的確認のみ。`--execute` による実リソース削除・実 AWS API 呼び出しは未実施（指示どおり）。
- dry_run の full 実行は本来 AWS 資格情報が必要（`get_account_id` が無資格だと早期 exit）。本検証では aws/node スタブで表示系のみ確認した。
- shellcheck 未導入のため lint 警告は未確認。導入環境での再実行を推奨。
