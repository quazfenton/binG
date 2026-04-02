#!/usr/bin/env node

/**
 * Smithery MCP Registry Submission Script
 *
 * Submits binG MCP server to Smithery registry.
 *
 * Usage:
 *   node scripts/submit-smithery.js
 *
 * Prerequisites:
 *   - Smithery CLI installed: npm install -g @smithery/cli
 *   - Smithery account with API key
 *   - SMITHERY_API_KEY environment variable set
 */

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const ROOT_DIR = join(__dirname, '..');
const MCP_PACKAGE_DIR = join(ROOT_DIR, 'packages', 'mcp-server');
const SMITHERY_CONFIG = join(MCP_PACKAGE_DIR, 'smithery.json');

// Smithery configuration
const smitheryConfig = {
  name: '@bing/mcp-server',
  displayName: 'binG - Agentic Compute Workspace',
  description: 'Full-stack AI agent workspace with sandboxed code execution, voice interaction, and multi-agent orchestration',
  version: '1.0.0',
  author: 'quazfenton',
  repository: 'github:quazfenton/binG',
  homepage: 'https://github.com/quazfenton/binG',
  license: 'MIT',
  keywords: [
    'mcp',
    'ai-agent',
    'sandbox',
    'code-execution',
    'voice-control',
    'multi-agent',
    'llm',
    'automation',
  ],
  mcp: {
    tools: 10,
    capabilities: ['sandbox', 'voice', 'llm', 'integrations'],
    transport: ['stdio', 'http', 'sse'],
  },
  installation: {
    npm: 'npm install -g @bing/mcp-server',
    docker: 'docker pull ghcr.io/quazfenton/bing-mcp-server:latest',
  },
  configuration: {
    required: ['DAYTONA_API_KEY', 'OPENROUTER_API_KEY'],
    optional: [
      'BLAXEL_API_KEY',
      'ANTHROPIC_API_KEY',
      'ELEVENLABS_API_KEY',
      'MCP_TRANSPORT_TYPE',
    ],
  },
};

console.log('🚀 Submitting binG MCP Server to Smithery Registry...\n');

try {
  // Step 1: Write smithery.json config
  console.log('📝 Writing smithery.json configuration...');
  writeFileSync(SMITHERY_CONFIG, JSON.stringify(smitheryConfig, null, 2));
  console.log('✅ smithery.json created\n');

  // Step 2: Build the package
  console.log('🔨 Building MCP server package...');
  process.chdir(MCP_PACKAGE_DIR);
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build complete\n');

  // Step 3: Validate package
  console.log('🔍 Validating package...');
  execSync('npm pack --dry-run', { stdio: 'inherit' });
  console.log('✅ Package valid\n');

  // Step 4: Submit to Smithery
  console.log('📤 Submitting to Smithery Registry...');
  
  const smitheryApiKey = process.env.SMITHERY_API_KEY;
  if (!smitheryApiKey) {
    console.warn('⚠️  SMITHERY_API_KEY not set. Skipping actual submission.\n');
    console.log('To submit, set SMITHERY_API_KEY and run again.\n');
  } else {
    execSync(`npx smithery publish --api-key ${smitheryApiKey}`, {
      stdio: 'inherit',
    });
    console.log('✅ Submitted to Smithery\n');
  }

  // Step 5: Print submission details
  console.log('📋 Submission Details:');
  console.log('─────────────────────────────────────────');
  console.log(`Name: ${smitheryConfig.name}`);
  console.log(`Display Name: ${smitheryConfig.displayName}`);
  console.log(`Version: ${smitheryConfig.version}`);
  console.log(`Tools: ${smitheryConfig.mcp.tools}`);
  console.log(`Capabilities: ${smitheryConfig.mcp.capabilities.join(', ')}`);
  console.log(`Transport: ${smitheryConfig.mcp.transport.join(', ')}`);
  console.log('─────────────────────────────────────────');
  console.log('');
  console.log('📬 Next Steps:');
  console.log('1. Wait for Smithery review (typically 24-48 hours)');
  console.log('2. Check submission status at: https://smithery.ai/server/@quazfenton/binG');
  console.log('3. Once approved, users can install via: npx @smithery/cli install @bing/mcp-server');
  console.log('');

} catch (error) {
  console.error('❌ Submission failed:', error.message);
  console.error('\nTroubleshooting:');
  console.error('1. Ensure Smithery CLI is installed: npm install -g @smithery/cli');
  console.error('2. Set SMITHERY_API_KEY environment variable');
  console.error('3. Check package.json for valid configuration');
  console.error('4. Review Smithery submission guidelines: https://smithery.ai/docs/publish');
  process.exit(1);
}
