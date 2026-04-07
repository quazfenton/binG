const http = require('http');

let sessionCookie = '';

function request(method, url, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const isPost = method === 'POST';
    const data = isPost ? JSON.stringify(body) : undefined;
    const reqOpts = {
      hostname: 'localhost',
      port: 3000,
      path: url,
      method,
      timeout: timeoutMs,
      headers: {}
    };
    if (isPost) {
      reqOpts.headers['Content-Type'] = 'application/json';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;

    const req = http.request(reqOpts, res => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const anon = setCookie.find(c => c.includes('anon-session-id'));
        if (anon) sessionCookie = anon.split(';')[0];
      }
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch(e) { reject(new Error('Parse: ' + e.message + ' | ' + b.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isPost) req.write(data);
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

  // TEST 1: Chat with file creation
  console.log('\n=== TEST 1: Chat with tool call ===');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create e2e-test.js with content console.log("e2e")' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'e2e001'
    });
    report('Chat status 200', chat.status === 200, 'status=' + chat.status);
    report('Provider tracked correctly', chat.body.data?.provider && chat.body.data.provider !== 'original-system', 'provider=' + chat.body.data?.provider);
    report('Has response content', (chat.body.data?.content?.length || 0) > 0, 'len=' + (chat.body.data?.content?.length || 0));
    console.log('  Cookie captured: ' + (sessionCookie ? 'YES' : 'NO'));
  } catch (e) { report('Chat request', false, e.message); }

  await new Promise(r => setTimeout(r, 5000));

  // TEST 2: Filesystem snapshot (same session)
  console.log('\n=== TEST 2: Filesystem snapshot ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const fileCount = snap.body.data?.files?.length || 0;
    report('Snapshot returns files', fileCount > 0, 'count=' + fileCount);
    if (fileCount > 0) {
      const testFile = snap.body.data.files.find(f => f.path.includes('e2e-test'));
      report('Written file found in snapshot', !!testFile, testFile ? testFile.path : 'not found');
    }
    (snap.body.data?.files || []).forEach(f => console.log('  📄 ' + f.path + ' v' + f.version + ' (' + f.size + 'b)'));
  } catch (e) { report('Snapshot', false, e.message); }

  // TEST 3: Filesystem list
  console.log('\n=== TEST 3: Filesystem list ===');
  try {
    const list = await get('/api/filesystem/list?path=project');
    report('List returns OK', list.status === 200, 'status=' + list.status);
    (list.body.data?.nodes || []).forEach(n => console.log('  📁 ' + n.name + ' (' + n.type + ')'));
  } catch (e) { report('List', false, e.message); }

  // TEST 4: Provider tracking (second request)
  console.log('\n=== TEST 4: Provider tracking verification ===');
  try {
    const chat2 = await post('/api/chat', {
      messages: [{ role: 'user', content: 'list files' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'e2e002'
    });
    const p = chat2.body.data?.provider;
    report('Provider NOT "original-system"', p !== 'original-system' && !!p, 'provider=' + p);
  } catch (e) { report('Provider tracking', false, e.message); }

  // TEST 5: Simple chat
  console.log('\n=== TEST 5: Simple chat (no tools) ===');
  try {
    const chat3 = await post('/api/chat', {
      messages: [{ role: 'user', content: 'say hello' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false, conversationId: 'e2e003'
    });
    report('Simple chat OK', chat3.status === 200, 'status=' + chat3.status);
    report('Has content', (chat3.body.data?.content?.length || 0) > 0, 'len=' + (chat3.body.data?.content?.length || 0));
  } catch (e) { report('Simple chat', false, e.message); }

  // TEST 6: Error handling
  console.log('\n=== TEST 6: Error handling ===');
  try {
    const chat4 = await post('/api/chat', {
      messages: [{ role: 'user', content: 'hello' }],
      provider: 'nonexistent-provider', model: 'bad-model', stream: false, conversationId: 'e2e004'
    });
    report('Invalid provider returns error status', chat4.status !== 200 || !!chat4.body.error, 'status=' + chat4.status);
  } catch (e) { report('Invalid provider caught', true, e.message.substring(0, 100)); }

  // Summary
  console.log('\n========================================');
  const passed = results.filter(r => r.pass).length;
  console.log('RESULTS: ' + passed + '/' + results.length + ' passed');
  results.filter(r => !r.pass).forEach(r => console.log('  ❌ ' + r.test + ': ' + r.detail));
  console.log('========================================');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
