# destroy.sh — 削除漏れ修正（C1〜M2）のレビュー

`infra/scripts/destroy.sh` に、監査レポート `findings.md` が挙げた削除漏れ C1〜M2 を一括実装した変更をレビューした。CloudFrontWafStack(us-east-1) を削除対象に追加し、`cdk destroy` では消えない/課金が残るリソース（SSM SecureString、自動生成 Lambda ロググループ、Transcribe カスタム言語モデル、prod の RETAIN リソース）を `--execute` 後に意図的削除する4つの冪等関数を追加し、検証フェーズを両リージョン対応にしている。実装は CDK ソース（`bin/app.ts` / `cloudfront-waf-stack.ts` / `api-stack.ts` / `foundation-stack.ts` / `malware-scan.ts` / `cdn-stack.ts`）の実態と命名が一致しており、過剰削除制約（CDK Bootstrap・GenU 不関与、本ソリューション命名への限定）も守られている。

Watch for: 本リポジトリは git 管理下になく diff は取得不能のため、レビューは現行ファイルを findings/plan の仕様として読み合わせて評価した（confirmed）。prod の Cognito 削除は `delete-user-pool` が成功するにはプール内のユーザー/クライアント/ドメイン前提に依存するが、FoundationStack 削除でそれらが先に消えるため実務上は問題にならない見込み（possible、下記 Observation 参照、ブロッキングではない）。

**Verdict**: APPROVED

## High-level view

C1 は `ALL_STACKS` に `CloudFrontWafStack` を CdnStack と FoundationStack の間へ挿入することで解決している。CdnStack のディストリビューションが us-east-1 の WebACL ARN（`cloudFrontWebAclArn` → `webAclId`）を参照するため、WebACL を先に消すと CdnStack 削除が失敗しうる。この依存はソースで確認でき、挿入順は正しい。`cdk destroy` は各スタックに埋め込まれた `region: 'us-east-1'` を使うため追加の `--region` は不要で、その旨コメントにも明記されている。

H1 は prod で `foundation-stack.ts` が KMS/DynamoDB/S3/Cognito に RETAIN を適用し `autoDeleteObjects: !isProd` となる実態に対応する。`cleanup_retained_prod_resources()` が `cdk destroy` 後・`DELETE PRODUCTION` 確認後に DynamoDB delete-table、S3 空化+delete-bucket、KMS schedule-key-deletion(7日)、Cognito(import は保持・CDK 作成のみ削除) を冪等に実行する。ドライラン表示の「30-day」文言は「7-day waiting period (minimum)」へ修正済み。

H2 は確定可能な2つのパラメータ名を直接狙う。`/transcription-review/${ENV}/cloudfront-private-key`(ap-northeast-1) と `/transcription-review/${ENV}-CloudFrontWafStack/web-acl-arn`(us-east-1) を存在確認してから delete、無ければ静かにスキップ。加えて両リージョンで `/transcription-review/` 配下の残存を警告（削除はしない）する安全網を持つ。パラメータ名はソースと一致する。

M1 のロググループ掃除は本ソリューション命名に限定した3 prefix（`/aws/lambda/transcription-review-`、`/aws/lambda/${ENV}-ApiStack-`、`/aws/lambda/${ENV}-CdnStack-`）のみを列挙削除し、us-east-1 側は CloudFrontWafStack が Lambda を持たないため0件確認に留める。M2 は `list-language-models` 全件を ap-northeast-1 で削除、無ければスキップする。両者とも GenU の命名（`GenerativeAiUseCasesStack*`）には合致しない。

<details>
<summary>Issues (0 blocking / 2 non-blocking observations)</summary>

1. **git diff 不在（informational）** — 対象パスは git 管理下になく diff/base branch 比較は不能。現行ファイルを findings/plan の仕様として読み合わせて評価した。判定には影響しない。
2. **prod Cognito 削除順序（observation, possible）** — `delete-user-pool` はドメイン付きプールだと先にドメイン削除が要るが、FoundationStack 削除でドメイン/クライアントが先に消えるため実務上は成功する見込み。失敗しても `log_warn` で継続し中断しない。ブロッキングではない。

</details>

<details>
<summary>Details</summary>

### C1 — CloudFrontWafStack(us-east-1) の削除対象追加と削除順序

