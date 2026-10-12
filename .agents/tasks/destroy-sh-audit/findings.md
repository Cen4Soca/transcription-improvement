# destroy.sh 監査レポート — 削除漏れ・コスト発生リソースの監査

対象: `infra/scripts/destroy.sh`
突き合わせ対象: `infra/bin/app.ts`, `infra/cdk.json`, `infra/lib/stacks/*`, `infra/lib/constructs/*`
調査種別: 読み取り専用（コード・スクリプトの静的突き合わせのみ。AWS API 呼び出し・削除・編集は未実施）

---

## 1. サマリ（結論）

**漏れなく削除できているか: NO（重大な漏れあり）。重大度: Critical。**

`destroy.sh` は 4 スタック（`MonitoringStack` / `CdnStack` / `ApiStack` / `FoundationStack`）を `cdk destroy` で削除し、S3 バケット 3 つを空にするだけのスクリプトである。しかし本ソリューションは `bin/app.ts` で **5 スタック**（上記 4 + `CloudFrontWafStack`）を生成しており、さらに `cdk destroy` では消えない/課金が残る複数のリソースが存在する。主要な問題は次の通り。

- **`CloudFrontWafStack`（us-east-1）が削除対象に一切含まれていない**（`ALL_STACKS` に無く、スクリプト全体が `REGION=ap-northeast-1` 固定）。WAF WebACL / IPSet / SSM パラメータ / CloudWatch ログが us-east-1 に残り、課金とデータが残存する。→ **Critical（コスト残存 + 設定データ残存）**
- **CloudFront 署名鍵の SSM SecureString パラメータ** `/transcription-review/<env>/cloudfront-private-key` が、Custom Resource の Delete で消える設計だが、スクリプトは手動フォールバックを持たない。CR の Delete が失敗/スキップされると**秘密鍵が残存**。→ **High（機密データ残存）**
- **自動生成される `/aws/lambda/*` CloudWatch Logs グループ**（Custom Resource 用インライン Lambda 群は明示 LogGroup を持たないため AWS が自動生成し、CloudFormation 管理外で残存）。→ **Medium（データ + 小額課金残存）**
- **prod 環境では S3/DynamoDB/KMS/Cognito が `RETAIN`**（`dataRemovalPolicy = RETAIN`）。destroy.sh は prod でこれらを手動削除しないため、**データと KMS/テーブル課金が残存**。→ prod で High。
- **Transcribe カスタム言語モデル**（`CreateLanguageModel` で作成されうる、CloudFormation 管理外リソース）はどこからも削除されない。→ Medium。

結論として、dev/staging でも us-east-1 の WAF スタックと Lambda ログが残り、「費用ゼロ・データ完全削除」というコンプライアンス/コスト要件を**満たしていない**。

---

## 2. destroy.sh が削除しているリソース一覧

| 処理 | 内容 | 該当箇所 |
|------|------|----------|
| スタック削除 | `${ENV}-MonitoringStack`, `${ENV}-CdnStack`, `${ENV}-ApiStack`, `${ENV}-FoundationStack` を `npx cdk destroy --force` | `ALL_STACKS`（37行目）, `execute_destroy()`（`npx cdk destroy "${PREFIXED_STACKS[@]}" --force`） |
| S3 バケットを空にする | `transcription-review-media-<account>`, `-data-<account>`, `-static-<account>` の全オブジェクト・全バージョン・削除マーカーを削除 | `empty_buckets()`（`buckets=(...)` と `list-object-versions` → `delete-objects`、`aws s3 rm --recursive`） |
| リージョン | `ap-northeast-1` 固定 | `REGION="ap-northeast-1"`（34行目） |
| prod ガード | prod 時に `DELETE PRODUCTION` 入力を要求 | `execute_destroy()` 内 |
| 検証 | 削除後に `describe-stacks` でステータス確認 | `execute_destroy()` 末尾 |

ドライラン表示（削除処理ではなく情報表示のみ）: KMS キー（30日スケジュール削除の案内文のみ、実削除コマンドなし）、DynamoDB テーブル要約、Cognito/CloudFront の import 状態表示。

**重要:** スクリプトは `CloudFrontWafStack`、SSM パラメータ、CloudWatch Logs、ECR、Transcribe、SNS 等への削除処理を**一切持たない**（`grep` で `CloudFrontWafStack|us-east-1|SSM|SecureString|cloudfront-private-key|LanguageModel|transcribe` はいずれもマッチなし）。

---

## 3. CDK が作成する全リソース一覧（スタック別）

