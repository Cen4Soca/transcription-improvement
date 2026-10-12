# Requirements Document

## Introduction

本ドキュメントは、Amazon Transcribeが生成した文字起こし結果（Transcription）を人間の校閲者が確認・修正するためのWebアプリケーションの要件を定義します。

校閲者は文字起こしテキストを閲覧・編集し、必要に応じて音声・動画と同期しながら内容を確認できます。修正内容は保存・管理され、校閲ワークフローを効率化します。

本アプリケーションは以下のワークフロー拡張機能も含みます：
1. 既存の Cognito User Pool を指定した繰り返しデプロイ（データ保持）
2. メディアファイルのアップロードと話者情報付き Transcription の作成
3. カスタム言語モデルを使用した Transcription 作成（オプション）
4. 修正後 Transcription のダウンロード
5. Admin・TeamLeader によるカスタム言語モデルの作成
6. TeamLeader によるメディアファイルおよび Transcription の削除

> **関連ドキュメント**: プロダクト概要・ドメインモデル・ロール/権限・ビジネスルールの「常時適用版」は steering（`.kiro/steering/product.md`）、技術スタック・コーディング規約・テスト規約は `.kiro/steering/tech.md`、ディレクトリ構成・ファイル配置ルールは `.kiro/steering/structure.md` を正とします。本書は要件（WHAT）の定義に集中します。

---

## Glossary

> 本 Glossary が、本プロジェクトの用語定義の**単一の正（single source of truth）**です。他ドキュメント（steering `product.md` 等）はここを参照します。

- **Transcription（文字起こし）**: Amazon Transcribeが生成した音声・動画の書き起こしテキストデータ。タイムスタンプ付きのセグメント（Segment）の集合として表現される。
- **Segment（セグメント）**: 文字起こしの最小単位。開始時刻・終了時刻・テキスト・話者情報を持つ。
- **Reviewer（校閲者）**: 文字起こし結果を確認・修正する人間のユーザー。
- **Review（校閲）**: Reviewerが文字起こし内容を確認し、誤りを修正する作業。
- **Correction（修正）**: Reviewerが加えた文字起こしテキストまたは話者情報への変更内容。
- **MediaFile（メディアファイル）**: 文字起こしの元となる音声または動画ファイル。
- **ReviewSession（校閲セッション）**: 一つのTranscriptionに対するReviewの作業単位。
- **TranscriptionJob（文字起こしジョブ）**: Amazon Transcribeが実行した文字起こし処理の単位。
- **App（アプリケーション）**: 本Webアプリケーション全体を指す。
- **Editor（エディタ）**: テキスト編集機能を提供するUIコンポーネント。
- **MediaPlayer（メディアプレイヤー）**: 音声・動画を再生するUIコンポーネント。
- **Storage（ストレージ）**: 修正内容やReviewSessionを永続化するバックエンドの保存機構。
- **SuggestionCandidate（修正候補）**: Reviewerに提示される修正テキストの候補。過去のCorrection履歴または外部APIから生成される。
- **CorrectionHistory（修正履歴）**: 過去のReviewSessionで記録されたCorrectionの集合。SuggestionCandidateの生成に利用される。
- **ExternalSuggestionAPI（外部候補API）**: Amazon ComprehendやLLMなど、SuggestionCandidateを生成する外部サービス。
- **User（ユーザー）**: Appに登録されたReviewerまたは管理者アカウント。外部認証基盤（Amazon CognitoまたはOAuth）で認証される。
- **Admin（管理者）**: ユーザーの登録・管理、ReviewSessionの割り当て、しきい値設定などの管理操作を行う権限を持つUser。
- **ReviewAssignment（レビュー割り当て）**: 特定のReviewSessionを特定のUserに割り当てる設定。
- **ConsensusThreshold（合意しきい値）**: 正答を自動確定するために必要な同一回答の割合または人数。Adminが設定する。
- **ConsensusResult（合意結果）**: 複数UserのCorrectionを集計し、ConsensusThresholdを超えた回答として確定したテキスト。
- **ConflictResolution（競合解決）**: ConsensusThresholdを超えなかった場合にAdminが手動で最終回答を選択するプロセス。
- **ContributorScore（コントリビュータースコア）**: Userの回答数と正答率を掛け合わせて算出した総合スコア。ランキングの基準となる。
- **ContributorRanking（コントリビューターランキング）**: ContributorScoreに基づいてUserを順位付けした一覧。全期間または指定期間で集計できる。
- **AccuracyRate（正答率）**: Userが確定したCorrectionのうち、ConsensusResultと一致した割合（パーセンテージ）。
- **Team（チーム）**: 複数のUserをグループ化した単位。ReviewSessionはチーム単位で割り当てられる。Userは複数のTeamに所属できる。
- **TeamLeader（チームリーダー）**: 自チームのメンバー管理およびReviewAssignmentを行う権限を持つUser。
- **TeamAssignment（チーム割り当て）**: ReviewSessionを特定のTeamに割り当てる設定。TeamのすべてのメンバーがそのReviewSessionにアクセスできる。
- **IPAllowlist（IPアドレス許可リスト）**: Appへのアクセスを許可するIPアドレスまたはCIDRブロックの一覧。Adminが管理する。
- **AuditLog（監査ログ）**: Admin・TeamLeader・Reviewerが実行した操作の記録。操作日時・実行者・操作内容・対象リソースを含む。保管期間は無期限だがAdminが任意に削除できる。
- **Developer（開発者）**: CDK を使用して App をデプロイする技術者。
- **FoundationStack（基盤スタック）**: KMS・S3・DynamoDB・Cognito を管理する CDK スタック。
- **CognitoUserPool（Cognito ユーザープール）**: Amazon Cognito のユーザー認証基盤。
- **SpeakerDiarization（話者分離）**: Amazon Transcribe が音声内の異なる話者を識別・分離する機能。
- **CustomLanguageModel（カスタム言語モデル）**: Amazon Transcribe のカスタム言語モデル。ドメイン固有の語彙や表現を学習させることで文字起こし精度を向上させる。
- **CorrectedTranscription（修正後 Transcription）**: ConsensusResult に基づいて確定された最終的な文字起こしテキスト。
- **PresignedURL（署名付き URL）**: S3 へのファイルアップロードまたはダウンロードのために一時的に発行される認証済み URL。
- **CDKContext（CDK コンテキスト）**: CDK デプロイ時に指定するパラメータ群。cdk.json または --context オプションで設定する。
- **CloudFrontDistribution（CloudFront ディストリビューション）**: Amazon CloudFront のコンテンツ配信ネットワーク。Web アプリの静的ファイルを配信する。
- **BasePath（ベースパス）**: CloudFront ディストリビューション内で本アプリが使用するサブディレクトリパス。他の Web アプリとの URL 競合を回避する。
- **CdnStack（CDN スタック）**: CloudFront・WAF v2 を管理する CDK スタック。

---

## Requirements

### Requirement 1: 文字起こし結果の表示

**User Story:** Reviewerとして、Amazon Transcribeが生成した文字起こし結果を読みやすい形式で閲覧したい。そうすることで、内容を効率よく確認できる。

#### Acceptance Criteria

1. WHEN ReviewerがReviewSessionを開いたとき、THE App SHALL TranscriptionJobに紐づくすべてのSegmentをタイムスタンプ順に表示する。
2. WHILE ReviewerがReviewSessionを閲覧しているとき、THE App SHALL 各SegmentについてテキストとともにSegmentの開始時刻をHH:MM:SS形式で表示する。
3. WHERE TranscriptionJobに話者識別（Speaker Diarization）情報が含まれる場合、THE App SHALL 各Segmentに話者ラベルを表示する。
4. THE App SHALL Transcriptionのテキスト全体を一画面でスクロール可能な形式で表示する。
5. WHEN TranscriptionJobのデータ取得に失敗したとき、THE App SHALL 失敗の理由を含むエラーメッセージをReviewerに表示する。
6. WHEN ReviewerがReviewSessionを開いたとき、TranscriptionJobにSegmentが0件の場合、THE App SHALL 「文字起こし結果がありません」というメッセージを表示する。

