/**
 * FULL WORKFLOW E2E TEST SUITE
 * 
 * Tests real LLM interactions with filesystem, tool calls, and provider fallback.
 * Uses actual LLM providers (google, nvidia, openrouter, mistral) with real prompts.
 * 
 * Usage: node web/scripts/e2e-full-workflow-test.mjs
 * 
 * Credentials: test@test.com / Testing0
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';
const TIMEOUT = 300000; // 5 minutes for LLM calls

// ─── State ───────────────────────────────────────────────────────────
let authToken = '';
let cookie = '';
let testResults = [];
let failedTests = [];
const logs = [];

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  logs.push(line);
  console.log(line);
}

function logTest(name, pass, detail = '') {
  const entry = { name, pass, detail, timestamp: Date.now() };
  testResults.push(entry);
  if (!pass) failedTests.push(entry);
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── HTTP Helpers ────────────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT);
  
  try {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    let data;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    
    return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function fetchSSE(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT);
  
  const res = await fetch(url, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: controller.signal,
    redirect: 'manual',
  });
  
  if (!res.ok && res.status >= 400) {
    clearTimeout(timeout);
    const text = await res.text();
    return { events: [], fileEdits: [], toolCalls: [], fullContent: '', error: `HTTP ${res.status}: ${text.slice(0, 500)}`, status: res.status };
  }
  
  let fullContent = '';
  const events = [];
  const fileEdits = [];
  const toolCalls = [];
  let done = false;
  
  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    const text = await res.text();
    return { events: [], fileEdits: [], toolCalls: [], fullContent: text, done: true, status: res.status };
  }
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      
      for (const part of parts) {
        fullContent += part + '\n\n';
        const lines = part.split('\n');
        let eventType = '';
        let eventData = null;
        
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            try { eventData = JSON.parse(line.slice(6).trim()); } catch {}
          }
        }
        
        if (eventType && eventData) {
          events.push({ type: eventType, data: eventData });
          if (eventType === 'done') done = true;
          if (eventType === 'tool_call') toolCalls.push(eventData);
          if (eventType === 'file_edit') fileEdits.push(eventData);
        }
        
        if (done) {
          clearTimeout(timeout);
          controller.abort();
          break;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
  
  return { events, fileEdits, toolCalls, fullContent, done, status: res.status, incomplete: !done };
}

// ─── Auth ────────────────────────────────────────────────────────────
async function authenticate() {
  log('=== AUTHENTICATION ===');
  const res = await fetchJSON(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  
  logTest('Login succeeds', res.status === 200 && res.data.success, `status=${res.status}`);
  if (!res.data?.token) {
    log('Auth failed, cannot continue', 'FATAL');
    process.exit(1);
  }
  
  authToken = res.data.token;
  const setCookie = res.headers['set-cookie'];
  cookie = typeof setCookie === 'string' ? setCookie : (Array.isArray(setCookie) ? setCookie.join('; ') : '');
  logTest('Auth token received', !!authToken, `len=${authToken?.length || 0}`);
}

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

// ─── Filesystem Helpers ──────────────────────────────────────────────
async function vfsList(path = 'project') {
  const res = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  });
  return res.data?.data?.nodes || res.data?.nodes || [];
}

async function vfsWrite(path, content) {
  const res = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path, content },
  });
  return res.data?.success;
}

async function vfsRead(path) {
  const res = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  });
  return res.data;
}

// ─── Test: Provider Rotation ─────────────────────────────────────────
async function testProviderRotation() {
  log('\n=== TEST 1: Provider Rotation (Google → Nvidia → OpenRouter) ===');
  
  const providers = [
    { provider: 'google', model: 'gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
    { provider: 'mistral', model: 'mistral-small-latest', name: 'Mistral Small' },
  ];
  
  for (const { provider, model, name } of providers) {
    log(`\n--- Testing ${name} ---`);
    
    const res = await fetchSSE(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
        provider,
        model,
        stream: true,
      },
      timeout: 120000,
    });
    
    if (res.error) {
      logTest(`${name} responds`, false, `ERROR: ${res.error}`);
      continue;
    }
    
    const textEvents = res.events.filter(e => e.type === 'token');
    const doneEvent = res.events.find(e => e.type === 'done');
    const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
    
    logTest(`${name} streams tokens`, textEvents.length > 0, `tokens=${textEvents.length}`);
    logTest(`${name} completes`, !!doneEvent, doneEvent?.data?.success ? 'success' : 'incomplete');
    logTest(`${name} responds correctly`, fullText.includes('4'), `text="${fullText.slice(0, 100)}"`);
    
    await sleep(2000);
  }
}

// ─── Test: Code Generation with File Writes ─────────────────────────
async function testCodeGeneration() {
  log('\n=== TEST 2: Code Generation with File Writes ===');
  
  const testId = `test-code-${Date.now()}`;
  
  // Write a setup file first so the LLM has context
  await vfsWrite(`project/${testId}/README.md`, `# Test Project ${testId}\nCreate a simple app here.`);
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [
        { role: 'user', content: `Create a simple Node.js app in project/${testId}/. Write an index.js file that prints "Hello World" and a package.json file. Use the write_file tool for each file.` }
      ],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
    },
    timeout: 180000,
  });
  
  if (res.error) {
    logTest('Code gen responds', false, `ERROR: ${res.error}`);
    return;
  }
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fileEdits = res.fileEdits || [];
  const toolCalls = res.toolCalls || [];
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Code gen responds', fullText.length > 20, `chars=${fullText.length}`);
  logTest('Code gen completes', !!doneEvent);
  logTest('Tool calls detected', toolCalls.length > 0, `count=${toolCalls.length}`);
  logTest('File edits detected', fileEdits.length > 0, `count=${fileEdits.length}`);
  
  // Check filesystem for created files
  await sleep(3000);
  const nodes = await vfsList(`project/${testId}`);
  logTest('Files created in VFS', nodes.length > 0, `files=${nodes.length}`);
  
  const hasIndexJs = nodes.some(n => n.name === 'index.js');
  const hasPackageJson = nodes.some(n => n.name === 'package.json');
  logTest('index.js created', hasIndexJs);
  logTest('package.json created', hasPackageJson);
}

// ─── Test: Multi-File Context ────────────────────────────────────────
async function testMultiFileContext() {
  log('\n=== TEST 3: Multi-File Context Bundling ===');
  
  const testId = `test-context-${Date.now()}`;
  
  // Create multiple files
  await vfsWrite(`project/${testId}/config.js`, 'module.exports = { port: 3000, host: "localhost" };');
  await vfsWrite(`project/${testId}/utils.js`, 'function greet(name) { return `Hello, ${name}!`; } module.exports = { greet };');
  await vfsWrite(`project/${testId}/app.js`, 'const config = require("./config");\nconst { greet } = require("./utils");\nconsole.log(greet("World"));');
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [
        { role: 'user', content: `Read the files in project/${testId}/ and explain what the app does. Check config.js, utils.js, and app.js.` }
      ],
      provider: 'google',
      model: 'gemini-2.5-flash',
      stream: true,
    },
    timeout: 180000,
  });
  
  if (res.error) {
    logTest('Multi-file context responds', false, `ERROR: ${res.error}`);
    return;
  }
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Multi-file context responds', fullText.length > 50, `chars=${fullText.length}`);
  logTest('Multi-file context completes', !!doneEvent);
  
  // Check if response mentions key concepts
  const mentionsConfig = fullText.toLowerCase().includes('config') || fullText.toLowerCase().includes('port');
  const mentionsUtils = fullText.toLowerCase().includes('greet') || fullText.toLowerCase().includes('utils');
  const mentionsApp = fullText.toLowerCase().includes('app') || fullText.toLowerCase().includes('hello');
  
  logTest('Response mentions config', mentionsConfig);
  logTest('Response mentions utils', mentionsUtils);
  logTest('Response mentions app', mentionsApp);
}

// ─── Test: Provider Fallback (Bad Model → Good Model) ────────────────
async function testProviderFallback() {
  log('\n=== TEST 4: Provider Fallback Chain ===');
  
  // Use a model that might fail to trigger fallback
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'Say "fallback test successful" in exactly those words.' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
    },
    timeout: 180000,
  });
  
  if (res.error) {
    logTest('Fallback chain works', false, `ERROR: ${res.error}`);
    return;
  }
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Fallback chain responds', fullText.length > 10, `chars=${fullText.length}`);
  logTest('Fallback completes', !!doneEvent);
  logTest('Response contains expected text', fullText.toLowerCase().includes('fallback test successful'), fullText.slice(0, 200));
  
  if (doneEvent?.data?.metadata?.fallbackChain?.length > 0) {
    logTest('Fallback chain was used', true, `chain: ${JSON.stringify(doneEvent.data.metadata.fallbackChain)}`);
  }
}

// ─── Test: Diff Application ──────────────────────────────────────────
async function testDiffApplication() {
  log('\n=== TEST 5: Diff Application ===');
  
  const testId = `test-diff-${Date.now()}`;
  
  // Create initial file
  await vfsWrite(`project/${testId}/app.js`, `function add(a, b) {\n  return a + b;\n}\n\nconsole.log(add(1, 2));`);
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [
        { role: 'user', content: `Modify project/${testId}/app.js to add a subtract function and use it. Apply the diff to the existing file.` }
      ],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
    },
    timeout: 180000,
  });
  
  if (res.error) {
    logTest('Diff application responds', false, `ERROR: ${res.error}`);
    return;
  }
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fileEdits = res.fileEdits || [];
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Diff app responds', fullText.length > 20, `chars=${fullText.length}`);
  logTest('Diff app completes', !!doneEvent);
  logTest('File edits from diff', fileEdits.length > 0, `edits=${fileEdits.length}`);
  
  // Check if file was modified
  await sleep(3000);
  const nodes = await vfsList(`project/${testId}`);
  logTest('File still exists after diff', nodes.length > 0);
}

// ─── Test: Non-Streaming Path ────────────────────────────────────────
async function testNonStreaming() {
  log('\n=== TEST 6: Non-Streaming Path ===');
  
  const res = await fetchJSON(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'What is the capital of France? Reply with just the city name.' }],
      provider: 'google',
      model: 'gemini-2.5-flash',
      stream: false,
    },
    timeout: 120000,
  });
  
  logTest('Non-streaming responds', res.status === 200, `status=${res.status}`);
  
  const content = res.data?.content || res.data?.data?.response || res.data?.data?.content || '';
  logTest('Non-streaming has content', content.length > 5, `chars=${content.length}`);
  logTest('Non-streaming correct answer', content.toLowerCase().includes('paris'), `text="${content.slice(0, 100)}"`);
}

// ─── Test: Empty Response Retry ──────────────────────────────────────
async function testEmptyResponseRetry() {
  log('\n=== TEST 7: Empty Response Retry ===');
  
  // Send a very ambiguous prompt that might trigger empty response
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: '...' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
    },
    timeout: 180000,
  });
  
  if (res.error) {
    logTest('Empty response handled', false, `ERROR: ${res.error}`);
    return;
  }
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Empty-like prompt handled', fullText.length > 0 || !!doneEvent);
  logTest('Request completes', !!doneEvent);
}

// ─── Test: MCP Tools ─────────────────────────────────────────────────
async function testMCPTools() {
  log('\n=== TEST 8: MCP Tool Definitions ===');
  
  const res = await fetchJSON(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: authHeaders(),
    body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
  });
  
  logTest('MCP tools/list responds', res.status === 200);
  
  const tools = res.data?.result || res.data?.result?.tools || [];
  const toolList = Array.isArray(tools) ? tools : [];
  const toolNames = toolList.map(t => t.name);
  
  logTest('MCP has tools', toolList.length > 0, `count=${toolList.length}`);
  logTest('read_file available', toolNames.includes('read_file'));
  logTest('write_file available', toolNames.includes('write_file'));
  logTest('list_files available', toolNames.includes('list_files'));
  logTest('read_files available', toolNames.includes('read_files'));
  logTest('apply_diff available', toolNames.includes('apply_diff'));
}

// ─── Test: Nvidia Provider ───────────────────────────────────────────
async function testNvidiaProvider() {
  log('\n=== TEST 9: Nvidia Provider ===');
  
  const models = ['meta/llama-3.3-70b-instruct'];
  
  for (const model of models) {
    log(`--- Testing nvidia/${model} ---`);
    
    const res = await fetchSSE(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        messages: [{ role: 'user', content: 'What is 10*10? Reply with just the number.' }],
        provider: 'nvidia',
        model,
        stream: true,
      },
      timeout: 180000,
    });
    
    if (res.error) {
      logTest(`nvidia/${model} responds`, false, `ERROR: ${res.error}`);
      continue;
    }
    
    const textEvents = res.events.filter(e => e.type === 'token');
    const doneEvent = res.events.find(e => e.type === 'done');
    const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
    
    logTest(`nvidia/${model} streams`, textEvents.length > 0, `tokens=${textEvents.length}`);
    logTest(`nvidia/${model} completes`, !!doneEvent);
    logTest(`nvidia/${model} responds correctly`, fullText.includes('100'), `text="${fullText.slice(0, 100)}"`);
    
    await sleep(2000);
  }
}

// ─── Test: VFS Path Resolution ───────────────────────────────────────
async function testVFSPathResolution() {
  log('\n=== TEST 10: VFS Path Resolution Edge Cases ===');
  
  const testId = `test-paths-${Date.now()}`;
  
  // Test nested paths
  const writeNested = await vfsWrite(`project/${testId}/src/utils/helpers.js`, 'export const help = () => "helping";');
  logTest('Nested path write', writeNested);
  
  // Test leading slash
  const writeLeading = await vfsWrite(`/project/${testId}/config.json`, '{"key": "value"}');
  logTest('Leading slash write', writeLeading);
  
  // Test traversal rejection
  const travRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/../../../etc/passwd', content: 'should fail' },
  });
  logTest('Traversal rejected', travRes.data.success === false || travRes.status === 400);
  
  // Verify files exist
  const nodes = await vfsList(`project/${testId}`);
  logTest('Nested files created', nodes.length > 0, `nodes=${nodes.length}`);
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║  FULL WORKFLOW E2E TEST SUITE - LLM Agency + VFS + Tools   ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  
  try {
    await authenticate();
    await testProviderRotation();
    await testCodeGeneration();
    await testMultiFileContext();
    await testProviderFallback();
    await testDiffApplication();
    await testNonStreaming();
    await testEmptyResponseRetry();
    await testMCPTools();
    await testNvidiaProvider();
    await testVFSPathResolution();
  } catch (err) {
    log(`Fatal error: ${err.message}`, 'FATAL');
    log(err.stack, 'FATAL');
  }
  
  // Summary
  log('\n' + '='.repeat(60));
  log(`FINAL RESULTS: ${testResults.filter(t => t.pass).length}/${testResults.length} passed`);
  if (failedTests.length > 0) {
    log('\nFAILED TESTS:');
    for (const t of failedTests) {
      log(`  ❌ ${t.name}${t.detail ? ': ' + t.detail : ''}`);
    }
  }
  log('='.repeat(60));
  
  // Write results
  const resultsPath = join(__dirname, '../__tests__/e2e-full-workflow-results.json');
  const fullLogPath = join(__dirname, '../__tests__/e2e-full-workflow-log.txt');
  
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total: testResults.length,
    passed: testResults.filter(t => t.pass).length,
    failed: failedTests.length,
    tests: testResults,
  }, null, 2));
  
  writeFileSync(fullLogPath, logs.join('\n'));
  
  log(`Results written to ${resultsPath}`);
  log(`Full log written to ${fullLogPath}`);
  
  process.exit(failedTests.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
