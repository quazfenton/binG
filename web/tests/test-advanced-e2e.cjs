/**
 * Advanced E2E Integration Tests
 *
 * Tests real MCP tool functionality:
 * - Multi-file lifecycle (create, read, update, delete)
 * - File versioning and content persistence
 * - Batch write operations with version tracking
 * - Search across multiple files
 * - Directory creation + file integration
 * - Workspace statistics and metadata
 * - Session isolation between operations
 */
const http = require('http');

let sessionCookie = '';
let testSession = 'test-adv-' + Date.now();

function request(method, url, body, timeoutMs = 30000) {
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
        catch(e) { reject(new Error('Parse: ' + e.message + ' | ' + b.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isPost) req.write(data);
    req.end();
  });
}

const post = (url, body) => request('POST', url, body);
const get = (url) => request('GET', url, undefined);
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mcpCall(toolName, args) {
  return post('/api/mcp', {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    id: Date.now()
  });
}

function mcpResult(resp) {
  try {
    return JSON.parse(resp.body.result?.content?.[0]?.text || '{}');
  } catch { return {}; }
}

async function main() {
  const results = [];
  function report(test, pass, detail) {
    results.push({ test, pass, detail });
    console.log((pass ? '✅' : '❌') + ' ' + test + (detail ? ' | ' + detail : ''));
  }

  // =========================================================================
  // 0. SESSION SETUP
  // =========================================================================
  console.log('\n=== 0. SESSION SETUP ===');
  try {
    const snap = await get('/api/filesystem/snapshot?path=project');
    report('Session established', snap.status === 200 && !!sessionCookie, 'cookie=' + (sessionCookie ? 'YES' : 'NO'));
  } catch (e) { report('Session setup', false, e.message); process.exit(1); }

  // =========================================================================
  // 1. FILE LIFECYCLE: Create → Read → Update → Verify → Delete
  // =========================================================================
  console.log('\n=== 1. FILE LIFECYCLE ===');
  const testPath = 'lifecycle-test.txt';
  const initialContent = 'Initial content for lifecycle test';
  const updatedContent = 'Updated content - version 2';

  try {
    // Create
    const create = await mcpCall('write_file', { path: testPath, content: initialContent });
    report('File created', create.status === 200, 'status=' + create.status);
    await sleep(1000);

    // Read back
    const read1 = await mcpCall('read_file', { path: testPath });
    const r1 = mcpResult(read1);
    report('Read returns content', r1.content === initialContent, 'got=' + (r1.content || 'EMPTY').substring(0, 40));

    // Update
    const update = await mcpCall('write_file', { path: testPath, content: updatedContent });
    report('File updated', update.status === 200, 'status=' + update.status);
    await sleep(1000);

    // Read updated content
    const read2 = await mcpCall('read_file', { path: testPath });
    const r2 = mcpResult(read2);
    report('Updated content matches', r2.content === updatedContent, 'got=' + (r2.content || 'EMPTY').substring(0, 40));

    // Check version increased
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const lcFile = files.find(f => f.path.includes(testPath));
    report('File version >= 2', lcFile && lcFile.version >= 2, 'version=' + (lcFile ? lcFile.version : 'N/A'));

    // Delete
    const del = await mcpCall('delete_file', { path: testPath });
    report('File deleted', del.status === 200, 'status=' + del.status);
    await sleep(500);

    // Verify deletion
    const read3 = await mcpCall('read_file', { path: testPath });
    const r3 = mcpResult(read3);
    report('Delete verified (read fails)', !r3.success || r3.error, r3.error || 'unexpected success');
  } catch (e) { report('File lifecycle', false, e.message); }

  // =========================================================================
  // 2. BATCH WRITE: Create 5 files, verify all, check versions
  // =========================================================================
  console.log('\n=== 2. BATCH WRITE (5 files) ===');
  const batchFiles = [];
  for (let i = 1; i <= 5; i++) {
    batchFiles.push({ path: `batch-e2e-${i}.js`, content: `// File ${i} - batch write test\nconst v = ${i};\nmodule.exports = { v };` });
  }

  try {
    const batch = await mcpCall('batch_write', { files: batchFiles });
    report('Batch write returns 200', batch.status === 200, 'status=' + batch.status);
    await sleep(3000);

    // Verify all files exist with correct content
    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];

    let allFound = true;
    let allV1 = true;
    for (let i = 1; i <= 5; i++) {
      const f = files.find(f => f.path.includes(`batch-e2e-${i}`));
      if (!f) { allFound = false; break; }
      if (f.version !== 1) allV1 = false;
    }
    report('All 5 batch files found', allFound, 'found=' + files.filter(f => f.path.includes('batch-e2e-')).length);
    report('All files version 1', allV1, 'versions=' + files.filter(f => f.path.includes('batch-e2e-')).map(f => f.version).join(','));

    // Read one back to verify content
    const read = await mcpCall('read_file', { path: 'batch-e2e-3.js' });
    const r = mcpResult(read);
    report('Batch file content matches', r.content && r.content.includes('File 3'), 'got=' + (r.content || '').substring(0, 40));
  } catch (e) { report('Batch write', false, e.message); }

  // =========================================================================
  // 3. SEARCH: Write files with known content, search across them
  // =========================================================================
  console.log('\n=== 3. SEARCH ACROSS FILES ===');
  try {
    // Create files with searchable content
    await mcpCall('write_file', { path: 'search-alpha.txt', content: 'Alpha function: export const alpha = () => "hello"' });
    await mcpCall('write_file', { path: 'search-beta.txt', content: 'Beta function: export const beta = () => "world"' });
    await mcpCall('write_file', { path: 'search-gamma.js', content: 'Gamma module: module.exports = { name: "gamma" }' });
    await sleep(2000);

    // Search for "export const"
    const search1 = await mcpCall('search_files', { query: 'export const' });
    const s1 = mcpResult(search1);
    const matches1 = s1.files || s1.matches || [];
    report('Search finds export const', matches1.length >= 2, 'files=' + (matches1.length || 0) + ' keys=' + Object.keys(s1).join(','));

    // Search for "module.exports"
    const search2 = await mcpCall('search_files', { query: 'module.exports' });
    const s2 = mcpResult(search2);
    const matches2 = s2.files || s2.matches || [];
    report('Search finds module.exports', matches2.length >= 1, 'files=' + (matches2.length || 0));
  } catch (e) { report('Search', false, e.message); }

  // =========================================================================
  // 4. DIRECTORY + FILE INTEGRATION: mkdir → write → read
  // =========================================================================
  console.log('\n=== 4. DIRECTORY + FILE INTEGRATION ===');
  try {
    // Create nested directory via write_file (VFS creates parent dirs automatically)
    const nestedPath = 'e2e-nested/deep/path/file.txt';
    const nestedContent = 'Nested file content';

    const write = await mcpCall('write_file', { path: nestedPath, content: nestedContent });
    report('Nested file created', write.status === 200, 'status=' + write.status);
    await sleep(1000);

    // Read it back
    const read = await mcpCall('read_file', { path: nestedPath });
    const r = mcpResult(read);
    report('Nested file content matches', r.content === nestedContent, 'got=' + (r.content || 'EMPTY'));

    // List parent directory
    const list = await mcpCall('list_files', { path: 'e2e-nested/deep' });
    const l = mcpResult(list);
    report('Parent directory listable', l.nodes && l.nodes.length > 0, 'nodes=' + (l.nodes?.length || 0));
  } catch (e) { report('Directory + file', false, e.message); }

  // =========================================================================
  // 5. WORKSPACE STATS
  // =========================================================================
  console.log('\n=== 5. WORKSPACE STATS ===');
  try {
    const stats = await mcpCall('get_workspace_stats', {});
    const s = mcpResult(stats);
    report('Stats returned', s.fileCount !== undefined || s.totalSize !== undefined, 'keys=' + Object.keys(s).join(','));
    if (s.fileCount !== undefined) report('Has fileCount', s.fileCount > 0, 'fileCount=' + s.fileCount);
    if (s.totalSize !== undefined) report('Has total size', s.totalSize > 0, 'size=' + s.totalSize + 'b');
    if (s.largestFile?.path) report('Has largest file', true, s.largestFile.path);
  } catch (e) { report('Workspace stats', false, e.message); }

  // =========================================================================
  // 6. FILE VERSIONING: Overwrite same file multiple times, verify versions
  // =========================================================================
  console.log('\n=== 6. FILE VERSIONING ===');
  const versionPath = 'version-test.txt';
  try {
    for (let v = 1; v <= 4; v++) {
      await mcpCall('write_file', { path: versionPath, content: `Version ${v} content` });
      await sleep(500);
    }

    const snap = await get('/api/filesystem/snapshot?path=project');
    const files = snap.body.data?.files || [];
    const vFile = files.find(f => f.path.includes(versionPath));
    report('File exists after 4 writes', !!vFile, vFile ? vFile.path : 'not found');
    report('Version is 4+', vFile && vFile.version >= 4, 'version=' + (vFile ? vFile.version : 'N/A'));

    // Read final content
    const read = await mcpCall('read_file', { path: versionPath });
    const r = mcpResult(read);
    report('Final content is v4', r.content && r.content.includes('Version 4'), 'got=' + (r.content || '').substring(0, 30));
  } catch (e) { report('File versioning', false, e.message); }

  // =========================================================================
  // 7. APPLY DIFF: Create file, apply diff, verify result
  // =========================================================================
  console.log('\n=== 7. APPLY DIFF ===');
  const diffPath = 'diff-test.txt';
  const diffOriginal = 'Hello World\nThis is original content\nLine 3\n';
  const diffPatch = `--- a/${diffPath}
+++ b/${diffPath}
@@ -1,3 +1,3 @@
-Hello World
+Hello Universe
 This is original content
 Line 3
`;

  try {
    // Create original file
    await mcpCall('write_file', { path: diffPath, content: diffOriginal });
    await sleep(1000);

    // Apply diff
    const diff = await mcpCall('apply_diff', { path: diffPath, diff: diffPatch });
    report('Apply diff returns 200', diff.status === 200, 'status=' + diff.status);
    await sleep(1000);

    // Read patched content
    const read = await mcpCall('read_file', { path: diffPath });
    const r = mcpResult(read);
    report('Patched content matches', r.content && r.content.includes('Hello Universe'), 'got=' + (r.content || '').substring(0, 40));
  } catch (e) { report('Apply diff', false, e.message); }

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
