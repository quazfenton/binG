/**
 * Comprehensive E2E Workflow Test Suite
 * 
 * Tests full LLM agency with tool calls, file edits, VFS MCP tools,
 * terminal usage, and nuanced edge cases.
 * 
 * Usage: node scripts/e2e-comprehensive-workflow.mjs
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { dirname } from 'path';

const BASE_URL = 'http://localhost:3000';
const LOG_DIR = './e2e-test-logs';
const LOG_FILE = `${LOG_DIR}/e2e-workflow-${Date.now()}.log`;

// Create log directory
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

// Auth credentials
const AUTH_EMAIL = 'test@test.com';
const AUTH_PASSWORD = 'Testing0';

let authToken = '';
let anonSessionId = '';

// ─── Auth ───────────────────────────────────────────────────────────────────────

async function authenticate() {
  logSection('AUTHENTICATION');
  
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
    redirect: 'manual',
  });

  if (!res.ok && res.status !== 302) {
    const body = await res.text();
    throw new Error(`Auth failed: ${res.status} ${body}`);
  }

  // Get session cookie
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/session_id=([^;]+)/);
    if (match) {
      authToken = match[1];
      log('INFO', 'AUTH', 'Got session_id', { sessionId: authToken.substring(0, 20) + '...' });
    }
  }

  // Also try the auth endpoint that returns JSON
  const jsonRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });

  if (jsonRes.ok) {
    const data = await jsonRes.json();
    if (data.token) authToken = data.token;
    log('INFO', 'AUTH', 'Login response', { hasToken: !!authToken, userId: data.userId || 'none' });
  }

  if (!authToken) {
    log('WARN', 'AUTH', 'No auth token found, will use anonymous mode');
  } else {
    log('INFO', 'AUTH', 'Authenticated successfully');
  }
}

// ─── Chat API Helper ─────────────────────────────────────────────────────────────

async function sendChatMessage(message, options = {}) {
  const {
    stream = false,
    provider = 'mistral',
    model = 'mistral-large-latest',
    mode = 'enhanced',
    extraHeaders = {},
    files = [],
  } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (authToken) {
    headers['Cookie'] = `session_id=${authToken}`;
  }

  const body = {
    messages: [{ role: 'user', content: message }],
    provider,
    model,
    mode,
    stream,
    files,
  };

  log('INFO', 'CHAT:SEND', `Sending: "${message.substring(0, 80)}..."`, {
    provider, model, mode, stream,
  });

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat API returned ${res.status}: ${errText.substring(0, 500)}`);
  }

  if (stream) {
    // Read SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
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
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              events.push(data);
              chunks++;

              if (data.content) fullContent += data.content;
              if (data.toolCalls) toolCalls.push(...data.toolCalls);
              if (data.fileEdits) fileEdits.push(...data.fileEdits);
              if (data.isComplete) done = true;
              if (data.finishReason) done = true;
            } catch (e) {
              // Ignore parse errors for partial JSON
            }
          }
        }
      }
    }

    return {
      success: true,
      content: fullContent,
      toolCalls,
      fileEdits,
      events,
      chunks,
      status: res.status,
    };
  } else {
    const data = await res.json();
    return {
      success: data.success !== false,
      content: data.data?.content || data.response || data.content || '',
      toolCalls: data.data?.toolCalls || data.toolCalls || [],
      fileEdits: data.data?.fileEdits || data.filesystem || [],
      status: res.status,
      raw: data,
    };
  }
}

// ─── Filesystem API Helpers ──────────────────────────────────────────────────────

async function listDirectory(path = 'project') {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Cookie'] = `session_id=${authToken}`;

  const res = await fetch(`${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(path)}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`List dir failed: ${res.status} ${err.substring(0, 200)}`);
  }

  return res.json();
}

async function readFile(path) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Cookie'] = `session_id=${authToken}`;

  const res = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Read file failed: ${res.status} ${err.substring(0, 200)}`);
  }

  return res.json();
}

async function snapshot(path = 'project') {
  const headers = {};
  if (authToken) headers['Cookie'] = `session_id=${authToken}`;

  const res = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=${encodeURIComponent(path)}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) return { success: false, files: [] };
  return res.json();
}

// ─── Test: Basic Code Generation with File Creation ──────────────────────────────

async function testCodeGenerationWithFileCreation() {
  logSection('TEST 1: Code Generation with File Creation');

  const result = await sendChatMessage(
    'Create a simple Express.js REST API app. Make a file called server.js in project/ that has a basic express server with a GET /health endpoint returning { status: "ok" }. Use write_file tool to create it.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST1', 'Response received', {
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  // Check if files were actually created
  await new Promise(r => setTimeout(r, 3000));

  try {
    const snap = await snapshot('project');
    const files = snap.data?.files || snap.files || [];
    log('INFO', 'TEST1', 'Snapshot after generation', {
      fileCount: files.length,
      files: files.map(f => f.path),
    });

    // Look for server.js
    const serverJs = files.find(f => f.path && f.path.includes('server.js'));
    if (serverJs) {
      log('PASS', 'TEST1', 'server.js was created via VFS');
      return { passed: true, serverJs };
    } else {
      log('FAIL', 'TEST1', 'server.js NOT found in VFS snapshot');
      log('INFO', 'TEST1', 'Available files', files.map(f => f.path));
      return { passed: false, files };
    }
  } catch (e) {
    log('WARN', 'TEST1', 'Snapshot check failed', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Diff Edit to Existing File ────────────────────────────────────────────

async function testDiffEditToExistingFile() {
  logSection('TEST 2: Diff Edit to Existing File');

  // First ensure we have a file to edit
  await sendChatMessage(
    'Create a file called project/test.txt with the content: "Hello World\nThis is a test file."',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  await new Promise(r => setTimeout(r, 2000));

  // Now ask for an edit
  const result = await sendChatMessage(
    'Edit project/test.txt to add a new line at the end saying "This line was added by the LLM." Use apply_diff tool.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST2', 'Edit response', {
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  // Check if the file was edited
  try {
    const readResult = await readFile('project/test.txt');
    const content = readResult.data?.content || readResult.content || '';
    const hasNewLine = content.includes('This line was added by the LLM');

    if (hasNewLine) {
      log('PASS', 'TEST2', 'File was edited correctly');
      return { passed: true, content };
    } else {
      log('FAIL', 'TEST2', 'File content does not contain expected edit');
      log('INFO', 'TEST2', 'Actual content', content.substring(0, 500));
      return { passed: false, content };
    }
  } catch (e) {
    log('WARN', 'TEST2', 'Could not read edited file', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Multi-File Workspace with Context Bundling ─────────────────────────────

async function testMultiFileWorkspace() {
  logSection('TEST 3: Multi-File Workspace Context Bundling');

  // Create a small multi-file project
  await sendChatMessage(
    'Create a project with these files:\n1. project/utils.js - export function add(a,b){return a+b;}\n2. project/main.js - import {add} from "./utils"; console.log(add(1,2));',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  await new Promise(r => setTimeout(r, 3000));

  // Now ask it to use context from both files
  const result = await sendChatMessage(
    'In the workspace, modify project/main.js to also use a subtract function. First check what functions exist in utils.js, then add subtract to utils.js and import it in main.js.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST3', 'Multi-file edit response', {
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  // Check both files
  try {
    const snap = await snapshot('project');
    const files = snap.data?.files || snap.files || [];
    const utilsFile = files.find(f => f.path && f.path.includes('utils.js'));
    const mainFile = files.find(f => f.path && f.path.includes('main.js'));

    const utilsHasSubtract = utilsFile?.content?.includes('subtract') || 
                             (utilsFile && await readFile('project/utils.js').then(r => (r.data?.content || r.content || '').includes('subtract')).catch(() => false));

    const mainHasSubtractImport = mainFile?.content?.includes('subtract') ||
                                  (mainFile && await readFile('project/main.js').then(r => (r.data?.content || r.content || '').includes('subtract')).catch(() => false));

    if (utilsHasSubtract && mainHasSubtractImport) {
      log('PASS', 'TEST3', 'Both files were correctly modified with subtract function');
      return { passed: true };
    } else {
      log('FAIL', 'TEST3', 'Files were not correctly modified', { utilsHasSubtract, mainHasSubtractImport });
      return { passed: false, utilsHasSubtract, mainHasSubtractImport };
    }
  } catch (e) {
    log('WARN', 'TEST3', 'File check failed', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Terminal PTY from Natural Language ─────────────────────────────────────

async function testTerminalPTYFromNaturalLanguage() {
  logSection('TEST 4: Terminal PTY from Natural Language');

  // Test that the LLM suggests terminal commands when asked to run code
  const result = await sendChatMessage(
    'I have a project/server.js file. Show me how to run it in the terminal.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  log('INFO', 'TEST4', 'Terminal suggestion response', {
    contentLength: result.content?.length || 0,
    mentionsRun: result.content?.toLowerCase().includes('node') || 
                 result.content?.toLowerCase().includes('run') ||
                 result.content?.toLowerCase().includes('terminal') || false,
    contentPreview: (result.content || '').substring(0, 300),
  });

  if (result.content?.toLowerCase().includes('node') || result.content?.toLowerCase().includes('run')) {
    log('PASS', 'TEST4', 'LLM correctly suggested running the file');
    return { passed: true };
  } else {
    log('FAIL', 'TEST4', 'LLM did not suggest running the file');
    return { passed: false };
  }
}

// ─── Test: Auto-Continue Detection ────────────────────────────────────────────────

async function testAutoContinue() {
  logSection('TEST 5: Auto-Continue Detection');

  // Ask for a large file that should trigger auto-continue
  const result = await sendChatMessage(
    'Create a project/index.html file with a complete responsive landing page using HTML and inline CSS. Make it a full professional page with header, hero section, features section, about section, and footer. Include proper semantic HTML5 markup and modern styling.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  log('INFO', 'TEST5', 'Auto-continue test response', {
    contentLength: result.content?.length || 0,
    hasFinishReason: !!result.raw?.data?.finishReason,
    finishReason: result.raw?.data?.finishReason || 'none',
    hasToolCalls: (result.toolCalls?.length || 0) > 0,
    hasFileEdits: (result.fileEdits?.length || 0) > 0,
  });

  // Check if the HTML file was created
  await new Promise(r => setTimeout(r, 2000));

  try {
    const content = await readFile('project/index.html').then(r => r.data?.content || r.content || '');
    const hasFullPage = content.includes('</html>') && content.includes('<!DOCTYPE');

    if (hasFullPage) {
      log('PASS', 'TEST5', 'Full HTML page was created with proper structure');
      return { passed: true, contentLength: content.length };
    } else {
      log('FAIL', 'TEST5', 'HTML page is incomplete or missing');
      return { passed: false, contentLength: content.length };
    }
  } catch (e) {
    log('WARN', 'TEST5', 'Could not read index.html', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: File Selection Without Explicit Path ──────────────────────────────────

async function testFileSelectionWithoutPath() {
  logSection('TEST 6: File Selection Without Explicit Path');

  // Create a specific file
  await sendChatMessage(
    'Create project/config.json with content: {"theme": "dark", "language": "en"}',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  await new Promise(r => setTimeout(r, 2000));

  // Now ask to edit it without giving the full path
  const result = await sendChatMessage(
    'Change the theme in config.json to "light". Read the file first, then apply the change.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST6', 'File selection response', {
    contentLength: result.content?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  try {
    const content = await readFile('project/config.json').then(r => r.data?.content || r.content || '');
    const hasLightTheme = content.includes('"light"');

    if (hasLightTheme) {
      log('PASS', 'TEST6', 'Config.json was correctly edited to light theme');
      return { passed: true, content };
    } else {
      log('FAIL', 'TEST6', 'Config.json still has dark theme', { content: content.substring(0, 200) });
      return { passed: false, content };
    }
  } catch (e) {
    log('WARN', 'TEST6', 'Could not read config.json', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Streaming with Tool Calls ─────────────────────────────────────────────

async function testStreamingWithToolCalls() {
  logSection('TEST 7: Streaming with Tool Calls');

  const result = await sendChatMessage(
    'Create a project/hello.py file that prints "Hello from Python!" when run.',
    { stream: true, provider: 'mistral', model: 'mistral-large-latest' }
  );

  log('INFO', 'TEST7', 'Streaming result', {
    success: result.success,
    chunks: result.chunks,
    contentLength: result.content?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    eventsCount: result.events?.length || 0,
    hasToolInvocationEvents: result.events?.some(e => e.type === 'tool_invocation') || false,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 2000));

  try {
    const content = await readFile('project/hello.py').then(r => r.data?.content || r.content || '');
    const hasPrintStatement = content.includes('print') && content.includes('Hello from Python');

    if (hasPrintStatement) {
      log('PASS', 'TEST7', 'hello.py was created via streaming with correct content');
      return { passed: true, content, chunks: result.chunks };
    } else {
      log('FAIL', 'TEST7', 'hello.py content is incorrect', { content });
      return { passed: false, content };
    }
  } catch (e) {
    log('WARN', 'TEST7', 'Could not read hello.py', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Self-Healing / Retry ──────────────────────────────────────────────────

async function testSelfHealing() {
  logSection('TEST 8: Self-Healing / Error Recovery');

  // Ask for something complex that might fail on first attempt
  const result = await sendChatMessage(
    'Create a project/calculator.js with a full calculator class supporting add, subtract, multiply, divide, power, and modulo operations. Include input validation and error handling for each method.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST8', 'Self-healing test response', {
    success: result.success,
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  try {
    const content = await readFile('project/calculator.js').then(r => r.data?.content || r.content || '');
    const hasClass = content.includes('class') || content.includes('function');
    const hasOperations = ['add', 'subtract', 'multiply', 'divide'].every(op => content.includes(op));
    const hasErrorHandling = content.includes('throw') || content.includes('Error') || content.includes('try');

    if (hasClass && hasOperations && hasErrorHandling) {
      log('PASS', 'TEST8', 'Calculator class was created with all operations and error handling');
      return { passed: true };
    } else {
      log('FAIL', 'TEST8', 'Calculator is incomplete', { hasClass, hasOperations, hasErrorHandling });
      return { passed: false, hasClass, hasOperations, hasErrorHandling };
    }
  } catch (e) {
    log('WARN', 'TEST8', 'Could not read calculator.js', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Context Pack / Smart Context ──────────────────────────────────────────

async function testContextPack() {
  logSection('TEST 9: Context Pack / Smart Context Bundling');

  // Create a multi-file project
  await sendChatMessage(
    'Create a project with: 1) project/package.json with name "test-app", 2) project/src/index.js with console.log("app started"), 3) project/src/utils.js with export function helper(){return true;}',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest' }
  );

  await new Promise(r => setTimeout(r, 4000));

  // Ask to modify something that requires understanding the project structure
  const result = await sendChatMessage(
    'Add a new utility function to the project. Create project/src/logger.js that logs messages with timestamps. Then update project/src/index.js to import and use the logger.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST9', 'Context pack test response', {
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 3000));

  try {
    const snap = await snapshot('project');
    const files = snap.data?.files || snap.files || [];

    const hasLogger = files.some(f => f.path && f.path.includes('logger.js'));
    const indexImportsLogger = files.some(f => f.path && f.path.includes('index.js') && f.content && f.content.includes('logger'));

    if (hasLogger && indexImportsLogger) {
      log('PASS', 'TEST9', 'Logger created and index.js updated with import');
      return { passed: true, files: files.map(f => f.path) };
    } else {
      log('FAIL', 'TEST9', 'Context pack test failed', { hasLogger, indexImportsLogger });
      return { passed: false, hasLogger, indexImportsLogger, files: files.map(f => f.path) };
    }
  } catch (e) {
    log('WARN', 'TEST9', 'Context pack check failed', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Test: Non-Streaming Mode ────────────────────────────────────────────────────

async function testNonStreamingMode() {
  logSection('TEST 10: Non-Streaming Mode with Tool Usage');

  const result = await sendChatMessage(
    'Create a project/styles.css file with a complete CSS reset and some basic utility classes for flexbox, grid, and spacing.',
    { stream: false, provider: 'mistral', model: 'mistral-large-latest', mode: 'enhanced' }
  );

  log('INFO', 'TEST10', 'Non-streaming result', {
    success: result.success,
    contentLength: result.content?.length || 0,
    fileEditsCount: result.fileEdits?.length || 0,
    rawKeys: Object.keys(result.raw || {}),
    contentPreview: (result.content || '').substring(0, 300),
  });

  await new Promise(r => setTimeout(r, 2000));

  try {
    const content = await readFile('project/styles.css').then(r => r.data?.content || r.content || '');
    const hasReset = content.includes('*') && content.includes('margin') && content.includes('padding');
    const hasFlexbox = content.includes('flex') || content.includes('display');
    const hasGrid = content.includes('grid');

    if (hasReset && hasFlexbox) {
      log('PASS', 'TEST10', 'styles.css created with reset and utilities');
      return { passed: true, contentLength: content.length };
    } else {
      log('FAIL', 'TEST10', 'styles.css is incomplete', { hasReset, hasFlexbox, hasGrid });
      return { passed: false, hasReset, hasFlexbox, hasGrid };
    }
  } catch (e) {
    log('WARN', 'TEST10', 'Could not read styles.css', { error: e.message });
    return { passed: false, error: e.message };
  }
}

// ─── Main Test Runner ─────────────────────────────────────────────────────────────

async function runAllTests() {
  const results = [];

  try {
    await authenticate();

    const tests = [
      testCodeGenerationWithFileCreation,
      testDiffEditToExistingFile,
      testMultiFileWorkspace,
      testTerminalPTYFromNaturalLanguage,
      testAutoContinue,
      testFileSelectionWithoutPath,
      testStreamingWithToolCalls,
      testSelfHealing,
      testContextPack,
      testNonStreamingMode,
    ];

    for (const testFn of tests) {
      try {
        const result = await testFn();
        results.push({ test: testFn.name, ...result });
      } catch (e) {
        log('ERROR', 'RUNNER', `Test ${testFn.name} crashed`, { error: e.message, stack: e.stack });
        results.push({ test: testFn.name, passed: false, error: e.message });
      }

      // Small delay between tests to let VFS settle
      await new Promise(r => setTimeout(r, 2000));
    }

    // Summary
    logSection('TEST SUMMARY');
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

    // Exit with failure code if any test failed
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    log('ERROR', 'RUNNER', 'Test suite crashed', { error: e.message, stack: e.stack });
    process.exit(1);
  }
}

runAllTests();
