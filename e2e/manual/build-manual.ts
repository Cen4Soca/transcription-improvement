import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { STEPS_DIR, OUTPUT_DIR } from './manual-recorder.js';
import type { ManualRole, ManualStep } from './manual-recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

// ManualRole / ManualStep は manual-recorder.ts のスキーマを再利用する（契約）。
export type { ManualRole, ManualStep };

/** steps/{slug}.json の中身（ManualRecorder.flush が書き出す形）。 */
export interface StepsJson {
  /** 機能セクション名（例: "ホーム", "文字起こし校閲"）。 */
  section: string;
  /** セクション識別子（スクショのファイル名プレフィックス）。 */
  slug: string;
  /** 当該セクションの手順一覧。 */
  steps: ManualStep[];
}

/** section 単位でグループ化した手順集合。steps は order 昇順に並ぶ。 */
export interface SectionGroup {
  /** 正規化後のセクション名（例: "管理"）。 */
  section: string;
  /** order 昇順にソート済みの手順列。 */
  steps: ManualStep[];
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/**
 * セクション規定順（R4.4）。
 * section 名の先頭カテゴリでグループ化し、"管理 - *" は「管理」へ畳む。
 */
export const SECTION_ORDER = [
  'ログイン',
  'ホーム',
  '文字起こし校閲',
  'Consensus',
  'アップロード',
  '言語モデル管理',
  'ランキング',
  '管理',
] as const;

/** マニュアルが対象とする全ロール。ロールフィルタ・バッジで使用する。 */
export const ALL_ROLES: ManualRole[] = ['REVIEWER', 'TEAM_LEADER', 'ADMIN'];

/** Manual_Builder が生成する単一成果物のパス。 */
export const MANUAL_HTML_PATH = path.resolve(OUTPUT_DIR, 'manual.html');

// ---------------------------------------------------------------------------
// HTML エスケープ用ヘルパ
// ---------------------------------------------------------------------------

/**
 * HTML テキスト／属性値を安全化する。
 * title / description / section / screenshot などユーザー由来の文字列に適用し、
 * スクリプト注入を防ぐ（& < > " ' をエスケープ）。
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// 純粋関数（単体テスト対象）。本体は後続タスクで実装するスタブ。
// ---------------------------------------------------------------------------

/** Steps_JSON 配列を 1 本の ManualStep 配列へ平坦化する（R4.1）。 */
export function collectSteps(files: StepsJson[]): ManualStep[] {
  // 入力ファイル順 → 各ファイルの steps 順を保って漏れなく平坦化する。
  return files.flatMap((file) => file.steps);
}

/**
 * 生の section 名を規定カテゴリ名へ正規化する。
 * "管理 - ユーザー管理" / "管理 - IP制御" / "管理 - 監査ログ" のように
 * "管理 - *" 形式のサブセクションは一律「管理」へ畳む。
 * それ以外の section 名はそのまま返す。
 */
function normalizeSection(section: string): string {
  // "管理" 配下のサブセクションは先頭カテゴリ「管理」へ写像する。
  if (section === '管理' || section.startsWith('管理 - ')) {
    return '管理';
  }
  return section;
}

/**
 * "管理" 配下サブセクションの既定表示順（slug 既定順 users → ip → audit）。
 * ManualStep には slug が無いため、生の section 名からサブセクション順位を導出する。
 * 「管理」配下以外や未知のサブセクションは 0（相対順序は order と安定ソートで決まる）。
 */
function adminSubRank(section: string): number {
  switch (section) {
    case '管理 - ユーザー管理':
      return 0;
    case '管理 - IP制御':
      return 1;
    case '管理 - 監査ログ':
      return 2;
    default:
      return 0;
  }
}

/**
 * section 名を規定カテゴリへ正規化し、SECTION_ORDER のインデックスを返す。
 * "管理 - ユーザー管理" → "管理" のように畳む。未知カテゴリは末尾（最大 rank）。
 */
export function sectionRank(section: string): number {
  // 正規カテゴリ名へ畳んでから SECTION_ORDER のインデックスを引く。
  const canonical = normalizeSection(section);
  const index = SECTION_ORDER.indexOf(canonical as (typeof SECTION_ORDER)[number]);
  // 未知カテゴリは末尾（最大 rank = SECTION_ORDER.length）に置く。
  return index === -1 ? SECTION_ORDER.length : index;
}

/**
 * canonical 順にグループ化し、各グループ内を order 昇順にソートする（R4.3, R4.4）。
 * - 正規化カテゴリ（normalizeSection）単位でグループ化する。
 * - 各グループ内は order 昇順の安定ソート。「管理」配下は slug 既定順
 *   users → ip → audit（adminSubRank）を優先し、その中で order 昇順に並べる。
 * - 出力グループ列は sectionRank の昇順（規定セクション順。未知は末尾）に並べる。
 */
export function groupAndSort(steps: ManualStep[]): SectionGroup[] {
  // 正規化カテゴリ単位でグループへ振り分ける（初出順で Map に積む）。
  const groups = new Map<string, ManualStep[]>();
  for (const step of steps) {
    const canonical = normalizeSection(step.section);
    const bucket = groups.get(canonical);
    if (bucket) {
      bucket.push(step);
    } else {
      groups.set(canonical, [step]);
    }
  }

  // 各グループ内を (adminSubRank, order) の複合キーで安定ソートする。
  // "管理" 以外のグループは adminSubRank が一律 0 なので実質 order 昇順となる。
  const result: SectionGroup[] = [];
  for (const [section, bucket] of groups) {
    const sorted = bucket
      .map((step, i) => ({ step, i })) // 安定ソート用に元の添字を保持
      .sort((a, b) => {
        const subDiff = adminSubRank(a.step.section) - adminSubRank(b.step.section);
        if (subDiff !== 0) return subDiff;
        const orderDiff = a.step.order - b.step.order;
        if (orderDiff !== 0) return orderDiff;
        return a.i - b.i; // 同順位は入力順を維持（安定性）
      })
      .map((entry) => entry.step);
    result.push({ section, steps: sorted });
  }

  // 出力グループ列を規定セクション順（sectionRank 昇順）に並べる。
  // 同 rank（未知カテゴリ同士）は初出順を維持するため安定ソートを使う。
  return result
    .map((group, i) => ({ group, i }))
    .sort((a, b) => {
      const rankDiff = sectionRank(a.group.section) - sectionRank(b.group.section);
      return rankDiff !== 0 ? rankDiff : a.i - b.i;
    })
    .map((entry) => entry.group);
}

/**
 * ロールフィルタの表示判定（R5.3, R5.4）。
 * selection === 'ALL' なら常に真、それ以外は step.roles に selection を含むとき真。
 */
export function shouldShow(step: ManualStep, selection: 'ALL' | ManualRole): boolean {
  // 'ALL' 選択時はロールに関わらず全手順を表示する。
  if (selection === 'ALL') {
    return true;
  }
  // 特定ロール選択時は、その手順の対象ロールに選択ロールが含まれるときのみ表示する。
  return step.roles.includes(selection);
}

/**
 * ManualStep → HTML 断片（バッジ・alt・data-roles を含む）（R5.1, R6.1, R7.2）。
 *
 * 構造（design.md の HTML 構造に準拠）:
 * - `<article class="step" data-roles="…">` に roles をスペース区切りで埋め込む（R5.3 の契約）。
 * - `<h3>` に手順見出し（title）。renderHtml が h1→h2→h3 の階層を作る前提。
 * - `<p class="roles">` にロールバッジ。step.roles と一致し、既知 3 ロールのみ（R5.1, R1.5）。
 * - `<p class="desc">` に日本語の説明（description）（R6.1）。
 * - `<img>` の alt は `{section}: {title} — {description}` 形式で空にしない（R7.2）。
 * title / description / section / screenshot はすべて escapeHtml でエスケープする。
 */
export function renderStep(step: ManualStep): string {
  // data-roles 属性: 既知 3 ロールのみをスペース区切りで並べる（表示判定の契約）。
  const knownRoles = step.roles.filter((role) => ALL_ROLES.includes(role));
  const dataRoles = knownRoles.join(' ');

  // ロールバッジ: ロールトークンをそのまま表示し、クラス名は小文字化する
  // （例: REVIEWER → badge badge-reviewer）。
  const badges = knownRoles
    .map(
      (role) =>
        `<span class="badge badge-${role.toLowerCase()}">${escapeHtml(role)}</span>`
    )
    .join(' ');

  // alt テキスト（R7.2）: `{section}: {title} — {description}` 形式。必ず title を含む。
  const alt = escapeHtml(`${step.section}: ${step.title} — ${step.description}`);

  return [
    `<article class="step" data-roles="${escapeHtml(dataRoles)}">`,
    `  <h3>${escapeHtml(step.title)}</h3>`,
    `  <p class="roles">${badges}</p>`,
    `  <p class="desc">${escapeHtml(step.description)}</p>`,
    `  <img src="${escapeHtml(step.screenshot)}" alt="${alt}" />`,
    `</article>`,
  ].join('\n');
}

/**
 * ロールフィルタ UI の定義（R5.2, R7.3）。
 * value はフィルタ選択値（ALL + 既知 3 ロール）、label は日本語 UI ラベル。
 * ALL のラベルのみ日本語「すべて」、ロールはトークン名をそのまま表示する。
 */
const ROLE_FILTER_OPTIONS: ReadonlyArray<{ value: 'ALL' | ManualRole; label: string }> = [
  { value: 'ALL', label: 'すべて' },
  { value: 'REVIEWER', label: 'REVIEWER' },
  { value: 'TEAM_LEADER', label: 'TEAM_LEADER' },
  { value: 'ADMIN', label: 'ADMIN' },
];

/** 文書タイトル／最上位見出し（R7.1: 単一 h1）。 */
const MANUAL_TITLE = 'Transcription Review App 操作マニュアル';

/**
 * インライン CSS（R5.3 の表示制御・バッジ色など）。
 * `.step[hidden]` / `section[hidden]` を確実に非表示にし、バッジにロール別の色を与える。
 */
const INLINE_CSS = `
  :root { font-family: system-ui, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif; }
  body { margin: 0; padding: 0; color: #1a1a1a; background: #fafafa; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 1rem 1.5rem; }
  h1 { font-size: 1.4rem; margin: 0 0 0.75rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; padding-bottom: 0.25rem; border-bottom: 2px solid #e0e0e0; }
  h3 { font-size: 1rem; margin: 0 0 0.5rem; }
  main { padding: 1rem 1.5rem 3rem; max-width: 960px; margin: 0 auto; }
  .role-filter { display: flex; gap: 1rem; flex-wrap: wrap; }
  .role-filter label { cursor: pointer; }
  .step { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1rem 1.25rem; margin: 0 0 1rem; }
  .step img { max-width: 100%; height: auto; border: 1px solid #eee; border-radius: 4px; }
  .roles { margin: 0 0 0.5rem; }
  .desc { margin: 0 0 0.75rem; line-height: 1.6; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; color: #fff; }
  .badge-reviewer { background: #2563eb; }
  .badge-team_leader { background: #7c3aed; }
  .badge-admin { background: #dc2626; }
  /* ロールフィルタで除外された手順・空セクションを非表示にする（R5.3） */
  .step[hidden], section[hidden] { display: none; }
`;

/**
 * ロールフィルタのクライアント JS（R5.3, R5.4）。
 * ラジオの change を単一リスナで監視し、選択値 R に応じて各 `.step` を切り替える。
 * - R === 'ALL' → 全手順を表示（hidden を外す）。
 * - それ以外 → data-roles（スペース区切り）に R を含む手順のみ表示、他は hidden。
 * さらに、表示中の手順が 0 のセクションは見出しごと hidden にする。
 * shouldShow と同等のロジックをブラウザ側で再現する（ビルド時の data-roles が唯一の契約）。
 */
const INLINE_SCRIPT = `
  (function () {
    var filter = document.querySelector('.role-filter');
    if (!filter) return;
    function apply(selection) {
      var steps = document.querySelectorAll('.step');
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var roles = (step.getAttribute('data-roles') || '').split(' ').filter(Boolean);
        var show = selection === 'ALL' || roles.indexOf(selection) !== -1;
        if (show) {
          step.removeAttribute('hidden');
        } else {
          step.setAttribute('hidden', '');
        }
      }
      // 表示手順が 0 のセクションは見出しごと隠す。
      var sections = document.querySelectorAll('main > section');
      for (var j = 0; j < sections.length; j++) {
        var section = sections[j];
        var visible = section.querySelectorAll('.step:not([hidden])');
        if (visible.length === 0) {
          section.setAttribute('hidden', '');
        } else {
          section.removeAttribute('hidden');
        }
      }
    }
    filter.addEventListener('change', function (event) {
      var target = event.target;
      if (target && target.name === 'role') {
        apply(target.value);
      }
    });
  })();
`;

/**
 * ロールフィルタ（R5.2, R6.2, R7.3）の HTML を組み立てる。
 * `role="group"` + `aria-label="ロールで絞り込み"` でグループ化し、
 * 各ラジオに value（ALL/REVIEWER/TEAM_LEADER/ADMIN）と日本語 UI ラベルを付ける。
 * ALL を既定 checked にする（R5.4 の初期表示＝全表示）。
 */
function renderRoleFilter(): string {
  const options = ROLE_FILTER_OPTIONS.map((option) => {
    const checked = option.value === 'ALL' ? ' checked' : '';
    return [
      `      <label>`,
      `        <input type="radio" name="role" value="${escapeHtml(option.value)}"${checked} />`,
      `        ${escapeHtml(option.label)}`,
      `      </label>`,
    ].join('\n');
  }).join('\n');

  return [
    `    <div role="group" aria-label="ロールで絞り込み" class="role-filter">`,
    options,
    `    </div>`,
  ].join('\n');
}

/**
 * SectionGroup → `<section>`（h2 見出し + 配下の手順 `<article>`）（R4.2, R4.4, R7.1）。
 * groups は groupAndSort 済み（規定順・order 昇順）前提なので、ここでは並べ替えない。
 * data-section 属性にセクション名を入れ、識別・テストを容易にする。
 */
function renderSection(group: SectionGroup): string {
  // 配下の手順は group.steps（order 昇順ソート済み）をそのまま renderStep する。
  const articles = group.steps.map((step) => renderStep(step)).join('\n');
  return [
    `    <section data-section="${escapeHtml(group.section)}">`,
    `      <h2>${escapeHtml(group.section)}</h2>`,
    articles,
    `    </section>`,
  ].join('\n');
}

/**
 * SectionGroup[] → 完全な HTML 文書
 * （html lang=ja, h1/h2/h3, ロールフィルタ, インライン CSS/JS）（R4.2 ほか）。
 *
 * 構造（design.md の HTML 構造に準拠）:
 * - `<!doctype html>` + `<html lang="ja">`（R6.3）。
 * - `<head>`: meta charset, `<title>`、インライン CSS（バッジ色・hidden 制御）。
 * - `<header>`: 単一 `<h1>` 文書タイトル（R7.1）＋ロールフィルタ（R5.2, R6.2, R7.3）。
 * - `<main>`: groups を入力順（groupAndSort 済み＝規定順）で `<section>`＋`<h2>`、
 *   配下に renderStep の `<article>` を order 昇順（group.steps ソート済み）で出力。
 * - インライン `<script>`: ラジオ change で data-roles を見て表示切替（R5.3, R5.4）。
 * - 見出し階層は h1 → h2 → h3 で飛ばさない（R7.1）。
 * - 全ロール・全セクションの手順を単一ファイルに含める（R5.5）。
 */
export function renderHtml(groups: SectionGroup[]): string {
  // 各グループを規定順（入力順）どおりに section へ変換する。
  const sections = groups.map((group) => renderSection(group)).join('\n');

  return [
    `<!doctype html>`,
    `<html lang="ja">`,
    `  <head>`,
    `    <meta charset="utf-8" />`,
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `    <title>${escapeHtml(MANUAL_TITLE)}</title>`,
    `    <style>${INLINE_CSS}</style>`,
    `  </head>`,
    `  <body>`,
    `    <header>`,
    `      <h1>${escapeHtml(MANUAL_TITLE)}</h1>`,
    renderRoleFilter(),
    `    </header>`,
    `    <main>`,
    sections,
    `    </main>`,
    `    <script>${INLINE_SCRIPT}</script>`,
    `  </body>`,
    `</html>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// I/O ラッパ（副作用あり）。本体は後続タスクで実装するスタブ。
// ---------------------------------------------------------------------------

/** Steps_JSON が 1 件も無いときの日本語エラーメッセージ（R4.6）。 */
const NO_STEPS_MESSAGE =
  'steps JSON が見つかりません。先に `npm run manual` を実行してください。';

/**
 * steps/ の *.json を読み込む（R4.1）。
 * - 指定ディレクトリ配下の `*.json` をファイル名昇順（安定順）で読み込み StepsJson[] を返す。
 * - 0 件（ディレクトリが存在しない／JSON が 1 件も無い）なら日本語エラーを throw する（R4.6）。
 * - 不正 JSON はファイル名を含むエラーで throw する（部分破損で黙って成功させない）。
 */
export function loadStepsJson(stepsDir: string): StepsJson[] {
  // ディレクトリが存在しない場合は 0 件扱い（readdirSync の例外は握りつぶす）。
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(stepsDir);
  } catch {
    entries = [];
  }

  // *.json のみを対象に、ファイル名昇順の安定した順序で読み込む。
  const jsonFiles = entries
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 0 件なら日本語エラーで throw（R4.6）。呼び出し側（main）が stderr 出力を担う。
  if (jsonFiles.length === 0) {
    throw new Error(NO_STEPS_MESSAGE);
  }

  // 各ファイルを読み込み・パースする。不正 JSON はファイル名を含むエラーで throw。
  return jsonFiles.map((name) => {
    const filePath = path.resolve(stepsDir, name);
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      return JSON.parse(raw) as StepsJson;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`steps JSON の解析に失敗しました (${name}): ${reason}`);
    }
  });
}

/**
 * main(): load → collect → group → render → writeFile。
 * - `loadStepsJson(STEPS_DIR)` → `collectSteps` → `groupAndSort` → `renderHtml` の順に
 *   変換し、結果を `output/manual.html`（MANUAL_HTML_PATH）へ書き出す。
 * - 成功時は生成先パスを stdout にログする。
 * - 例外時（Steps_JSON 0 件・不正 JSON を含む）は stderr へエラーを出力し、
 *   `process.exitCode = 1` を設定する（R4.6）。
 */
export function main(): void {
  try {
    const files = loadStepsJson(STEPS_DIR);
    const steps = collectSteps(files);
    const groups = groupAndSort(steps);
    const html = renderHtml(groups);

    // 書き出し先ディレクトリを保証してから HTML を書き出す。
    fs.mkdirSync(path.dirname(MANUAL_HTML_PATH), { recursive: true });
    fs.writeFileSync(MANUAL_HTML_PATH, html);

    console.log(`マニュアルを生成しました: ${MANUAL_HTML_PATH}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------
// このファイルが直接実行されたとき（`tsx manual/build-manual.ts`）のみ main() を呼ぶ。
// テストから import した場合は副作用（ファイル生成）が走らないようにガードする。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
