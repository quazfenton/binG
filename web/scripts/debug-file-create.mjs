/**
 * Debug file creation via VFS
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
  console.log('Login OK');
  
  // Test write
  const writeRes = await fetch(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'project/test-edit.txt',
      content: 'Hello World - original content',
    }),
  });
  console.log('Write status:', writeRes.status);
  const writeData = await writeRes.json();
  console.log('Write response:', JSON.stringify(writeData, null, 2).slice(0, 800));
  
  // Test read
  const readRes = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: 'project/test-edit.txt' }),
  });
  console.log('\nRead status:', readRes.status);
  const readData = await readRes.json();
  console.log('Read response:', JSON.stringify(readData, null, 2).slice(0, 500));
  
  // Test list
  const listRes = await fetch(`${BASE_URL}/api/filesystem/list?path=project`, {
    headers: { 'Cookie': sessionCookie },
  });
  console.log('\nList status:', listRes.status);
  const listData = await listRes.json();
  const nodes = listData.data?.nodes || [];
  console.log('Files/dirs in project:', nodes.length);
  const testEditFile = nodes.find(n => n.name === 'test-edit.txt' || n.path?.includes('test-edit'));
  console.log('test-edit.txt found:', !!testEditFile);
  if (testEditFile) console.log('  →', JSON.stringify(testEditFile));
}

main().catch(console.error);
