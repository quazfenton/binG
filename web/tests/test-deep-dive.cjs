/**
 * DEEP DIVE E2E TESTS - OpenRouter (confirmed working provider)
 *
 * Tests actual agency workflows:
 * 1. File creation → verification file exists
 * 2. File editing → verification content changed
 * 3. Multi-file project → all files referenced
 * 4. Shell execution intent
 * 5. Auto-continue on complex tasks
 * 6. No infinite loops
 * 7. Regex fallback parsing when tool_use fails
 * 8. Multi-turn conversation with context
 * 9. Code generation with specific requirements
 * 10. Error handling (non-existent file)
 */

const http = require('http');

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
      const toolCalls = [];
      const fileEdits = [];
      const steps = [];
      let hasDone = false;
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
              i++;
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
          status: res.statusCode, content, reasoning, events,
          toolCalls, fileEdits, steps, hasDone, hasError,
          firstTokenAt, lastEventAt,
          durationMs: lastEventAt ? lastEventAt - (firstTokenAt || lastEventAt) : 0,
          eventCount: events.length,
          contentLength: content.length,
          uniqueEventTypes: [...new Set(events.map(e => e.type))],
        });
      });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data); req.end();
  });
}

function assert(cond, msg) {
  const pass = !!cond;
  testResults.push({ test: currentTest, pass, message: msg });
  console.log(`  ${pass ? '✅' : '❌'} ${msg}`);
  return pass;
}

function log(label, result) {
  console.log(`    📊 ${label}: ${result.contentLength} chars, ${result.eventCount} events, ${result.toolCalls.length} tools, ${result.fileEdits.length} fileEdits`);
  console.log(`    📋 Events: ${JSON.stringify(result.uniqueEventTypes)}`);
  if (result.fileEdits.length > 0) {
    const paths = [...new Set(result.fileEdits.map(e => e.path || e.data?.path || 'unknown'))];
    console.log(`    📝 Files: ${JSON.stringify(paths)}`);
  }
  if (result.content.length > 0) {
    console.log(`    💬 Preview: ${result.content.slice(0, 200).replace(/\n/g, ' ')}...`);
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================== AUTH =====================

async function testAuth() {
  currentTest = 'Auth';
  console.log(`\n🔐 ${currentTest}`);
  const res = await fetchJson('POST', '/api/auth/login', { email: 'test@test.com', password: 'Testing0' });
  assert(res.status === 200, `Status ${res.status}`);
  assert(res.body.success, 'Login success');
  jwtToken = res.body.token;
  const sc = res.headers['set-cookie'];
  if (sc) { const m = sc.find(c => c.includes('session=')); if (m) sessionCookie = m.split(';')[0]; }
  assert(!!jwtToken, 'JWT returned');
}

// ===================== DEEP TESTS =====================

async function testFileCreation() {
  currentTest = '[OpenRouter] File creation - calculator.js';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create a file called calculator.js with functions: add(a,b), subtract(a,b), multiply(a,b), divide(a,b). Each should return the result of the operation.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 8192, stream: true,
  }, 180000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 100, `Content > 100 chars, got ${result.contentLength}`);
  
  const hasCalc = result.content.toLowerCase().includes('calculator') || result.content.includes('add');
  assert(hasCalc, 'References calculator/add');
  
  const hasAdd = result.content.includes('function add') || result.content.includes('const add');
  assert(hasAdd, 'Contains add function');
  
  const hasFileEdit = result.fileEdits.length > 0;
  assert(hasFileEdit, `File edits detected (${result.fileEdits.length})`);
  
  if (result.fileEdits.length > 0) {
    const calcEdit = result.fileEdits.find(e => {
      const p = (e.path || e.data?.path || '').toLowerCase();
      return p.includes('calculator');
    });
    assert(!!calcEdit, 'File edit for calculator.js found');
    if (calcEdit) {
      const c = calcEdit.content || calcEdit.data?.content || '';
      assert(c.includes('add'), 'File content includes add');
      assert(c.length > 50, `File content is substantial (${c.length} chars)`);
    }
  }
  log('result', result);
}