`ALL_STACKS=("MonitoringStack" "CdnStack" "ApiStack" "CloudFrontWafStack" "FoundationStack")` となっており、CdnStack の後・FoundationStack の前に挿入されている。`cdn-stack.ts:535` の `webAclId: props.cloudFrontWebAclArn` と `bin/app.ts:98` の `cloudFrontWebAclArn: cloudFrontWafStack.webAclArn` により、CdnStack が us-east-1 WebACL を参照する依存が確認できる。したがって WebACL を保持する CloudFrontWafStack を CdnStack より後に消す順序は正しい。

`PREFIXED_STACKS` 生成は既存ロジックを流用し `${ENV_NAME}-CloudFrontWafStack` が自動的に含まれる。`stack_region()` が `*CloudFrontWafStack` を `us-east-1`、他を `ap-northeast-1` に振り分け、`show_stack_status()` は region 引数を取る形に拡張されている。dry_run のスタック一覧ループは `show_stack_status "$stack" "$(stack_region "$stack")"` を呼ぶため、`dev-CloudFrontWafStack (us-east-1)` が CdnStack と FoundationStack の間に表示される。検証ループも per-stack region で `describe-stacks` する。C1 は漏れなく実装されている。

### H1 — prod RETAIN リソースの意図的削除

`cleanup_retained_prod_resources()` は `ENV_NAME == prod` かつ FoundationStack がスコープ内のときだけ `cdk destroy` 後に呼ばれる。呼び出しは `DELETE PRODUCTION` 確認プロンプト通過後。4処理すべてが存在確認→無ければスキップの冪等構造を持つ:

- DynamoDB: `describe-table` 成功時のみ `delete-table`。
- S3: `empty_buckets` で3バケット空化後、`head-bucket` 成功時のみ `delete-bucket`。
- KMS: `alias/transcription-review-app` から KeyId を解決し `schedule-key-deletion --pending-window-in-days 7`。既に PendingDeletion なら warn で継続。CDK の 30日 `pendingWindow` はスタック削除時の挙動で prod RETAIN には適用されないため、手動最短7日は妥当。
- Cognito: cdk.json context の `cognitoUserPoolId` が非空（import）なら削除せずスキップ。空（CDK 作成）なら Outputs → `list-user-pools` 名前一致（`TranscriptionReviewAppUserPool`）のフォールバックで特定して削除。

ドライラン KMS 表示は「7-day waiting period (minimum)」に修正され、findings の「30-day 文言修正」要求を満たす。prod 専用ブロックは dev では非表示。

Observation（非ブロッキング, possible）: `delete-user-pool` はホストUIドメイン付きプールでは先にドメイン削除を要する。ただし CDK 作成経路ではドメイン/クライアントは FoundationStack 内リソースで、`cdk destroy` により先に削除されるため、後始末時点では delete-user-pool が通る見込み。失敗しても `log_warn` で握りつぶして継続するため teardown は止まらない。

### H2 — SSM SecureString / web-acl-arn のフォールバック削除

`delete_ssm_parameters()` は2つの確定パラメータを両リージョンで処理する。`cloudfront-private-key` は `api-stack.ts:129` の `/transcription-review/${envName}/cloudfront-private-key`（ap-northeast-1）と一致、`web-acl-arn` は `cloudfront-waf-stack.ts:129` の `/transcription-review/${id}/web-acl-arn`（id=`${ENV}-CloudFrontWafStack`、us-east-1）と一致する。各削除は `get-parameter` で存在確認し、無ければ `log_info` スキップ、成功で `log_success`、失敗で `log_warn`。`set -e` 下でも `>/dev/null 2>&1` + 明示 if 判定でガードされ関数は中断しない。安全網の `get-parameters-by-path --path /transcription-review/ --recursive` は両リージョンで残存を警告するのみで削除しないため、prefix 外（GenU 等）を巻き込まない。H2 は両リージョン考慮で実装されている。

### M1 — 自動生成 Lambda ロググループの限定削除

`delete_log_groups()` の対象 prefix は3種。`malware-scan.ts:95/107` の `transcription-review-malware-scan` は `/aws/lambda/transcription-review-` に合致する。ApiStack/CdnStack のインライン CR Lambda（`CloudFrontKeyPairHandler`、`S3NotificationHandler`、`UpdateDistributionHandler`、`CallbackUrlHandler`、`DescribeUserPoolDomain`、`DeployFrontend`）はいずれも `functionName` 未指定で、CloudFormation 生成名 `${stackName}-<logicalId>-<hash>` となるため `/aws/lambda/${ENV}-ApiStack-` と `/aws/lambda/${ENV}-CdnStack-` に捕捉される。`${id}-SpaRewrite` は CloudFront Function であり Lambda ロググループを生成しないため対象外で正しい。GenU の `GenerativeAiUseCasesStack*` は3 prefix のいずれにも合致しない。us-east-1 側は `${ENV}-CloudFrontWafStack-` prefix で describe し0件を確認するだけ（削除しない）で、CloudFrontWafStack が WAF のみで Lambda を持たない実態と整合する。本ソリューションのロググループのみを安全に対象化しており、us-east-1 の考慮もある。