---

### Requirement 2: テキストおよび話者情報の編集・修正

**User Story:** Reviewerとして、文字起こしテキストの誤りと話者情報の誤りをインラインで編集・修正したい。そうすることで、正確な文字起こし結果を作成できる。

#### Acceptance Criteria

1. WHEN ReviewerがSegmentのテキストをクリックしたとき、THE Editor SHALL そのSegmentのテキストを編集可能な状態にする。
2. WHILE Reviewerがテキストを編集しているとき、THE Editor SHALL 編集前の元のテキストと編集中のテキストを同時に表示する。
3. WHEN ReviewerがSegmentの編集を確定したとき、THE Editor SHALL 編集前の元のテキストと修正後のテキストの両方を含むCorrectionとして記録する。
4. WHEN ReviewerがSegmentの編集をキャンセルしたとき、THE Editor SHALL テキストを編集前の状態に戻す。
5. THE Editor SHALL 一度に複数のSegmentを同時に編集可能な状態にする。
6. WHEN ReviewerがSegmentの編集を確定したとき、テキストが変更されていない場合、THE Editor SHALL Correctionを記録しない。
7. IF Reviewerが空文字列でSegmentを確定しようとしたとき、THEN THE Editor SHALL 確認ダイアログを表示し、Reviewerが確定を選択した場合は空文字列としてCorrectionを記録し、キャンセルを選択した場合は編集状態を維持する。
8. WHEN ReviewerがSegmentの話者ラベルをクリックしたとき、THE Editor SHALL そのSegmentの話者情報を編集可能な状態にし、TranscriptionJob内の既存話者ラベルの一覧をドロップダウンで表示する。
9. WHERE TranscriptionJobに話者識別情報が含まれない場合、THE Editor SHALL 話者ラベルの編集UIを表示しない。
10. WHEN ReviewerがSegmentの話者情報を変更して確定したとき、THE Editor SHALL 変更前の話者ラベルと変更後の話者ラベルの両方を含むCorrectionとして記録する。
11. WHEN ReviewerがSegmentの話者情報の編集をキャンセルしたとき、THE Editor SHALL 話者情報を編集前の状態に戻す。
12. WHEN ReviewerがSegmentの話者情報を確定したとき、話者情報が変更されていない場合、THE Editor SHALL Correctionを記録しない。
13. THE Editor SHALL 話者ラベル管理画面を提供し、ReviewerがTranscriptionJob内の既存話者ラベルの名前を変更できるようにする。
14. WHEN Reviewerが話者ラベルの名前を変更して確定したとき、THE Editor SHALL そのTranscriptionJob内の当該話者ラベルを持つすべてのSegmentの話者情報を新しいラベル名に一括置換する。
15. WHEN Reviewerが話者ラベルの名前を変更して確定したとき、THE Editor SHALL 変更前のラベル名・変更後のラベル名・影響を受けたSegment数を含むCorrectionとして記録する。
16. WHEN Reviewerが話者ラベルの名前変更をキャンセルしたとき、THE Editor SHALL すべての話者ラベルを変更前の状態に戻す。
17. IF 変更後の話者ラベル名がTranscriptionJob内の既存ラベル名と重複するとき、THEN THE Editor SHALL 確認ダイアログを表示し、Reviewerが確定を選択した場合は2つのラベルを統合し、キャンセルを選択した場合は編集状態を維持する。
18. WHERE ReviewSession の状態が「完了」の場合、THE Editor SHALL 校閲画面を読み取り専用で表示し、Segment テキストのインライン編集・話者ラベルの追加／編集／削除・ConsensusResult 確定済みテキストの編集・ConflictResolution の操作をすべて無効化する。
19. WHERE ReviewSession の状態が「完了」の場合、THE App SHALL 修正後 Transcription のダウンロードは引き続き許可する。
20. IF ReviewSession の状態が「完了」のときに Correction の作成・更新・削除、話者ラベルの変更、または ConflictResolution の操作が App へリクエストされたとき、THEN THE App SHALL 当該リクエストを拒否し、セッションが完了済みである旨のエラーメッセージを User に返す。

---

### Requirement 3: 修正内容の保存・管理

**User Story:** Reviewerとして、加えた修正内容を保存・管理したい。そうすることで、作業を中断・再開でき、修正履歴を追跡できる。

#### Acceptance Criteria

1. WHEN ReviewerがSegmentの編集を確定したとき、THE Storage SHALL CorrectionをISO 8601 UTC形式のタイムスタンプとともに永続化する。
2. WHEN ReviewerがReviewSession内で最初のCorrectionを確定したとき、THE App SHALL ReviewSessionの進捗状態を「未着手」から「進行中」に更新する。
3. WHEN ReviewerがReviewSessionを再度開いたとき、THE App SHALL 以前に保存されたCorrectionを復元して表示する。
4. IF Correctionの復元に失敗したとき、THEN THE App SHALL エラーメッセージをReviewerに表示し、未修正の状態でReviewSessionを開く。
5. THE App SHALL 各CorrectionについてReviewerが加えた変更前・変更後のテキストを保持する。
6. WHEN ReviewerがReviewSessionを完了としてマークしたとき、THE Storage SHALL ReviewSessionの状態を「完了」に更新する。
7. IF Storageへの保存に失敗したとき、THEN THE App SHALL エラーメッセージをReviewerに表示し、Correctionをメモリ上に保持してReviewerが手動で再試行できるようにする。
8. THE App SHALL ReviewerがセッションのCorrectionを最大50件まで元に戻す（アンドゥ）操作を提供する。

---

### Requirement 4: 音声・動画との同期再生

**User Story:** Reviewerとして、TranscriptionJobの元となった音声・動画とTranscriptionテキストを並べて確認したい。そうすることで、聞き取りにくい箇所を正確に修正できる。

#### Acceptance Criteria

1. WHEN ReviewerがReviewSessionを開いたとき、THE App SHALL MediaPlayerとTranscriptionテキストを同一画面に並べて表示する。
2. THE App SHALL デフォルトのレイアウトを左側にMediaPlayer・右側にTranscriptionテキストの左右分割とする。
3. WHEN Reviewerがレイアウトを上下分割に切り替えたとき、THE App SHALL 上部にMediaPlayer・下部にTranscriptionテキストを表示する。
4. WHEN ReviewerがMediaPlayerで再生を開始したとき、THE App SHALL Amazon CloudFront経由でMediaFileをストリーミング再生する。
5. WHEN ReviewerがMediaPlayerで音声・動画を再生したとき、THE App SHALL 現在の再生位置に対応するSegmentを100ミリ秒以内にハイライト表示を更新する。
6. WHEN ReviewerがSegmentをクリックしたとき、THE MediaPlayer SHALL そのSegmentの開始時刻にシークし、シーク前の再生状態（再生中または一時停止中）を維持する。
7. THE MediaPlayer SHALL 再生・一時停止・シーク・再生速度変更（0.5倍・1.0倍・1.25倍・1.5倍・2.0倍）の操作を提供する。
8. IF MediaFileへのアクセスに失敗したとき、THEN THE App SHALL アクセス失敗の原因を示すエラーメッセージをReviewerに表示し、MediaPlayerを非表示にし、テキスト編集機能のみを提供する。
9. WHEN MediaPlayerが再生中かつ現在ハイライトされているSegmentが画面外に出たとき、THE App SHALL そのSegmentが完全に画面内に表示されるよう自動スクロールする。
10. WHILE Reviewerがテキストを編集中のとき、THE App SHALL 自動スクロールを一時停止する。

---

### Requirement 5: ReviewSessionの一覧・管理

**User Story:** Reviewerとして、複数のReviewSessionを一覧で確認・管理したい。そうすることで、作業状況を把握し、優先度をつけて校閲を進められる。

