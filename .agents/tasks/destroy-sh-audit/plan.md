# Implementation Plan — destroy.sh の削除漏れ C1〜M2 一括修正

対象ファイル（唯一の修正対象）: `infra/scripts/destroy.sh`
計画段階では AWS API を一切実行しない。本計画は監査レポート `findings.md`（C1〜M2）と CDK ソースの実態突き合わせに基づく。

---

## 設計判断（根拠付き・1〜2文）

- **D1. CloudFrontWafStack の削除順序**: `cdn-stack.ts` の `StaticDistribution` が `webAclId: props.cloudFrontWebAclArn`（us-east-1 の WebACL ARN）を参照するため、WebACL を先に消すと CdnStack の削除が失敗しうる。したがって `cdk destroy` のリスト順は MonitoringStack → CdnStack → ApiStack → **CloudFrontWafStack** → FoundationStack とし、CdnStack 削除後に CloudFrontWafStack を削除する（`cdk destroy` は依存解決もするが、明示順で安全側に倒す）。`bin/app.ts` で `region: 'us-east-1'` がスタックに埋め込まれているため追加の `--region` は不要。

- **D2. prod の RETAIN 後始末は cdk destroy の「後」に実行**: `foundation-stack.ts` の `dataRemovalPolicy = isProd ? RETAIN : DESTROY` と `autoDeleteObjects: !isProd` により、prod では KMS/DynamoDB/S3/Cognito がスタック削除後も残る。これらは `cdk destroy` 完了後に意図的削除として後始末する。既存の `DELETE PRODUCTION` 確認プロンプトの後、かつ `cdk destroy` の後に実行する。

- **D3. KMS 削除待機は最短 7 日**: CDK の `pendingWindow` は 30 日だが、これはスタック削除時の挙動であり、prod は RETAIN のためそもそもスケジュールされない。手動の `aws kms schedule-key-deletion` では `--pending-window-in-days 7`（最短）を使い、既存ドライラン表示の「30-day」文言を実挙動（7日スケジュール）に合わせて修正する。

- **D4. Transcribe カスタム言語モデルは全件削除**: ユーザー確認済みの前提（同居 GenU はカスタム言語モデル作成機能を持たない）に基づき、`aws transcribe list-language-models` の全件を本ソリューション由来と見なして削除する。prefix/AuditLog 絞り込みは不要。リージョンは ap-northeast-1。

- **D5. ロググループは「本ソリューション命名のみ」を安全に対象化**: `lambda-function.ts` の `LambdaFunction` 構築 Lambda は明示 LogGroup（DESTROY）を持つため cdk destroy で消える。残るのは (a) malware-scan `transcription-review-malware-scan`（明示 LogGroup 無し）、(b) ApiStack インライン CR Lambda（`${ENV}-ApiStack-CloudFrontKeyPairHandler*` / `-S3NotificationHandler*`）、(c) CdnStack の `${ENV}-CdnStack-*`（UpdateDistributionHandler/CallbackUrlHandler/BucketDeployment/AwsCustomResource）。これらは `functionName` 未指定で `/aws/lambda/<stackname>-<logicalid>-<hash>` 形式になるため、`/aws/lambda/transcription-review-` と `/aws/lambda/${ENV}-ApiStack-` と `/aws/lambda/${ENV}-CdnStack-` の 3 prefix でのみ列挙・削除し、GenU（`GenerativeAiUseCasesStack*`）を巻き込まない。CloudFrontWafStack は WAF リソースのみで Lambda を持たないため us-east-1 側に本ソリューションの Lambda ロググループは存在しない（検証のみ）。

- **D6. SSM web-acl-arn パラメータ名は確定可能**: `cloudfront-waf-stack.ts` は `/transcription-review/${id}/web-acl-arn`（`id = ${ENV}-CloudFrontWafStack`）を **us-east-1** に作成。`cloudfront-private-key` は `api-stack.ts` で `/transcription-review/${ENV}/cloudfront-private-key` を **ap-northeast-1** に作成。両者ともパラメータ名が確定するので列挙は不要（フォールバックの保険として `get-parameters-by-path --path /transcription-review/` 列挙は残存チェックに使う）。

- **D7. 既存構造・スタイルを踏襲**: `set -euo pipefail`、`log_info/log_warn/log_error/log_success`、`--dryrun` デフォルト / `--execute`、`--env`、prod 確認プロンプトをそのまま使う。新規処理は専用シェル関数として追加し、ドライラン時は「表示のみ」、`--execute` 時のみ実コマンドを発行する。全追加 AWS 操作は冪等（存在確認 or エラー握りつぶしつつログ出力）。

---

## 実装項目（依存順）

