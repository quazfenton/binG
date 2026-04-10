const BASE_URL = 'http://localhost:3000';

async function main() {
  const loginRes = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('Login OK');

  // Test 1: Diff application
  console.log('\n=== TEST: Diff application ===');
  await fetch(BASE_URL + '/api/filesystem/write', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/diff-test.txt', content: 'Line 1\nLine 2\nLine 3' }),
  });

  const diffRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Apply this diff to project/diff-test.txt:\n```diff\n--- a/project/diff-test.txt\n+++ b/project/diff-test.txt\n@@ -1,3 +1,3 @@\n Line 1\n-Line 2\n+Line TWO\n Line 3\n```' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const diffData = await diffRes.json();
  console.log('Diff response (first 400 chars):');
  console.log((diffData.content || '').slice(0, 400));

  await new Promise(r => setTimeout(r, 5000));
  const diffCheck = await fetch(BASE_URL + '/api/filesystem/read', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/diff-test.txt' }),
  });
  const diffCheckData = await diffCheck.json();
  console.log('File after diff:', diffCheckData.data?.content || '(not found)');

  // Test 2: Self-healing
  console.log('\n=== TEST: Self-healing ===');
  await fetch(BASE_URL + '/api/filesystem/write', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/heal-test.js', content: 'const x = ' }),
  });

  const healRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Fix the syntax error in project/heal-test.js. It should be valid JavaScript that assigns a value to x.' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const healData = await healRes.json();
  console.log('Heal response (first 400 chars):');
  console.log((healData.content || '').slice(0, 400));

  await new Promise(r => setTimeout(r, 5000));
  const healCheck = await fetch(BASE_URL + '/api/filesystem/read', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'project/heal-test.js' }),
  });
  const healCheckData = await healCheck.json();
  console.log('File after heal:', healCheckData.data?.content || '(not found)');
}

main().catch(e => console.error('ERROR:', e));
