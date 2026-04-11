/**
 * Comprehensive LLM Integration Test
 * Tests file creation, code execution, multi-step workflows through actual chat API
 * Run: node test-llm-flow.cjs
 */

const API_BASE = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' })
  });
  const data = await res.json();
  console.log('Login:', data.success ? 'SUCCESS' : 'FAILED');
  return data;
}

async function chat(message, token) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      stream: false
    })
  });
  return res.json();
}

async function checkVFS(path, token) {
  const res = await fetch(`${API_BASE}/api/vfs/read`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ path, ownerId: 'test@test.com' })
  });
  return res.ok ? res.json() : null;
}

async function test1_FileCreation() {
  console.log('\n=== TEST 1: File Creation ===');
  const loginData = await login();
  const token = loginData.token;
  
  // Create a simple file via prompt
  const result = await chat(
    'Create a file at test-file.js with content: console.log("Hello from test");',
    token
  );
  console.log('Response:', result.success ? 'OK' : 'FAILED');
  console.log('Content preview:', result.data?.content?.substring(0, 100) || 'N/A');
  
  // Check if file exists
  const file = await checkVFS('test-file.js', token);
  console.log('File exists:', file ? 'YES' : 'NO');
  
  return { success: result.success, fileExists: !!file };
}

async function test2_CodeExecution() {
  console.log('\n=== TEST 2: Code Execution ===');
  const loginData = await login();
  const token = loginData.token;
  
  // Ask to execute code
  const result = await chat(
    'Run this JavaScript code: console.log("Execution test");',
    token
  );
  console.log('Response:', result.success ? 'OK' : 'FAILED');
  
  return { success: result.success };
}

async function test3_MultiStep() {
  console.log('\n=== TEST 3: Multi-step Workflow ===');
  const loginData = await login();
  const token = loginData.token;
  
  // Multi-step request
  const result = await chat(
    'Create a project structure: a src/index.js file with exports, and a config.json with settings. List the files after.',
    token
  );
  console.log('Response:', result.success ? 'OK' : 'FAILED');
  console.log('Files in response:', result.data?.filesystem?.applied?.length || 0);
  
  return { success: result.success };
}

async function test4_Streaming() {
  console.log('\n=== TEST 4: Streaming Output ===');
  const loginData = await login();
  const token = loginData.token;
  
  // Test streaming
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Write a brief story about a robot.' }],
      stream: true
    })
  });
  
  let chunkCount = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkCount++;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.includes('data:')) {
      console.log('Received chunk', chunkCount);
    }
  }
  
  console.log('Stream chunks received:', chunkCount);
  return { success: chunkCount > 0 };
}

async function runAllTests() {
  console.log('=== LLM COMPREHENSIVE TESTS ===');
  
  const results = [];
  
  try {
    results.push({ name: 'File Creation', ...await test1_FileCreation() });
  } catch (e) {
    console.log('Test 1 error:', e.message);
    results.push({ name: 'File Creation', success: false, error: e.message });
  }
  
  try {
    results.push({ name: 'Code Execution', ...await test2_CodeExecution() });
  } catch (e) {
    console.log('Test 2 error:', e.message);
    results.push({ name: 'Code Execution', success: false, error: e.message });
  }
  
  try {
    results.push({ name: 'Multi-step', ...await test3_MultiStep() });
  } catch (e) {
    console.log('Test 3 error:', e.message);
    results.push({ name: 'Multi-step', success: false, error: e.message });
  }
  
  try {
    results.push({ name: 'Streaming', ...await test4_Streaming() });
  } catch (e) {
    console.log('Test 4 error:', e.message);
    results.push({ name: 'Streaming', success: false, error: e.message });
  }
  
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.name}: ${r.success ? 'PASS' : 'FAIL'}`);
  }
}

runAllTests().then(() => console.log('\nDone!')).catch(e => console.error('Fatal:', e));