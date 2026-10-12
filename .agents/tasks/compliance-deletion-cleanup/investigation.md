# 調査レポート: コンプライアンスグレードの S3 削除と孤立オブジェクトの掃除

> READ-ONLY 調査。コードは一切変更していません。本レポートは所見と推奨のみを記載します。
> 対象コミット時点のソースを `backend/src/services/deletion-service.ts` ほかを直接読み取り、行番号を引用しています。

---

## 1. サマリ（結論を先に）

`deletion-service.ts` の 2 つの削除フロー（`deleteMediaFile` / `deleteTranscription`）は、どちらも **「S3 先行削除 → DynamoDB 削除」** の順序で実行されます。この順序は意図的に **DynamoDB の孤立（S3 は消えたがメタデータが残る）** を許容し、**S3 の孤立（メタデータは消えたが S3 オブジェクトが残る）を防ぐ** 方向に倒れています。つまり「物理データが残る」ケースは原理的に少なく、コンプライアンス上有利な初期設計です。

ただし **S3 オブジェクトが残り得る経路が 2 つ存在します**:

1. **`deleteMediaFile` のカスケード削除（`deleteTranscriptionJobsForMedia`）** — 複数ジョブの DataBucket 出力をループで削除する途中で例外が発生すると、未処理ジョブの `output.json` が **S3 に残る**（L398–424、ループ L406–420）。メディア本体の S3 削除は成功済みなので、残るのは「後続ジョブ出力の孤立」です。
2. **`deleteMediaFile` の後続 DynamoDB 書き込み失敗** — メディア S3 は削除済みだが、`deleteById` 以降（ジョブ削除・セッション整合）で例外が出ると、**ジョブ出力 S3 が未削除のまま残る**可能性があります（残存の中身は経路 1 と同じ）。

いずれの経路でも `PARTIAL_DELETION_FAILURE` 監査ログが記録され **再 throw** されますが、**残った S3 オブジェクトを後で消す補償処理（retry / sweep / reconciliation）は実装されていません**。現状、孤立オブジェクトは手動対応しない限り永久に残ります（課金・PII 残存リスク）。

**推奨（討議の case 2 = アプリケーションレベル保証）**: (a) 削除順序を「S3 を最後まで完遂させる」方向に強化しつつ冪等化、(b) `PARTIAL_DELETION_FAILURE` 監査レコードをキーにした **スイープ/リコンサイルの再削除ジョブ**（EventBridge スケジュール起動）を追加するのが、既存アーキテクチャ（Handler→Service→Repository、監査ログ、EventBridge 非同期処理）と最も整合します。詳細は §3。

S3 ライフサイクル Expiration は **プレフィックス単位でしか効かず特定キーを狙えない** ため「孤立のみ」を精密に消す用途には不適で、あくまで粗いバックストップにしかなりません（§4）。

DynamoDB TTL は **どのエンティティにも設定されていません**（監査ログは `recordAuditLog` のコメント上も「TTL なし」で無期限保持）。関連オブジェクトを自動で掃除する既存メカニズムは存在しません（§6）。

---

## 2. 質問への回答（証拠付き）

### Q1 & Q2: 孤立が起きうる全経路と、その順序・倒れ方

削除順序の基本原則（両関数共通）: **S3 を先に消し、`s3Deleted = true` を立ててから DynamoDB を消す**。`catch` では `s3Deleted || metadataDeleted`（または `dynamoDeleted`）が立っていれば `PARTIAL_DELETION_FAILURE` を記録して再 throw する。

#### 経路 A — `deleteMediaFile`: メタデータ削除失敗（S3 済・DynamoDB 未）

- 該当: `backend/src/services/deletion-service.ts` L179–192
  - L181–187: MediaBucket オブジェクトを `DeleteObjectCommand` で削除 → `s3Deleted = true`（L188）
  - L191: `mediaFileRepository.deleteById(mediaFileId)` が失敗すると catch へ（`metadataDeleted = true` は L192）
- **順序**: S3 先行。**倒れ方**: S3 は消え、DynamoDB メタデータが残る＝ **DynamoDB の孤立**。
- **コンプライアンス観点**: 物理データ（メディア本体）は消えているので PII 残存の観点では **安全側**。ただしメタデータが「削除済みに見えない」状態で残る。
- テストでも検証済み: `deletion-service.test.ts`（`records PARTIAL_DELETION_FAILURE when DynamoDB delete fails after S3 delete`、`deleteMediaFile - partial deletion failure` ブロック）。

