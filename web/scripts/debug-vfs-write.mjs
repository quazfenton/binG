/**
 * Debug VFS write endpoint
 */

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';

async function main() {
  // Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = loginRes.headers.get('set-cookie');
  const sessionCookie = cookie ? cookie.split(';')[0] : '';
  console.log('Login OK, cookie:', sessionCookie.slice(0, 40));
  
  // Test 1: Create file via /api/filesystem/write
  console.log('\n=== Test: Create file via /api/filesystem/write ===');
  const writeRes = await fetch(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'project/debug-test.txt',
      content: 'Debug test content',
    }),
  });
  console.log('Write status:', writeRes.status);
  const writeData = await writeRes.json();
  console.log('Write response:', JSON.stringify(writeData, null, 2).slice(0, 500));
  
  // Test 2: List files
  console.log('\n=== Test: List files ===');
  const listRes = await fetch(`${BASE_URL}/api/filesystem/list?path=project`, {
    headers: { 'Cookie': sessionCookie },
  });
  console.log('List status:', listRes.status);
  const listData = await listRes.json();
  console.log('List response:', JSON.stringify(listData, null, 2).slice(0, 1000));
  
  // Test 3: Read file (POST endpoint)
  console.log('\n=== Test: Read file ===');
  const readRes = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: 'project/debug-test.txt' }),
  });
  console.log('Read status:', readRes.status);
  const readData = await readRes.json();
  console.log('Read response:', JSON.stringify(readData, null, 2).slice(0, 500));
}

main().catch(console.error);