#### Acceptance Criteria

1. THE App SHALL Reviewerがアクセス可能なすべてのReviewSessionを作成日時の降順で一覧表示する画面を提供する。
2. THE App SHALL 各ReviewSessionについてTranscriptionJobの名前・進捗状態を一覧に表示する。
3. THE App SHALL 各ReviewSessionの作成日時をYYYY-MM-DD HH:MM形式で一覧に表示する。
4. WHEN ReviewerがReviewSessionを一覧から選択したとき、THE App SHALL そのReviewSessionの校閲画面に遷移する。
5. WHEN ReviewerがフィルタリングオプションをReviewSessionの一覧画面で選択したとき、THE App SHALL 選択された進捗状態（未着手・進行中・完了）に一致するReviewSessionのみを表示する。
6. WHEN 新しいTranscriptionJobが登録されたとき、THE App SHALL 対応するReviewSessionを「未着手」状態で作成する。
7. WHEN ReviewerがReviewSessionの一覧画面を開いたとき、アクセス可能なReviewSessionが0件の場合、THE App SHALL 「校閲セッションがありません」というメッセージを表示する。
8. WHERE User が Admin または TeamLeader の権限を持つ場合、THE App SHALL ReviewSession 一覧画面において状態が「完了」の ReviewSession に対し、状態を「進行中」に戻す操作を提供する。TeamLeader は自チームに割り当てられた ReviewSession のみ操作でき、Admin はすべての ReviewSession を操作できる。
9. WHEN Admin または TeamLeader が「完了」の ReviewSession を「進行中」に戻したとき、THE App SHALL ReviewSession の状態を「進行中」に更新し、確定済みの ConsensusResult および各 Segment の確定状態（consensusStatus）は変更せずに保持する。
10. WHEN Admin または TeamLeader が ReviewSession を「進行中」に戻したとき、THE App SHALL 当該操作を AuditLog として記録する。
11. IF 状態が「完了」でない ReviewSession に対して「進行中」に戻す操作がリクエストされたとき、THEN THE App SHALL 当該リクエストを拒否し、エラーメッセージを User に返す。

---

### Requirement 6: 検索・ナビゲーション

**User Story:** Reviewerとして、文字起こしテキスト内を検索・ナビゲートしたい。そうすることで、特定の箇所を素早く見つけて修正できる。

#### Acceptance Criteria

1. THE App SHALL Transcription内のテキストをキーワード検索する機能を提供する。
2. WHEN Reviewerが検索キーワードを入力したとき、THE App SHALL キーストロークごとに大文字・小文字を区別しない部分一致でSegmentを検索し、一致するSegmentをハイライト表示し、一致件数（0件の場合は「0件一致」）を表示する。
3. WHEN Reviewerが「次へ」操作を実行したとき、THE App SHALL 現在位置の次の一致箇所に移動し、最後の一致箇所では最初の一致箇所に折り返す。WHEN Reviewerが「前へ」操作を実行したとき、THE App SHALL 現在位置の前の一致箇所に移動し、最初の一致箇所では最後の一致箇所に折り返す。
4. WHEN Reviewerが未修正フィルタを有効にしたとき、THE App SHALL Correctionが記録されていないSegmentのみを表示する。
5. WHEN Reviewerが検索キーワードをクリアしたとき、THE App SHALL ハイライト表示を解除し、すべてのSegmentを表示する。
6. WHEN 検索ハイライトと修正候補ポップアップが同時に表示される場合、THE App SHALL 修正候補ポップアップを検索ハイライトより前面に表示し、両方の情報を同時に確認できるようにする。

---

### Requirement 8: 修正候補の表示と選択

**User Story:** Reviewerとして、Segmentにホバーしたときや専用ボタンをクリックしたときに修正候補を表示してほしい。そうすることで、キーボード入力を最小限に抑えて効率よく校閲できる。

#### Acceptance Criteria

1. WHEN ReviewerがSegmentに500ミリ秒以上ホバーしたとき、THE App SHALL そのSegmentに対するSuggestionCandidateを最大5件まで取得してポップアップ形式で表示する。
2. WHEN ReviewerがSegmentの専用候補ボタンをクリックしたとき、THE App SHALL そのSegmentに対するSuggestionCandidateを最大5件まで取得してポップアップ形式で表示する。
3. THE App SHALL SuggestionCandidateをCorrectionHistoryと外部候補APIの両方から生成し、CorrectionHistoryの候補を優先した上で重複を除いて表示する。
4. WHEN ReviewerがSuggestionCandidateをクリックしたとき、THE Editor SHALL そのSegmentのテキストを選択した候補のテキストで置き換え、Correctionとして記録する。
5. WHILE SuggestionCandidateの取得中のとき、THE App SHALL ローディングインジケータをポップアップ内に表示する。
6. IF SuggestionCandidateが0件のとき、THEN THE App SHALL 「候補がありません」というメッセージをポップアップ内に表示し、Reviewerがキーボードで直接入力できるよう編集モードに移行する。
7. IF ExternalSuggestionAPIへのリクエストが失敗したとき、THEN THE App SHALL CorrectionHistoryから生成した候補のみをポップアップ内に表示し、外部APIのエラーをポップアップ内のインラインメッセージでReviewerに通知する。
8. WHEN ReviewerがSuggestionCandidateのポップアップ外をクリックしたとき、THE App SHALL ポップアップを閉じる。
9. WHEN 別のSegmentにホバーしたとき、既存のSuggestionCandidateポップアップが表示中の場合、THE App SHALL 既存のポップアップを閉じて新しいSegmentのポップアップを表示する。
10. THE App SHALL 修正候補のホバー自動表示を無効化し、専用ボタンのみで候補を表示するモードをReviewerが設定できるようにする。

---

### Requirement 9: ユーザー管理と認証

**User Story:** Adminとして、複数のReviewerをAppに登録・管理したい。そうすることで、校閲作業を複数人に割り当てて効率よく進められる。

#### Acceptance Criteria

1. THE App SHALL Amazon CognitoまたはOAuthプロバイダーを使用してUserの認証を行う。
2. WHEN AdminがUserを登録したとき、THE App SHALL そのUserにReviewer・TeamLeader・Adminのいずれかの権限を付与する。
3. WHEN AdminまたはTeamLeaderがReviewSessionにTeamAssignmentを作成したとき、THE App SHALL そのTeamの全メンバーにそのReviewSessionの閲覧およびレビュー操作へのアクセスを許可する。
4. WHEN ReviewerがAppにアクセスしたとき、THE App SHALL そのReviewerが所属するTeamにTeamAssignmentされたReviewSessionのみを一覧に表示する。
5. WHEN ReviewerがAPIまたはUIで他チームのReviewSessionにアクセスしようとしたとき、THE App SHALL そのReviewSessionの存在を含む情報を一切返さず404を返す。
6. WHEN AdminがUserを無効化したとき、THE App SHALL そのUserのリフレッシュトークンを即時に無効化し、JWTの有効期限を最大15分とすることで以降のAPIアクセスを15分以内に遮断する。
7. THE App SHALL AdminのみがUser管理・ConsensusThreshold設定の操作を実行できるよう権限を制御する。
8. WHEN Reviewer権限のUserがAdmin専用操作を実行しようとしたとき、THE App SHALL 403エラーを返し、操作を拒否する。
9. WHEN 未認証のUserがAppにアクセスしたとき、THE App SHALL ログイン画面にリダイレクトする。
10. THE App SHALL アイドル状態が30分間続いたUserのセッションを自動的にタイムアウトし、ログイン画面にリダイレクトする。
11. THE App SHALL セッションの絶対有効期限を8時間とし、8時間経過後は再認証を要求する。
12. THE App SHALL Admin権限のUserに対してMFA（多要素認証）を必須とし、ReviewerおよびTeamLeader権限のUserに対してはMFAをオプションとして提供する。

---

### Requirement 10: 多数決による正答の確定

