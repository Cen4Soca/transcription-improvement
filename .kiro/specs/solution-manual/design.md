# Design Document

## Overview

本設計は、Transcription Review App のエンドユーザー向け操作マニュアルを Playwright E2E 実行経由で半自動生成する「ソリューション・マニュアル」機能を定義する。

パイプラインは 2 段階である。

1. **収集フェーズ（spec 実行）**: `e2e/manual/` 配下の Manual_Spec 群を Playwright で実行する。各 spec は `Auth_Fixture` で対象ロールにログインし、実際の画面を遷移しながら `ManualRecorder.capture()` で手順メタデータとスクリーンショットを収集し、最後に `flush()` で `output/steps/{slug}.json`（Steps_JSON）を書き出す。スクリーンショットは `output/screenshots/*.png` に保存される。
2. **ビルドフェーズ（Manual_Builder）**: 新規スクリプト `e2e/manual/build-manual.ts` が、`output/steps/*.json` を全読込し、section 単位にグループ化・order 昇順ソート・section をマニュアル規定順に並べ、`output/manual.html`（Manual_HTML）を単一ファイルとして生成する。HTML はインライン CSS/JS で完結し、ロールフィルタ・ロールバッジ・日本語 UI・アクセシブルな見出し構造を備える。

既存資産（`ManualRecorder`、`Auth_Fixture`、`01-login.spec.ts`）はそのまま再利用する。`ManualRecorder` は変更しない方針とし、新規追加は Manual_Spec 群（02〜08）、Manual_Builder、npm script のみとする。

言語・構造の制約は既存の steering（tech / structure）に従う。TypeScript ESM、相対 import は `.js` 拡張子、コメントは日本語、新しいトップレベルディレクトリは作らず `e2e/manual/` 配下に収める。

## Architecture

### コンポーネント構成

```
e2e/
├── fixtures/
│   └── auth.ts                      # 既存。loginAsReviewer / loginAsTeamLeader / loginAsAdmin
├── manual/
│   ├── manual-recorder.ts           # 既存。ManualRecorder（capture / flush）。変更なし
│   ├── 01-login.spec.ts             # 既存。ログイン
│   ├── 02-home.spec.ts              # 新規。ホーム（校閲セッション一覧）
│   ├── 03-review.spec.ts            # 新規。文字起こし校閲
│   ├── 04-consensus.spec.ts         # 新規。Consensus（多数決）
│   ├── 05-upload.spec.ts            # 新規。アップロード
│   ├── 06-language-models.spec.ts   # 新規。言語モデル管理
│   ├── 07-ranking.spec.ts           # 新規。ランキング
│   ├── 08-admin.spec.ts             # 新規。管理（ユーザー管理・IP制御・監査ログ）
│   ├── build-manual.ts              # 新規。Manual_Builder
│   └── output/                      # 生成物（gitignore 対象想定）
│       ├── screenshots/*.png        # capture() が出力
│       ├── steps/*.json             # flush() が出力（Steps_JSON）
│       └── manual.html              # Manual_Builder が出力（Manual_HTML）
└── package.json                     # 新規 script: manual / manual:build
```

### レイヤー責務

| コンポーネント | 責務 | 変更種別 |
|----------------|------|----------|
| Manual_Spec（02〜08） | 対象ロールで認証し、画面を遷移しながら `capture()` で手順を記録、末尾で `flush()` | 新規 |
| ManualRecorder | スクショ撮影 + メタデータ収集 + Steps_JSON 書き出し | 既存・再利用（変更なし） |
| Auth_Fixture | ロール別ログイン fixture を提供 | 既存・再利用 |
| Manual_Builder | Steps_JSON 集約 → グループ化・ソート → 単一 HTML 生成 | 新規 |
| Manual_HTML | 成果物。全ロール・全セクションの手順 + ロールフィルタ + バッジ | 生成物 |

### データフロー

