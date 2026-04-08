/**
 * Preview API Test Script
 * Tests the /api/preview/sandbox endpoint with different frameworks
 */

const API_BASE = 'http://localhost:3000';

async function testPreviewSandbox() {
  console.log('Testing /api/preview/sandbox API endpoint...\n');

  // Test 1: React project
  const reactProject = {
    files: {
      'package.json': JSON.stringify({
        name: 'test-react',
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        scripts: {
          dev: 'vite'
        }
      }),
      'src/main.jsx': 'import React from "react"; import ReactDOM from "react-dom/client"; ReactDOM.createRoot(document.getElementById("root")).render(React.createElement("div", null, "Hello World"));',
      'index.html': '<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'
    },
    framework: 'react'
  };

  try {
    console.log('Test 1: POST /api/preview/sandbox with React project');
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reactProject)
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 2: Vanilla HTML project
  const vanillaProject = {
    files: {
      'index.html': '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>',
      'style.css': 'body { font-family: sans-serif; }',
      'app.js': 'console.log("Hello");'
    },
    framework: 'vanilla'
  };

  try {
    console.log('Test 2: POST /api/preview/sandbox with Vanilla project');
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vanillaProject)
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 3: Flask project
  const flaskProject = {
    files: {
      'app.py': 'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef hello():\n    return "Hello World"',
      'requirements.txt': 'flask==3.0.0'
    },
    framework: 'flask'
  };

  try {
    console.log('Test 3: POST /api/preview/sandbox with Flask project');
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flaskProject)
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 4: Missing files (should return 400)
  try {
    console.log('Test 4: POST /api/preview/sandbox with missing files (should return 400)');
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ framework: 'react' })
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 5: GET /api/preview/sandbox (list sessions)
  try {
    console.log('Test 5: GET /api/preview/sandbox (list active sessions)');
    const response = await fetch(`${API_BASE}/api/preview/sandbox`, {
      method: 'GET'
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testPreviewSandbox();