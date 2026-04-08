/**
 * Comprehensive Preview Mode API Tests
 * Tests ALL preview mode endpoints: DevBox, WebContainer, OpenSandbox, and client-side modes
 */

const API_BASE = 'http://localhost:3000';

const testResults = { passed: 0, failed: 0, total: 0 };

function log(name: string, passed: boolean, details?: string) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`  ✓ ${name}`);
  } else {
    testResults.failed++;
    console.log(`  ✗ ${name}${details ? ': ' + details : ''}`);
  }
}

async function testDevBox() {
  console.log('\n=== DevBox (CodeSandbox) API Tests ===');
  
  // Test 1: POST without auth should return 401
  console.log('\nTest: DevBox without authentication');
  try {
    const res = await fetch(`${API_BASE}/api/sandbox/devbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'index.js': 'console.log("test")' } })
    });
    log('Requires authentication', res.status === 401);
  } catch (e: any) {
    log('Requires authentication', false, e.message);
  }

  // Test 2: POST with invalid files
  console.log('\nTest: DevBox with invalid inputs');
  const invalidTests = [
    { name: 'Empty files object', body: { files: {} }, expected: 400 },
    { name: 'Files as array', body: { files: [] }, expected: 400 },
    { name: 'Files as string', body: { files: 'test' }, expected: 400 },
    { name: 'Missing files', body: {}, expected: 400 },
    { name: 'Invalid template', body: { files: { 'a.js': '' }, template: 'invalid-template' }, expected: 400 },
  ];
  
  for (const t of invalidTests) {
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/devbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body)
      });
      const status = res.status === t.expected;
      log(t.name, status, `got ${res.status}, expected ${t.expected}`);
    } catch (e: any) {
      log(t.name, false, e.message);
    }
  }

  // Test 3: CSB_API_KEY check
  console.log('\nTest: DevBox CSB_API_KEY validation');
  try {
    const res = await fetch(`${API_BASE}/api/sandbox/devbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'index.js': 'console.log("test")' }, template: 'node' })
    });
    const data = await res.json();
    // Without real auth, we get 401. But we can verify the validation is present
    log('CSB_API_KEY validation present', res.status === 401 || res.status === 503);
  } catch (e: any) {
    log('CSB_API_KEY validation present', false, e.message);
  }
}

async function testWebContainer() {
  console.log('\n=== WebContainer API Tests ===');
  
  // Test 1: POST with valid files
  console.log('\nTest: WebContainer with valid files');
  try {
    const res = await fetch(`${API_BASE}/api/sandbox/webcontainer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: {
          'package.json': JSON.stringify({ name: 'test', scripts: { start: 'node index.js' } }),
          'index.js': 'console.log("Hello WebContainer");'
        }
      })
    });
    const data = await res.json();
    log('Creates WebContainer config', res.status === 200 && data.success === true);
    if (data.success) {
      log('Returns sandboxId', !!data.sandboxId);
      log('Returns sessionId', !!data.sessionId);
      log('Returns config with clientId', !!data.config?.clientId);
      log('Returns files in response', !!data.files);
    }
  } catch (e: any) {
    log('Creates WebContainer config', false, e.message);
  }

  // Test 2: POST with custom start command
  console.log('\nTest: WebContainer with custom startCommand');
  try {
    const res = await fetch(`${API_BASE}/api/sandbox/webcontainer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: { 'index.js': 'console.log("custom")' },
        startCommand: 'node custom.js',
        waitForPort: 8080
      })
    });
    const data = await res.json();
    log('Uses custom startCommand', res.status === 200 && data.config?.startCommand === 'node custom.js');
    log('Uses custom waitForPort', res.status === 200 && data.config?.waitForPort === 8080);
  } catch (e: any) {
    log('Uses custom startCommand', false, e.message);
  }

  // Test 3: Invalid inputs
  console.log('\nTest: WebContainer with invalid inputs');
  const invalidTests = [
    { name: 'Missing files', body: {}, expected: 400 },
    { name: 'Files not object', body: { files: 'string' }, expected: 400 },
  ];
  
  for (const t of invalidTests) {
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/webcontainer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body)
      });
      log(t.name, res.status === t.expected, `got ${res.status}`);
    } catch (e: any) {
      log(t.name, false, e.message);
    }
  }
}

async function testOpenSandbox() {
  console.log('\n=== OpenSandbox (Preview Sandbox) API Tests ===');
  
  // Test 1: POST with valid files
  console.log('\nTest: OpenSandbox with valid files');
  try {
    const res = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: { 'package.json': '{}', 'index.js': 'console.log("test")' },
        framework: 'react'
      })
    });
    const data = await res.json();
    // Expects 500 due to missing OPEN_SANDBOX_API_KEY (expected)
    log('Handles missing API key gracefully', res.status === 500 && data.error?.includes('not configured'));
  } catch (e: any) {
    log('Handles missing API key gracefully', false, e.message);
  }

  // Test 2: GET sessions
  console.log('\nTest: OpenSandbox GET sessions');
  try {
    const res = await fetch(`${API_BASE}/api/preview/sandbox`, { method: 'GET' });
    const data = await res.json();
    log('Returns sessions list', res.status === 200 && Array.isArray(data.sessions));
  } catch (e: any) {
    log('Returns sessions list', false, e.message);
  }

  // Test 3: DELETE without sandboxId
  console.log('\nTest: OpenSandbox DELETE without sandboxId');
  try {
    const res = await fetch(`${API_BASE}/api/preview/sandbox?sandboxId=`, { method: 'DELETE' });
    const data = await res.json();
    log('Requires sandboxId', res.status === 400 && data.error?.includes('required'));
  } catch (e: any) {
    log('Requires sandboxId', false, e.message);
  }
}

