/**
 * Detailed E2E Test with Full Logging
 */

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

async function post(endpoint, body, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login() {
  const result = await post('/api/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  return result.body?.accessToken || result.body?.token || '';
}

async function detailedTest() {
  console.log('=== DETAILED TEST WITH LOGGING ===\n');
  
  const authToken = await login();
  console.log('Logged in\n');

  const body = {
    messages: [{ role: 'user', content: 'Create a simple file called test.js with content console.log("hello")' }],
    stream: true,
    provider: 'mistral',
    model: 'mistral-small-latest',
    enableTools: true,
  };
  
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
  
  console.log('Sending request with enableTools: true\n---');
  
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  console.log('Response status:', response.status);
  console.log('Response headers:', [...response.headers.entries()].map(h => `${h[0]}: ${h[1]}`).join('\n'));
  console.log('\n--- Response body (streaming) ---\n');

  if (!response.ok) {
    console.log('ERROR: Response not OK');
    const text = await response.text();
    console.log(text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let fullResponse = '';
  let eventCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let fileEditCount = 0;
  let textContent = '';
  let errorEvents = [];
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      
      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const data = JSON.parse(line.slice(6));
            eventCount++;
            
            const type = data.type || data.event;
            if (type === 'tool-call' || type === 'tool_invocation') {
              toolCallCount++;
              console.log(`TOOL_CALL (${toolCallCount}):`, JSON.stringify(data.data || data, null, 2).slice(0, 500));
            } else if (type === 'tool-result') {
              toolResultCount++;
              console.log('TOOL_RESULT:', JSON.stringify(data.data || data, null, 2).slice(0, 500));
            } else if (type === 'file_edit' || type === 'filesystem') {
              fileEditCount++;
              console.log('FILE_EDIT:', JSON.stringify(data.data || data, null, 2).slice(0, 500));
            } else if (type === 'error') {
              errorEvents.push(data);
              console.log('ERROR EVENT:', JSON.stringify(data));
            } else if (type === 'text' || type === 'token') {
              textContent += data.content || data.text || '';
            } else {
              // Log other events briefly
              if (eventCount <= 5) console.log(`EVENT ${type}:`, JSON.stringify(data).slice(0, 200));
            }
          } catch (e) {
            // Not JSON, ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total events:', eventCount);
  console.log('Tool calls:', toolCallCount);
  console.log('Tool results:', toolResultCount);
  console.log('File edits:', fileEditCount);
  console.log('Errors:', errorEvents.length);
  console.log('Text content length:', textContent.length);
  console.log('\nText content preview:', textContent.slice(0, 500));
  
  // Check VFS
  console.log('\n=== VFS SNAPSHOT ===');
  const snapshot = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  }).then(r => r.json());
  
  console.log('Files in project:', snapshot.files?.length || 0);
  console.log('Files:', JSON.stringify(snapshot.files?.map(f => f.path), null, 2));
}

detailedTest().catch(console.error);