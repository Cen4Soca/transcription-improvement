# Implementation Plan: Transcription Review App

## Overview

Amazon Transcribeが生成した文字起こし結果を校閲・修正するWebアプリケーションの実装計画。React (TypeScript) + AWS サーバーレスアーキテクチャで構築し、CDKによるインフラ管理、DynamoDBシングルテーブル設計、Cognito認証（MFA対応・適応型認証）、多数決Consensus（部分集計対応）、コントリビューターランキング（表示範囲制御）、メディアアップロード・Transcriptionジョブ・カスタム言語モデル・ダウンロード・削除ワークフロー、セキュリティ強化（セッションタイムアウト・アイドル警告・レートリミット・TLS 1.2+・マルウェアスキャン・PresignedURL 300秒・トークンメモリ保持・XSS防止・custom:role不変性・S3 BlockPublicAccess・メタデータサニタイズ・スキャン前アクセス制御）、オフライン対応（IndexedDBキュー・Optimistic UI・自動同期）、自動保存・ドラフト復元、レスポンシブデザイン、ページネーション、CloudFront既存インポート・BasePath対応を段階的に実装する。

## Tasks

- [x] 1. プロジェクト基盤セットアップ
  - [x] 1.1 モノレポ構成とフロントエンド初期化
    - Vite + React + TypeScript プロジェクトを作成
    - TailwindCSS を設定
    - Vitest + React Testing Library + fast-check + vitest-axe をテストフレームワークとして設定
    - ディレクトリ構成: `frontend/src/{components,pages,hooks,utils,types,services,test-utils}`
    - _Requirements: 11.3, 11.5_

  - [x] 1.2 共通型定義とインターフェース作成
    - `frontend/src/types/` と `backend/src/types/` に ReviewSession, Segment, Correction, User, Team, AuditLog, ContributorScore, MediaFile, TranscriptionJob, RankingSettings 等の TypeScript インターフェースを定義
    - PaginatedResponse<T> インターフェースを定義（currentPage, pageSize, totalItems, totalPages, hasNextPage, hasPreviousPage）
    - AuthProvider インターフェースを定義（Cognito → IAM Identity Center 移行対応）
    - API レスポンス型・エラー型を定義
    - _Requirements: 9.1, 14.1, 16.2, 17.7, 11.7_


  - [x] 1.3 CDK インフラプロジェクト初期化
    - `infra/` ディレクトリに CDK TypeScript プロジェクトを作成
    - `bin/app.ts` エントリポイント、`lib/stacks/` と `lib/constructs/` ディレクトリを作成
    - cdk.json に context パラメータ（env, account, region, cognitoUserPoolId, cognitoUserPoolClientId, cloudFrontDistributionId, basePath, bedrockModelId, allowedIpCidrs, kmsKeyAdminArns）を定義
    - _Requirements: 14.1, 15.1, 22.1_

  - [x] 1.4 バックエンド Lambda プロジェクト初期化
    - `backend/` ディレクトリに TypeScript プロジェクトを作成（ESM, .js 拡張子インポート）
    - 共通ユーティリティ（DynamoDB クライアント、エラーハンドラ、レスポンスビルダー、auth-middleware）を作成
    - Lambda ハンドラのディレクトリ構成: `backend/src/{handlers,services,repositories,utils,types}`
    - _Requirements: 14.1_

- [x] 2. インフラストラクチャ（CDK）実装
  - [x] 2.1 FoundationStack 実装
    - KMS カスタマーマネージドキー（CMK）を作成
    - DynamoDB シングルテーブル（TranscriptionReviewApp）をオンデマンドキャパシティで作成（GSI1, GSI2 含む）
    - S3 バケット（メディア用・データ用・静的ファイル用）を KMS 暗号化で作成
    - すべての S3 バケットに BlockPublicAccess を全項目有効化（BlockPublicAcls・IgnorePublicAcls・BlockPublicPolicy・RestrictPublicBuckets）
    - Cognito User Pool を条件分岐で作成（cognitoUserPoolId 指定時はインポート、未指定時は新規作成）
    - Cognito MFA 設定（Admin: 必須、Reviewer/TeamLeader: オプション、TOTP 推奨）
    - Cognito Advanced Security Features を有効化（適応型認証 ENFORCED モード）
    - `custom:role` カスタム属性を Mutable: false で設定
    - User Pool Client の WriteAttributes から `custom:role` を除外
    - cognitoUserPoolClientId の条件分岐（指定時はインポート、未指定時は新規作成）
    - CloudFormation Output に UserPoolId と UserPoolClientId を出力
    - すべてのリソースを ap-northeast-1 に限定
    - _Requirements: 14.1, 14.2, 14.18, 14.19, 14.21, 14.23, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 9.12_


  - [x] 2.2 ApiStack 実装
    - API Gateway HTTP API を JWT Authorizer 付きで作成（JWT 有効期限 15 分）
    - Lambda 関数群を最小権限 IAM ロール付きで作成（関数ごとに個別ロール、共通 Lambda Construct 使用）
    - EventBridge ルール（CorrectionConfirmed, ConsensusResultConfirmed, S3 ObjectCreated）を作成
    - Consensus 集計 Lambda・スコア更新 Lambda・マルウェアスキャン Lambda を作成
    - メディアバケットのバケットポリシーで scanStatus: PENDING のオブジェクトに対する GetObject を Lambda マルウェアスキャン関数以外から拒否
    - Bedrock + Comprehend アクセス権限 Construct を作成
    - _Requirements: 14.1, 14.2, 14.24, 9.6, 16.10_

  - [x] 2.3 CdnStack 実装（CloudFront 既存インポート・BasePath 対応）
    - CloudFront ディストリビューション条件分岐（cloudFrontDistributionId 指定時はインポート、未指定時は新規作成）
    - BasePath 対応（S3 オリジンパス設定、SPA フォールバック設定）
    - CloudFront TLS 1.2+ 強制（SecurityPolicyProtocol.TLS_V1_2_2021）
    - AWS WAF v2 WebACL を作成（IP セット + レートリミットルール: 認証 5/min/IP、一般 100/min/ユーザー）
    - WAF を API Gateway と CloudFront に関連付け
    - CloudFormation Output に Distribution ドメイン名と BasePath を出力
    - 既存ディストリビューションの他のオリジン・ビヘイビア設定は変更しない
    - _Requirements: 14.1, 14.3, 14.5, 14.16, 14.17, 22.1, 22.2, 22.3, 22.4, 22.5, 22.7, 22.8, 22.9, 22.10_

  - [x] 2.4 MonitoringStack 実装
    - CloudWatch アラーム設定
    - Lambda エラー率・DynamoDB スロットリング・API Gateway 4xx/5xx のアラーム
    - _Requirements: 14.1_

  - [x] 2.5 CDK スタックのユニットテスト
    - 各スタックのリソース作成を検証するスナップショットテスト
    - KMS・DynamoDB・S3 の暗号化設定テスト
    - S3 BlockPublicAccess 全項目有効化テスト
    - WAF ルール設定テスト（レートリミット含む）
    - Cognito 条件分岐テスト（新規作成 / インポート）
    - Cognito Advanced Security Features 有効化テスト
    - custom:role Mutable: false 設定テスト
    - CloudFront 条件分岐テスト（新規作成 / インポート / BasePath）
    - _Requirements: 14.1, 14.18, 14.21, 14.23, 15.1, 15.2, 22.2, 22.3_


