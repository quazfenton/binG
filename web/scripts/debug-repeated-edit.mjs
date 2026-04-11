/**
 * Debug repeated file edit flow
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
  
  // Create file with known content
  const writeRes = await fetch(`${BASE_URL}/api/filesystem/write`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/repeated-edit.txt', content: 'Line 1\nLine 2\nLine 3' }),
  });
  console.log('Write:', writeRes.status);
  
  // Read initial content
  const readRes = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/repeated-edit.txt' }),
  });
  const readData = await readRes.json();
  console.log('Initial content:', readData.data?.content);
  
  // Now ask LLM to add Line 4
  console.log('\n--- Request 1: Add Line 4 ---');
  const chatRes1 = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Add "Line 4" to the end of project/repeated-edit.txt' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const chatData1 = await chatRes1.json();
  console.log('Chat 1 status:', chatRes1.status);
  console.log('Chat 1 response:', chatData1?.response?.slice(0, 300) || 'no response');
  console.log('Chat 1 metadata:', JSON.stringify(chatData1?.metadata || {}).slice(0, 200));
  
  // Wait for edit
  await new Promise(r => setTimeout(r, 3000));
  
  // Check content after first edit
  const readRes2 = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/repeated-edit.txt' }),
  });
  const readData2 = await readRes2.json();
  console.log('\nContent after edit 1:', readData2.data?.content);
  
  // Now ask LLM to add Line 5
  console.log('\n--- Request 2: Add Line 5 ---');
  const chatRes2 = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Add "Line 5" to the end of project/repeated-edit.txt' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const chatData2 = await chatRes2.json();
  console.log('Chat 2 status:', chatRes2.status);
  console.log('Chat 2 response:', chatData2?.response?.slice(0, 300) || 'no response');
  console.log('Chat 2 metadata:', JSON.stringify(chatData2?.metadata || {}).slice(0, 200));
  
  // Wait for edit
  await new Promise(r => setTimeout(r, 3000));
  
  // Check content after second edit
  const readRes3 = await fetch(`${BASE_URL}/api/filesystem/read`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/repeated-edit.txt' }),
  });
  const readData3 = await readRes3.json();
  console.log('\nContent after edit 2:', readData3.data?.content);
}

main().catch(console.error);
