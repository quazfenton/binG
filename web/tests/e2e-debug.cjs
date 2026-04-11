/**
 * E2E Debug Test - Tests file creation and tool calling
 */

const API_BASE = 'http://localhost:3000';
const EMAIL = 'test@test.com';
const PASSWORD = 'Testing0';

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  const data = await res.json();
  return data.token;
}

async function testFileCreation() {
  console.log('=== Test: File Creation ===');
  const token = await login();
  
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: 'Create test-e2e.js with content: console.log("e2e test works");' 
      }],
      provider: 'google',
      model: 'gemini-3-flash-preview',
      stream: false,
      toolMode: 'vercel-tools'
    })
  });
  
  const data = await res.json();
  
  console.log('Keys:', Object.keys(data));
  console.log('Success:', data.success);
  console.log('Content (first 500):', (data.content || '').substring(0, 500));
  console.log('toolCalls:', data.toolCalls?.length);
  console.log('fileEdits (top):', data.fileEdits?.length);
  console.log('filesystem.applied:', data.filesystem?.applied?.length);
  console.log('data.metadata.fileEdits:', data.data?.metadata?.fileEdits?.length);
  
  // Check for file edit markers in content
  const hasFileEdit = (data.content || '').includes('<file_edit') || 
                      (data.content || '').includes('```fs-actions') ||
                      (data.content || '').includes('WRITE ');
  console.log('Has file markers in content:', hasFileEdit);
  
  return data;
}

async function verifyFileInVFS(path) {
  const token = await login();
  const res = await fetch(`${API_BASE}/api/filesystem/read?path=${encodeURIComponent(path)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Read status:', res.status);
  if (res.ok) {
    const content = await res.text();
    console.log('File content:', content.substring(0, 200));
  }
  return res.ok;
}

async function testTerminal() {
  console.log('\n=== Test: Terminal Execution ===');
  const token = await login();
  
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ 
        role: 'user', 
        content: 'Run: echo hello-terminal-123' 
      }],
      provider: 'google',
      model: 'gemini-3-flash-preview',
      stream: false
    })
  });
  
  const data = await res.json();
  const content = data.content || data.data?.content || '';
  console.log('Has expected output:', content.includes('hello-terminal-123'));
  console.log('Content (first 300):', content.substring(0, 300));
  return content.includes('hello-terminal-123');
}

async function main() {
  try {
    const fileResult = await testFileCreation();
    
    // Try to verify file
    const filePath = fileResult.filesystem?.applied?.[0]?.path || 
                     fileResult.data?.metadata?.fileEdits?.[0]?.path;
    if (filePath) {
      console.log('\n=== Verify file created ===');
      await verifyFileInVFS(filePath);
    }
    
    await testTerminal();
    
    console.log('\n=== Tests complete ===');
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}

main();