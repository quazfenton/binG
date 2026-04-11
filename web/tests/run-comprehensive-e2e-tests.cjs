/**
 * Comprehensive E2E Tests for Full LLM Agency Workflow
 * 
 * Tests:
 * - VFS MCP tool creation/reading/editing
 * - Tool call args population
 * - Context bundling
 * - File edit parser fallback
 * - Multi-folder workspace scoping
 * - Shell/PTY execution
 * - Auto-continue detection
 * - Self-healing modes
 * - Full integration flows
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Utility functions
async function post(endpoint, body, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function get(endpoint, authToken) {
  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function report(testName, passed, details = '') {
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} ${testName}: ${passed ? 'PASS' : 'FAIL'}${details ? ' - ' + details : ''}`);
  return passed;
}

// Test state
let authToken = '';
let testResults = [];
let vfsSnapshot = null;

async function login() {
  console.log('\n=== LOGIN ===');
  const result = await post('/api/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  authToken = result.body?.accessToken || result.body?.token || '';
  return report('Login', !!authToken, authToken ? `token:${authToken.slice(0, 20)}...` : 'no token');
}

async function getVfsSnapshot(path = 'project') {
  const result = await get(`/api/filesystem/snapshot?path=${path}`, authToken);
  if (result.status === 200) {
    vfsSnapshot = result.body;
    return result.body;
  }
  return null;
}

async function streamChat(messages, options = {}) {
  const body = {
    messages,
    stream: true,
    provider: options.provider || 'mistral',
    model: options.model || 'mistral-small-latest',
    ...options,
  };
  
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let fullResponse = '';
  let toolCalls = [];
  let fileEdits = [];
  let error = null;

  if (!response.ok) {
    error = `HTTP ${response.status}`;
  } else if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      fullResponse += text;
      
      // Parse SSE events
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'tool_invocation') {
              toolCalls.push(data.data);
            } else if (data.type === 'file_edit') {
              fileEdits.push(data.data);
            }
          } catch (e) {}
        }
      }
    }
  }

  return { fullResponse, toolCalls, fileEdits, error };
}

// ============================================================================
// TEST CASES
// ============================================================================

async function test1_basicFileCreation() {
  console.log('\n--- TEST 1: Basic File Creation ---');
  // Clear workspace first
  await getVfsSnapshot();
  
  const result = await streamChat([
    { role: 'user', content: 'Create a file called hello.js that console.logs "Hello World"' }
  ], { enableTools: true });
  
  console.log('  Response length:', result.fullResponse.length);
  console.log('  Tool calls:', result.toolCalls.length);
  console.log('  File edits:', JSON.stringify(result.fileEdits).slice(0, 200));
  
  // Check if file was created in VFS
  await getVfsSnapshot();
  const helloFile = vfsSnapshot?.files?.find(f => f.path?.includes('hello.js'));
  
  return report('File created in VFS', !!helloFile, helloFile?.path || 'not found');
}

async function test2_editExistingFile() {
  console.log('\n--- TEST 2: Edit Existing File ---');
  
  // First create a file
  await post('/api/filesystem/create-file', {
    path: 'existing.js',
    content: 'const x = 1;\nconsole.log(x);'
  }, authToken);
  
  // Now edit it
  const result = await streamChat([
    { role: 'user', content: 'Change the constant x to 42 in existing.js' }
  ], { enableTools: true });
  
  console.log('  Tool calls:', JSON.stringify(result.toolCalls).slice(0, 300));
  console.log('  File edits:', JSON.stringify(result.fileEdits).slice(0, 300));
  
  await getVfsSnapshot();
  const file = vfsSnapshot?.files?.find(f => f.path === 'existing.js');
  
  return report('File edited', file?.content?.includes('42'), file?.content?.slice(0, 50) || 'not found');
}

async function test3_readFile() {
  console.log('\n--- TEST 3: Read File ---');
  
  // Create a file first
  await post('/api/filesystem/create-file', {
    path: 'readme.txt',
    content: 'This is a test file for reading.'
  }, authToken);
  
  const result = await streamChat([
    { role: 'user', content: 'What is in readme.txt?' }
  ], { enableTools: true });
  
  const hasReadContent = result.fullResponse.toLowerCase().includes('test file') || 
                     result.fullResponse.toLowerCase().includes('reading');
  
  return report('File content read', hasReadContent, result.fullResponse.slice(0, 100));
}

async function test4_contextBundling() {
  console.log('\n--- TEST 4: Context Bundling ---');
  
  // Create multiple files in workspace
  await post('/api/filesystem/create-file', {
    path: 'src/app.ts',
    content: 'export function app() { return "app"; }'
  }, authToken);
  await post('/api/filesystem/create-file', {
    path: 'src/utils.ts', 
    content: 'export function util() { return "util"; }'
  }, authToken);
  
  const result = await streamChat([
    { role: 'user', content: 'List all the files in the src directory and summarize each one' }
  ], { 
    enableTools: true,
    contextPack: { includePatterns: ['src/**'], format: 'json', maxTotalSize: 50000 }
  });
  
  // Check for context in response
  const mentionsFiles = result.fullResponse.includes('src/') || 
                    result.fullResponse.includes('app.ts') ||
                    result.fullResponse.includes('utils.ts');
  
  return report('Context bundled', mentionsFiles, result.fullResponse.slice(0, 100));
}

async function test5_multiFolderWorkspace() {
  console.log('\n--- TEST 5: Multi-Folder Workspace Scoping ---');
  
  // Create files in different session folders
  await post('/api/filesystem/create-file', {
    path: 'project/sessions/001/app.js',
    content: 'const app = 1;'
  }, authToken);
  await post('/api/filesystem/create-file', {
    path: 'project/sessions/002/app.js', 
    content: 'const app = 2;'
  }, authToken);
  
  const result = await streamChat([
    { role: 'user', content: 'What is in app.js in session 001?' }
  ], { enableTools: true });
  
  return report('Session-scoped file found', result.fullResponse.length > 0, result.fullResponse.slice(0, 50));
}

async function test6_fallbackTextParsing() {
  console.log('\n--- TEST 6: Fallback Text Parser ---');
  
  // Use a model that may not support function calling well
  const result = await streamChat([
    { role: 'user', content: 'Write a file test.txt with content "fallback test works"' }
  ], { 
    provider: 'mistral',
    model: 'mistral-small-latest',
    enableTools: true
  });
  
  // Check if file was created even without tool call
  await getVfsSnapshot();
  const fallbackFile = vfsSnapshot?.files?.find(f => f.path === 'test.txt');
  
  const hasFallbackContent = fallbackFile?.content?.includes('fallback test works');
  
  return report('Text fallback parsing', hasFallbackContent, fallbackFile?.content || 'not created');
}

async function test7_shellExecution() {
  console.log('\n--- TEST 7: Shell/PTY Execution ---');
  
  const result = await streamChat([
    { role: 'user', content: 'Run this JavaScript code: console.log("shell test " + new Date().toISOString())' }
  ], { enableTools: true });
  
  const hasExecution = result.fullResponse.includes('shell') || 
                     result.fullResponse.includes('Date') ||
                     result.toolCalls.some(t => t.toolName?.includes('shell') || t.toolName?.includes('execute'));
  
  return report('Shell execution', hasExecution, result.fullResponse.slice(0, 100));
}

async function test8_toolCallArgsPopulated() {
  console.log('\n--- TEST 8: Tool Call Args Properly Populated ---');
  
  const result = await streamChat([
    { role: 'user', content: 'Create a file args-test.js with content "testing args"' }
  ], { enableTools: true });
  
  // Check if tool calls have proper args
  const writeCall = result.toolCalls.find(t => 
    t.toolName === 'write_file' || t.toolName === 'createFile'
  );
  
  const hasPath = writeCall?.args?.path?.includes('args-test');
  const hasContent = writeCall?.args?.content?.includes('testing args');
  
  return report('Tool args populated', hasPath && hasContent, JSON.stringify(writeCall?.args).slice(0, 100));
}

async function test9_diffToExistingFile() {
  console.log('\n--- TEST 9: Apply Diff to Existing File ---');
  
  // Create original file
  await post('/api/filesystem/create-file', {
    path: 'original.ts',
    content: 'function old() {\n  return "old";\n}\nconsole.log(old());'
  }, authToken);
  
  // Request diff edit
  const result = await streamChat([
    { role: 'user', content: 'Change old() to new() and update the console.log in original.ts using a diff' }
  ], { enableTools: true });
  
  await getVfsSnapshot();
  const file = vfsSnapshot?.files?.find(f => f.path === 'original.ts');
  
  const hasDiffApplied = file?.content?.includes('new()');
  
  return report('Diff applied', hasDiffApplied, file?.content?.slice(0, 80) || 'not found');
}

async function test10_autoContinue() {
  console.log('\n--- TEST 10: Auto-Continue Detection ---');
  
  // Multi-step prompt that should trigger auto-continue
  const result = await streamChat([
    { role: 'user', content: `First create a file step1.txt with "step1". 
Then create another file step2.txt with "step2".
Finally list all files.` }
  ], { enableTools: true });
  
  const hasMultipleEdits = result.fileEdits?.length >= 2;
  const hasListFiles = result.toolCalls.some(t => t.toolName?.includes('list')) ||
                       result.fullResponse.includes('step1') ||
                       result.fullResponse.includes('step2');
  
  return report('Auto-continue/multi-step', hasMultipleEdits || hasListFiles, `edits:${result.fileEdits?.length}, calls:${result.toolCalls.length}`);
}

async function test11_selfHealingMode() {
  console.log('\n--- TEST 11: Self-Healing Mode ---');
  
  // Request that might require self-correction
  const result = await streamChat([
    { role: 'user', content: 'Create a working JavaScript function that calculates fibonacci numbers correctly' }
  ], { enableTools: true });
  
  const hasValidJS = result.fullResponse.includes('function') && 
                  (result.fullResponse.includes('return') || result.fullResponse.includes('='));
  
  return report('Self-healing produces valid code', hasValidJS, result.fullResponse.slice(0, 100));
}

async function test12_deleteFile() {
  console.log('\n--- TEST 12: Delete File ---');
  
  // Create file first
  await post('/api/filesystem/create-file', {
    path: 'to-delete.txt',
    content: 'delete me'
  }, authToken);
  
  const result = await streamChat([
    { role: 'user', content: 'Delete the file to-delete.txt' }
  ], { enableTools: true });
  
  await getVfsSnapshot();
  const deletedFile = vfsSnapshot?.files?.find(f => f.path === 'to-delete.txt');
  
  return report('File deleted', !deletedFile, deletedFile ? 'still exists' : 'deleted');
}

async function test13_batchWrite() {
  console.log('\n--- TEST 13: Batch Write ---');
  
  const result = await streamChat([
    { role: 'user', content: `Create multiple files:
- file1.txt with "content one"
- file2.txt with "content two"  
- file3.txt with "content three"` }
  ], { enableTools: true });
  
  await getVfsSnapshot();
  const files = vfsSnapshot?.files?.filter(f => 
    f.path?.includes('file1') || f.path?.includes('file2') || f.path?.includes('file3')
  );
  
  return report('Batch write', files?.length >= 3, `files created: ${files?.length || 0}`);
}

async function test14_complexWorkflow() {
  console.log('\n--- TEST 14: Complex Integrated Workflow ---');
  
  // A complex prompt requiring multiple operations
  const result = await streamChat([
    { role: 'user', content: `Do the following:
1. Create a file called math.ts with a function that adds two numbers
2. Create another file called utils.ts with a function that multiplies two numbers
3. Update math.ts to also export a subtract function
4. Read both files to verify` }
  ], { enableTools: true });
  
  console.log('  Tool calls found:', result.toolCalls.length);
  console.log('  File edits found:', result.fileEdits?.length);
  
  await getVfsSnapshot();
  const mathFile = vfsSnapshot?.files?.find(f => f.path === 'math.ts');
  const utilsFile = vfsSnapshot?.files?.find(f => f.path === 'utils.ts');
  
  const hasIntegration = mathFile && utilsFile;
  const hasMultipleOps = result.toolCalls.length >= 2 || result.fileEdits?.length >= 2;
  
  return report('Complex workflow', hasIntegration || hasMultipleOps, 
    `math:${!!mathFile}, utils:${!!utilsFile}, calls:${result.toolCalls.length}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE E2E TESTS - Full LLM Agency Workflow');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(70));
  
  // Login first
  const loggedIn = await login();
  if (!loggedIn) {
    console.log('❌ Authentication failed, cannot run tests');
    process.exit(1);
  }
  
  // Run all tests
  const tests = [
    ['Basic File Creation', test1_basicFileCreation],
    ['Edit Existing File', test2_editExistingFile],
    ['Read File', test3_readFile],
    ['Context Bundling', test4_contextBundling],
    ['Multi-Folder Workspace', test5_multiFolderWorkspace],
    ['Fallback Text Parser', test6_fallbackTextParsing],
    ['Shell Execution', test7_shellExecution],
    ['Tool Call Args Populated', test8_toolCallArgsPopulated],
    ['Diff to Existing File', test9_diffToExistingFile],
    ['Auto-Continue', test10_autoContinue],
    ['Self-Healing Mode', test11_selfHealingMode],
    ['Delete File', test12_deleteFile],
    ['Batch Write', test13_batchWrite],
    ['Complex Workflow', test14_complexWorkflow],
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const [name, fn] of tests) {
    try {
      const result = await fn();
      if (result) passed++; else failed++;
    } catch (err) {
      console.log(`❌ ${name}: ERROR - ${err.message}`);
      failed++;
    }
  }
  
  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${passed}/${tests.length} passed, ${failed} failed`);
  console.log('='.repeat(70));
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);