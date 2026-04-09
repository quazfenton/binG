/**
 * Test with verified working providers
 */

const BASE_URL = 'http://localhost:3000';

// Known working FC-enabled models from providers
const PROVIDERS_TO_TEST = [
  { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'NVIDIA Nemotron 70B' },
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free', name: 'Qwen Coder (free)' },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { provider: 'cohere', model: 'command-a', name: 'Cohere Command A' },
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
  
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth}`
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Create a file named via-' + name.replace(/\s/g, '-').toLowerCase() + '.txt with content: Testing ' + name }
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
      console.log('Error:', err.slice(0, 150));
      return false;
    }
    
    // Capture stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let eventCount = 0;
    let toolCallCount = 0;
    let content = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            eventCount++;
            if (data.toolName || data.toolCallId) toolCallCount++;
            if (data.content) content += data.content;
          } catch (e) {}
        }
      }
    }
    reader.releaseLock();
    
    console.log('Events:', eventCount, 'Tool events:', toolCallCount);
    console.log('Content:', content.slice(0, 80));
    
    return toolCallCount > 0;
  } catch (e) {
    console.log('Exception:', e.message);
    return false;
  }
}

async function main() {
  const auth = await login();
  console.log('Logged in\n');
  
  for (const { provider, model, name } of PROVIDERS_TO_TEST) {
    const hasTools = await testProvider(auth, provider, model, name);
    if (hasTools) {
      console.log(`\n>>> FOUND: ${name} supports tool calls! <<<`);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Final check
  await new Promise(r => setTimeout(r, 1500));
  const after = await getVfsFiles(auth);
  const newFiles = after.filter(f => f.path.includes('via-'));
  console.log('\n=== FILES CREATED ===');
  console.log(newFiles.map(f => f.path + ': ' + (f.content || '').slice(0, 30)));
}

main().catch(console.error);