/**
 * Comprehensive LLM Integration Test Script
 * Tests file creation, code execution, multi-step workflows, MCP tools, streaming, and orchestration
 * 
 * Run: node test-comprehensive-llm-flow.cjs
 */

const API_BASE = 'http://localhost:3000';
const AUTH_EMAIL = 'test@test.com';
const AUTH_PASSWORD = 'Testing0';

let authToken = '';
let userId = '';

async function login() {
  console.log('\n=== AUTHENTICATION ===');
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD })
  });
  const data = await res.json();
  if (!data.success) throw new Error('Login failed');
  authToken = data.token;
  userId = data.user.id;
  console.log(`Logged in as ${data.user.email} (ID: ${userId})`);
  return authToken;
}

async function chat(message, options = {}) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ message, ...options })
  });
  return res.json();
}

async function checkVFSFile(path) {
  const res = await fetch(`${API_BASE}/api/vfs/read`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ path, ownerId: userId })
  });
  if (!res.ok) return null;
  return res.json();
}

async function deleteVFSFile(path) {
  try {
    await fetch(`${API_BASE}/api/vfs/delete`, {
      method: 'DELETE',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ path, ownerId: userId })
    });
  } catch (e) {}
}

// Test 1: File Creation and Verification
async function testFileCreation() {
  console.log('\n=== TEST 1: FILE CREATION AND VERIFICATION ===');
  
  const testFiles = [
    { path: 'test1-basic.js', content: 'console.log("Hello World");' },
    { path: 'test1-typescript.ts', content: 'const x: number = 42; export { x };' },
    { path: 'test1-json.json', content: '{"name": "test", "version": "1.0.0"}' },
  ];
  
  for (const file of testFiles) {
    await deleteVFSFile(file.path);
  }
  
  // Test with batch_write format
  const batchContent = JSON.stringify({
    tool: "batch_write",
    files: testFiles.map(f => ({ path: f.path, content: f.content }))
  });
  
  const prompt = `Create these files using batch_write:\n${batchContent}\n\nJust create the files, nothing else.`;
  
  try {
    const result = await chat(prompt);
    console.log('Response type:', result.type);
    
    // Verify files exist in VFS
    let allCreated = true;
    for (const file of testFiles) {
      const vfsFile = await checkVFSFile(file.path);
      if (vfsFile && vfsFile.content) {
        console.log(`  Created: ${file.path} - ${vfsFile.content.length} chars`);
      } else {
        console.log(`  Failed: ${file.path}`);
        allCreated = false;
      }
    }
    return allCreated;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 2: Code Execution with Output Verification
async function testCodeExecution() {
  console.log('\n=== TEST 2: CODE EXECUTION WITH OUTPUT VERIFICATION ===');
  
  await deleteVFSFile('test2-exec.js');
  
  // Create a file that can be executed
  const prompt = `Create a JavaScript file at test2-exec.js that:
1. Calculates the sum of numbers 1-100
2. Returns the result
Use console.log to output the result.

Then execute it using the sandbox shell tool and report the output.`;
  
  try {
    const result = await chat(prompt);
    console.log('Response type:', result.type);
    
    // Check if execution happened
    const hasExecution = result.response && (
      result.response.includes('5050') || 
      result.response.includes('result') ||
      result.response.includes('output')
    );
    
    console.log('  Code execution detected:', hasExecution);
    return hasExecution;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 3: Complex Multi-Step Workflow
async function testMultiStepWorkflow() {
  console.log('\n=== TEST 3: COMPLEX MULTI-STEP WORKFLOW ===');
  
  await deleteVFSFile('test3-step1.txt');
  await deleteVFSFile('test3-step2.txt');
  await deleteVFSFile('test3-step3.txt');
  
  const prompt = `Complete this multi-step workflow:
1. Create test3-step1.txt with content "Step 1 complete"
2. Create test3-step2.txt with content "Step 2 complete" 
3. Create test3-step3.txt with content "Step 3 complete - all steps finished"

Report each step as you complete it.`;
  
  try {
    const result = await chat(prompt);
    console.log('Response type:', result.type);
    
    // Verify all 3 files created
    const files = ['test3-step1.txt', 'test3-step2.txt', 'test3-step3.txt'];
    let allCreated = true;
    
    for (const file of files) {
      const vfsFile = await checkVFSFile(file);
      if (!vfsFile || !vfsFile.content) {
        console.log(`  Missing: ${file}`);
        allCreated = false;
      }
    }
    
    console.log('  All workflow steps completed:', allCreated);
    return allCreated;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 4: MCP Tool Detection/Usage
async function testMCPTools() {
  console.log('\n=== TEST 4: MCP TOOL DETECTION/USAGE ===');
  
  // Check what MCP tools are available
  const prompt = `List all available MCP tools and capabilities you have access to. Show the tool names and what each does.`;
  
  try {
    const result = await chat(prompt);
    console.log('Response type:', result.type);
    
    // Check if response mentions MCP or tools
    const hasTools = result.response && (
      result.response.includes('tool') ||
      result.response.includes('MCP') ||
      result.response.includes('capability') ||
      result.response.includes('function')
    );
    
    console.log('  MCP tools mentioned:', hasTools);
    return hasTools;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 5: Streaming Output
async function testStreamingOutput() {
  console.log('\n=== TEST 5: STREAMING OUTPUT ===');
  
  const prompt = `Write a long response (at least 500 words) about the history of JavaScript programming. Include details about its creation, evolution, and major versions.`;
  
  try {
    const startTime = Date.now();
    const result = await chat(prompt, { stream: true });
    const duration = Date.now() - startTime;
    
    console.log('Response type:', result.type);
    console.log('Duration:', duration, 'ms');
    
    const responseLength = result.response ? result.response.length : 0;
    console.log('Response length:', responseLength, 'chars');
    
    // Streaming should be faster or response should be chunked
    const isStreaming = result.type === 'stream' || duration < 5000;
    console.log('  Streaming working:', isStreaming);
    return isStreaming;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 6: Agent Orchestration
async function testAgentOrchestration() {
  console.log('\n=== TEST 6: AGENT ORCHESTRATION ===');
  
  const prompt = `You are working with multiple sub-agents. For this task:
1. First analyze what files exist in the workspace
2. Create a summary file at test6-orchestration-summary.txt with your findings
3. Report back on what you found and created`;
  
  try {
    const result = await chat(prompt);
    console.log('Response type:', result.type);
    
    // Check if orchestration happened (multiple steps, file creation)
    const hasOrchestration = result.fileEdits && result.fileEdits.length > 0;
    
    console.log('  Agent orchestration detected:', hasOrchestration);
    return hasOrchestration;
  } catch (e) {
    console.log('Error:', e.message);
    return false;
  }
}

// Test 7: All Batch Tool Call Formats
async function testAllBatchFormats() {
  console.log('\n=== TEST 7: ALL BATCH TOOL CALL FORMATS ===');
  
  const results = {};
  
  // Format A: Special tokens
  await deleteVFSFile('format-a.js');
  const formatA = JSON.stringify({
    tool: "batch_write",
    files: [{ path: "format-a.js", content: "console.log('Format A');" }]
  });
  const promptA = `Create file with special tokens: <|tool_call_begin|>${formatA}<|tool_call_end|>`;
  try {
    await chat(promptA);
    const file = await checkVFSFile('format-a.js');
    results['Format A (Special Tokens)'] = !!(file && file.content);
  } catch (e) {
    results['Format A (Special Tokens)'] = false;
  }
  
  // Format B: Fenced block
  await deleteVFSFile('format-b.js');
  const promptB = "Create file:\n```\nbatch_write([{\"path\": \"format-b.js\", \"content\": \"console.log('Format B');\"}]) \n```\n";
  try {
    await chat(promptB);
    const file = await checkVFSFile('format-b.js');
    results['Format B (Fenced Block)'] = !!(file && file.content);
  } catch (e) {
    results['Format B (Fenced Block)'] = false;
  }
  
  // Format C: tool_call fence
  await deleteVFSFile('format-c.js');
  const promptC = "Create file:\n```tool_call\n{\"tool\":\"write_file\",\"arguments\":{\"path\":\"format-c.js\",\"content\":\"console.log('Format C');\"}}\n```\n";
  try {
    await chat(promptC);
    const file = await checkVFSFile('format-c.js');
    results['Format C (tool_call)'] = !!(file && file.content);
  } catch (e) {
    results['Format C (tool_call)'] = false;
  }
  
  // Format D: Flat JSON
  await deleteVFSFile('format-d.js');
  const promptD = "{\"tool\":\"write_file\",\"path\":\"format-d.js\",\"content\":\"console.log('Format D');\"}";
  try {
    await chat(promptD);
    const file = await checkVFSFile('format-d.js');
    results['Format D (Flat JSON)'] = !!(file && file.content);
  } catch (e) {
    results['Format D (Flat JSON)'] = false;
  }
  
  // Format E: Bare function call
  await deleteVFSFile('format-e.js');
  const promptE = "batch_write([{\"path\": \"format-e.js\", \"content\": \"console.log('Format E');\"}])";
  try {
    await chat(promptE);
    const file = await checkVFSFile('format-e.js');
    results['Format E (Bare Call)'] = !!(file && file.content);
  } catch (e) {
    results['Format E (Bare Call)'] = false;
  }
  
  console.log('\nFormat Results:');
  for (const [format, success] of Object.entries(results)) {
    console.log(`  ${success ? 'PASS' : 'FAIL'}: ${format}`);
  }
  
  return Object.values(results).every(r => r);
}

// Run all tests
async function runAllTests() {
  try {
    await login();
    
    const results = {
      'File Creation & Verification': await testFileCreation(),
      'Code Execution': await testCodeExecution(),
      'Multi-Step Workflow': await testMultiStepWorkflow(),
      'MCP Tools': await testMCPTools(),
      'Streaming Output': await testStreamingOutput(),
      'Agent Orchestration': await testAgentOrchestration(),
      'All Batch Formats': await testAllBatchFormats(),
    };
    
    console.log('\n=== FINAL TEST RESULTS ===');
    let passed = 0;
    let failed = 0;
    for (const [name, success] of Object.entries(results)) {
      console.log(`${success ? 'PASS' : 'FAIL'}: ${name}`);
      if (success) passed++;
      else failed++;
    }
    console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${Object.keys(results).length} tests`);
    
  } catch (e) {
    console.log('Fatal error:', e.message);
  }
}

runAllTests();