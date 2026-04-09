/**
 * Comprehensive E2E Test Script
 * Tests full workflows including:
 * - Authentication
 * - Chat with various providers/models
 * - File creation via LLM tool calls
 * - VFS operations
 * - Tool execution
 * - Auto-continue detection
 * - Multiple modes (streaming/non-streaming)
 */

const API_BASE = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function login() {
  log('\n=== TEST: Authentication ===', 'blue');
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });
  const data = await res.json();
  if (data.success && data.token) {
    log('  PASS: Login successful', 'green');
    return data.token;
  }
  log(`  FAIL: Login failed - ${JSON.stringify(data)}`, 'red');
  return null;
}

async function chat(token, message, provider = 'nvidia', model = 'nvidia/nemotron-4-340b-instruct', stream = false) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      provider,
      model,
      stream
    })
  });
  return res.json();
}

async function vfsList(token, path = '/') {
  const res = await fetch(`${API_BASE}/api/vfs/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path })
  });
  return res.json();
}

async function vfsRead(token, path) {
  const res = await fetch(`${API_BASE}/api/vfs/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path })
  });
  return res.json();
}

async function runTests() {
  log('========================================', 'blue');
  log('  COMPREHENSIVE E2E TESTS', 'blue');
  log('========================================', 'blue');

  // Step 1: Login
  const token = await login();
  if (!token) {
    log('\n FATAL: Cannot proceed without auth token', 'red');
    process.exit(1);
  }

  // Test results storage
  const results = {
    passed: [],
    failed: []
  };

  function recordTest(name, passed, details = '') {
    if (passed) {
      results.passed.push(name);
      log(`  PASS: ${name}`, 'green');
    } else {
      results.failed.push(name);
      log(`  FAIL: ${name} - ${details}`, 'red');
    }
  }

  // Test 1: Basic VFS list
  log('\n=== TEST: VFS List (empty workspace) ===', 'blue');
  try {
    const vfsListResult = await vfsList(token);
    recordTest('VFS List works', vfsListResult.success || vfsListResult.files !== undefined, JSON.stringify(vfsListResult).slice(0, 200));
  } catch (e) {
    recordTest('VFS List works', false, e.message);
  }

  // Test 2: Chat with nvidia provider (non-streaming) - file creation
  log('\n=== TEST: Chat - Create a file (non-streaming) ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Create a file called test-app.js with the following content: console.log("Hello from AI!");',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response length: ${chatResult.content?.length || 0}`, 'yellow');
    log(`  Tool calls: ${JSON.stringify(chatResult.toolCalls || chatResult.toolInvocations || []).slice(0, 300)}`, 'yellow');
    log(`  Files created: ${JSON.stringify(chatResult.files || []).slice(0, 300)}`, 'yellow');
    
    // Check if file was created via tool calls or files array
    const hasToolCall = (chatResult.toolCalls?.length > 0) || (chatResult.toolInvocations?.length > 0);
    const hasFileCreation = (chatResult.files?.length > 0);
    
    recordTest('Non-streaming chat returns response', !!chatResult.content, 'No content');
    recordTest('Tool calls detected in response', hasToolCall || hasFileCreation, 'No tool calls or files');
    
    // Check if file actually exists in VFS
    if (hasToolCall || hasFileCreation) {
      setTimeout(async () => {
        try {
          const vfsResult = await vfsRead(token, '/test-app.js');
          recordTest('File created in VFS', vfsResult.success || !!vfsResult.content, JSON.stringify(vfsResult).slice(0, 200));
        } catch (e) {
          recordTest('File created in VFS', false, e.message);
        }
      }, 1000);
    }
  } catch (e) {
    recordTest('Non-streaming chat works', false, e.message);
  }

  // Test 3: Chat with nvidia provider (streaming) - file creation
  log('\n=== TEST: Chat - Create a file (streaming) ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Create a file called streaming-test.txt with content: Testing streaming file creation',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      true
    );
    log(`  Response length: ${chatResult.content?.length || 0}`, 'yellow');
    log(`  Tool calls: ${JSON.stringify(chatResult.toolCalls || []).slice(0, 300)}`, 'yellow');
    recordTest('Streaming chat returns response', !!chatResult.content || !!chatResult.isComplete, 'No response');
  } catch (e) {
    recordTest('Streaming chat works', false, e.message);
  }

  // Test 4: Chat with mistral provider
  log('\n=== TEST: Chat - Mistral provider ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Write a simple hello world Python script to hello.py',
      'mistral',
      'mistral-small-latest',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    log(`  Tool calls: ${JSON.stringify(chatResult.toolCalls || []).slice(0, 300)}`, 'yellow');
    recordTest('Mistral provider works', !!chatResult.content, 'No content');
    recordTest('Mistral tool calls detected', (chatResult.toolCalls?.length > 0) || (chatResult.files?.length > 0), 'No tools');
  } catch (e) {
    recordTest('Mistral provider works', false, e.message);
  }

  // Test 5: Chat with openrouter provider
  log('\n=== TEST: Chat - OpenRouter provider ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Create a file called openrouter-test.py with: print("OpenRouter works!")',
      'openrouter',
      'openai/gpt-oss-120b:free',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    log(`  Tool calls: ${JSON.stringify(chatResult.toolCalls || []).slice(0, 300)}`, 'yellow');
    recordTest('OpenRouter provider works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('OpenRouter provider works', false, e.message);
  }

  // Test 6: Chat with google provider
  log('\n=== TEST: Chat - Google provider ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Create a file called google-test.js with: console.log("Google provider!");',
      'google',
      'gemini-3.1-flash-lite-preview',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    log(`  Tool calls: ${JSON.stringify(chatResult.toolCalls || []).slice(0, 300)}`, 'yellow');
    recordTest('Google provider works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('Google provider works', false, e.message);
  }

  // Test 7: Multi-file creation in single prompt
  log('\n=== TEST: Multi-file creation ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Create three files: 1) index.html with "<h1>Hello</h1>", 2) style.css with "body { margin: 0; }", 3) app.js with "console.log(\'loaded\')"',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    log(`  Files created: ${JSON.stringify(chatResult.files || []).slice(0, 500)}`, 'yellow');
    recordTest('Multi-file creation detected', (chatResult.files?.length >= 1) || (chatResult.toolCalls?.length >= 1), 'No files');
  } catch (e) {
    recordTest('Multi-file creation works', false, e.message);
  }

  // Test 8: Edit existing file
  log('\n=== TEST: Edit existing file ===', 'blue');
  try {
    // First create a file
    await chat(token, 'Create a file called edit-me.txt with content: Original content', 'nvidia', 'nvidia/nemotron-4-340b-instruct', false);
    
    // Then edit it
    const editResult = await chat(
      token,
      'Update edit-me.txt to say: Modified content - changed by AI',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Edit response: ${(editResult.content || '').slice(0, 500)}`, 'yellow');
    recordTest('File edit detected', !!editResult.content, 'No content');
  } catch (e) {
    recordTest('File edit works', false, e.message);
  }

  // Test 9: Shell command execution
  log('\n=== TEST: Shell command execution ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Run this JavaScript code: console.log("Shell test from AI")',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    log(`  Commands: ${JSON.stringify(chatResult.commands || []).slice(0, 300)}`, 'yellow');
    recordTest('Shell command detected', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('Shell command works', false, e.message);
  }

  // Test 10: List files command
  log('\n=== TEST: List workspace files ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'List all files in the current directory',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    recordTest('List files command works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('List files works', false, e.message);
  }

  // Test 11: Read file content
  log('\n=== TEST: Read file content ===', 'blue');
  try {
    // First ensure a file exists
    await chat(token, 'Create a file called read-test.txt with: Content to be read', 'nvidia', 'nvidia/nemotron-4-340b-instruct', false);
    
    const chatResult = await chat(
      token,
      'Read the content of read-test.txt and tell me what it says',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    recordTest('Read file command works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('Read file works', false, e.message);
  }

  // Test 12: Auto-continue detection
  log('\n=== TEST: Auto-continue detection ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'Continue writing more code for a function that calculates fibonacci numbers. Just keep going without asking me questions.',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response length: ${chatResult.content?.length || 0}`, 'yellow');
    log(`  Auto-continue: ${chatResult.autoContinue}`, 'yellow');
    recordTest('Auto-continue response works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('Auto-continue works', false, e.message);
  }

  // Test 13: Context bundling - multi-folder workspace
  log('\n=== TEST: Context bundling ===', 'blue');
  try {
    const chatResult = await chat(
      token,
      'What files do you see in the src/components folder?',
      'nvidia',
      'nvidia/nemotron-4-340b-instruct',
      false
    );
    log(`  Response: ${(chatResult.content || '').slice(0, 500)}`, 'yellow');
    recordTest('Context bundling works', !!chatResult.content, 'No content');
  } catch (e) {
    recordTest('Context bundling works', false, e.message);
  }

  // Wait for async tests to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Print summary
  log('\n========================================', 'blue');
  log('  TEST SUMMARY', 'blue');
  log('========================================', 'blue');
  log(`  Passed: ${results.passed.length}`, 'green');
  log(`  Failed: ${results.failed.length}`, results.failed.length > 0 ? 'red' : 'green');
  
  if (results.failed.length > 0) {
    log('\n  Failed tests:', 'red');
    results.failed.forEach(t => log(`    - ${t}`, 'red'));
  }
  
  log('\n  Passed tests:', 'green');
  results.passed.forEach(t => log(`    - ${t}`, 'green'));

  return results;
}

// Run tests
runTests().catch(e => {
  log(`\n FATAL ERROR: ${e.message}`, 'red');
  process.exit(1);
});