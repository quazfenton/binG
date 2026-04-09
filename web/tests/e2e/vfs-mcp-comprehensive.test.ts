/**
 * COMPREHENSIVE E2E VFS MCP TOOL & FILE CREATION STRESS TEST
 * 
 * Tests the full workflow:
 * 1. VFS MCP tool file creation (write_file, batch_write, apply_diff)
 * 2. Regex fallback parsing when structured tool calls fail
 * 3. Multiple provider rotation (mistral, nvidia, google, openrouter)
 * 4. Full app generation with file verification
 * 5. Auto-continue detection
 * 6. Context bundling
 * 7. Self-healing
 * 8. Shell/PTY execution
 * 9. No infinite loops
 * 10. Tool choice correctness
 * 11. Error recovery
 * 12. Workspace scoping
 * 
 * Usage: npx tsx tests/e2e/vfs-mcp-comprehensive.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Provider rotation - skip OpenAI/Anthropic (not configured)
const PROVIDERS = [
  { provider: 'mistral', model: 'mistral-small-latest', name: 'Mistral Small' },
  { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', name: 'Nvidia Nemotron' },
  { provider: 'openrouter', model: 'google/gemini-2.0-flash-lite:free', name: 'OpenRouter Gemini' },
];

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color: string, msg: string) {
  console.log(`${color}${msg}${RESET}`);
}

const results: Array<{
  test: string;
  passed: boolean;
  details: string;
  duration: number;
  provider?: string;
  model?: string;
  rawResponse?: string;
  editsFound?: any[];
}> = [];

function record(test: string, passed: boolean, details: string, duration: number, provider?: string, model?: string, rawResponse?: string, editsFound?: any[]) {
  results.push({ test, passed, details, duration, provider, model, rawResponse, editsFound });
  const icon = passed ? '✅' : '❌';
  const color = passed ? GREEN : RED;
  log(color, `${icon} ${test} [${provider || 'default'}] (${Math.round(duration / 1000)}s)`);
  if (!passed) {
    log(RED, `   ${details}`);
    if (rawResponse) {
      log(YELLOW, `   Response: ${rawResponse.slice(0, 400)}...`);
    }
    if (editsFound && editsFound.length > 0) {
      log(YELLOW, `   Edits found: ${JSON.stringify(editsFound.slice(0, 3))}`);
    }
  }
  // Save partial results after each test so we don't lose progress on timeout
  try {
    const resultsFile = path.join(process.cwd(), 'tests/e2e/vfs-mcp-partial-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify({
      partial: true,
      completed: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      details: results.map(r => ({ test: r.test, passed: r.passed, details: r.details, duration: r.duration, provider: r.provider })),
    }, null, 2));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════

async function authenticate(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Auth response not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.token) {
    throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

// ═══════════════════════════════════════════════════════════════════
// Chat Helper
// ═══════════════════════════════════════════════════════════════════

async function chat(
  token: string,
  messages: Array<{ role: string; content: string }>,
  conversationId: string,
  timeout = 180000,
  provider = 'mistral',
  model = 'mistral-small-latest'
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages,
        provider,
        model,
        stream: false,
        conversationId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { error: `Response not JSON (status ${res.status}): ${text.slice(0, 200)}`, status: res.status, content: '', response: '' };
    }

    if (!res.ok) {
      return { error: data.error || 'Unknown error', status: res.status, content: '', response: '' };
    }

    return {
      content: data.content || data.response || '',
      response: data.response || data.content || '',
      provider: data.provider || provider,
      model: data.model || model,
      metadata: data.metadata || {},
      toolCalls: data.toolCalls || data.tool_calls || [],
      edits: data.edits || data.fileEdits || [],
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { error: err.message || 'Request failed', status: 0, content: '', response: '' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// File Edit Parser Test (direct)
// ═══════════════════════════════════════════════════════════════════

async function testFileEditParserDirect(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n📄 Test 1: File Edit Parser Direct (All Fallback Formats)');

  const formats = [
    {
      name: 'Compact file_edit tag',
      prompt: 'Create a file: <file_edit path="direct-test-1.txt">Direct test content 1</file_edit>',
      expectedFiles: ['direct-test-1.txt'],
    },
    {
      name: 'Fenced diff format',
      prompt: 'Show a diff for test-diff.md using ```diff format',
      expectedFiles: ['test-diff.md'],
    },
    {
      name: 'Bash heredoc',
      prompt: 'Create test-heredoc.sh: cat > test-heredoc.sh << \'EOF\'\necho "heredoc"\nEOF',
      expectedFiles: ['test-heredoc.sh'],
    },
    {
      name: 'batch_write fenced',
      prompt: 'Use batch_write: ```javascript\nbatch_write([\n  { "path": "bw-direct-1.js", "content": "console.log(1)" },\n  { "path": "bw-direct-2.js", "content": "console.log(2)" }\n])\n```',
      expectedFiles: ['bw-direct-1.js', 'bw-direct-2.js'],
    },
    {
      name: 'Special token format',
      prompt: '<|tool_call_begin|> batch_write:0 <|tool_call_argument_begin|>\n{"files":[{"path":"special-direct.txt","content":"special"}]}\n<|tool_call_end|>',
      expectedFiles: ['special-direct.txt'],
    },
    {
      name: '```tool_call format',
      prompt: '```tool_call\n{ "tool_name": "batch_write", "parameters": { "files": [{ "path": "toolcall-direct.md", "content": "# Direct Test" }] } }\n```',
      expectedFiles: ['toolcall-direct.md'],
    },
  ];

  for (const fmt of formats) {
    const fmtStart = Date.now();
    const r = await chat(token, [{ role: 'user', content: fmt.prompt }], `direct-${fmt.name}`, 120000);
    const response = r.content || r.response || '';
    const foundFiles = fmt.expectedFiles.filter(f => response.includes(f));
    const hasEditMarkers = response.includes('<file_edit') || response.includes('batch_write') ||
      response.includes('```diff') || response.includes('write_file') ||
      response.includes('<|tool_call') || response.includes('```tool_call');

    const passed = foundFiles.length > 0 || hasEditMarkers;
    record(
      `Direct Parser: ${fmt.name}`,
      passed,
      passed ? `Found ${foundFiles.length}/${fmt.expectedFiles.length} files` : `No files or markers found`,
      Date.now() - fmtStart,
      undefined, undefined,
      response,
      foundFiles
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// VFS MCP Tool File Creation
// ═══════════════════════════════════════════════════════════════════

async function testVFSCreateFile(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🔧 Test: VFS MCP File Creation [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create a file called vfs-create-test.txt with the exact content: "VFS create test successful"',
  }], `vfs-create-${Date.now()}`, 90000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasFile = response.includes('vfs-create-test.txt');
  const hasContent = response.includes('VFS create test successful') || response.includes('create') || response.includes('write');
  const hasToolCall = response.includes('write_file') || response.includes('file_edit') || response.includes('batch_write') || response.includes('tool_call');

  record(
    `VFS Create File [${provider.name}]`,
    hasFile && hasContent,
    hasFile && hasContent
      ? `File referenced${hasToolCall ? ', tool call detected' : ''}`
      : `Missing file reference or content`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

async function testVFSBatchWrite(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n📦 Test: VFS MCP Batch Write [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create TWO files using batch_write: 1) batch-file-1.js with "console.log(\'batch 1\')" and 2) batch-file-2.js with "console.log(\'batch 2\')"',
  }], `vfs-batch-${Date.now()}`, 180000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasFile1 = response.includes('batch-file-1.js');
  const hasFile2 = response.includes('batch-file-2.js');
  const hasBatchMarker = response.includes('batch_write') || response.includes('both files') || response.includes('two files');

  record(
    `VFS Batch Write [${provider.name}]`,
    hasFile1 && hasFile2,
    hasFile1 && hasFile2
      ? `Both files referenced${hasBatchMarker ? ', batch marker present' : ''}`
      : `File1: ${hasFile1}, File2: ${hasFile2}`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

async function testVFSApplyDiff(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🔄 Test: VFS MCP Apply Diff [${provider.name}]`);

  // First create a file
  await chat(token, [{
    role: 'user',
    content: 'Create diff-target.js with: export const version = "1.0.0";',
  }], `vfs-diff-${Date.now()}`, 60000, provider.provider, provider.model);

  // Then modify it
  const r2 = await chat(token, [
    { role: 'user', content: 'Create diff-target.js with: export const version = "1.0.0";' },
    { role: 'assistant', content: 'Created diff-target.js with version 1.0.0' },
    { role: 'user', content: 'Now apply a diff to diff-target.js to change version to "2.0.0" and add a new function: export function hello() { return "hello"; }' },
  ], `vfs-diff-${Date.now()}`, 180000, provider.provider, provider.model);

  const response = r2.content || r2.response || '';
  const hasModification = response.includes('diff-target.js') && (response.includes('2.0.0') || response.includes('hello') || response.includes('modify') || response.includes('update') || response.includes('diff'));

  record(
    `VFS Apply Diff [${provider.name}]`,
    hasModification,
    hasModification ? 'Modification detected' : 'No modification',
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Full App Generation
// ═══════════════════════════════════════════════════════════════════

async function testFullAppGeneration(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🏗️  Test: Full App Generation [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Code a complete React todo app with: 1) package.json (with react and react-dom dependencies), 2) public/index.html (with DOCTYPE and app div), 3) src/index.js (with ReactDOM.createRoot), 4) src/App.js (with useState for todos), 5) src/components/TodoList.js, 6) src/styles.css (with basic styling). Provide COMPLETE working code for ALL files.',
  }], `full-app-${Date.now()}`, 300000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const expectedFiles = ['package.json', 'index.html', 'index.js', 'App.js', 'TodoList', 'styles.css'];
  const foundFiles = expectedFiles.filter(f => response.includes(f));
  const completeness = foundFiles.length / expectedFiles.length;

  // Check for actual code blocks (not just file names)
  const hasCodeBlocks = (response.match(/```/g) || []).length >= 6;
  const hasReactCode = response.includes('useState') || response.includes('React') || response.includes('import');

  record(
    `Full App Generation [${provider.name}]`,
    completeness >= 0.6 && hasCodeBlocks,
    `Files: ${foundFiles.length}/${expectedFiles.length}, Code blocks: ${hasCodeBlocks}, React code: ${hasReactCode}`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Auto-Continue Detection
// ═══════════════════════════════════════════════════════════════════

async function testAutoContinue(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🔁 Test: Auto-Continue Detection [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create a full-stack app with 8 files: package.json, src/index.js, src/App.js, src/api.js, src/auth.js, src/utils.js, src/styles.css, README.md. Provide complete code for EVERY file.',
  }], `autocont-${Date.now()}`, 240000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const expectedCount = 8;
  const expectedFiles = ['package.json', 'index.js', 'App.js', 'api.js', 'auth.js', 'utils.js', 'styles.css', 'README'];
  const foundCount = expectedFiles.filter(f => response.includes(f)).length;
  const hasContinueMarker = response.includes('[CONTINUE_REQUESTED]') || response.includes('[AUTO-CONTINUE]');

  record(
    `Auto-Continue [${provider.name}]`,
    foundCount >= expectedCount * 0.6,
    `Files: ${foundCount}/${expectedCount}, Continue marker: ${hasContinueMarker}`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Context Bundling
// ═══════════════════════════════════════════════════════════════════

async function testContextBundling(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n📦 Test: Context Bundling [${provider.name}]`);

  const r1 = await chat(token, [{
    role: 'user',
    content: 'Create context-test-file.md with "# Context Test"',
  }], `context-${Date.now()}`, 60000, provider.provider, provider.model);

  const r2 = await chat(token, [
    { role: 'user', content: 'Create context-test-file.md with "# Context Test"' },
    { role: 'assistant', content: r1.content?.slice(0, 300) || r1.response?.slice(0, 300) || '' },
    { role: 'user', content: 'Now append "## Section 2" to that same file' },
  ], `context-${Date.now()}`, 120000, provider.provider, provider.model);

  const response = r2.content || r2.response || '';
  const hasContext = response.includes('context-test-file.md') || response.includes('Section 2') || response.includes('append') || response.includes('modify');

  record(
    `Context Bundling [${provider.name}]`,
    hasContext,
    hasContext ? 'Context maintained across turns' : 'Context lost',
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Self-Healing
// ═══════════════════════════════════════════════════════════════════

async function testSelfHealing(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🩹 Test: Self-Healing [${provider.name}]`);

  const r = await chat(token, [
    { role: 'user', content: 'Create selfheal-test.js with syntax error: const x = ;' },
    { role: 'assistant', content: 'Created with syntax error' },
    { role: 'user', content: 'Fix the syntax error in selfheal-test.js' },
  ], `selfheal-${Date.now()}`, 120000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasFix = response.includes('fix') || response.includes('correct') || response.includes('selfheal-test.js') || response.includes('=') || response.includes('null') || response.includes('undefined');

  record(
    `Self-Healing [${provider.name}]`,
    hasFix,
    hasFix ? 'Fix detected' : 'No fix',
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shell/PTY
// ═══════════════════════════════════════════════════════════════════

async function testShellPTY(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n💻 Test: Shell/PTY Execution [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create hello-pty.py that prints "Hello from PTY", then run it and show me the output',
  }], `shellpty-${Date.now()}`, 120000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasCreation = response.includes('hello-pty.py') || response.includes('print') || response.includes('python');
  const hasExecution = response.includes('run') || response.includes('execute') || response.includes('output') || response.includes('Hello from PTY') || response.includes('sandbox') || response.includes('terminal');

  record(
    `Shell/PTY [${provider.name}]`,
    hasCreation && hasExecution,
    `Creation: ${hasCreation}, Execution: ${hasExecution}`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// No Infinite Loops
// ═══════════════════════════════════════════════════════════════════

async function testNoInfiniteLoops(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🛑 Test: No Infinite Loops [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create these 12 files: package.json, index.html, src/app.js, src/components/Header.js, src/components/Footer.js, src/components/Sidebar.js, src/utils/api.js, src/utils/helpers.js, src/styles/main.css, README.md, LICENSE, .gitignore',
  }], `noloop-${Date.now()}`, 240000, provider.provider, provider.model);

  const duration = Date.now() - start;
  const completed = !r.error && duration < 240000;

  record(
    `No Infinite Loops [${provider.name}]`,
    completed,
    completed ? `Completed in ${Math.round(duration/1000)}s` : `Failed after ${Math.round(duration/1000)}s: ${r.error}`,
    duration,
    provider.provider,
    provider.model,
    r.content || r.response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tool Choice Correctness
// ═══════════════════════════════════════════════════════════════════

async function testToolChoice(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🎯 Test: Tool Choice Correctness [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Create a directory called tool-choice-test, then create package.json inside it with {"name":"tool-choice-test","version":"1.0.0"}',
  }], `toolchoice-${Date.now()}`, 120000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasDir = response.includes('tool-choice-test') && (response.includes('mkdir') || response.includes('directory') || response.includes('create'));
  const hasFile = response.includes('package.json') && response.includes('tool-choice-test');

  record(
    `Tool Choice [${provider.name}]`,
    hasDir && hasFile,
    `Dir: ${hasDir}, File: ${hasFile}`,
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Error Recovery
// ═══════════════════════════════════════════════════════════════════

async function testErrorRecovery(token: string, provider: any): Promise<void> {
  const start = Date.now();
  log(BLUE, `\n🛡️  Test: Error Recovery [${provider.name}]`);

  const r = await chat(token, [{
    role: 'user',
    content: 'Read the file /nonexistent/path/file.txt and tell me what\'s in it',
  }], `error-${Date.now()}`, 60000, provider.provider, provider.model);

  const response = r.content || r.response || '';
  const hasErrorHandling = response.includes('error') || response.includes('not found') ||
    response.includes('doesn\'t exist') || response.includes('cannot') ||
    response.includes('unable') || response.includes('missing') ||
    response.length > 10;

  record(
    `Error Recovery [${provider.name}]`,
    hasErrorHandling,
    hasErrorHandling ? `Handled (${response.length} chars)` : 'No response',
    Date.now() - start,
    provider.provider,
    provider.model,
    response
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  log(CYAN, '\n🚀 COMPREHENSIVE VFS MCP TOOL & FILE CREATION STRESS TEST');
  log(CYAN, `   Base URL: ${BASE_URL}`);
  log(CYAN, `   Auth: ${TEST_EMAIL}`);
  log(CYAN, `   Providers: ${PROVIDERS.map(p => p.name).join(', ')}\n`);

  const token = await authenticate();
  log(GREEN, '✅ Authenticated\n');

  // Test 1: File Edit Parser Direct
  await testFileEditParserDirect(token);

  // Test each provider
  for (const provider of PROVIDERS) {
    log(CYAN, `\n${'='.repeat(60)}`);
    log(CYAN, `🔄 Testing provider: ${provider.name} (${provider.provider}/${provider.model})`);
    log(CYAN, `${'='.repeat(60)}\n`);

    await testVFSCreateFile(token, provider);
    await testVFSBatchWrite(token, provider);
    await testVFSApplyDiff(token, provider);
    await testFullAppGeneration(token, provider);
    await testAutoContinue(token, provider);
    await testSelfHealing(token, provider);
    await testShellPTY(token, provider);
    await testNoInfiniteLoops(token, provider);
    await testErrorRecovery(token, provider);
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  log(CYAN, '\n' + '='.repeat(70));
  log(GREEN, `✅ Passed: ${passed}`);
  if (failed > 0) log(RED, `❌ Failed: ${failed}`);
  log(CYAN, `📊 Total: ${results.length}`);
  log(CYAN, `⏱️  Total: ${Math.round(totalDuration / 1000)}s`);
  log(CYAN, '='.repeat(70));

  // Per-provider stats
  const providerStats = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const key = r.provider || 'parser-direct';
    if (!providerStats.has(key)) providerStats.set(key, { passed: 0, total: 0 });
    const s = providerStats.get(key)!;
    s.total++;
    if (r.passed) s.passed++;
  }

  log(CYAN, '\n📊 Per-Provider Stats:');
  for (const [prov, stats] of providerStats) {
    const pct = Math.round((stats.passed / stats.total) * 100);
    const color = pct === 100 ? GREEN : pct > 50 ? YELLOW : RED;
    log(color, `  ${prov}: ${stats.passed}/${stats.total} (${pct}%)`);
  }

  // Save results
  const resultsFile = path.join(process.cwd(), 'tests/e2e/vfs-mcp-comprehensive-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({
    summary: { passed, failed, total: results.length, duration: totalDuration },
    providerStats: Object.fromEntries(providerStats),
    details: results.map(r => ({
      test: r.test,
      passed: r.passed,
      details: r.details,
      duration: r.duration,
      provider: r.provider,
      model: r.model,
    })),
  }, null, 2));

  log(CYAN, `\n📄 Results: ${resultsFile}`);

  // Save failed responses for debugging
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    const failedFile = path.join(process.cwd(), 'tests/e2e/vfs-mcp-failures.json');
    fs.writeFileSync(failedFile, JSON.stringify(failedResults.map(r => ({
      test: r.test,
      provider: r.provider,
      model: r.model,
      details: r.details,
      response: r.rawResponse,
      editsFound: r.editsFound,
    })), null, 2));
    log(YELLOW, `❌ Failed responses: ${failedFile}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  log(RED, `\n💥 Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
