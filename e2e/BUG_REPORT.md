# Phase 1 バグ検出 E2E レポート

Transcription Review App の E2E（Playwright）整備（test-plan.md 全10スイート）で検出した実バグと、その修正・横展開調査の記録。実行環境はデプロイ済み dev（実 Cognito + シードデータ）。

## サマリ

- test-plan.md 全10スイート（約86項目）を堅牢化・穴埋め。条件ガード撤廃、不正セレクタ修正、タイトル整合、`waitForTimeout`→応答待ち置換、axe 自動スキャン配線を実施。
- 実バグを 5 件検出し、4 件を修正・デプロイ・再検証済み（残 1 件はデプロイ待ち）。1 件は環境制約として記録。
- 全フロント修正は二段レビュー付きワークフローで実施し、横展開調査を伴う。

## 検出した実バグ

### 実バグ #1: セッション一覧がサーバーページングを無視（機能欠陥）
- 症状: バックエンド `GET /sessions` は 50 件/ページのサーバーページング（totalItems:65, totalPages:2）を返すが、フロント `SessionListPageWrapper` が 1 ページ目の 50 件のみ保持し `pagination` を無視。クライアント側ページング前提の `SessionListPage` が `totalPages=1` と誤算出し、残り 15 件が閲覧不能。ステータスフィルタも取得済み 50 件にしか効かない。
- 原因: フロント/バックのページング責務の不一致（バック=サーバーページング、フロント=クライアントページング）。
- 修正: フロントを完全サーバー駆動化（RankingPage と同方式）。`SessionListPage` を presentational 化し、`selectedStatus`/`onStatusChange`/`pagination`/`onPageChange` を props 化。`?status=`/`?page=` で再取得。assigned/joinable スコープは後方互換のフォールバック。バックエンド変更なし。
- 横展開: フロント全ページを調査。同種（API はページングを返すがフロントが無視）は**この 1 箇所のみ**。監査ログは既に正しくサーバー駆動、ユーザー/チーム/言語モデル一覧は意図的に非ページング、RankingPage は正しい参照実装。
- 検証: 修正・dev デプロイ・E2E（3.2/3.7 等）green。

### 実バグ #2: 監査ログ削除が CORS/ルート不一致で完全停止
- 症状: 監査ログ削除ボタン押下で `POST /admin/audit-logs/delete` が送られるが、ブラウザが CORS ブロック（`No 'Access-Control-Allow-Origin' header`）。削除機能が本番含め動作していない。
- 原因: フロントは `POST /admin/audit-logs/delete` を呼ぶが、CDK には `DELETE /admin/audit-logs` しか登録されておらず、該当ルート不在で CORS プリフライト応答も返らない。フロント/インフラの契約不一致。
- 修正: CDK に `POST /admin/audit-logs/delete` ルートを追加（既存の method-agnostic ハンドラに結線）。フロント/ハンドラ不変。
- 横展開: フロント全 59 API 呼び出し vs CDK 全ルートを突合。不一致は**この 1 箇所のみ**。
- 検証: 修正・API スタック dev デプロイ・E2E（8.5.4）green。
- 備考: 旧 `DELETE /admin/audit-logs` ルートは呼び出し元なしの dead route。削除は未実施（挙動変更不要）だが将来のクリーンアップ候補。

### 実バグ #3: WCAG 2.1 AA SC 2.5.3「Label in Name」違反（13 箇所、serious）
- 症状: アイコン＋テキストのボタン等で、可視テキストがアクセシブルネーム（aria-label）に含まれず、axe-core が `label-content-name-mismatch`（serious）を検出。音声操作ユーザーが可視テキストでコントロールを指定できない。
- 該当: ReviewPage の削除ボタン2つ、MediaUploadPage ドロップゾーン、3 画面のページネーション（前へ/次へ）、SessionList セッション選択ボタン、MediaPlayer 速度ボタン、SpeakerLabelManager の2ボタン。
- 修正: 各 aria-label を可視テキストを verbatim に含む形へ（例: 「Transcription を削除」→「Transcription 削除（このセッションの文字起こしを削除）」）。アイコンのみ/スクリーンリーダー専用ラベルは対象外。
- 横展開: 全 components/pages の aria-label を調査し 13 箇所を是正。
- 検証: 修正・dev デプロイ・E2E axe 9.C（校閲画面）green。
- 修正漏れ（#5 で解消）: MediaUploadPage ドロップゾーンは `role="button"` 配下に説明テキスト（対応形式…）も含むため初回修正では不十分だった。

