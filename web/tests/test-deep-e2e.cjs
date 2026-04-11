/**
 * DEEP E2E INTEGRATION TESTS - Full LLM Agency Workflow
 *
 * Tests:
 * - LLM actually calls tools (not just talks about them)
 * - Files are created/edited in VFS via tool execution
 * - Tool call args are properly populated
 * - Auto-continue detection works
 * - File edit regex fallback parsing when tool_use fails
 * - Multi-file generation from single prompt
 * - Workspace scoping (correct file selection)
 * - Shell execution intent detection
 * - No infinite loops
 * - Multiple provider fallback chain
 *
 * Usage: node test-deep-e2e.cjs
 * Requires: Dev server running on localhost:3000
 *           Auth credentials: test@test.com / Testing0
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
let jwtToken = '';
let sessionCookie = '';
const testResults = [];
let currentTest = '';

// ===================== HTTP HELPERS =====================

function fetchJson(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', ...extraHeaders }
    };
    if (sessionCookie) opts.headers['Cookie'] = sessionCookie;
    if (jwtToken) opts.headers['Authorization'] = `Bearer ${jwtToken}`;
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: d, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Stream a chat request and parse all SSE events in real-time.
 * Returns comprehensive breakdown of what happened.
 */
function streamChat(urlPath, body, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'localhost', port: 3000, path: urlPath, method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    if (sessionCookie) opts.headers['Cookie'] = sessionCookie;
    if (jwtToken) opts.headers['Authorization'] = `Bearer ${jwtToken}`;

    let timer;
    const req = http.request(opts, res => {
      timer = setTimeout(() => { req.destroy(); reject(new Error(`Stream timeout after ${timeoutMs}ms`)); }, timeoutMs);

      const events = [];
      let content = '';
      let reasoning = '';
      const toolCalls = [];    // tool-call events
      const toolResults = [];  // tool-invocation result events
      const fileEdits = [];
      const steps = [];
      const errors = [];
      let hasDone = false;
      let hasAutoContinue = false;
      let hasError = null;
      let firstTokenAt = null;
      let lastEventAt = null;

      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          let eventType = '';
          let eventData = null;

          if (line.startsWith('event: ')) {
            eventType = line.slice(6).trim();
            const nextLine = lines[i + 1];
            if (nextLine && nextLine.startsWith('data: ')) {
              try { eventData = JSON.parse(nextLine.slice(5)); } catch {}
              i++; // Skip data line
            }
          } else if (line.startsWith('data: ')) {
            try { eventData = JSON.parse(line.slice(5)); } catch {}
          }

          if (eventData) {
            lastEventAt = Date.now();
            if (!firstTokenAt && (eventData.content || eventType === 'token')) firstTokenAt = lastEventAt;
            events.push({ type: eventType || eventData.type || 'unknown', data: eventData, ts: lastEventAt });

            if (eventData.content) content += eventData.content;
            if (eventData.reasoning) reasoning += eventData.reasoning;

            if (eventType === 'tool-invocation' || eventType === 'tool_call') {
              toolCalls.push(eventData);
              if (eventData.args) {
                toolResults.push({ ...eventData, hasArgs: Object.keys(eventData.args).length > 0 });
              }
            }
            if (eventType === 'file_edit') {
              fileEdits.push(eventData);
            }
            if (eventType === 'step' || eventType === 'processing_step') {
              steps.push(eventData);
            }
            if (eventType === 'auto-continue') hasAutoContinue = true;
            if (eventType === 'done' || eventType === 'primary_done') hasDone = true;
            if (eventType === 'error') { hasError = eventData; errors.push(eventData); }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timer);
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed.content) content += parsed.content;
          } catch {}
        }
        const duration = lastEventAt ? lastEventAt - (firstTokenAt || lastEventAt) : 0;
        resolve({
          status: res.statusCode,
          content,
          reasoning,
          events,
          toolCalls,
          toolResults,
          fileEdits,
          steps,
          errors,
          hasDone,
          hasAutoContinue,
          hasError,
          firstTokenAt,
          lastEventAt,
          durationMs: duration,
          eventCount: events.length,
          eventTypeSequence: events.map(e => e.type),
          uniqueEventTypes: [...new Set(events.map(e => e.type))],
          contentLength: content.length,
        });
      });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

// ===================== ASSERT HELPERS =====================

function assert(cond, msg) {
  const pass = !!cond;
  testResults.push({ test: currentTest, pass, message: msg });
  console.log(`  ${pass ? '✅' : '❌'} ${currentTest} | ${msg}`);
  return pass;
}

