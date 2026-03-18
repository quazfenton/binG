#!/usr/bin/env node

/**
 * TerminalPanel.tsx Final Cleanup Fix
 * 
 * Fixes remaining issues after initial cleanup:
 * - Remove orphaned resolveLocalPath function
 * - Remove orphaned listLocalDirectory function  
 * - Remove orphaned ensureProjectRootExists fragment
 * - Fix executeLocalShellCommand to properly return when handler exists
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'components', 'terminal', 'TerminalPanel.tsx');

console.log('🔧 TerminalPanel.tsx Final Cleanup Fix\n');

let content = fs.readFileSync(filePath, 'utf8');
const originalLines = content.split('\n').length;

// 1. Remove resolveLocalPath function (orphaned after cleanup)
const resolveLocalPathPattern = /const resolveLocalPath = useCallback\([^)]*\): string => \{[\s\S]*?\}, \[\]\);/;
if (resolveLocalPathPattern.test(content)) {
  content = content.replace(resolveLocalPathPattern, '// resolveLocalPath migrated to TerminalLocalFSHandler');
  console.log('✅ Removed orphaned resolveLocalPath function');
} else {
  console.log('⚠️  resolveLocalPath not found (already removed)');
}

// 2. Remove orphaned ensureProjectRootExists fragment
const orphanedEnsurePattern = /\n\s*\n\s*\}\n\s*\/\/ Also ensure scope path directory exists[\s\S]*?\}, \[\]\);/;
if (orphanedEnsurePattern.test(content)) {
  content = content.replace(orphanedEnsurePattern, '\n\n  // ensureProjectRootExists migrated to TerminalLocalFSHandler');
  console.log('✅ Removed orphaned ensureProjectRootExists fragment');
} else {
  console.log('⚠️  ensureProjectRootExists fragment not found (already removed)');
}

// 3. Remove listLocalDirectory and getParentPath functions
const listLocalDirPattern = /const listLocalDirectory = \(path: string\): string\[\] => \{[\s\S]*?\};/;
if (listLocalDirPattern.test(content)) {
  content = content.replace(listLocalDirPattern, '// listLocalDirectory migrated to TerminalLocalFSHandler');
  console.log('✅ Removed orphaned listLocalDirectory function');
} else {
  console.log('⚠️  listLocalDirectory not found (already removed)');
}

const getParentPathPattern = /const getParentPath = \(path: string\): string => \{[\s\S]*?\};/;
if (getParentPathPattern.test(content)) {
  content = content.replace(getParentPathPattern, '// getParentPath migrated to TerminalLocalFSHandler');
  console.log('✅ Removed orphaned getParentPath function');
}

// 4. Fix executeLocalShellCommand - add proper return after handler check
const executeLocalShellCommandPattern = /(const executeLocalShellCommand = useCallback\([^)]*\): Promise<boolean> => \{[\s\S]*?if \(handlers\) \{[\s\S]*?return handlers\.localFS\.executeCommand\(command, \{[\s\S]*?\}\);[\s\S]*?\})\n\n\s*\/\/ Command execution delegated to/;

if (executeLocalShellCommandPattern.test(content)) {
  content = content.replace(
    executeLocalShellCommandPattern,
    `$1\n\n    // Fallback should never be reached - handler always exists\n    logger.warn('Handler not found for terminal', { terminalId });\n    return true;`
  );
  console.log('✅ Fixed executeLocalShellCommand return logic');
}

// Write fixed file
fs.writeFileSync(filePath, content);

const newLines = content.split('\n').length;
const deleted = originalLines - newLines;

console.log('\n==========================================');
console.log('📊 Final Cleanup Fix Summary:');
console.log(`   Before: ${originalLines.toLocaleString()} lines`);
console.log(`   Deleted: ${deleted.toLocaleString()} lines`);
console.log(`   After: ${newLines.toLocaleString()} lines`);
console.log('==========================================\n');

console.log('✅ Final cleanup fix complete!');
console.log('\n📝 Next steps:');
console.log('   1. Review changes: git diff components/terminal/TerminalPanel.tsx');
console.log('   2. Run build: npm run build');
console.log('   3. Run type check: npm run type-check');
console.log('   4. Test terminal functionality\n');
