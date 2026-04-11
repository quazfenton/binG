/**
 * VFS MCP DEEP DEBUG TEST
 * 
 * Step 1: Test the file edit parser directly via custom endpoint
 * Step 2: Test the actual LLM chat response with full capture
 * Step 3: Compare and identify gaps
 * 
 * Usage: npx tsx tests/e2e/vfs-mcp-deep-debug.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'Testing0';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color: string, msg: string) {
  console.log(`${color}${msg}${RESET}`);
}

const results: any[] = [];

function record(test: string, passed: boolean, details: string, rawResponse?: string) {
  results.push({ test, passed, details, rawResponse });
  const icon = passed ? '✅' : '❌';
  const color = passed ? GREEN : RED;
  log(color, `${icon} ${test}`);
  if (!passed) {
    log(RED, `   ${details}`);
    if (rawResponse) {
      log(YELLOW, `   Full response (${rawResponse.length} chars):`);
      // Print full response for debugging
      const lines = rawResponse.split('\n');
      for (let i = 0; i < Math.min(lines.length, 50); i++) {
        console.log(YELLOW + '   ' + lines[i] + RESET);
      }
      if (lines.length > 50) {
        log(YELLOW, `   ... (${lines.length - 50} more lines)`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════

async function authenticate(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (!res.ok || !data.token) throw new Error(JSON.stringify(data));
    return data.token;
  } catch {
    throw new Error(`Auth not JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 1: Test Parser Directly via Custom Endpoint
// ═══════════════════════════════════════════════════════════════════

async function testParserDirect(): Promise<void> {
  log(BLUE, '\n═══════════════════════════════════════════');
  log(BLUE, 'STEP 1: Direct Parser Test (No LLM)');
  log(BLUE, '═══════════════════════════════════════════\n');

  const testCases = [
    {
      name: 'Compact file_edit',
      content: 'Here is the file: <file_edit path="direct-test.txt">Hello World</file_edit>',
      expected: ['direct-test.txt'],
    },
    {
      name: 'Fenced diff',
      content: '```diff package.json\n+ "name": "test"\n- "name": "old"\n```',
      expected: ['package.json'],
    },
    {
      name: 'Bash heredoc',
      content: 'cat > test.sh << \'EOF\'\necho hello\nEOF',
      expected: ['test.sh'],
    },
    {
      name: 'batch_write fenced',
      content: '```javascript\nbatch_write([\n  { "path": "bw-1.js", "content": "console.log(1)" },\n  { "path": "bw-2.js", "content": "console.log(2)" }\n])\n```',
      expected: ['bw-1.js', 'bw-2.js'],
    },
    {
      name: 'Special token',
      content: '<|tool_call_begin|> batch_write:0 <|tool_call_argument_begin|>\n{"files":[{"path":"special.txt","content":"hello"}]}\n<|tool_call_end|>',
      expected: ['special.txt'],
    },
    {
      name: 'Tool call fenced',
      content: '```tool_call\n{ "tool_name": "batch_write", "parameters": { "files": [{ "path": "toolcall.md", "content": "# Test" }] } }\n```',
      expected: ['toolcall.md'],
    },
  ];

  for (const tc of testCases) {
    const res = await fetch(`${BASE_URL}/api/test/vfs-parse-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: tc.content }),
    });

    const data = await res.json();
    const foundFiles = tc.expected.filter(f => data.edits?.some((e: any) => e.path?.includes(f)));
    const passed = foundFiles.length > 0;

    record(
      `Parser Direct: ${tc.name}`,
      passed,
      passed
        ? `Found ${foundFiles.length}/${tc.expected.length}: ${foundFiles.join(', ')}`
        : `Found 0 edits. Input: ${tc.content.slice(0, 100)}`,
      JSON.stringify(data, null, 2)
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 2: Test LLM Chat with Full Response Capture
// ═══════════════════════════════════════════════════════════════════

async function testLLMChat(token: string): Promise<void> {
  log(BLUE, '\n═══════════════════════════════════════════');
  log(BLUE, 'STEP 2: LLM Chat Test (Full Response Capture)');
  log(BLUE, '═══════════════════════════════════════════\n');

  const prompts = [
    {
      name: 'Create single file',
      prompt: 'Create a file called chat-test-1.txt with the content "Hello from chat test"',
      expected: ['chat-test-1.txt'],
    },
    {
      name: 'Create with file_edit format',
      prompt: 'Use this exact format to create a file: <file_edit path="chat-test-2.txt">Hello from file_edit</file_edit>',
      expected: ['chat-test-2.txt'],
    },
    {
      name: 'Create multiple files',
      prompt: 'Create TWO files: multi-1.js with "console.log(1)" and multi-2.js with "console.log(2)"',
      expected: ['multi-1.js', 'multi-2.js'],
    },
    {
      name: 'Batch write format',
      prompt: 'Use batch_write to create these files: ```javascript\nbatch_write([\n  { "path": "batch-chat-1.js", "content": "console.log(1)" },\n  { "path": "batch-chat-2.js", "content": "console.log(2)" }\n])\n```',
      expected: ['batch-chat-1.js', 'batch-chat-2.js'],
    },
  ];

  let convId = 100;
  for (const p of prompts) {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: p.prompt }],
        provider: 'mistral',
        model: 'mistral-small-latest',
        stream: false,
        conversationId: String(convId++),
      }),
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      record(`LLM Chat: ${p.name}`, false, `Response not JSON. Status: ${res.status}`, text);
      continue;
    }

    const response = data.content || data.response || '';
    const foundFiles = p.expected.filter(f => response.includes(f));
    const hasAnyMarker = response.includes('<file_edit') || response.includes('batch_write') ||
      response.includes('```diff') || response.includes('write_file') ||
      response.includes('file_edit') || response.includes('create') ||
      response.includes('```javascript') || response.includes('```json');

    record(
      `LLM Chat: ${p.name}`,
      foundFiles.length > 0,
      foundFiles.length > 0
        ? `Found ${foundFiles.length}/${p.expected.length} files`
        : `Found 0 files. Has markers: ${hasAnyMarker}. Response length: ${response.length}`,
      response
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Step 3: Test with Different Providers
// ═══════════════════════════════════════════════════════════════════

async function testProviders(token: string): Promise<void> {
  log(BLUE, '\n═══════════════════════════════════════════');
  log(BLUE, 'STEP 3: Multi-Provider Comparison');
  log(BLUE, '═══════════════════════════════════════════\n');

  const providers = [
    { provider: 'mistral', model: 'mistral-small-latest', name: 'Mistral' },
    { provider: 'nvidia', model: 'nvidia/nemotron-4-340b-instruct', name: 'Nvidia' },
  ];

  let convId = 200;
  for (const prov of providers) {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Create provider-test.txt with "Provider test content"' }],
        provider: prov.provider,
        model: prov.model,
        stream: false,
        conversationId: String(convId++),
      }),
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      record(`Provider: ${prov.name}`, false, `Not JSON. Status: ${res.status}`, text.slice(0, 500));
      continue;
    }

    const response = data.content || data.response || '';
    const hasFile = response.includes('provider-test.txt');

    record(
      `Provider: ${prov.name}`,
      hasFile,
      hasFile ? 'File referenced' : `Not found. Response length: ${response.length}`,
      response
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  log(CYAN, '\n🔍 VFS MCP DEEP DEBUG TEST');
  log(CYAN, `   Base URL: ${BASE_URL}`);

  const token = await authenticate();
  log(GREEN, '✅ Authenticated\n');

  await testParserDirect();
  await testLLMChat(token);
  await testProviders(token);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log(CYAN, '\n' + '='.repeat(60));
  log(GREEN, `✅ Passed: ${passed}`);
  if (failed > 0) log(RED, `❌ Failed: ${failed}`);
  log(CYAN, `📊 Total: ${results.length}`);
  log(CYAN, '='.repeat(60));

  // Save results
  const resultsFile = path.join(process.cwd(), 'tests/e2e/vfs-deep-debug-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  log(CYAN, `\n📄 Results: ${resultsFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  log(RED, `\n💥 Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