- [x] 3. 認証・認可・セッション管理基盤実装
  - [x] 3.1 Cognito 認証プロバイダー実装（フロントエンド）
    - `CognitoAuthProvider` を AuthProvider インターフェースに準拠して実装
    - ログイン・ログアウト・トークン取得・ユーザー情報取得を実装
    - AuthGuard コンポーネントを作成（未認証時はログイン画面にリダイレクト）
    - MFA 対応（Admin: 必須、Reviewer/TeamLeader: オプション、TOTP）
    - JWT トークンをメモリ（JavaScript 変数）に保持し、localStorage・sessionStorage・Cookie には保存しない
    - RefreshToken は Cognito SDK セキュアストレージに保持
    - _Requirements: 9.1, 9.9, 9.12, 14.19_

  - [x] 3.2 セッション管理実装（フロントエンド）
    - アイドルタイムアウト 30 分（フロントエンドで検知・実施）
    - アイドルタイムアウト残り 5 分前に警告通知表示（SessionTimeoutWarning コンポーネント）
    - 「続行」ボタン選択時にアイドルタイマーリセット
    - 絶対セッション期限 8 時間（ログインからの経過時間で再認証要求）
    - JWT（AccessToken）有効期限 15 分、RefreshToken 有効期限 8 時間
    - タイムアウト時のログイン画面リダイレクト
    - _Requirements: 9.10, 9.11, 11.8_

  - [x] 3.3 Property テスト: アイドルタイムアウト警告の表示タイミング
    - **Property 41: アイドルタイムアウト警告の表示タイミング**
    - **Validates: Requirements 11.8**

  - [x] 3.4 権限チェックミドルウェア実装（バックエンド）
    - JWT からユーザー情報・ロールを抽出するミドルウェア（`extractUser(event)`）を作成
    - ロールベースアクセス制御（REVIEWER, TEAM_LEADER, ADMIN）を実装
    - チームベースリソースアクセス制御を実装（TeamAssignment・ReviewAssignment 確認）
    - 権限エラー時は 403、他チームリソースアクセス時は 404（存在を隠す）を返す
    - ユーザー無効化時の RefreshToken 即時無効化対応（15 分以内にアクセス遮断）
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 13.6, 13.7_

  - [x] 3.5 Property テスト: custom:role 属性の不変性
    - **Property 44: custom:role 属性の不変性**
    - **Validates: Requirements 14.18**

  - [x] 3.6 認証・認可・セッション管理のユニットテスト
    - JWT 検証・ロール抽出のテスト
    - 各ロールの権限チェックテスト
    - チームベースアクセス制御テスト（404 レスポンス含む）
    - セッションタイムアウトテスト（アイドル 30 分、絶対 8 時間）
    - アイドルタイムアウト警告テスト（残り 5 分で通知表示）
    - MFA 認証フローテスト
    - トークンメモリ保持テスト（localStorage 不使用確認）
    - _Requirements: 9.5, 9.7, 9.8, 9.10, 9.11, 9.12, 11.8, 14.19_


- [x] 4. チェックポイント - 基盤確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。

- [x] 5. 文字起こし結果の表示機能実装
  - [x] 5.1 Segment ソート・フォーマットユーティリティ実装
    - `sortSegmentsByTimestamp()` 関数を実装（startTime 昇順ソート）
    - `formatTimestamp()` 関数を実装（秒数 → HH:MM:SS 形式変換）
    - `parseTimestamp()` 関数を実装（HH:MM:SS → 秒数逆変換）
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Property テスト: Segment タイムスタンプ順表示
    - **Property 1: Segmentのタイムスタンプ順表示**
    - **Validates: Requirements 1.1**

  - [x] 5.3 Property テスト: 開始時刻の HH:MM:SS 形式フォーマット
    - **Property 2: 開始時刻のHH:MM:SS形式フォーマット**
    - **Validates: Requirements 1.2**

  - [x] 5.4 SegmentRow コンポーネント実装
    - Segment のテキスト・開始時刻・話者ラベルを表示するコンポーネントを作成
    - 話者ラベルは speakerLabel が存在する場合のみ表示
    - クリックで編集モードに遷移する機能を実装
    - 検索ハイライトは DOM テキストノード分割 + `<mark>` 要素で実装（innerHTML 不使用）
    - _Requirements: 1.2, 1.3, 2.1, 14.20_

  - [x] 5.5 Property テスト: 話者ラベルの条件付き表示
    - **Property 3: 話者ラベルの条件付き表示**
    - **Validates: Requirements 1.3**

  - [x] 5.6 TranscriptionEditor コンポーネント実装
    - Segment 一覧をスクロール可能な形式で表示
    - Segment 0 件時に「文字起こし結果がありません」メッセージを表示
    - データ取得失敗時にエラーメッセージ（理由含む）を表示
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 5.7 Property テスト: エラーメッセージへの理由の包含
    - **Property 4: エラーメッセージへの理由の包含**
    - **Validates: Requirements 1.5**


- [x] 6. テキスト・話者情報の編集機能実装
  - [x] 6.1 インライン編集機能実装
    - Segment テキストのインライン編集 UI を実装（クリックで編集モード）
    - 編集前テキストと編集中テキストの同時表示
    - 編集確定・キャンセル操作を実装
    - 複数 Segment の同時編集をサポート
    - 空文字列確定時の確認ダイアログを実装
    - `dangerouslySetInnerHTML` を使用せず、React デフォルトエスケープで全テキスト表示
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 14.20_

  - [x] 6.2 Correction 記録ロジック実装
    - `createCorrection()` 関数を実装（テキスト変更・話者変更・話者ラベル一括変更）
    - 変更なし確定時は Correction を記録しないロジックを実装
    - Correction に beforeText/afterText を必ず含める
    - _Requirements: 2.3, 2.6, 2.10, 2.12_

  - [x] 6.3 Property テスト: Correction の完全性
    - **Property 5: Correctionの完全性（テキスト・話者）**
    - **Validates: Requirements 2.3, 2.10, 2.15**

  - [x] 6.4 Property テスト: 変更なし確定では Correction を記録しない
    - **Property 6: 変更なし確定ではCorrectionを記録しない**
    - **Validates: Requirements 2.6, 2.12**

  - [x] 6.5 話者ラベル編集機能実装
    - 話者ラベルクリックでドロップダウン表示（既存ラベル一覧）
    - 話者識別情報がない場合は編集 UI を非表示
    - 話者ラベル管理画面（ラベル名変更・一括置換）を実装
    - ラベル名重複時の確認ダイアログ（統合確認）を実装
    - _Requirements: 2.8, 2.9, 2.10, 2.11, 2.13, 2.14, 2.15, 2.16, 2.17_

  - [x] 6.6 Property テスト: 話者ラベル一括置換の完全性
    - **Property 7: 話者ラベル一括置換の完全性**
    - **Validates: Requirements 2.14**


- [x] 7. 修正内容の保存・管理機能実装
  - [x] 7.1 Correction 永続化 API 実装（バックエンド）
    - POST `/sessions/{sessionId}/corrections` ハンドラを実装
    - ISO 8601 UTC タイムスタンプ付きで DynamoDB に保存
    - correctionId をべき等キーとして重複保存を防止
    - ReviewSession 状態を「未着手」→「進行中」に自動更新
    - 保存失敗時のエラーレスポンスを実装
    - DynamoDB アクセスパターンレイヤー分離（PK に USER#{userId} を含め他 Reviewer の Correction を隠蔽）
    - _Requirements: 3.1, 3.2, 3.5, 3.7, 10.10_

  - [x] 7.2 Property テスト: Correction の ISO 8601 UTC タイムスタンプ
    - **Property 8: CorrectionのISO 8601 UTCタイムスタンプ**
    - **Validates: Requirements 3.1**

  - [x] 7.3 Correction 復元・一覧取得 API 実装（バックエンド）
    - GET `/sessions/{sessionId}/corrections` ハンドラを実装
    - ReviewSession 再オープン時に保存済み Correction を復元
    - 復元失敗時のエラーハンドリング（未修正状態で開く）
    - _Requirements: 3.3, 3.4_

  - [x] 7.4 Property テスト: Correction の保存・復元ラウンドトリップ
    - **Property 9: Correctionの保存・復元ラウンドトリップ**
    - **Validates: Requirements 3.3**

  - [x] 7.5 アンドゥ機能実装（フロントエンド）
    - `UndoManager` クラスを実装（最大 50 件のアンドゥスタック）
    - アンドゥ操作で直前の Correction 適用前の状態に復元
    - 50 件を超えた古い Correction はアンドゥ不可
    - ReviewSession 完了マーク機能を実装
    - _Requirements: 3.6, 3.8_

  - [x] 7.6 Property テスト: アンドゥ操作の正確性
    - **Property 10: アンドゥ操作の正確性**
    - **Validates: Requirements 3.8**

