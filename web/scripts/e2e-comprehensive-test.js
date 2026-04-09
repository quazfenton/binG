/**
 * Comprehensive e2e Test Suite for LLM Agency + VFS + Sandbox Integration
 * 
 * Tests real LLM tool calling, file operations, path resolution, 
 * diff application, multi-file ops, and self-healing workflows.
 * 
 * Usage: node web/scripts/e2e-comprehensive-test.js
 * 
 * Credentials: test@test.com / Testing0
 */

const http = require('http');
const https = require('https');

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

function fetchJSON(url, opts = {}) {
  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers,
      },
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data }, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function fetchSSE(url, opts = {}) {
  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    let fullContent = '';
    const events = [];
    let fileEdits = [];
    let toolCalls = [];
    let done = false;
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('SSE timeout')); }, TIMEOUT);

    const req = client.request(url, {
      method: opts.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    }, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        fullContent += text;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('event: ') && lines[i + 1]?.startsWith('data: ')) {
            const eventType = lines[i].slice(7).trim();
            try {
              const eventData = JSON.parse(lines[i + 1].slice(6).trim());
              events.push({ type: eventType, data: eventData });
              if (eventType === 'done') {
                done = true;
                clearTimeout(timeout);
                resolve({ events, fileEdits, toolCalls, fullContent });
              }
              if (eventType === 'tool_call') {
                toolCalls.push(eventData);
              }
              if (eventType === 'file_edit') {
                fileEdits.push(eventData);
              }
            } catch {}
            i++; // skip data line
          }
        }
      });
      res.on('end', () => {
        if (!done) {
          clearTimeout(timeout);
          resolve({ events, fileEdits, toolCalls, fullContent, incomplete: true });
        }
      });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
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
  cookie = res.headers['set-cookie']?.join('; ') || '';
  logTest('Auth token received', !!authToken);
  logTest('Session cookie received', !!cookie);
}

async function stage02_FileSystem_ListEmpty() {
  log('\n=== STAGE 2: Filesystem Baseline ===');
  
  // List root directory
  const res = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project`, {
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
  });
  
  logTest('List project directory', res.status === 200, `status=${res.status}`);
  logTest('List returns nodes array', Array.isArray(res.data.nodes), `nodes=${res.data.nodes?.length || 0}`);
  
  // Check sessions dir exists
  const sessions = res.data.nodes?.find(n => n.name === 'sessions') || {};
  logTest('Sessions directory exists', !!sessions.name || res.data.nodes?.some(n => n.name?.includes('session')));
}

async function stage03_Chat_SimpleQuery() {
  log('\n=== STAGE 3: Basic Chat (Non-Coding) ===');
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: cookie,
      'x-anonymous-session-id': sessionId || undefined,
    },
    body: {
      messages: [{ role: 'user', content: 'What is 2+2? Answer in one word.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const doneEvent = res.events.find(e => e.type === 'done');
  const fullText = textEvents.map(e => e.data.content || '').join('');
  
  logTest('Chat streams tokens', textEvents.length > 0, `tokens=${textEvents.length}`);
  logTest('Chat completes', !!doneEvent, doneEvent?.data?.success ? 'success' : 'failed');
  logTest('Response contains answer', fullText.includes('4') || fullText.toLowerCase().includes('four'), `text="${fullText.slice(0, 80)}"`);
}

async function stage04_Code_ViteApp() {
  log('\n=== STAGE 4: Code Generation - Vite App ===');
  
  // Clean session first - create fresh one
  const sessionId = `test-vite-${Date.now()}`;
  
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: cookie,
    },
    body: {
      messages: [{ role: 'user', content: 'Create a simple Vite + TypeScript app with index.html, package.json, src/main.ts, and src/style.css. Write each file.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const toolCalls = res.toolCalls || [];
  const fileEdits = res.fileEdits || [];
  const doneEvent = res.events.find(e => e.type === 'done');
  const textEvents = res.events.filter(e => e.type === 'token');
  const fullText = textEvents.map(e => e.data.content || '').join('');
  
  logTest('LLM responds with content', fullText.length > 10, `chars=${fullText.length}`);
  logTest('Request completes', !!doneEvent, doneEvent?.data?.success ? 'success' : 'failed');
  
  // Check if tool calls were made
  const writeToolCalls = toolCalls.filter(tc => 
    tc.name === 'write_file' || tc.name === 'create_file' || tc.tool_name === 'write_file'
  );
  logTest('LLM attempts file writes', writeToolCalls.length > 0 || fileEdits.length > 0, 
    `toolCalls=${writeToolCalls.length}, fileEdits=${fileEdits.length}`);
  
  if (fileEdits.length === 0 && writeToolCalls.length === 0) {
    log('  ⚠️  LLM did not use file tools. Checking response for file content hints...', 'WARN');
    const hasFilePath = fullText.includes('package.json') || fullText.includes('index.html') || 
                        fullText.includes('main.ts') || fullText.includes('style.css');
    logTest('  Response mentions expected files', hasFilePath);
    if (hasFilePath) {
      log('  → LLM described files but did not use write_file tool. This is a tool-calling gap.', 'WARN');
    }
  }
  
  // Check filesystem for created files
  await sleep(3000);
  const fsList = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/sessions`, {
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
  });
  
  logTest('Filesystem lists sessions', fsList.status === 200);
  
  // Check if any files were written
  const anyFiles = fsList.data.nodes?.filter(n => !n.isDirectory) || [];
  logTest('Files exist in VFS', anyFiles.length > 0, `files=${anyFiles.length}`);
}

