/**
 * CLI Bundling Script
 * 
 * Bundles the binG CLI by copying the dist folder and creating a launcher script.
 * No pkg bundling needed - the launcher uses Node.js directly.
 * 
 * Usage:
 *   node scripts/bundle-cli.cjs           # Bundle for current platform
 *   node scripts/bundle-cli.cjs --win     # Windows only
 *   node scripts/bundle-cli.cjs --linux   # Linux only  
 *   node scripts/bundle-cli.cjs --mac     # macOS only
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cliDir = path.join(__dirname, '..');
const distDir = path.join(cliDir, 'dist');
const outputDir = path.join(cliDir, 'bundle');

// Parse arguments
const args = process.argv.slice(2);
const platforms = {
  win: 'node18-win-x64',
  linux: 'node18-linux-x64',
  mac: 'node18-macos-x64',
};

function getTarget() {
  if (args.includes('--win')) return platforms.win;
  if (args.includes('--linux')) return platforms.linux;
  if (args.includes('--mac')) return platforms.mac;
  if (process.platform === 'win32') return platforms.win;
  if (process.platform === 'darwin') return platforms.mac;
  return platforms.linux;
}

function ensureOutputDir() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function getEntryPoint() {
  // Verify the main entry point exists
  const binPath = path.join(distDir, 'bin.js');
  if (!fs.existsSync(binPath)) {
    throw new Error(`Entry point not found: ${binPath}. Run 'pnpm build' first.`);
  }
  return binPath;
}

function bundle(target) {
  // Determine output name based on platform
  const isWin = target.includes('win');
  const outputName = isWin ? 'bing.cmd' : 'bing.sh';
  
  console.log(`\n📦 Creating CLI bundle for ${target}...`);
  console.log(`   Output: ${path.join(outputDir, outputName)}`);
  
  try {
    // Copy the entire dist folder
    console.log('   Copying dist folder...');
    const distDest = path.join(outputDir, 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDest, { recursive: true, force: true });
      fs.cpSync(distDir, distDest, { recursive: true });
      console.log('   ✓ dist folder copied');
    } else {
      throw new Error('dist folder not found. Run pnpm build first.');
    }
    
    // Copy lib folder inside dist for relative imports (./lib/...)
    const libSrc = path.join(distDir, 'lib');
    const libDestInDist = path.join(distDest, 'lib');
    if (fs.existsSync(libSrc)) {
      fs.rmSync(libDestInDist, { recursive: true, force: true });
      fs.cpSync(libSrc, libDestInDist, { recursive: true });
      console.log('   ✓ dist/lib folder copied (for relative imports)');
    }
    
    // Copy launcher script
    const launcherSrc = isWin ? path.join(cliDir, 'bing.cmd') : path.join(cliDir, 'bing.sh');
    const launcherDest = path.join(outputDir, outputName);
    if (fs.existsSync(launcherSrc)) {
      fs.copyFileSync(launcherSrc, launcherDest);
      if (!isWin) {
        // Make shell script executable on Unix
        fs.chmodSync(launcherDest, 0o755);
      }
      console.log(`   ✓ ${outputName} launcher copied`);
    } else {
      // Create default launcher
      if (isWin) {
        fs.writeFileSync(launcherDest, '@echo off\nnode "%~dp0dist\\bin.js" %*\n');
      } else {
        fs.writeFileSync(launcherDest, '#!/bin/bash\nnode "$(dirname "$0")/dist/bin.js" "$@"\n');
        fs.chmodSync(launcherDest, 0o755);
      }
      console.log(`   ✓ ${outputName} launcher created`);
    }
    
    // Show total bundle size
    let totalSize = 0;
    function getDirSize(dir) {
      if (!fs.existsSync(dir)) return 0;
      const stats = fs.statSync(dir);
      if (stats.isFile()) return stats.size;
      let size = 0;
      for (const item of fs.readdirSync(dir)) {
        size += getDirSize(path.join(dir, item));
      }
      return size;
    }
    totalSize = getDirSize(outputDir);
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
    console.log(`   Total size: ${sizeMB} MB`);
    
    console.log(`\n✅ Bundle created: ${outputName}`);
    
  } catch (error) {
    console.error(`\n❌ Failed to create bundle: ${error.message}`);
    throw error;
  }
}

function main() {
  console.log('🎯 binG CLI Bundler');
  console.log('===================\n');
  
  // Ensure dist exists
  if (!fs.existsSync(distDir)) {
    console.error('❌ dist directory not found. Run: pnpm build');
    process.exit(1);
  }
  
  ensureOutputDir();
  
  const target = getTarget();
  console.log(`\n📌 Target platform: ${target}`);
  
  try {
    bundle(target);
    console.log('\n✨ Bundling complete!');
    console.log(`📁 Output: ${path.join(outputDir, target.includes('win') ? 'bing.exe' : 'bing')}`);
  } catch (error) {
    console.error('\n❌ Bundling failed:', error.message);
    process.exit(1);
  }
}

main();