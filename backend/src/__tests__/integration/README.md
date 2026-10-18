# インテグレーションテスト

## 概要

このディレクトリには、AWS サービスとの統合を検証するインテグレーションテストが含まれています。
テストは LocalStack を使用してローカル環境で AWS サービスをエミュレートします。

## 前提条件

1. **LocalStack** がインストールされ、起動していること
   ```bash
   # LocalStack のインストール
   pip install localstack

   # LocalStack の起動
   localstack start
   ```

2. **AWS CLI** が LocalStack エンドポイントを使用するよう設定されていること
   ```bash
   export AWS_ENDPOINT_URL=http://localhost:4566
   export AWS_REGION=ap-northeast-1
   export AWS_ACCESS_KEY_ID=test
   export AWS_SECRET_ACCESS_KEY=test
   ```

3. 環境変数 `INTEGRATION_TEST=true` が設定されていること

## テスト実行方法

```bash
# LocalStack を起動した状態で実行
cd backend
INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts
```

## テストファイル一覧

| ファイル | テスト内容 | 検証要件 |
|---|---|---|
| `dynamodb-crud.integration.test.ts` | DynamoDB シングルテーブル CRUD 操作 | 9.1, 14.5 |
| `auth-flow.integration.test.ts` | Cognito 認証フロー（サインアップ・サインイン・トークン検証・MFA・セッションタイムアウト） | 9.1, 9.10, 9.11 |
| `signed-url.integration.test.ts` | CloudFront Signed URL 生成・検証・スキャン前アクセス制御 | 9.1, 14.5, 14.24 |
| `waf-ip-filter.integration.test.ts` | WAF IP フィルタリング（IPAllowlist）・レートリミット | 14.5, 14.17 |
| `malware-scan.integration.test.ts` | マルウェアスキャン Lambda トリガー・結果処理・隔離 | 16.10, 14.24 |
| `audit-operations.integration.test.ts` | AuditLog 削除自己記録・部分削除失敗記録・メタデータサニタイズ・オフラインキュー同期 | 11.8, 11.10, 14.12, 14.22 |

## テストカバレッジ

### DynamoDB CRUD (dynamodb-crud)
- ReviewSession の作成・取得・更新
- GSI1 を使用したチーム別セッションクエリ
- Correction のべき等書き込み
- Team・TeamAssignment の CRUD
- AuditLog の作成・クエリ・削除
- IPAllowlist の CRUD・最大件数制限

### 認証フロー (auth-flow)
- ユーザーサインアップ・確認
- サインイン・JWT トークン取得
- カスタム属性（custom:role）の検証
- ロール別ユーザー作成・更新
- ユーザー無効化・トークン拒否
- トークンリフレッシュ
- セッションタイムアウト設計検証（アイドル 30 分、絶対 8 時間）
- アイドルタイムアウト警告（残り 5 分）
- MFA 設定検証（Admin 必須、他オプション）

### Signed URL (signed-url)
- CloudFront Signed URL の生成・パラメータ検証
- 有効期限設定（300 秒）
- 署名改ざん検出
- セッション別スコープ
- スキャン前アクセス制御（PENDING/INFECTED 拒否、CLEAN 許可）

### WAF IP フィルタリング (waf-ip-filter)
- IP セットの作成・更新・削除
- IPv4/IPv6 CIDR サポート
- WebACL ルール適用
- CIDR バリデーション
- 最大 1000 エントリ制限
- レートリミット（認証 5/min/IP、一般 100/min/user）

### マルウェアスキャン (malware-scan)
- EICAR テストパターン検出
- クリーンファイル判定
- S3 キー解析（mediaFileId・filename 抽出）
- DynamoDB scanStatus 更新（CLEAN/INFECTED）
- 感染ファイルの quarantine プレフィックスへの隔離
- S3 イベントトリガー構造検証

### AuditLog 操作 (audit-operations)
- 部分削除失敗時の PARTIAL_DELETION_FAILURE 記録
- AuditLog 削除自己記録（AUDIT_LOG_DELETED）
- メタデータサニタイズ（許可キーのみ、最大 1000 文字）
- オフラインキュー同期（べき等書き込み・FIFO 順序）
- 指数バックオフリトライロジック
- キュー最大 200 件制限

## 注意事項

- テストはデフォルトで **スキップ** されます（`INTEGRATION_TEST=true` が未設定の場合）
- 通常の `npx vitest --run` ではインテグレーションテストは実行されません
- CI/CD パイプラインでは LocalStack コンテナを起動してから実行してください
- すべてのリソースは ap-northeast-1 リージョンで作成されます
