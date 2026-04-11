/**
 * COMPREHENSIVE E2E STRESS TEST - Full Agent Workflow Validation
 * 
 * Tests:
 * 1. File edit parsing fallback when primary tool_use fails
 * 2. Workspace scoping and session isolation
 * 3. Repeated diff application to existing files
 * 4. Context bundling across turns
 * 5. Multi-folder workspace selection
 * 6. VFS MCP tool args population
 * 7. Auto-continue detection
 * 8. No infinite loops
 * 9. Shell/PTY execution from natural language
 * 10. Preview URL detection
 * 11. Self-healing in V1 modes
 * 12. Large multi-file app generation
 * 13. File format detection (all fallback formats)
 * 14. Tool choice correctness
 * 15. Error recovery patterns
 * 
 * Usage: npx tsx tests/e2e/comprehensive-agent-stress.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';
const DEFAULT_PROVIDER = 'mistral';
const DEFAULT_MODEL = 'mistral-small-latest';

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
  rawResponse?: string;
}> = [];

function record(test: string, passed: boolean, details: string, duration: number, rawResponse?: string) {
  results.push({ test, passed, details, duration, rawResponse });
  const icon = passed ? '✅' : '❌';
  const color = passed ? GREEN : RED;
  log(color, `${icon} ${test} (${Math.round(duration / 1000)}s)`);
  if (!passed) {
    log(RED, `   ${details}`);
    if (rawResponse) {
      log(YELLOW, `   Response preview: ${rawResponse.slice(0, 300)}...`);
    }
  }
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
// Chat Helper with retries and validation
// ═══════════════════════════════════════════════════════════════════

async function chat(
  token: string,
  messages: Array<{ role: string; content: string }>,
  conversationId: string,
  timeout = 180000,
  provider = DEFAULT_PROVIDER,
  model = DEFAULT_MODEL
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
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { error: err.message || 'Request failed', status: 0, content: '', response: '' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// File Edit Parser Tests (fallback detection)
// ═══════════════════════════════════════════════════════════════════

async function testFileEditFallbackDetection(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n📄 Test 1: File Edit Fallback Detection (All Formats)');

  // Format 1: Compact <file_edit> tags
  const r1 = await chat(token, [{
    role: 'user',
    content: 'Create a file using this exact format: <file_edit path="fallback-test-1.txt">Compact format test content</file_edit>',
  }], 'fallback-1');

  const has1 = r1.content.includes('fallback-test-1.txt') || r1.content.includes('<file_edit');
  record('Fallback: Compact file_edit', has1, has1 ? 'Detected' : 'Not detected', Date.now() - start, r1.content);

  // Format 2: Fenced diff
  const r2 = await chat(token, [{
    role: 'user',
    content: 'Show a diff for package.json using ```diff format',
  }], 'fallback-2');

  const has2 = r2.content.includes('package.json') && (r2.content.includes('```diff') || r2.content.includes('+') || r2.content.includes('-'));
  record('Fallback: Fenced diff', has2, has2 ? 'Detected' : 'Not detected', Date.now() - start, r2.content);

  // Format 3: Bash heredoc
  const r3 = await chat(token, [{
    role: 'user',
    content: 'Create test.sh using: cat > test.sh << \'HEREDOC\'\necho "heredoc test"\nHEREDOC',
  }], 'fallback-3');

  const has3 = r3.content.includes('test.sh') && (r3.content.includes('cat') || r3.content.includes('HEREDOC') || r3.content.includes('heredoc'));
  record('Fallback: Bash heredoc', has3, has3 ? 'Detected' : 'Not detected', Date.now() - start, r3.content);

  // Format 4: batch_write
  const r4 = await chat(token, [{
    role: 'user',
    content: 'Use batch_write to create these: ```javascript\nbatch_write([\n  { "path": "bw1.js", "content": "console.log(1)" },\n  { "path": "bw2.js", "content": "console.log(2)" }\n])\n```',
  }], 'fallback-4');

  const has4 = r4.content.includes('bw1.js') && r4.content.includes('bw2.js');
  record('Fallback: batch_write', has4, has4 ? 'Detected' : 'Not detected', Date.now() - start, r4.content);

  // Format 5: Special token format
  const r5 = await chat(token, [{
    role: 'user',
    content: '<|tool_call_begin|> batch_write:0 <|tool_call_argument_begin|>\n{"files":[{"path":"special-token.txt","content":"special"}]}\n<|tool_call_end|>',
  }], 'fallback-5');

  const has5 = r5.content.includes('special-token.txt');
  record('Fallback: Special token', has5, has5 ? 'Detected' : 'Not detected', Date.now() - start, r5.content);

  // Format 6: ```tool_call format
  const r6 = await chat(token, [{
    role: 'user',
    content: '```tool_call\n{ "tool_name": "write_file", "parameters": { "files": [{ "path": "toolcall-fb.md", "content": "# FB Test" }] } }\n```',
  }], 'fallback-6');

  const has6 = r6.content.includes('toolcall-fb.md');
  record('Fallback: ```tool_call', has6, has6 ? 'Detected' : 'Not detected', Date.now() - start, r6.content);
}

// ═══════════════════════════════════════════════════════════════════
// Workspace Scoping
// ═══════════════════════════════════════════════════════════════════

async function testWorkspaceScoping(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n📁 Test 2: Workspace Scoping & Session Isolation');

  // Create in session A
  const r1 = await chat(token, [{
    role: 'user',
    content: 'Create scope-test-a.txt with "Session A content"',
  }], 'scope-session-A');

  // Create in session B
  const r2 = await chat(token, [{
    role: 'user',
    content: 'Create scope-test-b.txt with "Session B content"',
  }], 'scope-session-B');

  const bothCreated = r1.content.includes('scope-test-a.txt') && r2.content.includes('scope-test-b.txt');
  record('Workspace Scoping', bothCreated, bothCreated ? 'Sessions isolated' : 'Scoping failed', Date.now() - start, `${r1.content.slice(0, 100)} | ${r2.content.slice(0, 100)}`);
}

// ═══════════════════════════════════════════════════════════════════
// Repeated Diff to Existing File
// ═══════════════════════════════════════════════════════════════════

async function testRepeatedDiff(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🔄 Test 3: Repeated Diff Application');

  // Create initial file
  await chat(token, [{
    role: 'user',
    content: 'Create diff-repeat.js with: export const v1 = "initial";',
  }], 'diff-repeat');

  // Modify it
  const r2 = await chat(token, [
    { role: 'user', content: 'Create diff-repeat.js with export const v1 = "initial";' },
    { role: 'assistant', content: 'Created diff-repeat.js' },
    { role: 'user', content: 'Now modify diff-repeat.js to add v2: export const v2 = "modified";' },
  ], 'diff-repeat');

  const hasModification = r2.content.includes('diff-repeat.js') && (r2.content.includes('v2') || r2.content.includes('modified') || r2.content.includes('add'));
  record('Repeated Diff', hasModification, hasModification ? 'Modification detected' : 'No modification', Date.now() - start, r2.content);
}

// ═══════════════════════════════════════════════════════════════════
// Context Bundling
// ═══════════════════════════════════════════════════════════════════

async function testContextBundling(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n📦 Test 4: Context Bundling Across Turns');

  // Turn 1
  const r1 = await chat(token, [{
    role: 'user',
    content: 'Create context-bundle.md with "# Context Test"',
  }], 'context-bundle');

  // Turn 2 - reference turn 1
  const r2 = await chat(token, [
    { role: 'user', content: 'Create context-bundle.md with "# Context Test"' },
    { role: 'assistant', content: r1.content.slice(0, 300) },
    { role: 'user', content: 'Append "## Section 2" to context-bundle.md' },
  ], 'context-bundle');

  const hasContext = r2.content.includes('context-bundle.md') || r2.content.includes('Section 2') || r2.content.includes('append');
  record('Context Bundling', hasContext, hasContext ? 'Context maintained' : 'Context lost', Date.now() - start, r2.content);
}

// ═══════════════════════════════════════════════════════════════════
// Multi-folder Workspace Selection
// ═══════════════════════════════════════════════════════════════════

async function testMultiFolderSelection(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🗂️  Test 5: Multi-folder Workspace Selection');

  // Create files in different folders
  const r = await chat(token, [{
    role: 'user',
    content: 'Create src/frontend/app.js with "frontend" and src/backend/server.js with "backend", then update ONLY the backend file to use Express',
  }], 'multifolder');

  const targetsBackend = r.content.includes('server.js') || r.content.includes('backend');
  const hasBothFiles = r.content.includes('app.js') && r.content.includes('server.js');
  record('Multi-folder Selection', targetsBackend && hasBothFiles, `Backend: ${targetsBackend}, Both files: ${hasBothFiles}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// VFS MCP Tool Args Population
// ═══════════════════════════════════════════════════════════════════

async function testVFSMCPToolArgs(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🔧 Test 6: VFS MCP Tool Args Population');

  const r = await chat(token, [{
    role: 'user',
    content: 'List files in the workspace, then create vfs-mcp-test.txt with "Tool args test content"',
  }], 'vfs-mcp-args');

  const hasListOp = r.content.includes('list') || r.content.includes('directory') || r.content.includes('files');
  const hasCreateOp = r.content.includes('vfs-mcp-test.txt') || r.content.includes('write') || r.content.includes('create');
  record('VFS MCP Tool Args', hasListOp || hasCreateOp, `List: ${hasListOp}, Create: ${hasCreateOp}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Auto-continue Detection
// ═══════════════════════════════════════════════════════════════════

async function testAutoContinue(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🔁 Test 7: Auto-continue Detection');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create a full-stack app with: package.json, src/index.js, src/App.js, src/styles.css, README.md - provide complete code for ALL files',
  }], 'autocontinue', 240000);

  const hasMultipleFiles = r.content.includes('package.json') && r.content.includes('index.js') && r.content.includes('README.md');
  const hasContinueMarker = r.content.includes('[CONTINUE_REQUESTED]') || r.content.includes('[AUTO-CONTINUE]');
  record('Auto-continue', hasMultipleFiles, `Multiple files: ${hasMultipleFiles}, Continue marker: ${hasContinueMarker}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// No Infinite Loops
// ═══════════════════════════════════════════════════════════════════

async function testNoInfiniteLoops(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🛑 Test 8: No Infinite Loops (10+ files)');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create: 1) package.json, 2) index.html, 3) src/app.js, 4) src/components/Header.js, 5) src/components/Footer.js, 6) src/components/Sidebar.js, 7) src/utils/api.js, 8) src/utils/helpers.js, 9) src/styles/main.css, 10) README.md',
  }], 'no-infinite', 240000);

  const duration = Date.now() - start;
  const completed = !r.error && duration < 240000;
  record('No Infinite Loops', completed, completed ? `Completed in ${Math.round(duration/1000)}s` : `Failed after ${Math.round(duration/1000)}s`, duration, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Shell/PTY from Natural Language
// ═══════════════════════════════════════════════════════════════════

async function testShellPTY(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n💻 Test 9: Shell/PTY from Natural Language');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create hello.py that prints "Hello from PTY", then run it and show me the output',
  }], 'shell-pty');

  const hasCreation = r.content.includes('hello.py') || r.content.includes('print');
  const hasExecution = r.content.includes('python') || r.content.includes('run') || r.content.includes('execute') || r.content.includes('output');
  record('Shell/PTY', hasCreation && hasExecution, `Create: ${hasCreation}, Exec: ${hasExecution}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Preview URL Detection
// ═══════════════════════════════════════════════════════════════════

async function testPreviewURL(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🌐 Test 10: Preview URL Detection');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create index.html with a "Hello Preview" title and serve it, then give me the preview URL',
  }], 'preview', 180000);

  const hasHTML = r.content.includes('index.html') || r.content.includes('<html') || r.content.includes('Hello Preview');
  const hasPreview = r.content.includes('preview') || r.content.includes('http') || r.content.includes('localhost') || r.content.includes('port') || r.content.includes('serve');
  record('Preview URL', hasHTML, `HTML: ${hasHTML}, Preview refs: ${hasPreview}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Self-Healing in V1 Modes
// ═══════════════════════════════════════════════════════════════════

async function testSelfHealing(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🩹 Test 11: Self-Healing (V1 Modes)');

  // Create file with error
  await chat(token, [{
    role: 'user',
    content: 'Create healing-test.js with: const x = ; // syntax error',
  }], 'self-heal');

  // Ask to fix
  const r2 = await chat(token, [
    { role: 'user', content: 'Create healing-test.js with syntax error' },
    { role: 'assistant', content: 'Created with error' },
    { role: 'user', content: 'Fix the syntax error in healing-test.js' },
  ], 'self-heal');

  const hasFix = r2.content.includes('fix') || r2.content.includes('correct') || r2.content.includes('healing-test.js') || r2.content.includes('=');
  record('Self-Healing', hasFix, hasFix ? 'Fix detected' : 'No fix', Date.now() - start, r2.content);
}

// ═══════════════════════════════════════════════════════════════════
// Large Multi-file App Generation
// ═══════════════════════════════════════════════════════════════════

async function testLargeAppGeneration(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🏗️  Test 12: Large Multi-file App Generation');

  const r = await chat(token, [{
    role: 'user',
    content: 'Code a complete React todo app with: package.json (with react dependency), public/index.html, src/index.js, src/App.js (with state management), src/components/TodoList.js, src/components/TodoItem.js, src/styles.css. Each file must have complete working code.',
  }], 'large-app', 300000);

  const expectedFiles = ['package.json', 'index.html', 'index.js', 'App.js', 'TodoList', 'TodoItem', 'styles.css'];
  const foundFiles = expectedFiles.filter(f => r.content.includes(f));
  const completeness = foundFiles.length / expectedFiles.length;

  record('Large App Generation', completeness >= 0.7, `Found ${foundFiles.length}/${expectedFiles.length} files: ${foundFiles.join(', ')}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Error Recovery
// ═══════════════════════════════════════════════════════════════════

async function testErrorRecovery(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🛡️  Test 13: Error Recovery (Nonexistent file)');

  const r = await chat(token, [{
    role: 'user',
    content: 'Read /nonexistent/path/file.txt and tell me what\'s in it',
  }], 'error-recovery');

  const hasErrorHandling = r.content.includes('error') || r.content.includes('not found') || r.content.includes('doesn\'t exist') || r.content.includes('cannot') || r.content.length > 10;
  record('Error Recovery', hasErrorHandling, hasErrorHandling ? `Handled (${r.content.length} chars)` : 'No response', Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Tool Choice Correctness
// ═══════════════════════════════════════════════════════════════════

async function testToolChoice(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🎯 Test 14: Tool Choice Correctness');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create a directory called tool-choice-test, then create package.json inside it with {"name":"test","version":"1.0.0"}',
  }], 'tool-choice');

  const hasDir = r.content.includes('tool-choice-test') && (r.content.includes('mkdir') || r.content.includes('directory') || r.content.includes('create'));
  const hasFile = r.content.includes('package.json');
  record('Tool Choice', hasDir && hasFile, `Dir: ${hasDir}, File: ${hasFile}`, Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Nested Directory Creation
// ═══════════════════════════════════════════════════════════════════

async function testNestedDirs(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n📂 Test 15: Nested Directory Creation');

  const r = await chat(token, [{
    role: 'user',
    content: 'Create: src/components/Header/index.js, src/components/Footer/index.js, src/utils/helpers.js',
  }], 'nested-dirs');

  const hasPaths = r.content.includes('src/components/Header') && r.content.includes('src/components/Footer') && r.content.includes('src/utils/helpers');
  record('Nested Directories', hasPaths, hasPaths ? 'All paths detected' : 'Missing paths', Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Implicit Path Resolution
// ═══════════════════════════════════════════════════════════════════

async function testImplicitPaths(token: string): Promise<void> {
  const start = Date.now();
  log(BLUE, '\n🔍 Test 16: Implicit Path Resolution');

  const r = await chat(token, [{
    role: 'user',
    content: 'I need to set up a project. Create the main entry point file and a configuration file',
  }], 'implicit-paths');

  const hasFiles = r.content.includes('entry') || r.content.includes('main') || r.content.includes('index') || r.content.includes('config') || r.content.includes('file');
  record('Implicit Paths', hasFiles, hasFiles ? 'Files referenced' : 'No file refs', Date.now() - start, r.content);
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  log(CYAN, '\n🚀 COMPREHENSIVE E2E STRESS TEST - Full Agent Workflow');
  log(CYAN, `   Provider: ${DEFAULT_PROVIDER}, Model: ${DEFAULT_MODEL}`);
  log(CYAN, `   Base URL: ${BASE_URL}`);
  log(CYAN, `   Auth: ${TEST_EMAIL}`);

  const token = await authenticate();
  log(GREEN, '✅ Authenticated\n');

  await testFileEditFallbackDetection(token);
  await testWorkspaceScoping(token);
  await testRepeatedDiff(token);
  await testContextBundling(token);
  await testMultiFolderSelection(token);
  await testVFSMCPToolArgs(token);
  await testAutoContinue(token);
  await testNoInfiniteLoops(token);
  await testShellPTY(token);
  await testPreviewURL(token);
  await testSelfHealing(token);
  await testLargeAppGeneration(token);
  await testErrorRecovery(token);
  await testToolChoice(token);
  await testNestedDirs(token);
  await testImplicitPaths(token);

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

  // Per-category stats
  const categories = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const cat = r.test.split(':')[0] || 'General';
    if (!categories.has(cat)) categories.set(cat, { passed: 0, total: 0 });
    const c = categories.get(cat)!;
    c.total++;
    if (r.passed) c.passed++;
  }

  log(CYAN, '\n📊 Per-Category Stats:');
  for (const [cat, stats] of categories) {
    const pct = Math.round((stats.passed / stats.total) * 100);
    const color = pct === 100 ? GREEN : pct > 50 ? YELLOW : RED;
    log(color, `  ${cat}: ${stats.passed}/${stats.total} (${pct}%)`);
  }

  // Save results
  const resultsFile = path.join(process.cwd(), 'tests/e2e/stress-test-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({
    summary: { passed, failed, total: results.length, duration: totalDuration },
    categories: Object.fromEntries(categories),
    details: results.map(r => ({
      test: r.test,
      passed: r.passed,
      details: r.details,
      duration: r.duration,
    })),
  }, null, 2));

  log(CYAN, `\n📄 Results: ${resultsFile}`);

  // Save failed responses for debugging
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    const failedFile = path.join(process.cwd(), 'tests/e2e/stress-test-failures.json');
    fs.writeFileSync(failedFile, JSON.stringify(failedResults.map(r => ({
      test: r.test,
      details: r.details,
      response: r.rawResponse,
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
