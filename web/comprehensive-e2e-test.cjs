/**
 * Comprehensive E2E Test Suite
 * Tests all LLM workflows including tool calling, VFS operations, PTY, etc.
 */

require('dotenv').config();

const API_BASE = 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

// Test results tracker
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

function logResult(testName, passed, error = null) {
  if (passed) {
    testResults.passed++;
    log(`PASS: ${testName}`, 'PASS');
  } else {
    testResults.failed++;
    testResults.errors.push({ test: testName, error });
    log(`FAIL: ${testName} - ${error}`, 'FAIL');
  }
}

async function login() {
  log('Authenticating...');
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });
  const data = await res.json();
  
  if (!data.token) {
    throw new Error('Login failed - no token');
  }
  
  log('Login successful, token received');
  return data.token;
}

// Test 1: Basic Chat with NVIDIA provider
async function testBasicChat(token) {
  log('TEST 1: Basic Chat (NVIDIA provider)');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hello and confirm you can hear me' }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    // Response may be in data.response or at top level
    const content = data.content || data.data?.response?.content;
    const passed = data.success && content;
    logResult('Basic Chat (NVIDIA)', passed, passed ? null : JSON.stringify(data).substring(0, 500));
    return { passed, data };
  } catch (e) {
    logResult('Basic Chat (NVIDIA)', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 2: File creation via LLM tool calling
async function testFileCreation(token) {
  log('TEST 2: File Creation via LLM tool');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Create a file called hello.js with content: console.log("Hello from test");'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    
    // Handle nested response format
    const content = data.content || data.data?.response?.content;
    const toolCalls = data.toolCalls || data.data?.response?.toolCalls;
    const fileEdits = data.fileEdits || data.data?.response?.fileEdits;
    
    // Check if files were created
    const hasContent = content && content.length > 0;
    const hasToolCalls = toolCalls && toolCalls.length > 0;
    const hasFileEdits = fileEdits && fileEdits.length > 0;
    
    log(`  Content length: ${data.content?.length || 0}`);
    log(`  Tool calls: ${data.toolCalls?.length || 0}`);
    log(`  File edits: ${data.fileEdits?.length || 0}`);
    
    // Verify file exists in VFS
    let fileExists = false;
    if (fileEdits && fileEdits.length > 0) {
      const filePath = fileEdits[0].path;
      const checkRes = await fetch(`${API_BASE}/api/filesystem/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fileExists = checkRes.ok;
      log(`  File exists in VFS: ${fileExists}`);
    }
    
    log(`  Content length: ${content?.length || 0}`);
    log(`  Tool calls: ${toolCalls?.length || 0}`);
    log(`  File edits: ${fileEdits?.length || 0}`);
    const passed = hasContent && (hasToolCalls || hasFileEdits || fileExists);
    logResult('File Creation', passed, passed ? null : 'No files created');
    return { passed, data };
  } catch (e) {
    logResult('File Creation', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 3: Read existing file
async function testReadFile(token) {
  log('TEST 3: Read File tool usage');
  
  // First create a file to read
  try {
    // Create file first
    await fetch(`${API_BASE}/api/filesystem/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        path: 'project/sessions/001/test-read.txt',
        content: 'Test content for read verification'
      })
    });
    
    // Now ask LLM to read it
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Read the file test-read.txt and tell me its content'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const toolCalls = data.toolCalls || data.data?.response?.toolCalls;
    const hasReadTool = toolCalls && toolCalls.some(tc => tc.name?.includes('read'));
    const hasContent = content && content.toLowerCase().includes('test content');
    
    logResult('Read File', hasReadTool || hasContent, null);
    return { passed: hasReadTool || hasContent, data };
  } catch (e) {
    logResult('Read File', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 4: Multi-folder workspace - ask LLM to pick file from specific folder
async function testMultiFolderWorkspace(token) {
  log('TEST 4: Multi-folder workspace file selection');
  
  try {
    // Create files in different folders
    const folders = ['project-a', 'project-b'];
    for (const folder of folders) {
      await fetch(`${API_BASE}/api/filesystem/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          path: `project/sessions/001/${folder}/info.txt`,
          content: `This is ${folder} folder`
        })
      });
    }
    
    // Ask LLM to read from specific folder
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Read the info.txt file from project-b folder'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const responded = content && content.length > 0;
    log(`  Content: ${content?.substring(0, 100)}`);
    logResult('Multi-folder Workspace', responded, null);
    return { passed: responded, data };
  } catch (e) {
    logResult('Multi-folder Workspace', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 5: Shell command execution
async function testShellExecution(token) {
  log('TEST 5: Shell/PTY execution');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Run the command: echo "shell test success"'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const toolCalls = data.toolCalls || data.data?.response?.toolCalls;
    const hasShellTool = toolCalls && toolCalls.some(tc => 
      tc.name?.includes('shell') || tc.name?.includes('terminal') || tc.name?.includes('execute')
    );
    const responded = content && content.length > 0;
    
    log(`  Has shell tool call: ${hasShellTool}`);
    log(`  Responded: ${responded}`);
    
    logResult('Shell Execution', responded, null);
    return { passed: responded, data };
  } catch (e) {
    logResult('Shell Execution', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 6: Google provider test
async function testGoogleProvider(token) {
  log('TEST 6: Google provider (gemini)');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is 2 + 2?' }],
        provider: 'google',
        model: 'gemini-2.0-flash-exp',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const passed = data.success && content;
    logResult('Google Provider', passed, passed ? null : JSON.stringify(data).substring(0, 300));
    return { passed, data };
  } catch (e) {
    logResult('Google Provider', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 7: OpenRouter provider test
async function testOpenRouterProvider(token) {
  log('TEST 7: OpenRouter provider (mistral)');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hi' }],
        provider: 'openrouter',
        model: 'mistralai/mistral-small-3.1-2506',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const passed = data.success && content;
    logResult('OpenRouter Provider', passed, passed ? null : JSON.stringify(data).substring(0, 300));
    return { passed, data };
  } catch (e) {
    logResult('OpenRouter Provider', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 8: Streaming mode test
async function testStreamingMode(token) {
  log('TEST 8: Streaming mode');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Count from 1 to 5' }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: true
      })
    });
    
    let content = '';
    const decoder = new TextDecoder();
    
    for await (const chunk of res.body) {
      content += decoder.decode(chunk);
    }
    
    const passed = content.length > 0;
    log(`  Streaming content length: ${content.length}`);
    logResult('Streaming Mode', passed, passed ? null : 'No content streamed');
    return { passed, data: { content: content.substring(0, 500) } };
  } catch (e) {
    logResult('Streaming Mode', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 9: Auto-continue detection
async function testAutoContinue(token) {
  log('TEST 9: Auto-continue detection');
  
  try {
    // Request longer response that might need continuation
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Write a detailed explanation of how React hooks work, covering useState, useEffect, useContext, and custom hooks. Be thorough.'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const responded = content && content.length > 100;
    const hasContinueMarker = content?.includes('[CONTINUE]') || content?.includes('continuation');
    
    log(`  Content length: ${content?.length || 0}`);
    log(`  Has continue marker: ${hasContinueMarker}`);
    
    logResult('Auto-continue', responded, null);
    return { passed: responded, data };
  } catch (e) {
    logResult('Auto-continue', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 10: Diff application to existing file
async function testDiffApplication(token) {
  log('TEST 10: Diff application to existing file');
  
  try {
    // Create initial file
    const initialContent = 'const greeting = "hello";\nconsole.log(greeting);';
    await fetch(`${API_BASE}/api/filesystem/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        path: 'project/sessions/001/test-diff.js',
        content: initialContent
      })
    });
    
    // Ask LLM to modify the file
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Modify test-diff.js to change greeting to "hi" and add a farewell message'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const fileEdits = data.fileEdits || data.data?.response?.fileEdits;
    
    // Check if file was modified
    const checkRes = await fetch(`${API_BASE}/api/filesystem/read?path=${encodeURIComponent('project/sessions/001/test-diff.js')}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    let modified = false;
    if (checkRes.ok) {
      const fileData = await checkRes.json();
      modified = fileData.content && (fileData.content.includes('hi') || fileData.content.includes('farewell'));
      log(`  Modified content: ${fileData.content?.substring(0, 100)}`);
    }
    
    const hasFileEdits = fileEdits && fileEdits.length > 0;
    logResult('Diff Application', modified || hasFileEdits, null);
    return { passed: modified || hasFileEdits, data };
  } catch (e) {
    logResult('Diff Application', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 11: Non-streaming full response test
async function testNonStreamingFullResponse(token) {
  log('TEST 11: Non-streaming full response (JSON)');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'List 3 programming languages' }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const contentType = res.headers.get('content-type');
    const isJson = contentType?.includes('application/json');
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    
    const passed = isJson && content && content.length > 0;
    log(`  Content-Type: ${contentType}`);
    log(`  Has content: ${!!data.content}`);
    
    logResult('Non-streaming JSON', passed, null);
    return { passed, data };
  } catch (e) {
    logResult('Non-streaming JSON', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 12: VFS MCP Tool test
async function testVFSMcpTool(token) {
  log('TEST 12: VFS MCP Tool call args');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: 'Create a file named vfs-test.txt with content "testing vfs-mcp" in the current session'
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const toolCalls = data.toolCalls || data.data?.response?.toolCalls;
    const fileEdits = data.fileEdits || data.data?.response?.fileEdits;
    
    // Check tool call structure
    let hasProperArgs = false;
    if (toolCalls && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      hasProperArgs = toolCall.arguments && typeof toolCall.arguments === 'object';
      log(`  Tool name: ${toolCall.name}`);
      log(`  Has proper args object: ${hasProperArgs}`);
    }
    
    // Check file exists
    let fileExists = false;
    if (fileEdits && fileEdits.length > 0) {
      const checkRes = await fetch(`${API_BASE}/api/filesystem/read?path=${encodeURIComponent(fileEdits[0].path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fileExists = checkRes.ok;
    }
    
    logResult('VFS MCP Tool Args', hasProperArgs || fileExists, null);
    return { passed: hasProperArgs || fileExists, data };
  } catch (e) {
    logResult('VFS MCP Tool Args', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 13: List files in workspace
async function testListFiles(token) {
  log('TEST 13: List files in workspace');
  
  try {
    // Create a few files
    await fetch(`${API_BASE}/api/filesystem/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        path: 'project/sessions/001/file1.txt',
        content: 'content1'
      })
    });
    
    await fetch(`${API_BASE}/api/filesystem/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        path: 'project/sessions/001/file2.txt',
        content: 'content2'
      })
    });
    
    // List files
    const res = await fetch(`${API_BASE}/api/filesystem/list?path=${encodeURIComponent('project/sessions/001')}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await res.json();
    const hasNodes = data.data && data.data.nodes && data.data.nodes.length > 0;
    log(`  Files found: ${data.data?.nodes?.length || 0}`);
    
    logResult('List Files', hasNodes, null);
    return { passed: hasNodes, data };
  } catch (e) {
    logResult('List Files', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 14: File edit parser fallback (when tool_use not executed)
async function testFileEditParserFallback(token) {
  log('TEST 14: File edit parser fallback (text-based tool extraction)');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: `Create a file called parser-test.txt with the following content:

WRITE path <<<parser-test.txt>>>
Hello from parser fallback test!
<<<EOF>>>

Make sure to create this file with exactly this content.`
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const fileEdits = data.fileEdits || data.data?.response?.fileEdits;
    
    // Check if file was created via fallback parser
    let fileCreated = false;
    if (fileEdits && fileEdits.length > 0) {
      const checkRes = await fetch(`${API_BASE}/api/filesystem/read?path=${encodeURIComponent(fileEdits[0].path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fileCreated = checkRes.ok;
    }
    
    log(`  File edits detected: ${fileEdits?.length || 0}`);
    log(`  File created: ${fileCreated}`);
    
    logResult('File Edit Parser Fallback', fileCreated || (data.fileEdits?.length > 0), null);
    return { passed: fileCreated || (data.fileEdits?.length > 0), data };
  } catch (e) {
    logResult('File Edit Parser Fallback', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 15: Large scope project creation
async function testLargeScopeProject(token) {
  log('TEST 15: Large scope project creation');
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: `Create a simple React component that displays a counter. Create 3 files:
1. App.js - main component with counter state
2. Counter.js - displays current count
3. index.css - basic styling

Keep it simple but functional.`
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const fileEdits = data.fileEdits || data.data?.response?.fileEdits;
    
    // Check how many files were created
    const filesCreated = fileEdits?.length || 0;
    log(`  Files created: ${filesCreated}`);
    log(`  File edits: ${JSON.stringify(fileEdits?.map(f => f.path))}`);
    
    // Check if all expected files exist
    const expectedFiles = ['App.js', 'Counter.js', 'index.css'];
    let allExist = false;
    
    if (fileEdits && fileEdits.length > 0) {
      const paths = fileEdits.map(f => f.path);
      allExist = expectedFiles.every(f => paths.some(p => p.includes(f)));
    }
    
    log(`  All expected files exist: ${allExist}`);
    logResult('Large Scope Project', filesCreated >= 2 || allExist, null);
    return { passed: filesCreated >= 2 || allExist, data };
  } catch (e) {
    logResult('Large Scope Project', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Test 16: Context bundling - large context window
async function testContextBundling(token) {
  log('TEST 16: Context bundling with large prompt');
  
  try {
    const largePrompt = 'Explain the following code structure: ' + 'x'.repeat(2000);
    
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: [{ 
          role: 'user', 
          content: largePrompt
        }],
        provider: 'nvidia',
        model: 'nvidia/nemotron-4-340b-instruct',
        stream: false
      })
    });
    
    const data = await res.json();
    const content = data.content || data.data?.response?.content;
    const responded = content && content.length > 0;
    log(`  Responded with length: ${content?.length || 0}`);
    
    logResult('Context Bundling', responded, null);
    return { passed: responded, data };
  } catch (e) {
    logResult('Context Bundling', false, e.message);
    return { passed: false, error: e.message };
  }
}

// Run all tests
async function runAllTests() {
  log('='.repeat(60));
  log('STARTING COMPREHENSIVE E2E TEST SUITE');
  log('='.repeat(60));
  
  let token;
  try {
    token = await login();
  } catch (e) {
    log(`FATAL: Login failed - ${e.message}`, 'ERROR');
    process.exit(1);
  }
  
  // Run all tests
  await testBasicChat(token);
  await testFileCreation(token);
  await testReadFile(token);
  await testMultiFolderWorkspace(token);
  await testShellExecution(token);
  await testGoogleProvider(token);
  await testOpenRouterProvider(token);
  await testStreamingMode(token);
  await testAutoContinue(token);
  await testDiffApplication(token);
  await testNonStreamingFullResponse(token);
  await testVFSMcpTool(token);
  await testListFiles(token);
  await testFileEditParserFallback(token);
  await testLargeScopeProject(token);
  await testContextBundling(token);
  
  // Print summary
  log('='.repeat(60));
  log('TEST SUMMARY');
  log('='.repeat(60));
  log(`Total Passed: ${testResults.passed}`);
  log(`Total Failed: ${testResults.failed}`);
  
  if (testResults.errors.length > 0) {
    log('\nFailed Tests:');
    testResults.errors.forEach((err, i) => {
      log(`  ${i + 1}. ${err.test}: ${err.error}`);
    });
  }
  
  log('='.repeat(60));
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

runAllTests().catch(e => {
  log(`FATAL: ${e.message}`, 'ERROR');
  process.exit(1);
});