**User Story:** Adminとして、同じSegmentを複数のReviewerにレビューさせ、最も多い回答を正答として自動または手動で確定したい。そうすることで、単一レビューより信頼性の高い文字起こし結果を得られる。

#### Acceptance Criteria

1. THE App SHALL AdminがReviewSessionを作成する際に、割り当てるReviewerの人数を指定できるようにする。
2. THE App SHALL AdminがReviewSessionを作成する際に、ConsensusThresholdを割り当てReviewer総数に対するパーセンテージ（1〜100）で設定できるようにする。
3. WHEN 割り当てられた全ReviewerがSegmentのCorrectionを確定したとき、THE App SHALL 各Segmentについて回答の集計を行う。WHERE Adminが部分集計を有効にしている場合、THE App SHALL 割り当てReviewer総数の過半数がCorrectionを確定した時点でも集計を実行できるようにする。
4. WHEN 集計の結果、同一テキストの回答の割合がConsensusThresholdを超えたとき、THE App SHALL その回答をConsensusResultとして自動的に確定し、SegmentのconsensusStatusフィールドを'CONFIRMED'に更新して記録する。
5. WHEN ConsensusResultが自動確定されたとき、THE App SHALL AdminによるConsensusResultの変更を禁止する。
6. WHEN 割り当てられた全ReviewerがSegmentのCorrectionを確定し、集計の結果いずれの回答もConsensusThresholdを超えなかったとき、THE App SHALL そのSegmentをConflictResolution待ち状態としてAdminにアプリ内通知で即時に通知する。
7. WHEN AdminがConflictResolution待ち状態のSegmentを確認したとき、THE App SHALL 各Reviewerの回答と回答数をAdminに表示する。
8. WHEN AdminがConflictResolution待ち状態（「競合解決待ち」ラベルが付いた）SegmentのみにおいてAdminが最終回答を選択したとき、THE App SHALL その回答をConsensusResultとして記録する。
9. THE App SHALL 各Segmentに「確定済み」「未確定」「競合解決待ち」のいずれかのラベルを表示し、状態を区別する。
10. WHEN ReviewerがSegmentのCorrectionを確定したとき、THE App SHALL そのReviewerの回答をUI・データ取得API・DynamoDBアクセスパターンのすべてのレイヤーで他のReviewerから隠蔽し、相互影響を防ぐ。
11. WHILE ReviewerがSegmentのCorrectionを確定した後、THE App SHALL そのSegmentについて匿名化された進捗情報をReviewerに表示する。割り当てReviewer数が5名以上の場合は「あと何人が回答待ち」と具体的人数を表示し、5名未満の場合は「まだ回答が集まっています」と表示して個人の特定を防ぐ。

---

### Requirement 12: コントリビューターランキング

**User Story:** Reviewerとして、自分の貢献度を他のユーザーと比較したランキングを確認したい。そうすることで、モチベーションを維持しながら積極的に校閲作業に取り組める。

#### Acceptance Criteria

1. THE App SHALL すべてのUserがContributorRankingを閲覧できる画面を提供する。
2. THE App SHALL ContributorScoreを「ConsensusResultが確定済みのSegmentに対する回答数 × 正答率（%）/ 100」の式で算出する。
3. THE App SHALL ContributorRankingをContributorScoreの降順で表示し、スコアが同一の場合は回答数の多い順を優先する。
4. THE App SHALL ContributorRankingのデフォルト表示を全期間の累積ContributorScoreで行う。
5. WHEN Userが期間フィルタを選択したとき、THE App SHALL 選択した期間（今月：月初00:00から現在・今年：年初00:00から現在・直近30日・直近90日・全期間）内のConsensusResult確定済みデータのみでContributorScoreを再計算してランキングを更新する。
6. THE App SHALL 各UserのContributorRankingエントリに順位・ユーザー名・回答数・正答率・ContributorScoreを表示する。
7. WHEN UserがContributorRankingを閲覧したとき、THE App SHALL 自分自身のエントリを視覚的に強調表示する。
8. WHEN ログイン中のUserがランキング圏外かつ有効なContributorScoreを持つ場合、THE App SHALL ランキング一覧の末尾にそのUserのエントリを順位とともに追加表示する。
9. WHEN ConsensusResultが確定したとき、THE App SHALL 関連するUserのContributorScoreを24時間以内に更新する。
10. WHILE ConsensusResultが未確定のSegmentのCorrectionは、THE App SHALL AccuracyRateおよびContributorScoreの計算対象に含めない。
11. WHEN 有効な（ConsensusResult確定済みデータに基づく）ContributorScoreを持つUserが0件のとき、THE App SHALL 「まだランキングデータがありません」というメッセージを表示する。
12. THE App SHALL ContributorRankingの表示範囲をAdminが設定できるようにする（全ユーザー表示・チーム内のみ表示・上位N名のみ表示）。

---

### Requirement 13: チーム管理とチームベースアクセス制御

**User Story:** Adminとして、ユーザーをチームに分けてTranscriptionへのアクセスをチーム単位で制御したい。そうすることで、機密情報を含むTranscriptionを適切なチームのみに限定して公開できる。

#### Acceptance Criteria

1. IF UserがAdminまたはTeamLeaderの権限を持つとき、THEN THE App SHALL そのUserがTeamを作成・編集・削除できる管理画面を提供する。
2. WHEN AdminまたはTeamLeaderがUserをTeamに追加したとき、THE App SHALL そのUserにそのTeamのTeamAssignmentされたReviewSessionへのアクセスを付与する。
3. THE App SHALL 1人のUserが複数のTeamに同時に所属できるようにする。
4. WHEN AdminまたはTeamLeaderがReviewSessionにTeamAssignmentを作成したとき、THE App SHALL そのTeamの全メンバーがそのReviewSessionにアクセスできるようにする。
5. WHEN AdminまたはTeamLeaderがTeamAssignmentを削除したとき、THE App SHALL そのTeamのメンバーのうち他のTeamAssignmentおよびReviewAssignmentを持たないUserの次のアクセス試行時点でアクセスを無効にする。
6. WHEN ReviewerがReviewSessionの一覧を取得したとき、THE App SHALL そのReviewerが所属するTeamにTeamAssignmentされたReviewSessionのみを返し、他チームのReviewSessionの存在を含む情報を一切含めない。
7. WHEN ReviewerがAPIまたはUIで自分のTeamに割り当てられていないReviewSessionにアクセスしようとしたとき、THE App SHALL そのReviewSessionの存在を示す情報を一切返さない。
8. WHEN TeamLeaderが自チーム内のUserにReviewAssignmentを作成したとき、THE App SHALL そのUserにそのReviewSessionへの個別アクセスを付与し、TeamAssignmentが削除された後もそのReviewAssignmentによるアクセスを維持する。WHEN Userがすべての Team メンバーシップを失った（いずれの Team にも所属しなくなった）とき、THE App SHALL そのUserの個別ReviewAssignmentによるアクセスを取り消す。
9. WHEN TeamLeaderが自チーム外のTeamまたはUserに対する操作を実行しようとしたとき、THE App SHALL 操作を拒否し、権限エラーをTeamLeaderに返す。
10. WHEN AdminがTeamを削除したとき、THE App SHALL そのTeamのTeamAssignmentをすべて削除し、他のTeamAssignmentおよびReviewAssignmentを持たないメンバーの次のアクセス試行時点でReviewSessionへのアクセスを無効にする。

---

### Requirement 14: インフラストラクチャとセキュリティ

**User Story:** Adminとして、すべてのリソースとデータをAWS ap-northeast-1リージョンに限定し、アクセス元IPアドレスを制限したい。そうすることで、データの地理的管理とネットワークレベルのセキュリティを確保できる。

#### Acceptance Criteria