- [x] 8. チェックポイント - コア編集機能確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 9. 音声・動画同期再生機能実装
  - [x] 9.1 MediaPlayer コンポーネント実装
    - 音声・動画の再生・一時停止・シーク・速度変更（0.5x, 1.0x, 1.25x, 1.5x, 2.0x）を実装
    - CloudFront Signed URL 経由でメディアストリーミング
    - MediaFile アクセス失敗時のエラーハンドリング（MediaPlayer 非表示 + テキスト編集のみ）
    - _Requirements: 4.4, 4.7, 4.8_

  - [x] 9.2 メディア・テキスト同期機能実装
    - 左右分割レイアウト（デフォルト）と上下分割レイアウトの切り替え
    - 再生位置に対応する Segment のハイライト更新（100ms 以内）
    - Segment クリックで MediaPlayer シーク（再生状態維持）
    - ハイライト Segment が画面外に出た場合の自動スクロール
    - テキスト編集中は自動スクロールを一時停止
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.9, 4.10_

  - [x] 9.3 Signed URL 取得 API 実装（バックエンド）
    - GET `/sessions/{sessionId}/media-url` ハンドラを実装
    - CloudFront Signed URL を生成して返却（PresignedURL 有効期限 300 秒）
    - scanStatus が PENDING のファイルに対する Signed URL 生成を拒否
    - scanStatus が CLEAN の場合のみ URL 生成を許可
    - _Requirements: 4.4, 14.24, 16.7, 16.10_

  - [x] 9.4 Property テスト: スキャン前ファイルアクセスの拒否
    - **Property 47: スキャン前ファイルアクセスの拒否**
    - **Validates: Requirements 14.24**

  - [x] 9.5 MediaPlayer のユニットテスト
    - 再生速度変更テスト
    - シーク操作テスト
    - エラー時の MediaPlayer 非表示テスト
    - 自動スクロール一時停止テスト
    - _Requirements: 4.7, 4.8, 4.10_


- [x] 10. ReviewSession 一覧・管理機能実装
  - [x] 10.1 ReviewSession 一覧 API 実装（バックエンド）
    - GET `/sessions` ハンドラを実装（チームベースフィルタリング付き）
    - 作成日時降順ソート
    - 進捗状態フィルタリング（PENDING, IN_PROGRESS, COMPLETED）
    - ページネーション対応（1ページ50件、DynamoDB Limit + ExclusiveStartKey）
    - 0 件時の空レスポンス
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.7, 11.7_

  - [x] 10.2 SessionListPage コンポーネント実装
    - ReviewSession 一覧表示（名前・進捗状態・作成日時 YYYY-MM-DD HH:MM）
    - フィルタリング UI（未着手・進行中・完了）
    - ページネーション UI（ページ番号ナビゲーション or 次へ/前へボタン、50件/ページ）
    - 一覧から選択して校閲画面に遷移
    - 0 件時の「校閲セッションがありません」メッセージ
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 11.7_

  - [x] 10.3 ReviewSession 状態更新 API 実装（バックエンド）
    - PATCH `/sessions/{sessionId}/status` ハンドラを実装
    - 新規 TranscriptionJob 登録時の ReviewSession 自動作成
    - _Requirements: 5.6_

  - [x] 10.4 SessionListPage のユニットテスト
    - フィルタリング動作テスト
    - ページネーション動作テスト
    - 0 件表示テスト
    - 日時フォーマットテスト
    - _Requirements: 5.5, 5.7, 11.7_

- [x] 11. 検索・ナビゲーション機能実装
  - [x] 11.1 検索ロジック実装
    - `searchSegments()` 関数を実装（大文字・小文字を区別しない部分一致）
    - キーストロークごとの検索（デバウンス 300ms）
    - 一致件数表示（0 件時は「0件一致」）
    - 未修正フィルタ（Correction 未記録 Segment のみ表示）
    - 検索ハイライトは DOM テキストノード分割 + `<mark>` 要素で実装（innerHTML 不使用）
    - 検索ハイライトと修正候補ポップアップの z-index 制御（ポップアップが前面）
    - _Requirements: 6.1, 6.2, 6.4, 6.6, 14.20_

  - [x] 11.2 Property テスト: 検索の大文字・小文字を区別しない部分一致
    - **Property 11: 検索の大文字・小文字を区別しない部分一致**
    - **Validates: Requirements 6.2**

  - [x] 11.3 検索ナビゲーション実装
    - `SearchNavigator` クラスを実装（次へ・前へ操作）
    - 循環ナビゲーション（最後→最初、最初→最後）
    - 検索クリア時のハイライト解除
    - SearchBar コンポーネントを実装
    - _Requirements: 6.3, 6.5_

  - [x] 11.4 Property テスト: 検索ナビゲーションの循環性
    - **Property 12: 検索ナビゲーションの循環性**
    - **Validates: Requirements 6.3**


- [x] 12. 修正候補機能実装
  - [x] 12.1 修正候補取得 API 実装（バックエンド）
    - GET `/sessions/{sessionId}/suggestions` ハンドラを実装
    - CorrectionHistory から過去 Correction を検索
    - Bedrock (Claude) と Comprehend を並列呼び出し
    - CorrectionHistory 優先 → Bedrock 候補 → Comprehend 候補の順でマージ・重複除去（最大 5 件）
    - Bedrock/Comprehend 失敗時のフォールバック処理（成功した側 + CorrectionHistory のみ返す）
    - _Requirements: 8.1, 8.2, 8.3, 8.7_

  - [x] 12.2 Property テスト: 修正候補の最大件数制限
    - **Property 13: 修正候補の最大件数制限**
    - **Validates: Requirements 8.1, 8.2**

  - [x] 12.3 Property テスト: 修正候補のマージ・優先順位・重複除去
    - **Property 14: 修正候補のマージ・優先順位・重複除去**
    - **Validates: Requirements 8.3**

  - [x] 12.4 SuggestionPopup コンポーネント実装
    - 500ms ホバーまたはボタンクリックでポップアップ表示
    - ホバー自動表示無効化オプション対応（専用ボタンのみモード）
    - ローディングインジケータ表示
    - 候補クリックでテキスト置換 + Correction 記録
    - 0 件時の「候補がありません」メッセージ + 編集モード移行
    - 外部 API エラー時のインラインメッセージ
    - ポップアップ外クリックで閉じる
    - 別 Segment ホバー時に既存ポップアップを閉じて新規表示
    - z-index は検索ハイライトより上位
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 6.6_

  - [x] 12.5 SuggestionPopup のユニットテスト
    - ホバー 500ms トリガーテスト
    - ホバー自動表示無効化テスト
    - 0 件表示テスト
    - エラー時フォールバックテスト
    - _Requirements: 8.5, 8.6, 8.7, 8.10_

- [x] 13. チェックポイント - フロントエンド主要機能確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 14. ユーザー管理・チーム管理機能実装
  - [x] 14.1 ユーザー管理 API 実装（バックエンド）
    - GET/POST/PATCH `/admin/users` ハンドラを実装
    - ユーザー登録（ロール付与: REVIEWER, TEAM_LEADER, ADMIN）
    - ユーザー無効化（RefreshToken 即時無効化 + 15 分以内にアクセス遮断）
    - Admin 権限チェック
    - ロール変更は AdminUpdateUserAttributes API 経由でのみ実行
    - _Requirements: 9.2, 9.6, 9.7, 14.18_

  - [x] 14.2 チーム管理 API 実装（バックエンド）
    - GET/POST/PATCH/DELETE `/admin/teams` ハンドラを実装
    - TeamAssignment 作成・削除 API を実装
    - ReviewAssignment 作成 API を実装
    - TeamLeader の自チーム外操作拒否
    - チーム削除時の TeamAssignment 一括削除
    - メンバーシップ喪失時の ReviewAssignment アクセス取り消し
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8, 13.9, 13.10_

  - [x] 14.3 管理画面 UI 実装（フロントエンド）
    - UserManagement コンポーネント（ユーザー一覧・登録・無効化）
    - TeamManagement コンポーネント（チーム作成・編集・削除・メンバー管理）
    - TeamAssignment UI（ReviewSession をチームに割り当て）
    - AdminPage にルーティング統合
    - _Requirements: 9.2, 13.1, 13.4_

  - [x] 14.4 チーム管理のユニットテスト
    - TeamAssignment 作成・削除のアクセス制御テスト
    - TeamLeader 権限境界テスト
    - チーム削除時のカスケード処理テスト
    - メンバーシップ喪失時のアクセス取り消しテスト
    - _Requirements: 13.5, 13.8, 13.9, 13.10_


