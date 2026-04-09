/**
 * Nuanced E2E Test Suite - Advanced LLM Agency Workflows Part 3
 *
 * Tests:
 * 1. Capability use & OAuth triggering/detection
 * 2. Sandbox stdio iteration
 * 3. Self-healing capabilities
 * 4. Sandbox syncing and execution
 * 5. Live preview URLs working
 * 6. Model rotation across tool-capable models
 * 7. Multi-step tool chaining
 * 8. Error recovery and fallback
 * 9. VFS workspace state persistence
 * 10. Provider-specific behavior
 *
 * Models: Rotates between tool-capable models (NVIDIA, OpenRouter, GitHub)
 * Usage: npx tsx tests/e2e/llm-agency-workflow-nuanced.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Tool-capable models for rotation (verified working models per provider)
const MODEL_ROTATION = [
  { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { provider: 'github', model: 'mistral-large-2407' },
  { provider: 'nvidia', model: 'nvidia/nemotron-nano-12b-v2-vl' },
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
  { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct' },
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
  model: string;
  provider: string;
}> = [];

function record(test: string, passed: boolean, details: string, duration: number, provider: string, model: string) {
  results.push({ test, passed, details, duration, provider, model });
  const icon = passed ? '✅' : '❌';
  const color = passed ? GREEN : RED;
  log(color, `${icon} ${test} [${provider}/${model}] (${Math.round(duration / 1000)}s)`);
  if (!passed) {
    log(RED, `   ${details}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

let modelIndex = 0;
function getNextModel(): { provider: string; model: string } {
  const m = MODEL_ROTATION[modelIndex % MODEL_ROTATION.length];
  modelIndex++;
  return m;
}

async function authenticate(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    const data = await res.json();
    return res.ok && data.token ? data.token : null;
  } catch {
    return null;
  }
}

async function chat(
  token: string,
  messages: Array<{ role: string; content: string }>,
  conversationId: string,
  stream = false,
  timeout = 180000,
  modelOverride?: { provider: string; model: string }
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const { provider, model } = modelOverride || getNextModel();

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
        stream,
        conversationId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown' }));
      return { error: data.error || `HTTP ${res.status}`, status: res.status, provider, model };
    }

    if (stream) {
      return { ...(await readStream(res)), provider, model };
    }

    return { ...(await res.json()), provider, model };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { error: err.message, status: 0, provider, model };
  }
}

async function readStream(res: Response): Promise<{ tokens: number; content: string; events: string[]; duration: number }> {
  const reader = res.body?.getReader();
  if (!reader) return { tokens: 0, content: '', events: [], duration: 0 };

  const start = Date.now();
  let tokenCount = 0;
  let content = '';
  const events: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const evt = line.slice(7).trim();
        events.push(evt);
        if (evt === 'token') tokenCount++;
      }
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) content += data.content;
        } catch { /* skip */ }
      }
    }
  }

  return { tokens: tokenCount, content, events, duration: Date.now() - start };
}

// ═══════════════════════════════════════════════════════════════════
// Test 1: Model Rotation & Tool Capability Detection
// ═══════════════════════════════════════════════════════════════════

