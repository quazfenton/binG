/**
 * Comprehensive E2E Tests - Fixed
 */

const BASE_URL = 'http://localhost:3000';

async function loginAndGetSession() {
  console.log('\n=== Test 1: Login ===');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
    });
    
    const data = await response.json();
    console.log('Login response:', response.status, data.success);
    
    if (data.success) {
      const setCookie = response.headers.get('set-cookie');
      console.log('✅ PASS: Login successful');
      return setCookie;
    }
    console.log('⚠️  Login failed:', data.error);
    return null;
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return null;
  }
}

async function chatRequest(cookies: string, content: string, provider = 'mistral', model = 'mistral-large-latest') {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cookie': cookies,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      provider,
      model,
      stream: false,
    }),
  });
  
  return response.json();
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Comprehensive E2E Test Suite                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  const cookies = await loginAndGetSession();
  if (!cookies) {
    console.log('❌ No session - aborting tests');
    return;
  }
  
  const tests = [
    { name: 'Simple Prompt', prompt: 'Say OK if you receive this.' },
    { name: 'File Read', prompt: 'Read the file package.json and tell me the project name.' },
    { name: 'File Write', prompt: 'Write "hello test" to /test-e2e.txt using write_file.' },
    { name: 'Bash', prompt: 'Run: echo "bash works"' },
    { name: 'Reasoning', prompt: 'Explain how factorial recursive works in 1 sentence.' },
    { name: 'OpenRouter', prompt: 'Say OK', provider: 'openrouter', model: 'mistralai/mistral-small-3.1-24b-instruct:free' },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);
    try {
      const data = await chatRequest(cookies, test.prompt, test.provider, test.model);
      const ok = data.success;
      console.log(`Status: ${ok ? '✅ PASS' : '⚠️ FAIL'} - ${data.data?.content?.slice(0,100) || data.error?.message || ''}`);
      if (ok) passed++; else failed++;
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
      failed++;
    }
  }
  
  console.log(`\n╔══════════════════════╗`);
  console.log(`║ Passed: ${passed} / ${passed + failed} ║`);
  console.log(`╚══════════════════════╝`);
}

runTests();