- [x] 15. 多数決 Consensus 機能実装（部分集計対応）
  - [x] 15.1 Consensus 集計ロジック実装（バックエンド）
    - `computeConsensus()` 関数を実装
    - 全 Reviewer 回答完了時に EventBridge イベントで集計トリガー
    - 部分集計有効時: 過半数（ceil(N/2)）完了時点でも集計トリガー
    - ConsensusThreshold 超過時に ConsensusResult 自動確定
    - Threshold 未達時に ConflictResolution 待ち状態 + Admin アプリ内通知
    - 自動確定後の Admin による変更禁止
    - Reviewer 間の回答隠蔽（UI・API・DynamoDB アクセスパターンの全レイヤー）
    - 匿名化進捗情報: 5名以上は「あと何人が回答待ち」、5名未満は「まだ回答が集まっています」
    - Admin による部分集計有効化設定 API（PATCH `/admin/settings/consensus`）
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.10, 10.11_

  - [x] 15.2 Property テスト: Consensus 集計と ConsensusResult 自動確定
    - **Property 15: Consensus集計とConsensusResult自動確定**
    - **Validates: Requirements 10.3, 10.4**

  - [x] 15.3 Property テスト: 部分集計トリガー条件
    - **Property 38: 部分集計トリガー条件**
    - **Validates: Requirements 10.3**

  - [x] 15.4 Property テスト: 匿名化進捗情報の表示制御
    - **Property 48: 匿名化進捗情報の表示制御**
    - **Validates: Requirements 10.11**

  - [x] 15.5 競合解決 API・UI 実装
    - GET `/consensus/{sessionId}/segments` ハンドラを実装（Consensus 状態取得）
    - POST `/consensus/{sessionId}/resolve` ハンドラを実装（手動確定）
    - ConflictResolutionPanel コンポーネント（各 Reviewer の回答・回答数表示 + 最終回答選択）
    - Segment に「確定済み」「未確定」「競合解決待ち」ラベル表示
    - ProgressIndicator コンポーネント（5名以上: 具体的人数表示、5名未満: 「まだ回答が集まっています」）
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.11_

  - [x] 15.6 Consensus のユニットテスト
    - 全員一致時の自動確定テスト
    - Threshold 未達時の ConflictResolution 状態テスト
    - 部分集計トリガーテスト（過半数完了時）
    - 回答隠蔽テスト
    - 匿名化進捗情報テスト（5名以上/5名未満の分岐）
    - _Requirements: 10.3, 10.4, 10.6, 10.10, 10.11_


- [x] 16. コントリビューターランキング機能実装（表示範囲制御対応）
  - [x] 16.1 ContributorScore 計算・更新ロジック実装（バックエンド）
    - `calculateScore()` 関数を実装（answerCount × accuracyRate / 100）
    - ConsensusResult 確定時に EventBridge 経由でスコア更新（24 時間以内）
    - 期間別集計（全期間・今月・今年・直近 30 日・直近 90 日）
    - ConsensusResult 未確定 Segment は計算対象外
    - _Requirements: 12.2, 12.4, 12.5, 12.9, 12.10_

  - [x] 16.2 Property テスト: ContributorScore の計算式
    - **Property 16: ContributorScoreの計算式**
    - **Validates: Requirements 12.2**

  - [x] 16.3 ランキング取得 API・UI 実装
    - GET `/ranking` ハンドラを実装（ContributorScore 降順、同スコア時は回答数降順）
    - ページネーション対応（1ページ50件）
    - RankingPage コンポーネント（順位・ユーザー名・回答数・正答率・スコア表示）
    - 自分自身のエントリを視覚的に強調
    - ランキング圏外ユーザーの末尾追加表示
    - 期間フィルタ UI
    - 0 件時の「まだランキングデータがありません」メッセージ
    - Admin 設定による表示範囲制御（全ユーザー/チーム内/上位N名）
    - PATCH/GET `/admin/settings/ranking` ハンドラを実装
    - _Requirements: 12.1, 12.3, 12.5, 12.6, 12.7, 12.8, 12.11, 12.12, 11.7_

  - [x] 16.4 Property テスト: ContributorRanking のソート順
    - **Property 17: ContributorRankingのソート順**
    - **Validates: Requirements 12.3**

  - [x] 16.5 Property テスト: ランキング表示範囲の制御
    - **Property 37: ランキング表示範囲の制御**
    - **Validates: Requirements 12.12**

- [x] 17. チェックポイント - バックエンド主要機能確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 18. IP アクセス制御・監査ログ・セキュリティ機能実装
  - [x] 18.1 IP Allowlist 管理 API 実装（バックエンド）
    - GET/POST/DELETE `/admin/ip-allowlist` ハンドラを実装
    - CIDR バリデーション（無効形式の拒否）
    - 最大 1,000 件制限
    - WAF IP セット更新（30 分以内反映）
    - IPAllowlist 0 件時はアクセス制限なし
    - fail-closed: WAF チェック機構自体が失敗時はリクエスト拒否
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.15_

  - [x] 18.2 Property テスト: IP Allowlist によるアクセス制御
    - **Property 18: IPAllowlistによるアクセス制御**
    - **Validates: Requirements 14.5**

  - [x] 18.3 Property テスト: CIDR バリデーション
    - **Property 19: CIDRバリデーション**
    - **Validates: Requirements 14.15**

  - [x] 18.4 Property テスト: レートリミットの適用
    - **Property 36: レートリミットの適用**
    - **Validates: Requirements 14.17**

  - [x] 18.5 監査ログ API 実装（バックエンド）
    - GET `/admin/audit-logs` ハンドラを実装（期間・実行者・操作種別フィルタ + ページネーション 100 件/ページ）
    - DELETE `/admin/audit-logs` ハンドラを実装（フィルタ条件に一致するエントリ削除）
    - 削除操作自体を AuditLog に記録（operationType: AUDIT_LOG_DELETED、削除者・削除対象件数・削除条件を含む）
    - AuditLog 記録関数を実装（全対象操作に組み込み: IP変更, User管理, Team管理, Assignment変更, Session完了, Consensus手動確定, Correction確定, 話者ラベル変更, ログイン失敗, メディア削除, Transcription削除, 部分削除失敗, 言語モデル作成, AuditLog削除）
    - 各エントリに操作日時・実行者 ID・ロール・操作種別・対象リソース ID を記録
    - 無期限保管（Admin 削除操作を除く）
    - 削除確認ダイアログ（件数と不可逆性の表示）
    - _Requirements: 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14_

  - [x] 18.6 Property テスト: AuditLog 削除の自己記録
    - **Property 45: AuditLog 削除の自己記録**
    - **Validates: Requirements 14.12**

  - [x] 18.7 AuditLog メタデータサニタイズ実装（バックエンド）
    - `sanitizeMetadata()` 関数を実装
    - 許可キーのみ通過（resourceName・previousValue・newValue・count・reason）
    - 値は文字列型で最大 1000 文字に切り詰め
    - 許可外キーは除去
    - _Requirements: 14.22_

  - [x] 18.8 Property テスト: メタデータフィールドのサニタイズ
    - **Property 46: メタデータフィールドのサニタイズ**
    - **Validates: Requirements 14.22**


  - [x] 18.9 IP Allowlist・監査ログ管理 UI 実装（フロントエンド）
    - IPAllowlistSettings コンポーネント（CIDR 追加・削除・バリデーションエラー表示）
    - AuditLogViewer コンポーネント（検索・フィルタ・ページネーション 100件/ページ・削除確認ダイアログ）
    - AdminPage に統合
    - _Requirements: 14.3, 14.7, 14.11, 14.13_

  - [x] 18.10 監査ログのユニットテスト
    - AuditLog 記録テスト（全操作種別、AUDIT_LOG_DELETED 含む）
    - メタデータサニタイズテスト
    - フィルタリング・ページネーションテスト
    - 削除確認ダイアログテスト
    - 削除自己記録テスト
    - _Requirements: 14.8, 14.11, 14.12, 14.13, 14.22_

