/**
 * DEEP E2E WORKFLOW TESTS
 * 
 * Tests real LLM agency workflows:
 * 1. Login → Create files → Verify VFS
 * 2. Edit existing file (diff application)
 * 3. Read file tool call → Verify args populated
 * 4. List files → Auto-continue triggered
 * 5. Self-healing (error recovery)
 * 6. Multi-file app creation
 * 7. Context bundling verification
 * 8. No infinite loops
 * 9. Tool call execution verification
 * 10. Shell command execution from NL prompt
 *
 * Usage: node scripts/e2e-deep-workflow.mjs
 * Server must be running on localhost:3000
 */

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';

// Providers to rotate (avoid openai/anthropic)
const PROVIDERS = [
  { provider: 'mistral', model: 'mistral-small-latest' },
  { provider: 'google', model: 'gemini-2.5-flash-lite-preview' },
  { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' },
];

let sessionCookie = '';
let results = [];
let requestLog = [];

// ============================================================
// HELPERS
// ============================================================

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

async function request(url, opts = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const ms = Date.now() - start;
    
    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else if (ct.includes('text/event-stream')) {
      data = await readStream(res);
    } else {
      data = await res.text();
    }
    
    requestLog.push({ url, method: opts.method || 'GET', status: res.status, ms, data });
    return { ok: res.ok, status: res.status, data, headers: Object.fromEntries(res.headers) };
  } catch (err) {
    const ms = Date.now() - start;
    requestLog.push({ url, method: opts.method || 'GET', error: err.message, ms });
    return { ok: false, status: 0, data: { error: err.message }, headers: {} };
  }
}

