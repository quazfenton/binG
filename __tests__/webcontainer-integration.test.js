/**
 * WebContainer Integration Test
 * 
 * Tests WebContainer sandbox creation, command execution, and file operations.
 * Uses NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID for authentication.
 * 
 * Run in browser console or via test runner:
 *   - Open browser DevTools console
 *   - Run: await runWebContainerTests()
 * 
 * Or open: __tests__/webcontainer-test-page.html
 */

// Check if running in browser
if (typeof window === 'undefined') {
  console.error('[WebContainer Test] Must run in browser environment');
  module.exports = { runWebContainerTests: () => Promise.reject(new Error('Browser required')) };
}

// Test results tracker
const results = {
  total: 0,
  pass: 0,
  fail: 0,
  tests: []
};

// Helper: Read stream to string
async function readStreamToString(stream) {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

// Test: Boot WebContainer
async function testBoot() {
  const name = 'Boot WebContainer';
  results.total++;
  
  try {
    const { WebContainer } = await import('@webcontainer/api');
    
    const clientId =
      typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____'
        : 'wc_api_____';
    const scope =
      typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || ''
        : '';
    
    if (WebContainer.auth?.init) {
      WebContainer.auth.init({ clientId, scope });
    }

    const wc = await WebContainer.boot();
    await wc.fs.mkdir('/workspace', { recursive: true });
    
    results.pass++;
    results.tests.push({ name, status: 'pass' });
    console.log(`✅ ${name}`);
    return wc;
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
    throw error;
  }
}

// Test: Write file
async function testWriteFile(wc) {
  const name = 'Write File';
  results.total++;
  
  try {
    const testFile = '/workspace/test-write.txt';
    const testContent = `Hello from WebContainer! ${Date.now()}`;
    
    await wc.fs.writeFile(testFile, testContent);
    const content = await wc.fs.readFile(testFile, 'utf-8');
    
    if (content === testContent) {
      results.pass++;
      results.tests.push({ name, status: 'pass' });
      console.log(`✅ ${name}`);
    } else {
      throw new Error('Content mismatch');
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: Read file
async function testReadFile(wc) {
  const name = 'Read File';
  results.total++;
  
  try {
    const testFile = '/workspace/test-read.txt';
    const testContent = 'Read test content ' + Math.random().toString(36);
    
    await wc.fs.writeFile(testFile, testContent);
    const content = await wc.fs.readFile(testFile, 'utf-8');
    
    results.pass++;
    results.tests.push({ name, status: 'pass', output: `Read ${content.length} bytes` });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: List directory
async function testListDirectory(wc) {
  const name = 'List Directory';
  results.total++;
  
  try {
    const entries = await wc.fs.readdir('/workspace');
    results.pass++;
    results.tests.push({ name, status: 'pass', output: `${entries.length} entries` });
    console.log(`✅ ${name} (${entries.length} entries)`);
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: Execute node --version
async function testNodeVersion(wc) {
  const name = 'Execute: node --version';
  results.total++;
  
  try {
    const process = await wc.spawn('node', ['--version']);
    const output = await readStreamToString(process.output);
    const exitCode = await process.exit;
    
    if (exitCode === 0 && output.match(/v\d+\.\d+\.\d+/)) {
      results.pass++;
      results.tests.push({ name, status: 'pass', output: output.trim() });
      console.log(`✅ ${name}: ${output.trim()}`);
    } else {
      throw new Error(`Unexpected output: ${output}`);
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: Execute npm --version
async function testNpmVersion(wc) {
  const name = 'Execute: npm --version';
  results.total++;
  
  try {
    const process = await wc.spawn('npm', ['--version']);
    const output = await readStreamToString(process.output);
    const exitCode = await process.exit;
    
    if (exitCode === 0 && output.match(/\d+\.\d+\.\d+/)) {
      results.pass++;
      results.tests.push({ name, status: 'pass', output: output.trim() });
      console.log(`✅ ${name}: ${output.trim()}`);
    } else {
      throw new Error(`Unexpected output: ${output}`);
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: Execute JavaScript file
async function testExecuteJS(wc) {
  const name = 'Execute JavaScript File';
  results.total++;
  
  try {
    const jsFile = '/workspace/exec-test.js';
    const jsContent = `
      console.log('JavaScript execution test');
      console.log('PI:', Math.PI);
      console.log('Timestamp:', Date.now());
      process.exit(0);
    `;
    
    await wc.fs.writeFile(jsFile, jsContent);
    const process = await wc.spawn('node', [jsFile]);
    const output = await readStreamToString(process.output);
    const exitCode = await process.exit;
    
    if (exitCode === 0 && output.includes('JavaScript execution test')) {
      results.pass++;
      results.tests.push({ name, status: 'pass' });
      console.log(`✅ ${name}`);
    } else {
      throw new Error(`Unexpected output: ${output}`);
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: npm install
async function testNpmInstall(wc) {
  const name = 'npm install (lodash)';
  results.total++;
  
  try {
    const projectDir = '/workspace/npm-test';
    await wc.fs.mkdir(projectDir, { recursive: true });
    
    await wc.fs.writeFile(
      `${projectDir}/package.json`,
      JSON.stringify({
        name: 'npm-test',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.21' },
      }, null, 2)
    );
    
    console.log('⏳ Installing npm package (may take 10-30s)...');
    const process = await wc.spawn('npm', ['install'], { cwd: projectDir });
    const output = await readStreamToString(process.output);
    const exitCode = await process.exit;
    
    if (exitCode === 0 && output.includes('added')) {
      results.pass++;
      results.tests.push({ name, status: 'pass' });
      console.log(`✅ ${name}`);
    } else {
      throw new Error(`npm install failed: ${output}`);
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Test: Start HTTP server
async function testHTTPServer(wc) {
  const name = 'Start HTTP Server';
  results.total++;
  
  try {
    const serverDir = '/workspace/server-test';
    await wc.fs.mkdir(serverDir, { recursive: true });
    
    const serverCode = `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from HTTP Server!');
      });
      server.listen(3000, () => console.log('Server on port 3000'));
      setTimeout(() => { server.close(); process.exit(0); }, 3000);
    `;
    
    await wc.fs.writeFile(`${serverDir}/server.js`, serverCode);
    const process = await wc.spawn('node', ['server.js'], { cwd: serverDir });
    const output = await readStreamToString(process.output);
    const exitCode = await process.exit;
    
    if (exitCode === 0 && output.includes('Server on port 3000')) {
      results.pass++;
      results.tests.push({ name, status: 'pass' });
      console.log(`✅ ${name}`);
    } else {
      throw new Error(`Server test failed: ${output}`);
    }
  } catch (error) {
    results.fail++;
    results.tests.push({ name, status: 'fail', error: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

// Main test runner
async function runWebContainerTests() {
  console.log('\n🧪 WebContainer Integration Tests\n');
  console.log('================================\n');
  
  // Verify environment
  if (typeof window === 'undefined') {
    console.error('❌ Must run in browser environment');
    return { success: false, error: 'Browser required' };
  }
  
  const clientId =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID
      : undefined;
  if (!clientId) {
    console.warn('⚠️  NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID not set, using default');
  }
  
  try {
    // Boot WebContainer
    const wc = await testBoot();
    
    // Run filesystem tests
    await testWriteFile(wc);
    await testReadFile(wc);
    await testListDirectory(wc);
    
    // Run command execution tests
    await testNodeVersion(wc);
    await testNpmVersion(wc);
    await testExecuteJS(wc);
    
    // Run package installation test
    await testNpmInstall(wc);
    
    // Run server test
    await testHTTPServer(wc);
    
    // Summary
    console.log('\n================================');
    console.log(`\n📊 Results: ${results.pass}/${results.total} passed`);
    
    if (results.fail > 0) {
      console.log(`\n❌ Failed tests:`);
      results.tests
        .filter(t => t.status === 'fail')
        .forEach(t => console.log(`   - ${t.name}: ${t.error}`));
    }
    
    return {
      success: results.fail === 0,
      total: results.total,
      pass: results.pass,
      fail: results.fail,
      tests: results.tests
    };
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Export for browser console
if (typeof window !== 'undefined') {
  window.runWebContainerTests = runWebContainerTests;
  window.WebContainerTestResults = results;
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runWebContainerTests };
}