- [x] 19. アクセシビリティ・ユーザビリティ・レスポンシブデザイン実装
  - [x] 19.1 キーボードショートカット実装
    - `useKeyboardShortcuts` カスタムフックで一元管理
    - スペースキーで再生・一時停止（MediaPlayer フォーカス時）
    - Tab キーで次の Segment に移動
    - Shift+Tab キーで前の Segment に移動
    - Ctrl+Z（Mac: Cmd+Z）でアンドゥ
    - Ctrl+Enter（Mac: Cmd+Enter）で編集確定
    - Escape キーで編集キャンセル
    - Ctrl+F（Mac: Cmd+F）で検索バーにフォーカス
    - IME 入力中（isComposing === true）はショートカット無効化
    - _Requirements: 11.1, 11.5_

  - [x] 19.2 レスポンシブデザイン実装
    - デスクトップ（1024px以上）: 左右分割レイアウト、全機能利用可
    - タブレット（768px〜1023px）: 上下分割レイアウト、簡易編集可
    - モバイル（768px未満）: サポート対象外メッセージ表示（「デスクトップブラウザをご利用ください」）
    - TailwindCSS レスポンシブプレフィックス（md:, lg:）で実装
    - _Requirements: 11.6_

  - [x] 19.3 WCAG 2.1 AA 準拠対応
    - 全主要画面に ARIA ラベル・ロール属性を追加
    - カラーコントラスト比の確認・修正
    - フォーカス管理の実装
    - axe-core + vitest-axe による自動チェックをテストに組み込み
    - _Requirements: 11.2_

  - [x] 19.4 アクセシビリティテスト
    - axe-core による WCAG 2.1 AA 自動チェック（全主要画面）
    - キーボードナビゲーションテスト（全ショートカット）
    - レスポンシブレイアウトテスト（各ブレークポイント）
    - _Requirements: 11.2, 11.6_


- [x] 20. オフライン対応・自動保存・ドラフト復元実装
  - [x] 20.1 オフラインキュー（IndexedDB）実装
    - `OfflineSyncQueue` クラスを実装
    - ネットワーク切断検知（navigator.onLine + online/offline イベント）
    - 未保存 Correction を IndexedDB キューに蓄積（FIFO 順序）
    - 各エントリに correctionId（冪等キー）を含める
    - キュー上限 200 件（超過時は最古エントリ破棄 + ユーザー警告）
    - Optimistic UI 更新（即時反映）
    - _Requirements: 11.10_

  - [x] 20.2 オフライン同期・UI コンポーネント実装
    - 接続復帰時の自動同期（指数バックオフ: 初回1秒、最大30秒、最大5回）
    - 5回失敗後はユーザーに手動再試行を促す
    - OfflineBanner コンポーネント（画面上部に「オフライン」バナー表示、接続復帰時に自動非表示）
    - SyncStatusIndicator コンポーネント（「同期中...」「同期完了」表示）
    - _Requirements: 11.10, 11.11_

  - [x] 20.3 Property テスト: オフラインキューの同期完全性
    - **Property 42: オフラインキューの同期完全性**
    - **Validates: Requirements 11.10**

  - [x] 20.4 自動保存・ドラフト復元実装
    - 編集中テキストを 5 秒間隔で localStorage に自動保存（キー: `draft_{sessionId}_{segmentId}`）
    - DraftRecoveryDialog コンポーネント（ブラウザクラッシュ後の再オープン時に復元確認）
    - 確定操作完了後に対応する draft エントリを削除
    - draft データの有効期限: 24 時間（期限切れは自動削除）
    - _Requirements: 11.9_

  - [x] 20.5 Property テスト: 自動保存ドラフトの復元
    - **Property 43: 自動保存ドラフトの復元**
    - **Validates: Requirements 11.9**

  - [x] 20.6 オフライン・自動保存のユニットテスト
    - IndexedDB キュー操作テスト
    - 同期リトライテスト（指数バックオフ）
    - OfflineBanner 表示/非表示テスト
    - ドラフト保存・復元テスト
    - ドラフト有効期限テスト（24時間超過で自動削除）
    - _Requirements: 11.9, 11.10, 11.11_

- [x] 21. チェックポイント - セキュリティ・アクセシビリティ・オフライン対応確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 22. メディアアップロード機能実装
  - [x] 22.1 UploadService（PresignedURL 生成・バリデーション）実装（バックエンド）
    - PresignedURL 生成（有効期限 300 秒）
    - ファイル形式バリデーション（mp3, wav, flac, ogg, m4a, amr, webm, mp4, mkv, avi, mov）
    - ファイルサイズバリデーション（上限 2GB）
    - S3 キー生成（`media/{mediaFileId}/{filename}`）
    - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 22.2 Property テスト: アップロードバリデーション
    - **Property 20: アップロードバリデーション（ファイル形式・サイズ）**
    - **Validates: Requirements 16.3, 16.4, 16.5, 16.6**

  - [x] 22.3 Property テスト: S3 キー生成パターン
    - **Property 22: S3 キー生成パターン**
    - **Validates: Requirements 16.8, 17.11, 20.6**

  - [x] 22.4 Property テスト: PresignedURL 有効期限の制限
    - **Property 35: PresignedURL 有効期限の制限**
    - **Validates: Requirements 16.7**

  - [x] 22.5 S3 イベント処理（process-upload）Lambda ハンドラ実装
    - S3 ObjectCreated イベントからメタデータ抽出
    - DynamoDB に MediaFile レコード作成（ファイル名・サイズ・Content-Type・アップロード日時・ユーザーID）
    - scanStatus を PENDING に初期設定
    - _Requirements: 16.2_

  - [x] 22.6 Property テスト: S3 イベントからのメタデータ抽出
    - **Property 21: S3 イベントからのメタデータ抽出**
    - **Validates: Requirements 16.2**

  - [x] 22.7 マルウェアスキャン Lambda 実装
    - アップロードファイルに対するスキャン実行
    - 検出時: ファイル隔離 + DynamoDB scanStatus 更新（INFECTED）
    - 正常時: DynamoDB scanStatus 更新（CLEAN）
    - スキャン結果を DynamoDB に記録
    - _Requirements: 16.10_

  - [x] 22.8 Property テスト: マルウェアスキャン結果によるファイルアクセス制御
    - **Property 39: マルウェアスキャン結果によるファイルアクセス制御**
    - **Validates: Requirements 16.10**

  - [x] 22.9 upload-url Lambda ハンドラ実装
    - POST エンドポイントで PresignedURL を生成して返却
    - バリデーションエラー時のエラーレスポンス（サポート形式一覧・サイズ上限含む）
    - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.6_

  - [x] 22.10 アップロード UI 実装（フロントエンド）
    - メディアアップロードページコンポーネント
    - UploadProgress コンポーネント（パーセンテージ表示のプログレスバー）
    - ファイル形式・サイズのクライアントサイドバリデーション
    - エラーメッセージ表示（サポート形式一覧・サイズ上限）
    - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 16.9_

  - [x] 22.11 アップロード関連のユニットテスト
    - PresignedURL 生成テスト
    - バリデーションテスト（形式・サイズ）
    - process-upload ハンドラテスト
    - マルウェアスキャン結果処理テスト
    - _Requirements: 16.1, 16.2, 16.10_


