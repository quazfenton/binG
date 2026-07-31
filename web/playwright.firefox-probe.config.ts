import { defineConfig, devices } from '@playwright/test';

/**
 * Temporary probe config — runs `_firefox-ws-probe.spec.ts` once.
 * Lives next to the latency config so both share the playwright namespace;
 * delete this file when no longer needed.
 */
const PORT = process.env.DEV_WS_PORT || '3001';

export default defineConfig({
  testDir: './tests',
  testMatch: ['_firefox-ws-probe.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
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
