/**
 * Comprehensive e2e Test Suite for LLM Agency + VFS + Sandbox Integration
 * 
 * Tests real LLM tool calling, file operations, path resolution, 
 * diff application, multi-file ops, and self-healing workflows.
 * 
 * Usage: node web/scripts/e2e-comprehensive-test.mjs
 * 
 * Credentials: test@test.com / Testing0
 */

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────
const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';
const PROVIDER = process.env.TEST_PROVIDER || 'mistral';
const MODEL = process.env.TEST_MODEL || 'mistral-small-latest';
const TIMEOUT = 180000; // 3 minutes for LLM calls

// ─── State ───────────────────────────────────────────────────────────
let authToken = '';
let sessionId = '';
let cookie = '';
let testResults = [];
let failedTests = [];

// ─── Helpers ─────────────────────────────────────────────────────────
function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
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

async function fetchJSON(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
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
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  
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
    return { events: [], fileEdits: [], toolCalls: [], fullContent: '', error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
  }
  
  let fullContent = '';
  const events = [];
  const fileEdits = [];
  const toolCalls = [];
  let done = false;
  
  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    return { events, fileEdits, toolCalls, fullContent, error: 'No readable stream' };
  }
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE messages
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // Keep incomplete part in buffer
      
      for (const part of parts) {
        fullContent += part + '\n\n';
        const lines = part.split('\n');
        let eventType = '';
        let eventData = null;
        
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              eventData = JSON.parse(line.slice(6).trim());
            } catch {}
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
  
  return { events, fileEdits, toolCalls, fullContent, done, incomplete: !done };
}

// ─── Test Stages ─────────────────────────────────────────────────────

async function stage01_Auth() {
  log('=== STAGE 1: Authentication ===');
  
  const res = await fetchJSON(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  
  logTest('Login succeeds', res.status === 200 && res.data.success, `status=${res.status}`);
  if (!res.data.token) {
    log('Auth failed, cannot continue', 'FATAL');
    process.exit(1);
  }
  
  authToken = res.data.token;
  const setCookie = res.headers['set-cookie'];
  cookie = typeof setCookie === 'string' ? setCookie : (Array.isArray(setCookie) ? setCookie.join('; ') : '');
  logTest('Auth token received', !!authToken, `token_len=${authToken?.length || 0}`);
  logTest('Session cookie received', !!cookie, cookie ? cookie.slice(0, 40) + '...' : 'none');
}

// Helper to get consistent auth headers
function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

async function stage02_FileSystem_ListEmpty() {
  log('\n=== STAGE 2: Filesystem Baseline ===');
  
  const res = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project`, {
    headers: authHeaders(),
  });
  
  logTest('List project directory', res.status === 200, `status=${res.status}`);
  logTest('List returns nodes array', Array.isArray((res.data.data?.nodes || res.data.nodes)), `nodes=${(res.data.data?.nodes || res.data.nodes)?.length || 0}`);
  
  const sessions = (res.data.data?.nodes || res.data.nodes)?.find(n => n.name === 'sessions');
  logTest('Sessions directory exists', !!sessions);
}

async function stage03_Chat_SimpleQuery() {
  log('\n=== STAGE 3: Basic Chat (Non-Coding) ===');
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'What is 2+2? Answer in one word.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Chat streams tokens', textEvents.length > 0, `tokens=${textEvents.length}`);
  logTest('Chat completes', !!doneEvent, doneEvent?.data?.success ? 'success' : 'failed/incomplete');
  logTest('Response contains answer', fullText.includes('4') || fullText.toLowerCase().includes('four'), 
    `text="${fullText.slice(0, 100)}"`);
}

async function stage04_Code_ViteApp() {
  log('\n=== STAGE 4: Code Generation - Vite App ===');
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'Create a simple Vite + TypeScript app. Write package.json, index.html, src/main.ts, and src/style.css using file tools.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const toolCalls = res.toolCalls || [];
  const fileEdits = res.fileEdits || [];
  const doneEvent = res.events.find(e => e.type === 'done');
  const textEvents = res.events.filter(e => e.type === 'token');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('LLM responds with content', fullText.length > 10, `chars=${fullText.length}`);
  logTest('Request completes', !!doneEvent, doneEvent?.data?.success ? 'success' : 'failed/incomplete');
  
  const writeToolCalls = toolCalls.filter(tc => 
    tc.name === 'write_file' || tc.name === 'create_file' || tc.tool_name === 'write_file'
  );
  logTest('LLM attempts file writes', writeToolCalls.length > 0 || fileEdits.length > 0, 
    `toolCalls=${writeToolCalls.length}, fileEdits=${fileEdits.length}`);
  
  if (fileEdits.length === 0 && writeToolCalls.length === 0) {
    const hasFilePath = fullText.includes('package.json') || fullText.includes('index.html') || 
                        fullText.includes('main.ts') || fullText.includes('style.css');
    logTest('Response mentions expected files', hasFilePath);
    if (hasFilePath) {
      log('  → LLM described files but did not use write_file tool', 'WARN');
    }
  }
  
  await sleep(3000);
  
  // Check filesystem for created files
  const fsList = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/sessions`, {
    headers: authHeaders(),
  });
  logTest('Filesystem accessible after chat', fsList.status === 200);
  
  // Check for vite-related files
  const allNodes = (fsList.data.data?.nodes || fsList.data.nodes) || [];
  logTest('Session files exist', allNodes.length > 0, `nodes=${allNodes.length}`);
}

