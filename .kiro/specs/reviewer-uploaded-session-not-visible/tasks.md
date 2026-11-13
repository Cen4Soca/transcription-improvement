# Implementation Plan

本計画は bugfix の探索的ワークフローに従う。修正前に探索テスト（バグ再現）と Preservation テスト（既存挙動の固定）を書き、その後に修正を適用して両テストで検証する。設計の採用案 A（可視性: `createSessionForJob` が ReviewAssignment を冪等作成）と採用案 D（メディアリンク: 空 catch 廃止 + 取得時フォールバック補償）に基づく。全テストは AWS SDK を `vi.mock()` でモックし、Handler / Service / Repository を独立に検証する。fast-check は `{ numRuns: 100 }`。

- [x] 1. 可視性バグの探索テストを書く（修正前）
  - **Property 1: Bug Condition** - 可視性の不整合（アップロード由来セッションが一覧に出ない）
  - **CRITICAL**: このテストは未修正コードで FAIL すること。失敗がバグの存在を証明する
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: このテストは期待挙動をエンコードする。修正後に PASS することで修正を検証する
  - **GOAL**: バグを示すカウンターイグザンプルを表面化する
  - **Scoped PBT Approach**: ランダムな uploader userId / sessionId / teamId（未設定含む）に加え、**uploader role を `REVIEWER` と `TEAM_LEADER` の両方で生成**する property-based test を書く（`mediaFile.teamId` 未設定の Reviewer アップロードと、`mediaFile.teamId` 設定済みの TeamLeader アップロードの両ケースを含める）
  - Bug Condition（`isBugCondition_visibility`: `generatedFromUpload=true` かつ TeamAssignment 不在かつ ReviewAssignment 不在かつ uploader 本人）を満たす入力で、未修正の `createSessionForJob` → `getAccessibleSessionIds(uploader)` が当該 `sessionId` を **含まない** ことをアサートする
  - **TeamLeader の teamId ありケースでも未修正では一覧に出ないことを再現する**: `mediaFile.teamId` 設定済みで `createSession` が GSI1 に `GSI1PK=TEAM#{teamId}, GSI1SK=SESSION#{now}#{sessionId}`（`SESSION#` プレフィックス）を張っても、`getAccessibleSessionIds` の team 経路は `PK=TEAM#{teamId}, SK begins_with ASSIGNMENT#`（`TeamAssignment`）を走査するため不一致で sessionId が含まれないこと（GSI1 `SESSION#` ≠ TeamAssignment `ASSIGNMENT#`）をアサートする
  - 同一セッションについて `getAssignedSessions(uploader)` には **含まれる** ことをアサートし、不整合（一覧に出ないのに自分のタスクには出る）を Reviewer / TeamLeader の両ロールで再現する
  - 対象: `backend/src/services/session-service.ts`（`createSessionForJob`）, `backend/src/services/access-control-service.ts`（`getAccessibleSessionIds`）
  - テストファイル: `backend/src/services/session-service.property.test.ts`（co-located, `{ numRuns: 100 }`）
  - 各 `describe` は `Feature: reviewer-uploaded-session-not-visible, Property 1: ...` 形式、`it` の docstring に `**Validates: Requirements 2.1, 2.2, 2.3**` を記載
  - 未修正コードで実行する
  - **EXPECTED OUTCOME**: テストが FAIL する（バグが存在する証拠として正しい）
  - 発見したカウンターイグザンプル（例: `getAccessibleSessionIds` が Assignment 0 件で sessionId を返さない）を記録する
  - テスト作成・実行・失敗の記録が済んだらタスク完了とする
  - _Bug_Condition: isBugCondition_visibility(X) from design_
  - _Requirements: 1.1, 1.1a, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. メディアリンクバグの探索テストを書く（修正前）
  - **Property 3: Bug Condition** - メディアリンクの欠落（メディア取得が MEDIA_FILE_NOT_FOUND になる）
  - **CRITICAL**: このテストは未修正コードで FAIL すること。失敗がバグの存在を証明する
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: このテストは期待挙動をエンコードする。修正後に PASS することで修正を検証する
  - **GOAL**: メディアリンク欠落のカウンターイグザンプルを表面化する
  - **Scoped PBT Approach**: ランダムな sessionId / mediaFileId / scanStatus（CLEAN 含む）とリンク欠落状態（`getBySessionId` が null）に加え、**uploader role を全ロール（`REVIEWER` / `TEAM_LEADER` / `ADMIN`）で生成**する property-based test を書く
  - Bug Condition（`isBugCondition_mediaLink`: `generatedFromUpload=true` かつ `getMediaFileBySessionId(sessionId)=null`）を満たす入力で、未修正の `getMediaFileForSession(sessionId)` → `getMediaUrl` が `MEDIA_FILE_NOT_FOUND`（404）を返すことをアサートする
  - **メディアリンク欠陥がアップローダーのロールに非依存であることを再現する**: uploader role が `REVIEWER` / `TEAM_LEADER` / `ADMIN` のいずれでも同じ 404 が起こることをアサートする（空 catch による欠落はロール非依存。Admin は一覧には出るがメディア取得は 404 になりうる、という切り分けを含む）
  - 補助観測として、`startJob` 内で `updateSessionId` が throw する状況をモックし、空 `catch {}` により `mediaFile.sessionId` 未設定のまま job が save される挙動を記録する
  - Admin 後付け割り当てエッジ（TeamAssignment 追加後も `getBySessionId` が null のまま 404 が継続）を1ケースとして含める（bugfix 1.6）
  - 対象: `backend/src/services/media-service.ts`（`getMediaFileForSession`）, `backend/src/services/transcription-job-service.ts`（`startJob`）
  - テストファイル: `backend/src/services/media-service.property.test.ts`（co-located, `{ numRuns: 100 }`）
  - 各 `describe` は `Feature: reviewer-uploaded-session-not-visible, Property 3: ...` 形式、`it` の docstring に `**Validates: Requirements 2.4, 2.5, 2.6**` を記載
  - 未修正コードで実行する
  - **EXPECTED OUTCOME**: テストが FAIL する（バグが存在する証拠として正しい）
  - 発見したカウンターイグザンプル（例: `updateSessionId` 失敗が空 catch で握りつぶされ MediaFile リンクが欠落、`getMediaUrl` が 404）を記録する
  - テスト作成・実行・失敗の記録が済んだらタスク完了とする
  - _Bug_Condition: isBugCondition_mediaLink(X) from design_
  - _Requirements: 1.4, 1.5, 1.6, 2.4, 2.5, 2.6_

