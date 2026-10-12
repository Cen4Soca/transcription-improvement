# 実装計画: Bedrock を EU ジオ推論（Claude Sonnet 5.5）で呼び出せるようにする

関連設計: `./design.md`

## 方針（A案）確定事項の再掲
- Bedrock クライアントの region は modelId プレフィックスから導出（`jp.`→`ap-northeast-1`、`eu.`→`eu-central-1`）。
- サポートジオは **JP / EU のみ**。APAC は廃止。
- `BEDROCK_MODEL_ID` 既定値は現状維持（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`）。
- Comprehend は不変。EU 利用は cdk.json の `bedrockModelId` 切替のみ。

## 設計未確定事項への判断（この計画で確定）
1. **サポート外プレフィックス（`us.` / `apac.` / `global.`）が渡された場合**
   - backend `resolveBedrockRegion`: `jp.`/`eu.` 以外は `undefined`（実行リージョンにフォールバック）を返す。
     bare foundation-model ID も同じく `undefined`。これは「呼び出し元リージョン決定」の責務に限定するため許容。
   - infra `BedrockComprehend`: 推論プロファイル形式（ドットを含みプレフィックスがある）だが
     `jp.`/`eu.` 以外の場合は **`Error` を throw**（synth 時に即失敗）。
     「JP/EU のみ」方針に反する設定を deploy 前に検知するため。bare FM ID は従来どおり許容。
2. **EU 切替手順のドキュメント化**: `.kiro/steering/tech.md` に短い運用メモを追記（任意実施、低リスク）。
   → 本計画では「実施する」。ただし steering 変更は最小限（数行）。

## 作業単位（順序付き）

### Step 1: backend 共通ヘルパー新規作成
- ファイル: `backend/src/utils/bedrock-region.ts`
- 内容: `resolveBedrockRegion(modelId: string): string | undefined`
  - `modelId.startsWith('jp.')` → `'ap-northeast-1'`
  - `modelId.startsWith('eu.')` → `'eu-central-1'`
  - それ以外 → `undefined`
- JSDoc でジオ CRIS のソースリージョン制約を明記。
- 完了条件: 型エラーなし。

### Step 2: backend 共通ヘルパーのユニットテスト新規作成
- ファイル: `backend/src/utils/bedrock-region.test.ts`（co-located）
- ケース:
  - `jp.anthropic.claude-haiku-4-5-20251001-v1:0` → `'ap-northeast-1'`
  - `eu.anthropic.claude-sonnet-5-5` → `'eu-central-1'`
  - `anthropic.claude-3-haiku-20240307-v1:0`（bare）→ `undefined`
  - `global.anthropic.claude-sonnet-5-5` → `undefined`
- 完了条件: `cd backend && npx vitest --run src/utils/bedrock-region.test.ts` 通過。

### Step 3: suggestion-service.ts のクライアント生成を共通化
- ファイル: `backend/src/services/suggestion-service.ts`
- 変更: `getBedrockClient()` 内で `resolveBedrockRegion(BEDROCK_MODEL_ID)` を使い、
  値があれば `new BedrockRuntimeClient({ region })`、なければ `new BedrockRuntimeClient({})`。
- import 追加: `import { resolveBedrockRegion } from '../utils/bedrock-region.js';`（ESM `.js`）。
- `BEDROCK_MODEL_ID` 既定値は変更しない。Comprehend クライアントは変更しない。
- 完了条件: 型エラーなし。

### Step 4: session-name-suggestion-service.ts のクライアント生成を共通化
- ファイル: `backend/src/services/session-name-suggestion-service.ts`
- 変更: Step 3 と同一パターン（共通ヘルパー利用）。
- 完了条件: 型エラーなし。

### Step 5: backend 全体テスト確認
- コマンド: `cd backend && npx vitest --run`
- 期待: 既存の suggestion / session-name-suggestion のモックテストが引き続き通過
  （クライアント生成に region 引数が増えるのみでロジック不変）。
- 失敗時: モックのアサーションが `BedrockRuntimeClient` の引数を厳密検証していないか確認し、
  必要なら最小限で調整。

### Step 6: infra construct リファクタ（JP/EU ジオ対応・APAC 廃止）
- ファイル: `infra/lib/constructs/bedrock-comprehend.ts`
- 変更内容:
  - `INFERENCE_PROFILE_PREFIXES` と `APAC_DESTINATION_REGIONS` を廃止。
  - ジオ定義マップを導入:
    ```
    GEO_BY_PREFIX = {
      'jp.': { sourceRegion: 'ap-northeast-1',
               destinationRegions: ['ap-northeast-1','ap-northeast-3'] },
      'eu.': { sourceRegion: 'eu-central-1',
               destinationRegions: ['eu-central-1','eu-west-1','eu-west-3',
                                     'eu-north-1','eu-south-1','eu-south-2'] },
    }
    ```
  - modelId 判定ロジック:
    - `jp.`/`eu.` で始まる → 対応ジオを使用:
      - inference-profile ARN: `arn:aws:bedrock:<geo.sourceRegion>:<accountId>:inference-profile/<modelId>`
      - foundation-model ARN: 各 `destinationRegions` について
        `arn:aws:bedrock:<dest>::foundation-model/<foundationModelId>`
      - `foundationModelId` = modelId からプレフィックスを除去。
    - `us.`/`apac.`/`global.` で始まる → **`throw new Error(...)`**（JP/EU 以外は非対応）。
    - プレフィックスなし（bare FM ID）→ 従来どおり
      `arn:aws:bedrock:<props.region>::foundation-model/<modelId>` 単一許可。
  - Comprehend 権限は現状維持。
  - JSDoc / コメントを JP/EU 前提に更新（APAC 記述を除去）。
- 完了条件: 型エラーなし。

### Step 7: infra テスト調整
- ファイル: `infra/test/api-stack.test.ts`
- 変更:
  - `BedrockComprehend construct` の APAC ケース（`apac.anthropic.claude-3-haiku-...`）を
    **JP ケースと EU ケースに置換/追加**:
    - JP: `jp.anthropic.claude-haiku-4-5-20251001-v1:0` →
      inference-profile ARN が `ap-northeast-1` スコープ、
      foundation-model ARN が `ap-northeast-1` / `ap-northeast-3`。
    - EU: `eu.anthropic.claude-sonnet-5-5` →
      inference-profile ARN が `eu-central-1` スコープ、
      foundation-model ARN が EU デスティネーション群（`eu-central-1`,`eu-west-1` 等）。
  - bare FM ID ケースは維持。
  - サポート外プレフィックス（例 `global.`/`apac.`）で `BedrockComprehend` 生成が
    throw することを検証するケースを追加。
  - `defaults to the APAC inference profile ...` テストは名称・コメントを
    「JP inference profile」に修正（既定が JP のため挙動は既に JP。APAC 表記を是正）。
    期待 ARN は現状の JP（`ap-northeast-1` / `ap-northeast-3`）で既に正しいか確認し、
    設計の JP デスティネーション（ap-northeast-1, ap-northeast-3）と一致させる。
- コマンド: `cd infra && npx vitest --run`（または既存のテストランナー。package.json で確認）。
- 完了条件: infra テスト全通過。

### Step 8: api-stack.ts コメントの是正（コード変更は最小）
- ファイル: `infra/lib/stacks/api-stack.ts`
- 変更: `bedrockModelId` 周辺コメントの「APAC」等、実態と異なる記述を JP/EU 前提に軽く是正。
  機能変更はなし（env 注入・construct 呼び出しは現状のまま）。
- 完了条件: 型エラーなし。

### Step 9: steering 運用メモ追記（任意・低リスク）
- ファイル: `.kiro/steering/tech.md`
- 内容: 「EU データレジデンシーで Claude Sonnet 5.5 を使う場合は cdk.json の
  `bedrockModelId` を `eu.anthropic.claude-sonnet-5-5` にする。Bedrock クライアント
  region は modelId から自動導出（jp→ap-northeast-1 / eu→eu-central-1）。
  EU デスティステーションでモデルアクセス有効化が前提」を数行で追記。

### Step 10: 全体ビルド・検証
- backend: `cd backend && npx vitest --run`
- infra: `cd infra && npx vitest --run` と `npx cdk synth`（JP 既定で synth 成功を確認）。
  - 可能なら `cdk synth -c bedrockModelId=eu.anthropic.claude-sonnet-5-5` でも synth 成功を確認
    （EU ARN が生成され、throw されないこと）。
- TypeScript ビルド（各パッケージの型チェック）。
- 完了条件: 全テスト通過・synth 成功。

## コード外の前提作業（デプロイ運用・CDK 管理外）
- EU デスティネーション（最低 `eu-central-1`）で Claude Sonnet 5.5 のモデルアクセス有効化。
- EU 利用時は cdk.json の `bedrockModelId` を切り替えて deploy。
- deploy 後、対象 Lambda ロールの IAM に EU ARN が含まれることを確認。

## 検証チェックリスト（受け入れ基準）
- [ ] `resolveBedrockRegion` が JP→ap-northeast-1 / EU→eu-central-1 / その他→undefined を返す。
- [ ] 2 service が共通ヘルパー経由でクライアント生成している。
- [ ] `BEDROCK_MODEL_ID` 既定値が JP のまま維持されている。
- [ ] Comprehend 関連コードが未変更。
- [ ] construct が JP/EU プロファイルで正しい ARN（ソースリージョンスコープ＋デスティネーション群）を生成。
- [ ] construct が us./apac./global. で throw する。
- [ ] bare FM ID の既存挙動が維持されている。
- [ ] infra テストが APAC 非依存に更新され全通過。
- [ ] backend テスト全通過。
- [ ] `cdk synth` が JP 既定で成功、EU 指定でも成功。

## 想定リスクと対応
- backend モックテストが `BedrockRuntimeClient` の引数を厳密検証している場合 → Step 5 で最小調整。
- EU デスティネーションリージョン集合の過不足 → EU ジオ CRIS の宛先と一致するよう設計の集合を採用。
  不足すると InvokeModel が AccessDenied になるため、設計記載の 6 リージョンを基準にする。
- サポート外 throw が既存の正常系に影響しないこと（既定 JP は throw されない）を Step 7/10 で担保。
