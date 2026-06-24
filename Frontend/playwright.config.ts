import { defineConfig, devices } from '@playwright/test';

// Browser end-to-end tests. Run against a running app (CI starts one; locally
// set E2E_BASE_URL). Browsers are installed via `playwright install` (done in CI).
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:13000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
