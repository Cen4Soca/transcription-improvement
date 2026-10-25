import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** マニュアル出力先。manual/output/{screenshots,steps} に生成する。 */
export const OUTPUT_DIR = path.resolve(__dirname, 'output');
export const SCREENSHOTS_DIR = path.resolve(OUTPUT_DIR, 'screenshots');
export const STEPS_DIR = path.resolve(OUTPUT_DIR, 'steps');

/** マニュアルの対象ロール。手順ごとにバッジ表示する。 */
export type ManualRole = 'REVIEWER' | 'TEAM_LEADER' | 'ADMIN';

/** 1 手順分のメタデータ（HTML 組み立て時に使用）。 */
export interface ManualStep {
  /** 機能セクション（例: "ログイン", "校閲", "管理 - ユーザー管理"）。 */
  section: string;
  /** セクション内の表示順。 */
  order: number;
  /** 手順の見出し。 */
  title: string;
  /** 手順の説明（日本語）。 */
  description: string;
  /** この操作を実行できるロール（バッジ表示）。 */
  roles: ManualRole[];
  /** スクリーンショットの相対パス（HTML からの参照用, screenshots/xxx.png）。 */
  screenshot: string;
}

/**
 * ManualRecorder - マニュアル用のスクリーンショットとメタデータを収集する。
 *
 * 各シナリオ（spec）が 1 つのセクションを担当し、ステップごとに capture() を呼ぶ。
 * スクショは manual/output/screenshots/ に保存し、メタは manual/output/steps/
 * に 1 セクション 1 ファイル（JSON）で書き出す。HTML 組み立て（build-manual.ts）が
 * これらを集約して単一の manual.html を生成する。
 */
export class ManualRecorder {
  private steps: ManualStep[] = [];
  private counter = 0;

  constructor(
    private readonly page: Page,
    private readonly section: string,
    /** スクショのファイル名プレフィックス（セクション識別子, 英数字・ハイフン）。 */
    private readonly slug: string
  ) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    fs.mkdirSync(STEPS_DIR, { recursive: true });
  }

  /**
   * 現在の画面を撮影し、1 手順として記録する。
   *
   * 撮影前にネットワークアイドルとフォントの安定を軽く待ち、整形済みの
   * フルページスクショを撮る。
   */
  async capture(opts: {
    title: string;
    description: string;
    roles: ManualRole[];
    /** フルページ撮影するか（既定 true）。長い画面は false でビューポートのみ。 */
    fullPage?: boolean;
    /** 撮影前の追加待機（ms）。アニメーション安定用。 */
    settleMs?: number;
  }): Promise<void> {
    this.counter += 1;
    const order = this.counter;
    const filename = `${this.slug}-${String(order).padStart(2, '0')}.png`;
    const filePath = path.resolve(SCREENSHOTS_DIR, filename);

    // 安定化: ネットワークアイドル + 任意の追加待機
    await this.page.waitForLoadState('networkidle').catch(() => {});
    if (opts.settleMs) {
      await this.page.waitForTimeout(opts.settleMs);
    }

    await this.page.screenshot({
      path: filePath,
      fullPage: opts.fullPage ?? true,
    });

    this.steps.push({
      section: this.section,
      order,
      title: opts.title,
      description: opts.description,
      roles: opts.roles,
      screenshot: `screenshots/${filename}`,
    });
  }

  /**
   * 収集したステップを manual/output/steps/{slug}.json に書き出す。
   * シナリオの最後（または afterAll）で必ず呼ぶ。
   */
  flush(): void {
    const outPath = path.resolve(STEPS_DIR, `${this.slug}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ section: this.section, slug: this.slug, steps: this.steps }, null, 2)
    );
  }
}
