/**
 * Simple working test
 */

const BASE_URL = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const loginData = await res.json();
  const token = loginData?.accessToken || loginData?.token;
  return token;
}

async function getVfsFiles(auth, path = 'project/sessions') {
  const res = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=${path}`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  });
  const data = await res.json();
  return data?.data?.files || [];
}

async function test() {
  const auth = await login();
  console.log('Logged in');
  
  // Show existing files
  const existing = await getVfsFiles(auth);
  console.log('Current files:', existing.map(f => f.path).slice(0, 5));
  
  // Chat with file creation tool
  console.log('\n=== CHAT REQUEST ===');
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Create file called via-chat.txt with content: this was created by the LLM' }],
      stream: false,
      enableTools: true,
    }),
  });

  console.log('Response status:', response.status);
  const responseData = await response.json();
  console.log('Response keys:', Object.keys(responseData || {}));
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Check new files
  const updated = await getVfsFiles(auth);
  const newFiles = updated.filter(f => f.path.includes('via-chat'));
  console.log('\nCreated files:', newFiles.map(f => f.path));
}

test().catch(console.error);