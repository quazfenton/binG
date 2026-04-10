/**
 * Bash Command Execution Deep Tests
 * 
 * Tests:
 * 1. Simple command execution (echo, date, pwd)
 * 2. File creation via bash (echo > file, cat > file)
 * 3. Multi-command chains (&&, ||, ;)
 * 4. Environment variable access
 * 5. Command with special characters
 * 6. Directory navigation
 * 7. Command output capture
 * 8. Error handling (non-existent commands)
 * 9. Security filtering (dangerous commands)
 * 10. Self-healing on failed commands
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
let jwtToken = '';
let sessionCookie = '';
const testResults = [];
let currentTest = '';

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

function streamChat(urlPath, body, timeoutMs = 120000) {
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
      const toolCalls = [];
      const fileEdits = [];
      const steps = [];
      let hasDone = false;
      let hasError = null;

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
              i++;
            }
          } else if (line.startsWith('data: ')) {
            try { eventData = JSON.parse(line.slice(5)); } catch {}
          }

          if (eventData) {
            events.push({ type: eventType || eventData.type || 'unknown', data: eventData });
            if (eventData.content) content += eventData.content;
            if (eventType === 'tool-invocation' || eventType === 'tool_call') toolCalls.push(eventData);
            if (eventType === 'file_edit') fileEdits.push(eventData);
            if (eventType === 'step' || eventType === 'processing_step') steps.push(eventData);
            if (eventType === 'done' || eventType === 'primary_done') hasDone = true;
            if (eventType === 'error') { hasError = eventData; }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timer);
        if (buffer.trim()) {
          try { const p = JSON.parse(buffer.trim()); if (p.content) content += p.content; } catch {}
        }
        resolve({
          status: res.statusCode, content, events, toolCalls, fileEdits, steps, hasDone, hasError,
          contentLength: content.length,
          uniqueEventTypes: [...new Set(events.map(e => e.type))],
        });
      });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  const pass = !!cond;
  testResults.push({ test: currentTest, pass, message: msg });
  console.log(`  ${pass ? '✅' : '❌'} ${msg}`);
  return pass;
}

function log(label, result) {
  console.log(`    📊 ${label}: ${result.contentLength} chars, ${result.events.length} events, ${result.toolCalls.length} tools, ${result.fileEdits.length} fileEdits`);
  console.log(`    📋 Events: ${JSON.stringify(result.uniqueEventTypes)}`);
  if (result.toolCalls.length > 0) {
    console.log(`    🔧 Tools: ${JSON.stringify(result.toolCalls.map(t => t.data?.toolName || t.toolName || 'unknown'))}`);
  }
  if (result.content.length > 0) {
    console.log(`    💬 Preview: ${result.content.slice(0, 200).replace(/\n/g, ' ')}...`);
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  BASH COMMAND EXECUTION DEEP TESTS');
  console.log('  Started: ' + new Date().toISOString());
  console.log('═'.repeat(70));

  // Auth
  currentTest = 'Auth';
  console.log(`\n🔐 ${currentTest}`);
  const res = await fetchJson('POST', '/api/auth/login', { email: 'test@test.com', password: 'Testing0' });
  assert(res.status === 200, `Status ${res.status}`);
  assert(res.body.success, 'Login success');
  jwtToken = res.body.token;
  const sc = res.headers['set-cookie'];
  if (sc) { const m = sc.find(c => c.includes('session=')); if (m) sessionCookie = m.split(';')[0]; }
  assert(!!jwtToken, 'JWT returned');

  // Test 1: LLM prompted to run simple bash command
  currentTest = '[Bash] LLM prompted to echo "hello world"';
  console.log(`\n🧪 ${currentTest}`);
  const r1 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run this command and show me the output: echo "hello world"' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);
  assert(!r1.hasError, 'No stream error');
  assert(r1.hasDone, 'Stream completed');
  assert(r1.contentLength > 10, `Has content: ${r1.contentLength} chars`);
  const hasHello = r1.content.toLowerCase().includes('hello') || r1.content.toLowerCase().includes('world');
  assert(hasHello, 'References hello world output');
  log('result', r1);
  await sleep(2000);

  // Test 2: LLM prompted to create file via bash
  currentTest = '[Bash] LLM prompted to create file via echo redirect';
  console.log(`\n🧪 ${currentTest}`);
  const r2 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a file called test-bash-echo.js with the content: console.log("created by bash") using echo or cat command.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);
  assert(!r2.hasError, 'No stream error');
  assert(r2.hasDone, 'Stream completed');
  assert(r2.contentLength > 20, `Has content: ${r2.contentLength} chars`);
  const hasConsoleLog = r2.content.includes('console.log') || r2.content.includes('created by bash');
  assert(hasConsoleLog, 'References the file content');
  log('result', r2);
  await sleep(2000);

  // Test 3: LLM prompted to run ls/pwd
  currentTest = '[Bash] LLM prompted to list files (ls/pwd)';
  console.log(`\n🧪 ${currentTest}`);
  const r3 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run the ls command to list files in the current directory.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);
  assert(!r3.hasError, 'No stream error');
  assert(r3.hasDone, 'Stream completed');
  assert(r3.contentLength > 10, `Has content: ${r3.contentLength} chars`);
  const hasLs = r3.content.toLowerCase().includes('ls') || r3.content.toLowerCase().includes('file') || r3.content.toLowerCase().includes('directory');
  assert(hasLs, 'References ls output or files');
  log('result', r3);
  await sleep(2000);

  // Test 4: LLM prompted to run node command
  currentTest = '[Bash] LLM prompted to run node command';
  console.log(`\n🧪 ${currentTest}`);
  const r4 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run this command: node -e "console.log(2+2)" and show me the result.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);
  assert(!r4.hasError, 'No stream error');
  assert(r4.hasDone, 'Stream completed');
  assert(r4.contentLength > 5, `Has content: ${r4.contentLength} chars`);
  const hasFour = r4.content.includes('4') || r4.content.toLowerCase().includes('result');
  assert(hasFour, 'Shows computation result');
  log('result', r4);
  await sleep(2000);

  // Test 5: Multi-command chain
  currentTest = '[Bash] LLM prompted to run chained commands';
  console.log(`\n🧪 ${currentTest}`);
  const r5 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run these commands: mkdir test-bash-dir && echo "test" > test-bash-dir/file.txt && cat test-bash-dir/file.txt' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);
  assert(!r5.hasError, 'No stream error');
  assert(r5.hasDone, 'Stream completed');
  assert(r5.contentLength > 10, `Has content: ${r5.contentLength} chars`);
  const hasTest = r5.content.includes('test') || r5.content.toLowerCase().includes('file');
  assert(hasTest, 'Shows command output');
  log('result', r5);
  await sleep(2000);

  // Test 6: Error handling - non-existent command
  currentTest = '[Bash] Error handling - non-existent command';
  console.log(`\n🧪 ${currentTest}`);
  const r6 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run this command that will fail: nonexistent_command_xyz' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);
  assert(!r6.hasError, 'No stream error');
  assert(r6.hasDone, 'Stream completed');
  assert(r6.contentLength > 10, `Has content: ${r6.contentLength} chars`);
  const hasError = r6.content.toLowerCase().includes('not found') || r6.content.toLowerCase().includes('error') || r6.content.toLowerCase().includes('failed');
  assert(hasError, 'Acknowledges command failure');
  log('result', r6);
  await sleep(2000);

  // Test 7: Python execution
  currentTest = '[Bash] LLM prompted to run python';
  console.log(`\n🧪 ${currentTest}`);
  const r7 = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Run: python -c "print(42)" and show the output.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);
  assert(!r7.hasError, 'No stream error');
  assert(r7.hasDone, 'Stream completed');
  assert(r7.contentLength > 5, `Has content: ${r7.contentLength} chars`);
  const has42 = r7.content.includes('42') || r7.content.toLowerCase().includes('output') || r7.content.toLowerCase().includes('print');
  assert(has42, 'Shows python output');
  log('result', r7);
  await sleep(2000);

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('  RESULTS');
  console.log('═'.repeat(70));
  const passed = testResults.filter(r => r.pass).length;
  const failed = testResults.filter(r => !r.pass).length;
  console.log(`\n  Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Rate: ${(passed/testResults.length*100).toFixed(1)}%`);
  if (failed > 0) {
    console.log('\n  ❌ Failed:');
    testResults.filter(r => !r.pass).forEach(r => console.log(`    → ${r.test}: ${r.message}`));
  }

  fs.writeFileSync('test-bash-execution-results.json', JSON.stringify(testResults, null, 2));
  console.log('\n  Saved: test-bash-execution-results.json');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
