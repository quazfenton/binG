import { defineConfig, devices } from '@playwright/test';

/**
 * Firefox /ws/previews LATENCY measurement config (not a regression test).
 *
 * - Boots (or reuses) `tsx server.ts` on PORT=3001 to install the real
 *   /ws/previews upgrade handler. Plain `next dev` does NOT install the
 *   handler, leading to a permanent `unsupportedRef=true` false-negative.
 * - Runs ONLY preview-ws-firefox-latency.spec.ts with `repeatEach=LATENCY_RUNS`
 *   (default 30) so a single Playwright invocation produces N histogram
 *   samples while sharing one booted dev:ws server.
 * - Single worker + no screenshots/video/trace to keep the loop fast and
 *   the test-results directory slim.
 *
 * Usage:
 *   LATENCY_RUNS=30 npx playwright test --config=playwright.firefox-latency.config.ts
 */
const PORT = process.env.DEV_WS_PORT || '3001';
const N = parseInt(process.env.LATENCY_RUNS || '30', 10);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['preview-ws-firefox-latency.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  repeatEach: N,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: `PORT=${PORT} npm run dev:ws`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
