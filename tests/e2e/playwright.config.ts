/**
 * FILE: tests/e2e/playwright.config.ts
 * PURPOSE: Playwright config for the Sprint 3 E2E specs. Single worker,
 *          headless Chromium, targets the dev frontend at :5173; the backend
 *          at :3000 must already be running (orchestrated externally).
 * CALLED BY: `npm test` in tests/ (via --config=...); CI job in STEP 2.1.
 * CALLS: @playwright/test.
 * DEPS: frontend Customer page @ ca08710 (testids), 5651b05 (impl).
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Config sits inside tests/e2e/; specs are siblings, so testDir is '.'.
  // If this config ever moves up to tests/, change this to './e2e'.
  testDir: '.',

  // QA brief requires --workers=1: specs share one real backend + real
  // Postgres, so parallel files would break ordering-sensitive state.
  fullyParallel: false,
  workers: 1,

  // Block a stray .only from silently shrinking the CI run.
  forbidOnly: !!process.env.CI,

  // One retry on CI only — a CI flake can be infra; a local flake is a bug.
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
