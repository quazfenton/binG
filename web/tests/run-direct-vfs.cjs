/**
 * Direct test of VFS API
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

async function test() {
  const auth = await login();
  console.log('Logged in\n');
  
  // Test VFS write directly
  const vfsRes = await fetch(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      path: 'project/sessions/001/direct-test.txt',
      content: 'Direct VFS write works!',
    }),
  });

  console.log('VFS Write Status:', vfsRes.status);
  const vfsData = await vfsRes.json();
  console.log('VFS Write Response:', JSON.stringify(vfsData).slice(0, 300));
  
  // Now verify the file exists
  const snapshotRes = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project/sessions/001`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  });
  const snapshotData = await snapshotRes.json();
  console.log('\nFiles in session 001:');
  console.log(snapshotData?.data?.files?.map(f => f.path));
}

test().catch(console.error);