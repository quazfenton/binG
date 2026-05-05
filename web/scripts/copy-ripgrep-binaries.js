#!/usr/bin/env node
/**
 * Copy ripgrep binaries to standalone build output
 * 
 * This script ensures that the cross-platform ripgrep binaries in tools/bin
 * are included in Next.js standalone builds for deployment.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const sourceBinDir = path.join(projectRoot, 'tools', 'bin');
const standaloneDir = path.join(__dirname, '..', '.next', 'standalone');
const targetBinDir = path.join(standaloneDir, 'tools', 'bin');

console.log('[copy-ripgrep-binaries] Starting...');
console.log(`  Source: ${sourceBinDir}`);
console.log(`  Target: ${targetBinDir}`);

// Check if standalone build exists
if (!fs.existsSync(standaloneDir)) {
  console.log('[copy-ripgrep-binaries] No standalone build found, skipping');
  process.exit(0);
}

// Check if source binaries exist
if (!fs.existsSync(sourceBinDir)) {
  console.warn('[copy-ripgrep-binaries] WARNING: tools/bin directory not found');
  process.exit(0);
}

// Create target directory
if (!fs.existsSync(targetBinDir)) {
  fs.mkdirSync(targetBinDir, { recursive: true });
  console.log('[copy-ripgrep-binaries] Created target directory');
}

// Copy binaries
const binaries = ['rg.exe', 'rg-linux', 'rg-macos'];
let copiedCount = 0;

for (const binary of binaries) {
  const sourcePath = path.join(sourceBinDir, binary);
  const targetPath = path.join(targetBinDir, binary);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
    
    // Make executable on Unix systems
    if (binary !== 'rg.exe') {
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch (err) {
        console.warn(`[copy-ripgrep-binaries] Could not chmod ${binary}: ${err.message}`);
      }
    }
    
    const stats = fs.statSync(targetPath);
    console.log(`[copy-ripgrep-binaries] ✓ Copied ${binary} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    copiedCount++;
  } else {
    console.warn(`[copy-ripgrep-binaries] WARNING: ${binary} not found in source`);
  }
}

console.log(`[copy-ripgrep-binaries] Done! Copied ${copiedCount}/${binaries.length} binaries`);
