#!/usr/bin/env node
/**
 * Script to fix import paths after file reorganization
 * Run with: node scripts/fix-imports.js
 */

import { glob } from 'glob';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Mapping of old import paths to new import paths
const importReplacements = [
  // Sandbox module relocations
  { 
    old: ["../sandbox/auto-snapshot-service", "./auto-snapshot-service"], 
    new: "../virtual-filesystem/sync/auto-snapshot-service" 
  },
  { 
    old: ["../sandbox/local-filesystem-executor", "./local-filesystem-executor"], 
    new: "../terminal/commands/local-filesystem-executor" 
  },
  { 
    old: "../sandbox/user-terminal-sessions", 
    new: "../terminal/session/user-terminal-sessions" 
  },
  { 
    old: "../sandbox/sandbox-connection-manager", 
    new: "../../sandbox/sandbox-connection-manager" 
  },
  
  // Terminal module relocations
  { 
    old: "../terminal/terminal-session-store", 
    new: "./terminal-session-store" 
  },
  { 
    old: "../terminal/terminal-handler-wiring", 
    new: "../terminal/commands/terminal-handler-wiring" 
  },
  { 
    old: "../terminal/terminal-local-fs-handler", 
    new: "../terminal/commands/terminal-local-fs-handler" 
  },
  { 
    old: "../terminal/terminal-input-handler", 
    new: "../terminal/commands/terminal-input-handler" 
  },
  { 
    old: "../terminal/terminal-editor-handler", 
    new: "../terminal/commands/terminal-editor-handler" 
  },
  { 
    old: "../terminal/local-filesystem-executor", 
    new: "../terminal/commands/local-filesystem-executor" 
  },
  
  // Terminal handler wiring internal imports (from lib/terminal/commands/)
  { 
    old: "../terminal/terminal-health-monitor", 
    new: "../terminal-health-monitor" 
  },
  { 
    old: "../terminal/terminal-input-batcher", 
    new: "../terminal-input-batcher" 
  },
  { 
    old: "../terminal/terminal-ui-manager", 
    new: "../terminal-ui-manager" 
  },
  { 
    old: "../terminal/terminal-state-manager", 
    new: "./session/terminal-state-manager" 
  },
  
  // Security module
  { 
    old: "./terminal-security", 
    new: "./security/terminal-security" 
  },
  { 
    old: "./security/terminal-security", 
    new: "../security/terminal-security" 
  },
  
  // Backend storage
  { 
    old: "./storage-backend", 
    new: "./storage/storage-backend" 
  },
  { 
    old: "./storage/storage-backend", 
    new: "./storage-backend" 
  },
  
  // Platform integrations
  { 
    old: "@/lib/composio/webhook-handler", 
    new: "@/lib/platforms/composio/webhook-handler" 
  },
  
  // Orchestra/Mastra relocations
  { 
    old: "@/lib/mastra", 
    new: "@/lib/orchestra/mastra" 
  },
  { 
    old: "@/lib/mastra/workflows/hitl-workflow", 
    new: "@/lib/orchestra/mastra/workflows/hitl-workflow" 
  },
  
  // Stateful-agent relocations
  { 
    old: "@/lib/stateful-agent", 
    new: "@/lib/orchestra/stateful-agent" 
  },
  { 
    old: "@/lib/stateful-agent/agents/provider-fallback", 
    new: "@/lib/orchestra/stateful-agent/agents/provider-fallback" 
  },
  { 
    old: "@/lib/stateful-agent/agents/stateful-agent", 
    new: "@/lib/orchestra/stateful-agent/agents/stateful-agent" 
  },
  { 
    old: "@/lib/stateful-agent/commit/shadow-commit", 
    new: "@/lib/orchestra/stateful-agent/commit/shadow-commit" 
  },
  { 
    old: "@/lib/stateful-agent/tools", 
    new: "@/lib/orchestra/stateful-agent/tools" 
  },
  { 
    old: "@/lib/stateful-agent/tools/tool-executor", 
    new: "@/lib/orchestra/stateful-agent/tools/tool-executor" 
  },
  
  // Tool authorization
  { 
    old: "@/lib/services/tool-authorization-manager", 
    new: "@/lib/tools/tool-authorization-manager" 
  },
  { 
    old: "../management/tool-authorization-manager", 
    new: "../tools/tool-authorization-manager" 
  },
  { 
    old: "../management/tool-context-manager", 
    new: "../tools/tool-context-manager" 
  },
  
  // Logger path fix - multiple levels
  { 
    old: "../../../utils/logger", 
    new: "../../utils/logger" 
  },
  { 
    old: "../../utils/logger", 
    new: "../utils/logger" 
  },
  
  // Sandbox exports for terminal modules
  { 
    old: "../terminal-health-monitor", 
    new: "./terminal/terminal-health-monitor" 
  },
  { 
    old: "../terminal-input-batcher", 
    new: "./terminal/terminal-input-batcher" 
  },
  { 
    old: "../terminal-ui-manager", 
    new: "./terminal/terminal-ui-manager" 
  },
  
  // Auto-snapshot service internal imports
  { 
    old: "./providers", 
    new: "../../sandbox/providers" 
  },
  { 
    old: "../terminal/session/terminal-session-store", 
    new: "../../terminal/session/terminal-session-store" 
  },
  { 
    old: "../terminal/session/user-terminal-sessions", 
    new: "../../terminal/session/user-terminal-sessions" 
  },
  
  // Terminal commands local imports
  { 
    old: "./sandbox-connection-manager", 
    new: "../../sandbox/sandbox-connection-manager" 
  },
  { 
    old: "./terminal-health-monitor", 
    new: "../terminal-health-monitor" 
  },
  { 
    old: "./terminal-input-batcher", 
    new: "../terminal-input-batcher" 
  },
  { 
    old: "./terminal-ui-manager", 
    new: "../terminal-ui-manager" 
  },
  { 
    old: "./terminal-state-manager", 
    new: "./session/terminal-state-manager" 
  },
  
  // Terminal local-filesystem-executor path
  { 
    old: "../terminal/commands/local-filesystem-executor", 
    new: "./local-filesystem-executor" 
  },
];

