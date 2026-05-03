/**
 * Comprehensive E2E Test Suite for LLM Full Workflow
 * Tests actual LLM prompting, tool calls, file operations, VFS MCP, shell execution
 * Run: node test-comprehensive-e2e.cjs
 * 
 * Uses Mistral provider (mistral-small-latest) for LLM calls
 */

const API_BASE = 'http://localhost:3000';

// Test credentials
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSection(title) {
  log(`\n${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}`, 'blue');
  log(`${colors.bold}${colors.blue}${title}${colors.reset}`, 'blue');
  log(`${colors.bold}${colors.blue}${'='.repeat(60)}${colors.reset}`, 'blue');
}

function logResult(name, passed, details = '') {
  if (passed) {
    log(`  ${colors.green}PASS${colors.reset} ${name}`, passed ? 'green' : 'red');
  } else {
    log(`  ${colors.red}FAIL${colors.reset} ${name}`, 'red');
  }
  if (details) {
    log(`       ${details}`, 'yellow');
  }
}

// ==================== API HELPERS ====================

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });
  const data = await res.json();
  return data;
}

async function chat(message, token, options = {}) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      provider: options.provider || 'mistral',
      model: options.model || 'mistral-small-latest',
      stream: options.stream !== undefined ? options.stream : false,
      ...options
    })
  });
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return { text: await res.text() };
}

async function vfsRead(path, token) {
  const res = await fetch(`${API_BASE}/api/vfs/read`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path, ownerId: TEST_EMAIL })
  });
  return res.ok ? res.json() : null;
}

async function vfsList(token, path = '') {
  const res = await fetch(`${API_BASE}/api/vfs/list`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path, ownerId: TEST_EMAIL })
  });
  return res.ok ? res.json() : null;
}

async function vfsWrite(path, content, token) {
  const res = await fetch(`${API_BASE}/api/vfs/write`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path, content, ownerId: TEST_EMAIL })
  });
  return res.ok ? res.json() : null;
}

async function vfsDelete(path, token) {
  const res = await fetch(`${API_BASE}/api/vfs/delete`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path, ownerId: TEST_EMAIL })
  });
  return res.ok ? res.json() : null;
}

async function createConversation(token, title = 'E2E Test Conversation') {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ title })
  });
  return res.ok ? res.json() : null;
}

// ==================== TESTS ====================