async function stage05_MultiFileRead() {
  log('\n=== STAGE 5: Multi-File Read Tool ===');
  
  // First write a test file
  const writeRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/test-multi/a.txt', content: 'Hello A' },
  });
  logTest('Write file A', writeRes.status === 200 && writeRes.data.success);
  
  const writeRes2 = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/test-multi/b.txt', content: 'Hello B' },
  });
  logTest('Write file B', writeRes2.status === 200 && writeRes2.data.success);
  
  // Read them back
  const readRes = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-multi`, {
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
  });
  logTest('List multi dir', readRes.status === 200, `nodes=${readRes.data.nodes?.length || 0}`);
}

async function stage06_PathResolution() {
  log('\n=== STAGE 6: Path Resolution Edge Cases ===');
  
  // Test backslash path
  const bsRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/test-paths\\subdir\\file.txt', content: 'Backslash test' },
  });
  logTest('Backslash path write', bsRes.status === 200 && bsRes.data.success);
  
  // Test leading slash
  const lsRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: '/project/test-paths/leading-slash.txt', content: 'Leading slash test' },
  });
  logTest('Leading slash path write', lsRes.status === 200 && lsRes.data.success);
  
  // Test traversal rejection
  const travRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/../../../etc/passwd', content: 'Should fail' },
  });
  logTest('Traversal rejected', travRes.status === 400 || travRes.data.success === false);
}

async function stage07_DiffApplication() {
  log('\n=== STAGE 7: Diff Application ===');
  
  // Create initial file
  await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/test-diff/app.ts', content: 'const x = 1;\nconsole.log(x);\n' },
  });
  
  // Apply a diff
  const diffRes = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: {
      path: 'project/test-diff/app.ts',
      content: 'const x = 1;\nconst y = 2;\nconsole.log(x + y);\n',
    },
  });
  logTest('File overwrite (simulated diff)', diffRes.status === 200 && diffRes.data.success);
  
  // Read back
  const readRes = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-diff`, {
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
  });
  logTest('Read diff dir', readRes.status === 200);
}

async function stage08_ChatWithFSContext() {
  log('\n=== STAGE 8: Chat with Filesystem Context ===');
  
  // Write a file first
  await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { path: 'project/test-context/hello.py', content: 'print("Hello from Python")\n' },
  });
  
  // Chat about it
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: cookie,
    },
    body: {
      messages: [{ role: 'user', content: 'Read the file hello.py and tell me what it does.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const fullText = textEvents.map(e => e.data.content || '').join('');
  const doneEvent = res.events.find(e => e.type === 'done');
  
  logTest('Chat with FS context responds', fullText.length > 20, `chars=${fullText.length}`);
  logTest('Chat completes', !!doneEvent);
}

async function stage09_TerminalPTY() {
  log('\n=== STAGE 9: Terminal/PTY ===');
  
  // Test terminal stream endpoint
  const termRes = await fetchJSON(`${BASE_URL}/api/sandbox/terminal/stream`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { command: 'echo hello' },
  });
  
  // This might 503 if no sandbox is running, which is expected
  logTest('Terminal stream endpoint reachable', 
    termRes.status === 200 || termRes.status === 503 || termRes.status === 400,
    `status=${termRes.status}`);
}

async function stage10_MCPTools() {
  log('\n=== STAGE 10: MCP Tool Definitions ===');
  
  // Test MCP route
  const mcpRes = await fetchJSON(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
    body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
  });
  
  logTest('MCP tools/list responds', mcp.status === 200 && mcp.data.result, `tools=${mcp.data.result?.length || 0}`);
  
  if (mcp.data.result) {
    const toolNames = mcp.data.result.map(t => t.name);
    logTest('read_file tool available', toolNames.includes('read_file'));
    logTest('write_file tool available', toolNames.includes('write_file'));
    logTest('list_files tool available', toolNames.includes('list_files'));
    logTest('batch_write tool available', toolNames.includes('batch_write'));
    logTest('read_files tool available', toolNames.includes('read_files'));
    logTest('apply_diff tool available', toolNames.includes('apply_diff'));
  }
}