```
┌──────────────┐   capture()    ┌─────────────────────┐
│ Manual_Spec  │ ─────────────▶ │ ManualRecorder      │
│ (02〜08)     │   flush()      │                     │
└──────────────┘                └──────────┬──────────┘
      │ Auth_Fixture でログイン             │ 書き出し
      ▼                                     ▼
 live browser (deployed env)      output/screenshots/*.png
                                  output/steps/{slug}.json  (Steps_JSON)
                                          │
                                          │ npm run manual:build
                                          ▼
                                  ┌─────────────────────┐
                                  │ Manual_Builder       │
                                  │ (build-manual.ts)    │
                                  │  1. 全 Steps_JSON 読込 │
                                  │  2. section グループ化 │
                                  │  3. order 昇順ソート   │
                                  │  4. 規定 section 順配置 │
                                  │  5. HTML 文字列生成     │
                                  └──────────┬──────────┘
                                             ▼
                                  output/manual.html (Manual_HTML)
                                   └ 画像は screenshots/ を相対参照
```

収集フェーズとビルドフェーズは疎結合である。両者の唯一の契約は Steps_JSON のスキーマ（`{ section, slug, steps: ManualStep[] }`）と、スクリーンショットの相対パス（`screenshots/xxx.png`）である。これにより Manual_Builder は live browser に依存せず、純粋なファイル入力 → HTML 文字列出力の変換として単体テスト可能になる。

## Components and Interfaces

### Manual_Step / Steps_JSON（既存スキーマ・契約）

`manual-recorder.ts` で定義済みの型をそのまま契約とする。

```typescript
export type ManualRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';

export interface ManualStep {
  section: string;      // 機能セクション名（例: "ホーム", "文字起こし校閲"）
  order: number;        // セクション内の表示順（capture 呼び出し順 = 1,2,3...）
  title: string;        // 手順見出し
  description: string;  // 手順説明（日本語）
  roles: ManualRole[];  // この手順を閲覧/操作できるロール（1 つ以上）
  screenshot: string;   // "screenshots/xxx.png"（HTML からの相対参照）
}

// steps/{slug}.json の中身
interface StepsJson {
  section: string;
  slug: string;
  steps: ManualStep[];
}
```

### Manual_Spec（02〜08）

各 spec は `01-login.spec.ts` のパターンに従う。構造テンプレート:

```typescript
import { test } from '../fixtures/auth.js';
import { ManualRecorder } from './manual-recorder.js';

/**
 * マニュアル・セクション「{セクション名}」。
 * {対象ロールと撮影内容の説明}
 */
test('manual: {セクション名}', async ({ page, loginAsXxx }) => {
  const rec = new ManualRecorder(page, '{セクション名}', '{slug}');

  await loginAsXxx(page);
  // 画面へ遷移
  await rec.capture({ title, description, roles, /* fullPage, settleMs */ });
  // 次の操作 → capture ...

  rec.flush();
});
```

- 認証は `Auth_Fixture`（`loginAsReviewer` / `loginAsTeamLeader` / `loginAsAdmin`）を用いる（R3.1）。
- TEAM_LEADER 固有（言語モデル管理）は `loginAsTeamLeader` または `loginAsAdmin`（R3.2）。本設計では確実に全画面を撮れる `loginAsAdmin` を既定採用する。
- ADMIN 固有（管理機能）は `loginAsAdmin`（R3.3）。
- セレクタ・遷移は既存テスト（`tests/sessions`、`tests/navigation`、`tests/upload`、`tests/language-models`、`tests/ranking`、`tests/admin`）に準拠する。
- `description` は日本語で記述する（R1.4）。
- `roles` は各手順の閲覧/操作可能ロールを設定する（R3.4、R1.5）。

#### 各 Manual_Spec が撮影する画面・手順の一覧

既存テスト・コンポーネントから確認したセレクタに基づく撮影計画。seed 済みメディアセッション `e2e-session-001`（mp3 + 5 segments）を校閲画面に使う。