#### 経路 B — `deleteMediaFile`: ジョブカスケードの途中失敗（**S3 孤立の本命**）

- 該当: `deleteTranscriptionJobsForMedia` L398–424（呼び出しは `deleteMediaFile` L197）
  - L406–420 のループで、各ジョブについて **先に DataBucket の `output.json` を `DeleteObjectCommand`（L410–416）** → **その後ジョブメタデータを `deleteById`（L419）**。
  - ループは複数ジョブを順次処理する。あるジョブの S3 削除後・次ジョブ処理前に例外（S3 スロットリング、`deleteById` 失敗など）が出ると、**未処理ジョブの `output.json` が S3 に残る**。
- この時点で呼び出し元 `deleteMediaFile` では既に `s3Deleted=true, metadataDeleted=true`（L188, L192）なので、catch（L210〜）は `PARTIAL_DELETION_FAILURE` を記録して再 throw。
- **順序**: 各ジョブ内は S3 先行だが、ジョブ**間**は逐次。**倒れ方**: 一部ジョブ出力が **S3 に残る＝ S3 孤立**。これが「カスケードが一部消して throw」の典型。
- **重要**: この経路で残る S3 キーの具体値（`transcriptions/{jobId}/output.json` または `job.outputS3Key`）は、失敗直後には列挙可能だが、`PARTIAL_DELETION_FAILURE` の metadata には **記録されていない**（記録されるのは `resourceName`（＝ファイル名）と `reason` のみ、L213–221）。後述のスイープ設計上の制約になる（§3）。

#### 経路 C — `deleteMediaFile`: セッション整合処理の失敗（S3 済・ジョブ処理後）

- 該当: L199–209（PENDING セッションの `cascadeDeleteSession` L205、IN_PROGRESS の `updateSessionStatus` L207）
- メディア本体 S3・メタデータ・ジョブ群は削除済みで、ここで失敗すると catch へ。残るのは DynamoDB 側のセッションレコード（＝ DynamoDB 孤立）。経路 B を通過していなければ **S3 孤立は追加されない**。
- **倒れ方**: DynamoDB 孤立中心。コンプライアンス上は安全側。

#### 経路 D — `deleteTranscription`: カスケード削除失敗（S3 済・DynamoDB 未）

- 該当: L292–310
  - L293–300: DataBucket の `transcriptions/{jobId}/output.json` を削除 → `s3Deleted = true`（L301）
  - L304: `cascadeDeleteSession(sessionId)` が失敗すると catch（L312〜）へ（`dynamoDeleted = true` は L305）
- **順序**: S3 先行。**倒れ方**: S3（1 オブジェクト）は消え、セッション関連 DynamoDB レコードが残る＝ **DynamoDB 孤立**。
- テスト検証済み: `deletion-service.test.ts`（`records PARTIAL_DELETION_FAILURE when DynamoDB cascade delete fails after S3 delete`）、`deletion-service.property.test.ts` Property 40。
- **コンプライアンス観点**: 物理出力は消えており安全側。ここでは S3 孤立は発生しない（単一オブジェクトを先に消すため）。

#### 経路 E — `deleteTranscription`: ジョブ状態リセット失敗（S3 済・DynamoDB 済）

- 該当: L308–311（`transcriptionJobRepository.updateStatus(jobId, 'IN_PROGRESS')` L310）
- 失敗すると catch で `PARTIAL_DELETION_FAILURE` 記録。S3 もセッションも既に削除済みのため **孤立は発生しない**（ジョブ状態が不整合に残るだけ）。

#### 経路のまとめ表

| 経路 | 関数 / 行 | 順序 | 残るもの | S3 孤立リスク |
|------|-----------|------|----------|---------------|
| A | `deleteMediaFile` L181–192 | S3→DDB | DDB メタデータ | なし（S3 は消える） |
| **B** | `deleteTranscriptionJobsForMedia` L406–420 | ジョブ内 S3→DDB、ジョブ間逐次 | 未処理ジョブの `output.json` | **あり** |
| C | `deleteMediaFile` L199–209 | — | DDB セッション | なし（経路 B 未通過時） |
| D | `deleteTranscription` L293–304 | S3→DDB | DDB セッション群 | なし（S3 は消える） |
| E | `deleteTranscription` L308–311 | — | ジョブ状態不整合 | なし |

