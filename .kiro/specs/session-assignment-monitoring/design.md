# セッション割当・進捗モニタリング 設計メモ

Admin / Team Leader が、セッションの割当状況・ステータス・Reviewer ごとの校閲進捗・滞留を確認するための機能です。

## 定義

| 用語 | 定義 |
|------|------|
| 進捗 | Reviewer ごとの「TEXT の Correction があるユニークな segmentId 数 ÷ セッションの全セグメント数」。校閲画面の「確定」はテキスト未変更でも Correction を保存するため、確認済みもカウントされる |
| 未割当 | `assignedUserId` が無く、`assignedReviewerCount` が 0 のセッション |
| 滞留 | IN_PROGRESS のセッションで、参加者全員の最終 Correction 日時のうち最新のもの（Correction が無ければセッション作成日時）が N 日以上前 |

## 滞留しきい値（cdk.json）

`infra/cdk.json` の context `stalledThresholdDays` で変更します（UI からは変更できません）。

- 既定 `7`、範囲は整数の `1`〜`90`。範囲外・非整数は `cdk synth` が失敗します。
- 監視系 Lambda 4 本にだけ環境変数 `STALLED_THRESHOLD_DAYS` として渡されます。
- 変更後は `cdk deploy` で反映します。

## 権限

| ロール | 範囲 |
|--------|------|
| ADMIN | 全セッション・全ユーザー |
| TEAM_LEADER | `assignedTeamId` が自分の所属チーム（DynamoDB の所属から導出、JWT は使わない）のセッションと、そのチームのメンバー。範囲外は 404 |
| REVIEWER | 403 |

## API

| Method | Path | Handler | 内容 |
|--------|------|---------|------|
| GET | `/sessions/monitoring` | `get-session-monitoring` | 割当先・ステータス・参加人数・未割当/滞留フラグ。`status` `teamId` `userId` `unassignedOnly` `stalledOnly` `page` で絞り込み。進捗の割合は返さない |
| GET | `/sessions/{sessionId}/progress` | `get-session-progress` | Reviewer 別の進捗 |
| GET | `/monitoring/users` | `get-user-workload` | ユーザー別の担当数 / 進行中数 / 滞留数 |
| GET | `/monitoring/users/{userId}/sessions` | `get-user-sessions` | ユーザーの担当セッションごとの進捗 |

共通ロジックは `backend/src/services/monitoring-service.ts` にあります。

## 画面

- セッション一覧画面（Admin / Team Leader のみ）: 「セッション一覧」と「割当・進捗」を切り替えます。「割当・進捗」にはセッション別（行展開で Reviewer 別進捗）とユーザー別の 2 つの表示があります。
- ユーザー管理画面（Admin のみ）: 「担当数・進行中・滞留」の列と、行展開による担当セッションごとの進捗を追加しました。

## コストと既知の制約

- 最終 Correction 日時は `Limit=1` の降順クエリ（約 1 読み取りユニット）で都度取得します。同時実行数は 10 に制限しています。
- 一覧系 API では進捗の割合を計算しません。割合は詳細 API（行展開）でのみ計算します。
- Team Leader の取得は GSI1 の `TEAM#` クエリのみで、テーブル Scan は使いません。
- Admin の全セッション取得は既存の `getAllSessions` を使います。`ALL_SESSIONS` の GSI1 キーは現状どこにも書き込まれていないため、実際にはテーブル Scan（`entityType` フィルタ）にフォールバックします。これは既存の `GET /sessions` と同じ挙動です。Scan を避けるには、セッション作成時に `GSI1PK = ALL_SESSIONS` を書き込み、既存セッションをバックフィルする別対応が必要です。
- `assignedTeamId` が無いセッションは Team Leader の範囲に入りません（Admin のみ閲覧可能）。
