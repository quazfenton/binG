#!/usr/bin/env node
// Detailed MCP test to find exact error

async function testMCP() {
  console.log('Testing MCP write_file tool...\n');
  
  // Test 1: List tools
  console.log('1. Testing list tools...');
  const listRes = await fetch('http://localhost:3000/api/mcp');
  const listData = await listRes.json();
  console.log('   Tools:', listData.capabilities?.tools ? 
    Object.keys(listData.capabilities.tools).join(', ') : 
    'No tools capability');
  
  // Test 2: Call with full JSON-RPC
  console.log('\n2. Testing write_file tool call...');
  const callBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'write_file',
      arguments: {
        path: 'test-mcp.js',
        content: 'console.log("MCP test");'
      }
    }
  };
  
  try {
    const callRes = await fetch('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callBody)
    });
    
    const callData = await callRes.json();
    console.log('   Status:', callRes.status);
    console.log('   Response:', JSON.stringify(callData, null, 2));
  } catch (err) {
    console.log('   Error:', err.message);
  }
  
  // Test 3: Try other format
  console.log('\n3. Trying alternate format...');
  const altBody = {
    method: 'tools/call',
    name: 'write_file',
    arguments: {
      path: 'test-mcp2.js',
      content: 'console.log("test2");'
    }
  };
  
  try {
    const altRes = await fetch('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(altBody)
    });
    console.log('   Status:', altRes.status);
    const altData = await altRes.json();
    console.log('   Response:', JSON.stringify(altData, null, 2));
  } catch (err) {
    console.log('   Error:', err.message);
  }
  
  // Test 4: Check workspace stats
  console.log('\n4. Testing get_workspace_stats...');
  const statsBody = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'get_workspace_stats',
      arguments: {}
    }
  };
  
  try {
    const statsRes = await fetch('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(statsBody)
    });
    console.log('   Status:', statsRes.status);
    const statsData = await statsRes.json();
    console.log('   Response:', JSON.stringify(statsData, null, 2));
  } catch (err) {
    console.log('   Error:', err.message);
  }
}

testMCP().catch(console.error);