- [x] 3. 可視性の Preservation プロパティテストを書く（修正前）
  - **Property 2: Preservation** - 既存可視性の不変
  - **IMPORTANT**: observation-first（観測優先）方法論に従う
  - 未修正コードで非バグ入力の挙動を観測する:
    - TeamAssignment / ReviewAssignment が整合しているセッションの `getAccessibleSessionIds` 結果（bugfix 3.1, 3.3）
    - ADMIN に対し `getAccessibleSessionIds` が `null`（＝全件）を返す（bugfix 3.2）
    - 他チーム・未割り当てセッションがアクセス不可（`checkSessionAccess` / `denyResourceAccess` で 404）（bugfix 3.6）
  - 観測した挙動を固定する property-based test を書く: ランダムな Assignment 構成（TeamAssignment / ReviewAssignment の有無・組み合わせ）と **role arbitrary（`REVIEWER` / `TEAM_LEADER` / `ADMIN`）** に対し、`isBugCondition_visibility` が false の入力で `getAccessibleSessionIds` の結果が修正前実装と一致する
  - **ADMIN 全件（`null`）維持を role arbitrary で明示的に検証する**: role が `ADMIN` のとき `getAccessibleSessionIds` が常に `null`（＝全件）を返し続けることをアサートする（本修正が ADMIN パスを変えないことの保証）
  - 対象: `backend/src/services/access-control-service.ts`（`getAccessibleSessionIds`）
  - テストファイル: `backend/src/services/access-control-service.property.test.ts`（co-located, `{ numRuns: 100 }`）
  - 各 `describe` は `Feature: reviewer-uploaded-session-not-visible, Property 2: ...` 形式、`it` の docstring に `**Validates: Requirements 3.1, 3.2, 3.3, 3.6**` を記載
  - 未修正コードで実行する
  - **EXPECTED OUTCOME**: テストが PASS する（保持すべきベースライン挙動を確認）
  - テスト作成・実行・PASS の確認が済んだらタスク完了とする
  - _Preservation: Preservation Requirements (bugfix 3.1, 3.2, 3.3, 3.6) from design_
  - _Requirements: 3.1, 3.2, 3.3, 3.6_