**02-home.spec.ts** — セクション「ホーム」（slug: `home`、`loginAsAdmin`）
参照: `tests/sessions/session-list.spec.ts`, `tests/navigation/navigation.spec.ts`, `helpers/ui-helper.ts`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 校閲セッション一覧 | ログイン後ホーム（`main[校閲セッション一覧]` + `list[セッション一覧]`） | REVIEWER, TEAM_LEADER, ADMIN |
| 2 | ステータスで絞り込む | `tablist[ステータスフィルター]` で「進行中」を選択した状態 | REVIEWER, TEAM_LEADER, ADMIN |
| 3 | ページを移動する | `navigation[ページネーション]` を表示 | REVIEWER, TEAM_LEADER, ADMIN |
| 4 | メインナビゲーション | `navigation[メインナビゲーション]`（メニュー差異の説明） | REVIEWER, TEAM_LEADER, ADMIN |

**03-review.spec.ts** — セクション「文字起こし校閲」（slug: `review`、`loginAsAdmin`）
参照: `tests/sessions/review-page.spec.ts`, `components/MediaPlayer.tsx`, `components/SuggestionPopup.tsx`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 校閲画面の全体構成 | `./sessions/e2e-session-001` → `main[校閲画面]`（文字起こしパネル + メディアパネル） | REVIEWER, TEAM_LEADER, ADMIN |
| 2 | セグメントを選んで編集する | 先頭 `listitem` クリック → `編集テキスト` textarea 表示 | REVIEWER, TEAM_LEADER, ADMIN |
| 3 | 編集を確定する | textarea 入力 → `button[編集を確定]`（確定後の修正後テキスト表示） | REVIEWER, TEAM_LEADER, ADMIN |
| 4 | 音声と同期して再生する | `region[メディアプレイヤー]`（`button[再生]`・`[シーク]`・`group[再生速度]`） | REVIEWER, TEAM_LEADER, ADMIN |
| 5 | AI 修正候補を表示する | `button[修正候補を表示]` クリック → `dialog[修正候補]`（`listbox[候補一覧]`） | REVIEWER, TEAM_LEADER, ADMIN |
| 6 | レイアウトを切り替える | `button[レイアウトを上下分割に切り替え]` | REVIEWER, TEAM_LEADER, ADMIN |
| 7 | 修正後 Transcription をダウンロードする | 校閲画面下部の `div[aria-label=Transcription ダウンロード]`（見出し「修正後 Transcription ダウンロード」）で形式ラジオ `JSON`/`SRT` を選び `button[ダウンロード]` を押す | REVIEWER, TEAM_LEADER, ADMIN |

AI 修正候補は外部 API コスト/非決定性があるため、`page.route` で `suggestions` 取得 API を固定レスポンスに差し替えてから撮影する（決定論的なスクショのため）。ダウンロード API（transcriptionApi.downloadJson / downloadSrt）は実データ取得・ブラウザDL副作用があるため `page.route` で固定レスポンスに差し替え、実ファイル保存は発火させずフォーム表示状態を撮影する。

**04-consensus.spec.ts** — セクション「Consensus」（slug: `consensus`、`loginAsAdmin`）
参照: `components/SessionAggregateControls.tsx`（`button[強制集約して確定]`）, `components/ConflictResolutionPanel.tsx`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 多数決による確定の概要 | 校閲画面の集約操作エリア（`group[強制集約の操作]`） | TEAM_LEADER, ADMIN |
| 2 | 強制集約して確定する | `button[強制集約して確定]` クリック → `group[強制集約の確認]` 表示 | TEAM_LEADER, ADMIN |
| 3 | 競合を解決する | 競合解決パネル（`CONFLICT` セグメントの候補と件数、確定ステータス 確定済み/未確定/競合解決待ち） | ADMIN |

集約確定・競合解決は確定操作のため、`page.route` で集約 API を成功レスポンスに差し替えて UI 状態のみ撮影する（seed データを汚さない）。

