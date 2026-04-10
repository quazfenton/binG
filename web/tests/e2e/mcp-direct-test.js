#!/usr/bin/env node
/**
 * Test MCP file write via structured format
 */

async function testMCPDirect(prompt) {
  console.log(`\nTest: "${prompt.slice(0, 60)}..."`);
  
  // First trigger LLM to get content
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      stream: false,  // Get complete response
      provider: 'mistral',
      model: 'mistral-small-latest',
      enableFilesystemEdits: true,
    }),
  });

  const data = await res.json();
  console.log('Status:', res.status);
  
  const fs = data.filesystem || data.unifiedResponse?.filesystem;
  console.log('Files applied:', fs?.applied?.length || 0);
  
  if (fs?.applied?.length > 0) {
    console.log('✅ Files:', fs.applied.map(f => f.path).join(', '));
  } else {
    console.log('Content snippet:', (data.content || '').slice(0, 100));
  }
  
  return data;
}

async function testDirectMCP(prompt, filePath, content) {
  console.log(`\nDirect MCP: "${filePath}"`);
  
  // Call MCP directly
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'write_file', arguments: { path: filePath, content } }
  };
  
  const res = await fetch('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const data = await res.json();
  if (data.result) {
    const result = JSON.parse(data.result.content[0].text);
    console.log('✅ Result:', result);
    return result;
  }
  console.log('❌ Error:', data.error);
  return null;
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('MCP DIRECT FILE TESTS');
  console.log('='.repeat(60));
  
  // Test MCP directly
  await testDirectMCP('Test', 'direct-a.js', 'console.log("a");');
  await testDirectMCP('Test', 'direct-b.ts', 'console.log("b");');
  await testDirectMCP('Test', 'subfolder/direct-c.js', 'console.log("c");');
  
  // Test workspace stats
  const stats = await testDirectMCP('Stats', 'dummy', '');
  if (stats) {
    console.log('\nWorkspace:', stats.totalSizeFormatted, stats.fileCount, 'files');
    if (stats.files) {
      console.log('Files:', stats.files.map(f => f.path).join(', '));
    }
  }
}

runTests().catch(console.error);