### CloudFrontWafStack（`${env}-CloudFrontWafStack`, **us-east-1**） — `bin/app.ts` + `cloudfront-waf-stack.ts`
- `wafv2.CfnIPSet`（CLOUDFRONT scope）`CloudFrontIpSet`
- `wafv2.CfnWebACL`（CLOUDFRONT scope）`CloudFrontWebAcl`
- `ssm.StringParameter` `WebAclArnParam` = `/transcription-review/${id}/web-acl-arn`
- WAF の CloudWatch メトリクス（`sampledRequestsEnabled`/`cloudWatchMetricsEnabled: true`）

### FoundationStack（`${env}-FoundationStack`, ap-northeast-1） — `foundation-stack.ts`
- `kms.Key` `AppKey`（alias `transcription-review-app`, rotation 有効, `pendingWindow: 30日`, `removalPolicy = dataRemovalPolicy`）
- `dynamodb.Table` `TranscriptionReviewApp`（PITR 有効, CMK 暗号化, GSI1/GSI2, `removalPolicy = dataRemovalPolicy`）
- `s3.Bucket` `MediaBucket` = `transcription-review-media-<account>`（KMS, versioning は未指定だが lifecycle あり, `autoDeleteObjects: !isProd`）
- `s3.Bucket` `DataBucket` = `transcription-review-data-<account>`
- `s3.Bucket` `StaticBucket` = `transcription-review-static-<account>`
- `cognito.UserPool`（新規作成時）`TranscriptionReviewAppUserPool` + `UserPoolClient` + Hosted UI ドメイン（`addDomain`。import 時は作成しない）
- 条件付き（`initialAdminEmail` 指定時）: `iam.Role` `SeedAdminRole`, インライン `lambda.Function` `SeedAdminHandler`, `CustomResource` `SeedAdminUser`
- CfnOutput 群

### ApiStack（`${env}-ApiStack`, ap-northeast-1） — `api-stack.ts` + `lambda-function.ts` + `bedrock-comprehend.ts` + `malware-scan.ts`
- `events.EventBus` `AppEventBus` = `TranscriptionReviewAppBus`
- `wafv2.CfnIPSet`（REGIONAL）`DynamicIpSet` = `TranscriptionReview-${env}-DynamicIPAllowlist`
- 多数の `NodejsFunction`（約 50 本。`transcription-review-*`）。各 Lambda は `LambdaFunction` 構築で **専用 IAM Role**（`<fn>-role`）と **明示 LogGroup `/aws/lambda/<fn>`（removalPolicy: DESTROY, 保持1か月）** を作成
- `MalwareScan`: `iam.Role` `ScanRole` + `NodejsFunction` `transcription-review-malware-scan`（**明示 LogGroup 無し**）
- Custom Resource 用インライン Lambda（**いずれも明示 LogGroup 無し**）: `CloudFrontKeyPairHandler` + `CloudFrontKeyPairRole` + `CustomResource CloudFrontKeyPair`、`S3NotificationHandler` + `S3NotificationRole` + `CustomResource S3MediaBucketNotification`
- `CloudFrontKeyPair` Custom Resource が作成する **CloudFront Public Key + Key Group**（CloudFormation 管理外）と **SSM SecureString** `/transcription-review/${env}/cloudfront-private-key`
- 自動生成時: `iam.Role` `TranscribeDataAccessRole`
- `sqs.Queue` `ProcessUploadDLQ` = `transcription-review-process-upload-dlq`（KMS 暗号化, 14日保持）
- `events.Rule` × 4（`TranscribeJobCompletedRule`[default bus], `CorrectionConfirmedRule`, `ConsensusResultConfirmedRule`, `S3ObjectCreatedMalwareScanRule`）
- `apigatewayv2.HttpApi` `TranscriptionReviewApi` + JWT Authorizer + 多数ルート
- `s3.CfnBucketPolicy` `MediaBucketScanPolicy`（Media バケットのポリシー。バケット削除で消える）
- **副作用（CloudFormation 管理外）**: `StartTranscription` Lambda が起動する Transcribe ジョブ、`CreateLanguageModel` Lambda が作る **Transcribe カスタム言語モデル**

