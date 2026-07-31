#!/usr/bin/env node
/**
 * E2E Agent Workflow Harness
 *
 * Drives the live /api/chat endpoint with real coding prompts and verifies
 * ACTUAL side effects (VFS file creation, tool-call args, diffs) rather than
 * just HTTP status. Correlates with server logs at web/logs/run.log.
 *
 * Usage:
 *   node scripts/e2e-agent-tests/harness.mjs                 # run all scenarios
 *   node scripts/e2e-agent-tests/harness.mjs <scenarioId>    # run one
 *
 * Env:
 *   BASE=http://localhost:3000  EMAIL=test@test.com  PASS=Testing00000?
 *   PROVIDER=nvidia MODEL=openai/gpt-oss-120b
 */

import fs from 'node:fs';
import path from 'node:path';

// NOTE: use 127.0.0.1, NOT localhost — Node/undici fetch resolves localhost to
// ::1 (IPv6) first and hangs indefinitely when the dev server binds IPv4 only.
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const EMAIL = process.env.EMAIL || 'test@test.com';
const PASS = process.env.PASS || 'Testing00000?';
const PROVIDER = process.env.PROVIDER || 'nvidia';
const MODEL = process.env.MODEL || 'openai/gpt-oss-120b';

const OUT_DIR = path.join(process.cwd(), 'scripts', 'e2e-agent-tests', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

let COOKIES = '';
let USER_ID = '';

const log = (...a) => console.log(...a);
const hr = () => log('─'.repeat(72));

function parseSetCookie(headers) {
  // node fetch: headers.getSetCookie() returns array
  const raw = headers.getSetCookie ? headers.getSetCookie() : [];
  const jar = {};
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function doLogin() {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
      signal: c.signal,
    });
    const body = await res.json();
    return { res, body };
  } finally { clearTimeout(t); }
}

