#!/usr/bin/env node
/**
 * Script to fix import paths after file reorganization
 * Run with: node scripts/fix-imports-latest.js
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Mapping of old import paths to new import paths
const importReplacements = [
  // API services moved to chat/
  { 
    old: "./fast-agent-service", 
    new: "../chat/fast-agent-service" 
  },
  { 
    old: "./n8n-agent-service", 
    new: "../chat/n8n-agent-service" 
  },
  { 
    old: "./custom-fallback-service", 
    new: "../chat/custom-fallback-service" 
  },
  { 
    old: "./enhanced-llm-service", 
    new: "../chat/enhanced-llm-service" 
  },
  
  // Platforms moved
  { 
    old: "../../platforms/composio-service", 
    new: "../../platforms/composio-service"  // Already correct, but may need path adjustment
  },
  { 
    old: "../api/arcade-service", 
    new: "../platforms/arcade-service" 
  },
  
  // Management
  { 
    old: "../../management/quota-manager", 
    new: "../../management/quota-manager"  // Already correct
  },
  
  // Session
  { 
    old: "../../session/session-manager", 
    new: "../../session/session-manager"  // Already correct
  },
  
  // Tools
  { 
    old: "../../tools", 
    new: "../../tools"  // Already correct
  },
  { 
    old: "../../tools/tool-authorization-manager", 
    new: "../../tools/tool-authorization-manager"  // Already correct
  },
  
  // Types
  { 
    old: "../../types/tool-invocation", 
    new: "../../types/tool-invocation"  // Already correct
  },
  
  // Utils
  { 
    old: "../../utils/logger", 
    new: "../../utils/logger"  // Already correct
  },
  { 
    old: "../../utils/request-type-detector", 
    new: "../../utils/request-type-detector"  // Already correct
  },
  
  // Sandbox
  { 
    old: "../../sandbox", 
    new: "../../sandbox"  // Already correct
  },
];

async function fixFile(filePath) {
  let content = await readFile(filePath, 'utf8');
  let originalContent = content;
  let changed = false;

  for (const replacement of importReplacements) {
    // Match import statements
    const patterns = [
      new RegExp(`from ['"]${escapeRegex(replacement.old)}['"]`, 'g'),
      new RegExp(`import\\(['"]${escapeRegex(replacement.old)}['"]\\)`, 'g'),
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        content = content.replace(pattern, (match) => {
          return match.replace(replacement.old, replacement.new);
        });
        changed = true;
      }
    }
  }

  if (changed) {
    await writeFile(filePath, content, 'utf8');
    return true;
  }
  
  return false;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  console.log('🔧 Fixing import paths...\n');
  
  const files = await glob('lib/api/**/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**']
  });

  console.log(`Found ${files.length} files to check\n`);
  
  let fixedCount = 0;

  for (const file of files) {
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

  // Also fix lib/tools/tool-integration-system.ts
  const toolIntegrationFile = resolve(rootDir, 'lib/tools/tool-integration-system.ts');
  try {
    const changed = await fixFile(toolIntegrationFile);
    if (changed) {
      fixedCount++;
      console.log(`✓ lib/tools/tool-integration-system.ts`);
    }
  } catch (error) {
    // File may not exist or already fixed
  }

  console.log(`\n✅ Fixed ${fixedCount} files`);
}

main().catch(console.error);