### CdnStack（`${env}-CdnStack`, ap-northeast-1 + us-east-1 WAF 参照） — `cdn-stack.ts` + `waf-ip-allowlist.ts` + `waf-rate-limit.ts`
- `WafIpAllowlist`: `wafv2.CfnIPSet`（REGIONAL）+ `wafv2.CfnWebACL`（REGIONAL）
- `WafRateLimit`: ルール定義のみ（独立リソースは生成しない）
- 新規作成時: `cloudfront.Distribution` `StaticDistribution`、`S3OriginAccessControl` × 2（Static/Media OAC）、`ResponseHeadersPolicy`、`CachePolicy ApiCachePolicy`、`OriginRequestPolicy ApiOriginRequestPolicy`、`CfnBucketPolicy`（Static/Media）
- import + basePath 時: `cloudfront.Function SpaRewriteFunction`、OAC × 2、`UpdateDistributionHandler` Lambda + Role + Custom Resource
- `s3deploy.BucketDeployment DeployFrontend`（内部でアセット用 Lambda と、CDK アセットバケットへの一時アップロードを行う）
- `AwsCustomResource DescribeUserPoolDomain`（+ 専用 Lambda/ログ）
- `CallbackUrlHandler` Lambda + `CallbackUrlRole` + `CustomResource RegisterCallbackUrl`（**明示 LogGroup 無し**）

### MonitoringStack（`${env}-MonitoringStack`, ap-northeast-1） — `monitoring-stack.ts`
- `cloudwatch.Alarm` × 4（`LambdaErrorRateAlarm`, `DynamoDbThrottleAlarm`, `ApiGateway4xxAlarm`, `ApiGateway5xxAlarm`）

---

## 4. 突き合わせ表（リソース / destroy.sh カバー / RemovalPolicy / 残存時影響）

| リソース | destroy.sh でカバー | RemovalPolicy / 削除挙動 | 残存時のコスト影響 | コンプラ影響（データ残存） |
|----------|---------------------|--------------------------|--------------------|----------------------------|
| **CloudFrontWafStack（us-east-1）全体** | **✗ 未カバー**（`ALL_STACKS` に無し, REGION 固定） | CFn デフォルト（destroy で消えるが呼ばれない） | WebACL は時間課金あり → **継続課金** | WAF 設定・IPSet（許可IP）が残存 |
| └ WAF WebACL（CLOUDFRONT） | ✗ | - | WebACL 課金 | - |
| └ IPSet（CLOUDFRONT） | ✗ | - | 僅少 | 許可IP一覧が残存 |
| └ SSM `/transcription-review/<id>/web-acl-arn` | ✗ | - | ほぼ無料 | 低 |
| └ WAF CloudWatch メトリクス | ✗ | 自動失効 | 僅少 | 低 |
| FoundationStack（dev/staging） | ✓ `cdk destroy` | DESTROY | 削除される | 削除される |
| FoundationStack（**prod**） | △ スタック削除はするが… | **RETAIN**（KMS/DDB/S3/Cognito） | **継続課金** | **全データ残存** |
| S3 Media/Data/Static | ✓ empty + destroy | DESTROY(dev) / RETAIN(prod) | prod残存 | prod残存 |
| DynamoDB `TranscriptionReviewApp`（PITR 込み） | △ スタック削除依存 | DESTROY(dev)/RETAIN(prod) | prod残存（PITR 課金込み） | prod残存（全業務データ） |
| KMS CMK `AppKey` | △ スタック削除依存 | DESTROY(dev)/RETAIN(prod)、`pendingWindow 30日` | prod は保留期間後まで**月額$1/キー課金継続** | 鍵残存 |
| Cognito User Pool（新規作成時） | △ スタック削除依存 | DESTROY(dev)/RETAIN(prod)。**import 時は常に実体を削除しない** | MAU課金 | **ユーザー資格情報残存** |
| ApiStack スタックリソース | ✓ `cdk destroy` | デフォルト | 削除される | - |
| Lambda 専用ログ `/aws/lambda/transcription-review-*`（LambdaFunction 構築分） | ✓ 明示 LogGroup（DESTROY）でスタック削除時に消える | DESTROY | - | - |
| **Lambda ログ（malware-scan / Custom Resource Lambda / BucketDeployment / AwsCustomResource）** | **✗**（明示 LogGroup 無し→AWS 自動生成→CFn 管理外） | 残存 | 保存量課金（小） | ログにメタデータ残存 |
| **SSM SecureString `/transcription-review/<env>/cloudfront-private-key`** | **✗**（CR Delete 任せ、手動フォールバック無し） | CR Delete で消える想定 | ほぼ無料 | **署名秘密鍵が残存**（CR失敗時） |
| **CloudFront Public Key + Key Group**（CloudFrontKeyPair CR） | △ CR Delete 任せ | CR Delete で消える想定 | 無料 | 低（CR失敗時に残存） |
| SQS `ProcessUploadDLQ` | ✓ ApiStack 削除で消える | デフォルト | - | 滞留メッセージ残存はスタック削除で消える |
| EventBridge Bus/Rules | ✓ ApiStack 削除 | デフォルト | - | - |
| CloudFront Distribution（新規作成時） | ✓ CdnStack 削除（無効化に時間） | デフォルト | 残らない | - |
| REGIONAL WAF（CdnStack の WafIpAllowlist） | ✓ CdnStack 削除 | デフォルト | - | - |
| CloudWatch Alarms × 4 | ✓ MonitoringStack 削除 | デフォルト | - | - |
| **Transcribe カスタム言語モデル**（CreateLanguageModel 実行時） | **✗** どこからも削除されない | CFn 管理外 | 保管課金の可能性 | 学習成果物残存 |
| Transcribe ジョブ成果物（Data バケット内） | ✓ Data バケット空化で消える | - | - | - |
| CDK Bootstrap（CDKToolkit / cdk-assets バケット） | ✗（**対象外で正しい**: ソリューション固有でない共有基盤） | - | 僅少 | 低 |

