import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      // バグ検出 E2E（既定）。testDir の tests/ のみを対象にする。
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // マニュアル用スクリーンショット収集シナリオ（正常系）。
      // `npm run manual` から --project=manual で実行する。
      name: 'manual',
      testDir: './manual',
      // Manual_Spec の *.spec.ts のみを対象にし、Builder の node:test ファイル
      // (*.test.ts) が Playwright に拾われないようにする。
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // マニュアルのスクショは一貫した大きさで撮る。
        viewport: { width: 1280, height: 900 },
        screenshot: 'off',
      },
    },
  ],
});
