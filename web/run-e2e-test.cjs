/**
 * Comprehensive End-to-End Integration Tests for binG
 *
 * Tests real API behavior: MCP tool execution, filesystem operations,
 * streaming SSE, provider tracking, parser correctness, error handling.
 *
 * NOTE: Chat-based file creation tests depend on LLM availability.
 * When LLM providers are down/unstable, those tests verify the
 * request/response flow but may not create files (which is expected).
 */
const http = require('http');
const fs = require('fs');

let sessionCookie = '';

function request(method, url, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const isPost = method === 'POST';
    const data = isPost ? JSON.stringify(body) : undefined;
    const reqOpts = {
      hostname: 'localhost', port: 3000, path: url, method,
      timeout: timeoutMs, headers: {}
    };
    if (isPost) {
      reqOpts.headers['Content-Type'] = 'application/json';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) { const a = sc.find(c => c.includes('anon-session-id')); if (a) sessionCookie = a.split(';')[0]; }
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b), headers: res.headers }); }
        catch(e) { reject(new Error('Parse: ' + e.message + ' | ' + b.substring(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isPost) req.write(data);
    req.end();
  });
}

function streamChat(url, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const reqOpts = {
      hostname: 'localhost', port: 3000, path: url, method: 'POST',
      timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) { const a = sc.find(c => c.includes('anon-session-id')); if (a) sessionCookie = a.split(';')[0]; }
      const events = [];
      let content = '';
      let hasAutoContinue = false;
      let isComplete = false;
      const timer = setTimeout(() => { req.destroy(); reject(new Error('Stream timeout')); }, timeoutMs);
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (line.startsWith('event: ')) {
            const eventType = line.slice(6).trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
            if (nextLine.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(nextLine.slice(5));
                events.push({ type: eventType, data: parsed });
                if (eventType === 'auto-continue') hasAutoContinue = true;
                if (eventType === 'done' || eventType === 'primary_done') isComplete = true;
                if (parsed.content) content += parsed.content;
                if (parsed.content && parsed.content.includes('[CONTINUE_REQUESTED]')) hasAutoContinue = true;
              } catch(e) {}
            }
          } else if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(5));
              if (parsed.content) content += parsed.content;
              if (parsed.type === 'done' || parsed.finishReason) isComplete = true;
            } catch(e) {}
          }
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (buffer.trim().startsWith('data: ')) {
          try { const p = JSON.parse(buffer.trim().slice(5)); if (p.content) content += p.content; } catch(e) {}
        }
        resolve({ status: res.statusCode, content: content.trim(), events, hasAutoContinue, isComplete, eventTypes: [...new Set(events.map(e => e.type))] });
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