- [ ] 1. ALL_STACKS に CloudFrontWafStack を追加し削除順を確定する（C1 の中核）。
      `ALL_STACKS=("MonitoringStack" "CdnStack" "ApiStack" "FoundationStack")` を
      `ALL_STACKS=("MonitoringStack" "CdnStack" "ApiStack" "CloudFrontWafStack" "FoundationStack")` に変更（D1: CdnStack の後、FoundationStack の前）。`PREFIXED_STACKS` 生成ロジックはそのまま流用され `${ENV_NAME}-CloudFrontWafStack` が自動で含まれる。`cdk destroy "${PREFIXED_STACKS[@]}" --force` は region 埋め込み済みのため変更不要（コメントで明記）。
      Files: `infra/scripts/destroy.sh`
      Verify: `cd infra && bash -n scripts/destroy.sh`（構文OK）＋ `bash scripts/destroy.sh --dryrun --env dev` を実行し、"CloudFormation Stacks to delete" のリストに `dev-CloudFrontWafStack` が CdnStack と FoundationStack の間に表示されること（AWS 資格情報が無い環境では `get_account_id` で停止しうるため、資格情報が無ければ構文チェックと目視レビューで代替）。

- [ ] 2. REGION 固定を見直し、us-east-1 用の定数と両リージョン対応の下地を追加する。
      既存 `REGION="ap-northeast-1"` は ap-northeast-1 側リソース用にそのまま維持し、新たに `REGION_CFWAF="us-east-1"` 定数を追加。`show_stack_status` を「リージョン引数を取れる」形に拡張（第2引数 `region` を受け、未指定時は `$REGION`。内部の `aws cloudformation describe-stacks` に `--region "$region"` を付与）。これにより CloudFrontWafStack の状態を us-east-1 で問い合わせ可能にする。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。`show_stack_status "dev-CloudFrontWafStack" "us-east-1"` 呼び出しがドライランで us-east-1 を参照する（コード目視 + 項目8のドライラン出力で確認）。

- [ ] 3. ドライランレポートに CloudFrontWafStack(us-east-1) と新規削除対象を表示する（C1/H2/M1/M2 の dry_run 表示）。
      `dry_run()` 内のスタック一覧表示ループで、`CloudFrontWafStack` を含む PREFIXED_STACKS は region を判定して `show_stack_status "$stack" "$region"` を呼ぶ（`*CloudFrontWafStack` のみ us-east-1、他は ap-northeast-1）。さらにドライラン末尾に「--execute 時に追加で削除/掃除される項目」として、(a) SSM `/transcription-review/${ENV_NAME}/cloudfront-private-key`(ap-northeast-1) と `/transcription-review/${ENV_NAME}-CloudFrontWafStack/web-acl-arn`(us-east-1)、(b) 自動生成ロググループ 3 prefix、(c) Transcribe 言語モデル全件、(d) prod のみ: DynamoDB/S3/KMS(7日スケジュール)/Cognito の後始末、を列挙表示する。既存 KMS の「30-day」表示は「7-day（手動 schedule-key-deletion、最短）」に修正（D3）。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash scripts/destroy.sh --dryrun --env dev` と `--env prod`（prod は確認プロンプト前に dry_run が走る）で、上記 (a)〜(c) が dev/prod 両方に、(d) が prod のみに表示され、KMS 文言が 7-day になること。

- [ ] 4. SSM パラメータのフォールバック削除関数 `delete_ssm_parameters()` を追加する（H2）。
      冪等関数を新設: ap-northeast-1 で `aws ssm delete-parameter --name "/transcription-review/${ENV_NAME}/cloudfront-private-key" --region "$REGION"`、us-east-1 で `aws ssm delete-parameter --name "/transcription-review/${ENV_NAME}-CloudFrontWafStack/web-acl-arn" --region "$REGION_CFWAF"` を実行。各削除は「存在確認（`aws ssm get-parameter` or 削除の非ゼロ終了）→ 無ければ `log_info` でスキップ、成功で `log_success`、想定外エラーは `log_warn`」。保険として `aws ssm get-parameters-by-path --path /transcription-review/ --recursive`（両リージョン）で `/transcription-review/${ENV_NAME}` 配下に残存があれば警告ログを出す（GenU 等 prefix 外は対象外）。`set -e` 下でも関数が落ちないよう個々のコマンドは `|| true` + 明示判定でガード。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。ドライラン表示（項目3）と関数名・パラメータ名の一致を目視。関数内の全 aws 呼び出しに正しい `--region` が付いていること。

- [ ] 5. 自動生成ロググループ掃除関数 `delete_log_groups()` を追加する（M1）。
      冪等関数を新設。対象 prefix（D5）: `/aws/lambda/transcription-review-`（malware-scan 等を含む。LambdaFunction 構築分は既に削除済みでも describe で空になるだけ）、`/aws/lambda/${ENV_NAME}-ApiStack-`、`/aws/lambda/${ENV_NAME}-CdnStack-`。各 prefix について ap-northeast-1 で `aws logs describe-log-groups --log-group-name-prefix <prefix> --region "$REGION" --query 'logGroups[].logGroupName' --output text` → 空白区切りをループして `aws logs delete-log-group --log-group-name <name> --region "$REGION"`。GenU の `GenerativeAiUseCasesStack*` 由来は上記 prefix に合致しないため対象外（コメントで明記）。us-east-1 側は CloudFrontWafStack が Lambda を持たない（WAF のみ）ため削除対象なし——`/aws/lambda/${ENV_NAME}-CloudFrontWafStack-` を describe して「0 件であること」を確認するログのみ出す。削除失敗は `log_warn` で継続。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。prefix 3 種が D5 の命名（`transcription-review-malware-scan` と CR Lambda の `${ENV}-ApiStack-*` / `${ENV}-CdnStack-*`）に一致することを `api-stack.ts`/`cdn-stack.ts`/`malware-scan.ts` の logicalId と突き合わせて目視確認。

- [ ] 6. Transcribe カスタム言語モデル削除関数 `delete_language_models()` を追加する（M2）。
      冪等関数を新設。`aws transcribe list-language-models --region "$REGION" --query 'Models[].ModelName' --output text` で全件取得（D4: GenU は本機能なしのため全件が本ソリューション由来）。空（または `None`）ならスキップログ。各モデルを `aws transcribe delete-language-model --model-name "$name" --region "$REGION"` で削除し `log_success`、失敗は `log_warn`。トレーニングデータ `s3://transcription-review-data-${ACCOUNT_ID}/training-data/<modelName>/` は Data バケット空化（`empty_buckets`）で消えるため追加処理不要——コメントで明記。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。region が ap-northeast-1 であること、`list-language-models` が無絞り込み（prefix/AuditLog なし）であることを目視。

