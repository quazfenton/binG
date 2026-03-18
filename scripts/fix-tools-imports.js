#!/usr/bin/env node
/**
 * Script to fix remaining import paths in tools/bootstrap files
 * Run with: node scripts/fix-tools-imports.js
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function fixFile(filePath) {
  let content = await readFile(filePath, 'utf8');
  let originalContent = content;
  let changed = false;

  // Fix ../utils/logger -> ../../utils/logger (for files in lib/tools/bootstrap/)
  if (content.includes("../utils/logger")) {
    content = content.replace(/from ['"]\.\.\/utils\/logger['"]/g, "from '../../utils/logger'");
    changed = true;
  }

  if (changed) {
    await writeFile(filePath, content, 'utf8');
    return true;
  }
  return false;
}

async function main() {
  console.log('🔧 Fixing tools file imports...\n');
  
  let fixedCount = 0;
  
  // Fix files in lib/tools/bootstrap/
  const bootstrapFiles = await glob('lib/tools/bootstrap/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  for (const file of bootstrapFiles) {
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

  // Fix files in lib/tools/
  const toolFiles = await glob('lib/tools/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**', 'index.ts', 'registry.ts']
  });

  for (const file of toolFiles) {
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

  // Fix lib/virtual-filesystem/sync files
  const vfsFiles = await glob('lib/virtual-filesystem/sync/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  for (const file of vfsFiles) {
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

  console.log(`\n✅ Fixed ${fixedCount} files`);
}

main().catch(console.error);
