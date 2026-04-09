/**
 * Test with multiple providers/models that support function calling
 */

const BASE_URL = 'http://localhost:3000';

const PROVIDERS_TO_TEST = [
  { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', name: 'NVIDIA Nemotron' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct', name: 'OpenRouter Llama' },
  { provider: 'github', model: 'Copilot-4', name: 'GitHub Copilot' },
  { provider: 'google', model: 'gemini-2.0-flash-exp', name: 'Google Gemini' },
];

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const loginData = await res.json();
  return loginData?.accessToken || loginData?.token || '';
}

async function getVfsFiles(auth) {
  const res = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project/sessions`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  });
  const data = await res.json();
  return data?.data?.files || [];
}

async function testProvider(auth, provider, model, name) {
  console.log(`\n=== Testing ${name} ===`);
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Create file named test-func.txt with content: Function call test!' }
      ],
      stream: true,
      provider,
      model,
      enableTools: true,
    }),
  });

  console.log('Status:', response.status);
  
  if (!response.ok) {
    const err = await response.text();
    console.log('Error:', err.slice(0, 200));
    return false;
  }
  
  // Capture stream events
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let eventCount = 0;
  let toolCalls = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          eventCount++;
          if (data.toolName || data.type?.includes('tool')) {
            toolCalls.push(data);
          }
        } catch (e) {}
      }
    }
  }
  reader.releaseLock();
  
  console.log('Events:', eventCount, 'Tool calls:', toolCalls.length);
  return toolCalls.length > 0;
}

async function main() {
  const auth = await login();
  console.log('Logged in\n');
  
  // Get existing files
  const before = await getVfsFiles(auth);
  console.log('Files before:', before.map(f => f.path).slice(0, 3));
  
  // Test each provider
  let foundWorking = false;
  for (const { provider, model, name } of PROVIDERS_TO_TEST) {
    const hasTools = await testProvider(auth, provider, model, name);
    if (hasTools) {
      console.log(`\n>>> ${name} WORKS! <<<`);
      foundWorking = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Check results
  await new Promise(r => setTimeout(r, 1500));
  const after = await getVfsFiles(auth);
  const testFile = after.find(f => f.path.includes('test-func'));
  
  console.log('\n=== FINAL RESULTS ===');
  console.log('Test file created:', !!testFile);
  if (testFile) console.log('Content:', testFile.content);
  
  return !!testFile;
}

main().catch(console.error);