1. THE App SHALL すべてのAWSリソース（コンピューティング・ストレージ・データベース・認証・CDN・その他マネージドサービス）をap-northeast-1リージョンにのみデプロイする。
2. THE App SHALL すべてのユーザーデータ・TranscriptionデータおよびMediaFileをap-northeast-1リージョン外に転送・複製しない。
3. THE App SHALL AdminがIPAllowlistをCIDRブロック形式で最大1,000件まで追加・編集・削除できる管理画面を提供する。
4. WHEN AdminがIPAllowlistにエントリを追加または削除したとき、THE App SHALL 変更を30分以内にすべてのアクセス制御ポイントに反映する。
5. IF IPAllowlistが1件以上設定されているとき、THEN THE App SHALL IPAllowlistに含まれないIPアドレスからのすべてのHTTP/HTTPSリクエストを拒否する。IF IPAllowlistのチェック機構自体が失敗または利用不可のとき、THEN THE App SHALL リクエストを拒否する（fail-closed）。
6. IF IPAllowlistが0件のとき、THEN THE App SHALL IPアドレスによるアクセス制限を適用しない。最初のエントリが追加されてから完全に反映されるまでの伝播期間中は、THE App SHALL すべてのリクエストを許可し続ける。
7. WHEN IPAllowlistに含まれないIPアドレスからアクセスがあったとき、THE App SHALL アクセスを拒否し、IP制限による拒否であることを示すエラーレスポンスを返す。
8. THE App SHALL 以下の操作をAuditLogとして記録する：IPAllowlistの変更（Admin）・User管理操作（Admin）・Team管理操作（Admin・TeamLeader）・ReviewAssignmentおよびTeamAssignmentの作成・削除（Admin・TeamLeader）・ReviewSessionの完了マーク（TeamLeader・Reviewer）・ConsensusResultの手動確定（Admin）・Correctionの確定（Reviewer）・話者ラベルの変更（Reviewer）・ログイン失敗（認証エラー）・AuditLogの削除操作自体（Admin）。
9. THE App SHALL AuditLogの各エントリに操作日時（ISO 8601 UTC）・実行者のユーザーID・実行者の権限ロール・基準8の列挙値を一意に識別できる操作種別・対象リソースのIDを記録する。
10. THE App SHALL AuditLogをAdminによる明示的な削除操作を除き無期限に保管する。
11. IF UserがAdmin権限を持つとき、THEN THE App SHALL AuditLogを閲覧・検索（期間・実行者・操作種別でフィルタリング）できる画面を提供し、検索結果を1ページ最大100件のページネーション形式で表示する。
12. WHEN AdminがAuditLogの削除を実行したとき、THE App SHALL 基準11の検索フィルタ（期間・実行者・操作種別）で指定した条件に一致するAuditLogエントリを削除し、削除操作自体をAuditLogに記録する（削除者・削除対象件数・削除条件を含む）。
13. WHEN AdminがAuditLogの削除を実行しようとしたとき、THE App SHALL 削除対象の件数と操作が不可逆であることを確認ダイアログで表示し、Adminが確定を選択した場合のみ削除を実行する。
14. IF AuditLogの削除処理が失敗したとき、THEN THE App SHALL エラーメッセージをAdminに表示し、削除対象のAuditLogエントリを保持する。
15. IF AdminがCIDRブロック形式として無効な文字列をIPAllowlistに追加しようとしたとき、THEN THE App SHALL エントリを拒否し、無効な形式であることを示すエラーメッセージをAdminに表示する。
16. THE App SHALL すべてのクライアント・サーバー間通信をTLS 1.2以上で暗号化する。
17. THE App SHALL APIエンドポイントにレートリミットを設定する：認証エンドポイントは1IPあたり5回/分、一般APIエンドポイントは1ユーザーあたり100回/分とする。
18. THE App SHALL Cognito User Pool の `custom:role` カスタム属性をユーザー自身による変更を禁止（read-only）に設定し、Admin API 経由でのみ変更可能とする。
19. THE App SHALL JWT トークンをブラウザのメモリ（JavaScript 変数）に保持し、localStorage・sessionStorage・Cookie には保存しない。RefreshToken のみ httpOnly Cookie または Cognito SDK のセキュアストレージに保持する。
20. THE App SHALL フロントエンドで `dangerouslySetInnerHTML` を使用せず、すべてのユーザー入力テキスト（originalText・afterText・検索キーワード）を React のデフォルトエスケープ機構で表示する。検索ハイライトの実装は DOM テキストノードの分割とスパン要素の挿入で行い、innerHTML を使用しない。
21. THE App SHALL すべての S3 バケットに対して BlockPublicAccess（BlockPublicAcls・IgnorePublicAcls・BlockPublicPolicy・RestrictPublicBuckets）を全て有効に設定する。
22. THE App SHALL AuditLog の metadata フィールドに記録する値を、許可されたキー（resourceName・previousValue・newValue・count・reason）のみに制限し、値は文字列型で最大1000文字に切り詰める。
23. THE App SHALL Cognito Advanced Security Features（適応型認証）を有効にし、リスクベースの認証チャレンジ（異常なログインパターン検出時の追加認証要求）を適用する。
24. THE App SHALL マルウェアスキャン完了前（scanStatus が PENDING）のメディアファイルに対して、CloudFront Signed URL の生成を拒否し、S3 バケットポリシーで Lambda スキャン関数以外からの GetObject を禁止する。

---

### Requirement 11: アクセシビリティ・ユーザビリティ

**User Story:** Reviewerとして、効率よく校閲作業を行えるインターフェースを使いたい。そうすることで、長時間の作業でも生産性を維持できる。

#### Acceptance Criteria

1. THE App SHALL 以下のキーボードショートカットを提供する：スペースキーで再生・一時停止、Tabキーで次のSegmentに移動、Shift+Tabキーで前のSegmentに移動、Ctrl+Z（Mac: Cmd+Z）でアンドゥ、Ctrl+Enter（Mac: Cmd+Enter）で編集確定、Escキーで編集キャンセル、Ctrl+F（Mac: Cmd+F）で検索バーにフォーカス。
2. THE App SHALL WCAG 2.1 AAレベルのアクセシビリティ基準に準拠したUIをすべての主要画面で提供する。
3. THE App SHALL Chrome・Firefox・Safari・Edgeの各ブラウザのリリースから1年以内のバージョンで動作する。
4. WHEN ReviewerがReviewSessionを初回ロードしたとき、THE App SHALL 最初のSegmentを3秒以内に表示する。Segmentが即時に表示される場合はローディングインジケータの表示は不要とする。
5. THE App SHALL 日本語テキストの入力・表示・編集において、文字化けなく正確に表示し、IMEによる日本語入力を正しく処理できる。
6. THE App SHALL デスクトップブラウザ（横幅1024px以上）を主要ターゲットとし、タブレット（横幅768px以上）では閲覧・簡易編集が可能なレスポンシブレイアウトを提供する。モバイル（横幅768px未満）はサポート対象外とする。
7. THE App SHALL セッション一覧・監査ログ・ランキングなどのリスト系画面において、1ページあたり最大50件のページネーションを提供し、ページ番号ナビゲーションまたは「次へ/前へ」ボタンで遷移できるようにする。
8. WHEN アイドルタイムアウト（30分）の残り5分前になったとき、THE App SHALL 「セッションがまもなく期限切れになります。続行しますか？」という警告通知をReviewerに表示し、Reviewerが「続行」を選択した場合はアイドルタイマーをリセットする。
9. THE App SHALL 編集中のテキストをlocalStorageに5秒間隔で自動保存し、ブラウザクラッシュまたは予期しない終了後にReviewSessionを再度開いた際に未確定の編集内容を復元するかどうかをReviewerに確認する。
10. WHEN ネットワーク接続が切断されたとき、THE App SHALL 未保存のCorrectionをローカルキュー（IndexedDB）に蓄積し、接続復帰時に自動的にサーバーへ同期する。同期中はステータスバーに「同期中...」と表示し、同期完了後に「同期完了」と表示する。
11. WHEN ネットワーク接続が切断されたとき、THE App SHALL 画面上部に「オフライン」バナーを表示し、接続復帰時にバナーを自動的に非表示にする。