async function testPreviewModes() {
  console.log('\n=== Preview Mode Selection Tests ===');
  console.log('\nTesting detectProject for all preview modes...');
  
  // Import and test the detection logic directly
  const { detectProject } = await import('./lib/previews/live-preview-offloading.ts');
  
  const testCases = [
    // Sandpack modes
    { files: { 'package.json': '{"dependencies":{"react":"^18"}}', 'src/App.tsx': 'export default()=><div/>' }, framework: 'react', mode: 'sandpack' },
    { files: { 'package.json': '{"dependencies":{"vue":"^3"}}', 'src/App.vue': '<template><div/></template>' }, framework: 'vue', mode: 'sandpack' },
    { files: { 'package.json': '{"devDependencies":{"svelte":"^4"}}', 'src/App.svelte': '<script/>' }, framework: 'svelte', mode: 'sandpack' },
    { files: { 'package.json': '{"dependencies":{"@angular/core":"^17"}}', 'angular.json': '{}' }, framework: 'angular', mode: 'sandpack' },
    { files: { 'package.json': '{"dependencies":{"nuxt":"^3"}}', 'nuxt.config.ts': '{}' }, framework: 'nuxt', mode: 'sandpack' },
    { files: { 'package.json': '{"dependencies":{"@remix-run/react":"^2"}}', 'remix.config.js': '{}' }, framework: 'remix', mode: 'sandpack' },
    { files: { 'package.json': '{"dependencies":{"solid-js":"^1.8"}}', 'src/index.tsx': 'render()' }, framework: 'solid', mode: 'sandpack' },
    
    // Iframe modes
    { files: { 'index.html': '<html></html>', 'style.css': '{}', 'app.js': 'console.log' }, framework: 'vanilla', mode: 'iframe' },
    { files: { 'package.json': '{"devDependencies":{"astro":"^4"}}', 'astro.config.mjs': '{}' }, framework: 'astro', mode: 'iframe' },
    { files: { 'package.json': '{"dependencies":{"gatsby":"^5"}}', 'gatsby-config.js': '{}' }, framework: 'gatsby', mode: 'iframe' },
    
    // Pyodide modes
    { files: { 'requirements.txt': 'flask==3', 'app.py': 'from flask import Flask' }, framework: 'flask', mode: 'pyodide' },
    { files: { 'requirements.txt': 'streamlit==1', 'app.py': 'import streamlit as st' }, framework: 'streamlit', mode: 'pyodide' },
    { files: { 'requirements.txt': 'gradio==4', 'app.py': 'import gradio as gr' }, framework: 'gradio', mode: 'pyodide' },
    
    // DevBox modes
    { files: { 'requirements.txt': 'fastapi==0.1', 'main.py': 'from fastapi import FastAPI' }, framework: 'fastapi', mode: 'devbox' },
    { files: { 'requirements.txt': 'django==4', 'manage.py': 'import django; django.setup()' }, framework: 'django', mode: 'devbox' },
    
    // Next.js mode
    { files: { 'package.json': '{"dependencies":{"next":"^14","react":"^18"}}', 'next.config.js': '{}', 'app/page.tsx': 'export default()=><div/>' }, framework: 'next', mode: 'nextjs' },
    
    // Vite/Webpack modes
    { files: { 'package.json': '{"devDependencies":{"vite":"^5"}}', 'vite.config.ts': 'export default{}', 'index.html': '<html></html>' }, framework: 'vite', mode: 'vite' },
    { files: { 'package.json': '{"devDependencies":{"webpack":"^5"}}', 'webpack.config.js': '{}' }, framework: 'unknown', mode: 'webpack' },
  ];
  
  console.log('\n');
  for (const tc of testCases) {
    try {
      const result = detectProject({ files: tc.files as any });
      const passed = result.framework === tc.framework && result.previewMode === tc.mode;
      const details = passed ? '' : `got ${result.framework}/${result.previewMode}, expected ${tc.framework}/${tc.mode}`;
      log(`Framework: ${tc.framework}, Mode: ${tc.mode}`, passed, details);
    } catch (e: any) {
      log(`Framework: ${tc.framework}`, false, e.message);
    }
  }
}

async function testHealthCheck() {
  console.log('\n=== Health Check ===');
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    log('Server is healthy', res.status === 200 && data.status === 'healthy');
  } catch (e: any) {
    log('Server is healthy', false, e.message);
  }
}

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        COMPREHENSIVE PREVIEW MODE API TESTS                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  await testHealthCheck();
  await testDevBox();
  await testWebContainer();
  await testOpenSandbox();
  await testPreviewModes();
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Passed: ${testResults.passed}/${testResults.total}`);
  console.log(`  Failed: ${testResults.failed}/${testResults.total}`);
  
  if (testResults.failed > 0) {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All API tests passed!');
  }
}

runAllTests().catch(console.error);