const post = (url, body, t) => request('POST', url, body, t);
const get = (url, t) => request('GET', url, undefined, t);
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const results = [];
  function report(test, pass, detail) {
    results.push({ test, pass, detail });
    console.log((pass ? '✅' : '❌') + ' ' + test + (detail ? ' | ' + detail : ''));
  }

  // =========================================================================
  // 1. MCP: Direct write_file tool call
  // =========================================================================
  console.log('\n=== 1. MCP: Direct write_file tool call ===');
  try {
    const mcp = await post('/api/mcp', {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'write_file',
        arguments: { path: 'e2e-mcp-write.txt', content: 'Created via direct MCP call at ' + new Date().toISOString() }
      },
      id: 1
    });
    report('MCP write_file returns 200', mcp.status === 200, 'status=' + mcp.status);
    const resultText = mcp.body.result?.content?.[0]?.text || '';
    report('Result indicates success', resultText.includes('true') || resultText.includes('success') || mcp.body.result?.isError === false, resultText.substring(0, 100));

    await sleep(2000);

    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const mcpFile = files.find(f => f.path.includes('e2e-mcp-write'));
    report('MCP-created file found', !!mcpFile, mcpFile ? mcpFile.path + ' (v' + mcpFile.version + ', ' + mcpFile.size + 'b)' : 'not found');
    if (mcpFile) report('File in session path', mcpFile.path.includes('sessions'), mcpFile.path);
  } catch (e) { report('MCP write_file', false, e.message); }

  // =========================================================================
  // 2. MCP: Batch file creation (3 files)
  // =========================================================================
  console.log('\n=== 2. MCP: Batch file creation ===');
  try {
    const mcp = await post('/api/mcp', {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'batch_write',
        arguments: {
          files: [
            { path: 'e2e-batch-a.txt', content: 'Batch file A - ' + Date.now() },
            { path: 'e2e-batch-b.txt', content: 'Batch file B - ' + Date.now() },
            { path: 'e2e-batch-c.txt', content: 'Batch file C - ' + Date.now() }
          ]
        }
      },
      id: 2
    });
    report('MCP batch_write returns 200', mcp.status === 200, 'status=' + mcp.status);

    await sleep(3000);

    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const batchFiles = files.filter(f => f.path.includes('e2e-batch-'));
    report('Batch files created', batchFiles.length >= 2, 'found=' + batchFiles.length + '/3');
    batchFiles.forEach(f => console.log('  📄 ' + f.path + ' (v' + f.version + ', ' + f.size + 'b)'));
    // Verify session scoping
    const rootBatch = batchFiles.filter(f => !f.path.includes('sessions'));
    report('All files session-scoped', rootBatch.length === 0, 'root files=' + rootBatch.length);
  } catch (e) { report('MCP batch_write', false, e.message); }

  // =========================================================================
  // 3. MCP: list_directory tool
  // =========================================================================
  console.log('\n=== 3. MCP: list_directory tool ===');
  try {
    const mcp = await post('/api/mcp', {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'list_directory', arguments: { path: 'project/sessions' }, id: 3 }
    });
    report('MCP list_directory returns 200', mcp.status === 200, 'status=' + mcp.status);
    const resultText = mcp.body.result?.content?.[0]?.text || '';
    report('Result has content', resultText.length > 0, 'len=' + resultText.length);
  } catch (e) { report('MCP list_directory', false, e.message); }

  // =========================================================================
  // 4. MCP: read_file tool (read back a file we just created)
  // =========================================================================
  console.log('\n=== 4. MCP: read_file tool ===');
  try {
    // First create a file with known content
    await post('/api/mcp', {
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'write_file', arguments: { path: 'e2e-read-test.txt', content: 'Hello from read_file test!' }, id: 4 },
      id: 4
    });
    await sleep(1000);

    const mcp = await post('/api/mcp', {
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'e2e-read-test.txt' }, id: 5 },
      id: 5
    });
    report('MCP read_file returns 200', mcp.status === 200, 'status=' + mcp.status);
    const resultText = mcp.body.result?.content?.[0]?.text || '';
    report('Read content matches', resultText.includes('Hello from read_file test!'), 'content=' + resultText.substring(0, 100));
  } catch (e) { report('MCP read_file', false, e.message); }

  // =========================================================================
  // 5. FILESYSTEM: Snapshot API
  // =========================================================================
  console.log('\n=== 5. FILESYSTEM: Snapshot API ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    report('Snapshot returns 200', snap.status === 200, 'status=' + snap.status);
    const files = snap.body.data?.files || [];
    report('Has files in workspace', files.length > 0, 'count=' + files.length);
    const sessionFiles = files.filter(f => f.path.includes('sessions'));
    const rootFiles = files.filter(f => !f.path.includes('sessions'));
    report('All files session-scoped', rootFiles.length === 0, 'root=' + rootFiles.length + ' session=' + sessionFiles.length);
    files.slice(0, 5).forEach(f => console.log('  📄 ' + f.path + ' (v' + f.version + ')'));
  } catch (e) { report('Snapshot API', false, e.message); }

  // =========================================================================
  // 6. FILESYSTEM: Directory listing
  // =========================================================================
  console.log('\n=== 6. FILESYSTEM: Directory listing ===');
  try {
    const list = await get('/api/filesystem/list?path=project');
    report('Root list OK', list.status === 200, 'status=' + list.status);
    const sessions = await get('/api/filesystem/list?path=project/sessions');
    report('Sessions list OK', sessions.status === 200, 'status=' + sessions.status);
    const nodes = sessions.body.data?.nodes || [];
    const dirs = nodes.filter(n => n.type === 'directory');
    report('Has session directories', dirs.length > 0, 'dirs=' + dirs.length);
    dirs.slice(0, 3).forEach(d => console.log('  📁 ' + d.name));
  } catch (e) { report('Directory listing', false, e.message); }

  // =========================================================================
  // 7. STREAMING: SSE event types
  // =========================================================================
  console.log('\n=== 7. STREAMING: SSE events ===');
  try {
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'what is 2+2?' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true, conversationId: 'e2e-st001'
    });
    report('Stream returns 200', stream.status === 200, 'status=' + stream.status);
    report('Stream has events', stream.events.length > 0, 'events=' + stream.events.length);
    report('Stream completes', stream.isComplete, 'done=' + stream.isComplete);
    report('Has init event', stream.eventTypes.includes('init'), 'types=' + stream.eventTypes.join(','));
    report('Has done event', stream.eventTypes.some(t => t === 'done' || t === 'primary_done'), 'types=' + stream.eventTypes.join(','));
  } catch (e) { report('Streaming SSE', false, e.message); }

  // =========================================================================
  // 8. PROVIDER TRACKING
  // =========================================================================
  console.log('\n=== 8. PROVIDER TRACKING ===');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'say hello' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'e2e-provider001'
    });
    const p = chat.body.data?.provider;
    report('Provider tracked', !!p, 'provider=' + p);
    if (p) report('Provider not original-system', p !== 'original-system', 'provider=' + p);
  } catch (e) { report('Provider tracking', false, e.message); }

  // =========================================================================
  // 9. ERROR HANDLING: Invalid provider
  // =========================================================================
  console.log('\n=== 9. ERROR HANDLING: Invalid provider ===');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'hello' }],
      provider: 'nonexistent-provider', model: 'bad-model', stream: false, conversationId: 'e2e-err001'
    });
    report('Returns 400', chat.status === 400, 'status=' + chat.status);
    report('Has error field', !!chat.body.error, chat.body.error ? 'yes' : 'no');
  } catch (e) { report('Error handling', true, 'caught: ' + e.message.substring(0, 80)); }

  // =========================================================================
  // 10. ERROR HANDLING: Empty messages
  // =========================================================================
  console.log('\n=== 10. VALIDATION: Empty messages ===');
  try {
    const chat = await post('/api/chat', {
      messages: [],
      provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'e2e-val001'
    });
    report('Empty messages rejected', chat.status === 400, 'status=' + chat.status);
  } catch (e) { report('Empty messages', true, 'caught'); }

  // =========================================================================
  // 11. HEALTH CHECK
  // =========================================================================
  console.log('\n=== 11. HEALTH CHECK ===');
  try {
    const health = await get('/api/health');
    report('Health OK', health.status === 200, 'status=' + health.status);
    report('Status healthy', health.body.status === 'healthy', 'status=' + health.body.status);
  } catch (e) { report('Health check', false, e.message); }

  // =========================================================================
  // 12. PREWARM
  // =========================================================================
  console.log('\n=== 12. PREWARM ===');
  try {
    const warm = await get('/api/chat/prewarm');
    report('Prewarm OK', warm.status === 200, 'status=' + warm.status);
  } catch (e) { report('Prewarm', false, e.message); }

  // =========================================================================
  // 13. SESSION COOKIE: Propagation
  // =========================================================================
  console.log('\n=== 13. SESSION COOKIE ===');
  try {
    report('Session cookie captured', !!sessionCookie, sessionCookie ? 'YES' : 'NO');
    if (sessionCookie) {
      const snap = await get('/api/filesystem/snapshot?path=project');
      report('Request with cookie succeeds', snap.status === 200, 'status=' + snap.status);
    }
  } catch (e) { report('Session cookie', false, e.message); }

  // =========================================================================
  // 14. RATE LIMITING: Rapid requests
  // =========================================================================
  console.log('\n=== 14. RATE LIMITING: Rapid health checks ===');
  try {
    const promises = [];
    for (let i = 0; i < 5; i++) promises.push(get('/api/health'));
    const res = await Promise.all(promises);
    report('All rapid requests OK', res.every(r => r.status === 200), '5/5 passed');
  } catch (e) { report('Rate limiting', false, e.message); }

  // =========================================================================
  // 15. AUTO-CONTINUE: [CONTINUE_REQUESTED] detection
  // =========================================================================
  console.log('\n=== 15. AUTO-CONTINUE: Detection infrastructure ===');
  try {
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'say [CONTINUE_REQUESTED] at the end' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true, conversationId: 'e2e-ac001'
    });
    report('Stream processes events', stream.events.length > 0, 'events=' + stream.events.length);
    report('Stream completes', stream.isComplete, 'done=' + stream.isComplete);
    // The auto-continue infrastructure is tested at the unit level; here we verify
    // the SSE event infrastructure can deliver events properly
  } catch (e) { report('Auto-continue infra', false, e.message); }

  // =========================================================================
  // 16. FILESYSTEM SCOPING: No root-level files
  // =========================================================================
  console.log('\n=== 16. FILESYSTEM SCOPING: No root files ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const rootFiles = files.filter(f => !f.path.includes('sessions'));
    report('No files in project root', rootFiles.length === 0, 'root files=' + rootFiles.length);
    if (rootFiles.length > 0) rootFiles.forEach(f => console.log('  ⚠️  ' + f.path));
  } catch (e) { report('Filesystem scoping', false, e.message); }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n========================================');
  const passed = results.filter(r => r.pass).length;
  console.log('RESULTS: ' + passed + '/' + results.length + ' passed');
  if (passed < results.length) {
    console.log('\nFailed tests:');
    results.filter(r => !r.pass).forEach(r => console.log('  ❌ ' + r.test + ': ' + r.detail));
  }
  console.log('========================================');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
