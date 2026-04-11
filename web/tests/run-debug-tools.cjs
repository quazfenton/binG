/**
 * Debug test to see if tools are actually being passed
 */

const BASE_URL = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const loginData = await res.json();
  console.log('Login response:', JSON.stringify(loginData).slice(0, 200));
  return loginData?.accessToken || loginData?.token || '';
}

async function test() {
  const auth = await login();
  console.log('\n--- Testing with enableTools explicitly set ---\n');
  
  // Try non-streaming to see full response
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
      agentMode: 'v2',
      enableTools: true,
    }),
  });

  console.log('Status:', response.status);
  const data = await response.json();
  console.log('\n--- Response ---');
  console.log('Success:', data.success);
  console.log('Content:', data.content?.slice(0, 500));
  console.log('Tool invocations:', JSON.stringify(data.data?.toolInvocations, null, 2)?.slice(0, 500));
  console.log('Metadata:', JSON.stringify(data.data?.metadata, null, 2)?.slice(0, 500));
}

test().catch(console.error);