**05-upload.spec.ts** — セクション「アップロード」（slug: `upload`、`loginAsReviewer`）
参照: `tests/upload/media-upload.spec.ts`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | アップロード画面 | `menuitem[メディアアップロード]` → `main[メディアアップロード]`（`button[ファイルを選択…]`、対応形式） | REVIEWER, TEAM_LEADER, ADMIN |
| 2 | ファイルを選択する | `input[type=file]` に音声ファイル投入 → `[選択されたファイル]` 表示 | REVIEWER, TEAM_LEADER, ADMIN |
| 3 | アップロードを開始する | `button[アップロード開始]` クリック後の進捗/完了表示 | REVIEWER, TEAM_LEADER, ADMIN |
| 4 | 文字起こしジョブを作成する | アップロード画面下部の `section[文字起こしジョブ作成セクション]` → `form[Transcription ジョブ作成フォーム]`（見出し「文字起こしジョブ作成」）で `select#media-file-select`・`input#max-speaker-labels`(2〜10)・`select#language-code-select`・カスタム言語モデル(任意) を設定 | REVIEWER, TEAM_LEADER, ADMIN |
| 5 | ジョブを開始する | `button[文字起こしジョブを開始]` を押してジョブを開始（開始後はセッション一覧へ誘導） | REVIEWER, TEAM_LEADER, ADMIN |

`upload-url` と S3 PUT は `page.route` で成功固定（`tests/upload` と同手法）し、実 S3 を叩かない。ジョブ開始 API（transcriptionApi.startJob）とモデル一覧取得（languageModelApi.listModels）は外部コスト/副作用があるため `page.route` で成功固定し、実ジョブを起動せず UI 状態のみ撮影する。

**06-language-models.spec.ts** — セクション「言語モデル管理」（slug: `language-models`、`loginAsAdmin`）
参照: `tests/language-models/language-model.spec.ts`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 言語モデル管理画面 | `menuitem[言語モデル管理]` → 新規モデル作成フォーム（`label[モデル名]`、ベースモデル） | TEAM_LEADER, ADMIN |
| 2 | ベースモデルを選ぶ | `radio[NarrowBand]` / `radio[WideBand]` | TEAM_LEADER, ADMIN |
| 3 | 対象セッションを選ぶ | チーム選択 → 候補セッションの `checkbox` | TEAM_LEADER, ADMIN |
| 4 | モデル一覧とステータス | `list[カスタム言語モデル一覧]`（ステータスバッジ） | TEAM_LEADER, ADMIN |

読み取り系 API（`/me/teams`、`/sessions`、`/language-models`、assignments）は `tests/language-models` と同じく `page.route` でモック固定し、決定論的に撮影する（実モデル作成の副作用を回避）。

**07-ranking.spec.ts** — セクション「ランキング」（slug: `ranking`、`loginAsReviewer`）
参照: `tests/ranking/ranking.spec.ts`

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | ランキング画面 | `menuitem[ランキング]` → `table[ランキングテーブル]`（順位/ユーザー名/回答数/正答率/スコア） | REVIEWER, TEAM_LEADER, ADMIN |
| 2 | 期間で切り替える | `tablist[期間フィルター]`（全期間/今月/直近30日） | REVIEWER, TEAM_LEADER, ADMIN |
| 3 | 自分の順位を確認する | 現ユーザー行の「あなた」バッジ（`page.route` で現ユーザー入りデータ注入） | REVIEWER, TEAM_LEADER, ADMIN |

**08-admin.spec.ts** — セクション「管理 - ユーザー管理」「管理 - IP制御」「管理 - 監査ログ」（`loginAsAdmin`）
参照: `tests/admin/user-management.spec.ts`, `tests/admin/ip-allowlist.spec.ts`, `tests/admin/audit-logs.spec.ts`

本 spec は 1 ファイル内でサブセクションごとに別 `ManualRecorder`（別 slug）を使い、Steps_JSON を分けて書き出す。これにより R2.8（ユーザー管理・IP制御・監査ログを含む）を満たしつつ、Manual_Builder が管理配下を複数グループとして扱える。slug は `admin-users` / `admin-ip` / `admin-audit`。