> 結論: **S3 孤立が実際に起こり得るのは経路 B のみ**（複数ジョブ出力の途中失敗）。他は設計どおり DynamoDB 側に倒れ、物理データ（PII）は消える。コンプライアンスの焦点は「経路 B で残る `transcriptions/{jobId}/output.json` を確実に消す」ことに絞られる。

---

### Q3: アプリケーションレベルで S3 消去を保証する方式（case 2）の比較

目標: 削除要求が出たら S3 オブジェクトは必ず物理消去される（孤立・課金・PII 残存ゼロ）。以下、既存アーキテクチャに乗る順に 4 案を比較する。

#### 案 1: 削除順序の見直し＋冪等化（基礎・必須）

- 内容:
  - **「DynamoDB メタデータを消す前に S3 を全部消し切る」** 原則を全経路で徹底。特に経路 B は、ループ中に 1 件失敗しても **残りのジョブ出力削除を続行**し（`Promise.allSettled` 等で全件試行）、失敗分だけを集約して throw する。
  - S3 `DeleteObject` は **元から冪等**（存在しないキーの削除も 2xx）。再実行で副作用がないため、再 throw 後に同じ削除を再度呼んでも安全。これを前提に「再試行可能」である旨を設計で明記。
- トレードオフ: 実装は小さく既存テストへの影響も限定的。ただし **プロセスが途中でクラッシュ**（Lambda タイムアウト等）した場合は救えない。単体では不十分で、案 3/4 と併用する前提。

#### 案 2: 同期リトライ（指数バックオフ）

- 内容: S3 削除失敗時にその場で数回リトライ（オフラインキュー同期で既に使われている指数バックオフの考え方＝`audit-operations.integration.test.ts` L420 付近「exponential backoff」を踏襲）。
- トレードオフ: 一時障害には有効だが、Lambda 実行時間・API Gateway タイムアウトの制約内でしか粘れない。恒久障害やプロセス消滅には無力。**ユーザー同期パスを長時間ブロックするのは UX 的に不可**。補助的手段。

#### 案 3: `PARTIAL_DELETION_FAILURE` 監査レコードを起点にしたスイープ/リコンサイル（推奨の中核）

- 内容:
  - 新しい Service（`src/services/deletion-sweep-service.ts` 想定）＋ EventBridge スケジュール起動の Handler を追加。
  - `audit-repository.queryByOperationType('PARTIAL_DELETION_FAILURE', ...)`（GSI2 = `OPERATION#PARTIAL_DELETION_FAILURE`、既存クエリ経路あり）で未解決レコードを列挙し、**対象リソースの S3 キーを再計算して再削除（冪等）**、成功したら解決済みとしてマーク（新 metadata もしくは `DELETION_SWEEP_RESOLVED` 監査記録）。
  - 既存の非同期処理が EventBridge→Lambda（Consensus 集約で既に採用）なので、スケジュール起動の追加はアーキテクチャ的に自然。
- **既存コードとの重大なギャップ（要対応）**:
  - 現状 `PARTIAL_DELETION_FAILURE` の metadata に **残存 S3 キーが入っていない**（経路 B の §2 参照）。`resourceId` は mediaFileId どまりで、どのジョブ出力が残ったかは記録されていない。
  - かつ `sanitizeMetadata`（`metadata-sanitizer.ts`）が **許可キーを `resourceName / previousValue / newValue / count / reason` に限定**し、値は 1000 文字で切り詰める（`audit-operations.integration.test.ts` のサニタイズテスト群で裏取り）。任意の S3 キー配列をそのまま入れられない。
  - → スイープを「キー直読み」で作るには **監査メタデータ拡張（許可キー追加）か、`reason` 文字列への構造化埋め込み**が必要。あるいはスイープ側で `mediaFileId` から **S3 プレフィックス（`media/{id}/`, `transcriptions/*`）を ListObjects で突き合わせ**、DynamoDB に対応レコードが無い S3 オブジェクトを孤立とみなして消す「リコンサイル型」にする（監査キーに依存しないぶん堅牢だが、ListObjects のコストと誤削除防止ロジックが要る）。
- トレードオフ: 最も堅牢で「必ず消える」を実現できるが、新規コンポーネント（Service/Handler/CDK のスケジュールルール・IAM）が増える。誤削除防止（まだ有効なオブジェクトを消さない）設計が重要。

#### 案 4: 削除インテントの永続化（Outbox / tombstone）

