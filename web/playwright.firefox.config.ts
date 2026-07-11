import { defineConfig, devices } from '@playwright/test';

/**
 * Firefox /ws/previews regression test config.
 *
 * Self-contained, separate from playwright.config.ts so this test can
 * use `tsx server.ts` (`npm run dev:ws`) WITHOUT forcing every test in
 * tests/e2e/ to also need the custom WS server. Plain `next dev` (the
 * project-wide default) does NOT install the /ws/previews upgrade
 * handler — usePreviewWebsocket detects this on the first 1006/1015
 * abort and sets `unsupportedRef.current = true`, which would produce a
 * false-negative in this test (no `framereceived` within 5 s).
 *
 * The dedicated config:
 *   - Runs ONLY preview-ws-firefox.spec.ts (testMatch filter — other
 *     tests in tests/e2e/ stay on the project-wide `npm run dev` setup).
 *   - Uses ONLY the Firefox project (chromium/webkit/mobile are skipped
 *     regardless — failure is Firefox-specific, so they only add CI
 *     wall-clock for no marginal signal).
 *   - Boots the custom server (`tsx server.ts`) which installs the
 *     /ws/previews upgrade handler so the spec can observe a real
 *     round-trip.
 *
 * Invocation:
 *   npx playwright test --config=playwright.firefox.config.ts
 *
 * Linting: the project's eslint config (eslint.config.js) covers the
 * spec under tests/e2e/ and any new top-level Playwright config files,
 * so this file participates in the standard lint pipeline alongside
 * the existing playwright.config.ts.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['preview-ws-firefox.spec.ts'],
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Single worker on CI keeps traces stable across retry attempts */
  workers: process.env.CI ? 1 : undefined,
  /* Compact reporter for CI logs */
  reporter: 'list',
  /* Shared settings — same shape as playwright.config.ts */
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    // `tsx server.ts` — the custom server that wires /ws/previews.
    // Plain `next dev` (npm run dev) won't upgrade the WS handshake.
    command: 'npm run dev:ws',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
