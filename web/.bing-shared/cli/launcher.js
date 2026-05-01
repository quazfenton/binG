#!/usr/bin/env node
/**
 * CLI Launcher
 * 
 * Simple launcher that pkg bundles into the executable.
 * Spawns Node.js to run the CLI, bypassing pkg's snapshot issues.
 * 
 * Usage: ./bing.exe [args...]  
 * Runs: node <exe-dir>/dist/bin.js [args...]
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get the directory where this executable lives
const exeDir = path.dirname(process.execPath);

// The main entry point - check if bin.js or bin.cjs exists
const binJs = path.join(exeDir, 'dist', 'bin.js');
const binCjs = path.join(exeDir, 'dist', 'bin.cjs');

// Prefer .cjs if it exists (explicit CommonJS), otherwise use .js (ESM)
const mainScript = fs.existsSync(binCjs) ? binCjs : binJs;

// Forward all arguments (skip the launcher path)
const args = process.argv.slice(1);

// Run the main script with Node.js
// For ESM modules with "type": "module", we need to use --no-warnings flag
// to suppress experimental warnings
const result = spawnSync(process.execPath, [mainScript, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
  shell: true,
});

if (result.error) {
  console.error('Failed to launch CLI:', result.error.message);
  process.exit(1);
}

// Forward exit code
process.exit(result.status !== null ? result.status : 1);