- [x] 4. メディア取得・スキャン状態の Preservation プロパティテストを書く（修正前）
  - **Property 4: Preservation** - メディア取得・スキャン状態チェックの不変
  - **IMPORTANT**: observation-first（観測優先）方法論に従う
  - 未修正コードで非バグ入力の挙動を観測する（`isBugCondition_mediaLink` が false、= MediaFile が `sessionId` にリンク済み）:
    - `getBySessionId` が非 null かつ `scanStatus=CLEAN` → 署名付き URL + `expiresAt` を返す（フォールバックを使わない）（bugfix 3.4）
    - `scanStatus=PENDING` → 403 `MEDIA_SCAN_PENDING`、`scanStatus=INFECTED` → 403 `MEDIA_MALWARE_DETECTED`（bugfix 3.5）
  - 観測した挙動を固定する property-based test を書く: リンク済み MediaFile に対し、scanStatus の各値（CLEAN / PENDING / INFECTED）で修正前後の結果（URL / 403 コード）が一致する
  - **Property 5: Preservation** - process-job-complete のセッション再利用 も本タスクに含める:
    - `job.sessionId` が設定済みの job を `process-job-complete` が処理する際、既存セッションを再利用し、重複した空セッション（`SK=METADATA`）を作らないことをアサートする（bugfix 3.7）
  - 対象: `backend/src/services/media-service.ts`（`getMediaFileForSession`）, `process-job-complete` 連携
  - テストファイル: `backend/src/services/media-service.property.test.ts`（Property 1/3 と同居可、`{ numRuns: 100 }`）
  - 各 `describe` は `Feature: reviewer-uploaded-session-not-visible, Property 4/5: ...` 形式、`it` の docstring に `**Validates: Requirements 3.4, 3.5, 3.7**` を記載
  - 未修正コードで実行する
  - **EXPECTED OUTCOME**: テストが PASS する（保持すべきベースライン挙動を確認）
  - テスト作成・実行・PASS の確認が済んだらタスク完了とする
  - _Preservation: Preservation Requirements (bugfix 3.4, 3.5, 3.7) from design_
  - _Requirements: 3.4, 3.5, 3.7_