### M2 — Transcribe カスタム言語モデルの全件削除

`delete_language_models()` は ap-northeast-1 で `list-language-models` の全 `ModelName` を取得し、各件を `delete-language-model` で削除、無ければスキップする。prefix 絞り込みをしないのは「GenU はカスタム言語モデル非対応」というユーザー確認済みの前提に依存し、コメントに明記されている。この前提は original_user_request のメッセージ4（「GenU はカスタム言語モデルを作成する機能を持たないので心配不要」）と一致する。トレーニングデータは Data バケットにあり `empty_buckets` で消えるため追加処理不要。region は要求どおり ap-northeast-1。

### 検証フェーズの両リージョン対応

`execute_destroy()` 末尾の検証は、スタックを per-stack region（CloudFrontWafStack→us-east-1、他→ap-northeast-1）で `describe-stacks` する。残存チェックは SSM 2件（ap-northeast-1 の private-key / us-east-1 の web-acl-arn）、ロググループ3 prefix（ap-northeast-1）、言語モデル（ap-northeast-1）を確認し、残っていれば `log_warn`。両リージョンに対応している。

### 呼び出し順序とスコープガード

`npx cdk destroy` 後、FoundationStack がスコープ内のときだけ `delete_language_models` → `delete_ssm_parameters` → `delete_log_groups` → (prod のみ) `cleanup_retained_prod_resources` を呼ぶ。言語モデル/SSM/ロググループは env 非依存で dev/staging でも残るため常時実行される一方、特定スタックのみ指定時（例 `--execute MonitoringStack`）は FoundationStack 連動処理がスキップされる分岐になっている。

### 過剰削除制約

- CDK Bootstrap: `CDKToolkit`・`cdk-*` バケットに触れる処理は無い（grep 一致なし）。
- GenU: `GenerativeAiUseCasesStack*` に合致する削除処理は無い。ロググループ3 prefix・SSM `/transcription-review/*`・KMS alias・バケット名・UserPool 名いずれも本ソリューション命名に限定。
- Cognito: import（context 設定時）は削除せず保持。
- 命名規則: `transcription-review-*` / `${ENV_NAME}-*Stack` / `TranscriptionReviewApp` / `alias/transcription-review-app` / `TranscriptionReview-${ENV_NAME}-*`（REGIONAL IPSet 等はスタック削除で消える）/ `/transcription-review/*` に限定。
- 既存スタイル: `set -euo pipefail`、`log_*` 関数、`--dryrun`/`--execute`/`--env`、prod `DELETE PRODUCTION` 確認を踏襲し、追加処理は専用関数化・冪等化されている。

過剰削除の違反は検出されなかった。

### 検証エビデンス

`verification.md` に `bash -n`（SYNTAX_OK, exit 0）、shellcheck（環境未導入のためスキップと明記）、`--help` 出力確認、aws/node スタブによる dry_run 表示確認が記録されている。shellcheck は未導入で未実施だが欠落ではなくスキップ理由が明記されている。本レビューでは具体的疑義の確認として `bash -n scripts/destroy.sh` を1回のみ再実行し SYNTAX_OK を確認した（指示の許容範囲内のスポットチェック）。実 AWS 操作は一切行っていない。

</details>

<details>
<summary>File map</summary>

- `infra/scripts/destroy.sh` — C1〜M2 の全修正。`ALL_STACKS` に CloudFrontWafStack 追加、`REGION_CFWAF`/`stack_region()`/`show_stack_status(region引数)` 追加、dry_run の両リージョン表示と追加掃除項目表示（KMS 7-day 修正）、新規関数 `delete_ssm_parameters` / `delete_log_groups` / `delete_language_models` / `cleanup_retained_prod_resources`、`execute_destroy` への後始末呼び出しと両リージョン検証の組み込み。

git 管理外のため diff は取得できず、現行ファイル全体を仕様（findings.md / plan.md）と読み合わせて評価した。

</details>
