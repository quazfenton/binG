/**
 * Firefox /ws/previews regression test
 *
 * Converts the recurring "4+ Firefox /ws/previews failures" claim into a
 * runnable regression. Firefox exhibits a known ~150 ms-post-upgrade
 * abnormal-closure pattern (close code 1006, durationMs ≈ 150) that no
 * other browser reproduces — surfaced in the disconnect log fields
 * added to ws-preview-broadcaster.ts (userAgent, code, durationMs).
 *
 * Strategy: Playwright's `page.waitForEvent('websocket')` resolves the
 * moment `new WebSocket(url)` is constructed in the page. We then wait
 * for `ws.waitForEvent('framereceived')` — the server's first frame
 * arrives only after:
 *   1. ws.onopen on the client (sets `connected = true` in the hook),
 *   2. broadcaster.handleConnection runs auth + client-limit checks,
 *   3. broadcaster.sendInitialState writes the `preview:initial-state`
 *      JSON to the socket.
 * Receiving ANY byte from the server therefore proves the full upgrade
 * round-trip completed AND the hook flipped `connected` to true.
 *
 * Total wall-clock budget (~5 s typical, ≤ 6 s worst-case):
 *   - 1 s on the WS constructor (fires synchronously on React mount;
 *     the 1 s ceiling catches a "React never mounted" failure mode).
 *   - 5 s on the first received frame (the actual setConnected(true)
 *     signal — broadcast auth + initialState adds latency).
 *   The two timeouts run sequentially (the WS object must exist before
 *   framereceived can fire), so the worst-case bound is ~6 s, not 10 s.
 *
 * Mount path: `/` (app/(main)/page.tsx) renders <PreviewToast> which
 * mounts <WebSocketTransport> → usePreviewWebsocket({}); the hook's
 * connect() effect calls `new WebSocket(url)` on mount.
 *
 * Run via the dedicated Firefox config (NOT playwright.config.ts, which
 * uses `npm run dev` = `next dev` Turbopack — those don't install the
 * /ws/previews upgrade handler, causing the hook to set unsupportedRef
 * on the first 1006 abort and never receive any frame):
 *   npx playwright test --config=playwright.firefox.config.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Firefox /ws/previews regression', () => {
  test('connected becomes true within 5s', async ({ page }) => {
    // WS constructor fires synchronously inside the hook's connect();
    // the 1 s ceiling catches a "React never mounted" failure mode.
    const wsPromise = page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/ws/previews'),
      timeout: 1_000,
    });

    await page.goto('/');

    const ws = await wsPromise;

    // First frame from server = full upgrade + auth + sendInitialState
    // round-trip completed = onopen fired on the client (which is the
    // ONLY path that calls setConnected(true) in usePreviewWebsocket).
    const firstFrame = await ws.waitForEvent('framereceived', {
      timeout: 5_000,
    });
    expect(firstFrame.payload?.toString()).toContain('preview:initial-state');
  });
});
