const http = require('http');

let sessionCookie = '';

function request(method, url, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const isPost = method === 'POST';
    const data = isPost ? JSON.stringify(body) : undefined;
    const reqOpts = { hostname: 'localhost', port: 3000, path: url, method, timeout: timeoutMs, headers: {} };
    if (isPost) { reqOpts.headers['Content-Type'] = 'application/json'; reqOpts.headers['Content-Length'] = Buffer.byteLength(data); }
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) { const a = sc.find(c => c.includes('anon-session-id')); if (a) sessionCookie = a.split(';')[0]; }
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch(e) { reject(new Error('Parse: ' + e.message)); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isPost) req.write(data);
    req.end();
  });
}

function streamTest(url, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const reqOpts = { hostname: 'localhost', port: 3000, path: url, method: 'POST', timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Accept': 'text/event-stream' } };
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) { const a = sc.find(c => c.includes('anon-session-id')); if (a) sessionCookie = a.split(';')[0]; }
      const chunks = [];
      let content = '';
      let done = false;
      const timer = setTimeout(() => { req.destroy(); reject(new Error('Stream timeout after ' + timeoutMs + 'ms')); }, timeoutMs);
      res.on('data', c => {
        chunks.push(c.toString());
        const text = c.toString();
        // Parse SSE events more robustly
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('event: ')) {
            const event = lines[i].slice(7).trim();
            if (i + 1 < lines.length && lines[i + 1].startsWith('data: ')) {
              try {
                const parsed = JSON.parse(lines[i + 1].slice(6));
                if (parsed.content) content += parsed.content;
                if (event === 'done' || parsed.finishReason) done = true;
              } catch(e) {}
            }
          }
          // Also catch token events
          if (lines[i].startsWith('data: ') && lines[i].slice(6).trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(lines[i].slice(6));
              if (parsed.content && !lines[i-1]?.startsWith('event: ')) content += parsed.content;
              if (parsed.type === 'done' || parsed.finishReason) done = true;
            } catch(e) {}
          }
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, content, done, chunks: chunks.length });
      });
      req.on('error', e => { clearTimeout(timer); reject(e); });
    });
    req.write(data);
    req.end();
  });
}

const post = (url, body, t) => request('POST', url, body, t);
const get = (url, t) => request('GET', url, undefined, t);

async function main() {
  const results = [];
  function report(test, pass, detail) {
    results.push({ test, pass, detail });
    console.log((pass ? 'PASS' : 'FAIL') + ' | ' + test + (detail ? ' | ' + detail : ''));
  }

  // TEST 1: Streaming response
  console.log('\n=== TEST 1: Streaming response ===');
  try {
    const stream = await streamTest('/api/chat', {
      messages: [{ role: 'user', content: 'create stream-test.py with content print("hello streaming")' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true, conversationId: 'adv001'
    });
    report('Stream returns 200', stream.status === 200, 'status=' + stream.status);
    report('Stream has content', stream.content.length > 0, 'len=' + stream.content.length);
    report('Stream completed', stream.done, 'done=' + stream.done);
    console.log('  Chunks received: ' + stream.chunks);
  } catch (e) { report('Stream request', false, e.message); }

  await new Promise(r => setTimeout(r, 5000));

  // TEST 2: File created by stream
  console.log('\n=== TEST 2: File created via stream ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const streamFile = files.find(f => f.path.includes('stream-test'));
    report('Stream-created file exists', !!streamFile, streamFile ? streamFile.path : 'not found');
  } catch (e) { report('Stream file check', false, e.message); }

  // TEST 3: MCP endpoint
  console.log('\n=== TEST 3: MCP tools endpoint ===');
  try {
    const mcpList = await post('/api/mcp', { jsonrpc: '2.0', method: 'tools/list', id: 1 });
    report('MCP tools list OK', mcpList.status === 200, 'status=' + mcpList.status);
    const tools = mcpList.body.result?.tools || [];
    report('MCP has write_file tool', tools.some(t => t.name === 'write_file'), 'tools=' + tools.length);
  } catch (e) { report('MCP list', false, e.message); }

  // TEST 4: Pre-warm endpoint
  console.log('\n=== TEST 4: Chat prewarm ===');
  try {
    const warm = await get('/api/chat/prewarm');
    report('Prewarm returns 200', warm.status === 200, 'status=' + warm.status);
  } catch (e) { report('Prewarm', false, e.message); }

  // TEST 5: Fallback provider tracking
  console.log('\n=== TEST 5: Fallback provider tracking ===');
  try {
    // Request with nvidia which will likely fail, should fallback to mistral/openrouter
    const fb = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create fallback-test.txt with content fallback worked' }],
      provider: 'nvidia', model: 'nvidia/nemotron-3-nano-30b-a3b', stream: false, conversationId: 'adv002'
    });
    const p = fb.body.data?.provider;
    report('Fallback provider tracked (not original-system)', p && p !== 'original-system', 'provider=' + p);
    report('Fallback response has content', (fb.body.data?.content?.length || 0) > 0, 'len=' + (fb.body.data?.content?.length || 0));
  } catch (e) { report('Fallback test', false, e.message); }

  // TEST 6: Filesystem list sessions
  console.log('\n=== TEST 6: Session directory listing ===');
  try {
    const list = await get('/api/filesystem/list?path=project/sessions');
    report('Sessions list OK', list.status === 200, 'status=' + list.status);
    const nodes = list.body.data?.nodes || [];
    report('Has session directories', nodes.some(n => n.type === 'directory'), 'count=' + nodes.length);
    nodes.filter(n => n.type === 'directory').slice(0, 5).forEach(n => console.log('  📁 ' + n.name));
  } catch (e) { report('Session list', false, e.message); }

  // TEST 7: Multiple file operations in sequence
  console.log('\n=== TEST 7: Multiple sequential file operations ===');
  try {
    const fileNames = ['multi-a.txt', 'multi-b.txt', 'multi-c.txt'];
    let created = 0;
    for (const f of fileNames) {
      try {
        const r = await post('/api/chat', {
          messages: [{ role: 'user', content: 'write_file("' + f + '", "content of ' + f + '")' }],
          provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'adv003'
        });
        if (r.status === 200 && r.body.data?.content) created++;
        await new Promise(r => setTimeout(r, 3000));
      } catch(e) { /* rate limit, skip */ }
    }
    await new Promise(r => setTimeout(r, 3000));
    const snap = await get('/api/filesystem/snapshot?path=project');
    const found = (snap.body.data?.files || []).filter(f => f.path.includes('multi-'));
    report('Files created (' + created + ' requests, ' + found.length + ' on disk)', found.length >= 1, 'created=' + created + ' found=' + found.length);
    found.forEach(f => console.log('  📄 ' + f.path + ' v' + f.version));
  } catch (e) { report('Multiple files', false, e.message); }

  // Summary
  console.log('\n========================================');
  const passed = results.filter(r => r.pass).length;
  console.log('RESULTS: ' + passed + '/' + results.length + ' passed');
  results.filter(r => !r.pass).forEach(r => console.log('  ❌ ' + r.test + ': ' + r.detail));
  console.log('========================================');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