---

### Requirement 15: 既存 Cognito User Pool を使用した繰り返しデプロイ

**User Story:** Developer として、デプロイ時に既存の Cognito User Pool を指定してデプロイしたい。そうすることで、ユーザー情報・メディアファイル・カスタム言語モデルなどのデータを保持したまま、何度も繰り返しデプロイできる。

#### Acceptance Criteria

1. WHERE CDKContext に `cognitoUserPoolId` が指定されている場合、THE FoundationStack SHALL 新しい CognitoUserPool を作成せず、指定された既存の CognitoUserPool をインポートして使用する。
2. WHERE CDKContext に `cognitoUserPoolId` が空文字列または未指定の場合、THE FoundationStack SHALL 新しい CognitoUserPool を作成する。
3. WHEN Developer が既存の CognitoUserPool を指定してデプロイしたとき、THE FoundationStack SHALL DynamoDB テーブル・S3 バケット・KMS キーの既存データを変更せずにデプロイを完了する。
4. WHEN Developer が既存の CognitoUserPool を指定してデプロイしたとき、THE FoundationStack SHALL インポートした CognitoUserPool の UserPoolId と UserPoolClientId を CloudFormation Output として出力する。
5. WHERE CDKContext に `cognitoUserPoolClientId` が指定されている場合、THE FoundationStack SHALL 新しい UserPoolClient を作成せず、指定された既存の UserPoolClient を使用する。
6. WHERE CDKContext に `cognitoUserPoolClientId` が空文字列または未指定の場合かつ `cognitoUserPoolId` が指定されている場合、THE FoundationStack SHALL 指定された CognitoUserPool に新しい UserPoolClient を作成する。

---

### Requirement 16: メディアファイルのアップロード

**User Story:** User として、メディアファイル（音声・動画）を App にアップロードしたい。そうすることで、そのメディアファイルから Transcription を作成できる。

#### Acceptance Criteria

1. WHEN User がメディアファイルのアップロードをリクエストしたとき、THE App SHALL S3 への PresignedURL を生成して User に返す。
2. WHEN User が PresignedURL を使用してメディアファイルを S3 にアップロードしたとき、THE App SHALL アップロード完了を検知し、メディアファイルのメタデータ（ファイル名・サイズ・Content-Type・アップロード日時・アップロードユーザーID）を DynamoDB に記録する。
3. THE App SHALL アップロード可能なファイル形式を音声（mp3, wav, flac, ogg, m4a, amr, webm）および動画（mp4, webm, mkv, avi, mov）に制限する。
4. IF User がサポートされていないファイル形式をアップロードしようとしたとき、THEN THE App SHALL アップロードを拒否し、サポートされるファイル形式の一覧を含むエラーメッセージを User に表示する。
5. THE App SHALL アップロード可能なファイルサイズの上限を 2GB とする。
6. IF User が 2GB を超えるファイルをアップロードしようとしたとき、THEN THE App SHALL アップロードを拒否し、ファイルサイズ上限を含むエラーメッセージを User に表示する。
7. THE App SHALL PresignedURL の有効期限を300秒（5分）とする。
8. WHEN User がメディアファイルをアップロードしたとき、THE App SHALL そのメディアファイルを S3 の `media/{sessionId}/{filename}` パスに保存する。
9. WHILE User がメディアファイルをアップロード中のとき、THE App SHALL アップロード進捗をパーセンテージ表示のプログレスバーで表示する。
10. WHEN User がメディアファイルのアップロードを完了したとき、THE App SHALL アップロードされたファイルに対してマルウェアスキャンを実行し、マルウェアが検出された場合はファイルを隔離してUserにエラーメッセージを表示する。

---

### Requirement 17: 話者情報付き Transcription の作成

**User Story:** User として、アップロードしたメディアファイルから話者情報を付与した Transcription を作成したい。そうすることで、誰が何を話したかを区別した文字起こし結果を得られる。

#### Acceptance Criteria

1. WHEN User が Transcription 作成をリクエストしたとき、THE App SHALL Amazon Transcribe の StartTranscriptionJob API を呼び出し、TranscriptionJob を開始する。
2. THE App SHALL TranscriptionJob の設定で ShowSpeakerLabels を true に設定し、話者分離を有効にする。
3. THE App SHALL TranscriptionJob の設定で MaxSpeakerLabels を User が指定した値（2〜10）に設定する。
4. IF User が MaxSpeakerLabels を指定しなかったとき、THEN THE App SHALL デフォルト値として 2 を使用する。
5. IF User が MaxSpeakerLabels に有効範囲外の値（2 未満または 10 超）を指定したとき、THEN THE App SHALL リクエストを拒否し、有効範囲（2〜10）を含むエラーメッセージを User に返す。
6. THE App SHALL TranscriptionJob の言語コードとして ja-JP（日本語）をデフォルトとし、User が他の言語コードを選択できるようにする。
7. WHEN TranscriptionJob が完了したとき、THE App SHALL Transcribe の出力結果を取得し、Segment データ（開始時刻・終了時刻・テキスト・話者ラベル）として DynamoDB に保存する。
8. WHEN TranscriptionJob が完了したとき、THE App SHALL 対応する ReviewSession を「未着手」状態で自動作成する。IF ReviewSession の作成に失敗したとき、THE App SHALL TranscriptionJob の結果は保持し、ReviewSession が未作成であることを User に通知する（User は手動で ReviewSession を作成できる）。
9. IF TranscriptionJob が失敗したとき、THEN THE App SHALL 失敗の理由を含むエラーメッセージを User に表示し、TranscriptionJob のステータスを「失敗」として記録する。
10. WHILE TranscriptionJob が処理中のとき、THE App SHALL TranscriptionJob のステータス（処理中・完了・失敗）を5秒間隔のポーリングで取得しUserに表示する。
11. THE App SHALL TranscriptionJob の出力結果を S3 の `transcriptions/{jobId}/output.json` パスに保存する。

---

### Requirement 18: カスタム言語モデルを使用した Transcription 作成

**User Story:** User として、Transcription を作成する際にカスタム言語モデルを使用したい。そうすることで、ドメイン固有の語彙や表現を正確に文字起こしできる。

#### Acceptance Criteria

1. WHERE User が Transcription 作成時にカスタム言語モデルを選択した場合、THE App SHALL TranscriptionJob の設定で LanguageModelName パラメータに選択されたモデル名を指定する。
2. WHERE User が Transcription 作成時にカスタム言語モデルを選択しなかった場合、THE App SHALL LanguageModelName パラメータを指定せずに TranscriptionJob を開始する。
3. WHEN User が Transcription 作成画面を開いたとき、THE App SHALL 利用可能なカスタム言語モデルの一覧を Amazon Transcribe の ListLanguageModels API から取得して表示する。
4. THE App SHALL カスタム言語モデルの一覧にステータスが COMPLETED のモデルをすべて表示する。
5. IF 利用可能なカスタム言語モデルが 0 件のとき、THEN THE App SHALL カスタム言語モデル選択欄を「利用可能なモデルなし」と表示し、モデルなしで Transcription を作成できるようにする。

---

### Requirement 19: 修正後 Transcription のダウンロード

**User Story:** User として、修正後の Transcription をファイルとしてダウンロードしたい。そうすることで、修正結果を他のシステムやワークフローで利用できる。

#### Acceptance Criteria