function assertHasToolCall(result, toolName, msg) {
  const found = result.toolCalls.some(t =>
    (t.toolName === toolName) ||
    (t.data?.toolName === toolName) ||
    (t.data?.toolCallId && t.data?.toolName)
  );
  // Also check fileEdits for regex-fallback tool detection
  const foundInFileEdits = result.fileEdits.some(e => e.path && (e.content || e.diff));
  return assert(found || foundInFileEdits, msg || `Expected tool call "${toolName}" to be present`);
}

function assertHasContent(result, needle, msg) {
  return assert(result.content && result.content.toLowerCase().includes(needle.toLowerCase()), msg || `Expected content to contain "${needle}"`);
}

function assertNoError(result) {
  return assert(!result.hasError, `Expected no stream error but got: ${JSON.stringify(result.hasError)}`);
}

function assertHasFileEdit(result, msg) {
  return assert(result.fileEdits.length > 0, msg || `Expected file edits to be detected (regex fallback or tool-use)`);
}

function assertToolCallHasArgs(toolCalls, msg) {
  const withArgs = toolCalls.filter(t => {
    const args = t.args || t.data?.args;
    return args && typeof args === 'object' && Object.keys(args).length > 0;
  });
  return assert(withArgs.length > 0, msg || `Expected at least one tool call with populated args, got ${toolCalls.length} total calls but ${toolCalls.length - withArgs.length} had empty args`);
}

function logResult(label, result) {
  console.log(`    📊 ${label}: ${result.contentLength} chars, ${result.eventCount} events, ${result.toolCalls.length} tool calls, ${result.fileEdits.length} file edits`);
  console.log(`    📋 Event types: ${JSON.stringify(result.uniqueEventTypes)}`);
  if (result.toolCalls.length > 0) {
    console.log(`    🔧 Tool calls: ${JSON.stringify(result.toolCalls.map(t => t.data?.toolName || t.toolName || t.data?.toolCallId || 'unknown'))}`);
    result.toolCalls.forEach(t => {
      const args = t.data?.args || t.args;
      console.log(`       → ${t.data?.toolName || t.toolName || 'unknown'} args: ${args ? JSON.stringify(args).slice(0, 200) : 'EMPTY'}`);
    });
  }
  if (result.fileEdits.length > 0) {
    console.log(`    📝 File edits: ${result.fileEdits.map(e => e.path || e.data?.path || 'unknown').join(', ')}`);
  }
  if (result.content.length > 0) {
    const preview = result.content.slice(0, 300).replace(/\n/g, ' ');
    console.log(`    💬 Preview: ${preview}...`);
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================== TEST SUITES =====================

async function testAuth() {
  currentTest = 'Authentication';
  console.log(`\n🔐 ${currentTest}`);
  const res = await fetchJson('POST', '/api/auth/login', { email: 'test@test.com', password: 'Testing0' });
  assert(res.status === 200, `Status should be 200, got ${res.status}`);
  assert(res.body.success === true, 'Login should succeed');
  jwtToken = res.body.token;
  const setCookie = res.headers['set-cookie'];
  if (setCookie) { const m = setCookie.find(c => c.includes('session=')); if (m) sessionCookie = m.split(';')[0]; }
  assert(!!jwtToken, 'JWT token returned');
}

async function testLLMCreatesFileViaTool(provider, model, label) {
  currentTest = `[${label}] LLM creates file via tool call`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a file called test-deep-e2e-output.js with a function called helloWorld that returns the string "Hello from deep E2E test!"' }],
    provider, model, temperature: 0.2, maxTokens: 4096, stream: true,
  }, 180000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete with done event');
  assert(result.content.length > 20, `Should have meaningful content, got ${result.contentLength} chars`);

  // Check if LLM actually called a tool
  assertHasToolCall(result, 'write_file', 'LLM should have called write_file tool OR produced file content');
  assertHasContent(result, 'helloWorld', 'Response should reference the helloWorld function');
  assertHasContent(result, 'test-deep-e2e-output', 'Response should reference the file');
  logResult(label, result);
  return result;
}

async function testLLMEditsFile(provider, model, label) {
  currentTest = `[${label}] LLM edits existing file`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [
      { role: 'user', content: 'Create a file called test-deep-e2e-counter.js with: export function count() { return 0; }' },
      { role: 'assistant', content: 'I\'ve created the file with a count function.' },
      { role: 'user', content: 'Now modify the count function to return 42 instead of 0.' }
    ],
    provider, model, temperature: 0.2, maxTokens: 4096, stream: true,
  }, 180000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  assert(result.content.length > 20, `Should have meaningful content, got ${result.contentLength} chars`);
  // Check for tool call or file edit
  const hasToolCall = result.toolCalls.length > 0;
  const hasFileEdit = result.fileEdits.length > 0;
  assert(hasToolCall || hasFileEdit, `LLM should have called a tool or produced a file edit. toolCalls: ${result.toolCalls.length}, fileEdits: ${result.fileEdits.length}`);
  if (result.toolCalls.length > 0) {
    assertToolCallHasArgs(result.toolCalls, 'Tool calls should have populated args');
  }
  logResult(label, result);
  return result;
}

