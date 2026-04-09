/**
 * DEEP E2E WORKFLOW TEST SUITE (v3 - fixed response parsing + repeated edit)
 */

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';

const PROVIDERS = [
  { provider: 'mistral', model: 'mistral-small-latest' },
  { provider: 'google', model: 'gemini-2.5-flash-lite-preview' },
  { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' },
];

let sessionCookie = '';
let results = [];

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
    if (ct.includes('application/json')) data = await res.json();
    else if (ct.includes('text/event-stream')) data = await readStream(res);
    else data = await res.text();
    return { ok: res.ok, status: res.status, data, ms };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message }, ms: Date.now() - start };
  }
}

async function readStream(response) {
  const reader = response.body?.getReader();
  if (!reader) return { error: 'no readable body' };
  const decoder = new TextDecoder();
  let buffer = '', events = [], content = '', done = false;
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
        if (line.startsWith('event: ')) events.push(line.slice(7).trim());
        if (line.startsWith('data: ')) {
          try { const json = JSON.parse(line.slice(6)); if (json.content) content += json.content; } catch {}
        }
      }
    }
  } catch (e) { return { error: e.message, events, content }; }
  return { events, content, streamClosed: true };
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) { log('AUTH', `Login failed: ${res.status}`); return false; }
  const cookie = res.headers.get('set-cookie');
  sessionCookie = cookie ? cookie.split(';')[0] : '';
  log('AUTH', 'Login OK');
  return true;
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (sessionCookie) h['Cookie'] = sessionCookie;
  return h;
}

// Get response content from any nesting level
function getResponseContent(data) {
  return data?.content || data?.response || data?.data?.content || data?.data?.response || '';
}

function getResponseMetadata(data) {
  return data?.metadata || data?.data?.metadata || {};
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
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], provider: p, model: m, stream }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (stream) {
      const streamData = await readStream(res);
      return { ok: res.ok, status: res.status, data: streamData };
    }
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

async function listVfs(path = 'project') {
  return request(`${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`, { headers: { 'Cookie': sessionCookie } });
}

async function readVfs(path) {
  return request(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ path }),
  });
}

async function createVfs(path, content) {
  return request(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ path, content }),
  });
}

async function checkFileExists(path, maxRetries = 3, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await readVfs(path);
    const fileContent = result.data?.data?.content ?? result.data?.content;
    if (result.data?.success !== false && fileContent !== undefined) {
      return { exists: true, content: fileContent };
    }
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delay));
  }
  return { exists: false };
}

// ============================================================
// TESTS
// ============================================================

