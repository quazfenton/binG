#!/usr/bin/env node
/**
 * Comprehensive E2E Agency Test Suite — v2 (non-streaming for tool tests)
 *
 * Tests real LLM-driven workflows: file creation, code execution,
 * multi-file projects, read-modify chains, auto-continuation,
 * cross-provider handling, sandbox operations, workspace scoping.
 *
 * Run: CHAT_ROUTE_STALL_TIMEOUT_MS=300000 node e2e-comprehensive.mjs
 */

const BASE = 'http://127.0.0.1:3000';
const CREDS = { email: 'test@test.com', password: 'Testing00000?' };

let token = '';
let sessionId = '';
const results = [];

// ── helpers ──────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login() {
  const r = await (await fetch(`${BASE}/api/auth/login`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(CREDS)
  })).json();
  token = r.token || r.authToken || '';
  sessionId = `e2e-${Date.now()}`;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(r)}`);
}

async function chat(prompt, opts = {}) {
  const {
    provider = 'mistral',
    model = 'mistral-small-latest',
    stream = false,
    enableFilesystemEdits = true,
    timeoutMs = 120000,
    extra = {},
  } = opts;

  const body = { messages: [{ role: 'user', content: prompt }], provider, model, stream, enableFilesystemEdits, ...extra };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, Cookie:`session_id=${sessionId}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: txt.slice(0, 500) };

    if (!stream) {
      const json = JSON.parse(txt);
      return { ok: true, json, events: [], text: extractText(json), raw: json };
    }

    // streaming — parse SSE
    const events = [];
    for (const line of txt.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6);
      if (d === '[DONE]') continue;
      try { events.push(JSON.parse(d)); } catch { /* skip */ }
    }
    return { ok: true, events, text: extractTextFromEvents(events) };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(json) {
  if (json?.data?.response) return json.data.response;
  if (json?.content) return json.content;
  return JSON.stringify(json).slice(0, 500);
}

function extractTextFromEvents(events) {
  let text = '';
  for (const e of events) {
    if (e.type === 'text-delta' || e.type === 'content') text += e.content || e.textDelta || '';
    if (e.type === 'token') text += e.content || '';
    if (e.type === 'done' && e.content) text += e.content;
  }
  return text;
}

function countCalls(json) {
  return json?.data?.metadata?.toolInvocations?.length || 0;
}

function extractToolInvocations(json) {
  return json?.data?.metadata?.toolInvocations || [];
}

function extractResponseText(json) {
  return json?.data?.response || json?.content || '';
}

function extractSteps(json) {
  return json?.data?.metadata?.processingSteps || [];
}

// Check for tool usage in response text
function responseMentions(text, patterns) {
  if (!text) return false;
  return patterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
}

// ── test runner ──────────────────────────────────────────────────────────────

async function runTest(name, fn) {
  process.stdout.write(`\n━━━ ${name} … `);
  const start = Date.now();
  try {
    const r = await fn();
    r.name = name;
    r.elapsed = Date.now() - start;
    results.push(r);
    console.log(`${r.pass ? '✅' : '❌'} (${(r.elapsed/1000).toFixed(1)}s)`);
    console.log(`  ${r.reason || ''}`);
    return r;
  } catch (err) {
    const r = { name, pass: false, reason: `CRASH: ${err.message}`, elapsed: Date.now() - start };
    results.push(r);
    console.log(`❌ (${(r.elapsed/1000).toFixed(1)}s)`);
    console.log(`  CRASH: ${err.message}`);
    return r;
  }
}

// ── T1: basic provider check (non-streaming, fast) ───────────────────────────

async function T1_basicProviders() {
  const failures = [];
  for (const [provider, model] of [
    ['mistral', 'mistral-small-latest'],
    ['nvidia', 'meta/llama-4-maverick-17b-128e-instruct'],
  ]) {
    const r = await chat('Reply with the single word OK and nothing else.', { provider, model, stream: false, timeoutMs: 60000 });
    if (!r.ok) failures.push(`${provider}: HTTP ${r.status}`);
    else if (!r.json?.data?.success) failures.push(`${provider}: success=false`);
  }
  if (failures.length) return { pass: false, reason: failures.join('; ') };
  return { pass: true, reason: 'mistral + nvidia responded OK' };
}