async function stage11_EmptyResponseRetry() {
  log('\n=== STAGE 11: Empty Response Retry ===');
  
  // Send a very ambiguous prompt that might trigger empty response
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: cookie,
    },
    body: {
      messages: [{ role: 'user', content: '...' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const doneEvent = res.events.find(e => e.type === 'done');
  const textEvents = res.events.filter(e => e.type === 'token');
  const fullText = textEvents.map(e => e.data.content || '').join('');
  
  logTest('Empty-like prompt handled gracefully', !!doneEvent || fullText.length > 0);
}

async function stage12_BatchWrite() {
  log('\n=== STAGE 12: Batch Write (Multi-File) ===');
  
  // Test batch write via filesystem API
  const files = [
    { path: 'project/test-batch/index.html', content: '<!DOCTYPE html><html><body>Test</body></html>' },
    { path: 'project/test-batch/app.js', content: 'console.log("hello");' },
    { path: 'project/test-batch/styles.css', content: 'body { margin: 0; }' },
  ];
  
  const results = [];
  for (const file of files) {
    const res = await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
      body: file,
    });
    results.push(res.data.success);
  }
  
  logTest('Batch write 3 files', results.every(r => r), `success=${results.filter(r => r).length}/3`);
  
  // Verify via list
  const listRes = await fetchJSON(`${BASE_URL}/api/filesystem/list?path=project/test-batch`, {
    headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
  });
  logTest('Batch dir lists 3 files', listRes.data.nodes?.length >= 3, `nodes=${listRes.data.nodes?.length || 0}`);
}

async function stage13_ContextBundling() {
  log('\n=== STAGE 13: Context Bundling ===');
  
  // Write multiple files that form a coherent app
  const appFiles = [
    { path: 'project/test-app/package.json', content: JSON.stringify({ name: 'test-app', scripts: { start: 'node index.js' } }, null, 2) },
    { path: 'project/test-app/index.js', content: 'const http = require("http");\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, {"Content-Type": "text/plain"});\n  res.end("Hello World");\n});\nserver.listen(3000);\n' },
    { path: 'project/test-app/README.md', content: '# Test App\nA simple HTTP server.' },
  ];
  
  for (const file of appFiles) {
    await fetchJSON(`${BASE_URL}/api/filesystem/write`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, Cookie: cookie },
      body: file,
    });
  }
  
  // Chat about the app
  const res = await fetchSSE(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: cookie,
    },
    body: {
      messages: [{ role: 'user', content: 'What does the test-app do? Check the files in project/test-app.' }],
      provider: PROVIDER,
      model: MODEL,
      stream: true,
    },
  });
  
  const textEvents = res.events.filter(e => e.type === 'token');
  const fullText = textEvents.map(e => e.data.content || '').join('');
  
  logTest('Context bundling chat responds', fullText.length > 50, `chars=${fullText.length}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
    stage09_TerminalPTY,
    stage10_MCPTools,
    stage11_EmptyResponseRetry,
    stage12_BatchWrite,
    stage13_ContextBundling,
  ];
  
  for (const stage of stages) {
    try {
      await stage();
    } catch (err) {
      logTest(stage.name, false, `EXCEPTION: ${err.message}`);
      log(`  Stack: ${err.stack}`, 'ERROR');
    }
    await sleep(1000);
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
  
  // Write results
  const fs = require('fs');
  const resultsPath = 'web/__tests__/e2e-comprehensive-results.json';
  fs.writeFileSync(resultsPath, JSON.stringify({
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