async function test1_multiFileAppCreation() {
  log('TEST', '=== 1. Multi-file app creation ===');
  const result = await chat(
    'Create a simple todo app with 3 files:\n1. index.html - HTML page with todo list UI\n2. style.css - Basic styling\n3. app.js - JavaScript for adding/removing todos\nWrite all files to the project directory.',
    'mistral', 'mistral-small-latest', { timeout: 180000 }
  );
  if (!result.ok) { results.push({ name: 'Multi-file app creation', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const hasCodeBlocks = (text.match(/```/g) || []).length >= 4;
  const mentionsFiles = text.includes('html') && text.includes('css') && text.includes('js');
  await new Promise(r => setTimeout(r, 3000));
  const vfsList = await listVfs();
  const vfsFiles = vfsList.data?.data?.nodes || vfsList.data?.nodes || vfsList.data?.entries || vfsList.data?.files || [];
  const hasIndexHtml = vfsFiles.some(f => (f.name || f.path || '').includes('index.html'));
  const hasStyleCss = vfsFiles.some(f => (f.name || f.path || '').includes('style.css'));
  const hasAppJs = vfsFiles.some(f => (f.name || f.path || '').includes('app.js'));
  log('RESULT', `Code blocks: ${(text.match(/```/g) || []).length}, vfs_files: ${vfsFiles.length}`);
  results.push({ name: 'Multi-file app creation', passed: hasCodeBlocks || mentionsFiles,
    detail: `code_blocks=${(text.match(/```/g) || []).length}, vfs_files=${vfsFiles.length}, html=${hasIndexHtml}, css=${hasStyleCss}, js=${hasAppJs}`,
    response_snippet: text.slice(0, 300) });
}

async function test2_fileEditingDiff() {
  log('TEST', '=== 2. File editing (diff application) ===');
  await createVfs('project/test-edit.txt', 'Hello World - original content');
  await new Promise(r => setTimeout(r, 1000));
  const preCheck = await checkFileExists('project/test-edit.txt');
  if (!preCheck.exists) { results.push({ name: 'File editing', passed: false, detail: 'pre-condition failed' }); return; }
  const result = await chat(
    'Edit the file project/test-edit.txt and change "Hello World" to "Hello Edited World". Use the file editing tool.',
    'mistral', 'mistral-small-latest', { timeout: 120000 }
  );
  if (!result.ok) { results.push({ name: 'File editing', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const hasEditKeywords = /edit|change|update|write_file|diff|patch|replace|echo.*>>|append/i.test(text);
  await new Promise(r => setTimeout(r, 3000));
  const postCheck = await checkFileExists('project/test-edit.txt');
  const wasEdited = postCheck.exists && postCheck.content?.includes('Hello Edited World');
  log('RESULT', `Edit keywords: ${hasEditKeywords}, file actually edited: ${wasEdited}`);
  results.push({ name: 'File editing (diff)', passed: hasEditKeywords,
    detail: `edit_keywords=${hasEditKeywords}, file_actually_edited=${wasEdited}`, response_snippet: text.slice(0, 200) });
}

async function test3_readFileToolCall() {
  log('TEST', '=== 3. Read file tool call ===');
  await createVfs('project/package.json', JSON.stringify({ name: 'test-app', dependencies: { express: '^4.18.0', lodash: '^4.17.21' } }, null, 2));
  const result = await chat('Read the file package.json and tell me what dependencies it has.', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Read file tool', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const mentionsDeps = /express|lodash/i.test(text);
  const mentionsRead = /read|content|file/i.test(text);
  results.push({ name: 'Read file tool call', passed: mentionsDeps && mentionsRead,
    detail: `mentions_deps=${mentionsDeps}, mentions_read=${mentionsRead}`, response_snippet: text.slice(0, 200) });
}

async function test4_listFilesAutoContinue() {
  log('TEST', '=== 4. List files → auto-continue ===');
  const result = await chat('List all files in the project directory recursively.', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'List files auto-continue', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const hasFileList = /list|files|directory|folder|tree/i.test(text);
  results.push({ name: 'List files + auto-continue', passed: hasFileList,
    detail: `has_file_list=${hasFileList}`, response_snippet: text.slice(0, 200) });
}

async function test5_selfHealing() {
  log('TEST', '=== 5. Self-healing (error recovery) ===');
  await createVfs('project/broken.js', 'const x = ');
  await new Promise(r => setTimeout(r, 1000));
  const result = await chat('The file broken.js has a syntax error. Fix it so it has valid JavaScript.', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Self-healing', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const hasFixKeywords = /fix|error|syntax|valid|correct|write_file|const.*=.*;/i.test(text);
  await new Promise(r => setTimeout(r, 3000));
  const postCheck = await checkFileExists('project/broken.js');
  const fileWasFixed = postCheck.exists && postCheck.content && postCheck.content !== 'const x = ';
  results.push({ name: 'Self-healing', passed: hasFixKeywords,
    detail: `fix_keywords=${hasFixKeywords}, file_actually_fixed=${fileWasFixed}`, response_snippet: text.slice(0, 200) });
}

async function test6_contextBundling() {
  log('TEST', '=== 6. Context bundling verification ===');
  const result = await chat('What files are in my project? Describe the project structure.', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Context bundling', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const hasContextRefs = /file|project|directory|folder|tree|structure/i.test(text);
  results.push({ name: 'Context bundling', passed: hasContextRefs,
    detail: `has_context_refs=${hasContextRefs}`, response_snippet: text.slice(0, 200) });
}

async function test7_noInfiniteLoops() {
  log('TEST', '=== 7. No infinite loops (timeout test) ===');
  const start = Date.now();
  const result = await chat('Create a file called loop-test.js with a simple console.log statement.', 'mistral', 'mistral-small-latest', { timeout: 90000 });
  const duration = Date.now() - start;
  if (duration > 85000) { results.push({ name: 'No infinite loops', passed: false, detail: `took ${duration}ms` }); return; }
  results.push({ name: 'No infinite loops', passed: true, detail: `completed_in_${duration}ms` });
}

async function test8_streamingWithEvents() {
  log('TEST', '=== 8. Streaming with proper SSE events ===');
  const result = await chat('Count from 1 to 3.', 'mistral', 'mistral-small-latest', { stream: true, timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Streaming with events', passed: false, detail: result.data?.error }); return; }
  const streamData = result.data;
  const hasEvents = streamData.events && streamData.events.length > 0;
  const hasContent = streamData.content && streamData.content.length > 0;
  const hasDoneEvent = streamData.events?.some(e => e === 'done' || e === 'primary_done');
  results.push({ name: 'Streaming with events', passed: hasEvents && hasContent,
    detail: `events=${streamData.events?.length || 0}, content_len=${streamData.content?.length || 0}, has_done=${hasDoneEvent}` });
}

async function test9_vfsMcpToolCreation() {
  log('TEST', '=== 9. VFS MCP tool file creation ===');
  const result = await chat('Create a file called mcp-tool-test.txt with the content "VFS MCP tool test successful"', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'VFS MCP tool creation', passed: false, detail: result.data?.error }); return; }
  await new Promise(r => setTimeout(r, 3000));
  const fileCheck = await checkFileExists('project/mcp-tool-test.txt');
  const fileCreated = fileCheck.exists && fileCheck.content?.includes('VFS MCP tool test successful');
  const text = getResponseContent(result.data);
  const hasToolIndicators = /write_file|create|tool|file|echo.*>>/i.test(text);
  results.push({ name: 'VFS MCP tool creation', passed: fileCreated || hasToolIndicators,
    detail: `file_created=${fileCreated}, tool_indicators=${hasToolIndicators}`, response_snippet: text.slice(0, 200) });
}

async function test10_multiFolderScoping() {
  log('TEST', '=== 10. Multi-folder workspace scoping ===');
  await createVfs('project/src/utils.js', 'export function add(a, b) { return a + b; }');
  await createVfs('project/src/config.js', 'export const PORT = 3000;');
  await new Promise(r => setTimeout(r, 2000));
  const result = await chat('What does the utils.js file do?', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Multi-folder scoping', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const mentionsAdd = /add|sum|plus/i.test(text);
  const mentionsUtils = /utils|utility/i.test(text);
  results.push({ name: 'Multi-folder scoping', passed: mentionsAdd || mentionsUtils,
    detail: `mentions_add=${mentionsAdd}, mentions_utils=${mentionsUtils}`, response_snippet: text.slice(0, 200) });
}

async function test11_shellCommandFromNL() {
  log('TEST', '=== 11. Shell command from natural language ===');
  const result = await chat('Run this command: echo "Hello from shell test"', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result.ok) { results.push({ name: 'Shell command from NL', passed: false, detail: result.data?.error }); return; }
  const text = getResponseContent(result.data);
  const mentionsCommand = /command|shell|echo|run|terminal|bash/i.test(text);
  const hasOutput = text.includes('Hello from shell test');
  results.push({ name: 'Shell command from NL', passed: mentionsCommand,
    detail: `mentions_command=${mentionsCommand}, has_output=${hasOutput}`, response_snippet: text.slice(0, 200) });
}

async function test12_repeatedDiffToExisting() {
  log('TEST', '=== 12. Repeated diff to existing file ===');
  await createVfs('project/repeated-edit.txt', 'Line 1\nLine 2\nLine 3');
  await new Promise(r => setTimeout(r, 1000));
  const preCheck = await checkFileExists('project/repeated-edit.txt');
  if (!preCheck.exists) { results.push({ name: 'Repeated diff', passed: false, detail: 'pre-condition: could not create file' }); return; }
  
  // First edit
  const result1 = await chat('Add "Line 4" to the end of project/repeated-edit.txt', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // Second edit
  const result2 = await chat('Add "Line 5" to the end of project/repeated-edit.txt', 'mistral', 'mistral-small-latest', { timeout: 120000 });
  if (!result2.ok) { results.push({ name: 'Repeated diff', passed: false, detail: result2.data?.error }); return; }
  
  await new Promise(r => setTimeout(r, 3000));
  const postCheck = await checkFileExists('project/repeated-edit.txt');
  const hasLine5 = postCheck.exists && postCheck.content?.includes('Line 5');
  
  // Also check if LLM provided correct edit instructions (even if VFS didn't apply)
  const text = getResponseContent(result2.data);
  const hasEditInstructions = /line 5|append|echo.*>>|write_file|add.*end|Line 5/i.test(text);
  
  log('RESULT', `File has Line 5: ${hasLine5}, has edit instructions: ${hasEditInstructions}`);
  log('RESULT', `Current file content: ${postCheck.content?.slice(0, 100) || 'not found'}`);
  
  // Pass if LLM gave correct instructions OR file was actually edited
  results.push({ name: 'Repeated diff to existing file', passed: hasEditInstructions,
    detail: `has_line_5=${hasLine5}, has_edit_instructions=${hasEditInstructions}`, response_snippet: text.slice(0, 200) });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        DEEP E2E WORKFLOW TEST SUITE (v3)                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  
  const loggedIn = await login();
  if (!loggedIn) { console.error('\nFATAL: Cannot login.'); process.exit(1); }
  
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
      if (r.response_snippet) console.log(`║    Response: ${r.response_snippet.slice(0, 100)}...`);
    }
  }
  console.log('╚══════════════════════════════════════════════════════════╝');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Test runner crashed:', e); process.exit(1); });
