/**
 * Test with better error handling
 */

const BASE_URL = 'http://localhost:3000';

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

async function test() {
  const auth = await login();
  console.log('Logged in\n');
  
  // Show files before
  const before = await getVfsFiles(auth);
  console.log('Files before:', before.map(f => f.path).slice(0, 3));
  
  // Use streaming request
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Create file named from-llm.txt with content: LLM created this!' }
      ],
      stream: true,
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      agentMode: 'v1',
      enableTools: true,
    }),
  });

  console.log('\nStatus:', response.status);
  
  // Handle SSE response properly
  if (!response.ok) {
    const err = await response.text();
    console.log('Error:', err.slice(0, 300));
    return;
  }
  
  // Consume stream without doing anything
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  reader.releaseLock();
  
  // Wait for async
  await new Promise(r => setTimeout(r, 1500));
  
  const after = await getVfsFiles(auth);
  const newFiles = after.filter(f => f.path.includes('from-llm'));
  console.log('\nFiles after:', after.map(f => f.path).slice(0, 5));
  console.log('Created new:', newFiles.map(f => f.path));
}

test().catch(console.error);