1. WHEN User が修正後 Transcription のダウンロードをリクエストしたとき、THE App SHALL ConsensusResult が確定済みの Segment のテキストを結合して修正後 Transcription を生成する。
2. THE App SHALL 修正後 Transcription を JSON 形式でダウンロード可能にする。
3. THE App SHALL 修正後 Transcription を SRT（SubRip Subtitle）形式でダウンロード可能にする。
4. THE App SHALL JSON 形式の修正後 Transcription に各 Segment の開始時刻・終了時刻・テキスト・話者ラベルを含める。
5. THE App SHALL SRT 形式の修正後 Transcription に各 Segment のシーケンス番号・タイムコード（HH:MM:SS,mmm --> HH:MM:SS,mmm）・テキストを含める。
6. WHERE SRT 形式で話者ラベルが存在する場合、THE App SHALL 各 Segment のテキストの先頭に「[話者ラベル] 」を付与する。
7. IF ConsensusResult が確定済みの Segment が 0 件のとき、THEN THE App SHALL ダウンロードを拒否し、「確定済みの Segment がありません」というエラーメッセージを User に表示する。
8. WHEN User がダウンロード形式を選択したとき、THE App SHALL 選択された形式でファイルを生成し、ブラウザのダウンロード機能を通じて User に提供する。
9. THE App SHALL ダウンロードファイル名を `{ReviewSession名}_{ダウンロード日時YYYYMMDD}.{拡張子}` 形式とする。

---

### Requirement 20: カスタム言語モデルの作成

**User Story:** Admin または TeamLeader として、修正後の Transcription に基づいてカスタム言語モデルを作成したい。そうすることで、今後の Transcription の精度を向上させられる。

#### Acceptance Criteria

1. IF User が Admin または TeamLeader の権限を持つとき、THEN THE App SHALL カスタム言語モデル作成機能へのアクセスを許可する。
2. IF User が Reviewer の権限のみを持つとき、THEN THE App SHALL カスタム言語モデル作成機能へのアクセスを拒否し、403 エラーを返す。
3. WHEN Admin または TeamLeader がカスタム言語モデルの作成をリクエストしたとき、THE App SHALL ConsensusResult が確定済みの Segment テキストからトレーニングデータを生成する。
4. WHEN Admin または TeamLeader がカスタム言語モデルの作成をリクエストしたとき、THE App SHALL Amazon Transcribe の CreateLanguageModel API を呼び出し、モデル作成を開始する。
5. THE App SHALL カスタム言語モデルの BaseModelName として User が選択した値（NarrowBand または WideBand）を使用する。
6. THE App SHALL トレーニングデータを S3 の `training-data/{modelName}/training.txt` パスにテキストファイルとして保存する。
7. WHILE カスタム言語モデルの作成が処理中のとき、THE App SHALL モデルのステータス（IN_PROGRESS・COMPLETED・FAILED）を User に表示する。
8. IF カスタム言語モデルの作成が失敗したとき、THEN THE App SHALL 失敗の理由を含むエラーメッセージを User に表示する。
9. IF カスタム言語モデル作成ワークフロー中に API エラーまたはバリデーションエラーが発生したとき、THEN THE App SHALL エラーの内容を含むエラーメッセージを User に表示する。
10. THE App SHALL カスタム言語モデル作成時に User がモデル名を指定できるようにする。
11. IF 指定されたモデル名がリクエスト時点で取得した既存モデル名一覧と大文字・小文字を区別した完全一致で重複するとき、THEN THE App SHALL モデル作成を拒否し、モデル名が重複していることを示すエラーメッセージを User に表示する。
12. WHEN カスタム言語モデルの作成が完了したとき、THE App SHALL AuditLog にモデル作成操作（実行者・モデル名・使用した ReviewSession の一覧）を記録する。

---

### Requirement 21: メディアファイルおよび Transcription の削除

**User Story:** TeamLeader として、ユーザーがアップロードしたメディアファイルとユーザーが作成した Transcription を削除したい。そうすることで、不要なデータを整理し、ストレージコストを管理できる。

#### Acceptance Criteria

1. IF User が TeamLeader または Admin の権限を持つとき、THEN THE App SHALL メディアファイルおよび Transcription の削除機能へのアクセスを許可する。
2. IF User が Reviewer の権限のみを持つとき、THEN THE App SHALL 削除機能へのアクセスを拒否し、403 エラーを返す。
3. WHEN TeamLeader がメディアファイルの削除をリクエストしたとき、THE App SHALL 削除対象のファイル名と操作が不可逆であることを確認ダイアログで表示し、TeamLeader が確定を選択した場合のみ削除を実行する。
4. WHEN TeamLeader がメディアファイルの削除を確定したとき、THE App SHALL S3 からメディアファイルオブジェクトを削除し、DynamoDB から対応するメタデータレコードを削除する。
5. WHEN TeamLeader が Transcription の削除をリクエストしたとき、THE App SHALL 削除対象の ReviewSession 名と関連データ（Segment・Correction・ConsensusResult）がすべて削除されることを確認ダイアログで表示し、TeamLeader が確定を選択した場合のみ削除を実行する。
6. WHEN TeamLeader が Transcription の削除を確定したとき、THE App SHALL S3 から Transcription 出力ファイルを削除し、DynamoDB から ReviewSession・Segment・Correction・ConsensusResult の全レコードを削除する。
7. WHEN TeamLeader がメディアファイルまたは Transcription を削除したとき、THE App SHALL AuditLog に削除操作（実行者・削除対象のリソース ID・リソース種別）を記録する。
8. IF 削除処理が失敗したとき、THEN THE App SHALL エラーメッセージを TeamLeader に表示し、削除が完了しなかったデータを保持する（部分的に削除されたデータは復元しない）。
9. IF 削除処理が部分的に完了した状態で失敗したとき、THEN THE App SHALL 部分削除状態をAuditLogに記録し、Adminに不整合データの存在を通知する。
10. WHEN TeamLeader が自チームに割り当てられていない ReviewSession のメディアファイルまたは Transcription を削除しようとしたとき、THE App SHALL 操作を拒否し、権限エラーを TeamLeader に返す。
11. WHEN TeamLeader がメディアファイルを削除したとき、THE App SHALL そのメディアファイルに紐づく ReviewSession が存在する場合、ReviewSession の MediaFile 参照を無効化し、MediaPlayer を非表示にする。


---

### Requirement 22: CloudFront ディストリビューションによる Web アプリ配信

**User Story:** Developer として、Web アプリを CloudFront ディストリビューション経由で配信したい。また、既存の CloudFront ディストリビューションを指定してデプロイできるようにしたい。そうすることで、既存のインフラを再利用し、複数の Web アプリが同一ディストリビューションを共有する環境でも URL 競合なく運用できる。

#### Acceptance Criteria

1. THE CdnStack SHALL Web アプリの静的ファイル（HTML・CSS・JavaScript・アセット）を CloudFrontDistribution 経由で配信する。
2. WHERE CDKContext に `cloudFrontDistributionId` が指定されている場合、THE CdnStack SHALL 新しい CloudFrontDistribution を作成せず、指定された既存の CloudFrontDistribution をインポートして使用する。
3. WHERE CDKContext に `cloudFrontDistributionId` が空文字列または未指定の場合、THE CdnStack SHALL 新しい CloudFrontDistribution を作成する。
4. WHERE CDKContext に `basePath` が指定されている場合、THE CdnStack SHALL Web アプリの静的ファイルを S3 バケット内の指定された BasePath サブディレクトリに配置し、CloudFrontDistribution のオリジンパスを BasePath に設定する。
5. WHERE CDKContext に `basePath` が空文字列または未指定の場合、THE CdnStack SHALL Web アプリの静的ファイルを S3 バケットのルートに配置する。
6. WHERE `basePath` が指定されている場合、THE App SHALL すべてのフロントエンドルーティングを BasePath をプレフィックスとして動作させる。
7. WHERE `basePath` が指定されている場合、THE CdnStack SHALL BasePath 配下のリクエストに対して SPA のフォールバック（index.html へのリダイレクト）を設定する。
8. WHEN Developer が既存の CloudFrontDistribution を指定してデプロイしたとき、THE CdnStack SHALL 既存の CloudFrontDistribution の他のオリジンおよびビヘイビア設定を変更しない。
9. IF CDKContext に `cloudFrontDistributionId` が指定されているが該当する CloudFrontDistribution が存在しないとき、THEN THE CdnStack SHALL デプロイを失敗させ、指定された ID の CloudFrontDistribution が見つからないことを示すエラーメッセージを出力する。
10. THE CdnStack SHALL CloudFrontDistribution のドメイン名と BasePath を CloudFormation Output として出力する。