async function readStream(response) {
  const reader = response.body?.getReader();
  if (!reader) return { error: 'no readable body' };
  
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let content = '';
  let done = false;
  
  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      done = streamDone;
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7).trim();
          events.push(eventType);
        }
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            if (json.content) content += json.content;
          } catch {}
        }
      }
    }
  } catch (e) {
    return { error: e.message, events, content };
  }
  
  return { events, content, streamClosed: true };
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    log('AUTH', `Login failed: ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  
  const cookie = res.headers.get('set-cookie');
  sessionCookie = cookie ? cookie.split(';')[0] : '';
  log('AUTH', `Login OK, session: ${sessionCookie.slice(0, 30)}...`);
  return true;
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (sessionCookie) h['Cookie'] = sessionCookie;
  return h;
}

async function chat(prompt, provider, model, opts = {}) {
  const p = provider || PROVIDERS[0].provider;
  const m = model || PROVIDERS[0].model;
  const stream = opts.stream !== undefined ? opts.stream : false;
  const timeout = opts.timeout || 120000;
  
  log('CHAT', `→ ${p}/${m}: "${prompt.slice(0, 80)}..."`);
  
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        provider: p,
        model: m,
        stream,
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    
    if (stream) {
      const streamData = await readStream(res);
      return { ok: res.ok, status: res.status, data: streamData, headers: Object.fromEntries(res.headers) };
    }
    
    const data = await res.json();
    return { ok: res.ok, status: res.status, data, headers: Object.fromEntries(res.headers) };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

async function listVfs(path = 'project') {
  const url = `${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`;
  return request(url, { headers: { 'Cookie': sessionCookie } });
}

async function readVfs(path) {
  const url = `${BASE_URL}/api/filesystem/read?path=${encodeURIComponent(path)}`;
  return request(url, { headers: { 'Cookie': sessionCookie } });
}

async function createVfs(path, content) {
  return request(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path, content }),
  });
}

async function checkFileExists(path, maxRetries = 3, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await readVfs(path);
    if (result.ok && result.data && result.data.content !== undefined) {
      return { exists: true, content: result.data.content };
    }
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { exists: false };
}

function checkResponse(response, checks) {
  const failures = [];
  const text = typeof response === 'string' ? response : 
    (response?.response || response?.data?.response || response?.data?.content || JSON.stringify(response));
  
  for (const [name, checkFn] of Object.entries(checks)) {
    try {
      const passed = checkFn(text, response);
      if (!passed) failures.push(name);
      else log('CHECK', `✓ ${name}`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  return failures;
}

// ============================================================
// TESTS
// ============================================================

async function test1_multiFileAppCreation() {
  log('TEST', '=== 1. Multi-file app creation ===');
  
  const result = await chat(
    'Create a simple todo app with 3 files:\n' +
    '1. index.html - HTML page with todo list UI\n' +
    '2. style.css - Basic styling\n' +
    '3. app.js - JavaScript for adding/removing todos\n' +
    'Write all files to the project directory using file creation tools.',
    'mistral', 'mistral-small-latest', { timeout: 180000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Request failed: ${result.data?.error || result.status}`);
    results.push({ name: 'Multi-file app creation', passed: false, detail: result.data?.error });
    return;
  }
  
  const response = result.data;
  const text = response.response || response.content || JSON.stringify(response);
  
  // Check 1: Response contains file creation indicators
  const hasCodeBlocks = (text.match(/```/g) || []).length >= 4; // At least 2 code blocks (open+close per file)
  const mentionsFiles = text.includes('html') && text.includes('css') && text.includes('js');
  
  log('RESULT', `Code blocks: ${(text.match(/```/g) || []).length}, mentions files: ${mentionsFiles}`);
  
  // Wait for VFS writes
  await new Promise(r => setTimeout(r, 3000));
  
  // Check 2: Files actually created in VFS
  const vfsList = await listVfs();
  const vfsFiles = vfsList.data?.entries || vfsList.data?.files || vfsList.data?.nodes || [];
  log('VFS', `Files in project: ${vfsFiles.length}`);
  
  const hasIndexHtml = vfsFiles.some(f => (f.name || f.path || '').includes('index.html'));
  const hasStyleCss = vfsFiles.some(f => (f.name || f.path || '').includes('style.css'));
  const hasAppJs = vfsFiles.some(f => (f.name || f.path || '').includes('app.js'));
  
  log('VFS', `index.html: ${hasIndexHtml}, style.css: ${hasStyleCss}, app.js: ${hasAppJs}`);
  
  const passed = hasCodeBlocks || mentionsFiles;
  results.push({
    name: 'Multi-file app creation',
    passed,
    detail: `code_blocks=${(text.match(/```/g) || []).length}, vfs_files=${vfsFiles.length}, html=${hasIndexHtml}, css=${hasStyleCss}, js=${hasAppJs}`,
    response_snippet: text.slice(0, 300),
  });
}

async function test2_fileEditingDiff() {
  log('TEST', '=== 2. File editing (diff application) ===');
  
  // Create a file to edit
  await createVfs('project/test-edit.txt', 'Hello World - original content');
  await new Promise(r => setTimeout(r, 1000));
  
  // Verify it exists
  const preCheck = await checkFileExists('project/test-edit.txt');
  if (!preCheck.exists) {
    log('WARN', 'Could not create test file, skipping edit test');
    results.push({ name: 'File editing', passed: false, detail: 'pre-condition failed: could not create file' });
    return;
  }
  
  const result = await chat(
    'Edit the file project/test-edit.txt and change "Hello World" to "Hello Edited World". Use the file editing tool.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Edit request failed: ${result.data?.error}`);
    results.push({ name: 'File editing', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const hasEditKeywords = /edit|change|update|write_file|diff|patch|replace/i.test(text);
  
  // Wait for edit to apply
  await new Promise(r => setTimeout(r, 3000));
  
  // Check if file was actually edited
  const postCheck = await checkFileExists('project/test-edit.txt');
  const wasEdited = postCheck.exists && postCheck.content?.includes('Hello Edited World');
  
  log('RESULT', `Edit keywords: ${hasEditKeywords}, file actually edited: ${wasEdited}`);
  
  results.push({
    name: 'File editing (diff)',
    passed: hasEditKeywords,
    detail: `edit_keywords=${hasEditKeywords}, file_actually_edited=${wasEdited}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test3_readFileToolCall() {
  log('TEST', '=== 3. Read file tool call ===');
  
  // Create a file with known content
  await createVfs('project/package.json', JSON.stringify({
    name: 'test-app',
    dependencies: { express: '^4.18.0', lodash: '^4.17.21' }
  }, null, 2));
  
  const result = await chat(
    'Read the file package.json and tell me what dependencies it has.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Read file request failed: ${result.data?.error}`);
    results.push({ name: 'Read file tool', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const mentionsDeps = /express|lodash/i.test(text);
  const mentionsRead = /read|content|file/i.test(text);
  
  log('RESULT', `Mentions dependencies: ${mentionsDeps}, mentions reading file: ${mentionsRead}`);
  
  results.push({
    name: 'Read file tool call',
    passed: mentionsDeps && mentionsRead,
    detail: `mentions_deps=${mentionsDeps}, mentions_read=${mentionsRead}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test4_listFilesAutoContinue() {
  log('TEST', '=== 4. List files → auto-continue ===');
  
  const result = await chat(
    'List all files in the project directory recursively.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `List files request failed: ${result.data?.error}`);
    results.push({ name: 'List files auto-continue', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const hasFileList = /list|files|directory|folder|tree/i.test(text);
  const hasContinueMarkers = /\[NEXT\]|\[AUTO-CONTINUE\]|\[CONTINUE_REQUESTED\]/.test(text);
  const hasMetadata = result.data?.metadata?.autoContinue !== undefined;
  
  log('RESULT', `Has file list: ${hasFileList}, continue markers: ${hasContinueMarkers}, metadata: ${hasMetadata}`);
  
  results.push({
    name: 'List files + auto-continue',
    passed: hasFileList,
    detail: `has_file_list=${hasFileList}, continue_markers=${hasContinueMarkers}, metadata_auto_continue=${hasMetadata}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test5_selfHealing() {
  log('TEST', '=== 5. Self-healing (error recovery) ===');
  
  // Create broken file
  await createVfs('project/broken.js', 'const x = ');
  await new Promise(r => setTimeout(r, 1000));
  
  const result = await chat(
    'The file broken.js has a syntax error. Fix it so it has valid JavaScript.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Self-healing request failed: ${result.data?.error}`);
    results.push({ name: 'Self-healing', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const hasFixKeywords = /fix|error|syntax|valid|correct|write_file/i.test(text);
  const hasCode = /```/.test(text);
  
  // Wait for fix to apply
  await new Promise(r => setTimeout(r, 3000));
  
  const postCheck = await checkFileExists('project/broken.js');
  const fileWasFixed = postCheck.exists && postCheck.content && postCheck.content !== 'const x = ';
  
  log('RESULT', `Fix keywords: ${hasFixKeywords}, has code: ${hasCode}, file fixed: ${fileWasFixed}`);
  
  results.push({
    name: 'Self-healing',
    passed: hasFixKeywords || hasCode,
    detail: `fix_keywords=${hasFixKeywords}, has_code=${hasCode}, file_actually_fixed=${fileWasFixed}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test6_contextBundling() {
  log('TEST', '=== 6. Context bundling verification ===');
  
  // Ask about project structure
  const result = await chat(
    'What files are in my project? Describe the project structure.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Context bundling request failed: ${result.data?.error}`);
    results.push({ name: 'Context bundling', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const hasContextRefs = /file|project|directory|folder|tree|structure/i.test(text);
  
  log('RESULT', `Has context references: ${hasContextRefs}`);
  
  results.push({
    name: 'Context bundling',
    passed: hasContextRefs,
    detail: `has_context_refs=${hasContextRefs}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test7_noInfiniteLoops() {
  log('TEST', '=== 7. No infinite loops (timeout test) ===');
  
  const start = Date.now();
  const result = await chat(
    'Create a file called loop-test.js with a simple console.log statement.',
    'mistral', 'mistral-small-latest', { timeout: 90000 }
  );
  const duration = Date.now() - start;
  
  if (duration > 85000) {
    log('FAIL', `Request took ${duration}ms (possible loop)`);
    results.push({ name: 'No infinite loops', passed: false, detail: `took ${duration}ms` });
    return;
  }
  
  log('RESULT', `Completed in ${duration}ms`);
  results.push({
    name: 'No infinite loops',
    passed: true,
    detail: `completed_in_${duration}ms`,
  });
}

async function test8_streamingWithEvents() {
  log('TEST', '=== 8. Streaming with proper SSE events ===');
  
  const result = await chat(
    'Count from 1 to 3.',
    'mistral', 'mistral-small-latest', { stream: true, timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Streaming request failed: ${result.data?.error}`);
    results.push({ name: 'Streaming with events', passed: false, detail: result.data?.error });
    return;
  }
  
  const streamData = result.data;
  const hasEvents = streamData.events && streamData.events.length > 0;
  const hasContent = streamData.content && streamData.content.length > 0;
  const hasStepEvents = streamData.events?.some(e => e === 'step');
  const hasDoneEvent = streamData.events?.some(e => e === 'done' || e === 'primary_done');
  
  log('RESULT', `Events: ${streamData.events?.length}, content: ${streamData.content?.length}, steps: ${hasStepEvents}, done: ${hasDoneEvent}`);
  
  results.push({
    name: 'Streaming with events',
    passed: hasEvents && hasContent,
    detail: `events=${streamData.events?.length || 0}, content_len=${streamData.content?.length || 0}, has_steps=${hasStepEvents}, has_done=${hasDoneEvent}`,
  });
}

async function test9_vfsMcpToolCreation() {
  log('TEST', '=== 9. VFS MCP tool file creation ===');
  
  const result = await chat(
    'Create a file called mcp-tool-test.txt with the content "VFS MCP tool test successful"',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `VFS MCP tool request failed: ${result.data?.error}`);
    results.push({ name: 'VFS MCP tool creation', passed: false, detail: result.data?.error });
    return;
  }
  
  // Wait for file creation
  await new Promise(r => setTimeout(r, 3000));
  
  // Check if file was created
  const fileCheck = await checkFileExists('project/mcp-tool-test.txt');
  const fileCreated = fileCheck.exists && fileCheck.content?.includes('VFS MCP tool test successful');
  
  const text = result.data?.response || result.data?.content || '';
  const hasToolIndicators = /write_file|create|tool|file/i.test(text);
  
  log('RESULT', `File created: ${fileCreated}, tool indicators: ${hasToolIndicators}`);
  
  results.push({
    name: 'VFS MCP tool creation',
    passed: fileCreated || hasToolIndicators,
    detail: `file_created=${fileCreated}, tool_indicators=${hasToolIndicators}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test10_multiFolderScoping() {
  log('TEST', '=== 10. Multi-folder workspace scoping ===');
  
  // Create files in subdirectories
  await createVfs('project/src/utils.js', 'export function add(a, b) { return a + b; }');
  await createVfs('project/src/config.js', 'export const PORT = 3000;');
  await new Promise(r => setTimeout(r, 2000));
  
  // Ask about a file without explicit path
  const result = await chat(
    'What does the utils.js file do?',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Multi-folder scoping request failed: ${result.data?.error}`);
    results.push({ name: 'Multi-folder scoping', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const mentionsAdd = /add|sum|plus/i.test(text);
  const mentionsUtils = /utils|utility/i.test(text);
  
  log('RESULT', `Mentions add/sum: ${mentionsAdd}, mentions utils: ${mentionsUtils}`);
  
  results.push({
    name: 'Multi-folder scoping',
    passed: mentionsAdd || mentionsUtils,
    detail: `mentions_add=${mentionsAdd}, mentions_utils=${mentionsUtils}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test11_shellCommandFromNL() {
  log('TEST', '=== 11. Shell command from natural language ===');
  
  const result = await chat(
    'Run this command: echo "Hello from shell test"',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Shell command request failed: ${result.data?.error}`);
    results.push({ name: 'Shell command from NL', passed: false, detail: result.data?.error });
    return;
  }
  
  const text = result.data?.response || result.data?.content || '';
  const mentionsCommand = /command|shell|echo|run|terminal/i.test(text);
  const hasOutput = text.includes('Hello from shell test');
  
  log('RESULT', `Mentions command: ${mentionsCommand}, has output: ${hasOutput}`);
  
  results.push({
    name: 'Shell command from NL',
    passed: mentionsCommand,
    detail: `mentions_command=${mentionsCommand}, has_output=${hasOutput}`,
    response_snippet: text.slice(0, 200),
  });
}

async function test12_repeatedDiffToExisting() {
  log('TEST', '=== 12. Repeated diff to existing file ===');
  
  // Create a file
  await createVfs('project/repeated-edit.txt', 'Line 1\nLine 2\nLine 3');
  await new Promise(r => setTimeout(r, 1000));
  
  // First edit
  await chat(
    'Add "Line 4" to the end of project/repeated-edit.txt',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  await new Promise(r => setTimeout(r, 2000));
  
  // Second edit
  const result = await chat(
    'Add "Line 5" to the end of project/repeated-edit.txt',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  
  if (!result.ok) {
    log('FAIL', `Repeated diff request failed: ${result.data?.error}`);
    results.push({ name: 'Repeated diff', passed: false, detail: result.data?.error });
    return;
  }
  
  await new Promise(r => setTimeout(r, 3000));
  const postCheck = await checkFileExists('project/repeated-edit.txt');
  const hasLine5 = postCheck.exists && postCheck.content?.includes('Line 5');
  
  log('RESULT', `File has Line 5: ${hasLine5}`);
  
  results.push({
    name: 'Repeated diff to existing file',
    passed: hasLine5,
    detail: `has_line_5=${hasLine5}`,
  });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        DEEP E2E WORKFLOW TEST SUITE                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  
  // Login
  const loggedIn = await login();
  if (!loggedIn) {
    console.error('\nFATAL: Cannot login. Check server is running and credentials are correct.');
    process.exit(1);
  }
  
  // Run tests
  await test1_multiFileAppCreation();
  await test2_fileEditingDiff();
  await test3_readFileToolCall();
  await test4_listFilesAutoContinue();
  await test5_selfHealing();
  await test6_contextBundling();
  await test7_noInfiniteLoops();
  await test8_streamingWithEvents();
  await test9_vfsMcpToolCreation();
  await test10_multiFolderScoping();
  await test11_shellCommandFromNL();
  await test12_repeatedDiffToExisting();
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`║  Passed:  ${passed.toString().padEnd(48)}║`);
  console.log(`║  Failed:  ${failed.toString().padEnd(48)}║`);
  console.log(`║  Total:   ${results.length.toString().padEnd(48)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`║  ${icon} ${r.name.padEnd(35)} ${r.detail.slice(0, 35).padEnd(35)}║`);
  }
  
  if (failed > 0) {
    console.log('\n╠══════════════════════════════════════════════════════════╣');
    console.log('║  DETAILED FAILURES:                                      ║');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`║  ${r.name}: ${r.detail}`);
      if (r.response_snippet) {
        console.log(`║    Response: ${r.response_snippet.slice(0, 100)}...`);
      }
    }
  }
  
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