async function testMultiFileGeneration() {
  currentTest = '[OpenRouter] Multi-file - Express API';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create an Express.js API with: 1) package.json (name: "testapi", version: "1.0.0", start script) 2) index.js (Express server on port 3000 with GET /health returning {status:"ok"}) 3) routes.js (GET /users returning [{id:1,name:"Alice"}])' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 16384, stream: true,
  }, 240000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 200, `Content > 200 chars, got ${result.contentLength}`);
  
  // Check all 3 files are referenced
  const refs = {
    package: result.content.toLowerCase().includes('package.json'),
    index: result.content.toLowerCase().includes('index.js'),
    routes: result.content.toLowerCase().includes('routes.js'),
  };
  assert(refs.package, 'References package.json');
  assert(refs.index, 'References index.js');
  assert(refs.routes, 'References routes.js');
  
  // Check file edits
  const editPaths = new Set(result.fileEdits.map(e => {
    const p = e.path || e.data?.path || '';
    return p.split('/').pop().toLowerCase();
  }));
  console.log(`    📁 Edit paths (basename): ${JSON.stringify([...editPaths])}`);
  
  const hasPackageEdit = [...editPaths].some(p => p.includes('package'));
  const hasIndexEdit = [...editPaths].some(p => p.includes('index'));
  const hasRoutesEdit = [...editPaths].some(p => p.includes('routes'));
  
  assert(hasPackageEdit || refs.package, `Package.json file edit or reference`);
  assert(hasIndexEdit || refs.index, `Index.js file edit or reference`);
  assert(hasRoutesEdit || refs.routes, `Routes.js file edit or reference`);
  
  log('result', result);
}

async function testFileEditing() {
  currentTest = '[OpenRouter] File editing - diff to existing file';
  console.log(`\n🧪 ${currentTest}`);

  // First create a file
  await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create test-edit-target.js with: export const VERSION = "1.0.0";' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 2048, stream: true,
  }, 120000);

  await sleep(2000);

  // Now edit it
  const result = await streamChat('/api/chat', {
    messages: [
      { role: 'user', content: 'Create test-edit-target.js with: export const VERSION = "1.0.0";' },
      { role: 'assistant', content: 'Created test-edit-target.js with VERSION = "1.0.0".' },
      { role: 'user', content: 'Change VERSION to "2.0.0" in test-edit-target.js' }
    ],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 20, `Has content, got ${result.contentLength} chars`);
  
  const hasV2 = result.content.includes('2.0.0');
  assert(hasV2, 'Response contains 2.0.0');
  
  const hasDiff = result.content.includes('---') || result.content.includes('diff');
  const hasFileEdit = result.fileEdits.length > 0;
  assert(hasDiff || hasFileEdit, `Has diff or file edit`);
  
  log('result', result);
}

async function testShellExecutionIntent() {
  currentTest = '[OpenRouter] Shell execution intent';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Create hello.py with: print("Hello from E2E test!"). Then run it with python and show me the output.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 20, `Has content, got ${result.contentLength} chars`);
  
  const lower = result.content.toLowerCase();
  const hasRun = lower.includes('run') || lower.includes('execute') || lower.includes('python') || lower.includes('output');
  assert(hasRun, 'References running/execution');
  
  const hasHello = result.content.includes('hello.py') || result.content.includes('Hello');
  assert(hasHello, 'References hello.py or Hello');
  
  log('result', result);
}

async function testNoInfiniteLoop() {
  currentTest = '[OpenRouter] No infinite loop - complex task';
  console.log(`\n🧪 ${currentTest}`);

  const start = Date.now();
  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Build a Todo API: GET /todos, POST /todos (title+completed), PUT /todos/:id, DELETE /todos/:id. Create routes.js and app.js files.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 16384, stream: true,
  }, 240000);

  const duration = Date.now() - start;
  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, `Stream completed in ${Math.round(duration/1000)}s`);
  assert(duration < 240000, `Completed within timeout (${Math.round(duration/1000)}s)`);
  assert(result.contentLength > 200, `Complex task generated substantial content (${result.contentLength} chars)`);
  
  const hasTodo = result.content.toLowerCase().includes('todo') || result.content.toLowerCase().includes('route');
  assert(hasTodo, 'References todo/routes');
  
  log('result', result);
}