async function fixFile(filePath) {
  let content = await readFile(filePath, 'utf8');
  let originalContent = content;
  let changesMade = false;

  for (const replacement of importReplacements) {
    const oldPaths = Array.isArray(replacement.old) ? replacement.old : [replacement.old];
    
    for (const oldPath of oldPaths) {
      // Match import statements - both single and double quotes
      const patterns = [
        new RegExp(`from ['"]${escapeRegex(oldPath)}['"]`, 'g'),
        new RegExp(`import ['"].*['"] from ['"]${escapeRegex(oldPath)}['"]`, 'g'),
        new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s*['"]${escapeRegex(oldPath)}['"]`, 'g'),
        new RegExp(`import\\s*\\*\\s*as\\s*\\w+\\s*from\\s*['"]${escapeRegex(oldPath)}['"]`, 'g'),
      ];

      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          content = content.replace(pattern, (match) => {
            return match.replace(oldPath, replacement.new);
          });
          changesMade = true;
        }
      }
    }
  }

  if (changesMade && content !== originalContent) {
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
  
  const files = await glob('{app,lib,components}/**/*.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/deprecated/**', '**/*.d.ts']
  });

  console.log(`Found ${files.length} files to check\n`);
  
  let fixedCount = 0;
  const errors = [];

  for (const file of files) {
    try {
      const changed = await fixFile(file);
      if (changed) {
        fixedCount++;
        const relativePath = file.replace(rootDir + '\\', '');
        console.log(`✓ ${relativePath}`);
      }
    } catch (error) {
      errors.push({ file, error: error.message });
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} files`);
  
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} errors:`);
    errors.forEach(({ file, error }) => {
      console.log(`  - ${file.replace(rootDir + '\\', '')}: ${error}`);
    });
  }
}

main().catch(console.error);