- [x] 23. Transcription ジョブ機能実装
  - [x] 23.1 TranscriptionJobService 実装（バックエンド）
    - StartTranscriptionJob API 呼び出し（ShowSpeakerLabels: true）
    - MaxSpeakerLabels バリデーション（2〜10、デフォルト 2）
    - 言語コード設定（デフォルト ja-JP、ユーザー選択可能）
    - カスタム言語モデル指定（LanguageModelName パラメータ）
    - ジョブステータス取得
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 18.1, 18.2_

  - [x] 23.2 Property テスト: MaxSpeakerLabels バリデーション
    - **Property 23: MaxSpeakerLabels バリデーション**
    - **Validates: Requirements 17.3, 17.5**

  - [x] 23.3 Transcribe ジョブ完了処理 Lambda 実装
    - Transcribe 出力 JSON パース（speaker_labels.segments + items → Segment データ）
    - Segment データ（startTime・endTime・テキスト・speakerLabel）を DynamoDB に保存
    - Transcribe 出力を S3 `transcriptions/{jobId}/output.json` に保存
    - ReviewSession を「未着手」状態で自動作成
    - ジョブ失敗時のエラーステータス記録
    - _Requirements: 17.7, 17.8, 17.9, 17.11_

  - [x] 23.4 Property テスト: Transcribe 出力パースの完全性
    - **Property 24: Transcribe 出力パースの完全性**
    - **Validates: Requirements 17.7**

  - [x] 23.5 start-transcription / get-job-status Lambda ハンドラ実装
    - POST エンドポイントで TranscriptionJob 開始
    - GET エンドポイントでジョブステータス取得
    - _Requirements: 17.1, 17.10_

  - [x] 23.6 Transcription ジョブ UI 実装（フロントエンド）
    - Transcription ジョブ作成フォーム（MaxSpeakerLabels・言語コード・カスタムモデル選択）
    - JobStatusPoller コンポーネント（5 秒間隔ポーリング表示）
    - カスタム言語モデル一覧表示（COMPLETED ステータスのみ）
    - エラーメッセージ表示（ジョブ失敗時）
    - _Requirements: 17.3, 17.4, 17.5, 17.6, 17.9, 17.10, 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 23.7 Property テスト: カスタム言語モデルのステータスフィルタリング
    - **Property 25: カスタム言語モデルのステータスフィルタリング**
    - **Validates: Requirements 18.4**

  - [x] 23.8 TranscriptionJobService と関連ハンドラのユニットテスト
    - ジョブ開始テスト（各パラメータ組み合わせ）
    - MaxSpeakerLabels 範囲外テスト
    - ジョブ完了処理テスト
    - ジョブ失敗時テスト
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.9_


- [x] 24. カスタム言語モデル作成機能実装
  - [x] 24.1 LanguageModelService 実装（バックエンド）
    - ロールベースアクセス制御（Admin/TeamLeader のみ）
    - ConsensusResult 確定済み Segment テキストからトレーニングデータ生成
    - CreateLanguageModel API 呼び出し（BaseModelName: NarrowBand/WideBand）
    - トレーニングデータを S3 `training-data/{modelName}/training.txt` に保存
    - モデル名重複チェック（大文字・小文字区別の完全一致）
    - モデルステータス取得（IN_PROGRESS/COMPLETED/FAILED）
    - AuditLog 記録（実行者・モデル名・使用 ReviewSession 一覧）
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.10, 20.11, 20.12_

  - [x] 24.2 Property テスト: ロールベースアクセス制御
    - **Property 30: ロールベースアクセス制御（Admin/TeamLeader 限定機能）**
    - **Validates: Requirements 20.1, 20.2, 21.1, 21.2**

  - [x] 24.3 Property テスト: トレーニングデータ生成の完全性
    - **Property 31: トレーニングデータ生成の完全性**
    - **Validates: Requirements 20.3**

  - [x] 24.4 Property テスト: カスタム言語モデル名の重複チェック
    - **Property 32: カスタム言語モデル名の重複チェック**
    - **Validates: Requirements 20.11**

  - [x] 24.5 create-language-model / get-model-status Lambda ハンドラ実装
    - POST エンドポイントでモデル作成開始
    - GET エンドポイントでモデルステータス取得
    - Reviewer アクセス時 403 エラー
    - _Requirements: 20.1, 20.2, 20.7, 20.8, 20.9_

  - [x] 24.6 カスタム言語モデル管理 UI 実装（フロントエンド）
    - モデル作成フォーム（モデル名・BaseModelName 選択・ReviewSession 選択）
    - モデルステータス表示（IN_PROGRESS/COMPLETED/FAILED）
    - エラーメッセージ表示（重複・API エラー・バリデーションエラー）
    - _Requirements: 20.1, 20.2, 20.7, 20.8, 20.9, 20.10, 20.11_

  - [x] 24.7 LanguageModelService のユニットテスト
    - ロールチェックテスト
    - モデル名重複テスト
    - トレーニングデータ生成テスト
    - API エラーハンドリングテスト
    - _Requirements: 20.1, 20.2, 20.9, 20.11_


- [x] 25. 修正後 Transcription ダウンロード機能実装
  - [x] 25.1 DownloadService（JSON/SRT 生成）実装（バックエンド）
    - ConsensusResult 確定済み Segment のフィルタリング
    - JSON 形式生成（startTime・endTime・text・speakerLabel）
    - SRT 形式生成（シーケンス番号・タイムコード HH:MM:SS,mmm・テキスト・話者ラベルプレフィックス）
    - ファイル名生成（`{ReviewSession名}_{YYYYMMDD}.{拡張子}`）
    - 確定済み Segment 0 件時のエラーレスポンス
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9_

  - [x] 25.2 Property テスト: ダウンロード対象の確定済み Segment フィルタリング
    - **Property 26: ダウンロード対象の確定済み Segment フィルタリング**
    - **Validates: Requirements 19.1**

  - [x] 25.3 Property テスト: JSON 形式ダウンロードの構造的正確性
    - **Property 27: JSON 形式ダウンロードの構造的正確性**
    - **Validates: Requirements 19.2, 19.4**

  - [x] 25.4 Property テスト: SRT 形式ダウンロードの構造的正確性
    - **Property 28: SRT 形式ダウンロードの構造的正確性**
    - **Validates: Requirements 19.3, 19.5, 19.6**

  - [x] 25.5 Property テスト: ダウンロードファイル名の形式
    - **Property 29: ダウンロードファイル名の形式**
    - **Validates: Requirements 19.9**

  - [x] 25.6 download-transcription Lambda ハンドラ実装
    - GET エンドポイントで形式指定（json/srt）ダウンロード
    - ブラウザダウンロード用レスポンスヘッダ設定
    - _Requirements: 19.8_

  - [x] 25.7 ダウンロード UI 実装（フロントエンド）
    - ダウンロード形式選択 UI（JSON/SRT）
    - ダウンロードボタン
    - 確定済み Segment 0 件時のエラーメッセージ
    - _Requirements: 19.1, 19.7, 19.8_

  - [x] 25.8 DownloadService のユニットテスト
    - JSON 生成テスト
    - SRT 生成テスト
    - 0 件時エラーテスト
    - ファイル名生成テスト
    - _Requirements: 19.1, 19.7, 19.9_

