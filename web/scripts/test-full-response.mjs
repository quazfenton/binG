const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('Starting test...');
  
  const loginRes = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('Login OK');

  // Send chat request
  console.log('Sending chat request...');
  const chatRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Write a file called project/honest-test-file.txt with content: TEST_CONTENT_ABC' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  console.log('Chat status:', chatRes.status);
  const data = await chatRes.json();
  
  console.log('\n=== FULL DATA STRUCTURE ===');
  console.log('Top-level keys:', Object.keys(data));
  console.log('data.data keys:', Object.keys(data.data || {}));
  console.log('data.data._debug:', JSON.stringify(data.data?._debug));
  console.log('data.data.appliedEdits:', JSON.stringify(data.data?.appliedEdits));
  console.log('data.data.metadata:', JSON.stringify(data.data?.metadata, null, 2));
  
  // Check if file was created
  await new Promise(r => setTimeout(r, 3000));
  const readRes = await fetch(BASE_URL + '/api/filesystem/read', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/honest-test-file.txt' }),
  });
  const readData = await readRes.json();
  console.log('\nFile content after:', readData.data?.content || '(not found)');
}

main().catch(e => console.error('ERROR:', e));
