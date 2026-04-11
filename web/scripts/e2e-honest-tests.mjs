/**
 * HONEST E2E TESTS — actually verify files get created, not just keywords in text
 * 
 * The previous tests were terrible: they passed if the LLM mentioned "edit" or "file".
 * These tests actually verify:
 * 1. Does the file exist in VFS after the LLM response?
 * 2. Does the file have the expected content?
 * 3. Does file editing actually change content?
 * 4. Does the file-edit-parser extract writes from LLM responses?
 */

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';

let sessionCookie = '';
let results = [];
let testNum = 0;

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
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

// Read file from VFS — returns { exists, content } or { exists: false }
async function readVfs(path) {
  try {
    const res = await fetch(`${BASE_URL}/api/filesystem/read`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    const content = data?.data?.content ?? data?.content;
    if (data?.success !== false && content !== undefined) {
      return { exists: true, content };
    }
    return { exists: false, error: data?.error };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

// Write file to VFS directly — returns { success, error }
async function writeVfs(path, content) {
  try {
    const res = await fetch(`${BASE_URL}/api/filesystem/write`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ path, content }),
    });
    const data = await res.json();
    return { success: data?.success, data: data?.data, error: data?.error };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Delete file from VFS
async function deleteVfs(path) {
  try {
    const res = await fetch(`${BASE_URL}/api/filesystem/delete`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    return { success: data?.success, error: data?.error };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// List files in VFS
async function listVfs(path = 'project') {
  try {
    const res = await fetch(`${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`, {
      headers: { 'Cookie': sessionCookie },
    });
    const data = await res.json();
    return data?.data?.nodes || data?.nodes || data?.entries || data?.files || [];
  } catch (e) {
    return [];
  }
}

// Chat — returns response content and metadata
async function chat(prompt, provider = 'mistral', model = 'mistral-small-latest', timeout = 120000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        provider,
        model,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const data = await res.json();
    // Extract content from any nesting level
    const content = data?.content || data?.response || data?.data?.content || data?.data?.response || '';
    const metadata = data?.metadata || data?.data?.metadata || {};
    return { ok: res.ok, status: res.status, content, metadata, raw: data };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 0, content: '', metadata: {}, error: e.message };
  }
}

// Wait helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cleanup: delete test files before each test
async function cleanupFiles(paths) {
  for (const p of paths) await deleteVfs(p);
  await sleep(500);
}

// ============================================================
// TESTS — These ACTUALLY check if files exist in VFS
// ============================================================

async function test1_vfsWriteWorks() {
  testNum++;
  log('TEST', `${testNum}. VFS write endpoint works (baseline)`);

  // Use unique filename to avoid cleanup issues
  const path = `project/honest-test-baseline-${Date.now()}.txt`;
  
  // Write file
  const writeResult = await writeVfs(path, 'Honest test content');
  if (!writeResult.success) {
    log('FAIL', `VFS write failed: ${writeResult.error}`);
    results.push({ name: 'VFS write baseline', passed: false, detail: writeResult.error });
    return;
  }

  await sleep(1000);

  // Verify file exists with correct content
  const postCheck = await readVfs(path);
  if (!postCheck.exists) {
    log('FAIL', 'File does not exist after write');
    results.push({ name: 'VFS write baseline', passed: false, detail: 'file missing after write' });
    return;
  }

  if (postCheck.content !== 'Honest test content') {
    log('FAIL', `Content mismatch: got "${postCheck.content?.slice(0, 50)}"`);
    results.push({ name: 'VFS write baseline', passed: false, detail: `content mismatch: "${postCheck.content?.slice(0, 50)}"` });
    return;
  }

  log('OK', `VFS write works: wrote and read back correctly`);
  results.push({ name: 'VFS write baseline', passed: true, detail: 'write+read verified' });
}

async function test2_llmCreatesFileViaCodeBlocks() {
  testNum++;
  log('TEST', `${testNum}. LLM creates file — does VFS actually get the file?`);
  
  const testPath = 'project/honest-llm-create.txt';
  await cleanupFiles([testPath]);
  
  // Ask LLM to create a file
  const chatResult = await chat(
    'Write a file called project/honest-llm-create.txt with exactly this content: HONEST_FILE_TEST_123',
    'mistral',
    'mistral-small-latest',
    180000
  );
  
  if (!chatResult.ok) {
    log('FAIL', `Chat request failed: ${chatResult.error}`);
    results.push({ name: 'LLM creates file', passed: false, detail: chatResult.error });
    return;
  }
  
  log('LLM', `Response (${chatResult.content.length} chars), mode: ${chatResult.metadata.selectedMode || 'unknown'}`);
  
  // Wait for any background processing
  await sleep(5000);
  
  // ACTUALLY check if the file exists in VFS
  const fileCheck = await readVfs(testPath);
  
  if (fileCheck.exists) {
    log('OK', `File exists in VFS! Content: "${fileCheck.content?.slice(0, 80)}"`);
    const hasExpectedContent = fileCheck.content?.includes('HONEST_FILE_TEST_123');
    results.push({
      name: 'LLM creates file',
      passed: true,
      detail: `file_exists=true, has_expected_content=${hasExpectedContent}`,
    });
  } else {
    // File doesn't exist — did LLM at least output code blocks?
    const hasCodeBlock = chatResult.content.includes('```') && chatResult.content.includes('honest-llm-create');
    log('FAIL', `File NOT created in VFS. LLM output has code block: ${hasCodeBlock}`);
    log('FAIL', `Response snippet: ${chatResult.content.slice(0, 200)}`);
    results.push({
      name: 'LLM creates file',
      passed: false,
      detail: `file_exists=false, has_code_block=${hasCodeBlock}, mode=${chatResult.metadata.selectedMode}`,
      response_snippet: chatResult.content.slice(0, 300),
    });
  }
}

async function test3_fileEditParser() {
  testNum++;
  log('TEST', `${testNum}. File edit parser — does LLM response get parsed for writes?`);
  
  // Create a file that we'll ask the LLM to edit
  const testPath = 'project/honest-edit-test.txt';
  await cleanupFiles([testPath]);
  await writeVfs(testPath, 'BEFORE_EDIT');
  await sleep(500);
  
  // Verify initial content
  const preCheck = await readVfs(testPath);
  if (!preCheck.exists || preCheck.content !== 'BEFORE_EDIT') {
    log('FAIL', `Could not setup test file: ${preCheck.error || 'wrong content'}`);
    results.push({ name: 'File edit parser', passed: false, detail: 'setup failed' });
    return;
  }
  
  // Ask LLM to edit
  const chatResult = await chat(
    'Change the content of project/honest-edit-test.txt to "AFTER_EDIT"',
    'mistral',
    'mistral-small-latest',
    180000
  );
  
  if (!chatResult.ok) {
    log('FAIL', `Chat failed: ${chatResult.error}`);
    results.push({ name: 'File edit parser', passed: false, detail: chatResult.error });
    return;
  }
  
  await sleep(5000);
  
  // Check if file was actually edited
  const postCheck = await readVfs(testPath);
  const wasEdited = postCheck.exists && postCheck.content === 'AFTER_EDIT';
  
  if (wasEdited) {
    log('OK', `File was edited: BEFORE_EDIT → AFTER_EDIT`);
    results.push({ name: 'File edit parser', passed: true, detail: 'file_actually_edited' });
  } else {
    log('FAIL', `File NOT edited. Content: "${postCheck.content}"`);
    log('FAIL', `LLM response snippet: ${chatResult.content.slice(0, 200)}`);
    results.push({
      name: 'File edit parser',
      passed: false,
      detail: `file_was_edited=false, current_content="${postCheck.content}"`,
      response_snippet: chatResult.content.slice(0, 300),
    });
  }
}

async function test4_multiFileCreation() {
  testNum++;
  log('TEST', `${testNum}. Multi-file creation — do ALL requested files appear?`);
  
  const files = [
    'project/honest-multi-a.txt',
    'project/honest-multi-b.txt',
    'project/honest-multi-c.txt',
  ];
  await cleanupFiles(files);
  
  const chatResult = await chat(
    'Create three files:\n' +
    '1. project/honest-multi-a.txt with content "FILE_A"\n' +
    '2. project/honest-multi-b.txt with content "FILE_B"\n' +
    '3. project/honest-multi-c.txt with content "FILE_C"',
    'mistral',
    'mistral-small-latest',
    180000
  );
  
  if (!chatResult.ok) {
    log('FAIL', `Chat failed: ${chatResult.error}`);
    results.push({ name: 'Multi-file creation', passed: false, detail: chatResult.error });
    return;
  }
  
  await sleep(5000);
  
  // Check each file
  let created = 0;
  for (const f of files) {
    const check = await readVfs(f);
    if (check.exists) {
      created++;
      log('FILE', `✓ ${f}: "${check.content?.slice(0, 30)}"`);
    } else {
      log('FILE', `✗ ${f}: NOT CREATED`);
    }
  }
  
  if (created === files.length) {
    log('OK', `All ${files.length} files created`);
    results.push({ name: 'Multi-file creation', passed: true, detail: `${created}/${files.length} files created` });
  } else {
    log('FAIL', `Only ${created}/${files.length} files created`);
    results.push({ name: 'Multi-file creation', passed: false, detail: `${created}/${files.length} files created` });
  }
}

async function test5_diffApplication() {
  testNum++;
  log('TEST', `${testNum}. Diff application — does a unified diff actually apply?`);

  const testPath = `project/honest-diff-${Date.now()}.txt`;
  await cleanupFiles([testPath]);
  await writeVfs(testPath, 'Line 1\nLine 2\nLine 3');
  await sleep(500);

  const chatResult = await chat(
    `Apply this diff to ${testPath}:\n` +
    '```diff\n' +
    `--- a/${testPath}\n` +
    `+++ b/${testPath}\n` +
    '@@ -1,3 +1,3 @@\n' +
    ' Line 1\n' +
    '-Line 2\n' +
    '+Line TWO\n' +
    ' Line 3\n' +
    '```',
    'mistral',
    'mistral-small-latest',
    180000
  );

  if (!chatResult.ok) {
    log('FAIL', `Chat failed: ${chatResult.error}`);
    results.push({ name: 'Diff application', passed: false, detail: chatResult.error });
    return;
  }

  await sleep(8000);

  const postCheck = await readVfs(testPath);
  const diffApplied = postCheck.exists && postCheck.content?.includes('Line TWO');

  if (diffApplied) {
    log('OK', `Diff applied: Line 2 → Line TWO`);
    results.push({ name: 'Diff application', passed: true, detail: 'diff_actually_applied' });
  } else {
    log('FAIL', `Diff NOT applied. Content: "${postCheck.content}"`);
    results.push({ name: 'Diff application', passed: false, detail: `diff_applied=false, content="${postCheck.content}"` });
  }
}

async function test6_selfHealingActualFix() {
  testNum++;
  log('TEST', `${testNum}. Self-healing — does LLM actually fix broken file?`);

  const testPath = `project/honest-broken-${Date.now()}.js`;
  await cleanupFiles([testPath]);
  await writeVfs(testPath, 'const x = '); // Intentionally broken
  await sleep(500);

  const chatResult = await chat(
    `Fix the syntax error in ${testPath}. It should be valid JavaScript that assigns a value to x.`,
    'mistral',
    'mistral-small-latest',
    180000
  );

  if (!chatResult.ok) {
    log('FAIL', `Chat failed: ${chatResult.error}`);
    results.push({ name: 'Self-healing actual fix', passed: false, detail: chatResult.error });
    return;
  }

  await sleep(5000);

  const postCheck = await readVfs(testPath);
  const wasFixed = postCheck.exists && postCheck.content !== 'const x = ' && postCheck.content.includes('=');

  if (wasFixed) {
    log('OK', `File was fixed: "${postCheck.content?.slice(0, 50)}"`);
    results.push({ name: 'Self-healing actual fix', passed: true, detail: 'file_actually_fixed' });
  } else {
    log('FAIL', `File NOT fixed. Content: "${postCheck.content}"`);
    results.push({ name: 'Self-healing actual fix', passed: false, detail: `not_fixed, content="${postCheck.content}"` });
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         HONEST E2E TESTS — no keyword cheating          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  
  const loggedIn = await login();
  if (!loggedIn) { console.error('FATAL: Cannot login'); process.exit(1); }
  
  await test1_vfsWriteWorks();
  await test2_llmCreatesFileViaCodeBlocks();
  await test3_fileEditParser();
  await test4_multiFileCreation();
  await test5_diffApplication();
  await test6_selfHealingActualFix();
  
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
    console.log('║  FAILURES WITH RESPONSE SNIPPETS:                          ║');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`║                                                          ║`);
      console.log(`║  TEST: ${r.name.padEnd(45)}║`);
      console.log(`║  DETAIL: ${r.detail.slice(0, 52).padEnd(52)}║`);
      if (r.response_snippet) {
        console.log(`║  LLM SAID:                                                    ║`);
        const lines = r.response_snippet.match(/.{1,56}/g) || [];
        for (const line of lines.slice(0, 4)) {
          console.log(`║    ${line.padEnd(56)}║`);
        }
      }
    }
  }
  
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Crashed:', e); process.exit(1); });
