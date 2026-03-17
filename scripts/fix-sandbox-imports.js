#!/usr/bin/env node
/**
 * Script to fix remaining import paths in sandbox files
 * Run with: node scripts/fix-sandbox-imports.js
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Files in lib/sandbox/ that need fixes
const sandboxFiles = await glob('lib/sandbox/*.{ts,tsx}', {
  cwd: rootDir,
  absolute: true,
  ignore: ['**/node_modules/**', '**/deprecated/**']
});

async function fixFile(filePath) {
  let content = await readFile(filePath, 'utf8');
  let originalContent = content;
  let changed = false;

  // Fix ../../sandbox/providers -> ./providers
  if (content.includes("../../sandbox/providers")) {
    content = content.replace(/from ['"]\.\.\/\.\.\/sandbox\/providers['"]/g, "from './providers'");
    changed = true;
  }

  // Fix ../utils/logger -> ./utils/logger (for files in lib/sandbox/)
  if (content.includes("../utils/logger") && !filePath.includes('providers')) {
    content = content.replace(/from ['"]\.\.\/utils\/logger['"]/g, "from './utils/logger'");
    changed = true;
  }

  // Fix ../../terminal/session/user-terminal-sessions -> ../terminal/session/user-terminal-sessions
  if (content.includes("../../terminal/session/user-terminal-sessions")) {
    content = content.replace(
      /from ['"]\.\.\/\.\.\/terminal\/session\/user-terminal-sessions['"]/g,
      "from '../terminal/session/user-terminal-sessions'"
    );
    changed = true;
  }

  // Fix ../../terminal/session/terminal-session-store -> ../terminal/session/terminal-session-store
  if (content.includes("../../terminal/session/terminal-session-store")) {
    content = content.replace(
      /from ['"]\.\.\/\.\.\/terminal\/session\/terminal-session-store['"]/g,
      "from '../terminal/session/terminal-session-store'"
    );
    changed = true;
  }

  if (changed) {
    await writeFile(filePath, content, 'utf8');
    return true;
  }
  return false;
}

async function main() {
  console.log('🔧 Fixing sandbox file imports...\n');
  
  let fixedCount = 0;
  
  for (const file of sandboxFiles) {
    try {
      const changed = await fixFile(file);
      if (changed) {
        fixedCount++;
        const relativePath = file.replace(rootDir + '\\', '');
        console.log(`✓ ${relativePath}`);
      }
    } catch (error) {
      console.error(`✗ ${file}: ${error.message}`);
    }
  }

  // Also fix files in lib/sandbox/providers/
  const providerFiles = await glob('lib/sandbox/providers/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  for (const file of providerFiles) {
    try {
      let content = await readFile(file, 'utf8');
      let originalContent = content;
      let changed = false;

      // Fix ../utils/logger -> ../../utils/logger (for files in lib/sandbox/providers/)
      if (content.includes("../utils/logger")) {
        content = content.replace(/from ['"]\.\.\/utils\/logger['"]/g, "from '../../utils/logger'");
        changed = true;
      }

      if (changed) {
        await writeFile(file, content, 'utf8');
        fixedCount++;
        const relativePath = file.replace(rootDir + '\\', '');
        console.log(`✓ ${relativePath}`);
      }
    } catch (error) {
      console.error(`✗ ${file}: ${error.message}`);
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} files`);
}

main().catch(console.error);
