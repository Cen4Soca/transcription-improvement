# Bugfix Requirements Document

## Introduction

バックエンドに実装・デプロイ済みの2つの機能が、フロントエンドの実装欠落によりユーザーから一切利用できない状態になっている。本バグ修正は、既存のバックエンド API 契約に合わせてフロントエンドの欠落部分（API サービス・フック・画面/コンポーネント配線）を補い、ユーザーが当該機能を利用できるようにすることを目的とする。既存の正常機能（ユーザー管理・チーム CRUD・メンバー管理・IP 許可リスト・監査ログ・ランキング等）の挙動は変更しない。

対象となる欠落機能は次の2つ:

- **バグ1: Consensus（合意形成）機能のフロントエンド完全欠落。** バックエンドには `GET /consensus/{sessionId}/segments`（`get-consensus.ts`, ADMIN 専用, Consensus 状態・各 Reviewer 回答の取得）と `POST /consensus/{sessionId}/resolve`（`post-consensus-resolve.ts`, ADMIN 専用, 競合の手動解決）が実装・ルート登録済み（`infra/lib/stacks/api-stack.ts`）。しかしフロントには `consensus-api.ts`・表示/操作画面・コンポーネントが一切なく、`consensus/segments` や `resolveConsensus` 等のフロント呼び出しは 0 件。結果として Admin は Consensus 結果の閲覧や競合の手動解決を UI から行えない。

- **バグ2: チームへのセッション割り当ての API 連携未実装（スタブのまま）。** バックエンドには `POST /admin/teams/{teamId}/assignments`（`createTeamAssignmentHandler`）と `DELETE /admin/teams/{teamId}/assignments/{sessionId}`（`deleteTeamAssignmentHandler`）が実装・ルート登録済み。フロントには UI コンポーネント `TeamManagement.tsx`（`AssignSessionSelect`・割り当て済みリスト・`onAssignSession`/`onUnassignSession`）が存在するが、`admin-api.ts` に assignments を呼ぶメソッドが無く、`useAdmin.ts` の `assignSession`/`unassignSession` は `// TODO` の空実装、かつ `sessions` と `teamAssignments` が常に空配列で固定されている。結果として UI は表示されても何も起きず、TeamLeader/Admin がチームにセッションを割り当てられない。

> 補足（設計フェーズで扱う技術的事実、要件ではない）: `GET /admin/teams/{teamId}/assignments` のハンドラ（`listTeamAssignmentsHandler`）は実装済みだが `api-stack.ts` にルート登録されていない。また割り当て対象セッション一覧を取得する配線（`sessions`）も欠落している。これらの不足を踏まえた実装方針は design.md で扱う。

## Bug Analysis

### Current Behavior (Defect)

バグが発生している現在の挙動（フロントエンドにコードパスが存在せず、ユーザー操作が成立しない）。

1.1 WHEN ADMIN がセッションの Consensus 状態（確定/競合/各 Reviewer の回答）を UI で閲覧しようとするとき THEN フロントエンドには Consensus を取得・表示する画面も API サービスも存在せず、閲覧手段が一切ない

1.2 WHEN ADMIN が CONFLICT（競合解決待ち）状態のセグメントに対し正答を選んで手動解決しようとするとき THEN フロントエンドには解決操作を発行する UI も API 呼び出しも存在せず、`POST /consensus/{sessionId}/resolve` が呼ばれることはない

1.3 WHEN TeamLeader/Admin が `TeamManagement` の割り当てセクションでセッションを選び「割り当て」を押すとき THEN `useAdmin` の `assignSession` が空実装（`// TODO`）のため何も起きず、`POST /admin/teams/{teamId}/assignments` が呼ばれない

1.4 WHEN TeamLeader/Admin が割り当て済みセッションの「解除」を押すとき THEN `useAdmin` の `unassignSession` が空実装のため何も起きず、`DELETE /admin/teams/{teamId}/assignments/{sessionId}` が呼ばれない

1.5 WHEN TeamLeader/Admin がチームの割り当てセクションを開くとき THEN `useAdmin` の `sessions` と `teamAssignments` が常に空配列で固定されているため、割り当て可能なセッション候補も現在の割り当ても表示されない

### Expected Behavior (Correct)

修正後に期待される挙動。各項は上記 Current Behavior と同一条件に対応する。既存のバックエンド I/O 契約（レスポンス形状・権限・エラーコード）にフロントを合わせる。

2.1 WHEN ADMIN がセッションの Consensus 状態を UI で閲覧しようとするとき THEN the system SHALL `GET /consensus/{sessionId}/segments` を呼び出し、各セグメントの `consensusStatus`（`UNDECIDED`/`CONFIRMED`/`CONFLICT`）・`consensusText`・CONFLICT セグメントの `reviewerAnswers`（`text`/`count`/`userIds`）を日本語 UI で表示する

2.2 WHEN ADMIN が CONFLICT 状態のセグメントに対し正答テキストを選んで手動解決するとき THEN the system SHALL `POST /consensus/{sessionId}/resolve` を `{ segmentId, selectedText }` のボディで呼び出し、成功時に当該セグメントの状態を CONFIRMED として反映する

2.3 WHEN ADMIN が CONFLICT 状態でないセグメント、または COMPLETED セッションに対して解決を行おうとするとき THEN the system SHALL バックエンドが返すエラー（それぞれ `VALIDATION_ERROR` / セッション編集不可）を捕捉し、日本語のエラーメッセージとして表示して UI をクラッシュさせない