- 内容: 削除要求時にまず「削除予定」レコード（tombstone）を DynamoDB に書き、ワーカーが S3→DDB を順に消し込んで完了時に tombstone を消す。未完了 tombstone をスイープが再処理。
- トレードオフ: 保証は最も強い（プロセス消滅にも耐える）が、既存の同期削除フロー・テストを大きく書き換える必要があり、スコープが大きい。今回の「孤立の掃除」要件に対してはオーバースペック気味。

#### 推奨

**案 1（順序強化＋冪等化・全経路）を土台に、案 3（`PARTIAL_DELETION_FAILURE` 起点のスイープ/リコンサイル）を主たる保証手段として追加**する。案 2 は補助。案 3 を機能させるには監査メタデータの拡張（残存キーの記録）または ListObjects ベースのリコンサイルのどちらかを選ぶ必要があり、ここが設計判断の分岐点。アーキテクチャ整合（EventBridge 非同期・GSI2 クエリ・Handler→Service→Repository）の観点で既存資産を最大限再利用できる。

---

### Q4: S3 ライフサイクル Expiration はバックストップになるか

- なり得るが **「孤立のみ」を精密に消す用途には不適**。理由:
  - **ライフサイクルルールのフィルタはプレフィックス（＋タグ）単位**であり、特定のオブジェクトキーを狙い撃ちできない。`transcriptions/` プレフィックス全体に Expiration を掛ければ、**孤立していない現役の出力まで対象**になる。
  - 本アプリの DataBucket には現役の `transcriptions/{jobId}/output.json`（まだ削除要求が出ていない正常データ）が同一プレフィックスに同居するため、プレフィックス一括 Expiration は正常データを巻き込む。
  - 粒度を「作成から N 日」でしか制御できず、「削除要求が出たオブジェクトだけ」という条件を表現できない。
- 現状のインフラ: `foundation-stack.ts` の MediaBucket（L81 付近）/ DataBucket（L105 付近）には **ライフサイクルルールは未設定**。将来ユーザーが検討する DataBucket のライフサイクル方針（元ユーザー要望でも「DataBucket はまだ実装しない」）とは別軸。
- 結論: ライフサイクルは **「どれだけ失敗しても最終的にいつか消える」粗いセーフティネット**として限定的価値はあるが、**コンプライアンスグレードの“要求時点での確実な消去”は満たせない**。孤立の精密な消去はアプリ側（案 3）で行い、ライフサイクルは任意の追加保険という位置づけが妥当。タグ付け（削除失敗オブジェクトに tombstone タグを付与→タグフィルタ Expiration）なら精度は上がるが、タグを付ける処理自体がアプリ側削除成功を要し堂々巡りになりやすい。

---

### Q5: 更新が必要になる既存テスト（deletion-service 関連）

| ファイル | 種別 | 更新が必要になり得る理由 |
|----------|------|--------------------------|
| `backend/src/services/deletion-service.test.ts` | Unit | 削除順序・冪等化・カスケード継続（経路 B の `Promise.allSettled` 化等）を変更すると、S3/DDB 呼び出し順と `PARTIAL_DELETION_FAILURE` 記録のアサーションに影響。特に `cascade deletes all transcription jobs and their S3 output` と、`deleteMediaFile - partial deletion failure` / `records PARTIAL_DELETION_FAILURE when DynamoDB cascade delete fails after S3 delete`。 |
| `backend/src/services/deletion-service.property.test.ts` | Property | Property 33（カスケード完全性）、Property 40（部分削除監査ログ）が削除順序や監査 metadata 拡張の影響を受ける。`reason` に `S3=deleted/pending`・`DynamoDB=pending` 文字列を期待（Property 40 の `PARTIAL_DELETION_FAILURE audit log contains S3 and DynamoDB status`）しているため、metadata 形式変更時は要調整。 |
| `backend/src/__tests__/integration/audit-operations.integration.test.ts` | Integration | `PARTIAL_DELETION_FAILURE` の metadata 形式（残存キー記録を追加する場合）とサニタイズ許可キー（`metadata-sanitizer`）を拡張すると、「部分削除失敗時の AuditLog 記録」ブロックおよび「メタデータサニタイズ」ブロックのテストが影響を受ける。 |
| `backend/src/handlers/delete-media.test.ts` | Unit | サービスをモックしているため直接の影響は小さいが、新しいエラー/挙動を足すなら追補が必要。 |
| `backend/src/handlers/delete-transcription.test.ts` | Unit | 同上。 |
| （新規）スイープ Service/Handler のテスト | Unit/Property/Integration | 案 3 を実装する場合、`src/services/deletion-sweep-service.*.test.ts`（co-located）と、該当すれば `__tests__/integration/` に新規追加。steering の「Deletion は property-based 必須」に従い property テストを用意。 |
| （新規）CDK テスト | Infra | 案 3 の EventBridge スケジュール・IAM・（任意の）ライフサイクルルールを `infra/test/` のスナップショット/アサーションに追加。 |

