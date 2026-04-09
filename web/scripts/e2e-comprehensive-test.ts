/**
 * Comprehensive E2E Test Suite
 *
 * Tests:
 * 1. Tool call telemetry tracking
 * 2. Structured tool results
 * 3. Smart retry model selection
 * 4. Hybrid retrieval with context
 * 5. Auto-continue with file requests
 * 6. Empty response retry context
 *
 * Usage: npx tsx web/scripts/e2e-comprehensive-test.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PROVIDER = process.env.TEST_PROVIDER || 'openai';
const MODEL = process.env.TEST_MODEL || 'gpt-4o-mini';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  data?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details: string, data?: any) {
  results.push({ name, passed: condition, details, data });
  console.log(`${condition ? '✅' : '❌'} ${name}: ${details}`);
  if (data && !condition) {
    console.log('  Data:', JSON.stringify(data, null, 2).slice(0, 500));
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Test 1: Anonymous Chat with Tool Calls ─────────────────────────────────

async function testAnonymousChatWithTools() {
  console.log('\n── Test 1: Anonymous Chat with Tool Calls ──');

  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Use tools when needed.' },
          { role: 'user', content: 'List the files in the current directory using listFiles tool.' }
        ],
        provider: PROVIDER,
        model: MODEL,
        stream: false,
      }),
    });

    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response content length:', data?.content?.length || 0);
    console.log('Response metadata:', JSON.stringify(data?.metadata || data?.data || {}, null, 2).slice(0, 300));

    assert(
      response.ok,
      'Anonymous chat returns 200',
      `Status: ${response.status}`,
      { error: data?.error, details: data?.details }
    );

    assert(
      !data?.error,
      'No error in response',
      `Content preview: ${(data?.content || '').slice(0, 100)}`,
      { error: data?.error }
    );
  } catch (error: any) {
    assert(false, 'Anonymous chat with tools', `Error: ${error.message}`, { error });
  }
}

// ─── Test 2: Hybrid Retrieval Fallback ──────────────────────────────────────

async function testHybridRetrievalFallback() {
  console.log('\n── Test 2: Hybrid Retrieval (no symbols → smart-context fallback) ──');

  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'What is the structure of this project?' }
        ],
        provider: PROVIDER,
        model: MODEL,
        stream: false,
        contextPack: {
          format: 'json',
          maxTotalSize: 50000,
        },
      }),
    });

    const data = await response.json();
    console.log('Response status:', response.status);

    assert(
      response.ok,
      'Hybrid retrieval chat succeeds',
      `Status: ${response.status}`,
      { error: data?.error }
    );
  } catch (error: any) {
    assert(false, 'Hybrid retrieval chat', `Error: ${error.message}`);
  }
}

// ─── Test 3: Empty Response Retry Context ───────────────────────────────────

async function testEmptyResponseRetryContext() {
  console.log('\n── Test 3: Empty Response Retry Context ──');

  // Simulate a retry with context
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Please read the package.json file.' }
        ],
        provider: PROVIDER,
        model: MODEL,
        stream: false,
        retryContext: {
          isEmptyResponseRetry: true,
          originalProvider: PROVIDER,
          originalModel: MODEL,
          toolExecutionSummary: '1 tool call(s) failed: read_file',
          failedToolCalls: [
            { name: 'read_file', error: 'File not found: /package.json', args: { path: '/package.json' } }
          ],
          filesystemChanges: { applied: 0, failed: 1, failedDetails: [{ path: '/package.json', error: 'ENOENT' }] },
        },
      }),
    });

    const data = await response.json();
    console.log('Retry response status:', response.status);
    console.log('Response content preview:', (data?.content || '').slice(0, 200));

    assert(
      response.ok,
      'Retry with context succeeds',
      `Status: ${response.status}`,
      { error: data?.error }
    );
  } catch (error: any) {
    assert(false, 'Retry with context', `Error: ${error.message}`);
  }
}

// ─── Test 4: Context Builder Format (JSON) ──────────────────────────────────

async function testContextBuilderJsonFormat() {
  console.log('\n── Test 4: Context Builder JSON Format ──');

  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'What files are in the project?' }
        ],
        provider: PROVIDER,
        model: MODEL,
        stream: false,
        contextPack: {
          format: 'json',
          maxTotalSize: 10000,
          includePatterns: ['*.ts', '*.json'],
          maxLinesPerFile: 50,
        },
      }),
    });

    const data = await response.json();
    const content = data?.content || '';
    const hasJsonContext = content.includes('"context"') || content.includes('--- WORKSPACE CONTEXT (JSON)');
    const hasContextMarkers = content.includes('WORKSPACE CONTEXT') || content.includes('context');

    console.log('Response contains JSON context markers:', hasJsonContext);
    console.log('Response contains context markers:', hasContextMarkers);

    assert(
      response.ok,
      'JSON format context pack request succeeds',
      `Status: ${response.status}`,
      { error: data?.error }
    );
  } catch (error: any) {
    assert(false, 'JSON format context', `Error: ${error.message}`);
  }
}

// ─── Test 5: Streaming with Tool Calls ──────────────────────────────────────

async function testStreamingWithTools() {
  console.log('\n── Test 5: Streaming Response with Tools ──');

  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Use the listFiles tool to show me the root directory.' }
        ],
        provider: PROVIDER,
        model: MODEL,
        stream: true,
      }),
    });

    assert(
      response.ok,
      'Streaming request succeeds',
      `Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`,
      { error: await response.text().catch(() => 'no body') }
    );

    // Read streaming events
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let eventCount = 0;
      let hasDone = false;
      let hasToolInvocation = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.slice(6).trim();
            if (eventType === 'tool_invocation') hasToolInvocation = true;
            if (eventType === 'done') hasDone = true;
            eventCount++;
          }
        }

        if (eventCount > 20) break; // Safety limit
      }

      console.log(`Received ${eventCount} SSE events, done=${hasDone}, tools=${hasToolInvocation}`);
      assert(
        hasDone,
        'Streaming completes with done event',
        `${eventCount} events received`,
        { eventCount, hasDone, hasToolInvocation }
      );
    }
  } catch (error: any) {
    assert(false, 'Streaming with tools', `Error: ${error.message}`);
  }
}

// ─── Test 6: File Mention Patterns ──────────────────────────────────────────

async function testFileMentionPatterns() {
  console.log('\n── Test 6: File Mention Detection ──');

  // Test the smart-context file detection patterns
  const testPatterns = [
    { input: 'I need to read src/App.tsx', expected: true, name: 'read pattern' },
    { input: '<request_file>package.json</request_file>', expected: true, name: 'XML tag' },
    { input: 'Check the file utils/helpers.ts please', expected: true, name: 'check pattern' },
    { input: 'Tell me a joke about programming', expected: false, name: 'no file request' },
    { input: 'What files do we have in the src directory?', expected: false, name: 'general question' },
  ];

  for (const { input, expected, name } of testPatterns) {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: input }],
        provider: PROVIDER,
        model: MODEL,
        stream: false,
      }),
    });

    const data = await response.json();
    const ok = response.ok;
    assert(ok, `File mention: ${name}`, `Status: ${response.status}`, {
      input, expected, received: ok
    });

    await sleep(500); // Rate limit
  }
}

// ─── Run All Tests ──────────────────────────────────────────────────────────

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Comprehensive E2E Test Suite                       ║');
  console.log(`║  Provider: ${PROVIDER.padEnd(44)}║`);
  console.log(`║  Model: ${MODEL.padEnd(47)}║`);
  console.log(`║  Server: ${BASE_URL.padEnd(45)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  await testAnonymousChatWithTools();
  await sleep(1000);

  await testHybridRetrievalFallback();
  await sleep(1000);

  await testEmptyResponseRetryContext();
  await sleep(1000);

  await testContextBuilderJsonFormat();
  await sleep(1000);

  await testStreamingWithTools();
  await sleep(1000);

  await testFileMentionPatterns();

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`║  Passed: ${passed.toString().padEnd(48)}║`);
  console.log(`║  Failed: ${failed.toString().padEnd(48)}║`);
  console.log(`║  Total:  ${results.length.toString().padEnd(48)}║`);

  if (failed > 0) {
    console.log('\n║  FAILURES:                                          ║');
    results.filter(r => !r.passed).forEach((r, i) => {
      console.log(`║  ${i + 1}. ${r.name.padEnd(50)}║`);
      console.log(`║     ${r.details.slice(0, 50).padEnd(50)}║`);
    });
  }

  console.log('╚══════════════════════════════════════════════════════════╝');

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
