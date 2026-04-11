/**
 * Comprehensive E2E Tests
 * 
 * Tests full flow functionality:
 * 1. Anonymous session creation
 * 2. File operations with session
 * 3. Complex prompts with tool calling
 * 4. VFS batch operations
 * 5. Agent orchestration
 * 
 * Usage: npx tsx scripts/e2e-comprehensive.ts
 */

const BASE_URL = 'http://localhost:3000';

async function createSession() {
  console.log('\n=== Test 1: Create Anonymous Session ===');
  try {
    // First call to create session
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'ping' }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Session response:', response.status, data.success);
    
    // Extract session cookie
    const cookies = response.headers.get('set-cookie');
    console.log('Session cookie:', cookies?.slice(0, 80) + '...');
    
    if (response.ok || data.success !== false) {
      console.log('✅ PASS: Session created');
      return cookies;
    } else {
      console.log('⚠️  Session creation:', data.error);
      return null;
    }
  } catch (error) {
    console.error('❌ Session error:', error.message);
    return null;
  }
}

async function testSimplePrompt(cookies: string | null) {
  console.log('\n=== Test 2: Simple Prompt ===');
  try {
    const body = [
      { role: 'user', content: 'Say "test successful" if you can read this.' },
    ];
    console.log('Request body:', JSON.stringify(body).substring(0, 100));
    
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({ messages: body, provider: 'mistral', model: 'mistral-large-latest', stream: false }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Provider:', data.metadata?.provider);
    console.log('Content:', data.data?.content?.slice(0, 100) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: Simple prompt successful');
      return true;
    } else {
      console.log('⚠️  Simple prompt:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Simple prompt error:', error.message);
    return false;
  }
}

async function testFileRead(cookies: string | null) {
  console.log('\n=== Test 2: File Read Operation ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Read the file package.json from the current directory and tell me the project name and version.' 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content preview:', data.data?.content?.slice(0, 200) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: File read successful');
      return true;
    } else {
      console.log('⚠️  File read:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ File read error:', error.message);
    return false;
  }
}

async function testFileWrite(cookies: string | null) {
  console.log('\n=== Test 3: File Write Operation ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Write a test file at /test-output.txt with the content "Hello from E2E test" using the write_file tool.' 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content preview:', data.data?.content?.slice(0, 300) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: File write successful');
      return true;
    } else {
      console.log('⚠️  File write:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ File write error:', error.message);
    return false;
  }
}

async function testBashCommand(cookies: string | null) {
  console.log('\n=== Test 4: Bash Command Execution ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Run the bash command "echo Hello from bash test" and show me the output.' 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content preview:', data.data?.content?.slice(0, 300) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: Bash execution successful');
      return true;
    } else {
      console.log('⚠️  Bash execution:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Bash error:', error.message);
    return false;
  }
}

async function testMultiToolChain(cookies: string | null) {
  console.log('\n=== Test 5: Multi-Tool Chain ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: `First list files in the current directory using bash: ls, then create a new file named "chain-test.txt" with the content "Testing multi-tool chain", then read the file back to verify it was created.` 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content:', data.data?.content?.slice(0, 500) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: Multi-tool chain successful');
      return true;
    } else {
      console.log('⚠️  Multi-tool chain:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Multi-tool error:', error.message);
    return false;
  }
}

async function testVFSBatch(cookies: string | null) {
  console.log('\n=== Test 6: VFS Batch Operations ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: `Create three files at once:
1. file1.txt with "content 1"
2. file2.txt with "content 2" 
3. file3.txt with "content 3"

Then list all three files to confirm they exist.` 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content:', data.data?.content?.slice(0, 500) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: VFS batch operations successful');
      return true;
    } else {
      console.log('⚠️  VFS batch:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ VFS batch error:', error.message);
    return false;
  }
}

async function testComplexReasoning(cookies: string | null) {
  console.log('\n=== Test 7: Complex Reasoning ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: `Write a simple JavaScript function that calculates the factorial of a number and explain how it works. Then test it with the number 5.` 
        }],
        provider: 'mistral',
        model: 'mistral-large-latest',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Content:', data.data?.content?.slice(0, 500) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: Complex reasoning successful');
      return true;
    } else {
      console.log('⚠️  Complex reasoning:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Complex reasoning error:', error.message);
    return false;
  }
}

async function testOpenRouterFallback(cookies: string | null) {
  console.log('\n=== Test 8: OpenRouter Fallback ===');
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(cookies && { 'Cookie': cookies }),
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Say "OpenRouter test successful" in exactly those words.' 
        }],
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.1-24b-instruct:free',
        stream: false,
      }),
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Success:', data.success);
    console.log('Provider:', data.metadata?.provider);
    console.log('Model:', data.metadata?.model);
    console.log('Content:', data.data?.content?.slice(0, 200) || data.error);
    
    if (response.status === 200 && data.success) {
      console.log('✅ PASS: OpenRouter fallback successful');
      return true;
    } else {
      console.log('⚠️  OpenRouter:', data.error || 'failed');
      return false;
    }
  } catch (error) {
    console.error('❌ OpenRouter error:', error.message);
    return false;
  }
}

// Run all tests
const runAllTests = async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Comprehensive E2E Test Suite                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  const results: { name: string; passed: boolean }[] = [];
  
  // Test 1: Create session
  console.log('\n--- Test 1: Session Creation ---');
  const sessionRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'ping' }],
      provider: 'mistral',
      model: 'mistral-large-latest',
      stream: false,
    }),
  });
  
  const setCookie = sessionRes.headers.get('set-cookie');
  console.log('Got cookies:', !!setCookie);
  
  // Extract just the session cookie for reuse
  let cookies = null;
  if (setCookie) {
    // Find the anon-session-id cookie
    const match = setCookie.match(/anon-session-id=[^;]+/);
    if (match) {
      cookies = match[0];
      console.log('Session ID:', cookies.substring(0, 50) + '...');
    }
  }
  
  if (cookies) {
    results.push({ name: 'Session Creation', passed: true });
  } else {
    results.push({ name: 'Session Creation', passed: false });
  }
  
  // Test 2-8: Run with session
  if (cookies) {
    results.push({ name: 'Simple Prompt', passed: await testSimplePrompt(cookies) });
    results.push({ name: 'File Read', passed: await testFileRead(cookies) });
    results.push({ name: 'File Write', passed: await testFileWrite(cookies) });
    results.push({ name: 'Bash Command', passed: await testBashCommand(cookies) });
    results.push({ name: 'Multi-Tool Chain', passed: await testMultiToolChain(cookies) });
    results.push({ name: 'VFS Batch', passed: await testVFSBatch(cookies) });
    results.push({ name: 'Complex Reasoning', passed: await testComplexReasoning(cookies) });
    results.push({ name: 'OpenRouter Fallback', passed: await testOpenRouterFallback(cookies) });
  } else {
    console.log('\n⚠️  Skipping remaining tests - session required');
  }
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`║  Passed: ${passed.toString().padEnd(48)}║`);
  console.log(`║  Failed: ${failed.toString().padEnd(48)}║`);
  console.log(`║  Total: ${results.length.toString().padEnd(48)}║`);
  
  if (failed > 0) {
    console.log('\n║  FAILURES:                                          ║');
    results.filter(r => !r.passed).forEach((r, i) => {
      console.log(`║  ${i + 1}. ${r.name.padEnd(50)}║`);
    });
  }
  
  console.log('╚══════════════════════════════════════════════════════════╝');
};

runAllTests();