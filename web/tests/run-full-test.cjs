/**
 * Comprehensive test to see all logs
 */

const BASE_URL = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const loginData = await res.json();
  return loginData?.accessToken || loginData?.token || '';
}

async function test() {
  const auth = await login();
  console.log('Logged in\n');
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Create a file named test.txt with content: hello world' }
      ],
      stream: true,
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
    }),
  });

  console.log('Status:', response.status);
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
  }
  
  console.log('\n--- FULL RAW OUTPUT ---');
  console.log(full.slice(0, 10000));
  
  // Check for tool calls in the output
  const hasToolCall = full.includes('tool-call') || full.includes('toolCall');
  console.log('\nHas tool calls:', hasToolCall);
}

test().catch(console.error);