- [ ] 7. prod RETAIN リソースの後始末関数 `cleanup_retained_prod_resources()` を追加する（H1）。
      冪等関数を新設し、`ENV_NAME == prod` かつ `--execute` のときのみ、`cdk destroy` 完了後に呼ぶ。内容（全て存在確認→無ければスキップ）:
      (1) DynamoDB: `aws dynamodb describe-table --table-name TranscriptionReviewApp --region "$REGION"` が成功なら `aws dynamodb delete-table --table-name TranscriptionReviewApp --region "$REGION"`。
      (2) S3 3 バケット: 既存 `empty_buckets`（media/data/static のハードコード名を流用）で空化後、各バケットに `aws s3api delete-bucket --bucket <name> --region "$REGION"`（存在時のみ）。
      (3) KMS: FoundationStack Outputs ではなく alias から鍵を特定——`aws kms describe-key --key-id alias/transcription-review-app --region "$REGION" --query 'KeyMetadata.KeyId'` で KeyId 取得→ `aws kms schedule-key-deletion --key-id <id> --pending-window-in-days 7 --region "$REGION"`（D3。既に PendingDeletion なら握りつぶしてログ）。
      (4) Cognito: 既存ドライランと同じく cdk.json context の `cognitoUserPoolId` を node で読み、**非空なら import プールとして削除しない**（スキップログ）。空（=CDK 作成）なら FoundationStack Outputs(UserPoolId) を `aws cloudformation describe-stacks`（ただし prod では既にスタック削除済みの可能性が高い点に注意）→ 取得できなければ `aws cognito-idp list-user-pools --max-results 60 --region "$REGION"` から `TranscriptionReviewAppUserPool` 名で特定→ `aws cognito-idp delete-user-pool --user-pool-id <id> --region "$REGION"`。import プール判定ロジックは既存 dry_run の node 一行（`require('./cdk.json').context.cognitoUserPoolId`）を流用。
      各操作は失敗を `log_warn` で記録しつつ継続（set -e 下で関数が中断しないようガード）。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。prod 以外で呼ばれないガード、import プール（context 設定時）を削除しない分岐、KMS が 7 日スケジュールであることを目視確認。

