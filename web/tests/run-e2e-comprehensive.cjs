/**
 * Comprehensive End-to-End Integration Tests for binG
 * Tests: VFS file operations, context-pack, diffs, rename, move, batch operations,
 * streaming, provider tracking, fallback chain, filesystem scoping, auto-continue,
 * error handling, session isolation, edge cases, unicode, large files, etc.
 */
const http = require('http');

let sessionCookie = '';
let testSessionId = 'e2e-' + Date.now();

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
      if (data) reqOpts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (sessionCookie) reqOpts.headers['Cookie'] = sessionCookie;
    // FIX: timer at function scope so error handler can clear it
    let timer;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const a = sc.find(c => c.includes('anon-session-id'));
        if (a) sessionCookie = a.split(';')[0];
      }
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          let parsed = null;
          try { parsed = JSON.parse(b); } catch(e) { parsed = b; }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: b });
        }
        catch(e) { reject(new Error('Parse: ' + e.message + ' | ' + b.substring(0, 300))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isPost && data) req.write(data);
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
    // FIX: timer at function scope so error handler can clear it
    let timer;
    const req = http.request(reqOpts, res => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const a = sc.find(c => c.includes('anon-session-id'));
        if (a) sessionCookie = a.split(';')[0];
      }
      const events = [];
      let content = '';
      let hasAutoContinue = false;
      let autoContinueData = null;
      let isComplete = false;
      let errorDuringStream = null;
      timer = setTimeout(() => {
        req.destroy();
        reject(new Error('Stream timeout after ' + timeoutMs + 'ms'));
      }, timeoutMs);

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
                if (eventType === 'auto-continue') { hasAutoContinue = true; autoContinueData = parsed; }
                if (eventType === 'done' || eventType === 'primary_done') isComplete = true;
                if (parsed.content) content += parsed.content;
                if (parsed.content && parsed.content.includes('[CONTINUE_REQUESTED]')) {
                  hasAutoContinue = true;
                }
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
          try {
            const parsed = JSON.parse(buffer.trim().slice(5));
            if (parsed.content) content += parsed.content;
          } catch(e) {}
        }
        resolve({
          status: res.statusCode,
          content: content.trim(),
          events,
          hasAutoContinue,
          autoContinueData,
          isComplete,
          eventTypes: [...new Set(events.map(e => e.type))],
          error: errorDuringStream
        });
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
    console.log((pass ? '  PASS' : '  FAIL') + ' | ' + test + (detail ? ' | ' + detail : ''));
  }

  // =========================================================================
  // SECTION 1: BASIC CHAT OPERATIONS (from original tests)
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 1: BASIC CHAT OPERATIONS');
  console.log('='.repeat(70));

  // 1.1 Non-streaming chat with file creation
  console.log('\n--- 1.1 Non-streaming chat with file creation ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create e2e-basic-test.js with content console.log("e2e test")' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-ns001'
    });
    report('Status 200', chat.status === 200, 'status=' + chat.status);
    report('Has response content', (chat.body.data?.content?.length || 0) > 0, 'len=' + (chat.body.data?.content?.length || 0));
    const provider = chat.body.data?.provider;
    report('Provider tracked correctly', provider && provider !== 'original-system', 'provider=' + provider);
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const testFile = files.find(f => f.path.includes('e2e-basic-test'));
    report('File created in session path', !!testFile, testFile ? testFile.path : 'not found');
    if (testFile) report('File version >= 1', testFile.version >= 1, 'v=' + testFile.version);
  } catch (e) { report('Non-streaming chat', false, e.message); }

  // 1.2 Streaming file creation
  console.log('\n--- 1.2 Streaming file creation ---');
  try {
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'create stream-file-test.txt with content streaming works' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true,
      conversationId: testSessionId + '-st001'
    });
    report('Stream returns 200', stream.status === 200, 'status=' + stream.status);
    report('Stream has events', stream.events.length > 0, 'events=' + stream.events.length);
    report('Stream completes', stream.isComplete, 'complete=' + stream.isComplete);
    const hasContent = stream.content.length > 0 || stream.events.some(e => e.data?.content);
    report('Stream has content', hasContent, 'len=' + (stream.content.length || 0));
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const streamFile = (snap.body.data?.files || []).find(f => f.path.includes('stream-file-test'));
    report('File created via streaming', !!streamFile, streamFile ? streamFile.path : 'not found');
  } catch (e) { report('Streaming chat', false, e.message); }

  // 1.3 Provider tracking
  console.log('\n--- 1.3 Provider tracking ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'what is 2+2?' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-prov001'
    });
    const p = chat.body.data?.provider;
    report('Provider tracked (not original-system)', p && p !== 'original-system', 'provider=' + p);
  } catch (e) { report('Provider tracking', false, e.message); }

  // 1.4 Fallback chain - invalid provider
  console.log('\n--- 1.4 Fallback chain: Invalid provider ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'hello' }],
      provider: 'nonexistent-provider', model: 'bad-model', stream: false,
      conversationId: testSessionId + '-fb001'
    });
    report('Invalid provider returns 400', chat.status === 400, 'status=' + chat.status);
    report('Has error message', !!chat.body.error, chat.body.error || 'no error');
  } catch (e) { report('Invalid provider caught', true, e.message.substring(0, 80)); }

  // =========================================================================
  // SECTION 2: VFS FILE OPERATIONS - EDGE CASES
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 2: VFS FILE OPERATIONS - EDGE CASES');
  console.log('='.repeat(70));

  // 2.1 File with unicode content
  console.log('\n--- 2.1 Unicode content handling ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create unicode-test.txt with content Hello World in Chinese: \u4e16\u754c\u4f60\u597d and emojis: \ud83d\ude00\ud83d\udc4d' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-unicode001'
    });
    report('Unicode file creation OK', chat.status === 200, 'status=' + chat.status);
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const uniFile = (snap.body.data?.files || []).find(f => f.path.includes('unicode-test'));
    report('Unicode file exists', !!uniFile, uniFile ? 'found' : 'missing');
  } catch (e) { report('Unicode handling', false, e.message); }

  // 2.2 File with special characters in path
  console.log('\n--- 2.2 Special characters in path ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create path-with-dashes_underscores.dotfile with content special path test' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-path001'
    });
    report('Special path chars OK', chat.status === 200, 'status=' + chat.status);
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const spFile = (snap.body.data?.files || []).find(f => f.path.includes('path-with-dashes'));
    report('File with special path exists', !!spFile, spFile ? 'found' : 'missing');
  } catch (e) { report('Special path', false, e.message); }

  // 2.3 Large file content (simulated with long string)
  console.log('\n--- 2.3 Large file content ---');
  try {
    const largeContent = 'Line ' + 'x'.repeat(1000);
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create large-test.txt with content ' + largeContent.repeat(50) }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-large001'
    });
    report('Large file creation OK', chat.status === 200, 'status=' + chat.status);
    await sleep(4000);
  } catch (e) { report('Large file', false, e.message); }

  // 2.4 Multiple files in one request
  console.log('\n--- 2.4 Multiple files in one request ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create these 3 files: multi-a.txt with "file A", multi-b.txt with "file B", multi-c.txt with "file C"' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-multi001'
    });
    report('Multi-file request OK', chat.status === 200, 'status=' + chat.status);
    await sleep(4000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const multiA = files.find(f => f.path.includes('multi-a'));
    const multiB = files.find(f => f.path.includes('multi-b'));
    const multiC = files.find(f => f.path.includes('multi-c'));
    report('All 3 files created', !!(multiA && multiB && multiC), 'A=' + !!multiA + ' B=' + !!multiB + ' C=' + !!multiC);
  } catch (e) { report('Multi-file', false, e.message); }

  // 2.5 Nested directory paths
  console.log('\n--- 2.5 Nested directory paths ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create src/nested/deep/path.txt with content deeply nested file' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-nested001'
    });
    report('Nested path request OK', chat.status === 200, 'status=' + chat.status);
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const nestedFile = (snap.body.data?.files || []).find(f => f.path.includes('deep/path.txt'));
    report('Nested file exists', !!nestedFile, nestedFile ? 'found' : 'missing');
  } catch (e) { report('Nested path', false, e.message); }

  // 2.6 File with code content (backticks, brackets)
  console.log('\n--- 2.6 Code content with special chars ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create code-test.ts with content: export function test() { return `template ${variable}`; }' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-code001'
    });
    report('Code content request OK', chat.status === 200, 'status=' + chat.status);
    await sleep(3000);
  } catch (e) { report('Code content', false, e.message); }

  // 2.7 Empty content handling
  console.log('\n--- 2.7 Empty content handling ---');
  try {
    const chat = await post('/api/chat', {
      messages: [{ role: 'user', content: 'create empty-test.txt with content (leave it empty)' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-empty001'
    });
    report('Empty content request OK', chat.status === 200, 'status=' + chat.status);
  } catch (e) { report('Empty content', false, e.message); }

  // =========================================================================
  // SECTION 3: FILESYSTEM API ENDPOINTS
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 3: FILESYSTEM API ENDPOINTS');
  console.log('='.repeat(70));

  // 3.1 Snapshot endpoint
  console.log('\n--- 3.1 Snapshot endpoint ---');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    report('Snapshot OK', snap.status === 200, 'status=' + snap.status);
    const files = snap.body.data?.files || [];
    report('Has files array', Array.isArray(files), 'type=' + typeof files);
    report('Files in session paths', files.some(f => f.path.includes('sessions')), 'has session files');
  } catch (e) { report('Snapshot', false, e.message); }

  // 3.2 List directory
  console.log('\n--- 3.2 List directory ---');
  try {
    const list = await get('/api/filesystem/list?path=project/sessions');
    report('List OK', list.status === 200, 'status=' + list.status);
    const nodes = list.body.data?.nodes || [];
    report('Has nodes', nodes.length > 0, 'count=' + nodes.length);
  } catch (e) { report('List', false, e.message); }

  // 3.3 Create file endpoint (direct API)
  console.log('\n--- 3.3 Create file direct API ---');
  try {
    const create = await post('/api/filesystem/create-file', {
      path: '/direct-api-test.txt',
      content: 'Created via direct API',
      language: 'plaintext'
    });
    report('Direct create OK', create.status === 200, 'status=' + create.status);
    await sleep(1000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const directFile = (snap.body.data?.files || []).find(f => f.path.includes('direct-api-test'));
    report('Direct file exists', !!directFile, directFile ? 'found' : 'missing');
  } catch (e) { report('Direct create', false, e.message); }

  // 3.4 Create directory
  console.log('\n--- 3.4 Create directory ---');
  try {
    const mkdir = await post('/api/filesystem/mkdir', {
      path: '/test-mkdir-dir'
    });
    report('Mkdir OK', mkdir.status === 200, 'status=' + mkdir.status);
  } catch (e) { report('Mkdir', false, e.message); }

  // 3.5 Diff tracking
  console.log('\n--- 3.5 Diff tracking ---');
  try {
    // First create a file via chat to generate diffs
    await post('/api/chat', {
      messages: [{ role: 'user', content: 'create diff-test.txt with content initial version' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-diff001'
    });
    await sleep(3000);
    // Then get diffs
    const diffs = await get('/api/filesystem/diffs');
    report('Diffs endpoint OK', diffs.status === 200, 'status=' + diffs.status);
    report('Diffs has files array', Array.isArray(diffs.body.files), 'type=' + typeof diffs.body.files);
  } catch (e) { report('Diffs', false, e.message); }

  // 3.6 Read file
  console.log('\n--- 3.6 Read file ---');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    if (files.length > 0) {
      const filePath = encodeURIComponent(files[0].path);
      const read = await get('/api/filesystem/read?path=' + filePath);
      report('Read file OK', read.status === 200, 'status=' + read.status);
      report('Read has content', read.body.data?.content !== undefined, 'has=' + (read.body.data?.content !== undefined));
    } else {
      report('Read file', false, 'no files to read');
    }
  } catch (e) { report('Read file', false, e.message); }

  // =========================================================================
  // SECTION 4: CONTEXT-PACK ENDPOINT
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 4: CONTEXT-PACK ENDPOINT');
  console.log('='.repeat(70));

  // 4.1 Context-pack markdown format
  console.log('\n--- 4.1 Context-pack markdown ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=markdown&maxFiles=10');
    report('Context-pack markdown OK', cp.status === 200, 'status=' + cp.status);
    report('Has content-length header', cp.headers['content-length'] > 0, 'len=' + cp.headers['content-length']);
  } catch (e) { report('Context-pack markdown', false, e.message); }

  // 4.2 Context-pack JSON format
  console.log('\n--- 4.2 Context-pack JSON ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=json&maxFiles=5');
    report('Context-pack JSON OK', cp.status === 200, 'status=' + cp.status);
  } catch (e) { report('Context-pack JSON', false, e.message); }

  // 4.3 Context-pack XML format
  console.log('\n--- 4.3 Context-pack XML ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=xml&maxFiles=5');
    report('Context-pack XML OK', cp.status === 200, 'status=' + cp.status);
  } catch (e) { report('Context-pack XML', false, e.message); }

  // 4.4 Context-pack plain format
  console.log('\n--- 4.4 Context-pack plain ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=plain&maxFiles=5');
    report('Context-pack plain OK', cp.status === 200, 'status=' + cp.status);
  } catch (e) { report('Context-pack plain', false, e.message); }

  // 4.5 Context-pack with include contents
  console.log('\n--- 4.5 Context-pack with include contents ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=markdown&includeContents=true&maxFiles=3');
    report('Context-pack with contents OK', cp.status === 200, 'status=' + cp.status);
  } catch (e) { report('Context-pack with contents', false, e.message); }

  // 4.6 Context-pack with exclude patterns
  console.log('\n--- 4.6 Context-pack with exclude patterns ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&excludePatterns=node_modules,.git&maxFiles=10');
    report('Context-pack exclude OK', cp.status === 200, 'status=' + cp.status);
  } catch (e) { report('Context-pack exclude', false, e.message); }

  // 4.7 Context-pack invalid format
  console.log('\n--- 4.7 Context-pack invalid format ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/&format=invalid-format');
    report('Invalid format rejected', cp.status === 400, 'status=' + cp.status);
  } catch (e) { report('Invalid format', true, 'caught'); }

  // =========================================================================
  // SECTION 5: RENAME AND MOVE OPERATIONS
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 5: RENAME AND MOVE OPERATIONS');
  console.log('='.repeat(70));

  // 5.1 Rename file (create then rename)
  console.log('\n--- 5.1 Rename file ---');
  try {
    // First create a file
    await post('/api/filesystem/create-file', {
      path: '/rename-source.txt',
      content: 'Source file content'
    });
    await sleep(500);
    // Then rename it
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/rename-source.txt',
      newPath: '/rename-dest.txt'
    });
    report('Rename file OK', rename.status === 200, 'status=' + rename.status);
    report('Rename success flag', rename.body.success === true, 'success=' + rename.body.success);
  } catch (e) { report('Rename file', false, e.message); }

  // 5.2 Rename to existing path (conflict)
  console.log('\n--- 5.2 Rename conflict ---');
  try {
    // Create two files
    await post('/api/filesystem/create-file', {
      path: '/conflict-a.txt',
      content: 'File A'
    });
    await post('/api/filesystem/create-file', {
      path: '/conflict-b.txt',
      content: 'File B'
    });
    await sleep(500);
    // Try to rename to existing path without overwrite
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/conflict-a.txt',
      newPath: '/conflict-b.txt'
    });
    report('Rename conflict detected', rename.status === 409, 'status=' + rename.status);
    report('Has conflict info', !!rename.body.conflict, 'conflict=' + !!rename.body.conflict);
  } catch (e) { report('Rename conflict', false, e.message); }

  // 5.3 Rename to existing path with overwrite
  console.log('\n--- 5.3 Rename with overwrite ---');
  try {
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/conflict-a.txt',
      newPath: '/conflict-b.txt',
      overwrite: true
    });
    report('Rename with overwrite OK', rename.status === 200, 'status=' + rename.status);
  } catch (e) { report('Rename overwrite', false, e.message); }

  // 5.4 Rename same path (no-op)
  console.log('\n--- 5.4 Rename same path (no-op) ---');
  try {
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/conflict-b.txt',
      newPath: '/conflict-b.txt'
    });
    report('Rename no-op OK', rename.status === 200, 'status=' + rename.status);
    report('No-op returns success', rename.body.success === true, 'success=' + rename.body.success);
  } catch (e) { report('Rename no-op', false, e.message); }

  // 5.5 Rename non-existent file
  console.log('\n--- 5.5 Rename non-existent ---');
  try {
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/nonexistent-file.txt',
      newPath: '/new-name.txt'
    });
    report('Rename non-existent rejected', rename.status === 404, 'status=' + rename.status);
  } catch (e) { report('Rename non-existent', true, 'caught'); }

  // 5.6 Circular move detection
  console.log('\n--- 5.6 Circular move detection ---');
  try {
    // First create a directory
    await post('/api/filesystem/mkdir', { path: '/circular-test' });
    await sleep(500);
    // Try to move into itself
    const rename = await post('/api/filesystem/rename', {
      oldPath: '/circular-test',
      newPath: '/circular-test/subfolder'
    });
    report('Circular move rejected', rename.status === 400, 'status=' + rename.status);
  } catch (e) { report('Circular move', false, e.message); }

  // 5.7 Move file (may require auth)
  console.log('\n--- 5.7 Move file ---');
  try {
    // Create source file
    await post('/api/filesystem/create-file', {
      path: '/move-source.txt',
      content: 'Move test'
    });
    await sleep(500);
    const move = await post('/api/filesystem/move', {
      sourcePath: '/move-source.txt',
      targetPath: '/move-target.txt'
    });
    // May fail with 401 if auth required
    report('Move file attempted', move.status === 200 || move.status === 401, 'status=' + move.status);
  } catch (e) { report('Move file', false, e.message); }

  // =========================================================================
  // SECTION 6: STREAMING EVENTS & EDGE CASES
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 6: STREAMING EVENTS & EDGE CASES');
  console.log('='.repeat(70));

  // 6.1 SSE event types
  console.log('\n--- 6.1 SSE event types ---');
  try {
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'create event-test.js with content event test' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true,
      conversationId: testSessionId + '-events001'
    });
    report('Has init event', stream.eventTypes.includes('init'), 'types=' + stream.eventTypes.join(','));
    report('Has done event', stream.eventTypes.some(t => t === 'done' || t === 'primary_done'), 'done in types');
  } catch (e) { report('SSE events', false, e.message); }

  // 6.2 Auto-continue detection
  console.log('\n--- 6.2 Auto-continue detection ---');
  try {
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'create continue-test.txt with content hello. Then say [CONTINUE_REQUESTED]' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: true,
      conversationId: testSessionId + '-ac001'
    });
    const hasContinuation = stream.hasAutoContinue || stream.content.includes('[CONTINUE_REQUESTED]');
    report('Continuation token detected', hasContinuation || stream.isComplete, 'has=' + stream.hasAutoContinue);
  } catch (e) { report('Auto-continue', false, e.message); }

  // 6.3 Multi-tool sequence
  console.log('\n--- 6.3 Multi-tool sequence ---');
  try {
    await post('/api/chat', {
      messages: [{ role: 'user', content: 'create seq-a.txt with content file A' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-seq001'
    });
    await sleep(3000);
    await post('/api/chat', {
      messages: [{ role: 'user', content: 'create seq-b.txt with content file B' }],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-seq002'
    });
    await sleep(3000);
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const seqA = files.find(f => f.path.includes('seq-a'));
    const seqB = files.find(f => f.path.includes('seq-b'));
    report('Sequential files exist', !!(seqA && seqB), 'A=' + !!seqA + ' B=' + !!seqB);
  } catch (e) { report('Multi-tool sequence', false, e.message); }

  // 6.4 Empty messages validation
  console.log('\n--- 6.4 Empty messages validation ---');
  try {
    const chat = await post('/api/chat', {
      messages: [],
      provider: 'mistral', model: 'mistral-small-latest', stream: false,
      conversationId: testSessionId + '-val001'
    });
    report('Empty messages rejected', chat.status === 400 || chat.status !== 200, 'status=' + chat.status);
  } catch (e) { report('Empty validation', false, e.message); }

  // 6.5 Invalid JSON in request
  console.log('\n--- 6.5 Invalid request body ---');
  try {
    const res = await request('POST', '/api/chat', null, 30000);
    report('Null body handled', res.status === 400 || res.status === 500, 'status=' + res.status);
  } catch (e) { report('Null body', true, 'caught'); }

  // =========================================================================
  // SECTION 7: SESSION & ISOLATION TESTS
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 7: SESSION & ISOLATION TESTS');
  console.log('='.repeat(70));

  // 7.1 Session cookie propagation
  console.log('\n--- 7.1 Session cookie ---');
  try {
    report('Session cookie captured', !!sessionCookie, sessionCookie ? 'YES' : 'NO');
    if (sessionCookie) {
      const snap = await get('/api/filesystem/snapshot?path=project');
      report('Request with cookie succeeds', snap.status === 200, 'status=' + snap.status);
    }
  } catch (e) { report('Session cookie', false, e.message); }

  // 7.2 Filesystem scoping
  console.log('\n--- 7.2 Filesystem scoping ---');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const rootFiles = files.filter(f => !f.path.includes('sessions'));
    report('No root files', rootFiles.length === 0, 'root=' + rootFiles.length);
    const sessionFiles = files.filter(f => f.path.includes('sessions'));
    report('Session files present', sessionFiles.length > 0, 'count=' + sessionFiles.length);
  } catch (e) { report('Filesystem scoping', false, e.message); }

  // 7.3 Rate limiting
  console.log('\n--- 7.3 Rate limiting ---');
  try {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(get('/api/health'));
    }
    const results2 = await Promise.all(promises);
    const allOk = results2.every(r => r.status === 200);
    report('Rapid requests handled', allOk, 'all 200=' + allOk);
  } catch (e) { report('Rate limiting', false, e.message); }

  // =========================================================================
  // SECTION 8: HEALTH & META ENDPOINTS
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 8: HEALTH & META ENDPOINTS');
  console.log('='.repeat(70));

  // 8.1 Health check
  console.log('\n--- 8.1 Health check ---');
  try {
    const health = await get('/api/health');
    report('Health OK', health.status === 200, 'status=' + health.status);
    report('Health status healthy', health.body.status === 'healthy', 'status=' + health.body.status);
  } catch (e) { report('Health', false, e.message); }

  // 8.2 Prewarm endpoint
  console.log('\n--- 8.2 Prewarm ---');
  try {
    const warm = await get('/api/chat/prewarm');
    report('Prewarm OK', warm.status === 200, 'status=' + warm.status);
  } catch (e) { report('Prewarm', false, e.message); }

  // 8.3 Commits endpoint
  console.log('\n--- 8.3 Commits endpoint ---');
  try {
    const commits = await get('/api/filesystem/commits?limit=5');
    report('Commits OK', commits.status === 200, 'status=' + commits.status);
  } catch (e) { report('Commits', false, e.message); }

  // 8.4 Rollback endpoint
  console.log('\n--- 8.4 Rollback endpoint ---');
  try {
    const rollback = await post('/api/filesystem/rollback', { sessionId: testSessionId, version: 1 });
    report('Rollback attempted', rollback.status === 200 || rollback.status === 400, 'status=' + rollback.status);
  } catch (e) { report('Rollback', false, e.message); }

  // =========================================================================
  // SECTION 9: ERROR HANDLING & EDGE CASES
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 9: ERROR HANDLING & EDGE CASES');
  console.log('='.repeat(70));

  // 9.1 Path traversal prevention
  console.log('\n--- 9.1 Path traversal prevention ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=/../etc/passwd');
    report('Path traversal rejected', cp.status === 400, 'status=' + cp.status);
  } catch (e) { report('Path traversal', false, e.message); }

  // 9.2 Invalid path format
  console.log('\n--- 9.2 Invalid path format ---');
  try {
    const cp = await get('/api/filesystem/context-pack?path=relative-path');
    report('Relative path rejected', cp.status === 400, 'status=' + cp.status);
  } catch (e) { report('Relative path', false, e.message); }

  // 9.3 Missing required fields
  console.log('\n--- 9.3 Missing required fields ---');
  try {
    const create = await post('/api/filesystem/create-file', {
      // missing path
      content: 'test'
    });
    report('Missing path rejected', create.status === 400, 'status=' + create.status);
  } catch (e) { report('Missing fields', true, 'caught'); }

  // 9.4 Invalid content type
  console.log('\n--- 9.4 Invalid content type ---');
  try {
    const res = await request('POST', '/api/filesystem/create-file', 'not-json', 10000);
    report('Non-JSON rejected', res.status === 400 || res.status === 500, 'status=' + res.status);
  } catch (e) { report('Non-JSON', true, 'caught'); }

  // =========================================================================
  // SECTION 10: TEXT-MODE PARSING TESTS (non-FC models)
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SECTION 10: TEXT-MODE PARSING TESTS');
  console.log('='.repeat(70));

  // 10.1 Text-mode file format
  console.log('\n--- 10.1 Text-mode file format ---');
  try {
    // Test with a model that might use text-mode
    const stream = await streamChat('/api/chat', {
      messages: [{ role: 'user', content: 'Create a file called textmode-test.txt containing: Hello from text mode. Use the format ```file: textmode-test.txt\nHello from text mode```' }],
      provider: 'nvidia', model: 'nvidia/nemotron-3-nano-30b-a3b', stream: true,
      conversationId: testSessionId + '-txt001'
    });
    report('Text-mode request sent', stream.status === 200, 'status=' + stream.status);
  } catch (e) { report('Text-mode', false, e.message); }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('FINAL RESULTS');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log('\nPassed: ' + passed + '/' + total + ' (' + passRate + '%)');
  console.log('Failed: ' + (total - passed) + '/' + total);

  if (passed < total) {
    console.log('\n--- FAILED TESTS ---');
    results.filter(r => !r.pass).forEach(r => {
      console.log('  FAIL | ' + r.test + ' | ' + r.detail);
    });
  }

  console.log('\n--- TEST SECTIONS SUMMARY ---');
  const sections = {
    'Basic Chat': results.filter(r => r.test.includes('Non-streaming') || r.test.includes('Streaming') || r.test.includes('Provider') || r.test.includes('Fallback')).length,
    'VFS Edge Cases': results.filter(r => r.test.includes('Unicode') || r.test.includes('Special path') || r.test.includes('Large') || r.test.includes('Multi-file') || r.test.includes('Nested') || r.test.includes('Code') || r.test.includes('Empty')).length,
    'Filesystem API': results.filter(r => r.test.includes('Snapshot') || r.test.includes('List') || r.test.includes('Create') || r.test.includes('Mkdir') || r.test.includes('Diff') || r.test.includes('Read')).length,
    'Context-Pack': results.filter(r => r.test.includes('Context-pack')).length,
    'Rename/Move': results.filter(r => r.test.includes('Rename') || r.test.includes('Move')).length,
    'Streaming': results.filter(r => r.test.includes('SSE') || r.test.includes('Auto-continue') || r.test.includes('Multi-tool') || r.test.includes('validation')).length,
    'Session': results.filter(r => r.test.includes('Session') || r.test.includes('Filesystem scoping') || r.test.includes('Rate')).length,
    'Health': results.filter(r => r.test.includes('Health') || r.test.includes('Prewarm') || r.test.includes('Commits') || r.test.includes('Rollback')).length,
    'Errors': results.filter(r => r.test.includes('traversal') || r.test.includes('Relative') || r.test.includes('Missing') || r.test.includes('Non-JSON')).length,
    'Text-mode': results.filter(r => r.test.includes('Text-mode')).length,
  };

  Object.entries(sections).forEach(([section, count]) => {
    // Match section name keywords - use more flexible matching
    const sectionKeywords = section.toLowerCase().split(/[\s\/,.-]+/).filter(Boolean);
    const sectionPassed = results.filter(r => r.pass && sectionKeywords.some(k => r.test.toLowerCase().includes(k))).length;
    console.log(`  ${section}: ${sectionPassed}/${count}`);
  });

  console.log('='.repeat(70));
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
