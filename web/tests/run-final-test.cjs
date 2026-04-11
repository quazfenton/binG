/**
 * Complete test with proper VFS paths and logging
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

async function checkVFS(auth) {
  // Try multiple paths that could have files
  const paths = ['project', 'project/sessions', 'project/sessions/000', '.binG-temp'];
  for (const p of paths) {
    const res = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=${p}`, {
      headers: { 'Authorization': `Bearer ${auth}` }
    });
    const data = await res.json();
    console.log(`Path ${p}:`, data.files?.length || 0, 'files');
    if (data.files?.length) {
      for (const f of data.files) console.log(' -', f.path);
    }
  }
}

async function test() {
  const auth = await login();
  console.log('Logging in...\n');
  
  // First, check what's in VFS now
  console.log('=== BEFORE ===');
  await checkVFS(auth);
  
  // Send the request
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: 'Create file called hello.txt with content: hello world' 
      }],
      stream: true,
      enableTools: true,
    }),
  });

  console.log('\nStatus:', response.status);
  
  // Consume the stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.decode(value, { stream: true });
  }
  reader.releaseLock();

  // Wait a moment for async ops
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('\n=== AFTER ===');
  await checkVFS(auth);
}

test().catch(console.error);