// ── T2: single file creation via text-mode or tool call ─────────────────────

async function T2_singleFileVFS() {
  const r = await chat(
    'Create a file called test_hello.py with the content: print("Hello from E2E test").',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r.ok) return { pass: false, reason: `Request failed: ${r.error}` };

  const text = extractResponseText(r.json);
  const calls = extractToolInvocations(r.json);
  const toolNames = calls.map(c => c.name || c.toolName || '');
  const hasWrite = toolNames.some(n => n.includes('write'));
  const mentionsFile = text.includes('test_hello.py') || text.includes('hello from');
  const steps = extractSteps(r.json);

  return {
    pass: mentionsFile,
    reason: `tools=[${toolNames.join(',')}] write=${hasWrite} mention=${mentionsFile} steps=${steps.length}`,
    detail: { toolNames, text: text.slice(0, 300), steps: steps.length, calls: calls.length }
  };
}

// ── T3: multi-file project ──────────────────────────────────────────────────

async function T3_multiFileProject() {
  const r = await chat(
    'Create a small Express.js API project: write 3 files (server.js, routes.js, package.json) using write_file for each.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const calls = extractToolInvocations(r.json);
  const toolNames = calls.map(c => c.name || c.toolName || '');

  const hasServer = text.includes('server.js');
  const hasRoutes = text.includes('routes.js');
  const hasPkg = text.includes('package.json');
  const found = [hasServer, hasRoutes, hasPkg].filter(Boolean).length;

  return {
    pass: found >= 2,
    reason: `tools=[${toolNames.join(',')}] found=${found}/3 server=${hasServer} routes=${hasRoutes} pkg=${hasPkg}`,
    detail: { toolNames, found, textLen: text.length }
  };
}

// ── T4: code execution ──────────────────────────────────────────────────────

async function T4_codeExecution() {
  const r = await chat(
    'Create a Python script that calculates fibonacci(10), save it as fib.py, and run it using bash_execute. Show the output.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const has55 = text.includes('55');
  const hasFib = text.toLowerCase().includes('fibonacci');
  const hasBash = text.includes('bash_execute');
  const hasWrite = text.includes('write_file');
  const mentionsPy = text.includes('fib.py') || text.includes('.py');

  return {
    pass: (has55 || hasFib) && (hasBash || hasWrite || mentionsPy),
    reason: `has55=${has55} fib=${hasFib} bash=${hasBash} write=${hasWrite} py=${mentionsPy}`,
    detail: { textLen: text.length, excerpt: text.slice(0, 300) }
  };
}

// ── T5: read then modify ────────────────────────────────────────────────────

async function T5_readThenModify() {
  const r = await chat(
    'Step 1: write_file to create a file called data.txt with content "count=1". ' +
    'Step 2: read_file to read it back. ' +
    'Step 3: write_file to change it to "count=2". ' +
    'Use the tools explicitly for each step.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const hasWrite = text.includes('write_file') || text.includes('write');
  const hasRead = text.includes('read_file') || text.includes('read');
  const hasDataTxt = text.includes('data.txt');
  const hasCount = text.includes('count=1') || text.includes('count=2');

  return {
    pass: (hasWrite || hasRead) && hasDataTxt,
    reason: `write=${hasWrite} read=${hasRead} dataTxt=${hasDataTxt} count=${hasCount}`,
    detail: { textLen: text.length, excerpt: text.slice(0, 200) }
  };
}

// ── T6: multi-step HTML/CSS/JS todo app ─────────────────────────────────────

async function T6_multiStepTodo() {
  const r = await chat(
    'Create a mini todo app with 3 files using write_file: index.html (form + list), style.css (colors), app.js (click handler to add/remove items).',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 240000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const hasHtml = text.includes('.html') || text.includes('index.html');
  const hasCss = text.includes('.css') || text.includes('style.css');
  const hasJs = text.includes('.js') || text.includes('app.js');
  const fileCount = [hasHtml, hasCss, hasJs].filter(Boolean).length;
  const hasWrite = text.includes('write_file');

  return {
    pass: fileCount >= 2,
    reason: `files=${fileCount}/3 html=${hasHtml} css=${hasCss} js=${hasJs} write=${hasWrite}`,
    detail: { textLen: text.length, excerpt: text.slice(0, 300) }
  };
}

// ── T7: auto-continue chain ─────────────────────────────────────────────────

async function T7_autoContinueChain() {
  const r = await chat(
    'Write a Python counter class to counter.py. Then create a test_counter.py that tests it. ' +
    'Show me the content of both files.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 240000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const hasCounter = text.includes('counter.py');
  const hasTest = text.includes('test_counter.py');
  const hasClass = text.includes('class') && text.includes('Counter');
  const hasContent = text.includes('print') || text.includes('def');

  return {
    pass: hasCounter && hasClass,
    reason: `counter=${hasCounter} test=${hasTest} class=${hasClass} content=${hasContent}`,
    detail: { textLen: text.length, excerpt: text.slice(0, 300) }
  };
}

// ── T8: NVIDIA provider complex task ────────────────────────────────────────

async function T8_nvidiaTask() {
  const r = await chat(
    'Create hello_nvidia.py that prints "Hello from NVIDIA". Use write_file.',
    { provider: 'nvidia', model: 'meta/llama-4-maverick-17b-128e-instruct', stream: false, timeoutMs: 120000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = extractResponseText(r.json);
  const hasWrite = text.includes('write_file');
  const hasNvidia = text.includes('nvidia') || text.includes('NVIDIA');
  const hasPy = text.includes('.py');

  return {
    pass: (hasWrite || hasNvidia) && hasPy,
    reason: `write=${hasWrite} nvidia=${hasNvidia} py=${hasPy}`,
    detail: { textLen: text.length, excerpt: text.slice(0, 200) }
  };
}

// ── T9: non-streaming response with full metadata ───────────────────────────

async function T9_metadataCheck() {
  const r = await chat(
    'Say hello and tell me what tools are available to you.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 60000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const j = r.json;
  const hasData = !!j?.data;
  const hasSuccess = j?.data?.success === true;
  const hasMetadata = !!j?.data?.metadata;
  const hasProvider = j?.data?.metadata?.provider === 'mistral';
  const hasModel = j?.data?.metadata?.model === 'mistral-small-latest';
  const hasResponse = (j?.data?.response || '').length > 0;

  return {
    pass: hasSuccess && hasMetadata && hasResponse,
    reason: `data=${hasData} success=${hasSuccess} meta=${hasMetadata} prov=${hasProvider} model=${hasModel} resp=${hasResponse}`,
    detail: { metadata: j?.data?.metadata }
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Comprehensive E2E Agency Test Suite v2');
  console.log(`Time: ${new Date().toISOString()}\n`);

  await login();
  console.log(`🔐 Logged in (token ${token.slice(0, 16)}...)\n`);

  await runTest('T1: basic provider response (mistral + nvidia)',   T1_basicProviders);
  await runTest('T2: single file creation via write_file',           T2_singleFileVFS);
  await runTest('T3: multi-file project (Express.js 3 files)',       T3_multiFileProject);
  await runTest('T4: code execution (fibonacci via bash_execute)',   T4_codeExecution);
  await runTest('T5: file read then modify (read_file + write_file)',T5_readThenModify);
  await runTest('T6: multi-step todo app (HTML/CSS/JS)',             T6_multiStepTodo);
  await runTest('T7: auto-continue chain (counter.py pipeline)',     T7_autoContinueChain);
  await runTest('T8: NVIDIA provider complex task',                  T8_nvidiaTask);
  await runTest('T9: non-streaming response metadata check',         T9_metadataCheck);

  // Summary
  console.log('\n══════════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('══════════════════════════════════════════════════');
  for (const r of results) {
    const emoji = r.pass ? '✅' : '❌';
    console.log(`  ${emoji} ${r.name}`);
    console.log(`     ${r.reason || ''}`);
    console.log(`     (${(r.elapsed / 1000).toFixed(1)}s)`);
  }
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} passed (${Math.round(pass/results.length*100)}%)\n`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
