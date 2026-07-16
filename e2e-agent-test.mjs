#!/usr/bin/env node
/**
 * Comprehensive E2E Agent Test
 * Tests full agentic workflows with real LLM interaction
 */

const BASE_URL = 'http://127.0.0.1:3000';
const TEST_USER = { email: 'test@test.com', password: 'Testing00000?' };

let sessionId = null;
let authToken = null;

// Test scenarios
const TESTS = [
  {
    name: 'T1: Single File Creation (VFS Tool)',
    prompt: 'Create a file called hello.py that prints "Hello World"',
    verify: async (events) => {
      const hasToolCall = events.some(e => e.type === 'tool-call' && e.toolName?.includes('write'));
      const hasFile = events.some(e => e.type === 'vfs-event' || (e.content && e.content.includes('hello.py')));
      return { pass: hasToolCall || hasFile, details: `Tool calls: ${hasToolCall}, File ref: ${hasFile}` };
    }
  },
  {
    name: 'T2: Multi-file Project (Complex Workflow)',
    prompt: 'Create a simple Express.js REST API with 3 files: server.js, routes.js, and package.json',
    verify: async (events) => {
      const files = ['server.js', 'routes.js', 'package.json'];
      const found = files.filter(f => events.some(e => e.content?.includes(f)));
      return { pass: found.length >= 2, details: `Found files: ${found.join(', ')}` };
    }
  },
  {
    name: 'T3: Code Execution (Sandbox)',
    prompt: 'Create a Python script that calculates fibonacci(10) and run it',
    verify: async (events) => {
      const hasExec = events.some(e => e.type === 'tool-call' && (e.toolName?.includes('bash') || e.toolName?.includes('execute')));
      const hasOutput = events.some(e => e.content?.match(/55|fibonacci/i));
      return { pass: hasExec || hasOutput, details: `Exec: ${hasExec}, Output: ${hasOutput}` };
    }
  },
  {
    name: 'T4: File Read & Modify (Context + Diff)',
    prompt: 'Read the hello.py file we created earlier and modify it to say "Hello from binG"',
    verify: async (events) => {
      const hasRead = events.some(e => e.type === 'tool-call' && e.toolName?.includes('read'));
      const hasModify = events.some(e => e.content?.includes('binG'));
      return { pass: hasRead || hasModify, details: `Read: ${hasRead}, Modified: ${hasModify}` };
    }
  },
  {
    name: 'T5: Auto-Continue (Multi-step)',
    prompt: 'Create a todo app with HTML, CSS, and JS files, then list all files created',
    verify: async (events) => {
      const toolCalls = events.filter(e => e.type === 'tool-call').length;
      const files = ['html', 'css', 'js'].filter(ext => events.some(e => e.content?.includes(`.${ext}`)));
      return { pass: files.length >= 2, details: `Tools: ${toolCalls}, Files: ${files.join(',')}` };
    }
  }
];

async function login() {
  console.log('🔐 Logging in...');
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_USER)
  });
  
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  
  const data = await res.json();
  authToken = data.token || data.authToken;
  sessionId = res.headers.get('set-cookie')?.match(/session_id=([^;]+)/)?.[1];
  
  console.log('✅ Logged in', { authToken: authToken?.slice(0, 20) + '...', sessionId });
}

async function runChatTest(test) {
  console.log(`\n📝 Running: ${test.name}`);
  console.log(`   Prompt: "${test.prompt}"`);
  
  const events = [];
  let fullText = '';
  
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `session_id=${sessionId}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: test.prompt }],
        provider: 'ollama',
        model: 'ollama/gpt-oss:120b',
        stream: true,
        enableFilesystemEdits: true
      })
    });
    
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`❌ Request failed: ${res.status}: ${body.slice(0, 200)}`);
      return { pass: false, details: `HTTP ${res.status}: ${body.slice(0, 100)}` };
    }
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let timeout = setTimeout(() => {
      console.warn('⏱️  Response timeout after 120s');
      reader.cancel();
    }, 120000);
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const event = JSON.parse(data);
          events.push(event);
          
          if (event.type === 'content' || event.type === 'text-delta') {
            fullText += event.content || event.textDelta || '';
          }
          
          if (event.type === 'tool-call') {
            console.log(`   🔧 Tool: ${event.toolName}`);
          }
          if (event.type === 'step') {
            console.log(`   👣 Step: ${event.step} [${event.status}]`);
          }
          if (event.type === 'token') {
            const c = (event.content || '').slice(0, 80);
            console.log(`   💬 Token: ${c}`);
          }
          if (event.type === 'error') {
            console.error(`   ❌ Error: ${event.error}`);
          }
          if (event.type === 'done') {
            console.log(`   ✅ Done: success=${event.success}`);
          }
          if (event.type === 'tool_invocation') {
            const s = event.state || 'unknown';
            console.log(`   🔧 ToolInv: ${event.toolName} [${s}]`);
          }
        } catch (e) {
          // Skip parse errors
        }
      }
    }
    
    clearTimeout(timeout);
    
    console.log(`   📊 Events: ${events.length}, Text: ${fullText.length} chars`);
    
    const result = await test.verify(events);
    console.log(`   ${result.pass ? '✅' : '❌'} ${result.details}`);
    
    return result;
    
  } catch (error) {
    console.error(`   ❌ Test error: ${error.message}`);
    return { pass: false, details: error.message };
  }
}

async function main() {
  console.log('🚀 Starting Comprehensive E2E Agent Tests\n');
  
  try {
    await login();
    
    const results = [];
    for (const test of TESTS) {
      const result = await runChatTest(test);
      results.push({ name: test.name, ...result });
      await new Promise(r => setTimeout(r, 2000)); // Pause between tests
    }
    
    console.log('\n\n📊 TEST SUMMARY');
    console.log('═'.repeat(60));
    results.forEach(r => {
      console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
      console.log(`   ${r.details}`);
    });
    
    const passed = results.filter(r => r.pass).length;
    console.log(`\n${passed}/${results.length} tests passed`);
    
    process.exit(passed === results.length ? 0 : 1);
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();
