# 設計: Bedrock を EU ジオ推論（Claude Sonnet 5.5）で呼び出せるようにする

## 背景・目的

本アプリの AI 修正候補／セッション名提案は Amazon Bedrock（Claude）を利用している。
現状は JP ジオのクロスリージョン推論プロファイル
（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`）を `ap-northeast-1` から呼び出している。

今回、**Claude Sonnet 5.5 を EU データレジデンシーで利用できる**ようにする。
Claude Sonnet 5.5 には JP ジオ推論プロファイルが存在せず、JP では満たせないため
（`list-inference-profiles` 実査で確認済み）、EU ジオ推論プロファイル
`eu.anthropic.claude-sonnet-5-5` を使う。

### データレジデンシー要件
- 要件レベル: **「EU で推論処理されればよい」**（リクエストの転送経路が日本発でも許容）。
- したがって Lambda 等のリソースは `ap-northeast-1` に置いたまま、
  **Bedrock クライアントのエンドポイントだけ EU（`eu-central-1`）に向ける**（方向1）。
- データが日本を一切経由してはならない、という厳格要件ではない。

## 決定事項（確定済み）

| 項目 | 決定 |
|---|---|
| データレジデンシー | JP または EU。今回は EU 推論処理で可（転送経路は日本発可） |
| 利用モデル | Claude Sonnet 5.5（EU ジオ: `eu.anthropic.claude-sonnet-5-5`） |
| EU ソースリージョン | `eu-central-1`（フランクフルト） |
| Comprehend | 変更しない。cdk.json の `region`（`ap-northeast-1`）のまま |
| 2 service の Bedrock リージョン | 共通ロジックで決定（共通化する） |
| Bedrock リージョンの決め方 | **A案: modelId のプレフィックスから自動判定** |
| サポートするジオ | **JP と EU のみ**（APAC は廃止） |
| `BEDROCK_MODEL_ID` 既定値 | 現状維持（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`） |

### A案（リージョン自動判定）の方針
Bedrock クライアントの region を、別の環境変数で持つのではなく
**modelId のプレフィックスから導出**する。

- `jp.` プレフィックス → Bedrock region = `ap-northeast-1`
- `eu.` プレフィックス → Bedrock region = `eu-central-1`
- それ以外（bare foundation-model ID など） → Lambda 実行リージョンにフォールバック

利点: 設定が `BEDROCK_MODEL_ID` 1 つで完結し、「JP の modelId なのに EU エンドポイントを叩く」
といった不整合が構造的に起きない。EU へ切り替える操作は modelId を
`eu.anthropic.claude-sonnet-5-5` にするだけで、クライアント region も IAM も揃う。

## 現状のコード構成（調査結果）

### backend（呼び出しは 2 service、同一パターン）
- `backend/src/services/suggestion-service.ts`（修正候補生成）
- `backend/src/services/session-name-suggestion-service.ts`（セッション名提案）

共通点:
- `modelId` は環境変数 `BEDROCK_MODEL_ID`、既定 `jp.anthropic.claude-haiku-4-5-20251001-v1:0`。
- クライアントは `new BedrockRuntimeClient({})`（region 未指定 → Lambda 実行リージョン
  `ap-northeast-1` を暗黙採用）。
- `InvokeModelCommand` + Anthropic Messages API 形式のボディ。
- Comprehend クライアントも同 service 内にあるが、本変更では触らない。

### infra
- `infra/lib/constructs/bedrock-comprehend.ts`
  - `bedrockModelId` を受け取り、推論プロファイル ID のときは
    「inference-profile ARN」+「配下 foundation-model ARN（全デスティネーション分）」を許可。
  - 現状、デスティネーションは `APAC_DESTINATION_REGIONS` にハードコード。
    inference-profile ARN のリージョンは `props.region`（= `ap-northeast-1`）固定。
  - プレフィックス判定 `INFERENCE_PROFILE_PREFIXES` には `eu.`/`jp.` も含まれるが、
    ARN 生成ロジックは APAC 前提。
  - Comprehend 権限は `aws:RequestedRegion` を `region` に固定。
