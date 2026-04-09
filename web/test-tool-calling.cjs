/**
 * Diagnostic test for LLM tool calling
 * Tests different providers, models, and prompt formats to identify why tools aren't being used
 */

require('dotenv').config();

const API_BASE = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

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
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });
  const data = await res.json();
  return data.token;
}

async function testProvider(token, provider, model, prompt) {
  log(`\n--- Testing ${provider}/${model} ---`, 'blue');
  log(`Prompt: "${prompt.slice(0, 60)}..."`, 'yellow');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        provider,
        model,
        stream: false
      })
    });
    
    const data = await res.json();
    
    // Check response
    const content = data.content || '';
    const toolCalls = data.toolCalls || [];
    
    log(`  Status: ${res.status}`, res.status === 200 ? 'green' : 'red');
    log(`  Content length: ${content.length}`, content.length > 0 ? 'green' : 'red');
    log(`  Tool calls: ${toolCalls.length}`, toolCalls.length > 0 ? 'green' : 'red');
    
    // Check if response mentions tool use
    const mentionsFile = /file|created|written|saved/i.test(content);
    const mentionsTool = /tool|function|write_file|create_file/i.test(content);
    
    log(`  Mentions file ops: ${mentionsFile}`, mentionsFile ? 'green' : 'yellow');
    log(`  Mentions tools: ${mentionsTool}`, mentionsTool ? 'green' : 'yellow');
    
    // Show first 300 chars of content
    if (content) {
      log(`  Content preview: "${content.slice(0, 300).replace(/\n/g, '\\n')}"`, 'reset');
    }
    
    return { content, toolCalls, mentionsFile, mentionsTool, status: res.status };
  } catch (e) {
    log(`  Error: ${e.message}`, 'red');
    return { error: e.message };
  }
}

async function main() {
  log('=== LLM Tool Calling Diagnostic Test ===', 'blue');
  
  const token = await login();
  if (!token) {
    log('Login failed', 'red');
    return;
  }
  log('Login successful', 'green');
  
  // Test different providers with their best models
  const tests = [
    // NVIDIA models
    { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', prompt: 'Create a file called test-nvidia.js with content: console.log("nvidia test")' },
    { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', prompt: 'Create a file called test-llama.js with content: console.log("llama test")' },
    
    // Mistral models  
    { provider: 'mistral', model: 'mistral-small-latest', prompt: 'Create a file called test-mistral.js with content: console.log("mistral test")' },
    { provider: 'mistral', model: 'mistral-large-latest', prompt: 'Create a file called test-large.js with content: console.log("mistral large")' },
    
    // OpenRouter models
    { provider: 'openrouter', model: 'mistralai/mistral-small-latest', prompt: 'Create a file called test-or.js with content: console.log("openrouter")' },
    { provider: 'openrouter', model: 'google/gemini-2.0-flash-exp', prompt: 'Create a file called test-gemini.js with content: console.log("gemini")' },
    
    // Google
    { provider: 'google', model: 'gemini-2.0-flash-exp', prompt: 'Create a file called test-google.js with content: console.log("google")' },
    
    // Test with explicit instructions
    { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', prompt: 'Create a file called explicit.js with content: console.log("explicit"). Use the write_file tool to do this.' },
    
    // Test simple file creation
    { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', prompt: 'Write hello world to a file called simple.txt' },
  ];
  
  for (const test of tests) {
    await testProvider(token, test.provider, test.model, test.prompt);
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }
  
  log('\n=== Test Complete ===', 'blue');
}

main().catch(console.error);