- セクション「管理 - ユーザー管理」（slug: `admin-users`）

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 管理画面を開く | `menuitem[管理]` → `main[管理画面]`（`tablist[管理画面タブ]`） | ADMIN |
| 2 | ユーザー一覧 | `tab[ユーザー管理]` → `table[ユーザー一覧テーブル]` | ADMIN |
| 3 | ユーザーを登録する | `button[ユーザー追加]` → `form[ユーザー登録フォーム]`（メール/表示名/ロール） | ADMIN |

- セクション「管理 - IP制御」（slug: `admin-ip`）

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | IPアドレス制限 | `tab[IPアドレス制限]` → `table[IPアドレス許可リストテーブル]` | ADMIN |
| 2 | エントリを追加する | `button[エントリ追加]` → `form[IPエントリ追加フォーム]` | ADMIN |

- セクション「管理 - 監査ログ」（slug: `admin-audit`）

| order | title | 画面/操作 | roles |
|-------|-------|-----------|-------|
| 1 | 監査ログ一覧 | `tab[監査ログ]` → `table[監査ログテーブル]` | ADMIN |
| 2 | 操作種別で絞り込む | `form[監査ログフィルタ]` の `label[操作種別]` | ADMIN |

ユーザー登録フォーム撮影は「フォーム表示状態」までに留め、登録 POST（Cognito 招待メール）は送信しない。IP 追加は撮影せずフォーム表示まで（WAF 許可リストを汚さない）。監査ログ削除は撮影しない。これらは閲覧用スクショのみで要件（手順提供）を満たす。

### Manual_Builder（build-manual.ts）

純粋変換関数と I/O ラッパに分離し、変換部を単体テスト可能にする。

```typescript
// --- 型 ---
type ManualRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';
interface ManualStep { section: string; order: number; title: string; description: string; roles: ManualRole[]; screenshot: string; }
interface StepsJson { section: string; slug: string; steps: ManualStep[]; }
interface SectionGroup { section: string; steps: ManualStep[]; } // steps は order 昇順

// --- セクション規定順（R4.4）。先頭一致でカテゴリ化し、"管理 - *" は「管理」へ畳む ---
const SECTION_ORDER = [
  'ログイン', 'ホーム', '文字起こし校閲', 'Consensus',
  'アップロード', '言語モデル管理', 'ランキング', '管理',
] as const;

const ALL_ROLES: ManualRole[] = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'];

// --- 純粋関数（単体テスト対象） ---

/** Steps_JSON 配列を 1 本の ManualStep 配列へ平坦化する。 */
function collectSteps(files: StepsJson[]): ManualStep[];

/** canonical 順にグループ化し、各グループ内を order 昇順にソートする（R4.3, R4.4）。 */
function groupAndSort(steps: ManualStep[]): SectionGroup[];

/** section 名を規定カテゴリへ正規化（"管理 - ユーザー管理" → "管理" で並び順を決定）。 */
function sectionRank(section: string): number;

/** ManualStep → HTML 断片（バッジ・alt・data-roles を含む）。 */
function renderStep(step: ManualStep): string;

/** SectionGroup[] → 完全な HTML 文書（html lang=ja, h1/h2, フィルタ, インライン CSS/JS）。 */
function renderHtml(groups: SectionGroup[]): string;

// --- I/O ラッパ（副作用） ---

/** steps/ の *.json を読み込む。0 件なら例外。 */
function loadStepsJson(stepsDir: string): StepsJson[];

/** main(): load → collect → group → render → writeFile。0 件時はエラー出力し process.exit(1)。 */
function main(): void;
```

**実行時の制御（R4.6）**: `loadStepsJson` が `output/steps/*.json` を 0 件しか見つけなかった場合、標準エラーに日本語のエラーメッセージ（例: 「steps JSON が見つかりません。先に `npm run manual` を実行してください。」）を出力し、`process.exitCode = 1` でプロセスを非ゼロ終了する。

**HTML 構造（R4.2, R4.3, R4.4, R5, R6, R7）**:

