/**
 * Comprehensive Preview Tests - Testing all preview modes and edge cases
 * Run: node test-preview-comprehensive.js
 */

const API_BASE = 'http://localhost:3000';

async function testComprehensive() {
  console.log('=== COMPREHENSIVE PREVIEW API TESTS ===\n');

  // Test 1: Validate error handling for invalid inputs
  console.log('--- Input Validation Tests ---\n');

  const invalidInputs = [
    { name: 'Empty files object', body: { files: {} }, expectedStatus: 400 },
    { name: 'Missing files', body: { framework: 'react' }, expectedStatus: 400 },
    { name: 'Files as array (invalid)', body: { files: [] }, expectedStatus: 400 },
    { name: 'Files as string (invalid)', body: { files: "test" }, expectedStatus: 400 },
  ];

  for (const test of invalidInputs) {
    try {
      const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.body)
      });
      const data = await response.json();
      const pass = response.status === test.expectedStatus;
      console.log(`${pass ? '✓' : '✗'} ${test.name}: Status ${response.status} (expected ${test.expectedStatus})`);
      if (!pass) console.log(`  Response: ${JSON.stringify(data)}`);
    } catch (err) {
      console.log(`✗ ${test.name}: Error - ${err.message}`);
    }
  }

  // Test 2: Test GET endpoint behavior
  console.log('\n--- GET Endpoint Tests ---\n');
  try {
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, { method: 'GET' });
    const data = await response.json();
    console.log(`✓ GET /api/preview/sandbox: Status ${response.status}, sessions: ${data.sessions?.length || 0}`);
  } catch (err) {
    console.log(`✗ GET failed: ${err.message}`);
  }

  // Test 3: Test DELETE endpoint without sandboxId
  console.log('\n--- DELETE Endpoint Tests ---\n');
  try {
    const response = await fetch(`${API_BASE}/api/preview/sandbox?sandboxId=`, { method: 'DELETE' });
    const data = await response.json();
    console.log(`DELETE without sandboxId: Status ${response.status}, ${JSON.stringify(data)}`);
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }

  // Test 4: Test with various frameworks
  console.log('\n--- Framework Handling Tests ---\n');
  const frameworks = ['react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'flask', 'fastapi', 'vanilla', 'astro'];
  
  for (const fw of frameworks) {
    try {
      const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: { 'index.html': '<html></html>' },
          framework: fw
        })
      });
      const data = await response.json();
      const hasKey = data.error !== undefined;
      console.log(`Framework "${fw}": ${hasKey ? '✓ handled' : '✗ unhandled'}`);
    } catch (err) {
      console.log(`Framework "${fw}": ✗ error - ${err.message}`);
    }
  }

  // Test 5: Test health endpoint to confirm server status
  console.log('\n--- Server Health Check ---\n');
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();
    console.log(`✓ Server healthy: ${JSON.stringify(data)}`);
  } catch (err) {
    console.log(`✗ Server health check failed: ${err.message}`);
  }

  // Test 6: Test other API routes related to previews
  console.log('\n--- Related API Routes ---\n');
  
  // Test filesystem routes
  const filesystemTests = [
    { route: '/api/filesystem/list', method: 'POST', body: { path: 'project' } },
  ];
  
  for (const test of filesystemTests) {
    try {
      const response = await fetch(`${API_BASE}${test.route}`, {
        method: test.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.body)
      });
      console.log(`${test.route}: Status ${response.status}`);
    } catch (err) {
      console.log(`${test.route}: Error - ${err.message}`);
    }
  }

  console.log('\n=== TESTS COMPLETE ===');
}

testComprehensive().catch(console.error);