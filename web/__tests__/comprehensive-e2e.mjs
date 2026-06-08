/**
 * Comprehensive E2E Test Harness
 *
 * Tests REAL LLM interactions against the running dev server with:
 * - Auth flow (login with test@test.com / Testing0)
 * - Chat API with real prompts that trigger tool calls
 * - VFS file operations (create, read, list)
 * - Agentic workflows (code generation, editing)
 * - Non-streaming and streaming paths
 * - Detailed logging of every step
 *
 * Usage: node __tests__/comprehensive-e2e.mjs
 */

const BASE = 'http://localhost:3000';
const CREDENTIALS = { email: 'test@test.com', password: 'Testing0' };
const PROVIDER = 'mistral';
const MODEL = 'mistral-small-latest';

// Track cookies across requests
let cookieJar = '';

// Colored logging
const LOG = {
  info: (msg, data) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`, data ? JSON.stringify(data, null, 2).slice(0, 500) : ''),
  ok: (msg) => console.log(`\x1b[32m  ✓\x1b[0m ${msg}`),
  fail: (msg) => console.log(`\x1b[31m  ✗\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m  ⚠\x1b[0m ${msg}`),
  section: (msg) => console.log(`\n\x1b[1;34m═══ ${msg} \x1b[0m`),
  detail: (msg, data) => console.log(`  \x1b[90m${msg}\x1b[0m`, data ? JSON.stringify(data).slice(0, 300) : ''),
};

async function api(method, path, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': cookieJar,
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  // Capture set-cookie headers
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    // Extract just the cookie name=value parts
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean);
    cookieJar = [...new Set([...cookieJar.split('; ').filter(Boolean), ...cookies])].join('; ');
    LOG.detail(`Updated cookies: ${cookies.join(', ')}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  return { status: res.status, headers: Object.fromEntries(res.headers), json, text: text.slice(0, 2000) };
}

async function login() {
  LOG.section('AUTH: Login');
  const { status, json } = await api('POST', '/api/auth/login', CREDENTIALS);
  if (status === 200 && json?.success) {
    LOG.ok(`Logged in as ${CREDENTIALS.email}`);
    return true;
  }
  LOG.fail(`Login failed: ${status} - ${JSON.stringify(json)}`);

  // If login fails, try register first
  LOG.warn('Login failed, trying register...');
  const regResult = await api('POST', '/api/auth/register', CREDENTIALS);
  if (regResult.status === 200 || regResult.status === 201) {
    LOG.ok('Registered successfully, retrying login...');
    const retry = await api('POST', '/api/auth/login', CREDENTIALS);
    if (retry.status === 200) {
      LOG.ok('Logged in after registration');
      return true;
    }
  }
  LOG.warn('Proceeding without auth (may have limited functionality)');
  return false;
}

/**
 * Parse SSE stream from chat response
 */
async function parseSSE(response, label) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let toolsCalled = [];
  let fileEdits = [];
  let doneEvent = null;
  let errors = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) {
            fullContent += data.content;
            LOG.detail(`${label} token: ${data.content.slice(0, 80)}${data.content.length > 80 ? '...' : ''}`);
          }
          if (data.event === 'token' || data.type === 'token') {
            fullContent += data.content || '';
          }
          if (data.type === 'tool_use' || data.toolName) {
            toolsCalled.push(data);
            LOG.detail(`${label} tool call: ${data.toolName || data.name || 'unknown'}`);
          }
          if (data.type === 'tool_invocation' || data.event === 'tool_invocation') {
            toolsCalled.push(data);
            LOG.detail(`${label} tool: ${data.toolName} args: ${JSON.stringify(data.args).slice(0, 200)}`);
          }
          if (data.status === 'detected' || data.status === 'applied') {
            fileEdits.push(data);
            LOG.detail(`${label} file edit: ${data.path} (${data.operation})`);
          }
          if (data.type === 'error' || data.event === 'error') {
            errors.push(data);
            LOG.fail(`${label} error: ${data.message}`);
          }
          if (data.type === 'done' || data.event === 'done') {
            doneEvent = data;
          }
        } catch (e) {
          // Non-JSON data line
        }
      }
    }
  }

  return { fullContent, toolsCalled, fileEdits, doneEvent, errors };
}

async function chatNonStreaming(messages, opts = {}) {
  const body = {
    messages,
    provider: opts.provider || PROVIDER,
    model: opts.model || MODEL,
    stream: false,
    temperature: 0.3,
    maxTokens: 4000,
    agentMode: opts.agentMode || 'auto',
    mode: opts.mode || 'max',
    filesystemContext: { applyFileEdits: true },
    ...opts.extra,
  };

  const { status, json, text } = await api('POST', '/api/chat', body);
  return { status, json, text };
}

async function chatStreaming(messages, opts = {}) {
  const body = {
    messages,
    provider: opts.provider || PROVIDER,
    model: opts.model || MODEL,
    stream: true,
    temperature: 0.3,
    maxTokens: 8000,
    agentMode: opts.agentMode || 'auto',
    mode: opts.mode || 'max',
    filesystemContext: { applyFileEdits: true },
    ...opts.extra,
  };

  const headers = { 'Content-Type': 'application/json', 'Cookie': cookieJar };
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: res.status, error: text };
  }

  return await parseSSE(res, opts.label || 'stream');
}

