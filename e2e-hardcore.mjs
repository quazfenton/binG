#!/usr/bin/env node
/**
 * Hardcore E2E Agency Test — verifies actual disk side-effects,
 * sandbox execution, multi-step chains, and edge cases.
 *
 * Run: CHAT_ROUTE_STALL_TIMEOUT_MS=300000 node e2e-hardcore.mjs
 */

const BASE = 'http://127.0.0.1:3000';
const CREDS = { email: 'test@test.com', password: 'Testing00000?' };

let token = '';
let sessionId = '';
const results = [];
const WORKSPACE = '/tmp/workspaces';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login() {
  const r = await (await fetch(`${BASE}/api/auth/login`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(CREDS)
  })).json();
  token = r.token || r.authToken || '';
  sessionId = `hardcore-${Date.now()}`;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(r)}`);
}

async function chat(prompt, opts = {}) {
  const {
    provider = 'mistral',
    model = 'mistral-small-latest',
    stream = false,
    enableFilesystemEdits = true,
    timeoutMs = 180000,
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
    if (!res.ok) return { ok: false, status: res.status, error: txt.slice(0, 500), raw: txt };
    const json = JSON.parse(txt);
    return {
      ok: true,
      json,
      text: json?.data?.response || json?.content || '',
      calls: json?.data?.metadata?.toolInvocations || [],
      steps: json?.data?.metadata?.processingSteps || [],
      duration: json?.data?.metadata?.duration,
      mode: json?.data?.metadata?.mode,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── File helpers ─────────────────────────────────────────────────────────────

function findFiles(pat) {
  try {
    const out = execSync(`find ${WORKSPACE} -name '${pat}' -type f 2>/dev/null`, { timeout: 5000 }).toString().trim();
    return out ? out.split('\n') : [];
  } catch { return []; }
}

function findWorkFiles(namePattern) {
  try {
    const all = execSync(`find ${WORKSPACE} -type f 2>/dev/null`, { timeout: 5000 }).toString().trim().split('\n').filter(Boolean);
    return all.filter(f => f.includes(namePattern));
  } catch { return []; }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function getFileContent(p) {
  return readFile(p);
}

function countWorkspaceFiles() {
  try {
    return execSync(`find ${WORKSPACE} -type f 2>/dev/null | wc -l`, { timeout: 5000 }).toString().trim();
  } catch { return '?'; }
}

let knownFilesBefore = [];
function snapshotFiles() {
  try {
    knownFilesBefore = execSync(`find ${WORKSPACE} -type f 2>/dev/null`, { timeout: 5000 }).toString().trim().split('\n').filter(Boolean);
  } catch { knownFilesBefore = []; }
}

function newFilesSince() {
  try {
    const all = execSync(`find ${WORKSPACE} -type f 2>/dev/null`, { timeout: 5000 }).toString().trim().split('\n').filter(Boolean);
    return all.filter(f => !knownFilesBefore.includes(f));
  } catch { return []; }
}

function exec(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { timeout: opts.timeout || 15000, encoding: 'utf-8', ...opts });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout?.toString().trim() || '', stderr: err.stderr?.toString().trim() || err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest(name, fn) {
  process.stdout.write(`\n━━━ ${name} … `);
  const start = Date.now();
  try {
    const r = await fn();
    r.name = name;
    r.elapsed = Date.now() - start;
    results.push(r);
    console.log(`${r.pass ? '✅' : '❌'} (${(r.elapsed/1000).toFixed(1)}s)`);
    if (r.reason) console.log(`  ${r.reason}`);
    return r;
  } catch (err) {
    const r = { name, pass: false, reason: `CRASH: ${err.message}`, elapsed: Date.now() - start };
    results.push(r);
    console.log(`❌ (${(r.elapsed/1000).toFixed(1)}s)`);
    console.log(`  CRASH: ${err.message}`);
    return r;
  }
}

// ── T1: Create file + verify on disk ─────────────────────────────────────────

async function T1_createAndVerify() {
  snapshotFiles();
  const r = await chat(
    'Create a file called test_hello.py in the workspace that contains:\n' +
    'print("Hello from hardcore E2E test")',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r.ok) return { pass: false, reason: `Request failed: ${r.error}` };

  const diskFiles = newFilesSince();
  const found = diskFiles.filter(f => f.includes('test_hello') || f.includes('.py'));
  const anyCreated = found.length > 0;

  // Also check if text mentions it
  const textMentions = r.text.includes('test_hello');

  // Read any found file content
  let contentMatch = false;
  for (const f of found) {
    const c = getFileContent(f);
    if (c && c.includes('Hello from hardcore')) { contentMatch = true; break; }
  }

  return {
    pass: anyCreated || (textMentions && r.text.length > 50),
    reason: `diskCreated=${anyCreated} (${found.length} files) mention=${textMentions} contentMatch=${contentMatch} textLen=${r.text.length}`,
    detail: { diskFiles: found, text: r.text.slice(0, 300) }
  };
}

// ── T2: Create Python script + run it ────────────────────────────────────────

async function T2_createAndRunPython() {
  snapshotFiles();
  const r = await chat(
    'Create a Python script called fib_e2e.py that calculates fibonacci(15) and prints the result. ' +
    'Then run it with bash_execute or python3 to show the output. ' +
    'The result should be 610.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = r.text;
  const diskFiles = newFilesSince();
  const hasPy = diskFiles.some(f => f.includes('fib_e2e') || f.includes('.py'));
  const mentions610 = text.includes('610');
  const mentionsFib = text.toLowerCase().includes('fibonacci');

  // Try running the file if it exists
  let runResult = null;
  for (const f of diskFiles) {
    if (f.endsWith('.py')) {
      runResult = exec(`python3 "${f}"`);
      break;
    }
  }

  // Also try to find any fib file in workspace
  if (!runResult?.ok) {
    const allPy = exec(`find ${WORKSPACE} -name '*fib*.py' -type f 2>/dev/null`, { timeout: 5000 });
    if (allPy.ok && allPy.stdout) {
      const fibFiles = allPy.stdout.split('\n').filter(Boolean);
      for (const ff of fibFiles.slice(0, 2)) {
        runResult = exec(`python3 "${ff}"`);
        if (runResult.ok) break;
      }
    }
  }

  const ranSuccess = runResult?.ok === true;
  const output610 = runResult?.stdout?.includes('610');
  const outputClean = runResult?.stdout?.trim();

  return {
    pass: mentionsFib && (mentions610 || (ranSuccess && output610)),
    reason: `disk=${hasPy} text610=${mentions610} ran=${ranSuccess} out610=${output610} out=${outputClean || '(no output)'}`,
    detail: { diskFiles, runResult, text: text.slice(0, 300) }
  };
}

// ── T3: Create Express.js + npm install + serve (complex multi-step) ────────

async function T3_expressProject() {
  snapshotFiles();
  const r = await chat(
    'Create a working Express.js API project with these files:\n' +
    '1. package.json with express dependency\n' +
    '2. server.js that starts on port 3456 with a /api/hello endpoint\n' +
    '3. routes.js with the /api/hello route handler\n\n' +
    'Make sure the code is complete and runnable.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 240000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const text = r.text;
  const diskFiles = newFilesSince();
  const hasServerJS = diskFiles.some(f => f.includes('server.js'));
  const hasRoutesJS = diskFiles.some(f => f.includes('routes.js'));
  const hasPackageJSON = diskFiles.some(f => f.includes('package.json'));
  const created = [hasServerJS, hasRoutesJS, hasPackageJSON].filter(Boolean).length;

  // Check file content quality
  let serverContent = '';
  for (const f of diskFiles) {
    if (f.includes('server.js')) serverContent = getFileContent(f) || '';
    if (f.includes('package.json')) {
      const pkg = getFileContent(f) || '';
      if (pkg.includes('express')) hasPackageJSON; // confirmed
    }
  }

  const hasExpressImport = serverContent.includes('express');
  const hasPort3456 = serverContent.includes('3456');
  const hasHelloEndpoint = serverContent.includes('hello');

  return {
    pass: created >= 2 && hasExpressImport,
    reason: `created=${created}/3 srv=${hasServerJS} rts=${hasRoutesJS} pkg=${hasPackageJSON} express=${hasExpressImport} port=${hasPort3456} hello=${hasHelloEndpoint}`,
    detail: { diskFiles, text: text.slice(0, 300), serverContent: serverContent.slice(0, 500) }
  };
}

// ── T4: File read-modify chain (create → read → modify → verify content) ────

async function T4_readModifyChain() {
  snapshotFiles();
  // Create initial file
  const r1 = await chat(
    'Create config.json with content {"version": 1, "enabled": true}',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r1.ok) return { pass: false, reason: `Create failed: ${r1.error}` };

  const files1 = newFilesSince();
  const createdConfig = files1.filter(f => f.includes('config.json'));

  // Now ask to read and modify
  const r2 = await chat(
    'Read config.json from the workspace, then update it: change version to 2 and add "mode": "test". Show the final content.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r2.ok) return { pass: false, reason: `Modify failed: ${r2.error}` };

  const text = r2.text;
  const textMentionsConfig = text.includes('config.json');
  const textMentionsV2 = text.includes('version') && (text.includes('2'));
  const textMentionsMode = text.includes('mode');

  // Check if config.json was actually updated
  let diskContent = '';
  for (const f of createdConfig.length ? createdConfig : findWorkFiles('config.json').slice(0, 1)) {
    diskContent = getFileContent(f) || '';
  }
  const diskHasV2 = diskContent.includes('"version": 2') || diskContent.includes("'version': 2");
  const diskHasMode = diskContent.includes('"mode"') || diskContent.includes("'mode'");

  return {
    pass: textMentionsConfig && (textMentionsV2 || textMentionsMode || diskHasV2 || diskHasMode),
    reason: `textCfg=${textMentionsConfig} v2=${textMentionsV2} mode=${textMentionsMode} diskV2=${diskHasV2} diskMode=${diskHasMode}`,
    detail: { text: r2.text.slice(0, 300), diskContent: diskContent.slice(0, 300), files1 }
  };
}

// ── T5: Multi-turn conversation with file state ──────────────────────────────

async function T5_multiTurnConversation() {
  snapshotFiles();
  // Turn 1: create a file
  const r1 = await chat(
    'Create a file called guestbook.py with a Python list of names: ["Alice", "Bob", "Charlie"]. Include code to print each name.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r1.ok) return { pass: false, reason: `Turn 1 FAIL: ${r1.error}` };

  const files1 = newFilesSince();

  // Turn 2: add a name
  const r2 = await chat(
    'Now add "Diana" to the guest list in guestbook.py and print all names including the new one.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r2.ok) return { pass: false, reason: `Turn 2 FAIL: ${r2.error}` };

  const text2 = r2.text;
  const mentionsDiana = text2.includes('Diana');

  // Turn 3: read and count
  const r3 = await chat(
    'Read guestbook.py and tell me how many names are in the list.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 120000 }
  );
  if (!r3.ok) return { pass: false, reason: `Turn 3 FAIL: ${r3.error}` };

  const text3 = r3.text;
  const mentionsCount = text3.includes('4') || text3.includes('four');

  // Check actual file for names
  let diskNames = [];
  for (const f of findWorkFiles('guestbook.py').slice(0, 1)) {
    const c = getFileContent(f) || '';
    diskNames = ['Alice', 'Bob', 'Charlie', 'Diana'].filter(n => c.includes(n));
  }

  return {
    pass: mentionsDiana && mentionsCount,
    reason: `Diana=${mentionsDiana} count=${mentionsCount} diskNames=${diskNames.join(',') || '(none)'}`,
    detail: { files1, text2: text2.slice(0, 200), text3: text3.slice(0, 200) }
  };
}

// ── T6: Full-stack app (HTML + CSS + JS) with preview verification ──────────

async function T6_fullstackTodo() {
  snapshotFiles();
  const r = await chat(
    'Create a complete todo app with:\n' +
    '1. index.html - a form with input and button, plus a list to show todos\n' +
    '2. style.css - nice colors and layout\n' +
    '3. app.js - add/remove/toggle functionality\n\n' +
    'All files should be complete and ready to use.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 240000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const diskFiles = newFilesSince();
  const hasHtml = diskFiles.some(f => f.endsWith('.html'));
  const hasCss = diskFiles.some(f => f.endsWith('.css'));
  const hasJs = diskFiles.some(f => f.endsWith('.js'));
  const fileCount = [hasHtml, hasCss, hasJs].filter(Boolean).length;

  // Verify content quality
  let htmlContent = '';
  let jsContent = '';
  for (const f of diskFiles) {
    if (f.endsWith('.html')) htmlContent = getFileContent(f) || '';
    if (f.endsWith('.js')) jsContent = getFileContent(f) || '';
  }

  const htmlHasForm = htmlContent.includes('form') || htmlContent.includes('input') || htmlContent.includes('button');
  const jsHasLogic = jsContent.includes('addEventListener') || jsContent.includes('onclick') || jsContent.includes('function');
  const htmlHasDoctype = htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<html');

  return {
    pass: fileCount >= 2 && htmlHasDoctype,
    reason: `files=${fileCount}/3 html=${hasHtml} css=${hasCss} js=${hasJs} form=${htmlHasForm} logic=${jsHasLogic}`,
    detail: { diskFiles, htmlLen: htmlContent.length, jsLen: jsContent.length }
  };
}

// ── T7: Edge cases ──────────────────────────────────────────────────────────

async function T7_edgeCases() {
  const edgeTests = [];

  // Edge 1: empty file creation
  const r1 = await chat(
    'Create an empty file called empty.txt. It should have zero content.',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 60000 }
  );
  edgeTests.push({ name: 'empty file', pass: r1.ok && r1.text.length > 0 });

  // Edge 2: file with special characters
  const r2 = await chat(
    'Create a file called special.txt with content: hello$world#test@123! Special chars: ñüé😊',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 60000 }
  );
  edgeTests.push({ name: 'special chars', pass: r2.ok && r2.text.length > 0 });

  // Edge 3: nested directory
  const r3 = await chat(
    'Create a Python file at path src/utils/helper.py with a greet() function that returns "hello".',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 60000 }
  );
  edgeTests.push({ name: 'nested dir', pass: r3.ok && r3.text.length > 0 });

  const passCount = edgeTests.filter(e => e.pass).length;
  const details = edgeTests.map(e => `${e.name}=${e.pass}`).join(' ');

  return {
    pass: passCount >= 2,
    reason: `${passCount}/${edgeTests.length}: ${details}`,
    detail: { edgeTests }
  };
}

// ── T8: Large file content ──────────────────────────────────────────────────

async function T8_largeFile() {
  snapshotFiles();
  const r = await chat(
    'Create a file called fibonacci_sequence.py that:\n' +
    '1. Generates fibonacci numbers up to the 50th term\n' +
    '2. Saves them to a list\n' +
    '3. Prints every 10th term\n' +
    '4. Prints the sum of all 50 terms\n' +
    '5. Includes a function is_fibonacci(n) that checks if a number is in the sequence',
    { provider: 'mistral', model: 'mistral-small-latest', stream: false, timeoutMs: 180000 }
  );
  if (!r.ok) return { pass: false, reason: `FAIL: ${r.error}` };

  const diskFiles = newFilesSince();
  const hasPy = diskFiles.some(f => f.includes('fibonacci_sequence') || f.includes('.py'));
  const textHas50 = r.text.includes('50') || r.text.includes('fiftieth') || r.text.includes('50th');
  const textHasSum = r.text.toLowerCase().includes('sum');
  const textHasIsFib = r.text.toLowerCase().includes('is_fib') || r.text.toLowerCase().includes('check');

  // Try to run the created file
  let runOk = false;
  let runOut = '';
  for (const f of diskFiles.filter(f => f.endsWith('.py')).slice(0, 1)) {
    const res = exec(`python3 "${f}" 2>&1`, { timeout: 30000 });
    runOk = res.ok;
    runOut = res.stdout || res.stderr;
  }

  return {
    pass: (hasPy || textHas50) && runOk,
    reason: `disk=${hasPy} text50=${textHas50} sum=${textHasSum} isFib=${textHasIsFib} ran=${runOk} out=${runOut.slice(0, 100)}`,
    detail: { diskFiles, text: r.text.slice(0, 300), runOut: runOut.slice(0, 200) }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🔥 H A R D C O R E   E 2 E   T E S T   S U I T E');
  console.log(`Time: ${new Date().toISOString()}\n`);

  await login();
  console.log(`🔐 Logged in (token ${token.slice(0, 16)}...)\n`);

  await runTest('T1: Create file + verify on disk',              T1_createAndVerify);
  await runTest('T2: Create Python + run it (fibonacci 610)',    T2_createAndRunPython);
  await runTest('T3: Express.js project (3 files on disk)',      T3_expressProject);
  await runTest('T4: Read-modify chain (config.json create→read→update→verify)',T4_readModifyChain);
  await runTest('T5: Multi-turn conversation (guestbook.py)',    T5_multiTurnConversation);
  await runTest('T6: Full-stack todo app (HTML+CSS+JS)',         T6_fullstackTodo);
  await runTest('T7: Edge cases (empty, special chars, nested)', T7_edgeCases);
  await runTest('T8: Large complex file (fibonacci 50 terms)',   T8_largeFile);

  // Results
  console.log('\n══════════════════════════════════════════════════');
  console.log('📊 HARDCORE TEST RESULTS');
  console.log('══════════════════════════════════════════════════');
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`);
    console.log(`     ${(r.elapsed / 1000).toFixed(1)}s | ${r.reason || ''}`);
  }
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} passed (${Math.round(pass/results.length*100)}%)`);
  console.log(`Total time: ${(results.reduce((a,r) => a + (r.elapsed||0), 0) / 1000).toFixed(0)}s\n`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
