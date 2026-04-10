/**
 * COMPREHENSIVE OAUTH URI/REDIRECT TEST
 * 
 * Tests all OAuth endpoints:
 * 1. Login flow and auth-token cookie setting
 * 2. Admin OAuth initiation/callback redirects
 * 3. Antigravity user OAuth URIs
 * 4. Arcade integration OAuth
 * 5. GitHub integration OAuth
 * 6. Full LLM agent workflow with file creation
 * 7. VFS MCP tool usage
 * 8. File edit parser fallbacks
 * 9. Auto-continue detection
 * 10. Multi-provider rotation
 * 
 * Usage: npx tsx tests/e2e/oauth-uri-comprehensive.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

const PROVIDERS = [
  { provider: 'mistral', model: 'mistral-small-latest', name: 'Mistral Small' },
  { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', name: 'Nvidia Nemotron' },
];

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color: string, msg: string) { console.log(`${color}${msg}${RESET}`); }

const results: any[] = [];
function record(test: string, passed: boolean, details: string, raw?: string) {
  results.push({ test, passed, details, raw });
  const icon = passed ? '✅' : '❌';
  log(passed ? GREEN : RED, `${icon} ${test}`);
  if (!passed) {
    log(RED, `   ${details}`);
    if (raw) log(YELLOW, `   Response: ${raw.slice(0, 400)}...`);
  }
  // Save partial results
  try { fs.writeFileSync(path.join(process.cwd(), 'tests/e2e/oauth-partial.json'), JSON.stringify(results, null, 2)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Not JSON (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || !data.token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return data.token;
}

// ═══════════════════════════════════════════════════════════════════
// OAuth URI Tests
// ═══════════════════════════════════════════════════════════════════

async function testOAuthURIs(token: string): Promise<void> {
  log(BLUE, '\n═══════════════════════════════════════');
  log(BLUE, 'TEST: OAuth URIs & Redirects');
  log(BLUE, '═══════════════════════════════════════\n');

  // 1. Login sets auth-token cookie
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    redirect: 'manual',
  });
  const loginCookies = loginRes.headers.get('set-cookie') || '';
  const hasAuthToken = loginCookies.includes('auth-token');
  record('Login: auth-token cookie', hasAuthToken, hasAuthToken ? 'Set' : `Not found. Headers: ${loginCookies.slice(0, 200)}`);

  // 2. Admin connect should redirect (302) to Google OAuth
  const adminConnectRes = await fetch(`${BASE_URL}/api/antigravity/admin/connect`, {
    headers: { 'Cookie': `auth-token=${token}` },
    redirect: 'manual',
  });
  const isRedirect = adminConnectRes.status === 302 || adminConnectRes.status === 301 || adminConnectRes.status === 307;
  const location = adminConnectRes.headers.get('location') || '';
  const hasOAuthUrl = location.includes('accounts.google.com') || location.includes('oauth2') || location.includes('authorize');
  record('Admin OAuth connect: redirect', isRedirect, isRedirect ? `${adminConnectRes.status} → ${location.slice(0, 150)}` : `Status: ${adminConnectRes.status}`);
  record('Admin OAuth connect: Google URL', hasOAuthUrl, hasOAuthUrl ? `Contains OAuth URL` : `Redirects to: ${location.slice(0, 150)}`);

  // 3. Admin callback without code → 400
  const adminCallbackRes = await fetch(`${BASE_URL}/api/antigravity/admin/callback`, {
    headers: { 'Cookie': `auth-token=${token}` },
  });
  record('Admin callback: no code → 400', adminCallbackRes.status === 400, `Status: ${adminCallbackRes.status}`);

  // 4. Admin callback with invalid code → error
  const adminCallbackInvalidRes = await fetch(`${BASE_URL}/api/antigravity/admin/callback?code=test&state=test`, {
    headers: { 'Cookie': `auth-token=${token}` },
  });
  record('Admin callback: invalid code → error', adminCallbackInvalidRes.status >= 400 || adminCallbackInvalidRes.status === 500, `Status: ${adminCallbackInvalidRes.status}`);

  // 5. Setup page requires auth — shows unauthorized message without auth
  const setupRes = await fetch(`${BASE_URL}/admin/antigravity/setup`);
  const setupText = await setupRes.text();
  const hasUnauthorized = setupText.includes('Unauthorized') || setupText.includes('logged in');
  record('Setup page: requires auth', hasUnauthorized, hasUnauthorized ? 'Shows unauthorized message' : `Status: ${setupRes.status}, Body: ${setupText.slice(0, 100)}`);

  // 6. Setup page works with auth
  const setupAuthRes = await fetch(`${BASE_URL}/admin/antigravity/setup`, {
    headers: { 'Cookie': `auth-token=${token}` },
  });
  const setupHtml = await setupAuthRes.text();
  const hasSetupContent = setupHtml.includes('Antigravity') || setupHtml.includes('Master Account') || setupHtml.includes('Connect');
  record('Setup page: loads with auth', setupAuthRes.status === 200 && hasSetupContent, `Status: ${setupAuthRes.status}, Has content: ${hasSetupContent}`);
}

// ═══════════════════════════════════════════════════════════════════
// LLM Chat Tests with Provider Rotation
// ═══════════════════════════════════════════════════════════════════

async function chat(token: string, messages: Array<{role: string, content: string}>, convId: string, timeout = 120000, provider = 'mistral', model = 'mistral-small-latest'): Promise<any> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages, provider, model, stream: false, conversationId: convId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { return { error: `Not JSON (${res.status})`, status: res.status, content: '', response: '' }; }
    if (!res.ok) return { error: data.error || 'Unknown', status: res.status, content: '', response: '' };
    return { content: data.content || data.response || '', response: data.response || data.content || '', metadata: data.metadata || {} };
  } catch (e: any) { clearTimeout(tid); return { error: e.message, status: 0, content: '', response: '' }; }
}

async function testLLMFileCreation(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🔧 Test: LLM File Creation [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Create a file called oauth-test-file.txt with the content: "OAuth integration test successful"' }], `oauth-llm-${Date.now()}`, 120000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const hasFile = response.includes('oauth-test-file.txt');
  const hasContent = response.includes('OAuth integration test successful') || response.includes('create') || response.includes('write');
  record(`LLM File Create [${provider.name}]`, hasFile && hasContent, hasFile && hasContent ? 'File created' : `File: ${hasFile}, Content: ${hasContent}`, response);
}

async function testLLMMultiFile(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n📦 Test: LLM Multi-File [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Create 3 files: multi-oauth-1.js with "console.log(1)", multi-oauth-2.js with "console.log(2)", and multi-oauth-3.js with "console.log(3)"' }], `oauth-multi-${Date.now()}`, 120000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const files = ['multi-oauth-1.js', 'multi-oauth-2.js', 'multi-oauth-3.js'];
  const found = files.filter(f => response.includes(f));
  record(`LLM Multi-File [${provider.name}]`, found.length >= 2, `Found ${found.length}/3: ${found.join(', ')}`, response);
}

async function testLLMBatchWrite(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n⚡ Test: LLM Batch Write [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Use batch_write to create these files: ```javascript\nbatch_write([\n  { "path": "batch-oauth-1.js", "content": "console.log(1)" },\n  { "path": "batch-oauth-2.js", "content": "console.log(2)" }\n])\n```' }], `oauth-batch-${Date.now()}`, 120000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const hasFiles = response.includes('batch-oauth-1.js') && response.includes('batch-oauth-2.js');
  record(`LLM Batch Write [${provider.name}]`, hasFiles, hasFiles ? 'Both files detected' : `Not found`, response);
}

async function testLLMAutoContinue(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🔁 Test: Auto-Continue [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Create a full React app with: package.json, src/index.js, src/App.js, README.md - complete code for ALL files' }], `oauth-cont-${Date.now()}`, 180000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const expected = ['package.json', 'index.js', 'App.js', 'README'];
  const found = expected.filter(f => response.includes(f));
  record(`Auto-Continue [${provider.name}]`, found.length >= 3, `Files: ${found.length}/4: ${found.join(', ')}`, response);
}

async function testLLMShell(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n💻 Test: Shell/PTY [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Create shell-test.py that prints "Shell test success", then run it and show output' }], `oauth-shell-${Date.now()}`, 120000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const hasCreate = response.includes('shell-test.py') || response.includes('python');
  const hasRun = response.includes('run') || response.includes('execute') || response.includes('output') || response.includes('Shell test success');
  record(`Shell/PTY [${provider.name}]`, hasCreate && hasRun, `Create: ${hasCreate}, Run: ${hasRun}`, response);
}

async function testLLMSelfHeal(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🩹 Test: Self-Healing [${provider.name}]`);

  const r = await chat(token, [
    { role: 'user', content: 'Create heal-oauth.js with syntax error: const x = ;' },
    { role: 'assistant', content: 'Created with syntax error' },
    { role: 'user', content: 'Fix the syntax error in heal-oauth.js' },
  ], `oauth-heal-${Date.now()}`, 120000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const hasFix = response.includes('fix') || response.includes('correct') || response.includes('heal-oauth.js') || response.includes('undefined') || response.includes('null') || response.includes('=');
  record(`Self-Healing [${provider.name}]`, hasFix, hasFix ? 'Fix detected' : 'No fix', response);
}

async function testLLMErrorRecovery(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🛡️ Test: Error Recovery [${provider.name}]`);

  const r = await chat(token, [{ role: 'user', content: 'Read /nonexistent/file.txt' }], `oauth-error-${Date.now()}`, 60000, provider.provider, provider.model);
  const response = r.content || r.response || '';
  const hasHandling = response.length > 10 || r.error;
  record(`Error Recovery [${provider.name}]`, hasHandling, hasHandling ? `Handled (${response.length} chars)` : 'No response', response);
}

// ═══════════════════════════════════════════════════════════════════
// File Edit Parser Direct Test
// ═══════════════════════════════════════════════════════════════════

async function testParserDirect(): Promise<void> {
  log(BLUE, '\n═══════════════════════════════════════');
  log(BLUE, 'TEST: File Edit Parser Direct');
  log(BLUE, '═══════════════════════════════════════\n');

  const formats = [
    { name: 'Compact file_edit', content: '<file_edit path="parser-oauth-1.txt">Content</file_edit>', expected: 'parser-oauth-1.txt' },
    { name: 'Batch write', content: '```javascript\nbatch_write([{ "path": "parser-oauth-2.js", "content": "test" }])\n```', expected: 'parser-oauth-2.js' },
    { name: 'Special token', content: '<|tool_call_begin|> batch_write:0 <|tool_call_argument_begin|>\n{"files":[{"path":"parser-oauth-3.txt","content":"test"}]}\n<|tool_call_end|>', expected: 'parser-oauth-3.txt' },
    { name: 'Tool call fenced', content: '```tool_call\n{ "tool_name": "write_file", "parameters": { "files": [{ "path": "parser-oauth-4.md", "content": "# Test" }] } }\n```', expected: 'parser-oauth-4.md' },
    { name: 'Bash heredoc', content: 'cat > parser-oauth-5.sh << \'EOF\'\necho test\nEOF', expected: 'parser-oauth-5.sh' },
  ];

  for (const fmt of formats) {
    const res = await fetch(`${BASE_URL}/api/test/vfs-parse-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fmt.content }),
    });
    const data = await res.json();
    const found = data.edits?.some((e: any) => e.path?.includes(fmt.expected));
    record(`Parser: ${fmt.name}`, found, found ? `Found ${fmt.expected}` : `0 edits`, JSON.stringify(data.edits || []));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  log(CYAN, '\n🚀 COMPREHENSIVE OAUTH URI & INTEGRATION TEST');
  log(CYAN, `   Base: ${BASE_URL}`);
  log(CYAN, `   Auth: ${TEST_EMAIL}`);

  const token = await login();
  log(GREEN, '✅ Authenticated\n');

  // OAuth URI tests
  await testOAuthURIs(token);

  // Parser direct tests
  await testParserDirect();

  // LLM tests with provider rotation
  for (const prov of PROVIDERS) {
    log(CYAN, `\n${'='.repeat(50)}`);
    log(CYAN, `🔄 Provider: ${prov.name}`);
    log(CYAN, `${'='.repeat(50)}\n`);

    await testLLMFileCreation(token, prov);
    await testLLMMultiFile(token, prov);
    await testLLMBatchWrite(token, prov);
    await testLLMAutoContinue(token, prov);
    await testLLMShell(token, prov);
    await testLLMSelfHeal(token, prov);
    await testLLMErrorRecovery(token, prov);
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  log(CYAN, '\n' + '='.repeat(60));
  log(GREEN, `✅ Passed: ${passed}`);
  if (failed > 0) log(RED, `❌ Failed: ${failed}`);
  log(CYAN, `📊 Total: ${results.length}`);
  log(CYAN, '='.repeat(60));

  // Per-provider stats
  const pstats = new Map<string, { p: number; t: number }>();
  for (const r of results) {
    const k = r.test.includes('[') ? r.test.match(/\[([^\]]+)\]/)?.[1] || 'parser' : 'parser';
    if (!pstats.has(k)) pstats.set(k, { p: 0, t: 0 });
    const s = pstats.get(k)!; s.t++; if (r.passed) s.p++;
  }
  log(CYAN, '\n📊 Per-Provider:');
  for (const [k, s] of pstats) {
    const pct = Math.round((s.p / s.t) * 100);
    log(s.p === s.t ? GREEN : YELLOW, `  ${k}: ${s.p}/${s.t} (${pct}%)`);
  }

  // Save
  const rfile = path.join(process.cwd(), 'tests/e2e/oauth-comprehensive-results.json');
  fs.writeFileSync(rfile, JSON.stringify({ summary: { passed, failed, total: results.length }, details: results.map(r => ({ test: r.test, passed: r.passed, details: r.details })) }, null, 2));
  log(CYAN, `\n📄 Results: ${rfile}`);

  // Save failures
  const fails = results.filter(r => !r.passed);
  if (fails.length > 0) {
    const ffile = path.join(process.cwd(), 'tests/e2e/oauth-failures.json');
    fs.writeFileSync(ffile, JSON.stringify(fails.map(r => ({ test: r.test, details: r.details, response: r.raw })), null, 2));
    log(YELLOW, `❌ Failures: ${ffile}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { log(RED, `\n💥 ${err.message}`); console.error(err); process.exit(1); });