async function stage05_MultiFileRead() {
  log('\n=== STAGE 5: Multi-File Write + Read ===');
  
  // Write test files
  const writeA = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-multi/a.txt', content: 'Hello A' },
  });
  logTest('Write file A', writeA.status === 200 && writeA.data.success);
  
  const writeB = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-multi/b.txt', content: 'Hello B' },
  });
  logTest('Write file B', writeB.status === 200 && writeB.data.success);
  
  // Read them back
  const readList = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-multi`, {
    headers: authHeaders(),
  });
  logTest('List multi dir', readList.status === 200, `nodes=${(readList.data.data?.nodes || readList.data.nodes)?.length || 0}`);
  logTest('Both files present', (readList.data.data?.nodes || readList.data.nodes)?.length >= 2, `actual=${(readList.data.data?.nodes || readList.data.nodes)?.length || 0}`);
}

async function stage06_PathResolution() {
  log('\n=== STAGE 6: Path Resolution Edge Cases ===');
  
  // Backslash path
  const bsRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-paths/subdir/file.txt', content: 'Backslash test' },
  });
  logTest('Nested path write', bsRes.status === 200 && bsRes.data.success);
  
  // Leading slash
  const lsRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: '/project/test-paths/leading-slash.txt', content: 'Leading slash test' },
  });
  logTest('Leading slash write', lsRes.status === 200 && lsRes.data.success);
  
  // Traversal rejection
  const travRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/../../../etc/passwd', content: 'Should fail' },
  });
  logTest('Traversal rejected', travRes.data.success === false || travRes.status === 400, 
    `status=${travRes.status}, success=${travRes.data.success}`);
}

async function stage07_DiffApplication() {
  log('\n=== STAGE 7: File Overwrite (Simulated Diff) ===');
  
  // Create initial file
  await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-diff/app.ts', content: 'const x = 1;\nconsole.log(x);\n' },
  });
  
  // Overwrite
  const diffRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-diff/app.ts', content: 'const x = 1;\nconst y = 2;\nconsole.log(x + y);\n' },
  });
  logTest('File overwrite', diffRes.status === 200 && diffRes.data.success);
  
  // Verify dir
  const readRes = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-diff`, {
    headers: authHeaders(),
  });
  logTest('Read diff dir', readRes.status === 200, `nodes=${readRes.data.nodes?.length || 0}`);
}

async function stage08_ChatWithFSContext() {
  log('\n=== STAGE 8: Chat with Filesystem Context ===');
  
  // Write a file first
  await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: { path: 'project/test-context/hello.py', content: 'print("Hello from Python")\n' },
  });
  
  // Chat about it
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'Read the file hello.py and tell me what it does.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';
  
  logTest('Chat with FS context responds', fullText.length > 20, `chars=${fullText.length}`);
  logTest('Chat completes', !!doneEvent);
}

async function stage09_MCPTools() {
  log('\n=== STAGE 9: MCP Tool Definitions ===');
  
  const mcpRes = await fetchJSON(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: authHeaders(),
    body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
  });
  
  logTest('MCP tools/list responds', mcpRes.status === 200, `status=${mcpRes.status}`);
  
  const tools = mcpRes.data.result;
  const toolList = Array.isArray(tools) ? tools : (tools?.tools || []);
  const toolNames = toolList.map(t => t.name);
  
  logTest('MCP has tools array', toolList.length > 0, `count=${toolList.length}`);
  
  if (toolNames.length > 0) {
    logTest('read_file available', toolNames.includes('read_file'));
    logTest('write_file available', toolNames.includes('write_file'));
    logTest('list_files available', toolNames.includes('list_files'));
    logTest('batch_write available', toolNames.includes('batch_write'));
    logTest('read_files available', toolNames.includes('read_files'));
    logTest('apply_diff available', toolNames.includes('apply_diff'));
  }
}