- `infra/lib/stacks/api-stack.ts`
  - `bedrockModelId` を cdk.json context から取得（既定 `jp.anthropic.claude-haiku-4-5-...`）。
  - `BedrockComprehend` を `region: this.region`, `accountId: this.account` で生成。
  - 2 つの Lambda（GetSuggestions / GetSessionNameSuggestion）に
    `BEDROCK_MODEL_ID` を環境変数注入し、`grantInvoke` で権限付与。
- `infra/cdk.json`
  - `context.region = ap-northeast-1`
  - `context.bedrockModelId = jp.anthropic.claude-haiku-4-5-20251001-v1:0`

## 変更設計

### 1. backend 共通ヘルパー（新規）

ファイル: `backend/src/utils/bedrock-region.ts`（utils 層＝横断ヘルパーとして適切）

```typescript
/**
 * Resolve the AWS region whose Bedrock endpoint should be invoked for a given
 * model/inference-profile ID.
 *
 * Geographic cross-region inference requires the API call (source region) to
 * originate inside the profile's geography. This maps the inference-profile
 * prefix to its source region:
 *   - jp.  -> ap-northeast-1 (Tokyo)
 *   - eu.  -> eu-central-1  (Frankfurt)
 * Any other ID (e.g. a bare foundation-model ID) falls back to undefined,
 * letting the SDK use the Lambda execution region (ap-northeast-1).
 */
export function resolveBedrockRegion(modelId: string): string | undefined {
  if (modelId.startsWith('jp.')) return 'ap-northeast-1';
  if (modelId.startsWith('eu.')) return 'eu-central-1';
  return undefined;
}
```

- `undefined` を返した場合は `new BedrockRuntimeClient({})` 相当（実行リージョン採用）。
- JP/EU のみを対象とする（APAC は扱わない）。

### 2. 2 service のクライアント生成を共通ヘルパー経由にする

`suggestion-service.ts` / `session-name-suggestion-service.ts` の両方で:

```typescript
import { resolveBedrockRegion } from '../utils/bedrock-region.js';

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    const region = resolveBedrockRegion(BEDROCK_MODEL_ID);
    bedrockClient = new BedrockRuntimeClient(region ? { region } : {});
  }
  return bedrockClient;
}
```

- `BEDROCK_MODEL_ID` の既定値は現状維持（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`）。
- Comprehend クライアントは変更しない。
- import は ESM 規約どおり `.js` 拡張子付き。

### 3. infra IAM construct の一般化（`bedrock-comprehend.ts`）

プレフィックス → ジオを判定し、ジオごとに
「inference-profile ARN のリージョン」と「デスティネーションリージョン集合」を決める形へ。

- サポートジオ: **JP, EU のみ**（`apac.` 対応と `APAC_DESTINATION_REGIONS` は削除）。
- ジオ定義（例）:

```typescript
interface GeoProfile {
  /** inference-profile ARN が属するソースリージョン */
  sourceRegion: string;
  /** 配下 foundation-model ARN を許可すべきデスティネーションリージョン群 */
  destinationRegions: string[];
}

