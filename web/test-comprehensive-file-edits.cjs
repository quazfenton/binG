/**
 * Comprehensive File Edit Format Testing
 * Tests all batch tool call formats through the full chat -> VFS flow
 * 
 * Run: node test-comprehensive-file-edits.cjs
 */

const API_BASE = 'http://localhost:3000';
const AUTH_EMAIL = 'test@test.com';
const AUTH_PASSWORD = 'Testing0';

let authToken = '';
let userId = '';

async function login() {
  console.log('\n=== AUTHENTICATION ===');
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD })
  });
  const data = await res.json();
  if (!data.success) throw new Error('Login failed');
  authToken = data.token;
  userId = data.user.id;
  console.log(`Logged in as ${data.user.email} (ID: ${userId})`);
  return authToken;
}

async function chat(message, options = {}) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      message,
      ...options
    })
  });
  return res.json();
}

async function checkVFSFile(path) {
  const res = await fetch(`${API_BASE}/api/vfs/read`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ path, ownerId: userId })
  });
  if (!res.ok) return null;
  return res.json();
}

async function deleteVFSFile(path) {
  await fetch(`${API_BASE}/api/vfs/delete`, {
    method: 'DELETE',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ path, ownerId: userId })
  });
}

// Test Format A: Special token format (<|tool_call_begin|>)
async function testFormatA() {
  console.log('\n=== FORMAT A: Special Token Tool Calls (<|tool_call_begin|> ===');
  
  // Clean up first
  await deleteVFSFile('test-format-a/app.js');
  
  const prompt = `Create a simple Express app using the special tool call format:

<|tool_call_begin|> functions.batch_write:0 <|tool_call_argument_begin|>
{"files":[{"path":"test-format-a/app.js","content":"const express = require('express');\\nconst app = express();\\n\\napp.get('/', (req, res) => {\\n  res.send('Hello from Format A!');\\n});\\n\\nmodule.exports = app;"}]}
<|tool_call_end|>

Don't write anything else - just create this file.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    // Check if file was created
    const vfsFile = await checkVFSFile('test-format-a/app.js');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 80) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test Format B: Fenced block with batch_write call
async function testFormatB() {
  console.log('\n=== FORMAT B: Fenced Block with batch_write ===');
  
  await deleteVFSFile('test-format-b/utils.js');
  
  const prompt = 'Create a utility file using the fenced batch_write format:\n\n```javascript\nbatch_write([\n  {\n    "path": "test-format-b/utils.js",\n    "content": "export function greet(name) {\\n  return \\\`Hello, \\\${name}!\\\`;\\n}\\n\\nexport function formatDate(date) {\\n  return new Date(date).toISOString();\\n}"\n  }\n])\n```\n\nDon\'t write anything else - just create this file.';

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const vfsFile = await checkVFSFile('test-format-b/utils.js');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 80) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test Format C: tool_call fenced block
async function testFormatC() {
  console.log('\n=== FORMAT C: tool_call Fenced Block ===');
  
  await deleteVFSFile('test-format-c/config.json');
  
  const prompt = `Create a config file using the tool_call format:

\`\`\`tool_call
{
  "tool_name": "batch_write",
  "parameters": {
    "files": [
      {
        "path": "test-format-c/config.json",
        "content": {
          "name": "test-app",
          "version": "1.0.0",
          "description": "Test application created via Format C"
        }
      }
    ]
  }
}
\`\`\`

Don't write anything else - just create this file.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const vfsFile = await checkVFSFile('test-format-c/config.json');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 100) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test Format: Flat JSON with unescaped quotes (malformed JSON handling)
async function testMalformedJson() {
  console.log('\n=== MALFORMED JSON: Unescaped Quotes in Content ===');
  
  await deleteVFSFile('test-malformed/test.js');
  
  // This format uses regular single quotes inside string which is invalid JSON
  const prompt = `Create a test file using flat JSON with problematic content:

{"tool": "batch_write", "files": [{"path": "test-malformed/test.js", "content": "import { something } from 'some-module';\\nconsole.log('test');"}]}

Don't write anything else - just create this file.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const vfsFile = await checkVFSFile('test-malformed/test.js');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 80) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test Format: Bare batch_write function call (no code block)
async function testBareBatchWrite() {
  console.log('\n=== BARE batch_write: No Fenced Code Block ===');
  
  await deleteVFSFile('test-bare/helper.ts');
  
  const prompt = `Create a helper file using bare function call:

batch_write([{"path": "test-bare/helper.ts", "content": "export const PI = 3.14159;\\nexport function capitalize(str: string): string {\\n  return str.charAt(0).toUpperCase() + str.slice(1);\\n}"}])

Don't write anything else - just create this file.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const vfsFile = await checkVFSFile('test-bare/helper.ts');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 80) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test Unicode content handling
async function testUnicodeContent() {
  console.log('\n=== UNICODE CONTENT: Non-ASCII Characters ===');
  
  await deleteVFSFile('test-unicode/i18n.js');
  
  const prompt = `Create an internationalization file with unicode:

batch_write([{"path": "test-unicode/i18n.js", "content": "export const messages = {\\n  greeting: 'Hello',\\n  chinese: '\\u4e2d\\u6587\\u4f60\\u597d',\\n  japanese: '\\u65e5\\u672c\\u8a9e',\\n  emoji: 'Hello \\ud83d\\ude00'\\n};"}])

Don't write anything else - just create this file.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const vfsFile = await checkVFSFile('test-unicode/i18n.js');
    if (vfsFile && vfsFile.content) {
      console.log('SUCCESS: File created in VFS');
      console.log('Content preview:', vfsFile.content.substring(0, 100) + '...');
      return true;
    } else {
      console.log('FAILED: File not found in VFS');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Test batch write with multiple files
async function testMultipleFiles() {
  console.log('\n=== MULTIPLE FILES: Batch Create ===');
  
  // Clean up multiple files
  await deleteVFSFile('test-multi/index.html');
  await deleteVFSFile('test-multi/styles.css');
  await deleteVFSFile('test-multi/app.js');
  
  const prompt = `Create multiple files at once using batch_write:

batch_write([
  {"path": "test-multi/index.html", "content": "<!DOCTYPE html>\\n<html>\\n<head><link rel=\\"stylesheet\\" href=\\"styles.css\\"></head>\\n<body><script src=\\"app.js\\"></script></body>\\n</html>"},
  {"path": "test-multi/styles.css", "content": "body { font-family: system-ui; margin: 0; }"},
  {"path": "test-multi/app.js", "content": "console.log('App initialized');"}
])

Don't write anything else - just create these files.`;

  try {
    const result = await chat(prompt, { stream: false });
    console.log('Chat response received, checking VFS...');
    
    const html = await checkVFSFile('test-multi/index.html');
    const css = await checkVFSFile('test-multi/styles.css');
    const js = await checkVFSFile('test-multi/app.js');
    
    if (html?.content && css?.content && js?.content) {
      console.log('SUCCESS: All 3 files created in VFS');
      console.log('HTML:', html.content.substring(0, 50) + '...');
      console.log('CSS:', css.content.substring(0, 50) + '...');
      console.log('JS:', js.content.substring(0, 50) + '...');
      return true;
    } else {
      console.log('FAILED: Not all files created');
      return false;
    }
  } catch (e) {
    console.log('ERROR:', e.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('========================================');
  console.log('COMPREHENSIVE FILE EDIT FORMAT TESTS');
  console.log('========================================');
  
  try {
    await login();
    
    const results = [];
    
    // Run all format tests
    results.push({ name: 'Format A (special tokens)', success: await testFormatA() });
    results.push({ name: 'Format B (fenced block)', success: await testFormatB() });
    results.push({ name: 'Format C (tool_call fence)', success: await testFormatC() });
    results.push({ name: 'Malformed JSON handling', success: await testMalformedJson() });
    results.push({ name: 'Bare batch_write call', success: await testBareBatchWrite() });
    results.push({ name: 'Unicode content', success: await testUnicodeContent() });
    results.push({ name: 'Multiple files batch', success: await testMultipleFiles() });
    
    console.log('\n========================================');
    console.log('TEST RESULTS SUMMARY');
    console.log('========================================');
    
    let passed = 0;
    let failed = 0;
    
    for (const r of results) {
      const status = r.success ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${r.name}`);
      if (r.success) passed++; else failed++;
    }
    
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (e) {
    console.error('FATAL ERROR:', e);
    process.exit(1);
  }
}

runAllTests();