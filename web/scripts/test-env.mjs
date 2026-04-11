const BASE_URL = 'http://localhost:3000';

async function main() {
  const loginRes = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('Login OK');

  const chatRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'echo hello' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const data = await chatRes.json();
  console.log('data.data keys:', Object.keys(data.data || {}));
  console.log('metadata:', JSON.stringify(data.data?.metadata || {}, null, 2).slice(0, 500));
}

main().catch(e => console.error('ERROR:', e));