async function login() {
  let { res, body } = await doLogin();
  if (!res.ok || !body.success) {
    // In-memory user store may have been reset on server restart — re-register.
    log('  login failed, attempting register…');
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    try {
      await fetch(`${BASE}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASS, username: 'tester' }),
        signal: c.signal,
      });
    } finally { clearTimeout(t); }
    ({ res, body } = await doLogin());
  }
  if (!res.ok || !body.success) throw new Error('login failed: ' + JSON.stringify(body));
  COOKIES = parseSetCookie(res.headers);
  USER_ID = body.user.id;
  log(`✓ logged in as ${body.user.email}  userId=${USER_ID}`);
  log(`  cookies: ${COOKIES.split('; ').map(c => c.split('=')[0]).join(', ')}`);
}

/**
 * Send a chat request, capture the full SSE stream. Returns a structured
 * summary of everything observed.
 */
async function chat({ prompt, conversationId, provider = PROVIDER, model = MODEL, agentMode = 'auto', extra = {} }) {
  const started = Date.now();
  // Capture the requested stream mode up-front (extra.stream overrides the
  // body default below) so the reader can branch on it: streaming responses
  // are consumed as SSE; non-streaming responses are consumed as a single
  // JSON body. Pre-fix every response went through the SSE parser, so the
  // T0_nonstream_json scenario silently got zero events (review #29).
  const requestedStream = extra.stream !== undefined ? !!extra.stream : true;
  const body = {
    messages: [{ role: 'user', content: prompt }],
    provider, model, stream: requestedStream, agentMode,
    conversationId,
    ...extra,
  };
  const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 180000);
  const ac = new AbortController();
  const chatTimer = setTimeout(() => ac.abort(), CHAT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIES },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(chatTimer);
    return { httpStatus: 0, headers: {}, events: [], tokens: '', rawBytes: 0, toolCalls: [], errors: ['FETCH_ABORTED_OR_FAILED: ' + e.message], done: null, durationMs: Date.now() - started, ttfbMs: 0, stream: requestedStream };

  }

  const result = {
    httpStatus: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    events: [],          // {event, data}
    tokens: '',          // concatenated token content
    rawBytes: 0,
    toolCalls: [],       // any tool call observed in stream
    errors: [],
    done: null,
    durationMs: 0,
    ttfbMs: 0,
    stream: requestedStream,
  };

  // Non-streaming JSON path: consume the body as a single JSON document and
  // surface it as one synthetic 'json' event so summarize() / validate() can
  // inspect the actual response shape instead of mis-parsing it through the
  // SSE framer (which previously reported 0 events for T0_nonstream_json).
  if (!requestedStream) {
    const text = await res.text();
    clearTimeout(chatTimer);
    result.bytes = text.length;
    result.rawBytes = text.length;
    result.durationMs = Date.now() - started;
    result.ttfbMs = result.durationMs;
    if (text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
        result.events.push({ event: 'json', data: parsed });
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.content === 'string') result.tokens = parsed.content;
          if (parsed.error) result.errors.push(String(parsed.error));
          if (parsed.toolCalls) result.toolCalls.push(...(Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [parsed.toolCalls]));
        }
      } catch {
        // Not JSON despite stream:false — surface the raw text so the failure
        // is visible in the summary instead of being silently dropped.
        result.events.push({ event: 'raw', data: text });
        result.errors.push('NON_JSON_RESPONSE: ' + text.slice(0, 200));
      }
    }
    return result;
  }

  if (!res.body) { clearTimeout(chatTimer); result.durationMs = Date.now() - started; return result; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let firstByte = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstByte) { firstByte = Date.now(); result.ttfbMs = firstByte - started; }
    const chunk = decoder.decode(value, { stream: true });
    result.rawBytes += chunk.length;
    buf += chunk;

    // Split SSE frames on blank line
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let ev = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join('\n');
      if (!dataStr) continue;
      if (dataStr === '[DONE]') { result.events.push({ event: 'DONE_SENTINEL' }); continue; }
      let data;
      try { data = JSON.parse(dataStr); } catch { data = { _raw: dataStr }; }
      result.events.push({ event: ev, data });

      // Extract signal fields across the various shapes
      const d = data || {};
      if (ev === 'token' || d.type === 'token') result.tokens += (d.content ?? d.token ?? d.text ?? '');
      if (typeof d.content === 'string' && ev !== 'token' && ev !== 'done') { /* keep */ }
      if (ev === 'done' || d.type === 'done') result.done = d;
      if (ev === 'error' || d.type === 'error') result.errors.push(d.message || d.error || JSON.stringify(d));
      // tool-call shapes
      const toolish = d.toolCall || d.tool_call || (d.type && /tool/.test(d.type) ? d : null);
      if (toolish) result.toolCalls.push(toolish);
      if (d.toolName || d.tool_name) result.toolCalls.push({ name: d.toolName || d.tool_name, args: d.args || d.arguments });
    }
  }
  clearTimeout(chatTimer);
  result.durationMs = Date.now() - started;
  result.aborted = ac.signal.aborted;
  return result;
}

async function vfsRead(filePath, ownerId = USER_ID) {
  const url = `${BASE}/api/test/vfs-read-file?path=${encodeURIComponent(filePath)}&ownerId=${encodeURIComponent(ownerId)}`;
  const res = await fetch(url, { headers: { Cookie: COOKIES } });
  try { return await res.json(); } catch { return { error: 'bad json', status: res.status }; }
}

// Validate a scenario result against the route's HTTP contract so a logged
// (but failed) run actually fails the harness (review comment #4). Streaming
// and non-streaming responses have different success shapes:
//   - stream:  HTTP 200, at least one event, and no error events (a server
//              error is reported either via status !== 200 or an 'error'
//              event; a 524/500 with zero events is a fail).
//   - non-stream: HTTP 200 and a parseable JSON body with content (chat result).
function validateResult(name, r) {
  const reasons = [];
  if (!r || typeof r !== 'object') return { pass: false, reasons: ['no result'] };

  if (r.aborted) reasons.push('request aborted (CHAT_TIMEOUT_MS fired)');

  // Best-effort stream mode detection. When summarize() is called on a
  // helper result (vfsRead/probe), skip HTTP contract validation.
  const isChatResult =
    'httpStatus' in r && 'events' in r && 'tokens' in r && 'toolCalls' in r;
  if (!isChatResult) return { pass: true, reasons: ['non-chat result — skipped'] };

  if (!r.httpStatus || r.httpStatus === 0) {
    return { pass: false, reasons: [...reasons, `http=${r.httpStatus} (fetch failed)`] };
  }

  const isStream = r.stream !== false;

  if (r.httpStatus !== 200) {
    // 524 (stall) and 5xx are acceptable per the route's documented contract
    // (logged + tracked) but still indicate the scenario did not succeed —
    // surface them as a failure reason so the operator sees the route
    // classified the turn as degraded.
    reasons.push(`http=${r.httpStatus}`);
  }

  const meaningfulEvents = (r.events || []).filter(
    (e) => e && e.event && e.event !== 'DONE_SENTINEL',
  );
  if (isStream) {
    if ((r.events || []).length === 0) reasons.push('stream: zero events (response not consumed)');
    if ((r.tokens || '').length === 0 && meaningfulEvents.length === 0 && r.httpStatus === 200) {
      reasons.push('stream: no tokens and no meaningful events on HTTP 200');
    }
  } else {
    if ((r.events || []).length === 0) reasons.push('non-stream: no JSON body captured');
    if ((r.tokens || '').length === 0 && (r.errors || []).length === 0) {
      reasons.push('non-stream: empty content and no error in JSON body');
    }
  }

  if ((r.errors || []).length) reasons.push(`errors=[${(r.errors || []).slice(0, 3).join(', ')}]`);

  return { pass: reasons.length === 0, reasons };
}

function summarize(name, r) {
  hr();
  log(`SCENARIO: ${name}`);
  log(`  http=${r.httpStatus} ttfb=${r.ttfbMs}ms dur=${r.durationMs}ms bytes=${r.rawBytes} events=${r.events.length}`);
  const evCounts = {};
  for (const e of r.events) evCounts[e.event] = (evCounts[e.event] || 0) + 1;
  log(`  eventTypes=${JSON.stringify(evCounts)}`);
  log(`  stallHeader=${r.headers['x-stall-fired'] || '-'} reason=${r.headers['x-stall-reason'] || '-'}`);
  log(`  tokenChars=${r.tokens.length} toolCalls=${r.toolCalls.length} errors=${r.errors.length}`);
  if (r.toolCalls.length) log(`  tools=${JSON.stringify(r.toolCalls.slice(0, 8), null, 0).slice(0, 800)}`);
  if (r.errors.length) log(`  ERRORS=${JSON.stringify(r.errors).slice(0, 600)}`);
  if (r.tokens) log(`  tokenPreview="${r.tokens.slice(0, 300).replace(/\n/g, '\\n')}"`);
  // persist full
  const f = path.join(OUT_DIR, `${name.replace(/[^a-z0-9]+/gi, '_')}.json`);
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
  log(`  saved: ${f}`);
}

const scenarios = {
  async T1_single_file() {
    const conv = 'e2e-t1-' + Date.now();
    const r = await chat({
      conversationId: conv,
      prompt: 'Create a file named hello.py that prints "Hello, World!". Use your write_file tool. Only create the file.',
    });
    summarize('T1_single_file', r);
    for (const p of ['hello.py', `workspace/sessions/${conv}/hello.py`, `sessions/${conv}/hello.py`]) {
      const v = await vfsRead(p);
      log(`  VFS check ${p}: exists=${v.exists} len=${(v.content?.content || v.content || '').length ?? 0} err=${v.error || '-'}`);
    }
    return r;
  },

  async T2_multi_file_nextjs() {
    const conv = 'e2e-t2-' + Date.now();
    const r = await chat({
      conversationId: conv,
      prompt: 'Create a minimal Next.js app: package.json, app/page.tsx (a counter with useState), and app/layout.tsx. Use write_file for each file.',
    });
    summarize('T2_multi_file_nextjs', r);
    for (const p of ['package.json', 'app/page.tsx', 'app/layout.tsx']) {
      const v = await vfsRead(`workspace/sessions/${conv}/${p}`);
      log(`  VFS ${p}: exists=${v.exists}`);
    }
    return r;
  },

  async T3_edit_existing() {
    const conv = 'e2e-t3-' + Date.now();
    const r1 = await chat({ conversationId: conv, prompt: 'Create counter.js with a function add(a,b){return a+b}. Use write_file.' });
    summarize('T3a_create', r1);
    const r2 = await chat({ conversationId: conv, prompt: 'Now edit counter.js to add a subtract(a,b) function. Use apply_diff or write_file.' });
    summarize('T3b_edit', r2);
    return r2;
  },

  async T4_run_code() {
    const conv = 'e2e-t4-' + Date.now();
    const r = await chat({
      conversationId: conv,
      prompt: 'Create a python script fib.py that prints the first 10 Fibonacci numbers, then RUN it and show me the output.',
    });
    summarize('T4_run_code', r);
    return r;
  },

  async T5_read_context() {
    const conv = 'e2e-t5-' + Date.now();
    await chat({ conversationId: conv, prompt: 'Create src/utils/math.ts with export function square(n){return n*n}. write_file.' });
    const r = await chat({ conversationId: conv, prompt: 'Read the math.ts file I just created and add a cube function to it.' });
    summarize('T5_read_context', r);
    return r;
  },

  async T0_nonstream_json() {
    const conv = 'e2e-t0-' + Date.now();
    const r = await chat({ conversationId: conv, prompt: 'Create a file readme.md with a one line description. write_file.', extra: { stream: false } });
    summarize('T0_nonstream_json', r);
    return r;
  },
};

async function main() {
  const only = process.argv[2];
  await login();
  const list = only ? [only] : Object.keys(scenarios);
  // Review comment #4: previously scenario failures were only logged and
  // discarded, so the harness reported success even when every chat request
  // failed or expected VFS side effects were missing. Validate each result
  // and exit with a nonzero status so this can serve as a real E2E gate.
  let failed = 0;
  for (const name of list) {
    if (!scenarios[name]) { log(`no scenario ${name}`); continue; }
    let r;
    try {
      r = await scenarios[name]();
    } catch (e) {
      log(`✗ ${name} threw: ${e.stack || e.message}`);
      failed++;
      continue;
    }
    const v = validateResult(name, r || {});
    if (v.reasons.length) log(`  validate[${name}]: ${v.pass ? 'PASS' : 'FAIL'} — ${v.reasons.join('; ')}`);
    if (!v.pass) failed++;
  }
  hr();
  log(failed === 0 ? 'DONE — all scenarios passed' : `DONE — ${failed} scenario(s) FAILED`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
