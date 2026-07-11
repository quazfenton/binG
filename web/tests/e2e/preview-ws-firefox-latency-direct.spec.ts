/**
 * Firefox /ws/previews WS-direct latency measurement.
 *
 * Skips page hydration entirely. Opens the WebSocket from inside the
 * page context via `page.evaluate(...)` so we measure the actual WS
 * round-trip cost (handshake + first frame from the server) without
 * wait for React mount, dynamic-import chunks, or HMR. The measurement
 * is the WS quality signal the user asked for; it is page-mount-clean.
 *
 * Schema:
 *   { t_start, t_arrival|null,
 *     ws_handshake_ms,         // browser perf.now(): WS construct -> ws.onopen
 *     ws_to_firstframe_ms,     // browser perf.now(): ws.onopen -> first framereceived (CLEAN SIGNAL)
 *     total_ms,                // Node Date.now(): test start -> Promise resolved
 *     status }
 *
 * The two `*_ms` fields are pure browser-side perf.now() deltas — NOT
 * offset by `tStart`. The first iter of `tsc --noEmit` flagged a subtle
 * math bug where adding `tStart + Math.round(...)` to both tWsOpen and
 * tFirstFrame caused `ws_to_firstframe_ms` to alias to
 * `Math.round(openMs) − Math.round(firstFrameMs)`, producing -1 whenever
 * the rounded values inverted ordering. The fix below drops the outer
 * arithmetic and emits the perf-delta directly.
 *
 * Open N=30 (LATENCY_RUNS override) via repeatEach.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = '/opt/bing/web/test-results/firefox-ws-direct-latency.jsonl';
const SENTINEL = OUT + '.boot';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (!fs.existsSync(SENTINEL)) {
  fs.writeFileSync(OUT, '');
  fs.writeFileSync(SENTINEL, '');
}

interface WsTimings {
  openMs: number;
  firstFrameMs: number;
  payload: string;
}

test('Firefox /ws/previews WS-direct latency (repeatEach iter)', async ({ page }) => {
  const tStart = Date.now();
  let arrivalIso: string | null = null;
  let status = 'fail'; // TS infers string; assigned 'ok' on the success path
  let wsHandshakeMs = -1;
  let wsToFirstframeMs = -1;
  let totalMs = -1;

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const timings: WsTimings = await page.evaluate(async () => {
      return new Promise<WsTimings>((resolve, reject) => {
        const t0 = performance.now();
        let tOpen = -1;
        const ws = new WebSocket('ws://' + location.host + '/ws/previews');
        ws.onopen = () => {
          tOpen = performance.now() - t0;
        };
        ws.onmessage = (ev) => {
          const tFrame = performance.now() - t0;
          const payload =
            typeof ev.data === 'string'
              ? ev.data
              : String(ev.data ?? '');
          try { ws.close(1000, 'done'); } catch { /* already closing */ }
          resolve({ openMs: tOpen, firstFrameMs: tFrame, payload });
        };
        ws.onerror = () => reject(new Error('ws onerror'));
        setTimeout(() => reject(new Error('ws timeout 5s')), 5_000);
      });
    });

    arrivalIso = new Date().toISOString();
    expect(timings.payload).toContain('preview:initial-state');
    status = 'ok';

    // Pure browser-side perf-delta: WS round-trip cost (the actual signal).
    wsHandshakeMs = Math.round(timings.openMs);
    wsToFirstframeMs = Math.round(timings.firstFrameMs - timings.openMs);
    totalMs = Date.now() - tStart;
  } catch (err) {
    status = err instanceof Error ? err.name : 'fail';
    totalMs = Date.now() - tStart;
  }

  const rec = {
    t_start: new Date(tStart).toISOString(),
    t_arrival: arrivalIso,
    ws_handshake_ms: wsHandshakeMs,
    ws_to_firstframe_ms: wsToFirstframeMs,
    total_ms: totalMs,
    status,
  };
  const line = JSON.stringify(rec);
  fs.appendFileSync(OUT, line + '\n');
  console.log(`[LATENCY-DIRECT] ${line}`);
});
