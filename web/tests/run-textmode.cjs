/**
 * Test with Text-Mode Fallback - Force model to use fenced format
 */

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const body = await res.json();
  return body?.accessToken || body?.token || '';
}

async function testTextMode() {
  const auth = await login();
  console.log('Testing text-mode fallback...\n');
  
  // Prompt that strongly suggests using fenced format
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: `Create a file called test-fenced.txt with the content "text-mode works"

IMPORTANT: Write the file using this EXACT format:
\`\`\`file: test-fenced.txt
text-mode works
\`\`\``
      }],
      stream: true,
      enableTools: true,
    }),
  });

  console.log('Response status:', response.status);
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let buffer = '';
  let count = 0;
  let hasFileEvent = false;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    for (const line of buffer.split('\n').slice(0, -1)) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data.includes('file:') || data.includes('file_edit') || data.includes('filesystem')) {
          hasFileEvent = true;
        }
        console.log(`Line ${count++}:`, data.slice(0, 200));
      }
    }
    buffer = buffer.split('\n')[buffer.split('\n').length - 1];
  }
  
  reader.releaseLock();
  
  console.log('\n=== CHECKING VFS ===');
  const snap = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project/sessions/000`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  }).then(r => r.json());
  
  console.log('Session files:', snap.files?.length);
  for (const f of snap.files || []) {
    console.log(' -', f.path, ':', f.content?.slice(0, 50));
  }
  
  console.log('\n=== CHECKING ALL PATHS ===');
  const all = await fetch(`${BASE_URL}/api/filesystem/snapshot?path=project`, {
    headers: { 'Authorization': `Bearer ${auth}` }
  }).then(r => r.json());
  console.log('Project files:', all.files?.length);
}

testTextMode().catch(console.error);