- [ ] 8. `execute_destroy()` に新規後始末の呼び出しと両リージョン検証を組み込む（C1/H1/H2/M1/M2 + 検証）。
      `npx cdk destroy "${PREFIXED_STACKS[@]}" --force` の **後** に、FoundationStack を削除対象に含む場合のみ順に: `delete_language_models`（M2）→ `delete_ssm_parameters`（H2）→ `delete_log_groups`（M1）→ prod かつ FoundationStack 削除時のみ `cleanup_retained_prod_resources`（H1）を呼ぶ。言語モデル・SSM・ロググループは env 非依存（dev/staging でも残るため常に実行）。検証ループは `*CloudFrontWafStack` を us-east-1 で、それ以外を ap-northeast-1 で `describe-stacks` する（項目2の拡張 `show_stack_status` or 直接 `--region` 指定）。検証末尾に残存チェックを追加: SSM 2 パラメータ（両リージョン）、ロググループ 3 prefix（ap-northeast-1）、言語モデル（ap-northeast-1）が 0 件であることを確認し、残っていれば `log_warn`。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash -n scripts/destroy.sh`。呼び出し順が D1〜D5 と整合（モデル→SSM→ログ→prod後始末、検証は両リージョン）していること、特定スタックのみ指定時（例: `--execute MonitoringStack`）には FoundationStack 連動処理がスキップされることを分岐で確認。

- [ ] 9. ヘルプ/コメント/先頭ドキュメントの整合を取る。
      スクリプト冒頭コメントの Examples/Options は維持しつつ、us-east-1 の CloudFrontWafStack も削除対象になった旨、prod では RETAIN リソースを 7 日 KMS スケジュールで後始末する旨、言語モデル全件削除の前提（GenU はカスタム言語モデル非対応）を短く追記。`usage()` は `head -25` 依存のため、追記で行数がずれる場合は `head` の行数または抽出方法を合わせて調整し、`--help` 出力が壊れないようにする。
      Files: `infra/scripts/destroy.sh`
      Verify: `bash scripts/destroy.sh --help` がエラーなく Usage を表示すること（`bash -n` 併せて実行）。

- [ ] 10. 全体の静的検証とドライラン総合確認。
      `cd infra && bash -n scripts/destroy.sh` で構文、`shellcheck scripts/destroy.sh`（導入済みなら。未導入なら skip をログ）で lint、`bash scripts/destroy.sh --dryrun --env dev` と `--dryrun --env prod` でレポートに C1〜M2 の全対象が表示され、過剰削除ガード（CDKToolkit/GenU 不関与、import Cognito 非削除、prefix 限定）がコメント/分岐で担保されていることを最終確認。`--execute` は AWS に対する破壊的操作のため本計画・実装検証では実行しない（dry-run とコードレビューで代替）。
      Files: `infra/scripts/destroy.sh`
      Verify: 上記コマンドが非ゼロ終了せず、ドライラン出力に CloudFrontWafStack(us-east-1)/SSM 2件/ロググループ3prefix/言語モデル/prod後始末(7-day KMS) がすべて現れること。

---

## 過剰削除防止の担保（レビュー観点チェックリスト）

- CDK Bootstrap（`CDKToolkit` / `cdk-assets`・`cdk-*` バケット）に触れる処理が無いこと（スタック名・バケット名ともハードコード対象外）。
- GenU（`GenerativeAiUseCasesStack*` スタック、その S3 等）に合致する削除処理が無いこと。ロググループは `/aws/lambda/transcription-review-` / `/aws/lambda/${ENV}-ApiStack-` / `/aws/lambda/${ENV}-CdnStack-` の 3 prefix に限定（GenU の命名に非該当）。
- SSM 削除は `/transcription-review/*` 配下のみ。列挙時も prefix 外は警告のみで削除しない。
- Transcribe 言語モデルの全件削除は「GenU がカスタム言語モデル非対応」（ユーザー確認済み）という前提に依存する旨をコメントで明記。
- Cognito は cdk.json `cognitoUserPoolId` が設定済み（import）なら削除しない。
- 削除対象は本ソリューション命名規則（`transcription-review-*` / `${ENV_NAME}-*Stack` / `TranscriptionReviewApp` / `alias/transcription-review-app` / `TranscriptionReview-${ENV_NAME}-*` / `/transcription-review/*`）に合致するものに限定。

## 既知のギャップ・前提（実装者向け）

- 実行環境に AWS 資格情報が無い場合、`get_account_id` が早期に `exit 1` するため、ドライランの full 実行は資格情報前提。CI 等では `bash -n` / `shellcheck` / 目視レビューを verify の中心に据える。
- prod で `cdk destroy` 後に FoundationStack スタック自体は消えるが RETAIN リソースは残る。Cognito UserPoolId を Outputs から取れないケース（スタック削除済み）に備え、`list-user-pools` 名前一致フォールバックを用意済み（項目7）。
- CloudFrontWafStack は WAF リソースのみで Lambda を含まないため、us-east-1 側の本ソリューション Lambda ロググループは存在しない（検証で 0 件確認のみ）。WAF の CloudWatch メトリクスは自動失効のため明示削除不要。
