#!/usr/bin/env node
/**
 * Script to fix remaining import path issues
 * Run with: node scripts/fix-remaining-imports.js
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function main() {
  console.log('🔧 Fixing remaining import issues...\n');
  
  let fixedCount = 0;
  
  // Fix all TypeScript files
  const allFiles = await glob('{app,lib,components}/**/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  for (const file of allFiles) {
    try {
      let content = await readFile(file, 'utf8');
      let originalContent = content;
      let changed = false;

      // Fix ./utils/logger -> ../utils/logger for files in lib/sandbox/ (except providers)
      if (file.includes('lib\\sandbox\\') && !file.includes('providers\\') && !file.includes('node_modules')) {
        if (content.includes("from './utils/logger'")) {
          content = content.replace(/from ['"]\.\/utils\/logger['"]/g, "from '../utils/logger'");
          changed = true;
        }
      }

      // Fix ./security/terminal-security -> ../security/terminal-security for files in lib/terminal/commands/
      if (file.includes('lib\\terminal\\commands\\')) {
        if (content.includes("from './security/terminal-security'")) {
          content = content.replace(/from ['"]\.\/security\/terminal-security['"]/g, "from '../security/terminal-security'");
          changed = true;
        }
      }

      // Fix ./storage/storage-backend -> ../storage/storage-backend for files in lib/backend/
      if (file.includes('lib\\backend\\')) {
        if (content.includes("from './storage/storage-backend'")) {
          content = content.replace(/from ['"]\.\/storage\/storage-backend['"]/g, "from '../storage/storage-backend'");
          changed = true;
        }
      }

      // Fix ../management/tool-authorization-manager -> ../tools/tool-authorization-manager
      if (content.includes("../management/tool-authorization-manager")) {
        content = content.replace(/from ['"]\.\.\/management\/tool-authorization-manager['"]/g, "from '../tools/tool-authorization-manager'");
        changed = true;
      }
      
      // Fix dynamic import for tool-authorization-manager
      if (content.includes("import('../management/tool-authorization-manager')")) {
        content = content.replace(/import\(['"]\.\.\/management\/tool-authorization-manager['"]\)/g, "import('../tools/tool-authorization-manager')");
        changed = true;
      }

      // Fix @/lib/mastra/mastra-instance -> @/lib/orchestra/mastra/mastra-instance
      if (content.includes("@/lib/mastra/mastra-instance")) {
        content = content.replace(/@\/lib\/mastra\/mastra-instance/g, "@/lib/orchestra/mastra/mastra-instance");
        changed = true;
      }

      // Fix ../database/connection -> ../../database/connection for files in lib/terminal/session/
      if (file.includes('lib\\terminal\\session\\')) {
        if (content.includes("../database/connection")) {
          content = content.replace(/from ['"]\.\.\/database\/connection['"]/g, "from '../../database/connection'");
          changed = true;
        }
      }

      if (changed) {
        await writeFile(file, content, 'utf8');
        fixedCount++;
        const relativePath = file.replace(rootDir + '\\', '');
        console.log(`✓ ${relativePath}`);
      }
    } catch (error) {
      // Silent fail for most files
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} files`);
}

main().catch(console.error);
