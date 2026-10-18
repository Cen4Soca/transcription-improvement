---
inclusion: always
---

# Product Context

Transcription Review App — Amazon Transcribeが生成した文字起こし結果を人間の校閲者（Reviewer）が確認・修正するWebアプリケーション。

## Core Capabilities

- セグメント単位での文字起こしテキスト閲覧・インライン編集
- 音声・動画との同期再生による正確な校閲
- AI修正候補の自動提示（Bedrock Claude + Comprehend + 過去修正履歴ベース）
- 複数Reviewerによる多数決（Consensus）で信頼性の高い正答を確定
- チームベースのアクセス制御と監査ログ
- コントリビューターランキングによるモチベーション管理

## Domain Model

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| MediaFile | S3に保存された音声・動画ファイル | mediaId, s3Key, duration, format |
| Transcription | Amazon Transcribeの文字起こし結果（セグメント単位） | transcriptionId, mediaId, segments[] |
| Correction | Reviewerが行った修正 | correctionId, sessionId, original, corrected, segmentIndex |
| Consensus | 複数修正を集約して確定した正答 | consensusId, corrections[], confidenceScore |
| Session | Reviewerの校閲作業セッション（開始〜完了） | sessionId, userId, mediaId, status |
| Team | Reviewerをグループ化する組織単位 | teamId, name, members[] |
| AuditLog | 操作履歴の記録 | logId, userId, action, timestamp |

### Entity Relationships

```
MediaFile 1──N Transcription
MediaFile 1──N Session
Session   1──N Correction
Consensus N──N Correction
Team      1──N User
```

## User Roles & Permissions

ロール階層: ADMIN > TEAM_LEADER > REVIEWER（上位は下位の権限を包含）

| Role | Permissions | Access Scope |
|------|-------------|--------------|
| Reviewer | 文字起こし閲覧・修正、自分のセッション管理 | 自分のデータのみ |
| TeamLeader | Reviewer権限 + メンバー管理、レビュー割り当て | 自チーム内 |
| Admin | 全権限（ユーザー管理、Consensus設定、IP制御、監査ログ） | システム全体 |

### Authorization Rules

- 全APIエンドポイントでロールとスコープの両方を検証
- TeamLeaderは自チームのメンバーのみ管理可能（他チームは`forbiddenError`）
- Reviewerは自分のSession/Correctionのみ操作可能
- リソースが存在しないかアクセス不可の場合、404を返す（存在を隠蔽）
- Admin操作は全て監査ログに記録

## Business Rules

ビジネスルールはサービス層（`src/services/`）で実装すること。

| Rule | Detail |
|------|--------|
| Consensus閾値 | 最低3名のReviewerの修正が揃った時点で集約処理を実行 |
| 信頼度スコア | Reviewerランキングに基づく重み付き算出（Correction数 × 採用率） |
| メディアアクセス | CloudFront署名付きURL（有効期限付き） |
| IPアドレス制限 | WAF v2で実施、Admin画面から動的管理 |
| 監査ログ保持 | 全書き込み操作（POST/PUT/DELETE）を記録、90日間保持 |
| セッション排他 | 同一メディアに対し同一Reviewerのアクティブセッションは1つのみ |
| ランキング計算 | Correction数 × 採用率（Consensusに含まれた割合） |
| Consensus集約 | EventBridge経由で非同期実行 |

## Language Rules

| Context | Language |
|---------|----------|
| UI表示テキスト・ユーザー向けドキュメント | 日本語 |
| コード・コメント・変数名・コミットメッセージ | 英語 |
| APIエラーメッセージ | 英語（フロントエンドで日本語変換） |
| Spec・Steering・ドキュメント | 日本語 |

## Domain Terminology

新機能追加時にドメインエンティティへの影響を判断するためのコア用語集です。要件記述で使う正式名称の**完全な定義集**は `.kiro/specs/transcription-review-app/requirements.md` の Glossary を正とします（重複を避けるため、ここにはコア用語のみ記載）。

| Term | Meaning |
|------|---------|
| セグメント (Segment) | 文字起こし結果の最小単位。タイムスタンプで区切られた1発話区間 |
| 校閲 (Review) | Reviewerがセグメントの正確性を確認・修正する作業 |
| 採用率 (Adoption Rate) | Reviewerの修正がConsensusに含まれた割合 |
| 集約 (Aggregation) | 複数Reviewerの修正からConsensusを決定するプロセス |
| 署名付きURL (Signed URL) | 時限付きのCloudFrontメディアアクセスURL |