```html
<!doctype html>
<html lang="ja">                                      <!-- R6.3 -->
  <head>
    <meta charset="utf-8" />
    <title>Transcription Review App 操作マニュアル</title>
    <style>/* インライン CSS。バッジ色、.step[hidden] 用の表示制御等 */</style>
  </head>
  <body>
    <header>
      <h1>Transcription Review App 操作マニュアル</h1>   <!-- R7.1: 単一 h1 -->
      <!-- R5.2, R6.2, R7.3: ロールフィルタ -->
      <div role="group" aria-label="ロールで絞り込み" class="role-filter">
        <label><input type="radio" name="role" value="ALL" checked /> すべて</label>
        <label><input type="radio" name="role" value="REVIEWER" /> REVIEWER</label>
        <label><input type="radio" name="role" value="TEAM_LEADER" /> TEAM_LEADER</label>
        <label><input type="radio" name="role" value="ADMIN" /> ADMIN</label>
      </div>
    </header>
    <main>
      <!-- section ごと（R4.4 の規定順）。R7.1: h2 で階層を飛ばさない -->
      <section>
        <h2>ホーム</h2>
        <!-- order 昇順（R4.3） -->
        <article class="step" data-roles="REVIEWER TEAM_LEADER ADMIN">  <!-- R5.3 の契約 -->
          <h3>校閲セッション一覧</h3>                      <!-- h1→h2→h3 で飛ばさない -->
          <p class="roles">                                 <!-- R5.1, R6.2 バッジ -->
            <span class="badge badge-reviewer">REVIEWER</span> ...
          </p>
          <p class="desc">…日本語の説明…</p>                 <!-- R6.1 -->
          <img src="screenshots/home-01.png"
               alt="ホーム: 校閲セッション一覧 — …手順説明の日本語 alt…" />  <!-- R7.2 -->
        </article>
        ...
      </section>
      ...
    </main>
    <script>/* インライン JS。ロールフィルタ -> data-roles で表示/非表示 */</script>
  </body>
</html>
```

**ロールフィルタ JS の方針（R5.3, R5.4）**: 各手順 `<article class="step">` に `data-roles="REVIEWER TEAM_LEADER ADMIN"` のようにスペース区切りで roles を埋め込む。ラジオ `change` を単一リスナで監視し、選択値 `R` に対して各 `.step` を次のルールで表示切替する。

- `R === 'ALL'` → すべて表示（R5.4）。
- それ以外 → `step.dataset.roles.split(' ').includes(R)` が真の手順のみ表示、他は `hidden` 属性を付与（R5.3）。

セクション見出し（`<section>`）は、配下に表示中の手順が 1 件も無ければ併せて `hidden` にし、空セクションが残らないようにする。フィルタは純粋関数 `shouldShow(step, selection)` として分離し、ビルド時にその予測挙動を属性（`data-roles`）に反映することで、テストは JS 実行なしに「属性が roles と一致する」ことと「予測関数の選別結果」を検証できる。

**ロールバッジ（R5.1, R6.2）**: roles 配列を日本語 UI の一部として表示する。ラベルはロールトークン（REVIEWER/TEAM_LEADER/ADMIN）を使い、周辺 UI テキスト（見出し「ロールで絞り込み」「すべて」等）を日本語にすることで R6.2 を満たす。バッジ集合は必ず step.roles と一致し、既知 3 ロール以外は出力しない（R1.5）。

**見出し階層（R7.1）**: `h1`（文書タイトル）→ `h2`（各 section）→ `h3`（各手順 title）。section が存在しない場合でも、存在する section について h2 を必ず出し、h1 の次に h3 を直接置かない（レベルを飛ばさない）。

**alt テキスト（R7.2）**: 各 `img` の alt は `{section}: {title} — {description の要約}` 形式で、空にしない。HTML 特殊文字はエスケープする。

### npm script（R4.5）

`e2e/package.json` の `scripts` に追記する。

```json
{
  "scripts": {
    "manual": "playwright test manual/",
    "manual:build": "tsx manual/build-manual.ts"
  }
}
```

- `manual`: Manual_Spec 群を実行し Steps_JSON とスクショを生成する（収集フェーズ）。
- `manual:build`: Manual_Builder を `tsx` で実行し `output/manual.html` を生成する（ビルドフェーズ）。

## Data Models

