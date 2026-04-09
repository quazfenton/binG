/**
 * Test to capture raw LLM response for debugging
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
        { role: 'user', content: 'Create a file named debug-test.txt with content: Hello from debug!' }
      ],
      stream: true,
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      enableTools: true,
    }),
  });

  console.log('Status:', response.status);
  
  // Collect all SSE data
  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    
    // Try to parse each SSE event
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) {
            process.stdout.write(data.content);
          }
          if (data.toolCalls) {
            console.log('\n[TOOL CALLS]:', JSON.stringify(data.toolCalls, null, 2));
          }
        } catch (e) {
          // Not JSON, maybe plain text
        }
      }
    }
  }
  
  console.log('\n\n--- RAW SSE PREVIEW (first 3000 chars) ---');
  console.log(fullText.slice(0, 3000));
  console.log('...');
}

test().catch(console.error);