/**
 * Simple debug test
 */

const BASE_URL = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const data = await res.json();
  return data?.accessToken || data?.token || '';
}

async function test() {
  const auth = await login();
  console.log('Token:', auth.slice(0, 20) + '...');
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Create a file named simple.txt with content: hello' }
      ],
      stream: false,
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
    }),
  });

  console.log('Chat Status:', response.status);
  const data = await response.json();
  console.log('Response content:', data.content?.slice(0, 200));
}

test().catch(console.error);