### SECTION_ORDER（規定セクション順）

R4.4 の配置順を定義する不変の配列。`sectionRank(section)` は section 名の先頭カテゴリ（`管理 - ユーザー管理` → `管理`）を SECTION_ORDER のインデックスへ写像する。未知セクションは末尾（最大 rank）に置く。

### 正規化ルール

| 生の section 名 | 正規カテゴリ | rank |
|------------------|--------------|------|
| ログイン | ログイン | 0 |
| ホーム | ホーム | 1 |
| 文字起こし校閲 | 文字起こし校閲 | 2 |
| Consensus | Consensus | 3 |
| アップロード | アップロード | 4 |
| 言語モデル管理 | 言語モデル管理 | 5 |
| ランキング | ランキング | 6 |
| 管理 - ユーザー管理 / 管理 - IP制御 / 管理 - 監査ログ | 管理 | 7 |

グループ化は正規化後のカテゴリ単位で行い、「管理」配下は 3 サブセクション分の手順を order でまとめて並べる（サブセクション間の順は slug 既定順 users → ip → audit を維持するため、サブセクション識別子を order のプレフィックス相当として扱うか、slug 順に連結してから order でソートする）。

## Error Handling

| 事象 | 箇所 | 挙動 |
|------|------|------|
| Steps_JSON が 0 件 | Manual_Builder `loadStepsJson` | 日本語エラーメッセージを stderr に出力し、非ゼロ終了（R4.6） |
| Steps_JSON が不正 JSON | Manual_Builder | 当該ファイル名を含むエラーを出力して非ゼロ終了（部分破損で黙って成功しない） |
| スクリーンショットファイル欠落 | Manual_HTML | HTML は相対パスを参照するのみ。欠落時はブラウザ側で画像が壊れるが、alt が表示されるため情報は保全（R7.2） |
| 認証失敗（spec 実行時） | Manual_Spec / Auth_Fixture | Playwright のタイムアウトで spec が失敗。該当セクションの Steps_JSON は生成されない（他セクションには影響しない疎結合） |
| 外部 API コスト/非決定（AI 候補・集約・アップロード・モデル作成） | Manual_Spec | `page.route` で固定レスポンスに差し替え、副作用を回避しつつ決定論的に撮影 |

HTML 出力時はユーザー由来の文字列（title / description / section / screenshot パス）を HTML エスケープし、スクリプト注入を防ぐ。

## Testing Strategy

本機能は「E2E 収集ハーネス（Playwright + 既存 ManualRecorder + live browser）」と「純粋変換の Manual_Builder」から成る。テスト戦略は両者を切り分ける。

### Manual_Builder（新規コード）— ユニット + プロパティテスト

変換部（`collectSteps` / `groupAndSort` / `sectionRank` / `renderStep` / `renderHtml` / `shouldShow`）を純粋関数として切り出し、ファイル I/O なしで検証する。配置は構造制約に従い co-location（`e2e/manual/build-manual.test.ts` と `build-manual.property.test.ts`）。プロパティテストは fast-check、`{ numRuns: 100 }`、タグ形式は `Feature: solution-manual, Property N: ...`。HTML 検証はパーサ（例: 軽量な DOM パーサ）または正規表現ベースの属性抽出で行い、JS 実行は不要にする（フィルタは純粋関数で検証）。

ユニット/例・エッジ:
- `renderHtml` が `<html lang="ja">` を出力する（R6.3）。
- ロールフィルタに「すべて/REVIEWER/TEAM_LEADER/ADMIN」が各ラベル付きで存在する（R5.2, R7.3）。
- 日本語 UI 文字列（「ロールで絞り込み」「すべて」等）が存在する（R6.2）。
- Steps_JSON 0 件で `loadStepsJson`/`main` が非ゼロ終了しエラーメッセージを出す（R4.6、エッジ）。

### Manual_Spec 群・ManualRecorder（既存ハーネス）— スモーク/統合

これらは live browser と外部認証に依存し、入力バリエーションで挙動が変わらないため PBT 対象外。検証は次で行う。

