# Requirements Document

## Introduction

本機能「ソリューション・マニュアル」は、Transcription Review App のエンドユーザー向け操作マニュアルを、Playwright の E2E テスト実行を通じて半自動生成する仕組みである。既存の ManualRecorder がマニュアル用 spec の実行中に手順メタデータ（JSON）と画面スクリーンショット（PNG）を収集し、独立したビルドスクリプト（Manual Builder）がそれらを集約して単一の HTML ファイル（マニュアル）を生成する。

マニュアルは、全エンドユーザー向け主要操作を全ロール（REVIEWER / TEAM_LEADER / ADMIN）分カバーする完全版とする。1 つの HTML に全ロールの手順を含め、各手順にロールバッジを表示し、画面上部のロールフィルタで表示対象ロールを絞り込める単一ファイル構成とする。マニュアルの表示内容・説明文・UI はすべて日本語で記述する。

対象セクションは、ログイン / ホーム（校閲セッション一覧）/ 文字起こし校閲 / Consensus / アップロード / 言語モデル管理 / ランキング / 管理機能（ユーザー管理・IP制御・監査ログ）である。

## Glossary

- **Manual_Spec**: `e2e/manual/{NN}-{section}.spec.ts` に配置される Playwright テストファイル。1 ファイルが 1 セクションを担当し、実行中に ManualRecorder を使って手順メタデータとスクリーンショットを収集する。
- **Manual_Recorder**: 既存の `e2e/manual/manual-recorder.ts` で定義されるクラス。`capture()` で手順（section / order / title / description / roles / screenshot）を記録し、`flush()` で `output/steps/{slug}.json` に書き出す。
- **Manual_Builder**: マニュアル生成を担う独立したスクリプト（`build-manual.ts`）。npm script から実行され、`output/steps/*.json` と `output/screenshots/*.png` を集約して単一の `output/manual.html` を生成する。
- **Manual_HTML**: Manual_Builder が生成する単一の成果物ファイル `e2e/manual/output/manual.html`。全ロール・全セクションの手順を含む。
- **Manual_Step**: 1 手順分のメタデータ。section（機能セクション）、order（セクション内表示順）、title（見出し）、description（日本語説明）、roles（実行可能ロール配列）、screenshot（スクリーンショット相対パス）を持つ。
- **Role_Badge**: 各手順に表示される、その手順を実行できるロールを示す視覚的ラベル。REVIEWER / TEAM_LEADER / ADMIN のいずれか 1 つ以上を示す。
- **Role_Filter**: Manual_HTML 画面上部に配置されるロール絞り込みコントロール。選択肢は「すべて」「REVIEWER」「TEAM_LEADER」「ADMIN」。
- **Manual_Role**: マニュアルが対象とするロール。REVIEWER / TEAM_LEADER / ADMIN の 3 種。階層は ADMIN > TEAM_LEADER > REVIEWER。
- **Steps_JSON**: ManualRecorder が 1 セクションにつき 1 ファイル書き出す手順メタデータファイル（`output/steps/{slug}.json`）。section / slug / steps 配列を含む。
- **Manual_Section**: マニュアルの機能単位。ログイン、ホーム（校閲セッション一覧）、文字起こし校閲、Consensus、アップロード、言語モデル管理、ランキング、管理 - ユーザー管理、管理 - IP制御、管理 - 監査ログ。
- **Auth_Fixture**: 既存の `e2e/fixtures/auth.ts` が提供するログインフィクスチャ（loginAsReviewer / loginAsTeamLeader / loginAsAdmin）。
- **Transcription_Job**: アップロード画面の文字起こしジョブ作成フォームから開始する Amazon Transcribe 実行要求。メディアファイル、最大話者数、言語、カスタム言語モデル（任意）を指定して開始する。
- **Transcription_Download**: 校閲画面で修正後の Transcription を JSON 形式または SRT 形式で取得するダウンロード操作。

## Requirements

### Requirement 1: 手順メタデータとスクリーンショットの収集

**User Story:** As a マニュアル作成担当者, I want 各マニュアルセクションの spec が実行中に手順メタデータとスクリーンショットを収集する機能, so that 実際の画面に基づいたマニュアルを生成できる

#### Acceptance Criteria

1. WHEN Manual_Spec が capture を呼び出す, THE Manual_Recorder SHALL 当該手順の section、order、title、description、roles、screenshot を含む Manual_Step を記録する
2. WHEN Manual_Spec が capture を呼び出す, THE Manual_Recorder SHALL 現在の画面のスクリーンショットを `output/screenshots/` 配下に PNG 形式で保存する
3. WHEN Manual_Spec が flush を呼び出す, THE Manual_Recorder SHALL 収集した全 Manual_Step を `output/steps/{slug}.json` に Steps_JSON として書き出す
4. THE Manual_Recorder SHALL 各 Manual_Step の description を日本語で記録する
5. THE Manual_Recorder SHALL 各 Manual_Step の roles を REVIEWER、TEAM_LEADER、ADMIN のいずれか 1 つ以上から構成する

### Requirement 2: 全セクション網羅

**User Story:** As a マニュアル作成担当者, I want エンドユーザー向け全セクションを網羅した Manual_Spec 群, so that 完全版マニュアルを生成できる

#### Acceptance Criteria