- [x] 5. 修正を実装する（可視性 + メディアリンク）

  - [x] 5.1 可視性修正: `createSessionForJob` がアップローダーに ReviewAssignment を冪等作成する（採用案 A）
    - `backend/src/services/session-service.ts` の `createSessionForJob(transcriptionJobId, name, teamId?, assignedUserId?)` を変更する
    - `createSession(input)` 成功後、`assignedUserId` が指定されている場合のみ `createReviewAssignment({ userId: assignedUserId, sessionId, createdBy: assignedUserId })` を呼ぶ
    - `backend/src/repositories/team-repository.js` から `createReviewAssignment` を named import（`.js` 拡張子、ESM）。これが `getAccessibleSessionIds` の参照する `PK=USER#{userId}, SK=ASSIGNMENT#{sessionId}` アイテムを生成する
    - `createReviewAssignment` の冪等性（固定キー PUT）に依存し、再トランスクリプションでも安全にする
    - レイヤリング厳守: Service(`session-service`) → Repository(`team-repository.createReviewAssignment`, `session-repository.createSession`)。Handler は変更しない
    - **ロール横断の確認観点**: 修正がアップローダーのロールに非依存で機能すること — 非 ADMIN のアップローダー（`REVIEWER` / `TEAM_LEADER`）を `getAccessibleSessionIds` 経由で一覧に到達させ（TeamLeader の teamId ありケースも ReviewAssignment で到達）、ADMIN アップローダーの `null`（全件）挙動は変えないことを確認する
    - _Bug_Condition: isBugCondition_visibility(X) from design_
    - _Expected_Behavior: Property 1（可視性）- getAccessibleSessionIds(uploader) が sessionId を含む from design_
    - _Preservation: Property 2（bugfix 3.1, 3.2, 3.3, 3.6）from design_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.2 メディアリンク修正: `startJob` の空 catch を明示的ハンドリングに変える（採用案 D）
    - `backend/src/services/transcription-job-service.ts` の `startJob(params)` を変更する
    - `try { createSessionForJob → jobRecord.sessionId 設定 → updateSessionId } catch {}` の空 catch を廃止する
    - catch 節で `console.error('Failed to create/link session for job', { jobId, mediaFileId, error })` を記録し、無言の握りつぶしをやめる（bugfix 2.4）
    - job 自体は保全する（Req 17.8）: 例外を再 throw せず、`jobRecord.sessionId` 未設定のまま `transcriptionJobRepository.save(jobRecord)` を継続する
    - `createSessionForJob` と `updateSessionId` を分離して扱い、どちらで失敗したかをログに残す（セッションは作れたがリンクに失敗、のケースを識別可能にする）
    - レイヤリング厳守: Handler は変更しない
    - _Bug_Condition: isBugCondition_mediaLink(X) from design_
    - _Expected_Behavior: Property 3 (a) リンク失敗を無言で残さず検知・記録 from design_
    - _Preservation: Property 5（bugfix 3.7 - process-job-complete のセッション補完・再利用を壊さない）from design_
    - _Requirements: 2.4_

  - [x] 5.3 メディアリンク修正: 取得時フォールバック解決・補償を `media-service` に追加する（採用案 D）
    - `backend/src/services/media-service.ts` の `getMediaFileForSession(sessionId)` を変更する
    - `mediaFileRepository.getBySessionId(sessionId)` が `null` のとき **のみ** フォールバックを走らせる: `session-repository.getSessionById(sessionId)` → `transcriptionJobId` → `transcription-job-repository` で `job.mediaFileId` を解決 → `mediaFileRepository.getById(mediaFileId)` で MediaFile 取得
    - フォールバックで解決できたら `mediaFileRepository.updateSessionId(mediaFileId, sessionId)` でリンクを補償（自己修復）し、以降の `getBySessionId` が成功するようにする
    - フォールバックでも解決できない場合のみ従来どおり `MEDIA_FILE_NOT_FOUND`（404）を throw する
    - `scanStatus` チェック（CLEAN/PENDING/INFECTED → 200/403/403）は**解決後の MediaFile に対して従来どおり**適用し、挙動を変えない（bugfix 3.4, 3.5）
    - リンク済みセッション（`isBugCondition_mediaLink` が false）のコードパスは一切変えない（Property 4 保証）
    - レイヤリング厳守: `media-service`（Service）→ `media-file-repository` / `session-repository` / `transcription-job-repository`（Repository）。Handler は変更しない
    - 既存の壊れたデータ（Admin 後付け割り当てケース bugfix 1.6 / 2.6 含む）は、本フォールバックで次回のメディア取得時に自己修復される
    - _Bug_Condition: isBugCondition_mediaLink(X) from design_
    - _Expected_Behavior: Property 3 (b) getMediaUrl 時に job.sessionId→mediaFileId で再解決・補償、CLEAN なら署名付き URL from design_
    - _Preservation: Property 4（bugfix 3.4, 3.5 - リンク済みメディアと scanStatus 分岐の不変）from design_
    - _Requirements: 2.5, 2.6_

  - [x] 5.4 可視性バグの探索テストが PASS することを検証する
    - **Property 1: Expected Behavior** - 可視性の整合（アップロード由来セッションが一覧に出る）
    - **IMPORTANT**: タスク 1 の **同じ** テストを再実行する。新しいテストを書かない
    - タスク 1 のテストは期待挙動をエンコードしており、PASS することで期待挙動の充足を確認する
    - タスク 1 の可視性探索 property-based test を実行する
    - **EXPECTED OUTCOME**: テストが PASS する（`getAccessibleSessionIds(uploader)` が sessionId を含み、assigned ⊆ listed の整合が保たれ、バグが解消したことを確認）
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.5 メディアリンクバグの探索テストが PASS することを検証する
    - **Property 3: Expected Behavior** - メディアが解決できる
    - **IMPORTANT**: タスク 2 の **同じ** テストを再実行する。新しいテストを書かない
    - タスク 2 のメディアリンク探索 property-based test を実行する
    - **EXPECTED OUTCOME**: テストが PASS する（フォールバック補償後に `getMediaFileBySessionId` が非 null、CLEAN なら署名付き URL、`MEDIA_FILE_NOT_FOUND` を返さない。Admin 後付け割り当てケースも取得成功）
    - _Requirements: 2.4, 2.5, 2.6_

  - [x] 5.6 Preservation テストが引き続き PASS することを検証する
    - **Property 2: Preservation** - 既存可視性の不変 / **Property 4: Preservation** - メディア取得・スキャン状態の不変 / **Property 5: Preservation** - process-job-complete のセッション再利用
    - **IMPORTANT**: タスク 3・タスク 4 の **同じ** テストを再実行する。新しいテストを書かない
    - タスク 3（可視性 Preservation）とタスク 4（メディア取得・scanStatus・process-job-complete Preservation）の property-based test を実行する
    - **EXPECTED OUTCOME**: すべてのテストが PASS する（修正後もリグレッションなし）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. 単体テストを追加・更新する
  - `session-service.createSessionForJob`: `assignedUserId` あり → `createReviewAssignment` が正しいキー（`userId`/`sessionId`/`createdBy`）で呼ばれる。`assignedUserId` なし → 呼ばれない。再実行が冪等
  - `transcription-job-service.startJob`: `createSessionForJob` 失敗時にログ記録され job が保全される（例外を再 throw しない、`sessionId` 未設定で save）。`updateSessionId` 失敗時も同様
  - `media-service.getMediaFileForSession`: `getBySessionId` null → フォールバックで `session→job→mediaFileId` 解決 → `updateSessionId` 補償 → MediaFile 返却。フォールバックでも解決不能 → `MEDIA_FILE_NOT_FOUND`。解決後の scanStatus 分岐（CLEAN/PENDING/INFECTED）
  - `access-control-service.getAccessibleSessionIds`: ReviewAssignment 追加でアップロード由来 sessionId が含まれる（ADMIN は `null` 維持）
  - テストは AWS SDK を `vi.mock()` でモックし、Handler / Service / Repository を独立に検証する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2_

