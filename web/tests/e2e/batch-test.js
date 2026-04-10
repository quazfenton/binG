#!/usr/bin/env node
// Direct test of batch_write

async function testBatch() {
  // Test 1: Direct array format
  const body1 = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'batch_write',
      arguments: {
        files: [
          { path: 'batch1.js', content: 'const a = 1;' },
          { path: 'batch2.js', content: 'const b = 2;' },
        ]
      }
    }
  };

  const res1 = await fetch('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body1)
  });
  const data1 = await res1.json();
  console.log('Test 1 (array):', data1.result ? JSON.parse(data1.result.content[0].text) : data1.error);

  // Test 2: String format
  const body2 = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'batch_write',
      arguments: {
        files: '[{"path":"x.js","content":"x"}]'
      }
    }
  };

  const res2 = await fetch('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body2)
  });
  const data2 = await res2.json();
  console.log('Test 2 (string):', data2.result ? JSON.parse(data2.result.content[0].text) : data2.error);
}

testBatch().catch(console.error);