---

## 5. 不足している削除処理（重大度順・根拠付き）

### [Critical] C1. CloudFrontWafStack（us-east-1）が削除されない
- 根拠: `bin/app.ts` に `new CloudFrontWafStack(app, \`${env}-CloudFrontWafStack\`, { env: { account, region: 'us-east-1' } ... })`。一方 `destroy.sh` の `ALL_STACKS=("MonitoringStack" "CdnStack" "ApiStack" "FoundationStack")`（37行目付近）に含まれず、`REGION="ap-northeast-1"` 固定で `cdk destroy` も ap-northeast-1 前提。
- 影響: WAF WebACL（CLOUDFRONT）が us-east-1 に残存し**時間課金が継続**。IPSet（許可IP = セキュリティ設定）と SSM パラメータも残存。
- 補足: `cdk destroy "${env}-CloudFrontWafStack"` は region 指定不要（スタックに env 埋め込み済み）だが、`ALL_STACKS` に追加が必須。

### [High] H1. prod 環境の RETAIN リソースを手動削除しない
- 根拠: `foundation-stack.ts` の `const isProd = envName === 'prod'; const dataRemovalPolicy = isProd ? RETAIN : DESTROY;` を KMS・DynamoDB・S3・Cognito 全てに適用。`autoDeleteObjects: !isProd`。
- 影響: prod で `cdk destroy` してもこれらは残り、**全業務データ・ユーザー資格情報が残存**し、DynamoDB/KMS/S3 の**課金が継続**。要件「費用ゼロ・データ完全削除」に反する。
- 補足: destroy.sh の prod ドライランは KMS を「30日スケジュール削除」と表示するが、実際にスケジュール削除する**コマンドは存在しない**（表示のみ）。

### [High] H2. CloudFront 署名用 SSM SecureString 秘密鍵の手動削除フォールバックが無い
- 根拠: `api-stack.ts` の自動生成経路で `ssmParamName = /transcription-review/${envName}/cloudfront-private-key` を `PutParameter`。削除は `CloudFrontKeyPairHandler` の `RequestType === 'Delete'` 内 `DeleteParameterCommand` 任せ（`catch (e) { console.log('SSM delete skip'...) }` で**失敗を握りつぶす**）。
- 影響: CR の Delete が失敗/スキップされると**署名用秘密鍵（機密）が SSM に残存**。destroy.sh は SSM に一切触れないため検知・後始末できない。

### [Medium] M1. 自動生成される Lambda CloudWatch Logs グループが残存
- 根拠: `lambda-function.ts` は各 Lambda に明示 LogGroup（`removalPolicy: DESTROY`）を作るが、`malware-scan.ts` の `ScanFunction`、`api-stack.ts` のインライン Custom Resource Lambda（`CloudFrontKeyPairHandler`, `S3NotificationHandler`）、`cdn-stack.ts` の `UpdateDistributionHandler` / `CallbackUrlHandler` / `BucketDeployment` 内部 Lambda / `AwsCustomResource` の Lambda は**明示 LogGroup を持たない**。これらは初回実行時に AWS が `/aws/lambda/<name>` を自動生成し、CloudFormation 管理外のため**スタック削除後も残存**。
- 影響: ログ保存量の小額課金とログデータ（メタデータ）残存。
- 補足: `malware-scan` は MonitoringStack の監視対象名にも含まれる（`bin/app.ts` の `lambdaFunctionNames`）。