- [x] 7. Checkpoint - すべてのテストが PASS することを確認する
  - `cd backend && npx vitest --run` でユニット + プロパティテストを実行する
  - Property 1/3（Fix）が PASS、Property 2/4/5（Preservation）が PASS、追加した単体テストが PASS することを確認する
  - 疑問が生じたらユーザーに確認する

## 運用対応タスク（必須）

design.md「既存の壊れたデータの扱い」節の「可視性バックフィル」を正式タスク化したもの。コード修正（タスク 1〜7）で既存の壊れたデータ（修正前に作られた ReviewSession）は一覧可視性には及ばないため、バックフィルと E2E 検証を必須タスクとして実施する。

- [x] 8. 可視性バックフィルスクリプトを作成する（`infra/scripts/`）
  - **目的**: コード修正前に作成済みの Reviewer / TeamLeader アップロード由来 ReviewSession は `ReviewAssignment` を持たず、`getAccessibleSessionIds` が返さないためセッション一覧に出ない。既存の `SessionParticipant`（アップローダー）を走査し、対応する `ReviewAssignment` を生成するワンショット運用スクリプトを作る
  - 配置: `infra/scripts/backfill-review-assignments.ts`（運用スクリプトは `infra/lib/` ではなく `infra/scripts/`。structure.md の「新規トップレベルディレクトリ禁止」を遵守）
  - 実行方式: infra の `package.json` に `ts-node` が devDependency として存在するため、`npx ts-node infra/scripts/backfill-review-assignments.ts` で直接実行する形にする（ビルド不要）。実装者は infra のスクリプト実行手段を実コードで確認し、プロジェクトに合う方式を最終決定する
  - AWS SDK: `@aws-sdk/lib-dynamodb`（`DynamoDBDocumentClient`）を使用。`DYNAMODB_TABLE_NAME`（既定 `TranscriptionReviewApp`）と `AWS_REGION`（`ap-northeast-1`）を環境から尊重する
  - 書き込みレイアウト: `backend/src/repositories/team-repository.ts` の `createReviewAssignment` と**同一のキーレイアウト**で PUT する — `PK=USER#{userId}`, `SK=ASSIGNMENT#{sessionId}`, `GSI1PK=SESSION#{sessionId}`, `GSI1SK=USER#{userId}`, `entityType='ReviewAssignment'`, `createdBy`（アップローダー自身）, `createdAt`
  - dry-run デフォルト: `--execute` 指定時のみ実書き込み（`destroy.sh` の `--dryrun` / `--execute` 規約に合わせる）。dry-run では生成予定の `ReviewAssignment` 数と対象セッション一覧の要約を表示する
  - 冪等性: 既に `ReviewAssignment` が存在する (userId, sessionId) の組はスキップ（`createReviewAssignment` は固定キー PUT なので安全だが、dry-run の件数表示のために既存チェックを行う）。再実行しても重複・副作用がない
  - 環境指定: `--env dev|staging|prod`（`destroy.sh` と同じ流儀）。`prod` は明示確認（対話プロンプト）を入れる
  - 対象範囲の限定: Reviewer / TeamLeader アップロード由来に限定し、**ADMIN は除外**（ADMIN は `getAccessibleSessionIds` が `null` 全件で一覧に出るため割り当て不要）。判定は「`ReviewAssignment` も `TeamAssignment` も存在しないアップロード由来セッション」を対象とし、そのアップローダー（`SessionParticipant`）に対応する User の `role` が `ADMIN` でないものに限定する。実装者は `session-repository.ts` / `team-repository.ts` / `user-repository.ts` の single-table キーレイアウトを**実コードで確認してから**抽出・判定ロジックを確定する
  - ヘッダコメント: `destroy.sh` に倣い、usage / options / 冪等性 / 対象範囲を記述する README 的ヘッダを付ける
  - **テスト**: 対象抽出・ADMIN 除外・冪等スキップ判定のコアロジックを純粋関数に切り出し、`infra/test/backfill-review-assignments.test.ts`（`{name}.test.ts` 規約）にユニットテストを書く。AWS 呼び出しはモックし、dry-run のロジック（対象件数算出・ADMIN 除外・既存割り当てスキップ）を検証する。実 AWS に対する実行は運用手順として記載するのみ
  - _Requirements: 2.1, 2.2, 2.3_
  - _Preservation: 3.1, 3.2, 3.6 — 既存のアクセス制御と ADMIN 全件を壊さない。具体的には ADMIN セッション／ADMIN アップロード由来セッションに余計な割り当てを作らない（ADMIN 除外）、および他人のセッションに割り当てを作らない（アップローダー本人 = 対応 `SessionParticipant` の userId にのみ `ReviewAssignment` を生成する）_