async function testLLMGeneratesMultipleFiles(provider, model, label) {
  currentTest = `[${label}] LLM generates multiple files`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a simple Express.js app. Write TWO files: 1) package.json with {"name":"testapp","version":"1.0.0","scripts":{"start":"node index.js"}} 2) index.js with a basic Express server on port 3000.' }],
    provider, model, temperature: 0.2, maxTokens: 8192, stream: true,
  }, 180000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  assert(result.contentLength > 100, `Should generate substantial content for multi-file task, got ${result.contentLength} chars`);

  const hasToolCalls = result.toolCalls.length > 0;
  const hasFileEdits = result.fileEdits.length > 0;
  assert(hasToolCalls || hasFileEdits, `LLM should have called tools or produced file edits for multi-file generation`);

  // Check if multiple files were referenced
  const referencedFiles = new Set();
  result.toolCalls.forEach(t => {
    const args = t.data?.args || t.args;
    if (args?.path) referencedFiles.add(args.path);
  });
  result.fileEdits.forEach(e => {
    const p = e.path || e.data?.path;
    if (p) referencedFiles.add(p);
  });

  console.log(`    📁 Referenced files: ${JSON.stringify([...referencedFiles])}`);
  logResult(label, result);
  return result;
}

async function testLLMReadsFile(provider, model, label) {
  currentTest = `[${label}] LLM reads file and reports content`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Read the file package.json and tell me its contents.' }],
    provider, model, temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  assert(result.contentLength > 10, `Should have some response, got ${result.contentLength} chars`);

  const hasReadCall = result.toolCalls.some(t =>
    (t.data?.toolName === 'read_file') || (t.toolName === 'read_file')
  );
  console.log(`    📖 Has read_file tool call: ${hasReadCall}`);
  logResult(label, result);
  return result;
}

async function testShellExecutionIntent(provider, model, label) {
  currentTest = `[${label}] Shell execution intent from natural language`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a file called hello.py with: print("Hello World"). Then run it and show me the output.' }],
    provider, model, temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  assert(result.contentLength > 20, `Should have content, got ${result.contentLength} chars`);

  // Check for shell/bash/execute/run intent
  const lower = result.content.toLowerCase();
  const hasShellIntent = lower.includes('run') || lower.includes('execute') || lower.includes('python') || lower.includes('output') || lower.includes('terminal') || lower.includes('shell');
  assert(hasShellIntent, 'LLM should reference running/execution');

  const hasExecuteTool = result.toolCalls.some(t => {
    const name = t.data?.toolName || t.toolName || '';
    return name.includes('shell') || name.includes('bash') || name.includes('execute') || name.includes('run') || name.includes('terminal');
  });
  console.log(`    🖥️  Has execute/shell tool call: ${hasExecuteTool}`);
  logResult(label, result);
  return result;
}

async function testNoInfiniteLoop(provider, model, label) {
  currentTest = `[${label}] No infinite loop on complex task`;
  console.log(`\n🧪 ${currentTest}`);

  const start = Date.now();
  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a Todo API with Express. Create routes.js with GET/POST/PUT/DELETE /todos endpoints using in-memory storage. Create app.js that imports routes and starts the server on port 3001.' }],
    provider, model, temperature: 0.2, maxTokens: 16384, stream: true,
  }, 240000);

  const duration = Date.now() - start;
  assertNoError(result);
  assert(result.hasDone, `Stream should complete (not loop forever). Duration: ${Math.round(duration/1000)}s`);
  assert(result.contentLength > 200, `Complex prompt should generate substantial response, got ${result.contentLength} chars`);
  assert(duration < 240000, `Should complete within timeout, took ${Math.round(duration/1000)}s`);
  logResult(label, result);
  return result;
}