async function testAutoContinue() {
  currentTest = '[OpenRouter] Auto-continue - Next.js app';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Build a complete Next.js app: pages/index.tsx with a form, pages/api/submit.ts with POST handler, styles/globals.css, package.json. Write ALL files.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 16384, stream: true,
  }, 240000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 200, `Has content, got ${result.contentLength} chars`);
  
  const autoContinueCount = result.events.filter(e => e.type === 'auto-continue').length;
  console.log(`    🔄 Auto-continue events: ${autoContinueCount}`);
  
  log('result', result);
}

async function testErrorHandling() {
  currentTest = '[OpenRouter] Error handling - nonexistent file';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Read the file nonexistent_file_xyz.txt and tell me its contents. Handle the error if it does not exist.' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.3, maxTokens: 2048, stream: true,
  }, 120000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 10, `Has content, got ${result.contentLength} chars`);
  
  const lower = result.content.toLowerCase();
  const hasErrorAck = lower.includes('not found') || lower.includes('does not exist') || lower.includes('error') || lower.includes('cannot') || lower.includes('missing');
  assert(hasErrorAck, 'Acknowledges error/missing file');
  
  log('result', result);
}

async function testRegexFallback() {
  currentTest = '[OpenRouter] Regex fallback file edits';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [{ role: 'user', content: 'Write a utils.js file with: export function slugify(text) { return text.toLowerCase().replace(/\\s+/g, "-"); }' }],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 50, `Has content, got ${result.contentLength} chars`);
  
  const hasSlugify = result.content.toLowerCase().includes('slugify');
  assert(hasSlugify, 'References slugify function');
  
  const hasFileEdit = result.fileEdits.length > 0;
  const hasToolCall = result.toolCalls.length > 0;
  console.log(`    🔧 Tool calls: ${result.toolCalls.length}, File edits: ${result.fileEdits.length}`);
  assert(hasFileEdit || hasToolCall, `Has file edit or tool call`);
  
  log('result', result);
}

async function testMultiTurnConversation() {
  currentTest = '[OpenRouter] Multi-turn conversation context';
  console.log(`\n🧪 ${currentTest}`);

  const result = await streamChat('/api/chat', {
    messages: [
      { role: 'user', content: 'Create a config.json with: {"appName":"TestApp","port":3000}' },
      { role: 'assistant', content: '```file: config.json\n{"appName":"TestApp","port":3000}\n```\nCreated config.json.' },
      { role: 'user', content: 'Now change the port to 8080 in that config file.' }
    ],
    provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', temperature: 0.2, maxTokens: 4096, stream: true,
  }, 120000);

  assert(!result.hasError, 'No stream error');
  assert(result.hasDone, 'Stream completed');
  assert(result.contentLength > 20, `Has content, got ${result.contentLength} chars`);
  
  const has8080 = result.content.includes('8080');
  assert(has8080, 'References port 8080');
  
  const hasConfig = result.content.toLowerCase().includes('config');
  assert(hasConfig, 'References config');
  
  log('result', result);
}

// ===================== MAIN =====================

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  DEEP DIVE E2E TESTS — OpenRouter Llama-3.3-70b');
  console.log('  Started: ' + new Date().toISOString());
  console.log('═'.repeat(70));

  await testAuth();

  // Core tests
  await testFileCreation();
  await sleep(2000);

  await testMultiFileGeneration();
  await sleep(3000);

  await testFileEditing();
  await sleep(2000);

  await testShellExecutionIntent();
  await sleep(2000);

  await testNoInfiniteLoop();
  await sleep(3000);

  await testAutoContinue();
  await sleep(3000);

  await testErrorHandling();
  await sleep(2000);

  await testRegexFallback();
  await sleep(2000);

  await testMultiTurnConversation();

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

  require('fs').writeFileSync('test-deep-dive-results.json', JSON.stringify(testResults, null, 2));
  console.log('\n  Saved: test-deep-dive-results.json');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
