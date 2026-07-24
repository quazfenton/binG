#!/usr/bin/env node
/**
 * Direct LLM Agent Test - Tests actual agentic workflows
 * Uses longer timeouts to handle slow server
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const BASE_URL = 'http://127.0.0.1:3000';

// Helper to run curl with timeout
function curlPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const headerArgs = Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
    const args = ['-f', '-X', 'POST', url, '-H', 'Content-Type: application/json', ...headerArgs, '-d', JSON.stringify(data), '-m', '120', '-v'];
    
    const proc = spawn('curl', args);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    
    proc.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`curl failed: ${code}\n${stderr}`));
    });
    
    setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, 180000);
  });
}

async function testWorkflow() {
  console.log('🚀 Testing Agent Workflow\n');
  
  // Test 1: Simple health check
  console.log('Test 1: API Health');
  try {
    const { stdout } = await curlPost(`${BASE_URL}/api/health`, {});
    console.log('✅ Health:', stdout.slice(0, 100));
  } catch (e) {
    console.log('❌ Health failed:', e.message.slice(0, 200));
  }
  
  // Test 2: Login
  console.log('\nTest 2: Login');
  let authToken, sessionId;
  try {
    const { stdout, stderr } = await curlPost(`${BASE_URL}/api/auth/login`, {
      email: 'test@test.com',
      password: 'Testing00000?'
    });
    
    const setCookie = stderr.match(/set-cookie: ([^\r\n]+)/i);
    sessionId = setCookie?.[1]?.match(/session_id=([^;]+)/)?.[1];
    
    const data = JSON.parse(stdout);
    authToken = data.token || data.authToken;
    
    console.log('✅ Logged in:', { token: authToken?.slice(0, 20), session: sessionId?.slice(0, 20) });
  } catch (e) {
    console.log('❌ Login failed:', e.message.slice(0, 200));
    return;
  }
  
  // Test 3: Simple chat (no tools)
  console.log('\nTest 3: Simple Chat');
  try {
    const { stdout } = await curlPost(`${BASE_URL}/api/chat`, {
      messages: [{ role: 'user', content: 'Say "test successful" and nothing else' }],
      provider: 'nvidia',
      model: 'openai/gpt-oss-120',
      stream: false
    }, {
      'Authorization': `Bearer ${authToken}`,
      'Cookie': `session_id=${sessionId}`
    });
    
    console.log('✅ Chat response:', stdout.slice(0, 200));
  } catch (e) {
    console.log('❌ Chat failed:', e.message.slice(0, 200));
  }
  
  // Test 4: File creation with tools
  console.log('\nTest 4: File Creation (VFS Tools)');
  try {
    const { stdout } = await curlPost(`${BASE_URL}/api/chat`, {
      messages: [{ role: 'user', content: 'Create a file named test-output.txt with content "Hello from agent test"' }],
      provider: 'google',
      model: 'gemini-2.5-flash-latest',
      stream: false,
      enableFilesystemEdits: true
    }, {
      'Authorization': `Bearer ${authToken}`,
      'Cookie': `session_id=${sessionId}`
    });
    
    console.log('✅ File creation response:', stdout.slice(0, 300));
    writeFileSync('test-4-response.json', stdout);
  } catch (e) {
    console.log('❌ File creation failed:', e.message.slice(0, 200));
  }
  
  console.log('\n✅ Workflow test complete');
}

testWorkflow().catch(e => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
