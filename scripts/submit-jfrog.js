#!/usr/bin/env node

/**
 * JFrog Universal MCP Registry Submission Script
 *
 * Submits binG MCP server to JFrog MCP Registry.
 *
 * Usage:
 *   node scripts/submit-jfrog.js
 *
 * Prerequisites:
 *   - JFrog CLI installed: https://jfrog.com/cli
 *   - JFrog Platform account
 *   - JF_URL, JF_USER, JF_PASSWORD environment variables set
 */

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const ROOT_DIR = join(__dirname, '..');
const MCP_PACKAGE_DIR = join(ROOT_DIR, 'packages', 'mcp-server');
const JFROG_CONFIG = join(MCP_PACKAGE_DIR, 'jfrog.json');

// JFrog configuration
const jfrogConfig = {
  version: '1.0',
  type: 'mcp-server',
  server: {
    name: 'binG',
    url: 'https://github.com/quazfenton/binG',
  },
  package: {
    name: '@bing/mcp-server',
    version: '1.0.0',
    type: 'npm',
  },
  mcp: {
    protocol: '1.0.0',
    tools: [
      'execute_command',
      'write_file',
      'read_file',
      'list_directory',
      'create_agent',
      'get_agent_status',
      'stop_agent',
      'spawn_agent_session',
      'voice_speech',
      'generate_image',
    ],
    capabilities: {
      sandbox: ['daytona', 'blaxel', 'runloop', 'sprites', 'e2b'],
      voice: ['elevenlabs', 'cartesia', 'livekit'],
      llm: ['openrouter', 'anthropic', 'google', 'mistral'],
      integrations: ['nango', 'composio', 'arcade', 'smithery'],
    },
  },
  security: {
    authentication: 'bearer',
    sandbox: 'isolated',
    rateLimiting: true,
    auditLogging: true,
  },
  metadata: {
    author: 'quazfenton',
    license: 'MIT',
    keywords: ['mcp', 'ai-agent', 'sandbox', 'code-execution', 'voice-control'],
  },
};

console.log('🚀 Submitting binG MCP Server to JFrog Universal MCP Registry...\n');

try {
  // Step 1: Write jfrog.json configuration
  console.log('📝 Writing jfrog.json configuration...');
  writeFileSync(JFROG_CONFIG, JSON.stringify(jfrogConfig, null, 2));
  console.log('✅ jfrog.json created\n');

  // Step 2: Check JFrog CLI installation
  console.log('🔍 Checking JFrog CLI installation...');
  execSync('jf --version', { stdio: 'pipe' });
  console.log('✅ JFrog CLI found\n');

  // Step 3: Configure JFrog (if env vars set)
  const jfUrl = process.env.JF_URL;
  const jfUser = process.env.JF_USER;
  const jfPassword = process.env.JF_PASSWORD;

  if (jfUrl && jfUser && jfPassword) {
    console.log('⚙️  Configuring JFrog connection...');
    execSync('jf config delete default 2>/dev/null || true', { stdio: 'pipe' });
    execSync(
      `jf config add default --url=${jfUrl} --user=${jfUser} --password=${jfPassword} --interactive=false`,
      { stdio: 'pipe' }
    );
    console.log('✅ JFrog configured\n');
  } else {
    console.warn('⚠️  JF_URL, JF_USER, or JF_PASSWORD not set. Skipping configuration.\n');
    console.log('To submit, set JF_URL, JF_USER, and JF_PASSWORD and run again.\n');
  }

  // Step 4: Build the package
  console.log('🔨 Building MCP server package...');
  process.chdir(MCP_PACKAGE_DIR);
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build complete\n');

  // Step 5: Create npm package
  console.log('📦 Creating npm package...');
  execSync('npm pack', { stdio: 'inherit' });
  console.log('✅ Package created\n');

  // Step 6: Publish to JFrog (if configured)
  if (jfUrl && jfUser && jfPassword) {
    console.log('📤 Publishing to JFrog MCP Registry...');
    execSync('jf npm publish --server-id=default', { stdio: 'inherit' });
    console.log('✅ Published to JFrog\n');

    // Step 7: Register as MCP server
    console.log('🔗 Registering as MCP server...');
    execSync('jf mcp register --server-id=default', { stdio: 'inherit' });
    console.log('✅ MCP registration complete\n');
  }

  // Step 8: Print submission details
  console.log('📋 Submission Details:');
  console.log('─────────────────────────────────────────');
  console.log(`Package: ${jfrogConfig.package.name}@${jfrogConfig.package.version}`);
  console.log(`Tools: ${jfrogConfig.mcp.tools.length}`);
  console.log(`Sandbox Providers: ${jfrogConfig.mcp.capabilities.sandbox.length}`);
  console.log(`Voice Providers: ${jfrogConfig.mcp.capabilities.voice.length}`);
  console.log(`LLM Providers: ${jfrogConfig.mcp.capabilities.llm.length}`);
  console.log(`Integration Providers: ${jfrogConfig.mcp.capabilities.integrations.length}`);
  console.log('─────────────────────────────────────────');
  console.log('');
  console.log('📬 Next Steps:');
  console.log('1. Wait for JFrog review (typically 24-48 hours)');
  console.log('2. Check submission status in JFrog Platform');
  console.log('3. Once approved, users can install via: jf mcp install @bing/mcp-server');
  console.log('');
  console.log('🔗 JFrog MCP Registry: https://mcp.jfrog.io');
  console.log('');

} catch (error) {
  console.error('❌ Submission failed:', error.message);
  console.error('\nTroubleshooting:');
  console.error('1. Install JFrog CLI: https://jfrog.com/cli');
  console.error('2. Set JF_URL, JF_USER, and JF_PASSWORD environment variables');
  console.error('3. Ensure you have publish permissions in JFrog Platform');
  console.error('4. Review JFrog MCP Registry guidelines: https://mcp.jfrog.io/docs');
  process.exit(1);
}
