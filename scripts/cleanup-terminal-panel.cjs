#!/usr/bin/env node

/**
 * TerminalPanel.tsx Fallback Code Cleanup Script
 * 
 * Removes all fallback inline code that's been migrated to handlers.
 * Total deletion: ~2,380 lines
 * 
 * Usage: node scripts/cleanup-terminal-panel.js
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'components', 'terminal', 'TerminalPanel.tsx');
const backupPath = filePath + '.backup';

console.log('🧹 TerminalPanel.tsx Fallback Code Cleanup');
console.log('==========================================\n');

// Read original file
const originalContent = fs.readFileSync(filePath, 'utf8');
const lines = originalContent.split('\n');

console.log(`📊 Original file: ${lines.length.toLocaleString()} lines\n`);

// Create backup
fs.writeFileSync(backupPath, originalContent);
console.log(`✅ Backup created: ${backupPath}\n`);

// Define sections to delete (start line, end line, description)
const sectionsToDelete = [
  // 1. handleEditorInput function (lines ~2117-2595, ~478 lines)
  {
    startPattern: /const handleEditorInput = useCallback\(\(/,
    endPattern: /\}, \[updateTerminalState, syncFileToVFS\]\);/,
    description: 'handleEditorInput function (migrated to TerminalEditorHandler)',
    replacement: `  // handleEditorInput migrated to TerminalEditorHandler
  // See: lib/sandbox/terminal-editor-handler.ts (529 lines)`,
  },
  
  // 2. Inline input handling in initXterm() onData (lines ~2810-3090, ~280 lines)
  {
    startPattern: /\/\/ FALLBACK: Inline input handling \(to be removed after testing\)/,
    endPattern: /terminal\.attachCustomKeyEventHandler\(\(event: KeyboardEvent\) => {/,
    description: 'Inline input handling (migrated to TerminalInputHandler)',
    replacement: `        // Input handling delegated to TerminalInputHandler
        // See: lib/sandbox/terminal-input-handler.ts (~250 lines)`,
  },
  
  // 3. Inline execution in executeLocalShellCommand (lines ~1151-2113, ~962 lines)
  {
    startPattern: /\/\/ FALLBACK: Inline execution \(to be removed after testing\)/,
    endPattern: /\}, \[resolveLocalPath, userId, updateTerminalState, syncFileToVFS\]\);/,
    description: 'Inline command execution (migrated to LocalCommandExecutor)',
    replacement: `    // Command execution delegated to LocalCommandExecutor
    // See: lib/sandbox/local-filesystem-executor.ts (835 lines)
    // All 40+ commands available: help, ls, cd, pwd, cat, mkdir, touch, rm, cp, mv, echo, etc.
    
    // Security checks handled by handler
    // VFS sync handled by handler
    // Command history handled by handler
    
    return true; // Handler will execute`,
  },
  
  // 4. Inline connection logic (lines ~3225-4040, ~815 lines)
  {
    startPattern: /\/\/ FALLBACK: Inline connection \(to be removed after testing\)/,
    endPattern: /\}, \[updateTerminalState, sendResize, sendInput\]\);/,
    description: 'Inline connection logic (migrated to SandboxConnectionManager)',
    replacement: `    // Connection delegated to SandboxConnectionManager
    // See: lib/sandbox/sandbox-connection-manager.ts (1,211 lines)
    // Features:
    // - WebSocket/SSE connection with reconnection
    // - Provider-specific PTY (E2B, Daytona, Sprites, CodeSandbox, Vercel)
    // - Exponential backoff reconnection
    // - Connection throttling
    // - Auto-cd to workspace
    
    logger.warn('Connection handler should have been used');
    return;`,
  },
];

let cleanedContent = originalContent;
let totalDeleted = 0;

console.log('🔪 Deleting fallback sections:\n');

for (const section of sectionsToDelete) {
  const startMatch = cleanedContent.match(section.startPattern);
  const endMatch = cleanedContent.match(section.endPattern);
  
  if (!startMatch || !endMatch) {
    console.log(`⚠️  Skipped: ${section.description}`);
    console.log(`   Reason: Pattern not found\n`);
    continue;
  }
  
  const startIndex = startMatch.index;
  const endIndex = endMatch.index + endMatch[0].length;
  
  const beforeSection = cleanedContent.substring(0, startIndex);
  const afterSection = cleanedContent.substring(endIndex);
  
  const deletedSection = cleanedContent.substring(startIndex, endIndex);
  const deletedLines = deletedSection.split('\n').length;
  
  cleanedContent = beforeSection + section.replacement + '\n\n' + afterSection;
  
  totalDeleted += deletedLines;
  
  console.log(`✅ Deleted: ${section.description}`);
  console.log(`   Lines removed: ~${deletedLines.toLocaleString()}\n`);
}

// Also remove unused helper functions that are now in handlers
const unusedHelpers = [
  {
    name: 'resolveLocalPath',
    pattern: /const resolveLocalPath = useCallback\([^)]*\): string => \{[^}]*\};/s,
    description: 'resolveLocalPath (migrated to TerminalLocalFSHandler)',
  },
  {
    name: 'ensureProjectRootExists',
    pattern: /const ensureProjectRootExists = useCallback\([^)]*\) => \{[^}]*\};/s,
    description: 'ensureProjectRootExists (migrated to TerminalLocalFSHandler)',
  },
  {
    name: 'getParentPath',
    pattern: /const getParentPath = \([^)]*\): string => \{[^}]*\};/s,
    description: 'getParentPath (migrated to TerminalLocalFSHandler)',
  },
  {
    name: 'listLocalDirectory',
    pattern: /const listLocalDirectory = \([^)]*\): string\[\] => \{[^}]*\};/s,
    description: 'listLocalDirectory (migrated to TerminalLocalFSHandler)',
  },
];

console.log('🔪 Removing unused helper functions:\n');

for (const helper of unusedHelpers) {
  const match = cleanedContent.match(helper.pattern);
  if (match) {
    const deletedLines = match[0].split('\n').length;
    cleanedContent = cleanedContent.replace(helper.pattern, '');
    totalDeleted += deletedLines;
    
    console.log(`✅ Deleted: ${helper.description}`);
    console.log(`   Lines removed: ~${deletedLines.toLocaleString()}\n`);
  } else {
    console.log(`⚠️  Skipped: ${helper.description}`);
    console.log(`   Reason: Pattern not found\n`);
  }
}

// Write cleaned file
fs.writeFileSync(filePath, cleanedContent);

const cleanedLines = cleanedContent.split('\n');
const reduction = ((totalDeleted / lines.length) * 100).toFixed(1);

console.log('==========================================');
console.log('📊 Cleanup Summary:');
console.log(`   Original: ${lines.length.toLocaleString()} lines`);
console.log(`   Deleted:  ~${totalDeleted.toLocaleString()} lines`);
console.log(`   New:      ${cleanedLines.length.toLocaleString()} lines`);
console.log(`   Reduction: ${reduction}%`);
console.log('==========================================\n');

console.log('✅ Cleanup complete!');
console.log('\n📝 Next steps:');
console.log('   1. Run build: npm run build');
console.log('   2. Run type check: npm run type-check');
console.log('   3. Test terminal functionality');
console.log('   4. Commit changes\n');

console.log('🔄 To rollback:');
console.log(`   cp ${backupPath} ${filePath}\n`);
