/**
 * Complete E2E Test with Full Output Capture
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

async function captureFullStream() {
  console.log('=== CAPTURING FULL STREAM OUTPUT ===\n');
  
  const authToken = await login();
  console.log('Logged in\n');

  const body = {
    messages: [{ 
      role: 'user', 
      content: 'Create a file called my-app.js with the content: function main() { console.log("App works!"); }' 
    }],
    stream: true,
    provider: 'mistral',
    model: 'mistral-small-latest',
    enableTools: true,
  };
  
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
  
  console.log('Sending request...\n');

  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  console.log('Status:', response.status);

  if (!response.ok) {
    console.log('ERROR:', await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let fullText = '';
  let events = [];
  let lastContent = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    
    // Parse each line
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const data = JSON.parse(line.slice(6));
          events.push({ type: data.type || data.event, data });
        } catch (e) {
          // Skip non-JSON
        }
      }
    }
  }
  reader.releaseLock();

  console.log('\n=== CAPTURED EVENTS ===');
  console.log('Total events:', events.length);
  
  // Group events by type
  const eventTypes = {};
  for (const e of events) {
    const t = e.type || 'unknown';
    eventTypes[t] = (eventTypes[t] || 0) + 1;
  }
  console.log('Event types:', JSON.stringify(eventTypes));
  
  // Print content events
  const contentEvents = events.filter(e => e.type === 'content' || e.type === 'text' || e.type === 'token');
  console.log('\nFirst 5 content events:');
  for (const e of contentEvents.slice(0, 5)) {
    const txt = e.data?.content || e.data?.text || lastContent;
    lastContent = txt;
    console.log(' -', txt.slice(0, 100));
  }
  
  // Print tool events  
  const toolEvents = events.filter(e => e.type?.includes('tool'));
  console.log('\nTool events found:', toolEvents.length);
  for (const e of toolEvents.slice(0, 3)) {
    console.log(' -', JSON.stringify(e.data).slice(0, 300));
  }
  
  // Print filesystem events
  const fsEvents = events.filter(e => e.type === 'filesystem' || e.type === 'file_edit');
  console.log('\nFilesystem events:', fsEvents.length);
  for (const e of fsEvents) {
    console.log(' -', JSON.stringify(e.data).slice(0, 300));
  }
  
  // Check final VFS
  console.log('\n=== VFS STATE ===');
  const snapshot = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project/sessions`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  }).then(r => r.json());
  
  console.log('Session files:', snapshot.files?.length || 0);
  for (const f of (snapshot.files || []).slice(0, 10)) {
    console.log(' -', f.path);
  }
}

captureFullStream().catch(console.error);