- [x] 26. チェックポイント - ワークフロー機能確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 27. メディア・Transcription 削除機能実装
  - [x] 27.1 DeletionService 実装（バックエンド）
    - ロールベースアクセス制御（TeamLeader/Admin のみ）
    - チームアクセス制御（自チーム割り当て ReviewSession のみ削除可能）
    - メディア削除: S3 オブジェクト削除 + DynamoDB メタデータ削除
    - Transcription カスケード削除: S3 出力ファイル + DynamoDB（ReviewSession・Segment・Correction・ConsensusResult）全レコード削除
    - メディア削除時の ReviewSession MediaFile 参照無効化（MediaPlayer 非表示）
    - AuditLog 記録（実行者・リソース ID・リソース種別）
    - 部分削除失敗時: AuditLog に PARTIAL_DELETION_FAILURE 記録 + Admin 通知
    - _Requirements: 21.1, 21.2, 21.4, 21.6, 21.7, 21.9, 21.10, 21.11_

  - [x] 27.2 Property テスト: カスケード削除の完全性
    - **Property 33: カスケード削除の完全性**
    - **Validates: Requirements 21.6**

  - [x] 27.3 Property テスト: チームアクセス制御による削除制限
    - **Property 34: チームアクセス制御による削除制限**
    - **Validates: Requirements 21.9**

  - [x] 27.4 Property テスト: 部分削除の監査ログ記録
    - **Property 40: 部分削除の監査ログ記録**
    - **Validates: Requirements 21.9**

  - [x] 27.5 delete-media / delete-transcription Lambda ハンドラ実装
    - DELETE エンドポイントでメディア削除・Transcription 削除
    - 確認ダイアログ用の削除対象情報取得 API
    - 削除失敗時のエラーレスポンス（データ保持）
    - _Requirements: 21.3, 21.5, 21.8_

  - [x] 27.6 削除 UI 実装（フロントエンド）
    - メディア削除確認ダイアログ（ファイル名・不可逆性表示）
    - Transcription 削除確認ダイアログ（ReviewSession 名・関連データ一覧・不可逆性表示）
    - エラーメッセージ表示（削除失敗時）
    - _Requirements: 21.3, 21.5, 21.8_

  - [x] 27.7 DeletionService のユニットテスト
    - ロールチェックテスト
    - チームアクセス制御テスト
    - カスケード削除テスト
    - 部分削除失敗テスト
    - MediaFile 参照無効化テスト
    - _Requirements: 21.1, 21.2, 21.8, 21.9, 21.11_


- [x] 28. ソリューション削除手順の CDK 実装
  - [x] 28.1 CDK RemovalPolicy 設定と削除手順ドキュメント
    - S3 バケットの RemovalPolicy 設定（DESTROY + autoDeleteObjects）
    - DynamoDB テーブルの RemovalPolicy 設定
    - KMS キーの削除スケジュール（30 日待機）
    - Cognito/CloudFront の条件付き RETAIN（既存インポート時は残存）
    - 削除手順スクリプト作成（ドライラン確認 → S3 空化 → cdk destroy --all）
    - 部分削除（特定スタックのみ）のサポート
    - _Requirements: 14.1, 15.1, 22.2_

- [x] 29. 統合・結合
  - [x] 29.1 フロントエンド・バックエンド結合
    - API クライアントサービスを実装（共通エラーハンドラ付き）
    - 全ページ・コンポーネントを API に接続
    - React Router によるページ遷移を統合（BasePath 対応: `basename={basePath}`）
    - グローバルエラーバウンダリを実装
    - レートリミット超過時の 429 エラーハンドリング（リトライ待機表示）
    - ESLint ルール `react/no-danger` を設定（dangerouslySetInnerHTML 禁止の静的チェック）
    - Content Security Policy ヘッダー設定（script-src 'self'）
    - _Requirements: 1.1, 5.4, 9.9, 14.17, 14.20, 22.6_

  - [x] 29.2 CDK デプロイスクリプト・設定完成
    - 全スタック間の依存関係を確認・修正（Foundation → API → CDN → Monitoring）
    - 環境変数・Parameter Store 設定を完成
    - CloudFormation スタック名に環境名プレフィックスを付与
    - 新規 Lambda 関数の CDK 定義を追加（upload-url, process-upload, start-transcription, get-job-status, process-job-complete, create-language-model, get-model-status, download-transcription, delete-media, delete-transcription, malware-scan）
    - API Gateway ルート定義を追加
    - S3 Event Notification と EventBridge Rule を CDK で定義
    - _Requirements: 14.1, 16.1, 17.1, 19.8, 20.1, 21.1_

  - [x] 29.3 インテグレーションテスト
    - DynamoDB CRUD 操作テスト（LocalStack 使用）
    - Cognito 認証フローテスト（MFA 含む）
    - CloudFront Signed URL 生成テスト
    - WAF IP フィルタリングテスト
    - WAF レートリミットテスト（認証 5/min、一般 100/min）
    - セッションタイムアウトテスト（アイドル 30 分、絶対 8 時間）
    - アイドルタイムアウト警告テスト（残り 5 分で通知）
    - マルウェアスキャン Lambda トリガーと結果処理テスト
    - スキャン前アクセス制御テスト（PENDING ファイルの URL 生成拒否）
    - 部分削除失敗時の AuditLog 記録テスト
    - AuditLog 削除自己記録テスト
    - メタデータサニタイズテスト
    - オフラインキュー同期テスト
    - _Requirements: 9.1, 9.10, 9.11, 11.8, 11.10, 14.5, 14.12, 14.17, 14.22, 14.24, 16.10_

- [x] 30. 最終チェックポイント - 全テスト通過確認
  - 全テストが通ることを確認し、不明点があればユーザーに質問する。


- [x] 31. Playwright E2E テストインフラストラクチャ
  - [x] 31.1 E2E テスト計画の作成
    - `e2e/test-plan.md` に 10 テストスイート・約 80 テストケースのテスト計画を策定
    - 認証、ナビゲーション、セッション一覧、校閲画面、メディアアップロード、言語モデル管理、ランキング、管理画面、アクセシビリティ、エラーハンドリングをカバー
    - _Requirements: 全要件の E2E 検証_

  - [x] 31.2 Playwright プロジェクトセットアップ
    - `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tsconfig.json`, `e2e/.gitignore`, `e2e/.env.example` を作成
    - Chromium プロジェクト設定、globalSetup/globalTeardown 設定
    - _Requirements: 11.3_

  - [x] 31.3 テストユーザーライフサイクル管理（globalSetup/globalTeardown）
    - `e2e/global-setup.ts`: Admin API 経由で TeamLeader・Reviewer ユーザーを動的作成
    - `e2e/global-teardown.ts`: テスト完了後にテストユーザーを無効化・削除
    - タイムスタンプ付きメールで並列実行時の競合回避
    - 初回パスワード変更（NEW_PASSWORD_REQUIRED チャレンジ対応）
    - 共有ストレージ `.auth/test-users.json` に保存
    - _Requirements: 9.1, 9.2, 9.6_

  - [x] 31.4 認証フィクスチャとヘルパーモジュール
    - `e2e/fixtures/auth.ts`: ロール別ログインヘルパー（Admin, TeamLeader, Reviewer）
    - `e2e/helpers/cognito-helper.ts`: Cognito Admin API 操作ヘルパー
    - `e2e/helpers/api-helper.ts`: API リクエストヘルパー
    - _Requirements: 9.1, 9.4_

  - [x] 31.5 シードデータスクリプト
    - `e2e/seed/seed-data.ts`: DynamoDB テストデータ投入（ReviewSession 60 件+、Correction、Team、ランキング、IP Allowlist、監査ログ）
    - `e2e/seed/seed-media-files.ts`: S3 メディアファイル + DynamoDB MediaFile レコード投入
    - _Requirements: 5.5, 12.1, 14.3, 14.8_

  - [x] 31.6 認証フローテストスペック
    - `e2e/tests/auth/login.spec.ts`: ログイン、無効認証情報エラー、新パスワード設定、MFA、ボタン無効化
    - _Requirements: 9.1, 9.12_

  - [x] 31.7 ナビゲーションテストスペック
    - `e2e/tests/navigation/navigation.spec.ts`: ロール別リンク表示、アクティブページハイライト、ページ遷移
    - _Requirements: 9.4, 9.5_

  - [x] 31.8 セッション一覧・校閲画面テストスペック
    - `e2e/tests/sessions/session-list.spec.ts`: 一覧表示、ステータスフィルター、ソート、ページネーション
    - `e2e/tests/sessions/review-page.spec.ts`: レイアウト切り替え、同期再生、インライン編集、削除
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 4.1, 4.2, 21.1_

  - [x] 31.9 メディアアップロードテストスペック
    - `e2e/tests/upload/media-upload.spec.ts`: ファイル選択、バリデーション、アップロード進捗、完了メッセージ
    - _Requirements: 16.1, 16.3, 16.4, 16.5_

  - [x] 31.10 言語モデル管理テストスペック
    - `e2e/tests/language-models/language-model.spec.ts`: アクセス制御、バリデーション、モデル作成、ステータス表示
    - _Requirements: 20.1, 20.2, 20.11_

  - [x] 31.11 ランキングテストスペック
    - `e2e/tests/ranking/ranking.spec.ts`: テーブル表示、期間フィルター、ユーザーハイライト、ページネーション
    - _Requirements: 12.1, 12.3, 12.5, 12.6_

  - [x] 31.12 管理画面テストスペック（ユーザー・チーム・IP・監査ログ）
    - `e2e/tests/admin/user-management.spec.ts`: ユーザー一覧、作成、無効化
    - `e2e/tests/admin/team-management.spec.ts`: チーム CRUD、メンバー管理、セッション割り当て
    - `e2e/tests/admin/ip-allowlist.spec.ts`: IP エントリ追加・削除
    - `e2e/tests/admin/audit-logs.spec.ts`: ログ一覧、フィルター、ページネーション、削除
    - _Requirements: 9.2, 13.1, 13.4, 14.3, 14.8, 14.11_

  - [x] 31.13 アクセシビリティテストスペック
    - `e2e/tests/accessibility/a11y.spec.ts`: ARIA ランドマーク、タブ属性、フォームラベル、キーボード操作、フォーカスリング
    - _Requirements: 11.2_

  - [x] 31.14 テスト実行シェルスクリプト
    - `e2e-test.sh`: E2E テスト単独実行スクリプト（シード投入、依存インストール、Playwright 実行）
    - `deploy-and-test.sh`: デプロイ + E2E テスト統合パイプラインスクリプト
    - _Requirements: 14.1_

  - [x] 31.15 セットアップドキュメント
    - `e2e/SETUP.md`: 環境構築手順、環境変数設定、実行方法の説明
    - _Requirements: 11.3_


