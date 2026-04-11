/**
 * Raw Stream Capture Test
 */

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const body = await res.json();
  return body?.accessToken || body?.token || '';
}

async function test() {
  const auth = await login();
  console.log('Auth:', auth.slice(0, 20) + '...\n');
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Create hello.txt with hello world in it' }],
      stream: true,
      provider: 'mistral',
      model: 'mistral-small-latest', 
      enableTools: true
    }),
  });

  console.log('Response status:', response.status);
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let buffer = '';
  let count = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Print raw lines
    const lines = buffer.split('\n');
    for (const line of lines.slice(0, -1)) {
      if (line.startsWith('data: ')) {
        console.log(`Line ${count++}:`, line.slice(0, 150));
      }
    }
    buffer = lines[lines.length - 1];
  }
  
  // Last line
  if (buffer.startsWith('data: ')) {
    console.log(`Line ${count++}:`, buffer.slice(0, 150));
  }
  
  console.log('\nTotal lines:', count);
  reader.releaseLock();
  
  // Check VFS
  const snap = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project/sessions/000`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  }).then(r => r.json());
  
  console.log('\nVFS files:', JSON.stringify(snap.files?.map(f => f.path)));
}

test().catch(e => console.error(e));