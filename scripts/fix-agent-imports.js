#!/usr/bin/env node
/**
 * Script to fix agent-session-manager and opencode-engine-service imports
 * Run with: node scripts/fix-agent-imports.js
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function main() {
  console.log('🔧 Fixing agent import paths...\n');
  
  let fixedCount = 0;
  
  // Fix all TypeScript files
  const allFiles = await glob('{app,lib}/**/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  for (const file of allFiles) {
    try {
      let content = await readFile(file, 'utf8');
      let originalContent = content;
      let changed = false;

      // Fix agent-session-manager imports
      if (content.includes('./agent-session-manager') || content.includes('../agent/agent-session-manager')) {
        // Determine the correct relative path based on file location
        if (file.includes('lib\\agent\\')) {
          // From lib/agent/, go to lib/session/agent/
          content = content.replace(
            /from ['"]\.\/agent-session-manager['"]/g,
            "from '../session/agent/agent-session-manager'"
          );
          content = content.replace(
            /from ['"]\.\.\/agent\/agent-session-manager['"]/g,
            "from '../../session/agent/agent-session-manager'"
          );
          content = content.replace(
            /import\(['"]\.\/agent-session-manager['"]\)/g,
            "import('../session/agent/agent-session-manager')"
          );
          changed = true;
        } else if (file.includes('lib\\tools\\')) {
          // From lib/tools/, go to lib/session/agent/
          content = content.replace(
            /from ['"]\.\.\/agent\/agent-session-manager['"]/g,
            "from '../session/agent/agent-session-manager'"
          );
          content = content.replace(
            /import\(['"]\.\.\/agent\/agent-session-manager['"]\)/g,
            "import('../session/agent/agent-session-manager')"
          );
          changed = true;
        } else if (file.includes('app\\api\\agent\\')) {
          // From app/api/agent/, use @ alias
          content = content.replace(
            /from ['"]@\/lib\/agent\/agent-session-manager['"]/g,
            "from '@/lib/session/agent/agent-session-manager'"
          );
          changed = true;
        }
      }

      // Fix opencode-engine-service imports
      if (content.includes('../opencode-engine-service')) {
        // From lib/session/agent/, it's now a sibling file
        content = content.replace(
          /from ['"]\.\.\/opencode-engine-service['"]/g,
          "from './opencode-engine-service'"
        );
        changed = true;
      }

      if (changed) {
        await writeFile(file, content, 'utf8');
        fixedCount++;
        const relativePath = file.replace(rootDir + '\\', '');
        console.log(`✓ ${relativePath}`);
      }
    } catch (error) {
      // Silent fail
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} files`);
}

main().catch(console.error);