const GEO_BY_PREFIX: Record<string, GeoProfile> = {
  'jp.': {
    sourceRegion: 'ap-northeast-1',
    destinationRegions: ['ap-northeast-1', 'ap-northeast-3'],
  },
  'eu.': {
    sourceRegion: 'eu-central-1',
    destinationRegions: [
      'eu-central-1',
      'eu-west-1',
      'eu-west-3',
      'eu-north-1',
      'eu-south-1',
      'eu-south-2',
    ],
  },
};
```

- inference-profile ARN: `arn:aws:bedrock:<geo.sourceRegion>:<accountId>:inference-profile/<modelId>`
  - **ここが EU 対応の肝**。従来の `props.region`（ap-northeast-1 固定）ではなく
    ジオのソースリージョンを使う。EU の場合 `eu-central-1` スコープになる。
- foundation-model ARN: ジオの各デスティネーションリージョンについて
  `arn:aws:bedrock:<dest>::foundation-model/<foundationModelId>`
- bare foundation-model ID の経路（プレフィックスなし）は従来どおり
  `arn:aws:bedrock:<props.region>::foundation-model/<id>` を 1 つだけ許可。
- Comprehend 権限は変更なし（`aws:RequestedRegion` = `props.region`）。

> 注: サポート外プレフィックス（`us.` / `apac.` / `global.`）が渡された場合の扱いは
> 「JP/EU のみ」の方針に従い、想定外として扱う（bare 扱いにフォールバックせず、
> 実装時にガード。詳細は実装計画で確定）。

### 4. `api-stack.ts`

- 既存の流れ（cdk.json context の `bedrockModelId` を construct と Lambda env に渡す）は維持。
- A案により **Bedrock region は backend 側で modelId から導出**するため、
  Lambda への追加環境変数（`BEDROCK_REGION` 等）は不要。
- EU に切り替える運用は cdk.json の `bedrockModelId` を
  `eu.anthropic.claude-sonnet-5-5` に変更するだけ。

### 5. cdk.json

- 既定値は現状維持（JP）。EU 利用時のみ `bedrockModelId` を
  `eu.anthropic.claude-sonnet-5-5` に設定して deploy する運用。
- （任意）運用メモとして EU 切替手順をコメント化できるが、JSON のためコメント不可。
  README / steering 等で補足する選択肢あり（本設計では必須としない）。

## テスト設計

### backend（新規・既存）
- 新規: `backend/src/utils/bedrock-region.test.ts`（co-located）
  - `jp.` → `ap-northeast-1`
  - `eu.` → `eu-central-1`
  - bare ID → `undefined`
- 既存の suggestion 系モックテストは、region 指定が増えるだけでロジック不変のため
  原則そのまま通る想定。`@aws-sdk/client-bedrock-runtime` のモックに合わせて確認。

### infra（`infra/test/api-stack.test.ts` 調整）
- APAC を期待している既存ケースを **JP または EU** に置換（APAC 廃止に伴う）。
- 追加: EU プロファイル（`eu.anthropic.claude-sonnet-5-5`）指定時に
  - inference-profile ARN が `eu-central-1` スコープになる
  - foundation-model ARN が EU デスティネーション群で許可される
  を検証。
- 既定（JP）ケース: inference-profile ARN が `ap-northeast-1` スコープ、
  デスティネーションが `ap-northeast-1` / `ap-northeast-3` のみになることを検証。
- construct 単体テスト（`BedrockComprehend`）も JP/EU 前提に更新。

## コード外の前提作業（手動・CDK 管理外）
- EU のデスティネーションリージョン（少なくとも `eu-central-1`）で
  Claude Sonnet 5.5 の **モデルアクセスを有効化**しておく。
- EU 利用時、対象 Lambda ロールの IAM 権限が EU ARN を含むことを deploy 後に確認。

## 影響範囲・リスク

- アーキテクチャ不変（Handler → Service → Repository、DynamoDB、API GW、他 Lambda に波及なし）。
- マルチリージョン化しない（リソースは ap-northeast-1 のまま、Bedrock エンドポイントのみ EU）。
- 後方互換: 既定が JP のままなので、現行 JP 構成は無変更で動作。
- リスク低。注意点は IAM の EU デスティネーション網羅と EU モデルアクセス有効化。

## 変更対象ファイル一覧

| ファイル | 変更種別 |
|---|---|
| `backend/src/utils/bedrock-region.ts` | 新規 |
| `backend/src/utils/bedrock-region.test.ts` | 新規 |
| `backend/src/services/suggestion-service.ts` | 変更（クライアント生成） |
| `backend/src/services/session-name-suggestion-service.ts` | 変更（クライアント生成） |
| `infra/lib/constructs/bedrock-comprehend.ts` | リファクタ（JP/EU ジオ対応、APAC 廃止） |
| `infra/test/api-stack.test.ts` | テスト調整（APAC→JP/EU、EU ケース追加） |
| `infra/cdk.json` | 変更なし（EU 利用時に運用で bedrockModelId を切替） |

## 未確定事項（実装計画で詰める）
- サポート外プレフィックスが来たときの construct の挙動（エラーにするか）。
- EU 切替手順のドキュメント化を README/steering に残すかどうか。
