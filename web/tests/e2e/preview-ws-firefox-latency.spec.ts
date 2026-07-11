/**
 * Firefox /ws/previews latency distribution measurement (live histogram seed).
 *
 * Mirrors preview-ws-firefox.spec.ts but additionally captures timing to
 * a JSONL file so we can build a framereceived latency histogram across N
 * iterations.
 *
 * Schema (one row per execution, append-mode):
 *   /opt/bing/web/test-results/firefox-ws-latency.jsonl
 *   {
 *     t_start,
 *     t_arrival|null,
 *     page_warmup_ms,            // test start -> page.goto resolves
 *     ws_constructor_ms,         // page.goto resolves -> ws.waitForEvent('websocket') resolves
 *     ws_to_firstframe_ms,       // ws waitForEvent resolves -> framereceived resolves  (CLEAN SIGNAL)
 *     total_ms,                  // test start -> framereceived resolves               (vs 5s budget)
 *     status                      // 'ok' | <Error.name> | 'fail'
 *   }
 *
 * Why two latencies:
 *   - total_ms  — what users observe (page load + dynamic chunks + WS open + WS round-trip).
 *                 The regression test asserts < 5_000ms here.
 *   - ws_to_firstframe_ms — the WS round-trip ONLY. This is the user's actual
 *                 request: "capture the first Firefox WebSocket frame timing
 *                 distribution... typical <5s budget rather than the worst-case bound."
 *                 A histogram of THIS column quantifies the WS connection cost
 *                 independent of page warmup noise.
 *
 * Constructor timeout raised to 15_000ms (vs regression's 1_000ms) to tolerate
 * the dynamic-chunk warmup that dominates the FIRST 1-2 iterations. Subsequent
 * iterations are cache-hot and resolve in well under 1s, matching the regression
 * test's empirical bound.
 *
 * Invoked via:
 *   npx playwright test --config=playwright.firefox-latency.config.ts
 *
 * RepeatEach-set N=30 (LATENCY_RUNS env override) reuses the booted dev:ws.
 * The companion config cleans the JSONL + boot sentinel on each run so the
 * histogram is per-invocation, not per-day.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = '/opt/bing/web/test-results/firefox-ws-latency.jsonl';
const SENTINEL = OUT + '.boot';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (!fs.existsSync(SENTINEL)) {
  fs.writeFileSync(OUT, '');
  fs.writeFileSync(SENTINEL, '');
}

test('Firefox /ws/previews latency sample (repeatEach iter)', async ({ page }) => {
  const tStart = Date.now();
  let tPageReady = -1;
  let tWsOpen = -1;
  let tFirstFrame = -1;
  let arrivalIso: string | null = null;
  let status = 'fail';

  try {
    const wsPromise = page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/ws/previews'),
      timeout: 15_000, // tolerate dynamic-chunk warmup on first 1-2 iterations
    });
    await page.goto('/');
    tPageReady = Date.now();

    const ws = await wsPromise;
    tWsOpen = Date.now();

    const firstFrame = await ws.waitForEvent('framereceived', {
      timeout: 5_000, // matches the regression test's <5s budget
    });
    tFirstFrame = Date.now();
    arrivalIso = new Date(tFirstFrame).toISOString();

    const payload = firstFrame.payload?.toString() ?? '';
    expect(payload).toContain('preview:initial-state');
    status = 'ok';
  } catch (err) {
    status = err instanceof Error ? err.name : 'fail';
  }

  const rec = {
    t_start: new Date(tStart).toISOString(),
    t_arrival: arrivalIso,
    page_warmup_ms: tPageReady > 0 ? tPageReady - tStart : -1,
    ws_constructor_ms: tWsOpen > tPageReady ? tWsOpen - tPageReady : -1,
    ws_to_firstframe_ms: tFirstFrame > tWsOpen ? tFirstFrame - tWsOpen : -1,
    total_ms: tFirstFrame > 0 ? tFirstFrame - tStart : Date.now() - tStart,
    status,
  };
  const line = JSON.stringify(rec);
  fs.appendFileSync(OUT, line + '\n');
  console.log(`[LATENCY] ${line}`);
});
