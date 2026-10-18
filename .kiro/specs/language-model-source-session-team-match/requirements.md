# Requirements Document

## Introduction

CustomLanguageModel の作成時、トレーニングデータの元となるソース ReviewSession が、モデルの所属先として指定された Team に実際に割り当てられている（TeamAssignment が存在する）ことを保証するための機能である。

現状の createModel 処理は、呼び出し元が各ソース ReviewSession にアクセスできること（checkSessionAccess）のみを検証しており、指定された TeamId へのセグメント割り当て（TeamAssignment）の有無は検証していない。このため、呼び出し元がアクセス可能ではあるが指定 Team には割り当てられていない ReviewSession を元に、別 Team のモデルを作成できてしまう。

本機能では、バックエンドの LanguageModelService に TeamAssignment 一致検証を追加し、同時にフロントエンドの作成フォームで候補となる ReviewSession を選択中の Team に割り当てられたものだけに絞り込むことで、整合性のあるモデル作成体験を提供する。

本機能の利用対象ロールは Admin および TeamLeader のみである。

## Glossary

> 用語定義は `.kiro/specs/transcription-review-app/requirements.md` の Glossary を単一の正とする。本ドキュメントで参照するコア用語を以下に再掲する。

- **App（アプリケーション）**: 本Webアプリケーション全体を指す。
- **User（ユーザー）**: Appに登録されたReviewerまたは管理者アカウント。
- **Admin（管理者）**: ユーザー管理・設定などの管理操作を行う権限を持つUser。ロール階層の最上位。
- **TeamLeader（チームリーダー）**: 自チームのメンバー管理およびReviewAssignmentを行う権限を持つUser。
- **Team（チーム）**: 複数のUserをグループ化した単位。ReviewSessionはチーム単位で割り当てられる。
- **ReviewSession（校閲セッション）**: 一つのTranscriptionに対するReviewの作業単位。
- **TeamAssignment（チーム割り当て）**: ReviewSessionを特定のTeamに割り当てる設定。TeamのすべてのメンバーがそのReviewSessionにアクセスできる。
- **CustomLanguageModel（カスタム言語モデル）**: Amazon Transcribe のカスタム言語モデル。ドメイン固有の語彙や表現を学習させることで文字起こし精度を向上させる。
- **Segment（セグメント）**: 文字起こしの最小単位。開始時刻・終了時刻・テキスト・話者情報を持つ。
- **LanguageModelService**: CustomLanguageModel の作成・管理を行うバックエンドのサービス層コンポーネント（`backend/src/services/language-model-service.ts`）。
- **ModelCreationForm（モデル作成フォーム）**: フロントエンドで CustomLanguageModel を作成するための入力フォーム（`frontend/src/pages/LanguageModelPage.tsx`）。
- **SourceReviewSession（ソース校閲セッション）**: CustomLanguageModel のトレーニングデータの元として選択される ReviewSession。
- **TargetTeam（対象チーム）**: 作成する CustomLanguageModel の所属先として指定された Team（teamId）。

---

## Requirements

### Requirement 1: ソース校閲セッションのチーム割り当て検証

**User Story:** TeamLeader として、CustomLanguageModel を作成するとき、ソースとして指定した各 ReviewSession が対象 Team に割り当てられていることを保証したい。そうすることで、別 Team に属する ReviewSession を元に誤って Team のモデルを作成することを防げる。

#### Acceptance Criteria

1. WHEN LanguageModelService が CustomLanguageModel の作成要求を受け取ったとき、THE LanguageModelService SHALL 指定された各 SourceReviewSession について TargetTeam への TeamAssignment が存在するかを検証する。
2. IF いずれかの SourceReviewSession に TargetTeam への TeamAssignment が存在しないとき、THEN THE LanguageModelService SHALL HTTPステータス400 の `VALIDATION_ERROR` を日本語メッセージと英語 details とともに返し、CustomLanguageModel の作成処理を中止する。
3. WHEN LanguageModelService が TeamAssignment 検証を実行するとき、THE LanguageModelService SHALL TargetTeam への TeamAssignment が存在しない SourceReviewSession を最初に検出した時点で検証を終了し、残りの SourceReviewSession を検証しない。
4. THE LanguageModelService SHALL TeamAssignment 検証を既存の ReviewSession アクセス権検証（checkSessionAccess）ループが完了した直後に実行する。
5. WHEN 呼び出し元の User が Admin ロールであるとき、THE LanguageModelService SHALL その Admin に対しても TeamAssignment 検証を適用する。
6. WHERE すべての SourceReviewSession が TargetTeam へ割り当てられている場合、THE LanguageModelService SHALL TeamAssignment 検証を通過させ、後続の CustomLanguageModel 作成処理を継続する。

### Requirement 2: 作成フォームにおけるソースセッション候補の絞り込み

**User Story:** TeamLeader として、モデル作成フォームでソース ReviewSession を選ぶとき、選択中の Team に割り当てられた ReviewSession だけが候補に表示されてほしい。そうすることで、対象外の ReviewSession を選んでしまう操作ミスを避けられる。

#### Acceptance Criteria

1. WHILE ModelCreationForm で TargetTeam が選択されているとき、THE App SHALL ソース ReviewSession の候補として、選択された TargetTeam への TeamAssignment が存在する ReviewSession のみを表示する。
2. WHEN ユーザーが ModelCreationForm で TargetTeam の選択を変更したとき、THE App SHALL 変更後の TargetTeam に割り当てられた ReviewSession に候補一覧を更新する。
3. WHEN TargetTeam の選択変更により、既に選択済みの SourceReviewSession が変更後の TargetTeam に割り当てられていない状態になったとき、THE App SHALL 当該 SourceReviewSession の選択を解除する。
4. WHEN TargetTeam の選択変更により SourceReviewSession の選択が解除されたとき、THE App SHALL 当該 SourceReviewSession の選択に依存する他の入力項目を連動してリセットする。

### Requirement 3: ロールによる機能利用制限

**User Story:** Admin として、CustomLanguageModel 作成機能を Admin と TeamLeader に限定したい。そうすることで、Reviewer によるモデル作成を防ぎ、権限境界を保てる。

#### Acceptance Criteria

1. IF CustomLanguageModel 作成を要求した User のロールが Admin でも TeamLeader でもないとき、THEN THE LanguageModelService SHALL HTTPステータス403 の `FORBIDDEN` を返し、作成処理を中止する。
2. WHERE ログイン中の User のロールが Admin または TeamLeader である場合、THE App SHALL ModelCreationForm を利用可能にする。

### Requirement 4: エラーメッセージの言語

**User Story:** Reviewer・TeamLeader・Admin として、検証失敗時にわかりやすい日本語メッセージを受け取りたい。そうすることで、原因を即座に理解できる。

#### Acceptance Criteria

1. WHEN LanguageModelService が TeamAssignment 検証の失敗に起因するエラーを返すとき、THE LanguageModelService SHALL ユーザー向けメッセージ（message）を日本語で、開発者向け詳細（details）を英語で構成する。
