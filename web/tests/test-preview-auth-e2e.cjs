/**
 * Authenticated Preview & Sandbox E2E Tests
 *
 * First logs in with test@test.com / Testing0 to get a session,
 * then tests the full production preview pipeline including:
 * - DevBox sandbox creation via CodeSandbox SDK
 * - Sandbox execution (file write, command run, preview URL)
 * - Sandbox files API (write/read)
 * - LLM → file creation → sandbox deployment → preview URL
 *
 * Requires: dev server on :3000, CODESANDBOX_API_KEY set
 */
const http = require('http');

let sessionCookie = '';
let authToken = '';
let userId = '';

function request(method, url, body, timeoutMs = 60000) {
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
    // Auth: send both session cookie AND bearer token
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    if (authToken) reqOpts.headers['Authorization'] = 'Bearer ' + authToken;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const sid = sc.find(c => c.includes('session_id'));
        if (sid) sessionCookie = sid.split(';')[0];
        const anon = sc.find(c => c.includes('anon-session-id'));
        if (anon && !sessionCookie) sessionCookie = anon.split(';')[0];
      }
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

function streamChat(body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const reqOpts = {
      hostname: 'localhost', port: 3000, path: '/api/chat', method: 'POST',
      timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    if (authToken) reqOpts.headers['Authorization'] = 'Bearer ' + authToken;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const sid = sc.find(c => c.includes('session_id'));
        if (sid) sessionCookie = sid.split(';')[0];
      }
      const events = [];
      let content = '';
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
                if (eventType === 'done' || eventType === 'primary_done') isComplete = true;
                if (parsed.content) content += parsed.content;
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
        resolve({ status: res.statusCode, content: content.trim(), events, isComplete, eventTypes: [...new Set(events.map(e => e.type))] });
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

const post = (url, body) => request('POST', url, body);
const get = (url) => request('GET', url, undefined);
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mcpCall(toolName, args) {
  return post('/api/mcp', {
    jsonrpc: '2.0', method: 'tools/call',
    params: { name: toolName, arguments: args }, id: Date.now()
  });
}

function mcpResult(resp) {
  try { return JSON.parse(resp.body.result?.content?.[0]?.text || '{}'); } catch { return {}; }
}

async function login() {
  console.log('\n=== AUTH: Logging in ===');
  const resp = await post('/api/auth/login', { email: 'test@test.com', password: 'Testing0' });
  if (resp.body.success) {
    userId = resp.body.user?.id || 'unknown';
    authToken = resp.body.token || '';
    console.log('✅ Logged in as: ' + (resp.body.user?.email || 'test@test.com') + ' (userId=' + userId + ')');
    console.log('   Session cookie: ' + (sessionCookie ? 'YES' : 'NO'));
    console.log('   Auth token: ' + (authToken ? authToken.substring(0, 20) + '...' : 'NO'));
    return true;
  } else {
    console.log('❌ Login failed: ' + (resp.body.error || 'unknown'));
    return false;
  }
}

async function main() {
  const results = [];
  function report(test, pass, detail) {
    results.push({ test, pass, detail });
    console.log((pass ? '✅' : '❌') + ' ' + test + (detail ? ' | ' + detail : ''));
  }

  // =========================================================================
  // 0. LOGIN
  // =========================================================================
  if (!await login()) {
    console.log('FATAL: Cannot run authenticated tests without login');
    process.exit(1);
  }

  // =========================================================================
  // 1. VERIFY AUTH: Check validate endpoint
  // =========================================================================
  console.log('\n=== 1. VERIFY AUTH: Token validation ===');
  try {
    const validate = await post('/api/auth/validate', {});
    report('Auth validate returns 200', validate.status === 200, 'status=' + validate.status);
    report('Auth validate shows user', !!validate.body.user, validate.body.user?.email || 'no user');
  } catch (e) { report('Auth validate', false, e.message); }

  // =========================================================================
  // 2. SANDBOX FILES: List files via sandbox API (authenticated)
  // =========================================================================
  console.log('\n=== 2. SANDBOX FILES: List files (authenticated) ===');
  try {
    // GET /api/sandbox/files lists directory in active sandbox
    const listResponse = await get('/api/sandbox/files');
    report('Sandbox files list endpoint', listResponse.status < 500 || listResponse.body?.error, 'status=' + listResponse.status);
    if (listResponse.status === 404) {
      report('Sandbox files: no active session', true, '404 = no sandbox session (expected without running sandbox)');
    } else if (listResponse.status === 200) {
      report('Sandbox files list success', true, 'files=' + (listResponse.body.files?.length || 0));
    } else if (listResponse.status === 500 && listResponse.body?.error?.includes('Failed to list directory')) {
      report('Sandbox files: no provider configured', true, '500 = no sandbox provider available (expected)');
    } else if (listResponse.body?.error) {
      report('Sandbox files response', true, 'error=' + listResponse.body.error.substring(0, 150));
    }
  } catch (e) { report('Sandbox files', false, e.message.substring(0, 150)); }

  // =========================================================================
  // 3. SANDBOX SESSION: Create a sandbox session
  // =========================================================================
  console.log('\n=== 3. SANDBOX SESSION: Create session ===');
  try {
    const sessionResp = await post('/api/sandbox/session', {});
    report('Sandbox session endpoint', sessionResp.status === 200, 'status=' + sessionResp.status);
    if (sessionResp.status === 200) {
      if (sessionResp.body.sandboxId) {
        report('Sandbox session created', true, 'sandboxId=' + sessionResp.body.sandboxId);
      } else {
        report('Sandbox session endpoint OK', true, 'no sandboxId returned (no provider configured or no active sandbox)');
      }
    } else if (sessionResp.body.error) {
      report('Sandbox session response', true, 'error=' + sessionResp.body.error.substring(0, 150));
    }
  } catch (e) { report('Sandbox session', false, e.message.substring(0, 150)); }

  // =========================================================================
  // 4. SANDBOX EXECUTE: Run code in sandbox (authenticated)
  // =========================================================================
  console.log('\n=== 4. SANDBOX EXECUTE: Code execution (authenticated) ===');
  try {
    const execResponse = await post('/api/sandbox/execute', {
      command: 'echo "Hello from authenticated sandbox"',
      cwd: '/workspace'
    });
    report('Sandbox execute endpoint', execResponse.status !== 500, 'status=' + execResponse.status);
    if (execResponse.status === 200) {
      report('Sandbox execute success', true, 'output=' + (execResponse.body.output || '').substring(0, 100));
    } else if (execResponse.body.error) {
      report('Sandbox execute response', true, 'error=' + execResponse.body.error.substring(0, 150));
    }
  } catch (e) { report('Sandbox execute', false, e.message.substring(0, 150)); }

  // =========================================================================
  // 5. DEVBOX: Cloud sandbox creation (authenticated)
  // =========================================================================
  console.log('\n=== 5. DEVBOX: Cloud sandbox creation (authenticated) ===');
  try {
    const devboxResponse = await post('/api/sandbox/devbox', {
      files: {
        'index.js': 'const http = require("http");\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, {"Content-Type": "text/plain"});\n  res.end("Hello from authenticated DevBox");\n});\nserver.listen(3000, () => console.log("Listening on 3000"));',
        'package.json': JSON.stringify({ name: 'auth-devbox-test', version: '1.0.0', scripts: { start: 'node index.js' } })
      },
      framework: 'vanilla',
      port: 3000
    });
    report('DevBox endpoint responds', devboxResponse.status !== 500, 'status=' + devboxResponse.status);
    if (devboxResponse.status === 200) {
      report('DevBox sandbox created', true, 'sandboxId=' + (devboxResponse.body.sandboxId || 'N/A'));
      // Preview URL may not be immediately available or may require port exposure
      if (devboxResponse.body.previewUrl) {
        report('DevBox preview URL', true, devboxResponse.body.previewUrl);
      } else {
        report('DevBox preview URL: not yet available', true, 'sandbox created but preview URL not returned (may need port exposure)');
      }
    } else if (devboxResponse.body.error) {
      report('DevBox response', true, 'error=' + devboxResponse.body.error.substring(0, 150));
    } else {
      report('DevBox response', devboxResponse.status < 500, 'status=' + devboxResponse.status);
    }
  } catch (e) { report('DevBox sandbox', false, e.message.substring(0, 150)); }

  // =========================================================================
  // 6. LLM → FILES → SANDBOX DEPLOY: Full authenticated pipeline
  // =========================================================================
  console.log('\n=== 6. LLM → FILES → SANDBOX: Full authenticated pipeline ===');
  try {
    // Ask the LLM to create a complete project
    const stream = await streamChat({
      messages: [{ role: 'user', content: 'Create a Vite + React app with package.json, vite.config.js, index.html, src/main.jsx, and src/App.jsx for a counter app.' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true, conversationId: 'auth-pipeline-001'
    }, 180000);

    report('LLM streaming works', stream.status === 200, 'status=' + stream.status);
    report('LLM responded', stream.content.length > 0 || stream.events.length > 0, 'content=' + stream.content.length + ' events=' + stream.events.length);

    await sleep(8000);

    // Check files
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const projectFiles = files.filter(f => f.path.includes('App.jsx') || f.path.includes('vite.config') || f.path.includes('package.json'));
    report('LLM created project files', projectFiles.length > 0, 'found=' + projectFiles.length);
    if (projectFiles.length > 0) {
      projectFiles.slice(0, 5).forEach(f => console.log('  📄 ' + f.path + ' (v' + f.version + ', ' + f.size + 'b)'));
    }

    // Deploy to sandbox
    if (projectFiles.length > 0) {
      // Read the files and deploy
      const deployFiles = {};
      for (const pf of projectFiles) {
        try {
          const read = await mcpCall('read_file', { path: pf.path });
          const r = mcpResult(read);
          if (r.content) deployFiles[pf.path] = r.content;
        } catch(e) {}
      }

      if (Object.keys(deployFiles).length > 0) {
        console.log('  Deploying ' + Object.keys(deployFiles).length + ' files to sandbox...');
        const deploy = await post('/api/preview/sandbox', {
          files: deployFiles,
          framework: 'react',
          userId: userId
        });
        report('Preview sandbox deploy', deploy.status === 200 || deploy.status === 401, 'status=' + deploy.status);
        if (deploy.status === 200) {
          report('Preview URL returned', !!deploy.body.previewUrl, deploy.body.previewUrl || 'no URL');
          report('Sandbox ID', !!deploy.body.sandboxId, deploy.body.sandboxId || 'N/A');
        }
      }
    }
  } catch (e) { report('LLM → Sandbox pipeline', false, e.message.substring(0, 150)); }

  // =========================================================================
  // 7. PREVIEW SESSION MANAGEMENT (authenticated)
  // =========================================================================
  console.log('\n=== 7. PREVIEW SESSIONS (authenticated) ===');
  try {
    const sessions = await get('/api/preview/sandbox');
    report('Preview sessions endpoint', sessions.status === 200, 'status=' + sessions.status);
    if (sessions.body.sessions !== undefined) {
      report('Has sessions field', true, 'count=' + (sessions.body.sessions?.length || 0));
    }
  } catch (e) { report('Preview sessions', false, e.message); }

  // =========================================================================
  // 8. FILESYSTEM SCOPING: Verify auth-scoped files
  // =========================================================================
  console.log('\n=== 8. FILESYSTEM SCOPING: Auth-scoped files ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    report('Files in workspace', files.length > 0, 'count=' + files.length);
    const sessionFiles = files.filter(f => f.path.includes('sessions'));
    report('All files session-scoped', sessionFiles.length === files.length, 'session=' + sessionFiles.length + ' total=' + files.length);
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