関連するが削除順序そのものには非依存のファイル: `backend/src/repositories/media-file-repository.ts`（`deleteById`）、`backend/src/repositories/transcription-job-repository.ts`（`deleteById` / `listByMediaFileId`）、`backend/src/services/audit-service.ts`（`recordAuditLog`）。これらは I/F 変更が無ければテスト更新不要。

実行コマンド（`backend/package.json` より確認）:
- 単体・プロパティ: `cd backend && npx vitest --run`（特定: `npx vitest --run src/services/deletion-service`）
- インテグレーション: `cd backend && INTEGRATION_TEST=true npx vitest --run --config vitest.integration.config.ts audit-operations`（LocalStack 要）
- ビルド: `cd backend && npm run build`（`tsc -p tsconfig.build.json`）

---

### Q6: DynamoDB TTL やその他の自動掃除メカニズムの有無

- **DynamoDB TTL は未使用**。
  - リポジトリ各所（`media-file-repository.ts`, `transcription-job-repository.ts`, `audit-repository.ts`）の書き込みに `ttl` / `expiresAt` 属性は無い。
  - `audit-service.ts` の `recordAuditLog` コメントに「Entries are stored indefinitely (no TTL)」と明記。design.md には `ttl`「必要な場合」の記述があるが、コード上は未実装。
  - grep 結果の `expiresAt` は **Signed URL の有効期限**（`media-service.ts` の 300 秒）であり、オブジェクト削除とは無関係。
- **S3 ライフサイクルも未設定**（§4）。
- その他の自動掃除:
  - マルウェアスキャン（`infra/lib/constructs/malware-scan.ts`）は `quarantine/` 隔離・`DeleteObject` 権限を持つが、**感染ファイルの隔離用**であり孤立掃除とは無関係。
  - `dev/staging` の `autoDeleteObjects: true`（foundation-stack）は **`cdk destroy` 時のバケット空化**のためで、通常運用の孤立掃除ではない。
- 結論: **削除関連の孤立を自動で掃除する既存メカニズムは一切存在しない**。孤立は現状、`PARTIAL_DELETION_FAILURE` 監査ログに痕跡が残るのみで、物理的な再削除は行われない。

---

## 3. 結論と推奨（まとめ）

1. 削除フローは「S3 先行削除」で設計され、**物理 PII が残る経路は限定的**。実際に S3 孤立が起こり得るのは **経路 B（`deleteTranscriptionJobsForMedia` の複数ジョブ出力ループ、L404–420）のみ**。
2. 現状は失敗を `PARTIAL_DELETION_FAILURE` に記録して再 throw するだけで、**残存 S3 オブジェクトを後で消す仕組みが無い**。コンプライアンス（確実な物理消去）には不足。
3. 推奨は **案 1（全経路で順序強化＋カスケード継続＋冪等化）を土台に、案 3（`PARTIAL_DELETION_FAILURE` を起点とした EventBridge スケジュール起動のスイープ/リコンサイル）を主保証**として追加。案 2（同期リトライ）は補助。
4. 案 3 実装の最大の前提ギャップは **`PARTIAL_DELETION_FAILURE` の metadata に残存 S3 キーが無い**こと、および **`sanitizeMetadata` の許可キー制限（1000 文字・固定キー）**。「監査メタデータ拡張」か「`mediaFileId` から S3 プレフィックスを ListObjects で突き合わせるリコンサイル型」のどちらを採るかが設計判断の分岐。誤削除防止（現役データを消さない）を必ず組み込むこと。
5. S3 ライフサイクル Expiration は **プレフィックス単位でしか効かず特定キーを狙えない**ため「孤立のみ精密削除」には不適。粗いバックストップ以上の役割は持てない。
6. **DynamoDB TTL・S3 ライフサイクル・その他の自動掃除は未設定**。孤立は手動対応しない限り残存する。

> 本調査はコードを変更していません。実装は後続ステップで、既存の property-based テスト規約（Deletion は必須）と Handler→Service→Repository 構造、新規は `src/services/` / `src/handlers/` / `infra/lib/` の配置ルールに従うこと。