### 実バグ #5: MediaUploadPage ドロップゾーンの Label in Name 修正漏れ（#3 の残り）
- 症状: ドロップゾーン `role="button"` が aria-label 外の可視テキスト（「対応形式: … / 最大 2GB」）を内包し、axe 9.D が依然 `label-content-name-mismatch` を検出。
- 修正: 構造修正（説明テキストを `role="button"` の外＝兄弟要素へ移動、視覚レイアウトは維持）。aria-label 不変のため e2e ロケータ変更不要。
- 横展開: 他の container-role button（InlineEditor）は準拠と確認。
- 検証: main マージ済み。**dev 再デプロイ後に E2E 9.D で最終確認予定**。

### 実バグ #4: オフライン/タイムアウト/同期コンポーネントが未配線
- 症状: `OfflineBanner` / `SessionTimeoutWarning` / `SyncStatusIndicator` は実装・ユニットテスト済みだが App にどこからも配線されておらず、実アプリ画面に出ない（機能が有効化されていない）。
- 修正（表示配線のみ・スコープ [1]a + [2]a）:
  - `useOnlineStatus` hook を追加し `OfflineBanner` を認証済みシェルに配線（navigator.onLine + online/offline）。
  - `useIdleTimeout` hook を追加し `SessionTimeoutWarning` を配線（本番既定: 30分アイドル/5分前警告。`VITE_IDLE_TIMEOUT_MS`/`VITE_IDLE_WARNING_MS` で上書き可。onContinue→reset、onTimeout→既存 signOut）。
  - `SyncStatusIndicator` は意図的に未配線のまま（下記 既知事項参照）。
- 検証: 修正・dev デプロイ・E2E 10.2（オフラインバナー）green。10.3（タイムアウト警告）は frontend ユニットテスト（useIdleTimeout + SessionTimeoutWarning、fake timers）でカバー。

## 環境制約（アプリ/テストのバグではない）

### Cognito メール送信日次上限（8.2.2 / 8.2.3）
- `POST /admin/users` は Cognito 招待メール送信を伴い、デフォルトの日次メール上限に達すると 500（"Exceeded daily email limit"）。繰り返しのテスト実行で上限超過。
- 対応: 
  - E2E 実行基盤（globalSetup）を「固定テストユーザーの再利用」に変更し、毎回のユーザー作成（＝メール送信）を撤廃。teardown も固定ユーザーを削除しない。これで実行ごとのメール消費をゼロ化。
  - 8.2.2/8.2.3（ユーザー作成/無効化機能の検証）は作成 API が上限 500 を返したら理由付き skip、成功時は通常検証。上限リセット後に自動的に実検証へ戻る。
- 示唆（運用）: 管理者のユーザー作成がデフォルトの Cognito 内蔵メール（低い上限）に依存している。恒常運用では User Pool を Amazon SES に接続することを推奨（今回のスコープ外）。

## 意図的 skip / 既知事項

- 1.5 MFA（TOTP）コード画面: 環境に MFA 有効ユーザーがなく、TOTP を動的設定するのは不安定なため skip。UI 実装は LoginForm に存在。
- 10.3 セッションタイムアウト警告（E2E）: 本番しきい値（30分）での実時間 E2E は非現実的で、短縮 `VITE_IDLE_*` をビルドに焼き込むと dev 全体に副作用。E2E は skip、ロジックは frontend ユニットテストで決定論的に検証。
- 10.5 同期ステータスインジケータ: `SyncStatusIndicator` は「同期」概念が Correction 保存のオフラインキュー統合（SyncManager 連携）を前提とするため未配線。将来の「オフライン Correction 同期」機能で、ReviewPage の onSaveCorrection をオフラインキュー経由にし SyncManager.status を購読して配線する想定。

## axe 自動スキャン（WCAG 2.1 AA）

- `@axe-core/playwright` を導入し、`helpers/axe-helper.ts` の `expectNoAxeViolations` で主要 6 ページ（ログイン/一覧/校閲/アップロード/ランキング/管理）を WCAG 2.0/2.1 A・AA タグでスキャン。
- 既存の手動 ARIA チェックは維持。9.5（role=status）・9.9（focus ring）を追加。
- 注記: axe による自動検査は WCAG 準拠の一部を機械的に確認するもので、完全な準拠検証には支援技術での手動テストと専門家レビューが必要。

## E2E 実行結果（#5 デプロイ前時点）

- 101 passed / 3 skipped（8.2.2・8.2.3 メール上限、10.3 タイムアウト）/ 1 残（axe 9.D、#5 デプロイ後に green 見込み）。
- #5 デプロイ後は 9.D も green となり、残りは意図的 skip（8.2.x・10.3・10.5）のみの見込み。