- 各 `e2e/manual/{NN}-{section}.spec.ts` が存在し、規定セクションを記録する（R2.1〜2.8、ファイル存在 + 記録セクション名の確認）。
- 対象環境に対する `npm run manual` のスモーク実行で Steps_JSON とスクショが生成される（R1.1〜1.3）。
- 各 spec が正しい fixture（ロール）を使う（R3.1〜3.3、コードレビュー）。
- 手順 description が日本語、roles が有効ロールである（R1.4, R3.4、レビュー + Builder 側の roles 検証プロパティで補完）。

### プロパティとテストタイプの対応（prework 要約）

| 分類 | 受け入れ基準 |
|------|--------------|
| PROPERTY | 1.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 5.4, 5.5, 7.1, 7.2 |
| EXAMPLE | 5.2, 6.2, 6.3, 7.3 |
| EDGE_CASE | 4.6 |
| INTEGRATION | 1.1, 1.2, 1.3, 3.1 |
| SMOKE | 1.4, 2.1〜2.8, 3.2, 3.3, 3.4, 4.5, 6.1 |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 読み込みは全手順を保全する

*For any* 有限個の Steps_JSON 入力集合について、`collectSteps` が返す ManualStep 配列は、入力各ファイルの `steps` を漏れなく含み、総数は各ファイルの手順数の総和に等しい。

**Validates: Requirements 4.1**

### Property 2: 集約は単一 HTML にすべての手順を含める

*For any* Steps_JSON 入力集合について、`renderHtml(groupAndSort(collectSteps(files)))` が生成する単一 HTML は、入力の各 ManualStep につき 1 つの手順要素を含み、その手順の title、（エスケープ済み）description、screenshot パスをすべて含む。手順要素の総数は入力手順の総数に等しい。

**Validates: Requirements 4.2, 5.5**

### Property 3: セクション内は order 昇順に並ぶ

*For any* ManualStep 集合について、`groupAndSort` が返す各 SectionGroup 内の手順列は order の昇順（非減少）であり、同一 section の手順はすべて同一グループに属する。

**Validates: Requirements 4.3**

### Property 4: セクションは規定順に配置される

*For any* ManualStep 集合（任意のセクション部分集合・任意のファイル順）について、出力に現れるセクション（正規化カテゴリ）の並びは、規定順 `[ログイン, ホーム, 文字起こし校閲, Consensus, アップロード, 言語モデル管理, ランキング, 管理]` の部分列になっている。

**Validates: Requirements 4.4**

### Property 5: ロールフィルタ契約

*For any* ManualStep と任意のフィルタ選択値 `R`（`ALL` / `REVIEWER` / `TEAM_LEADER` / `ADMIN`）について、`shouldShow(step, R)` は `R === 'ALL'` のとき真、そうでなければ `R ∈ step.roles` のときにのみ真である。さらに、その手順要素の `data-roles` 属性は step.roles とちょうど一致する（表示判定が属性だけで決まる）。

**Validates: Requirements 5.3, 5.4**

### Property 6: ロールバッジは roles と一致し、既知ロールのみを含む

*For any* ManualStep について、`renderStep` が出力するロールバッジ集合は step.roles とちょうど一致し、空でなく、各要素は `{REVIEWER, TEAM_LEADER, ADMIN}` のいずれかである。

**Validates: Requirements 5.1, 1.5**

### Property 7: 見出し階層を飛ばさない

*For any* ManualStep 集合（1 件以上）について、生成 HTML は `h1` をちょうど 1 つ持ち、出力に現れる各セクションに対して `h2` を 1 つ持ち、各手順に `h3` を持つ。文書を先頭から走査したときの見出しレベル列は、レベルが増加する際に高々 1 ずつしか増えない（例: h1 の直後に h3 が来ない）。

**Validates: Requirements 7.1**

### Property 8: すべてのスクリーンショットに説明的な alt を持つ

*For any* ManualStep について、生成 HTML 中の対応する `img` 要素は空でない `alt` 属性を持ち、その alt は当該手順の title を含む。

**Validates: Requirements 7.2**