---

### Requirement 23: Cognito ユーザー同期

**User Story:** Admin として、共有 Cognito User Pool に既存のユーザーを Cognito 自体を変更せずにアプリの DynamoDB に同期（取り込み）したい。そうすることで、他アプリケーションで既に登録済みのユーザーを本アプリに迅速に追加できる。

#### Acceptance Criteria

1. THE App SHALL Admin 権限を持つ User のみが Cognito ユーザー同期操作を実行できるよう権限を制御する。
2. IF Reviewer または TeamLeader 権限の User が同期操作を実行しようとしたとき、THEN THE App SHALL 403 エラーを返し、操作を拒否する。
3. WHEN Admin が同期リクエストを送信したとき、THE App SHALL リクエストボディから email・role・displayName を取得し、email が必須であること、role が REVIEWER・TEAM_LEADER・ADMIN のいずれかであることをバリデーションする。
4. IF email が未指定または空文字列のとき、THEN THE App SHALL バリデーションエラーを返し、メールアドレスが必須であることを通知する。
5. IF role が REVIEWER・TEAM_LEADER・ADMIN 以外の値のとき、THEN THE App SHALL バリデーションエラーを返し、有効なロール値の一覧を含むエラーメッセージを返す。
6. WHEN Admin が有効な同期リクエストを送信したとき、THE App SHALL 指定された email のユーザーが Cognito User Pool に存在するかを AdminGetUser API で確認する。
7. IF 指定された email のユーザーが Cognito User Pool に存在しないとき、THEN THE App SHALL 404 エラーを返し、Cognito にユーザーが見つからないことを通知する。
8. IF 指定された email のユーザーが既に DynamoDB に登録されているとき、THEN THE App SHALL バリデーションエラーを返し、既に登録済みであることを通知する。
9. WHEN Cognito にユーザーが存在し DynamoDB に未登録のとき、THE App SHALL DynamoDB にユーザーレコード（userId・email・displayName・role）を作成する。
10. THE App SHALL displayName の決定を以下の優先順位で行う：リクエストで指定された displayName → Cognito ユーザー属性の displayName → email のローカルパート（@より前）。
11. WHEN ユーザー同期が成功したとき、THE App SHALL AuditLog に同期操作（実行者・対象ユーザーの email・操作種別 USER_MANAGEMENT）を記録する。
12. THE App SHALL Cognito User Pool のユーザー属性・パスワード・MFA 設定を一切変更しない（読み取り専用の参照のみ）。

---

### Requirement 24: 現在のユーザープロフィール取得

**User Story:** 認証済み User として、自身のプロフィール情報（userId・email・displayName・role）を取得したい。そうすることで、フロントエンドがロールベースの UI レンダリングを行える。

#### Acceptance Criteria

1. WHEN 認証済み User が自身のプロフィール取得をリクエストしたとき、THE App SHALL DynamoDB からそのユーザーのレコードを取得し、userId・email・displayName・role を返す。
2. THE App SHALL 共有 Cognito User Pool の JWT に custom:role クレームが含まれない環境でも、DynamoDB のユーザーレコードからロール情報を正しく返す。
3. IF 認証済みユーザーに対応する DynamoDB レコードが存在しないとき、THEN THE App SHALL 404 エラーを返し、ユーザープロフィールが見つからないことを通知する。
4. THE App SHALL 認証トークンが有効であれば、すべてのロール（Reviewer・TeamLeader・Admin）のユーザーがプロフィール取得を実行できるようにする。
5. IF 認証トークンが無効または期限切れのとき、THEN THE App SHALL 401 エラーを返し、再認証を要求する。

---

### Requirement 25: メディアファイル一覧の取得

**User Story:** User として、アップロード済みのメディアファイルの一覧を確認したい。そうすることで、既存のメディアファイルを把握し、Transcription 作成対象を選択できる。

#### Acceptance Criteria

1. WHEN 認証済み User がメディアファイル一覧を取得したとき、THE App SHALL DynamoDB からメディアファイルのメタデータ一覧を返す。
2. THE App SHALL メディアファイル一覧の各エントリにファイル名・ファイルサイズ・Content-Type・アップロード日時・アップロードユーザー ID を含める。
3. THE App SHALL メディアファイル一覧をアップロード日時の降順で返す。
4. THE App SHALL 認証トークンが有効であれば、すべてのロール（Reviewer・TeamLeader・Admin）のユーザーがメディアファイル一覧を取得できるようにする。
5. WHEN メディアファイルが 0 件のとき、THE App SHALL 空の配列を返す。
6. IF メディアファイル一覧の取得に失敗したとき、THEN THE App SHALL エラーメッセージを User に返す。

---

### Requirement 26: E2E テスト基盤

**User Story:** Developer として、デプロイ済み環境に対して Playwright E2E テストを実行したい。そうすることで、インフラ変更後のアプリケーション全体の動作を自動検証できる。

#### Acceptance Criteria

1. THE App SHALL `e2e-test.sh` スクリプトを提供し、`$HOME` ディレクトリから E2E テストを実行できるようにする。
2. THE App SHALL `deploy-and-test.sh` スクリプトを提供し、デプロイ→シードデータ投入→テスト実行を一括で行えるようにする。
3. THE App SHALL テスト実行前に `seed-data.ts` と `seed-media-files.ts` を実行し、DynamoDB と S3 にテストデータを自動投入する。
4. THE App SHALL テストデータに `e2e-` プレフィックスを付与し、本番データと区別可能にする。
5. THE App SHALL `globalSetup` で Admin API 経由で TeamLeader と Reviewer のテストユーザーを動的に作成する。
6. THE App SHALL `globalTeardown` で作成したテストユーザーを Cognito から削除し、クリーンな状態に戻す。
7. THE App SHALL `.env` ファイル（デフォルト: `~/e2e.env`）から環境変数を読み込み、テスト対象環境を設定可能にする。
8. THE App SHALL `--skip-seed`、`--skip-install`、`--skip-deploy` オプションにより、テスト実行の各フェーズを個別にスキップ可能にする。
9. THE App SHALL `/tmp/transcription-improvement/e2e` を作業ディレクトリとして使用し、`deploy.sh` が作成したコピーを再利用する。
10. THE App SHALL テスト失敗時にレポート確認コマンドと再実行コマンドをガイダンスとして表示する。

---

### Requirement 27: E2E テストカバレッジ

**User Story:** Developer として、主要なユーザーフローが E2E テストでカバーされていることを確認したい。そうすることで、リグレッションを早期に検出できる。

#### Acceptance Criteria

1. THE App SHALL 認証フローのテスト（ログイン成功・失敗・ボタン無効化）を含む。
2. THE App SHALL ロール別ナビゲーション表示テスト（Reviewer・TeamLeader・Admin）を含む。
3. THE App SHALL セッション一覧のフィルタリング・ページネーション・遷移テストを含む。
4. THE App SHALL 校閲画面のレイアウト切替・権限別削除ボタン表示・削除確認ダイアログテストを含む。
5. THE App SHALL メディアアップロードのバリデーション・プログレス表示テストを含む。
6. THE App SHALL カスタム言語モデル管理のアクセス制御・フォームバリデーションテストを含む。
7. THE App SHALL ランキングページの期間フィルター・ユーザーハイライトテストを含む。
8. THE App SHALL 管理画面の各タブ（ユーザー・チーム・IP制限・監査ログ）操作テストを含む。
9. THE App SHALL WCAG 2.1 AA 準拠の ARIA 属性・キーボード操作・フォームラベルテストを含む。
10. THE App SHALL 全テストで aria-label・role ベースのロケータを使用し、UI テキスト変更に対して耐性を持たせる。