// ============================================================================
// Tests
// ============================================================================

let passed = 0;
let failed = 0;
let results = [];

function record(name, success, detail) {
  if (success) { passed++; LOG.ok(name); }
  else { failed++; LOG.fail(`${name}: ${detail}`); }
  results.push({ name, success, detail });
}

async function runAll() {
  LOG.section('=== COMPREHENSIVE E2E TEST SUITE ===');
  LOG.info(`Provider: ${PROVIDER}, Model: ${MODEL}`);

  // 1. Auth
  const authed = await login();
  record('login', authed, authed ? 'Authenticated' : 'Proceeding anonymously');

  // 2. Health check - simple chat
  LOG.section('TEST: Basic Chat (Non-streaming)');
  const healthResult = await chatNonStreaming([
    { role: 'user', content: 'Reply with exactly: chat_ok' }
  ]);
  const healthOk = healthResult.status === 200 && healthResult.json?.success !== false;
  record('basic chat non-streaming', healthOk,
    healthOk ? 'Chat API responds' : `Status ${healthResult.status}: ${healthResult.text.slice(0, 200)}`);

  // 3. Streaming chat
  LOG.section('TEST: Basic Chat (Streaming)');
  try {
    const streamResult = await chatStreaming(
      [{ role: 'user', content: 'Reply with exactly: streaming_ok' }],
      { label: 'stream' }
    );
    const streamOk = streamResult.fullContent && streamResult.fullContent.length > 0;
    record('basic chat streaming', streamOk,
      streamOk ? `Got ${streamResult.fullContent.length} chars of content` : 'No content received');
  } catch (e) {
    record('basic chat streaming', false, e.message);
  }

  // 4. FILE CREATION: Create a simple HTML file
  LOG.section('TEST: File Creation via Agentic Prompt');
  try {
    const fileCreateResult = await chatStreaming(
      [{ role: 'user', content: 'Create a file called test-hello.html with this content: <h1>Hello World</h1>' }],
      { label: 'create-file', extra: { filesystemContext: { applyFileEdits: true } } }
    );
    const hasFileEdits = fileCreateResult.fileEdits && fileCreateResult.fileEdits.length > 0;
    const hasTools = fileCreateResult.toolsCalled && fileCreateResult.toolsCalled.length > 0;
    record('file creation via streaming', hasFileEdits || hasTools,
      hasFileEdits ? `File edits detected: ${fileCreateResult.fileEdits.length}` :
      hasTools ? `Tools called: ${fileCreateResult.toolsCalled.length}` :
      'No file edits or tools detected');
    LOG.detail('Content preview', fileCreateResult.fullContent?.slice(0, 300));
  } catch (e) {
    record('file creation via streaming', false, e.message);
  }

  // 5. CODE GENERATION: Generate a simple app via non-streaming
  LOG.section('TEST: Code Generation (Non-streaming)');
  try {
    const codeResult = await chatNonStreaming(
      [{ role: 'user', content: 'Write a python script that prints "hello from test app". Only reply with the code in a code block.' }],
      { mode: 'normal' }
    );
    const hasCodeBlock = codeResult.json?.content?.includes('```') || false;
    record('code generation non-streaming', hasCodeBlock,
      hasCodeBlock ? 'Code block detected in response' : `No code block. Response: ${(codeResult.json?.content || '').slice(0, 200)}`);
    LOG.detail('Code response', codeResult.json?.content?.slice(0, 400));
  } catch (e) {
    record('code generation non-streaming', false, e.message);
  }

  // 6. MULTI-STEP: Test file read + edit workflow
  LOG.section('TEST: Multi-step File Edit Workflow');
  try {
    const editResult = await chatStreaming(
      [
        { role: 'user', content: 'Create a file called test-app.py with a python function that adds two numbers' },
        { role: 'user', content: 'Now add a function to multiply two numbers to the same file test-app.py. Read it first.' }
      ],
      { label: 'multi-step', extra: { conversationId: 'e2e-test-multi' } }
    );
    const hasTools2 = editResult.toolsCalled && editResult.toolsCalled.length > 0;
    record('multi-step tool calls', hasTools2,
      hasTools2 ? `${editResult.toolsCalled.length} tool calls made` : 'No tool calls detected');
    if (hasTools2) {
      const toolNames = editResult.toolsCalled.map(t => t.toolName || t.name || 'unknown').join(', ');
      LOG.detail('Tools called', toolNames);
    }
  } catch (e) {
    record('multi-step tool calls', false, e.message);
  }

  // 7. AGENTIC MODE: Complex prompt that should trigger multiple tool calls
  LOG.section('TEST: Agentic Code Generation (Complex)');
  try {
    const agentResult = await chatNonStreaming(
      [{ role: 'user', content: 'Create a simple Express.js web server app with these files:\n1. package.json with express dependency\n2. server.js with a hello world endpoint\n3. README.md with instructions\nPut all file contents in fenced code blocks with file: prefix.' }],
      { agentMode: 'auto', mode: 'max' }
    );
    const content = agentResult.json?.content || '';
    const hasPackageJson = content.includes('package.json') || content.includes('express');
    const hasServerJs = content.includes('server.js') || content.includes('app.get');
    record('agentic code generation', hasPackageJson && hasServerJs,
      hasPackageJson && hasServerJs ? 'Generated multi-file app' : `Missing expected content. Has package.json: ${hasPackageJson}, Has server.js: ${hasServerJs}`);
    LOG.detail('Agent response', content.slice(0, 500));
  } catch (e) {
    record('agentic code generation', false, e.message);
  }

  // 8. TEST DIFFERENT PROVIDER (if available)
  LOG.section('TEST: Alternate Provider (google)');
  try {
    const altResult = await chatNonStreaming(
      [{ role: 'user', content: 'Reply with exactly: google_provider_ok' }],
      { provider: 'google', model: 'gemini-3.1-flash-lite-preview' }
    );
    const altOk = altResult.status === 200;
    record('google provider', altOk,
      altOk ? 'Google provider responds' : `Status ${altResult.status}: ${altResult.text.slice(0, 200)}`);
  } catch (e) {
    record('google provider', false, e.message);
  }

  // 9. TEST nvidia provider
  LOG.section('TEST: nvidia Provider');
  try {
    const nvResult = await chatNonStreaming(
      [{ role: 'user', content: 'Reply with exactly: nvidia_provider_ok' }],
      { provider: 'nvidia', model: 'gpt-oss-120' }
    );
    const nvOk = nvResult.status === 200;
    record('nvidia provider', nvOk,
      nvOk ? 'nvidia provider responds' : `Status ${nvResult.status}: ${nvResult.text.slice(0, 200)}`);
  } catch (e) {
    record('nvidia provider', false, e.message);
  }

  // 10. FILE EDITING: Test apply_diff / write_file workflow
  LOG.section('TEST: File Edit via Tool Calls');
  try {
    const editResult2 = await chatNonStreaming(
      [{ role: 'user', content: 'Create a file called counter.js with:\n```javascript\nlet count = 0;\nfunction increment() { count++; return count; }\nmodule.exports = { increment };\n```' }],
      { mode: 'max', extra: { filesystemContext: { applyFileEdits: true } } }
    );
    record('file edit via api', editResult2.status === 200,
      editResult2.status === 200 ? `Response: ${(editResult2.json?.content || '').slice(0, 200)}` : `Status ${editResult2.status}`);
    if (editResult2.json?.data?.appliedEdits) {
      LOG.ok(`Applied edits count: ${editResult2.json.data.appliedEdits.count}`);
    }
  } catch (e) {
    record('file edit via api', false, e.message);
  }

  // ============================================================================
  // Summary
  // ============================================================================
  LOG.section('=== RESULTS ===');
  console.log(`\n  \x1b[1mTotal: ${passed + failed}  |  Passed: \x1b[32m${passed}\x1b[0m  |  Failed: \x1b[31m${failed}\x1b[0m\n`);

  if (failed > 0) {
    LOG.section('FAILED TESTS DETAILS');
    for (const r of results.filter(r => !r.success)) {
      console.log(`  \x1b[31m✗ ${r.name}\x1b[0m`);
      console.log(`    ${r.detail}\n`);
    }
  }
}

runAll().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
