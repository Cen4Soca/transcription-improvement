# カスタム言語モデル チーム分離・管理機能 — 設計ドキュメント

## 背景・目的

カスタム言語モデルは Amazon Transcribe のアカウント単位グローバルリソースであり、
現状アプリ側に所有者・チーム情報が一切なく、以下の情報漏洩経路が存在する。

1. モデル名の列挙: 全ユーザーが全チームのモデル名を閲覧可能（`GET /language-models` にロール制限なし）
2. ドメイン語彙の伝播: 他チームのモデルをジョブで選択でき、学習語彙が自チームの出力に反映
3. トレーニングデータの取り込み: 作成時にセッション所有チェックがなく、他チームのセッションを学習データ化できる

本機能はチーム分離を導入し、これらの漏洩経路を封鎖する。あわせて、作成済みモデルの
削除・teamId 編集（再編成対応）・人間可読な表示名編集を追加する。

## 技術的制約

- Transcribe のモデルはイミュータブル: 作成後に `ModelName` も属性も変更不可。削除は `DeleteLanguageModel` のみ。
- グローバルリソース: `ListLanguageModels` はアカウント内の全モデルを返す。チーム概念は Transcribe 側に存在しない。
- モデル総数の上限: アカウント・リージョンあたり既定 10（引き上げ申請可）。同時学習中は既定 3。
  出典: Amazon Transcribe endpoints and quotas (https://docs.aws.amazon.com/general/latest/gr/transcribe.html)
- 帰結: teamId / displayName はアプリ側（DynamoDB）で別レコードとして管理する二層構造が必須。

## 決定事項（確定済み）

| 項目 | 決定 |
|---|---|
| モデル⇔チーム | 1モデル=1チーム（teamId 必須）。付け替えると元チームからは不可視になる制約を許容 |
| 二層構造 | Transcribe（実体・不変）+ DynamoDB メタデータ（teamId / displayName / 所有情報） |
| 一覧 | ADMIN=全件（GSI3）、TEAM_LEADER/REVIEWER=自チームのみ（GSI1）。表示は displayName |
| displayName 一意性 | チーム内一意（GSI2）。他チームの displayName は隠蔽 |
| 表示名編集 | ADMIN / 自チーム TEAM_LEADER。trim 後 1〜100 文字。セッション名編集を踏襲 |
| teamId 編集 | ADMIN のみ。実在チーム検証。存在しないチームへの付け替えは拒否。移動先で displayName 衝突時も拒否（改名を促す） |
| 削除権限 | ADMIN / 自チームのモデルを持つ TEAM_LEADER |
| 削除対象 | Transcribe DeleteLanguageModel + DynamoDB メタデータ + S3 学習データ |
| 削除順序 | ソフト削除(PENDING) → Transcribe → S3 → メタデータ物理削除。各ステップ冪等・失敗時リトライ・再実行で復旧 |
| 削除可否 | DescribeLanguageModel で学習中(IN_PROGRESS)を弾く + ListTranscriptionJobs(IN_PROGRESS) で使用中を弾く |
| 作成 | teamId 必須・displayName 必須・セッション所有チェック(checkSessionAccess)・displayName チーム内一意 |
| ジョブ利用 | 全ロール可。利用時に checkLanguageModelAccess でチーム検証（違反は 404）。ADMIN は任意チーム可、監査ログに model 情報 + crossTeamModelUsage フラグ |
| GSI | GSI1=チーム別一覧（相乗り）, GSI2=チーム内 displayName 一意（相乗り）, GSI3=全件一覧（新設）。相乗りは衝突時に専用へ切替 |
| クォータ超過 | 作成時にモデル総数上限に達している場合、専用 QUOTA_EXCEEDED エラー(HTTP 429)で明示。SDK 例外の事後捕捉を正、事前チェックは補助 |

### 複数チーム所属と共有

- Reviewer は複数チームに所属可能（`addTeamMember` は 1 ユーザー複数チームを許容）。
- 全ユーザーを共通チームに所属させ、そのチームにモデルを紐づければ全員で共有可能（意図された共有メカニズム）。
- ただし 1モデル=1チームのため、共通チームへ付け替えると元チームからは不可視になる。

## データモデル

`LanguageModelMetadata`（単一テーブル）

```
PK            = LANGUAGEMODEL#{modelName}
SK            = METADATA
GSI1PK        = TEAM#{teamId}
GSI1SK        = LANGUAGEMODEL#{modelName}
GSI2PK        = TEAM#{teamId}#DISPLAYNAME
GSI2SK        = {displayNameLower}
GSI3PK        = "LANGUAGEMODEL"          # 固定値（ADMIN 全件一覧用・新設）
GSI3SK        = {modelName}

attributes:
  modelName        : string   # Transcribe 識別子（不変）
  teamId           : string   # ADMIN が編集可
  displayName      : string   # ADMIN/TEAM_LEADER が編集可、チーム内一意
  displayNameLower : string
  baseModelName    : string
  createdBy        : string
  createdAt        : string
  sessionIds       : string[]
  s3Key            : string   # training-data/{modelName}/training.txt
  deletionStatus   : 'ACTIVE' | 'PENDING'   # PENDING は論理削除（一覧・利用から除外）
```

## API エンドポイント

| メソッド/パス | 用途 | 認可 |
|---|---|---|
| POST /language-models | 作成（teamId/displayName 必須・セッション所有チェック） | ADMIN / TEAM_LEADER |
| GET /language-models | 一覧（チームフィルタ・displayName 表示） | 全ロール（スコープはロール依存） |
| GET /language-models/{modelName} | ステータス取得 | ADMIN / TEAM_LEADER |
| PATCH /language-models/{modelName}/name | 表示名編集 | ADMIN / 自チーム TEAM_LEADER |
| PATCH /language-models/{modelName}/team | teamId 付け替え | ADMIN のみ |
| DELETE /language-models/{modelName} | 削除（ソフト→物理） | ADMIN / 自チーム TEAM_LEADER |

新規ハンドラ: patch-language-model-name.ts / patch-language-model-team.ts / delete-language-model.ts

## アクセス制御ヘルパー（access-control-service.ts に追加）

```
checkLanguageModelAccess(user, modelName): Promise<LanguageModelMetadata>
  - ADMIN                 → メタデータを返す（全チーム可）
  - TEAM_LEADER/REVIEWER  → getUserTeamIds に model.teamId が含まれれば返す
                          → 含まれなければ denyResourceAccess()（404 で存在隠蔽）
```

## 監査ログ拡張（AuditOperationType に追加）

- LANGUAGE_MODEL_DELETED
- LANGUAGE_MODEL_TEAM_CHANGED
- LANGUAGE_MODEL_NAME_CHANGED
- ジョブ開始ログ（既存）に languageModelName と crossTeamModelUsage を metadata 付与

## エラーハンドリング拡張（error-handler.ts）

- quotaExceededError(message, details?): HTTP 429 / code QUOTA_EXCEEDED を新設

## 実装ステップ

1. データモデル + メタデータ基盤（Repository/types/GSI）+ 作成改修（teamId/displayName 必須・セッション所有チェック・一意性・クォータ超過捕捉）
2. 一覧フィルタ + ジョブ利用時チーム検証（漏洩封鎖の中核）+ checkLanguageModelAccess
3. 表示名編集（セッション名編集踏襲）
4. teamId 編集（ADMIN・実在検証・衝突拒否）
5. 削除（ソフト→物理・冪等・学習中/使用中拒否・再実行復旧）
6. フロント（LanguageModelPage/TranscriptionJobForm/useLanguageModels/API）+ requirements.md 改訂 + 統合

各ステップで build + test（property テストは Language Model 必須対象）、フロントは vitest-axe。
CDK は diff 確認まで、deploy はユーザー判断。

## 要件ドキュメント改訂（Step 6）

- 要件18-4: 「COMPLETED すべて表示」→「所属チームの COMPLETED のみ（ADMIN は全件）」
- 要件18: ジョブ利用時チーム検証、ADMIN クロスチーム監査を追記
- 要件20: teamId/displayName 必須、セッション所有チェック、チーム内一意、クォータ超過エラーを追記
- 新規要件: 削除 / teamId 編集 / 表示名編集

## 実装中の補足方針

- A: GSI3 新設。GSI1/GSI2 は既存に相乗り（Step 1 冒頭でキースキーマ衝突を確認、衝突時は専用へ切替）
- B: quotaExceededError（HTTP 429・QUOTA_EXCEEDED）を新設
- C: 作成フォームの teamId 選択肢は TEAM_LEADER=自分の所属チームのみ、ADMIN=全チーム