## Notes

- タスクに `*` マークが付いたサブタスクはオプションであり、MVP 優先時はスキップ可能
- 各タスクは特定の Requirements を参照しトレーサビリティを確保
- チェックポイントで段階的に品質を検証
- Property テストは設計ドキュメントの Correctness Properties に基づく（P1〜P48）
- ユニットテストは特定シナリオ・エッジケースを検証
- テスト実行: `npx vitest --run`（単発実行）
- インフラデプロイ: `cd infra && npx cdk deploy --all`
- アンドゥ上限は 50 件
- セッション管理: アイドル 30 分タイムアウト + 残り 5 分で警告通知 + 絶対 8 時間期限
- JWT 有効期限: 15 分（メモリ保持のみ、localStorage 不使用）
- PresignedURL 有効期限: 300 秒（5 分）
- レートリミット: 認証 5 回/分/IP、一般 100 回/分/ユーザー
- MFA: Admin 必須、Reviewer/TeamLeader オプション
- Cognito Advanced Security Features: 適応型認証有効（ENFORCED モード）
- custom:role: Mutable: false、WriteAttributes 除外で二重防止
- 部分集計: Admin が有効化設定可能、過半数完了時点で集計トリガー
- 匿名化進捗: 5名以上は具体的人数表示、5名未満は「まだ回答が集まっています」
- ランキング表示範囲: Admin 設定（全ユーザー/チーム内/上位N名）
- ページネーション: セッション一覧 50件、監査ログ 100件、ランキング 50件
- CloudFront: 既存インポート対応 + BasePath 対応
- マルウェアスキャン: アップロード後に自動実行、検出時は隔離
- スキャン前アクセス制御: PENDING ファイルの Signed URL 生成を拒否
- S3 BlockPublicAccess: 全バケットで全項目有効化
- XSS 防止: dangerouslySetInnerHTML 全面禁止、検索ハイライトは DOM テキストノード分割
- AuditLog 削除: 削除操作自体を AUDIT_LOG_DELETED として記録
- メタデータサニタイズ: 許可キーのみ（resourceName, previousValue, newValue, count, reason）、最大 1000 文字
- オフライン対応: IndexedDB キュー + Optimistic UI + 自動同期（指数バックオフ）
- 自動保存: localStorage に 5 秒間隔、DraftRecoveryDialog で復元確認、24 時間有効期限
- レスポンシブ: デスクトップ主要（1024px+）、タブレット簡易（768px+）、モバイル非対応
- キーボードショートカット: Space, Tab, Shift+Tab, Ctrl+Z, Ctrl+Enter, Escape, Ctrl+F
- 削除手順: ドライラン推奨（--dryrun で確認後に実行）


## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.4"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.3", "3.5", "3.6"] },
    { "id": 4, "tasks": ["5.1", "5.4"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.5", "5.6"] },
    { "id": 6, "tasks": ["5.7", "6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3", "6.4", "6.5"] },
    { "id": 8, "tasks": ["6.6", "7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3", "7.5"] },
    { "id": 10, "tasks": ["7.4", "7.6", "9.1", "9.3"] },
    { "id": 11, "tasks": ["9.2", "9.4", "9.5", "10.1"] },
    { "id": 12, "tasks": ["10.2", "10.3", "11.1"] },
    { "id": 13, "tasks": ["10.4", "11.2", "11.3"] },
    { "id": 14, "tasks": ["11.4", "12.1"] },
    { "id": 15, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 16, "tasks": ["12.5", "14.1", "14.2"] },
    { "id": 17, "tasks": ["14.3", "14.4", "15.1"] },
    { "id": 18, "tasks": ["15.2", "15.3", "15.4", "15.5"] },
    { "id": 19, "tasks": ["15.6", "16.1"] },
    { "id": 20, "tasks": ["16.2", "16.3"] },
    { "id": 21, "tasks": ["16.4", "16.5", "18.1"] },
    { "id": 22, "tasks": ["18.2", "18.3", "18.4", "18.5"] },
    { "id": 23, "tasks": ["18.6", "18.7"] },
    { "id": 24, "tasks": ["18.8", "18.9", "18.10"] },
    { "id": 25, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 26, "tasks": ["19.4", "20.1"] },
    { "id": 27, "tasks": ["20.2", "20.4"] },
    { "id": 28, "tasks": ["20.3", "20.5", "20.6"] },
    { "id": 29, "tasks": ["22.1", "22.5"] },
    { "id": 30, "tasks": ["22.2", "22.3", "22.4", "22.7", "22.9"] },
    { "id": 31, "tasks": ["22.6", "22.8", "22.10", "22.11"] },
    { "id": 32, "tasks": ["23.1"] },
    { "id": 33, "tasks": ["23.2", "23.3", "23.5"] },
    { "id": 34, "tasks": ["23.4", "23.6", "23.7", "23.8"] },
    { "id": 35, "tasks": ["24.1"] },
    { "id": 36, "tasks": ["24.2", "24.3", "24.4", "24.5"] },
    { "id": 37, "tasks": ["24.6", "24.7", "25.1"] },
    { "id": 38, "tasks": ["25.2", "25.3", "25.4", "25.5", "25.6"] },
    { "id": 39, "tasks": ["25.7", "25.8", "27.1"] },
    { "id": 40, "tasks": ["27.2", "27.3", "27.4", "27.5"] },
    { "id": 41, "tasks": ["27.6", "27.7", "28.1"] },
    { "id": 42, "tasks": ["29.1", "29.2"] },
    { "id": 43, "tasks": ["29.3"] },
    { "id": 44, "tasks": ["31.1", "31.2"] },
    { "id": 45, "tasks": ["31.3", "31.4", "31.5"] },
    { "id": 46, "tasks": ["31.6", "31.7", "31.8", "31.9", "31.10", "31.11", "31.12", "31.13"] },
    { "id": 47, "tasks": ["31.14", "31.15"] }
  ]
}
```