1. THE ソリューション・マニュアル SHALL ログインセクションの手順を Manual_Spec として提供する
2. THE ソリューション・マニュアル SHALL ホーム（校閲セッション一覧）セクションの手順を Manual_Spec として提供する
3. THE ソリューション・マニュアル SHALL 文字起こし校閲セクションの手順を、セグメント編集、音声同期再生、AI修正候補の操作を含めて Manual_Spec として提供する
4. THE ソリューション・マニュアル SHALL 文字起こし校閲セクションの手順に、修正後 Transcription を JSON 形式および SRT 形式で取得する Transcription_Download の操作を含める
5. THE ソリューション・マニュアル SHALL Consensus（多数決）セクションの手順を Manual_Spec として提供する
6. THE ソリューション・マニュアル SHALL アップロードセクションの手順を Manual_Spec として提供する
7. THE ソリューション・マニュアル SHALL アップロードセクションの手順に、Transcription_Job を開始する文字起こしジョブ作成の操作を含める
8. THE ソリューション・マニュアル SHALL 言語モデル管理セクションの手順を Manual_Spec として提供する
9. THE ソリューション・マニュアル SHALL ランキングセクションの手順を Manual_Spec として提供する
10. THE ソリューション・マニュアル SHALL 管理機能セクションの手順を、ユーザー管理、IP制御、監査ログの操作を含めて Manual_Spec として提供する

### Requirement 3: ロール別認証と手順記録

**User Story:** As a マニュアル作成担当者, I want 各セクションが対象ロールに応じて認証して手順を記録する機能, so that ロールごとに閲覧可能な画面を正確にマニュアル化できる

#### Acceptance Criteria

1. WHEN ログインが必要なセクションの Manual_Spec が実行される, THE Manual_Spec SHALL Auth_Fixture を用いて対象ロールで認証する
2. WHERE セクションが TEAM_LEADER 固有機能（言語モデル管理）を含む, THE Manual_Spec SHALL loginAsTeamLeader または loginAsAdmin を用いて認証する
3. WHERE セクションが ADMIN 固有機能（管理 - ユーザー管理、管理 - IP制御、管理 - 監査ログ）を含む, THE Manual_Spec SHALL loginAsAdmin を用いて認証する
4. THE Manual_Spec SHALL 各手順の roles に、その画面を閲覧または操作できる Manual_Role を設定する

### Requirement 4: 単一 HTML 生成ビルドスクリプト

**User Story:** As a マニュアル作成担当者, I want 収集済みメタデータとスクリーンショットから単一の HTML を生成するビルドスクリプト, so that マニュアルを 1 ファイルとして配布できる

#### Acceptance Criteria

1. WHEN Manual_Builder が実行される, THE Manual_Builder SHALL `output/steps/` 配下の全 Steps_JSON を読み込む
2. WHEN Manual_Builder が実行される, THE Manual_Builder SHALL 読み込んだ全 Manual_Step を集約して単一の `output/manual.html` を生成する
3. THE Manual_Builder SHALL Manual_Step を section ごとにグループ化し、各 section 内で order の昇順に並べる
4. THE Manual_Builder SHALL Manual_Section を、ログイン、ホーム、文字起こし校閲、Consensus、アップロード、言語モデル管理、ランキング、管理の順に Manual_HTML へ配置する
5. THE Manual_Builder SHALL npm script から実行可能とする
6. IF `output/steps/` に Steps_JSON が 1 件も存在しない, THEN THE Manual_Builder SHALL エラーメッセージを出力して非ゼロの終了コードで終了する

### Requirement 5: ロールバッジとロールフィルタ

**User Story:** As a マニュアル閲覧者, I want 各手順にロールバッジが表示され、ロールで絞り込める単一 HTML, so that 自分のロールに関係する手順だけを確認できる

#### Acceptance Criteria

1. THE Manual_HTML SHALL 各手順に、当該手順の roles を示す Role_Badge を表示する
2. THE Manual_HTML SHALL 画面上部に、「すべて」「REVIEWER」「TEAM_LEADER」「ADMIN」の選択肢を持つ Role_Filter を表示する
3. WHEN 閲覧者が Role_Filter で特定の Manual_Role を選択する, THE Manual_HTML SHALL roles に当該ロールを含む手順のみを表示する
4. WHEN 閲覧者が Role_Filter で「すべて」を選択する, THE Manual_HTML SHALL 全手順を表示する
5. THE Manual_HTML SHALL 全ロール・全セクションの手順を単一のファイルに含める

### Requirement 6: 日本語出力

**User Story:** As a 日本語話者のマニュアル閲覧者, I want 日本語で記述されたマニュアル, so that 内容を正確に理解できる

#### Acceptance Criteria

1. THE Manual_HTML SHALL 手順の見出しおよび説明文を日本語で表示する
2. THE Manual_HTML SHALL ナビゲーション、Role_Filter、Role_Badge などの UI テキストを日本語で表示する
3. THE Manual_HTML SHALL ルート html 要素の lang 属性を `ja` に設定する

### Requirement 7: アクセシビリティ

**User Story:** As a 支援技術を利用するマニュアル閲覧者, I want アクセシブルな HTML 構造, so that スクリーンリーダーなどで内容を把握できる

#### Acceptance Criteria

1. THE Manual_HTML SHALL 文書タイトルを表す単一の最上位見出しと、各 Manual_Section を表す下位見出しを、階層が飛ばない見出し構造で提供する
2. THE Manual_HTML SHALL 各スクリーンショット画像に、当該手順の内容を説明する日本語の alt テキストを設定する
3. THE Manual_HTML SHALL Role_Filter の各コントロールに、支援技術から識別可能なラベルを設定する