2.4 WHEN 非 ADMIN ユーザーが Consensus 機能にアクセスするとき THEN the system SHALL ADMIN 専用であることに従い、UI 上で当該機能を提示しない、またはアクセス時にバックエンドの `FORBIDDEN` を捕捉して日本語で通知する

2.5 WHEN TeamLeader/Admin が割り当てセクションでセッションを選び「割り当て」を押すとき THEN the system SHALL `POST /admin/teams/{teamId}/assignments` を `{ sessionId }` のボディで呼び出し、成功時（201, `data: TeamAssignmentRecord`）に割り当て済みリストへ反映する

2.6 WHEN TeamLeader/Admin が割り当て済みセッションの「解除」を押すとき THEN the system SHALL `DELETE /admin/teams/{teamId}/assignments/{sessionId}` を呼び出し、成功時（`data: { deleted: true }`）に割り当て済みリストから除去する

2.7 WHEN TeamLeader/Admin が割り当てセクションを開くとき THEN the system SHALL 割り当て可能なセッション候補一覧と当該チームの現在の割り当て一覧を取得して表示し、`TeamManagement` に空でないデータを渡す

2.8 WHEN 割り当て/解除/取得いずれかの API 呼び出しが失敗するとき（例: TeamLeader が自チーム以外を操作して `FORBIDDEN`）THEN the system SHALL エラーを Result 型で捕捉し、日本語メッセージとして表示して UI をクラッシュさせない

### Unchanged Behavior (Regression Prevention)

バグ条件に該当しない既存機能は現状のまま維持する。

3.1 WHEN ADMIN がユーザー管理（作成/同期/更新/有効化・無効化）を操作するとき THEN the system SHALL CONTINUE TO 既存の `/admin/users` 系 API を通じて現在どおり動作する

3.2 WHEN TeamLeader/Admin がチーム CRUD（作成/編集/削除）およびメンバー追加・削除を操作するとき THEN the system SHALL CONTINUE TO 既存の `/admin/teams` 系 API を通じて現在どおり動作する

3.3 WHEN ユーザーが IP 許可リスト・監査ログ・ランキング・Consensus/ランキング設定を操作するとき THEN the system SHALL CONTINUE TO 既存の API と挙動のまま変更なく動作する

3.4 WHEN ユーザーがセッション一覧・詳細・セグメント・メディア URL・修正（Correction）などの既存フローを操作するとき THEN the system SHALL CONTINUE TO 現在どおり動作する

3.5 WHEN バックエンドの各ハンドラ・サービス・リポジトリ、API Gateway のルート、権限（ADMIN > TEAM_LEADER > REVIEWER）が参照されるとき THEN the system SHALL CONTINUE TO 本修正はフロントエンドの欠落補填に限定し、既存バックエンド契約を変更しない（必要な場合の未登録 GET ルート追加は design.md で判断する）

## Bug Condition Methodology

### Bug Condition（バグ条件）

バグを引き起こす入力（＝ユーザーが利用しようとする機能）を識別する述語。

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X of type UserFeatureInteraction  // ユーザーが利用しようとする機能操作
  OUTPUT: boolean

  // バックエンド API は実装・到達可能だが、フロントにコードパスが無い機能
  RETURN  X.feature = CONSENSUS_VIEW            // GET /consensus/{sessionId}/segments
       OR X.feature = CONSENSUS_RESOLVE         // POST /consensus/{sessionId}/resolve
       OR X.feature = TEAM_ASSIGN_SESSION       // POST /admin/teams/{teamId}/assignments
       OR X.feature = TEAM_UNASSIGN_SESSION     // DELETE /admin/teams/{teamId}/assignments/{sessionId}
       OR X.feature = TEAM_ASSIGNMENT_VIEW      // 割り当て候補・現在の割り当ての表示
END FUNCTION
```

### Property Specification: Fix Checking（修正検証）

バグ条件に該当する全入力に対し、フロントが正しいバックエンド API を正しい契約で呼び出し、結果を反映することを保証する。

```pascal
// Property: Fix Checking - 欠落していたフロント機能が実際にバックエンドを駆動する
FOR ALL X WHERE isBugCondition(X) DO
  result ← frontend'(X)   // 修正後フロント

  ASSERT result.invokesBackendRoute = expectedRoute(X.feature)
     AND result.requestContract     = backendContract(X.feature)   // ボディ/パス/メソッド一致
     AND result.rendersResponse     = true                         // 成功時はレスポンスを UI へ反映
     AND result.handlesErrorAsResult = true                        // 失敗時は Result で捕捉し日本語表示、no_crash
END FOR
```

### Preservation Checking（既存挙動の保全）

バグ条件に該当しない全入力（既存の正常機能）に対し、修正後フロントが修正前と同一に振る舞うことを保証する。

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT frontend(X) = frontend'(X)   // 既存機能は不変（F = F'）
END FOR
```

**Key Definitions:**
- **F (frontend)**: 修正前のフロントエンド（Consensus 画面・API サービスが無く、`assignSession`/`unassignSession` が空実装、`sessions`/`teamAssignments` が空配列固定）。
- **F' (frontend')**: 修正後のフロントエンド（`consensus-api.ts`・Consensus 画面・`admin-api.ts` の割り当てメソッド・`useAdmin` の実配線を補填）。
- **expectedRoute / backendContract**: `api-stack.ts` に登録済みのルートと、各ハンドラが受理するリクエスト／返却するレスポンス形状。
