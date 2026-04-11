/**
 * Simple login test
 */

const BASE_URL = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 200));
  return text;
}

login().catch(console.error);