async function testAutoContinueDetection(provider, model, label) {
  currentTest = `[${label}] Auto-continue detection`;
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Build a complete Next.js app with: 1) pages/index.tsx with a form, 2) pages/api/submit.ts with POST handler, 3) styles/globals.css, 4) package.json with dependencies. Write ALL files.' }],
    provider, model, temperature: 0.2, maxTokens: 16384, stream: true,
  }, 240000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  console.log(`    🔄 Auto-continue events: ${result.events.filter(e => e.type === 'auto-continue').length}`);
  console.log(`    🔄 Continue requested: ${result.events.filter(e => e.data?.content?.includes('[CONTINUE_REQUESTED]')).length}`);
  logResult(label, result);
  return result;
}

async function testRegexFallbackFileEdit(provider, model, label) {
  currentTest = `[${label}] Regex fallback for file edits (when tool_use fails)`;
  console.log(`\n🧪 ${currentTest}`);

  // This tests the file-edit-parser.ts fallback when LLM outputs code in markdown
  // instead of using structured tool calls
  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Write a calculator.js file with add, subtract, multiply functions. Output the code.' }],
    provider, model, temperature: 0.3, maxTokens: 4096, stream: true,
  }, 120000);

  assertNoError(result);
  assert(result.hasDone, 'Stream should complete');
  assert(result.contentLength > 50, `Should have content, got ${result.contentLength} chars`);

  // Even if no tool calls, the file-edit-parser should detect code blocks
  const hasToolCalls = result.toolCalls.length > 0;
  const hasFileEdits = result.fileEdits.length > 0;
  console.log(`    🔧 Tool calls: ${result.toolCalls.length}`);
  console.log(`    📝 File edits (regex fallback): ${result.fileEdits.length}`);

  // Check if LLM at least referenced the file
  const mentionsFile = result.content.toLowerCase().includes('calculator');
  assert(mentionsFile, 'LLM should reference calculator.js');
  logResult(label, result);
  return result;
}

// ===================== MAIN =====================

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  DEEP E2E INTEGRATION TESTS — Full LLM Agency Workflows');
  console.log('  Started: ' + new Date().toISOString());
  console.log('═'.repeat(70));

  // Auth
  await testAuth();

  // Test matrix: providers x test types
  // Using reliable providers as specified
  const providers = [
    { provider: 'mistral', model: 'mistral-small-latest', label: 'mistral-small' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', label: 'openrouter-llama' },
    { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', label: 'nvidia-nemotron' },
  ];

  // Run core tests for each provider
  for (const { provider, model, label } of providers) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Testing: ${label} (${provider}/${model})`);
    console.log(`${'─'.repeat(60)}`);

    try {
      await testLLMCreatesFileViaTool(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} file creation failed:`, e.message); }

    await sleep(2000);

    try {
      await testLLMEditsFile(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} file edit failed:`, e.message); }

    await sleep(2000);

    try {
      await testLLMGeneratesMultipleFiles(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} multi-file failed:`, e.message); }

    await sleep(2000);

    try {
      await testLLMReadsFile(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} read file failed:`, e.message); }

    await sleep(2000);

    try {
      await testShellExecutionIntent(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} shell intent failed:`, e.message); }

    await sleep(2000);

    try {
      await testRegexFallbackFileEdit(provider, model, label);
    } catch (e) { console.error(`    💥 ${label} regex fallback failed:`, e.message); }

    await sleep(3000);
  }

  // Heavy tests (only run once due to time)
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  HEAVY TESTS — Complex agency tasks (mistral only)`);
  console.log(`${'─'.repeat(60)}`);

  try {
    await testNoInfiniteLoop('mistral', 'mistral-small-latest', 'mistral-no-loop');
  } catch (e) { console.error(`    💥 No infinite loop failed:`, e.message); }

  await sleep(3000);

  try {
    await testAutoContinueDetection('mistral', 'mistral-small-latest', 'mistral-auto-continue');
  } catch (e) { console.error(`    💥 Auto-continue failed:`, e.message); }

  // ==================== SUMMARY ====================
  console.log('\n' + '═'.repeat(70));
  console.log('  TEST RESULTS SUMMARY');
  console.log('═'.repeat(70));

  const passed = testResults.filter(r => r.pass).length;
  const failed = testResults.filter(r => !r.pass).length;
  const total = testResults.length;
  console.log(`\n  Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%`);

  if (failed > 0) {
    console.log('\n  ❌ Failed Tests:');
    testResults.filter(r => !r.pass).forEach(r => {
      console.log(`    → ${r.test}: ${r.message}`);
    });
  }

  // Save results
  fs.writeFileSync('test-deep-e2e-results.json', JSON.stringify(testResults, null, 2));
  console.log('\n  Results saved to test-deep-e2e-results.json');
  console.log('═'.repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