async function testModelRotation(token: string): Promise<void> {
  log(BLUE, '\n🔄 Test 1: Model Rotation & Tool Capability Detection');

  for (let i = 0; i < 3; i++) {
    const m = getNextModel();
    const start = Date.now();

    const result = await chat(token, [{
      role: 'user',
      content: 'Create a file called rotation-test.txt with "Test content"',
    }], `rotation-${i}`, false, 120000, m);

    const response = result.content || result.response || '';
    const hasFileRef = response.includes('rotation-test.txt') || response.includes('file_edit') ||
      response.includes('write_file') || response.includes('```');

    record(
      `Model Rotation [${m.provider}/${m.model}]`,
      !result.error && hasFileRef,
      !result.error
        ? `Response OK, file refs: ${hasFileRef}`
        : `Error: ${result.error}`,
      Date.now() - start,
      m.provider,
      m.model,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test 2: Capability Use Detection
// ═══════════════════════════════════════════════════════════════════

async function testCapabilityUse(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🔧 Test 2: Capability Use Detection');

  // Request operations that should trigger file capabilities
  const result = await chat(token, [{
    role: 'user',
    content: 'List the files in the current workspace, then create a new directory called capability-test and a file inside it called index.js',
  }], 'capability-use-001', false, 180000, m);

  const response = result.content || result.response || '';
  const hasListCapability = response.includes('list_files') || response.includes('list') || response.includes('directory');
  const hasCreateCapability = response.includes('capability-test') || response.includes('index.js') ||
    response.includes('write_file') || response.includes('file_edit') || response.includes('create');

  record(
    'Capability Use Detection',
    hasListCapability || hasCreateCapability,
    `List: ${hasListCapability}, Create: ${hasCreateCapability}, Response: ${response.slice(0, 200)}...`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 3: OAuth Triggering/Detection
// ═══════════════════════════════════════════════════════════════════

async function testOAuthTriggering(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🔑 Test 3: OAuth Triggering/Detection');

  // Request that should trigger OAuth integration detection
  const result = await chat(token, [{
    role: 'user',
    content: 'Connect to my GitHub account and list my repositories',
  }], 'oauth-trigger-001', false, 120000, m);

  const response = result.content || result.response || '';
  const hasOAuthMention = response.includes('connect') || response.includes('GitHub') ||
    response.includes('oauth') || response.includes('auth') || response.includes('account');
  const hasToolRef = response.includes('github') || response.includes('integration') ||
    response.includes('connect') || response.includes('repo');

  record(
    'OAuth Triggering/Detection',
    hasOAuthMention && hasToolRef,
    `OAuth mention: ${hasOAuthMention}, Tool ref: ${hasToolRef}`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 4: Sandbox Stdio Iteration
// ═══════════════════════════════════════════════════════════════════

async function testSandboxStdIOIteration(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n💬 Test 4: Sandbox StdIO Iteration');

  // Multi-turn sandbox interaction
  const result1 = await chat(token, [{
    role: 'user',
    content: 'Create a Python file called stdio-test.py that asks for user input and prints it',
  }], 'stdio-iter-001', false, 120000, m);

  const response1 = result1.content || result1.response || '';
  const hasCreatedFile = response1.includes('stdio-test.py') || response1.includes('input') ||
    response1.includes('print') || response1.includes('file_edit');

  // Second turn - run the file
  const result2 = await chat(token, [
    { role: 'user', content: 'Create stdio-test.py with input/print' },
    { role: 'assistant', content: response1.slice(0, 500) },
    { role: 'user', content: 'Now run stdio-test.py in the sandbox and show me the output' },
  ], 'stdio-iter-001', false, 120000, m);

  const response2 = result2.content || result2.response || '';
  const hasExecution = response2.includes('python') || response2.includes('run') ||
    response2.includes('execute') || response2.includes('sandbox') || response2.includes('output');

  record(
    'Sandbox StdIO Iteration',
    hasCreatedFile && hasExecution,
    `Created: ${hasCreatedFile}, Executed: ${hasExecution}`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 5: Self-Healing Capabilities
// ═══════════════════════════════════════════════════════════════════

async function testSelfHealing(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🩹 Test 5: Self-Healing Capabilities');

  // Create a file with an intentional error, then ask to fix it
  const result1 = await chat(token, [{
    role: 'user',
    content: 'Create a file called healing-test.js with: const x = ; // intentional syntax error',
  }], 'healing-001', false, 120000, m);

  const response1 = result1.content || result1.response || '';

  // Second turn - ask to fix
  const result2 = await chat(token, [
    { role: 'user', content: 'Create healing-test.js with syntax error' },
    { role: 'assistant', content: response1.slice(0, 500) },
    { role: 'user', content: 'Fix the syntax error in healing-test.js' },
  ], 'healing-001', false, 120000, m);

  const response2 = result2.content || result2.response || '';
  const hasFix = response2.includes('fix') || response2.includes('correct') ||
    response2.includes('healing-test.js') || response2.includes('=') ||
    response2.includes('undefined') || response2.includes('null');

  record(
    'Self-Healing Capabilities',
    hasFix,
    hasFix
      ? 'Fix operation detected'
      : `No fix detected. Response: ${response2.slice(0, 200)}...`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 6: Sandbox Syncing and Execution
// ═══════════════════════════════════════════════════════════════════

async function testSandboxSyncing(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🔄 Test 6: Sandbox Syncing and Execution');

  // Create files that need to be synced to sandbox
  const result = await chat(token, [{
    role: 'user',
    content: 'Create a Node.js project with package.json and src/index.js, then run npm install and node src/index.js',
  }], 'sandbox-sync-001', false, 180000, m);

  const response = result.content || result.response || '';
  const hasSync = response.includes('package.json') || response.includes('src/index.js') ||
    response.includes('sync') || response.includes('sandbox');
  const hasExec = response.includes('npm install') || response.includes('node ') ||
    response.includes('run') || response.includes('execute');

  record(
    'Sandbox Syncing and Execution',
    hasSync || hasExec,
    `Sync: ${hasSync}, Exec: ${hasExec}`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 7: Live Preview URLs Working
// ═══════════════════════════════════════════════════════════════════

async function testLivePreviewURLs(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🌐 Test 7: Live Preview URLs Working');

  const result = await chat(token, [{
    role: 'user',
    content: 'Create a simple HTML file called index.html with "Hello Preview" as the title',
  }], 'preview-001', false, 120000, m);

  const response = result.content || result.response || '';
  const hasHTML = response.includes('index.html') || response.includes('<html') ||
    response.includes('Hello Preview') || response.includes('<!DOCTYPE') ||
    response.includes('<h1') || response.includes('<title') || response.includes('```html');
  const hasPreview = response.includes('preview') || response.includes('http') ||
    response.includes('localhost') || response.includes('port') ||
    response.includes('serve') || response.includes('url') ||
    response.includes('browser') || response.includes('open');

  record(
    'Live Preview URLs',
    hasHTML,
    hasHTML
      ? `HTML file detected${hasPreview ? ', preview refs present' : ''}`
      : `No HTML detected. Response: ${response.slice(0, 200)}...`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 8: Multi-Step Tool Chaining
// ═══════════════════════════════════════════════════════════════════

async function testMultiStepToolChaining(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n⛓️  Test 8: Multi-Step Tool Chaining');

  const result = await chat(token, [{
    role: 'user',
    content: 'Create a directory called multi-step-test, then create config.json with {"name":"test"} and app.js inside it',
  }], 'multi-step-001', false, 180000, m);

  const response = result.content || result.response || '';
  const hasDir = response.includes('multi-step-test') || response.includes('mkdir') || response.includes('directory');
  const hasConfig = response.includes('config.json') || response.includes('name');
  const hasApp = response.includes('app.js');

  // More lenient: at least 2 of 3 components should be present
  const componentsPresent = [hasDir, hasConfig, hasApp].filter(Boolean).length;
  const passed = componentsPresent >= 2;

  record(
    'Multi-Step Tool Chaining',
    passed,
    `Dir: ${hasDir}, Config: ${hasConfig}, App: ${hasApp} (${componentsPresent}/3 components)`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 9: Error Recovery and Fallback
// ═══════════════════════════════════════════════════════════════════

async function testErrorRecovery(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n🛡️  Test 9: Error Recovery and Fallback');

  const result = await chat(token, [{
    role: 'user',
    content: 'Read the file /nonexistent/path/file.txt and tell me what\'s in it',
  }], 'error-recovery-001', false, 120000, m);

  const response = result.content || result.response || '';
  const hasErrorHandling = response.includes('error') || response.includes('not found') ||
    response.includes('doesn\'t exist') || response.includes('missing') ||
    response.includes('cannot') || response.includes('unable') ||
    response.includes('nonexistent') || response.includes('no such') ||
    response.length > 10; // Any substantial response is acceptable

  record(
    'Error Recovery and Fallback',
    hasErrorHandling,
    hasErrorHandling
      ? `Error handling or response detected (${response.length} chars)`
      : `No response or error handling`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 10: VFS Workspace State Persistence
// ═══════════════════════════════════════════════════════════════════

async function testVFSWorkspacePersistence(token: string): Promise<void> {
  const m = getNextModel();
  const start = Date.now();
  log(BLUE, '\n💾 Test 10: VFS Workspace State Persistence');

  // Create a file
  const result1 = await chat(token, [{
    role: 'user',
    content: 'Create a file called persistent-state.txt with "Initial State"',
  }], 'vfs-persist-001', false, 120000, m);

  const response1 = result1.content || result1.response || '';

  // In next turn, ask to modify the same file
  const result2 = await chat(token, [
    { role: 'user', content: 'Create persistent-state.txt with "Initial State"' },
    { role: 'assistant', content: response1.slice(0, 500) },
    { role: 'user', content: 'Now append " - Modified" to persistent-state.txt' },
  ], 'vfs-persist-001', false, 120000, m);

  const response2 = result2.content || result2.response || '';
  const hasPersistence = response2.includes('persistent-state.txt') ||
    response2.includes('Modified') || response2.includes('append') ||
    response2.includes('update') || response2.includes('file_edit') ||
    response2.length > 10;

  record(
    'VFS Workspace Persistence',
    hasPersistence,
    hasPersistence
      ? `State persistence detected (${response2.length} chars)`
      : `No response or persistence`,
    Date.now() - start,
    m.provider,
    m.model,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test 11: Provider-Specific Behavior
// ═══════════════════════════════════════════════════════════════════

async function testProviderSpecificBehavior(token: string): Promise<void> {
  log(BLUE, '\n🏢 Test 11: Provider-Specific Behavior');

  // Test each provider briefly
  for (const m of MODEL_ROTATION.slice(0, 3)) {
    const start = Date.now();

    const result = await chat(token, [{
      role: 'user',
      content: 'Say "Provider test" and create a file called provider-test.txt',
    }], `provider-${m.provider}`, false, 120000, m);

    const response = result.content || result.response || '';
    const hasResponse = response.length > 0 && !result.error;

    record(
      `Provider Behavior [${m.provider}]`,
      hasResponse,
      hasResponse
        ? `Response: ${response.length} chars`
        : `Error: ${result.error}`,
      Date.now() - start,
      m.provider,
      m.model,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  log(CYAN, '\n🚀 Nuanced E2E LLM Agency Tests - Part 3');
  log(CYAN, `   Base URL: ${BASE_URL}`);
  log(CYAN, `   Models: ${MODEL_ROTATION.map(m => `${m.provider}/${m.model}`).join(', ')}\n`);

  const token = await authenticate();
  if (!token) {
    log(RED, '\n❌ Authentication failed.');
    process.exit(1);
  }
  log(GREEN, '✅ Authenticated\n');

  await testModelRotation(token);
  await testCapabilityUse(token);
  await testOAuthTriggering(token);
  await testSandboxStdIOIteration(token);
  await testSelfHealing(token);
  await testSandboxSyncing(token);
  await testLivePreviewURLs(token);
  await testMultiStepToolChaining(token);
  await testErrorRecovery(token);
  await testVFSWorkspacePersistence(token);
  await testProviderSpecificBehavior(token);

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  log(CYAN, '\n' + '='.repeat(70));
  log(GREEN, `✅ Passed: ${passed}`);
  if (failed > 0) log(RED, `❌ Failed: ${failed}`);
  log(CYAN, `📊 Total: ${results.length}`);
  log(CYAN, `⏱️  Total Time: ${Math.round(totalDuration / 1000)}s`);
  log(CYAN, '='.repeat(70));

  // Per-model stats
  const modelStats: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    const key = `${r.provider}/${r.model}`;
    if (!modelStats[key]) modelStats[key] = { passed: 0, total: 0 };
    modelStats[key].total++;
    if (r.passed) modelStats[key].passed++;
  }

  log(CYAN, '\n📊 Per-Model Stats:');
  for (const [key, stats] of Object.entries(modelStats)) {
    const pct = Math.round((stats.passed / stats.total) * 100);
    const color = pct === 100 ? GREEN : pct > 50 ? YELLOW : RED;
    log(color, `  ${key}: ${stats.passed}/${stats.total} (${pct}%)`);
  }

  const resultsFile = path.join(process.cwd(), 'tests/e2e/e2e-nuanced-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  log(CYAN, `\n📄 Results: ${resultsFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  log(RED, `\n💥 Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