### [Medium] M2. Transcribe カスタム言語モデルが削除されない
- 根拠: `api-stack.ts` の `CreateLanguageModel` Lambda が `transcribe:CreateLanguageModel` を実行。これは CloudFormation 管理外のアカウントリソース。destroy.sh に `transcribe` 関連処理なし。
- 影響: 使用実績があればモデルが残存（保管課金の可能性・成果物残存）。

### [Low] L1. ドライランと実削除の不整合
- 根拠: ドライランは Cognito/CloudFront の import 判定を行い「IMPORTED は RETAIN」等を表示するが、実削除ロジックにはそれらを個別保護/削除する処理が無く、`cdk destroy` に委ねている。表示と実挙動が一致しない箇所がある（例: KMS「30日スケジュール削除」表示に対し実コマンドなし）。

---

## 6. 過剰・誤りの指摘

- **P1（軽微・設計整合の問題）**: `empty_buckets()` はバケット名を `transcription-review-media/data/static-<account>` に**ハードコード**。これは `foundation-stack.ts` の命名（`transcription-review-media-${cdk.Aws.ACCOUNT_ID}` 等）と一致しており誤りではないが、`autoDeleteObjects: !isProd` が有効な dev/staging では S3 空化は冗長。prod では `autoDeleteObjects:false` かつバケットが `RETAIN` のため、空にしてもバケット自体は destroy で消えない（H1 と関連）。
- **P2**: `REGION="ap-northeast-1"` 固定だが、CloudFront 用 WAF は us-east-1。この固定値を前提にした `show_*` 系の AWS 問い合わせは us-east-1 リソースを取得できない（過剰ではないが片手落ち）。
- 「存在しないリソースを消そうとしている」タイプの明確な過剰削除は**検出されず**。問題は専ら不足側。
- **CDK Bootstrap（CDKToolkit スタック / `cdk-assets` バケット）を削除対象にしていない点は正しい**。これはソリューション固有ではなくアカウント共有の基盤であり、削除対象外とすべき（要件の趣旨に合致）。

---

## 7. 推奨する destroy.sh への追加・修正点

1. **CloudFrontWafStack を削除対象に追加（最優先）**
   - `ALL_STACKS` に `"CloudFrontWafStack"` を追加（削除順はリーフなので先頭/末尾いずれでも可だが、CdnStack が us-east-1 WAF を参照するため CdnStack 削除後に削除）。
   - `cdk destroy "${env}-CloudFrontWafStack"` はスタックに region 埋め込み済みのため追加の region 指定は不要。
2. **prod の RETAIN リソースを明示的に後始末（またはガード）**
   - prod では `cdk destroy` 後に、意図的削除として DynamoDB テーブル削除、S3 バケット空化+削除、`aws kms schedule-key-deletion`（表示だけでなく実コマンド）、Cognito User Pool 削除（import でない場合）を実行するフローを追加。少なくとも「残存する」ことを明示警告する。
3. **SSM パラメータの明示削除**
   - `/transcription-review/${ENV}/cloudfront-private-key` と `CloudFrontWafStack` 由来の `/transcription-review/<stackId>/web-acl-arn` を `aws ssm delete-parameter` でフォールバック削除。
4. **自動生成 Lambda ロググループの掃除**
   - `aws logs delete-log-group --log-group-name /aws/lambda/transcription-review-*` 相当（malware-scan 含む）と、Custom Resource/BucketDeployment 系の自動生成ロググループを列挙削除。恒久対策としては CDK 側で各インライン Lambda に明示 LogGroup（DESTROY）を付与する。
5. **Transcribe カスタム言語モデルの確認・削除**
   - `aws transcribe list-language-models` → `delete-language-model` を（存在すれば）実行する手順を追加。
6. **CloudFront Public Key / Key Group の残存確認**
   - CR Delete 失敗時に備え、`TranscriptionReview-${ENV}-KeyGroup` / `-SigningKey` の残存を確認・削除する手順を追加。
7. **検証フェーズを全リージョン対応に**
   - 削除後の検証を ap-northeast-1 と us-east-1 の両方で実施し、WAF/ロググループ/SSM の残存をチェックする。

---

### 付記（調査の限界）
本監査はコードとスクリプトの静的突き合わせのみ。実アカウント上の残存状況（import 設定の有無、CR Delete の実際の成否、言語モデルの作成実績）は未確認。実環境では `--dryrun` 実行と上記リソースの `list/describe` による実査が別途必要。