- [x] 9. E2E 検証を追加する（Playwright, `e2e/`）
  - **目的**: デプロイ済み環境に対し、修正後のフルフロー（可視性 + メディア取得）を検証する
  - 配置: `e2e/tests/sessions/reviewer-uploaded-session-visibility.spec.ts`（既存 `e2e/tests/sessions/` の spec に倣う）
  - 検証シナリオ:
    1. Reviewer アップロード → ジョブ完了 → セッション一覧（`GET /sessions` / 一覧画面）にそのセッションが出る（_Requirements: 2.1, 2.2, 2.3_）
    2. TeamLeader アップロード → ジョブ完了 → セッション一覧にそのセッションが出る（_Requirements: 2.1, 2.2, 2.3_）
    3. 校閲画面を開くとメディア取得（署名付き URL）が成功する — 「メディアファイルが見つかりません」「データの取得に失敗しました」「リソースが見つかりません」のエラーが出ないことをアサートする（_Requirements: 2.5, 2.6_）
  - フィクスチャ / ヘルパ活用: `fixtures/auth.ts`（`loginAsReviewer` / `loginAsTeamLeader` は既存。`loginAsAdmin` も既存）、`helpers/api-helper.ts`（`apiRequest`, `createUser`, `createTeam`, `addTeamMember`）、`helpers/dynamodb-helper.ts`（`ensureUserRecord`）、`helpers/ui-helper.ts`、`helpers/cognito-helper.ts` を活用する。実装者は `auth.ts` のフィクスチャを確認し、不足があれば必要最小限のみ追加する
  - アクセシビリティ: `helpers/axe-helper.ts` が存在するため、既存 spec の方針に合わせて画面検証に含める（過度には求めない）
  - 前提・実行: デプロイ環境 + `e2e/.env` が前提。実行は運用手順（`e2e/SETUP.md` 準拠）として spec ヘッダコメントに記載し、CI 不在でもローカルから `cd e2e && npx playwright test tests/sessions/reviewer-uploaded-session-visibility.spec.ts` で動く形にする
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_
