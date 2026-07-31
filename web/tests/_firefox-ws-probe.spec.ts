/**
 * DIAGNOSTIC PROBE — temporary. Live-fires `goto('/')` and captures:
 *   - all `console.log/warn/error` from the page
 *   - all unhandled `pageerror`s
 *   - all `page.on('websocket')` URLs (i.e. actual `new WebSocket(...)`)
 *   - all `page.on('request')` endpoints matching /preview|ws\/previews|terminal\/previews/
 *   - DOM grep counts + body text + page URL after 10 s
 *
 * The verdict line (`PROBE-VERDICT:`) answers the question directly:
 *   - "WS mounted -> ws://..."           (WebSocketTransport path)
 *   - "SSE mounted -> /api/..."          (SSETransport path)
 *   - "NEITHER transport observed ..."   (still hydrating, or fatal client error)
 */
import { test } from '@playwright/test';

test('PROBE: what transport does / mount under Firefox?', async ({ page }) => {
  const consoleLines: string[] = [];
  const pageErrors: string[] = [];
  const wsUrls: string[] = [];
  const previewReqs: { url: string; method: string }[] = [];

  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
  page.on('websocket', (ws) => wsUrls.push(ws.url()));
  page.on('request', (req) => {
    const u = req.url();
    if (/preview|ws\/previews|terminal\/previews/i.test(u)) {
      previewReqs.push({ url: u, method: req.method() });
    }
  });

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(10_000);

  const html = await page.content();
  const url = page.url();
  const bodyText = await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');

  console.log(`=== PROBE RESULTS ===`);
  console.log(`page.url:           ${url}`);
  console.log(`wsUrls (N=${wsUrls.length}):`);
  wsUrls.forEach((u) => console.log(`  ${u}`));
  console.log(`preview/sse reqs (N=${previewReqs.length}):`);
  previewReqs.forEach((r) => console.log(`  ${r.method} ${r.url}`));
  console.log(`pageErrors (N=${pageErrors.length}):`);
  pageErrors.slice(0, 20).forEach((e) => console.log(`  ${e}`));
  console.log(`console (first 30 of N=${consoleLines.length}):`);
  consoleLines.slice(0, 30).forEach((l) => console.log(`  ${l}`));
  console.log(`html len=${html.length}; bodyText len=${bodyText.length}`);
  console.log(`bodyText (first 400): ${bodyText.slice(0, 400).replace(/\n+/g, ' ')}`);
  console.log(`html grep counts: preview=${(html.match(/preview/gi) || []).length} sse=${(html.match(/sse/gi) || []).length} websocket=${(html.match(/websocket/gi) || []).length} /ws/previews=${(html.match(/\/ws\/previews/gi) || []).length} /api/terminal/previews=${(html.match(/\/api\/terminal\/previews/gi) || []).length}`);
  if (wsUrls.length > 0) console.log(`PROBE-VERDICT: WS mounted -> ${wsUrls[0]}`);
  else if (previewReqs.some((r) => /terminal\/previews/i.test(r.url))) console.log(`PROBE-VERDICT: SSE mounted -> ${previewReqs.find((r) => /terminal\/previews/i.test(r.url))?.url}`);
  else console.log(`PROBE-VERDICT: NEITHER transport observed within 10 s of goto`);
});
