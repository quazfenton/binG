import { defineConfig, devices } from '@playwright/test';
const PORT = process.env.DEV_WS_PORT || '3001';
const N = parseInt(process.env.LATENCY_RUNS || '30', 10);
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['preview-ws-firefox-latency-direct.spec.ts'],
  fullyParallel: false,
  retries: 0, workers: 1, repeatEach: N, reporter: 'list',
  use: { baseURL: 'http://localhost:'+PORT, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: { command: 'PORT='+PORT+' npm run dev:ws', url: 'http://localhost:'+PORT, reuseExistingServer: true, timeout: 120000 },
});
