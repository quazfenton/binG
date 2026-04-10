const BASE_URL = 'http://localhost:3000';

async function main() {
  const loginRes = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('Login OK');

  // Create the broken file
  await fetch(BASE_URL + '/api/filesystem/write', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/debug-heal.js', content: 'const x = ' }),
  });
  console.log('Created broken file');

  const healRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Fix the syntax error in project/debug-heal.js. It should be valid JavaScript that assigns a value to x.' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const data = await healRes.json();
  console.log('=== FULL LLM RESPONSE ===');
  console.log(data.content || 'NO CONTENT');
  console.log('=== END ===');

  // Check if file was fixed
  await new Promise(r => setTimeout(r, 5000));
  const readRes = await fetch(BASE_URL + '/api/filesystem/read', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/debug-heal.js' }),
  });
  const readData = await readRes.json();
  console.log('\nFile content after:', readData.data?.content || '(not found)');
}

main().catch(console.error);