async function test1_FileCreationBasic(token) {
  logSection('TEST 1: Basic File Creation');
  
  // Clean up any existing test file
  await vfsDelete('test-e2e-1.js', token).catch(() => {});
  
  const result = await chat(
    'Create a file called test-e2e-1.js with content: console.log("E2E Test 1 - Basic File Creation Working!");',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red', result.success ? 'green' : 'red');
  log('Has content:', result.content ? 'green' : 'red', result.content ? 'green' : 'red');
  
  // Check if file was actually created in VFS
  const file = await vfsRead('test-e2e-1.js', token);
  log('File in VFS:', file ? 'green' : 'red', file ? 'green' : 'red');
  
  if (file && file.content) {
    log('File content includes expected string:', 
      file.content.includes('E2E Test 1') ? 'green' : 'red',
      file.content.includes('E2E Test 1') ? 'green' : 'red');
  }
  
  return result.success === true && !!file;
}

async function test2_FileEditExisting(token) {
  logSection('TEST 2: Edit Existing File (Diff Application)');
  
  // First create a file
  await vfsWrite('test-e2e-2.js', 'const original = "hello";\nconsole.log(original);', token);
  
  // Now ask LLM to modify it
  const result = await chat(
    'Change the file test-e2e-2.js to say "world" instead of "hello" in the original variable',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red', result.success ? 'green' : 'red');
  
  // Check the file was modified
  const file = await vfsRead('test-e2e-2.js', token);
  log('File exists:', file ? 'green' : 'red');
  
  if (file && file.content) {
    const hasWorld = file.content.includes('world');
    const noHello = !file.content.includes('hello');
    log('Content updated correctly:', hasWorld && noHello ? 'green' : 'red');
    log(`  Content preview: ${file.content.substring(0, 100)}`, 'cyan');
  }
  
  return result.success === true;
}

async function test3_MultiFileWorkspace(token) {
  logSection('TEST 3: Multi-file Workspace Operations');
  
  // Create multiple files in different "directories" (paths)
  await vfsWrite('test-e2e-3-main.js', '// Main entry point', token).catch(() => {});
  await vfsWrite('test-e2e-3-utils.js', '// Utility functions', token).catch(() => {});
  await vfsWrite('test-e2e-3-config.json', '{"setting": "value"}', token).catch(() => {});
  
  // Ask LLM to work with specific files without explicit full path
  const result = await chat(
    'Read the utils file (test-e2e-3-utils.js) and create a new file called test-e2e-3-output.txt with the content "Utils file had: " followed by what you read',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Check the new file was created
  const outputFile = await vfsRead('test-e2e-3-output.txt', token);
  log('Output file created:', outputFile ? 'green' : 'red');
  
  if (outputFile && outputFile.content) {
    log(`  Output content: ${outputFile.content.substring(0, 100)}`, 'cyan');
  }
  
  return result.success === true && !!outputFile;
}

async function test4_ContextBundling(token) {
  logSection('TEST 4: Context Bundling');
  
  // Create files with distinctive content
  await vfsWrite('test-e2e-4-priority.js', 'const PRIORITY_CONTENT = "UNIQUE_MARKER_12345";', token).catch(() => {});
  await vfsWrite('test-e2e-4-other.js', 'const other = "something else";', token).catch(() => {});
  
  // Ask about the unique content
  const result = await chat(
    'What is the value of PRIORITY_CONTENT in the priority file? Just tell me what it says.',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  log('Response has content:', result.content ? 'green' : 'red');
  
  if (result.content) {
    const hasMarker = result.content.includes('UNIQUE_MARKER_12345') || result.content.includes('12345');
    log('Context was bundled correctly:', hasMarker ? 'green' : 'red');
    log(`  Response: ${result.content.substring(0, 200)}`, 'cyan');
  }
  
  return result.success === true;
}

async function test5_ShellExecution(token) {
  logSection('TEST 5: Shell/Terminal Execution');
  
  const result = await chat(
    'Run a shell command to list the files in the current directory using the terminal or shell tool. Just show me what files exist.',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  if (result.content) {
    log(`  Response preview: ${result.content.substring(0, 300)}`, 'cyan');
    // Check if there's any indication of command execution
    const hasCommandOutput = result.content.includes('test-e2e') || 
                             result.content.includes('ls') ||
                             result.content.includes('dir') ||
                             result.content.includes('List');
    log('Shell command appears to have executed:', hasCommandOutput ? 'green' : 'yellow');
  }
  
  return result.success === true;
}

async function test6_ToolCallDetection(token) {
  logSection('TEST 6: LLM Tool Call Format Detection');
  
  // Test various formats the LLM might use
  const prompts = [
    'Write a file called test-e2e-6a.txt with content "Format A"',
    'Create test-e2e-6b.txt containing "Format B"',
    'Make a file named test-e2e-6c.txt with text: Format C'
  ];
  
  let successCount = 0;
  for (const prompt of prompts) {
    const result = await chat(prompt, token);
    if (result.success) successCount++;
  }
  
  log(`Success count: ${successCount}/${prompts.length}`, successCount === prompts.length ? 'green' : 'yellow');
  
  // Check if at least one file was created
  const fileA = await vfsRead('test-e2e-6a.txt', token);
  const fileB = await vfsRead('test-e2e-6b.txt', token);
  const fileC = await vfsRead('test-e2e-6c.txt', token);
  
  log('File A created:', fileA ? 'green' : 'red');
  log('File B created:', fileB ? 'green' : 'red');
  log('File C created:', fileC ? 'green' : 'red');
  
  return successCount > 0;
}

async function test7_AutoContinueDetection(token) {
  logSection('TEST 7: Auto-Continue Response Detection');
  
  // First create a conversation
  const conv = await createConversation(token, 'E2E Auto-Continue Test');
  log('Conversation created:', conv ? 'green' : 'red');
  
  // Ask a question that should trigger auto-continue
  const result = await chat(
    'Create a file called test-e2e-7.txt with content "step 1 complete"',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Check if the file was created
  const file = await vfsRead('test-e2e-7.txt', token);
  log('File created:', file ? 'green' : 'red');
  
  // Check response for any auto-continue indicators
  if (result.content) {
    const hasContinueIndicator = result.content.includes('[CONTINUE_REQUESTED]') || 
                                  result.content.includes('continue') ||
                                  result.content.includes('should continue');
    log('Auto-continue indicator present:', hasContinueIndicator ? 'yellow' : 'green');
  }
  
  return result.success === true && !!file;
}

async function test8_VFSMCPIntegration(token) {
  logSection('TEST 8: VFS MCP Tool Call Args');
  
  // Test proper VFS MCP tool arguments
  const result = await chat(
    'Use the write_file tool to create test-e2e-8.txt with the exact content: MCP Test Content 12345',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Verify exact content
  const file = await vfsRead('test-e2e-8.txt', token);
  log('File exists:', file ? 'green' : 'red');
  
  if (file && file.content) {
    const exactMatch = file.content === 'MCP Test Content 12345';
    log('Exact content match:', exactMatch ? 'green' : 'red');
    log(`  Content: "${file.content}"`, 'cyan');
  }
  
  return result.success === true && !!file;
}

async function test9_DeleteOperation(token) {
  logSection('TEST 9: Delete File Operation');
  
  // First create a file to delete
  await vfsWrite('test-e2e-9-to-delete.txt', 'This will be deleted', token);
  
  const fileBefore = await vfsRead('test-e2e-9-to-delete.txt', token);
  log('File created before delete:', fileBefore ? 'green' : 'red');
  
  // Ask LLM to delete it
  const result = await chat(
    'Delete the file called test-e2e-9-to-delete.txt',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Check if file was deleted
  const fileAfter = await vfsRead('test-e2e-9-to-delete.txt', token);
  log('File deleted:', !fileAfter ? 'green' : 'red');
  
  return result.success === true && !fileAfter;
}

async function test10_InfiniteLoopPrevention(token) {
  logSection('TEST 10: Infinite Loop Prevention');
  
  // Create a conversation for this test
  const conv = await createConversation(token, 'E2E Loop Prevention Test');
  
  // Send multiple related messages that might trigger loops
  const prompts = [
    'Create a file called test-e2e-10a.txt with "iteration 1"',
    'Update test-e2e-10a.txt to say "iteration 2"',
    'Update test-e2e-10a.txt to say "iteration 3"',
    'What does the file say now?',
    'Now update it to "final"'
  ];
  
  let responses = [];
  for (const prompt of prompts) {
    const result = await chat(prompt, token);
    responses.push(result.success);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  
  log('All responses successful:', responses.every(r => r) ? 'green' : 'yellow');
  
  // Check final file state
  const file = await vfsRead('test-e2e-10a.txt', token);
  log('Final file state:', file ? 'green' : 'red');
  if (file && file.content) {
    log(`  Content: "${file.content}"`, 'cyan');
  }
  
  return responses.filter(r => r).length >= 4;
}

async function test11_ComplexWorkflow(token) {
  logSection('TEST 11: Complex Multi-Step Workflow');
  
  // Clean up first
  await vfsDelete('test-e2e-11-result.js', token).catch(() => {});
  await vfsDelete('test-e2e-11-helper.js', token).catch(() => {});
  
  const result = await chat(
    `I need you to perform this workflow:
    1. Create test-e2e-11-helper.js with a function that returns "helper works"
    2. Create test-e2e-11-result.js that imports/requires the helper and calls it, logging the result`,
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Check both files were created
  const helper = await vfsRead('test-e2e-11-helper.js', token);
  const resultFile = await vfsRead('test-e2e-11-result.js', token);
  
  log('Helper file created:', helper ? 'green' : 'red');
  log('Result file created:', resultFile ? 'green' : 'red');
  
  if (helper && helper.content) {
    log(`  Helper: ${helper.content.substring(0, 80)}`, 'cyan');
  }
  if (resultFile && resultFile.content) {
    log(`  Result: ${resultFile.content.substring(0, 80)}`, 'cyan');
  }
  
  return result.success === true && !!helper && !!resultFile;
}

async function test12_ErrorRecovery(token) {
  logSection('TEST 12: Error Recovery & Graceful Failure');
  
  // Try an operation that might fail (non-existent file read)
  const result = await chat(
    'Read a file called test-e2e-nonexistent-file-12345.xyz that does not exist, and if it fails, create a file called test-e2e-12-recovered.txt saying "error handled gracefully"',
    token
  );
  
  log('Response success:', result.success === true ? 'green' : 'red');
  
  // Check if recovery file was created
  const recoveryFile = await vfsRead('test-e2e-12-recovered.txt', token);
  log('Recovery file created:', recoveryFile ? 'green' : 'yellow');
  
  if (recoveryFile && recoveryFile.content) {
    log(`  Content: "${recoveryFile.content}"`, 'cyan');
  }
  
  return result.success === true;
}

// ==================== MAIN ====================

async function main() {
  log(`${colors.bold}${colors.cyan}=============================================================${colors.reset}`, 'cyan');
  log(`${colors.bold}${colors.cyan}  COMPREHENSIVE E2E LLM WORKFLOW TEST SUITE${colors.reset}`, 'cyan');
  log(`${colors.bold}${colors.cyan}=============================================================${colors.reset}`, 'cyan');
  
  log('\nStep 1: Authenticating...', 'cyan');
  const loginData = await login();
  
  if (!loginData.success || !loginData.token) {
    log('Authentication FAILED!', 'red');
    process.exit(1);
  }
  
  log(`Authenticated as: ${loginData.user?.email || TEST_EMAIL}`, 'green');
  const token = loginData.token;
  
  const results = [];
  
  // Run all tests
  try {
    results.push({ name: 'Basic File Creation', passed: await test1_FileCreationBasic(token) });
  } catch (e) { log(`Test 1 error: ${e.message}`, 'red'); results.push({ name: 'Basic File Creation', passed: false }); }
  
  try {
    results.push({ name: 'File Edit (Diff)', passed: await test2_FileEditExisting(token) });
  } catch (e) { log(`Test 2 error: ${e.message}`, 'red'); results.push({ name: 'File Edit (Diff)', passed: false }); }
  
  try {
    results.push({ name: 'Multi-File Workspace', passed: await test3_MultiFileWorkspace(token) });
  } catch (e) { log(`Test 3 error: ${e.message}`, 'red'); results.push({ name: 'Multi-File Workspace', passed: false }); }
  
  try {
    results.push({ name: 'Context Bundling', passed: await test4_ContextBundling(token) });
  } catch (e) { log(`Test 4 error: ${e.message}`, 'red'); results.push({ name: 'Context Bundling', passed: false }); }
  
  try {
    results.push({ name: 'Shell Execution', passed: await test5_ShellExecution(token) });
  } catch (e) { log(`Test 5 error: ${e.message}`, 'red'); results.push({ name: 'Shell Execution', passed: false }); }
  
  try {
    results.push({ name: 'Tool Call Format Detection', passed: await test6_ToolCallDetection(token) });
  } catch (e) { log(`Test 6 error: ${e.message}`, 'red'); results.push({ name: 'Tool Call Format Detection', passed: false }); }
  
  try {
    results.push({ name: 'Auto-Continue Detection', passed: await test7_AutoContinueDetection(token) });
  } catch (e) { log(`Test 7 error: ${e.message}`, 'red'); results.push({ name: 'Auto-Continue Detection', passed: false }); }
  
  try {
    results.push({ name: 'VFS MCP Tool Args', passed: await test8_VFSMCPIntegration(token) });
  } catch (e) { log(`Test 8 error: ${e.message}`, 'red'); results.push({ name: 'VFS MCP Tool Args', passed: false }); }
  
  try {
    results.push({ name: 'Delete Operation', passed: await test9_DeleteOperation(token) });
  } catch (e) { log(`Test 9 error: ${e.message}`, 'red'); results.push({ name: 'Delete Operation', passed: false }); }
  
  try {
    results.push({ name: 'Infinite Loop Prevention', passed: await test10_InfiniteLoopPrevention(token) });
  } catch (e) { log(`Test 10 error: ${e.message}`, 'red'); results.push({ name: 'Infinite Loop Prevention', passed: false }); }
  
  try {
    results.push({ name: 'Complex Workflow', passed: await test11_ComplexWorkflow(token) });
  } catch (e) { log(`Test 11 error: ${e.message}`, 'red'); results.push({ name: 'Complex Workflow', passed: false }); }
  
  try {
    results.push({ name: 'Error Recovery', passed: await test12_ErrorRecovery(token) });
  } catch (e) { log(`Test 12 error: ${e.message}`, 'red'); results.push({ name: 'Error Recovery', passed: false }); }
  
  // Summary
  logSection('TEST RESULTS SUMMARY');
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  
  for (const r of results) {
    logResult(r.name, r.passed);
  }
  
  log(`\n${colors.bold}Total: ${passedCount}/${totalCount} tests passed${colors.reset}`, 
      passedCount === totalCount ? 'green' : passedCount >= totalCount * 0.7 ? 'yellow' : 'red');
  
  if (passedCount < totalCount) {
    log(`\n${colors.yellow}Failed tests need investigation:${colors.reset}`, 'yellow');
    for (const r of results.filter(r => !r.passed)) {
      log(`  - ${r.name}`, 'red');
    }
  }
  
  process.exit(passedCount === totalCount ? 0 : 1);
}

main().catch(e => {
  log(`Fatal error: ${e.message}`, 'red');
  console.error(e);
  process.exit(1);
});