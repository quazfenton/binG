#!/usr/bin/env node
/**
 * Minimal agent test - bypasses HTTP and tests core modules directly
 */

console.log('🔍 Testing Core Agent Modules Directly\n');

let failed = 0;

// Test 1: Can we import the core modules?
console.log('Test 1: Module Imports');
try {
  const { execSync } = await import('child_process');
  execSync('cd /opt/bing/web && node -e "const x = require(\"./lib/mcp/architecture-integration\"); console.log(\"✅ MCP module loads\")"', { encoding: 'utf8', timeout: 5000 });
} catch (e) {
  console.error('❌ Module import failed:', e.message);
  failed++;
}

// Test 2: Check VFS tools registration
console.log('\nTest 2: VFS Tools');
try {
  const fs = await import('fs');
  const vfsToolsPath = '/opt/bing/web/lib/mcp/vfs-mcp-tools.ts';
  if (fs.existsSync(vfsToolsPath)) {
    const content = fs.readFileSync(vfsToolsPath, 'utf8');
    const hasWrite = content.includes('write_file');
    const hasRead = content.includes('read_file');
    const hasList = content.includes('list_files');
    console.log(`✅ VFS tools exist: write=${hasWrite}, read=${hasRead}, list=${hasList}`);
  } else {
    console.log('❌ VFS tools file not found');
    failed++;
  }
} catch (e) {
  console.error('❌ VFS test failed:', e.message);
  failed++;
}

// Test 3: Check if file parsing works
console.log('\nTest 3: File Edit Parser');
try {
  const fs = await import('fs');
  const parserPath = '/opt/bing/web/lib/tools/file-edit-parser.ts';
  if (fs.existsSync(parserPath)) {
    console.log('✅ File edit parser exists');
    const content = fs.readFileSync(parserPath, 'utf8');
    const hasWrite = content.includes('WRITE_FILE') || content.includes('write_file');
    const hasDiff = content.includes('APPLY_DIFF');
    console.log(`   Patterns: WRITE=${hasWrite}, DIFF=${hasDiff}`);
  }
} catch (e) {
  console.error('❌ Parser test failed:', e.message);
  failed++;
}

// Test 4: Check recent chat logs for actual failures
console.log('\nTest 4: Recent Chat Failures');
try {
  const { execSync } = await import('child_process');
  const logs = execSync('tail -1000 /opt/bing/web/logs/run.log | grep -i "error\\|failed\\|timeout" | tail -20', { encoding: 'utf8' });
  if (logs.trim()) {
    console.log('Recent errors found:');
    console.log(logs.trim().split('\n').slice(0, 10).join('\n'));
  } else {
    console.log('✅ No recent errors in last 1000 log lines');
  }
} catch (e) {
  console.log('⚠️  Could not read logs');
}

// Test 5: Check if server is truly stuck
console.log('\nTest 5: Server Health');
const { execSync } = await import('child_process');
try {
  const strace = execSync('timeout 2 strace -p 2874703 2>&1 || true', { encoding: 'utf8', timeout: 3000 });
  if (strace.includes('futex') || strace.includes('epoll_wait')) {
    console.log('✅ Server is waiting on events (not truly hung)');
  } else if (strace.includes('EACCES')) {
    console.log('⚠️  Cannot strace (permission denied)');
  } else {
    console.log('⚠️  Server state unclear');
    console.log(strace.slice(0, 500));
  }
} catch (e) {
  console.log('⚠️  strace failed:', e.message);
}

console.log('\n📊 Core module check complete');
if (failed > 0) {
  console.error(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