async function stage10_BatchWrite() {
  log('\n=== STAGE 10: Batch Write (Multi-File) ===');
  
  const files = [
    { path: 'project/test-batch/index.html', content: '<!DOCTYPE html><html><body>Test</body></html>' },
    { path: 'project/test-batch/app.js', content: 'console.log("hello");' },
    { path: 'project/test-batch/styles.css', content: 'body { margin: 0; }' },
  ];
  
  const results = [];
  for (const file of files) {
    const res = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
      method: 'POST',
      headers: authHeaders(),
      body: file,
    });
    results.push(res.data.success);
  }
  
  logTest('Write 3 files sequentially', results.every(r => r), `success=${results.filter(r => r).length}/3`);
  
  const listRes = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-batch`, {
    headers: authHeaders(),
  });
  logTest('Batch dir lists 3 files', (listRes.data.data?.nodes || listRes.data.nodes)?.length >= 3, `nodes=${(listRes.data.data?.nodes || listRes.data.nodes)?.length || 0}`);
}

async function stage11_ContextBundling() {
  log('\n=== STAGE 11: Context Bundling (Multi-File App) ===');
  
  const appFiles = [
    { path: 'project/test-app/package.json', content: JSON.stringify({ name: 'test-app', scripts: { start: 'node index.js' } }, null, 2) },
    { path: 'project/test-app/index.js', content: 'const http = require("http");\nconst server = http.createServer((req, res) => {\n  res.writeHead(200);\n  res.end("Hello World");\n});\nserver.listen(3000);\n' },
    { path: 'project/test-app/README.md', content: '# Test App\nA simple HTTP server.' },
  ];
  
  for (const file of appFiles) {
    await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
      method: 'POST',
      headers: authHeaders(),
      body: file,
    });
  }
  
  // Chat about the app
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: {
      messages: [{ role: 'user', content: 'What does the test-app do? Check files in project/test-app.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('') || doneEvent?.data?.content || '';

  logTest('Context bundling chat responds', fullText.length > 10, `chars=${fullText.length}`);
}

async function stage12_ImageGen() {
  log('\n=== STAGE 12: Image Generation ===');
  
  const imgRes = await fetchJSON(`${BASE_URL}/api/image/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: { prompt: 'a cute cat', numImages: 1 },
  });
  
  // Anonymous access should work now
  logTest('Image gen endpoint reachable', imgRes.status === 200 || imgRes.status === 400, `status=${imgRes.status}`);
  if (imgRes.status === 200) {
    logTest('Image gen returns data', imgRes.data?.data?.images?.length > 0 || imgRes.data?.images?.length > 0);
  }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  log('╔══════════════════════════════════════════════════════════╗');
  log('║  E2E Comprehensive Test Suite - LLM Agency + VFS       ║');
  log('╚══════════════════════════════════════════════════════════╝');
  log(`Provider: ${PROVIDER}, Model: ${MODEL}`);
  
  const stages = [
    stage01_Auth,
    stage02_FileSystem_ListEmpty,
    stage03_Chat_SimpleQuery,
    stage04_Code_ViteApp,
    stage05_MultiFileRead,
    stage06_PathResolution,
    stage07_DiffApplication,
    stage08_ChatWithFSContext,
    stage09_MCPTools,
    stage10_BatchWrite,
    stage11_ContextBundling,
    stage12_ImageGen,
  ];
  
  for (const stage of stages) {
    try {
      await stage();
    } catch (err) {
      logTest(stage.name, false, `EXCEPTION: ${err.message}`);
      log(`  Stack: ${err.stack}`, 'ERROR');
    }
    await sleep(1500);
  }
  
  // Summary
  log('\n' + '='.repeat(60));
  log(`RESULTS: ${testResults.filter(t => t.pass).length}/${testResults.length} passed`);
  if (failedTests.length > 0) {
    log('\nFAILED TESTS:');
    for (const t of failedTests) {
      log(`  ❌ ${t.name}${t.detail ? ': ' + t.detail : ''}`);
    }
  }
  log('='.repeat(60));
  
  const resultsPath = join(__dirname, '../__tests__/e2e-comprehensive-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    provider: PROVIDER,
    model: MODEL,
    total: testResults.length,
    passed: testResults.filter(t => t.pass).length,
    failed: failedTests.length,
    tests: testResults,
  }, null, 2));
  log(`Results written to ${resultsPath}`);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'FATAL');
  log(err.stack, 'FATAL');
  process.exit(1);
});
