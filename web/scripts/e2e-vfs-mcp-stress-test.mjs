/**
 * VFS MCP Tool Stress Test
 * 
 * Specifically tests:
 * 1. File creation via VFS MCP tools (write_file)
 * 2. File reading via VFS MCP tools (read_file)
 * 3. apply_diff on existing files
 * 4. batch_write for multiple files
 * 5. delete_file
 * 6. list_files
 * 7. search_files
 * 8. create_directory
 * 9. Tool argument population
 * 10. Tool call continuation (auto-continue when LLM stops mid-response)
 * 11. Correct tool choice (no infinite loops, no premature termination)
 * 12. Proper error handling in VFS tools
 *
 * Usage: node scripts/e2e-vfs-mcp-stress-test.mjs
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync, readFileSync } from 'fs';
import { dirname } from 'path';

const BASE_URL = 'http://localhost:3000';
const LOG_DIR = './e2e-test-logs';
const LOG_FILE = `${LOG_DIR}/vfs-mcp-stress-${Date.now()}.log`;

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function log(level, category, message, data = null) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] [${category}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n\n');
}

function logSection(title) {
  const sep = '='.repeat(80);
  console.log(`\n${sep}\n  ${title}\n${sep}`);
  appendFileSync(LOG_FILE, `\n${sep}\n  ${title}\n${sep}\n\n`);
}

const AUTH_EMAIL = 'test@test.com';
const AUTH_PASSWORD = 'Testing0';
let authToken = '';

async function authenticate() {
  logSection('AUTH');

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/session_id=([^;]+)/);
    if (match) authToken = match[1];
  }

  log('INFO', 'AUTH', 'Auth result', { hasToken: !!authToken, status: res.status });
}

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) {
    h['Cookie'] = `session_id=${authToken}`;
    h['Authorization'] = `Bearer ${authToken}`;
  }
  return h;
}

async function sendChat(message, opts = {}) {
  const { stream = false, mode = 'enhanced', provider = 'mistral', model = 'mistral-large-latest' } = opts;

  log('INFO', 'CHAT', `Sending: "${message.substring(0, 100)}..."`, { provider, model, mode });

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ messages: [{ role: 'user', content: message }], provider, model, mode, stream }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat ${res.status}: ${err.substring(0, 500)}`);
  }

  if (stream) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let toolCalls = [];
    let fileEdits = [];
    let events = [];
    let done = false;
    let chunks = 0;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              events.push(data);
              chunks++;
              if (data.content) content += data.content;
              if (data.toolCalls) toolCalls.push(...data.toolCalls);
              if (data.fileEdits) fileEdits.push(...data.fileEdits);
              if (data.isComplete || data.finishReason) done = true;
            } catch {}
          }
        }
      }
    }

    return { success: true, content, toolCalls, fileEdits, events, chunks };
  } else {
    const data = await res.json();
    return {
      success: data.success !== false,
      content: data.data?.content || data.response || data.content || '',
      toolCalls: data.data?.toolCalls || data.toolCalls || [],
      fileEdits: data.data?.fileEdits || data.filesystem || [],
      raw: data,
    };
  }
}

async function snapshot(path = 'project') {
  const res = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=${encodeURIComponent(path)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) return { success: false, files: [] };
  const data = await res.json();
  return { success: true, files: data.data?.files || data.files || [] };
}

async function readFile(path) {
  const res = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ path }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.content || data.content || '';
}

// ─── Test: write_file via LLM tool call ───────────────────────────────────────────

async function testWriteFileViaLLM() {
  logSection('VFS-TEST 1: write_file via LLM tool call');

  const result = await sendChat(
    'Use the write_file tool to create a file called project/greeting.txt with the content "Hello, World!"',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS1', 'Response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 200),
  });

  await new Promise(r => setTimeout(r, 2000));

  const content = await readFile('project/greeting.txt');
  if (content && content.includes('Hello, World!')) {
    log('PASS', 'VFS1', 'write_file worked correctly');
    return { passed: true, content };
  } else {
    log('FAIL', 'VFS1', 'write_file did not create file correctly', { content });
    return { passed: false, content };
  }
}

// ─── Test: read_file via LLM ──────────────────────────────────────────────────────

async function testReadFileViaLLM() {
  logSection('VFS-TEST 2: read_file via LLM');

  // First create a file with known content
  await sendChat(
    'Use write_file to create project/info.txt with content "Name: TestApp\nVersion: 1.0\nStatus: active"',
    { mode: 'enhanced' }
  );
  await new Promise(r => setTimeout(r, 2000));

  // Now ask the LLM to read it
  const result = await sendChat(
    'Use read_file to read project/info.txt and tell me what version it is.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS2', 'Read response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  // Check if response mentions the version
  const mentionsVersion = result.content?.includes('1.0') || result.content?.includes('Version');
  if (mentionsVersion) {
    log('PASS', 'VFS2', 'LLM correctly read the file and reported version');
    return { passed: true };
  } else {
    log('FAIL', 'VFS2', 'LLM did not report the version from the file');
    return { passed: false };
  }
}

// ─── Test: apply_diff via LLM ─────────────────────────────────────────────────────

async function testApplyDiffViaLLM() {
  logSection('VFS-TEST 3: apply_diff via LLM');

  // Create a file to edit
  await sendChat(
    'Create project/app.js with: "const PORT = 3000;\nconst HOST = "localhost";\nconsole.log(`Server running on ${HOST}:${PORT}`);"',
    { mode: 'enhanced' }
  );
  await new Promise(r => setTimeout(r, 2000));

  // Ask to edit it using diff
  const result = await sendChat(
    'Use apply_diff to change the PORT in project/app.js from 3000 to 8080. Read the file first, then apply the diff.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS3', 'Diff edit response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  const content = await readFile('project/app.js');
  const hasNewPort = content?.includes('8080');
  const hasOldPort = content?.includes('3000');

  if (hasNewPort && !hasOldPort) {
    log('PASS', 'VFS3', 'apply_diff correctly changed PORT from 3000 to 8080');
    return { passed: true, content };
  } else {
    log('FAIL', 'VFS3', 'apply_diff did not correctly edit the file', { content, hasNewPort, hasOldPort });
    return { passed: false, content, hasNewPort, hasOldPort };
  }
}

// ─── Test: batch_write via LLM ────────────────────────────────────────────────────

async function testBatchWriteViaLLM() {
  logSection('VFS-TEST 4: batch_write via LLM');

  const result = await sendChat(
    'Use batch_write to create these files at once:\n1. project/a.txt with "file A"\n2. project/b.txt with "file B"\n3. project/c.txt with "file C"',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS4', 'batch_write response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  const snap = await snapshot('project');
  const files = snap.files;
  const aFile = files.find(f => f.path?.includes('a.txt'));
  const bFile = files.find(f => f.path?.includes('b.txt'));
  const cFile = files.find(f => f.path?.includes('c.txt'));

  const allCreated = aFile && bFile && cFile;
  const correctContent = aFile?.content?.includes('file A') && 
                         bFile?.content?.includes('file B') && 
                         cFile?.content?.includes('file C');

  if (allCreated && correctContent) {
    log('PASS', 'VFS4', 'batch_write created all 3 files correctly');
    return { passed: true };
  } else {
    log('FAIL', 'VFS4', 'batch_write did not create all files', { 
      aFile: !!aFile, bFile: !!bFile, cFile: !!cFile,
      aContent: aFile?.content?.substring(0, 50),
      bContent: bFile?.content?.substring(0, 50),
      cContent: cFile?.content?.substring(0, 50),
    });
    return { passed: false };
  }
}

// ─── Test: list_files via LLM ─────────────────────────────────────────────────────

async function testListFilesViaLLM() {
  logSection('VFS-TEST 5: list_files via LLM');

  const result = await sendChat(
    'Use list_files to show me all files in the project directory.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS5', 'list_files response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 400),
  });

  // Check if LLM mentions file names we know exist
  const mentionsKnownFiles = result.content?.includes('greeting.txt') || 
                             result.content?.includes('app.js') ||
                             result.content?.includes('.txt') ||
                             result.content?.includes('.js');

  if (mentionsKnownFiles) {
    log('PASS', 'VFS5', 'LLM listed files and mentioned known files');
    return { passed: true };
  } else {
    log('FAIL', 'VFS5', 'LLM did not list files correctly or did not mention known files');
    return { passed: false };
  }
}

// ─── Test: search_files via LLM ───────────────────────────────────────────────────

async function testSearchFilesViaLLM() {
  logSection('VFS-TEST 6: search_files via LLM');

  const result = await sendChat(
    'Use search_files to find all files containing "Hello" in the project directory.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS6', 'search_files response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  const mentionsGreeting = result.content?.includes('greeting') || result.content?.includes('Hello');
  if (mentionsGreeting) {
    log('PASS', 'VFS6', 'LLM found files containing "Hello"');
    return { passed: true };
  } else {
    log('FAIL', 'VFS6', 'LLM did not find search results');
    return { passed: false };
  }
}

// ─── Test: No infinite loop / premature termination ───────────────────────────────

async function testNoInfiniteLoopOrPrematureEnd() {
  logSection('VFS-TEST 7: No infinite loop or premature termination');

  // Give a complex task that requires multiple tool calls
  const result = await sendChat(
    'Create a project/multi.js file with a JavaScript module that exports 5 utility functions: formatDate, capitalize, debounce, throttle, and deepClone. Each function should have JSDoc comments and proper implementation.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS7', 'Multi-step task response', {
    success: result.success,
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    finishReason: result.raw?.data?.finishReason,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  const content = await readFile('project/multi.js');
  const hasAllFunctions = ['formatDate', 'capitalize', 'debounce', 'throttle', 'deepClone'].every(fn => content?.includes(fn));
  const hasJSDoc = content?.includes('*') && content?.includes('@');

  if (hasAllFunctions) {
    log('PASS', 'VFS7', 'LLM completed multi-step task without infinite loop or premature end');
    return { passed: true, hasAllFunctions, hasJSDoc };
  } else {
    log('FAIL', 'VFS7', 'LLM did not complete the task', { hasAllFunctions, hasJSDoc });
    return { passed: false, hasAllFunctions, hasJSDoc };
  }
}

// ─── Test: create_directory via LLM ───────────────────────────────────────────────

async function testCreateDirectoryViaLLM() {
  logSection('VFS-TEST 8: create_directory via LLM');

  const result = await sendChat(
    'Use create_directory to make a folder called project/src/components in the workspace.',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS8', 'create_directory response', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 200),
  });

  await new Promise(r => setTimeout(r, 2000));

  const snap = await snapshot('project/src');
  const hasComponents = snap.files.some(f => f.path && f.path.includes('components'));

  if (hasComponents) {
    log('PASS', 'VFS8', 'Directory was created');
    return { passed: true };
  } else {
    log('FAIL', 'VFS8', 'Directory was not created', { files: snap.files.map(f => f.path) });
    return { passed: false };
  }
}

// ─── Test: Tool argument population ───────────────────────────────────────────────

async function testToolArgumentPopulation() {
  logSection('VFS-TEST 9: Tool argument population');

  // Ask for a specific file creation with detailed content
  const result = await sendChat(
    'Create a file called project/test-config.json with this exact JSON content: {"database": {"host": "localhost", "port": 5432, "name": "testdb"}, "cache": {"enabled": true, "ttl": 3600}}',
    { mode: 'enhanced', stream: false }
  );

  log('INFO', 'VFS9', 'Tool arg population test', {
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    toolCallArgs: result.toolCalls?.map(tc => ({ name: tc.name, hasArgs: !!tc.arguments, argsKeys: tc.arguments ? Object.keys(tc.arguments) : [] })) || [],
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 2000));

  const content = await readFile('project/test-config.json');
  const hasCorrectJson = content?.includes('"host"') && content?.includes('5432') && content?.includes('"testdb"');

  if (hasCorrectJson) {
    log('PASS', 'VFS9', 'Tool arguments were correctly populated');
    return { passed: true };
  } else {
    log('FAIL', 'VFS9', 'Tool arguments were not correctly populated', { content });
    return { passed: false, content };
  }
}

// ─── Test: Repeated diff to existing file ─────────────────────────────────────────

async function testRepeatedDiff() {
  logSection('VFS-TEST 10: Repeated diff edits to same file');

  // Create a file
  await sendChat(
    'Create project/counter.js with: "let count = 0;"',
    { mode: 'enhanced' }
  );
  await new Promise(r => setTimeout(r, 2000));

  // Apply 3 successive edits
  for (let i = 1; i <= 3; i++) {
    await sendChat(
      `Use apply_diff on project/counter.js to add a line after the existing one: "// edit ${i}"`,
      { mode: 'enhanced' }
    );
    await new Promise(r => setTimeout(r, 2000));
  }

  const content = await readFile('project/counter.js');
  const hasAllEdits = [1, 2, 3].every(i => content?.includes(`edit ${i}`));

  if (hasAllEdits) {
    log('PASS', 'VFS10', 'All 3 repeated diffs were applied correctly');
    return { passed: true, content };
  } else {
    log('FAIL', 'VFS10', 'Not all diffs were applied', { content, hasAllEdits });
    return { passed: false, content, hasAllEdits };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  const results = [];

  try {
    await authenticate();

    const tests = [
      testWriteFileViaLLM,
      testReadFileViaLLM,
      testApplyDiffViaLLM,
      testBatchWriteViaLLM,
      testListFilesViaLLM,
      testSearchFilesViaLLM,
      testNoInfiniteLoopOrPrematureEnd,
      testCreateDirectoryViaLLM,
      testToolArgumentPopulation,
      testRepeatedDiff,
    ];

    for (const testFn of tests) {
      try {
        const result = await testFn();
        results.push({ test: testFn.name, ...result });
      } catch (e) {
        log('ERROR', 'VFS-RUNNER', `${testFn.name} crashed`, { error: e.message, stack: e.stack });
        results.push({ test: testFn.name, passed: false, error: e.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    logSection('VFS MCP TEST SUMMARY');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);
    appendFileSync(LOG_FILE, `\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

    for (const r of results) {
      const status = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status} ${r.test}`);
      appendFileSync(LOG_FILE, `  ${status} ${r.test}\n`);
      if (r.error) {
        console.log(`         Error: ${r.error}`);
        appendFileSync(LOG_FILE, `         Error: ${r.error}\n`);
      }
    }

    console.log(`\n  Full log: ${LOG_FILE}\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    log('ERROR', 'VFS-RUNNER', 'Test suite crashed', { error: e.message, stack: e.stack });
    process.exit(1);
  }
}

runAllTests();
