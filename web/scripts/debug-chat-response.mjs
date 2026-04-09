/**
 * Debug chat response structure
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
  
  // Send a simple chat request
  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Add "Line 4" to the end of project/repeated-edit.txt' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  
  console.log('Status:', chatRes.status);
  const chatData = await chatRes.json();
  console.log('Full response keys:', Object.keys(chatData));
  console.log('Full response:', JSON.stringify(chatData, null, 2).slice(0, 1500));
}

main().catch(console.error);
