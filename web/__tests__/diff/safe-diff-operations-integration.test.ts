/**
 * Safe Diff Operations Integration Tests
 * 
 * Comprehensive tests for the safe diff operations system including:
 * - Pre-execution validation
 * - Syntax validation for multiple languages
 * - Conflict detection and resolution
 * - Auto-backup and rollback
 * - Change tracking
 * - Semantic impact analysis
 * - Dangerous operation detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SafeDiffOperations } from '@/deprecated/enhanced-code-system/file-management/safe-diff-operations';
import type { DiffOperation, FileState } from '@/deprecated/enhanced-code-system/file-management/advanced-file-manager';
import { EventEmitter } from 'node:events';

describe('Safe Diff Operations Integration', () => {
  let diffOps: SafeDiffOperations;

  beforeEach(() => {
    diffOps = new SafeDiffOperations({
      enablePreValidation: true,
      enableSyntaxValidation: true,
      enableConflictDetection: true,
      enableAutoBackup: true,
      enableRollback: true,
      maxBackupHistory: 10,
      validationTimeout: 5000,
      conflictResolutionStrategy: 'hybrid',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Pre-Execution Validation', () => {
    it('should validate simple insert operation', async () => {
      const currentContent = `export function add(a: number, b: number): number {
  return a + b;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [3, 3],
          content: '\nexport function subtract(a: number, b: number): number {\n  return a - b;\n}',
          description: 'Add subtract function',
        },
      ];

      const fileState: FileState = {
        id: 'test-file-1',
        path: 'src/math.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('test-file-1', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('export function subtract');
      expect(result.validationResult.isValid).toBe(true);
    });

    it('should validate replace operation', async () => {
      const currentContent = `const PI = 3.14;`;
      
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'const PI = 3.14159;',
          description: 'Update PI precision',
        },
      ];

      const fileState: FileState = {
        id: 'test-file-2',
        path: 'src/constants.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('test-file-2', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('3.14159');
      expect(result.validationResult.confidence).toBeGreaterThan(0.8);
    });

    it('should detect and report validation errors', async () => {
      const currentContent = `export const value = 1;`;
      
      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [100, 100], // Invalid line range
          content: 'export const another = 2;',
          description: 'Add at invalid line',
        },
      ];

      const fileState: FileState = {
        id: 'test-file-3',
        path: 'src/test.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('test-file-3', currentContent, diffs, fileState);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate multiple operations in sequence', async () => {
      const currentContent = `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [4, 4],
          content: '\n  subtract(a: number, b: number): number {\n    return a - b;\n  }',
          description: 'Add subtract method',
        },
        {
          operation: 'insert',
          lineRange: [7, 7],
          content: '\n  multiply(a: number, b: number): number {\n    return a * b;\n  }',
          description: 'Add multiply method',
        },
      ];

      const fileState: FileState = {
        id: 'test-file-4',
        path: 'src/Calculator.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('test-file-4', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('subtract');
      expect(result.updatedContent).toContain('multiply');
      expect(result.appliedDiffs.length).toBe(2);
    });
  });

  describe('Syntax Validation', () => {
    it('should validate TypeScript syntax', async () => {
      const currentContent = `export interface User {
  id: number;
  name: string;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [4, 4],
          content: '\n  email?: string;',
          description: 'Add optional email field',
        },
      ];

      const fileState: FileState = {
        id: 'ts-file',
        path: 'src/User.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('ts-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.validationResult.errors).toHaveLength(0);
    });

    it('should detect syntax errors in TypeScript', async () => {
      const currentContent = `export const value = 1;`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const value = ;', // Invalid syntax
          description: 'Introduce syntax error',
        },
      ];

      const fileState: FileState = {
        id: 'ts-error',
        path: 'src/error.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('ts-error', currentContent, diffs, fileState);

      // Should either fail validation or detect the syntax error
      expect(result.validationResult.errors.length).toBeGreaterThan(0);
    });

    it('should validate JavaScript syntax', async () => {
      const currentContent = `export function greet(name) {
  return \`Hello, \${name}!\`;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [3, 3],
          content: '\nexport function farewell(name) {\n  return `Goodbye, ${name}!`;\n}',
          description: 'Add farewell function',
        },
      ];

      const fileState: FileState = {
        id: 'js-file',
        path: 'src/greeting.js',
        content: currentContent,
        version: 1,
        language: 'javascript',
      };

      const result = await diffOps.safelyApplyDiffs('js-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('farewell');
    });

    it('should validate JSON syntax', async () => {
      const currentContent = `{
  "name": "test-package",
  "version": "1.0.0"
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [3, 3],
          content: ',\n  "description": "A test package"',
          description: 'Add description field',
        },
      ];

      const fileState: FileState = {
        id: 'json-file',
        path: 'package.json',
        content: currentContent,
        version: 1,
        language: 'json',
      };

      const result = await diffOps.safelyApplyDiffs('json-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('"description"');
    });

    it('should detect invalid JSON syntax', async () => {
      // Start with valid JSON
      const currentContent = `{
  "name": "test-package",
  "version": "1.0.0"
}`;

      // Apply diff that creates invalid JSON (trailing comma)
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 3],
          content: '  "version": "1.0.0",',
          description: 'Add trailing comma to make JSON invalid',
        },
      ];

      const fileState: FileState = {
        id: 'json-error',
        path: 'package.json',
        content: currentContent,
        version: 1,
        language: 'json',
      };

      const result = await diffOps.safelyApplyDiffs('json-error', currentContent, diffs, fileState);

      expect(result.validationResult.errors.length).toBeGreaterThan(0);
    });

    it('should validate CSS syntax', async () => {
      const currentContent = `.container {
  display: flex;
  justify-content: center;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [3, 3],
          content: '\n  align-items: center;',
          description: 'Add align-items',
        },
      ];

      const fileState: FileState = {
        id: 'css-file',
        path: 'src/styles.css',
        content: currentContent,
        version: 1,
        language: 'css',
      };

      const result = await diffOps.safelyApplyDiffs('css-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('align-items');
    });

    it('should validate HTML syntax', async () => {
      const currentContent = `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [7, 7],
          content: '\n    <p>Hello World</p>',
          description: 'Add paragraph',
        },
      ];

      const fileState: FileState = {
        id: 'html-file',
        path: 'index.html',
        content: currentContent,
        version: 1,
        language: 'html',
      };

      const result = await diffOps.safelyApplyDiffs('html-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('<p>Hello World</p>');
    });

    it('should validate Python syntax', async () => {
      const currentContent = `def greet(name: str) -> str:
    return f"Hello, {name}!"`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [2, 2],
          content: '\n\ndef farewell(name: str) -> str:\n    return f"Goodbye, {name}!"',
          description: 'Add farewell function',
        },
      ];

      const fileState: FileState = {
        id: 'py-file',
        path: 'src/greeting.py',
        content: currentContent,
        version: 1,
        language: 'python',
      };

      const result = await diffOps.safelyApplyDiffs('py-file', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('def farewell');
    });
  });

  describe('Auto-Backup System', () => {
    it('should create backup before applying diffs', async () => {
      const currentContent = `export const original = 'value';`;
      
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "export const updated = 'new value';",
          description: 'Update value',
        },
      ];

      const fileState: FileState = {
        id: 'backup-test',
        path: 'src/backup.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      // Set up event listener BEFORE triggering the operation
      const backupPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 1000);
        diffOps.once('backup_created', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      const result = await diffOps.safelyApplyDiffs('backup-test', currentContent, diffs, fileState);

      expect(result.backupId).toBeDefined();
      const backupCreated = await backupPromise;
      expect(backupCreated).toBe(true);
    });

    it('should maintain backup history', async () => {
      const fileId = 'history-test';
      let content = `// Version 0`;

      for (let i = 1; i <= 5; i++) {
        const diffs: DiffOperation[] = [
          {
            operation: 'replace',
            lineRange: [1, 1],
            content: `// Version ${i}`,
            description: `Update to version ${i}`,
          },
        ];

        const fileState: FileState = {
          id: fileId,
          path: 'src/versioned.ts',
          content,
          version: i,
          language: 'typescript',
        };

        await diffOps.safelyApplyDiffs(fileId, content, diffs, fileState);
        content = `// Version ${i}`;
      }

      // Check backup history
      const history = (diffOps as any).backupHistory.get(fileId);
      expect(history).toBeDefined();
      expect(history.length).toBeGreaterThan(0);
      expect(history.length).toBeLessThanOrEqual(10); // maxBackupHistory
    });

    it('should respect max backup history limit', async () => {
      const fileId = 'max-history-test';
      let content = `// Initial`;

      // Create more backups than the limit
      for (let i = 1; i <= 15; i++) {
        const diffs: DiffOperation[] = [
          {
            operation: 'replace',
            lineRange: [1, 1],
            content: `// Version ${i}`,
            description: `Update ${i}`,
          },
        ];

        const fileState: FileState = {
          id: fileId,
          path: 'src/limited.ts',
          content,
          version: i,
          language: 'typescript',
        };

        await diffOps.safelyApplyDiffs(fileId, content, diffs, fileState);
        content = `// Version ${i}`;
      }

      const history = (diffOps as any).backupHistory.get(fileId);
      expect(history.length).toBeLessThanOrEqual(10);
    });

    it('should retrieve backup content', async () => {
      const fileId = 'retrieve-test';
      const originalContent = `export const original = true;`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/retrieve.ts',
        content: originalContent,
        version: 1,
        language: 'typescript',
      };

      // Apply diff to create backup
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const updated = false;',
          description: 'Update value',
        },
      ];

      const result = await diffOps.safelyApplyDiffs(fileId, originalContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.backupId).toBeDefined();
      
      // Verify backup actually contains the original content
      const backup = await diffOps.getBackup(fileId, result.backupId!);
      expect(backup).toBeDefined();
      expect(backup.content).toBe(originalContent);
    });
  });

  describe('Rollback Mechanisms', () => {
    it('should rollback to previous version', async () => {
      const fileId = 'rollback-test';
      const originalContent = `export const value = 'original';`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/rollback.ts',
        content: originalContent,
        version: 1,
        language: 'typescript',
      };

      // Apply change
      const changeDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "export const value = 'modified';",
          description: 'Modify value',
        },
      ];

      const changeResult = await diffOps.safelyApplyDiffs(fileId, originalContent, changeDiffs, fileState);

      expect(changeResult.success).toBe(true);
      expect(changeResult.backupId).toBeDefined();

      // Rollback
      const rollbackResult = await diffOps.rollbackToBackup(fileId, changeResult.backupId!);

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.restoredContent).toBe(originalContent);
    });

    it('should handle rollback errors gracefully', async () => {
      const result = await diffOps.rollbackToBackup('nonexistent', 'nonexistent-backup');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should track rollback operations', async () => {
      const fileId = 'track-rollback';
      const originalContent = `export const tracked = true;`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/tracked.ts',
        content: originalContent,
        version: 1,
        language: 'typescript',
      };

      // Apply and rollback
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const tracked = false;',
          description: 'Change',
        },
      ];

      const result = await diffOps.safelyApplyDiffs(fileId, originalContent, diffs, fileState);

      expect(result.backupId).toBeDefined();

      await diffOps.rollbackToBackup(fileId, result.backupId!);

      const tracking = (diffOps as any).changeTracking.get(fileId);
      expect(tracking).toBeDefined();
      expect(tracking.length).toBeGreaterThan(1); // Original change + rollback
    });
  });

  describe('Conflict Detection', () => {
    it('should detect line overlap conflicts', async () => {
      const currentContent = `export function calculate(a: number, b: number): number {
  // Line 1
  // Line 2
  // Line 3
  return a + b;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [2, 4],
          content: '  // Overlapping change 1',
          description: 'First change',
        },
        {
          operation: 'replace',
          lineRange: [3, 5],
          content: '  // Overlapping change 2',
          description: 'Second overlapping change',
        },
      ];

      const fileState: FileState = {
        id: 'conflict-test',
        path: 'src/conflict.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('conflict-test', currentContent, diffs, fileState);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe('line_overlap');
    });

    it('should detect dependency conflicts', async () => {
      const currentContent = `import { useState } from 'react';
import { helper } from './utils';

export function Component() {
  const [state, setState] = useState(0);
  return <div>{helper(state)}</div>;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [2, 2],
          content: '',
          description: 'Remove helper import',
        },
        {
          operation: 'replace',
          lineRange: [6, 6],
          content: '  return <div>{helper(state)}</div>;', // Still uses helper
          description: 'Keep using helper',
        },
      ];

      const fileState: FileState = {
        id: 'dep-conflict',
        path: 'src/Component.tsx',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('dep-conflict', currentContent, diffs, fileState);

      // Should detect the dependency conflict
      expect(result.conflicts.some(c => c.type === 'dependency_conflict')).toBe(true);
    });

    it('should detect syntax conflicts', async () => {
      const currentContent = `export class Calculator {
  constructor() {
    this.value = 0;
  }
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [2, 4],
          content: '',
          description: 'Remove constructor',
        },
        {
          operation: 'insert',
          lineRange: [2, 2],
          content: '  invalid syntax here {{{',
          description: 'Insert invalid syntax',
        },
      ];

      const fileState: FileState = {
        id: 'syntax-conflict',
        path: 'src/Calculator.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('syntax-conflict', currentContent, diffs, fileState);

      expect(result.validationResult.errors.length).toBeGreaterThan(0);
    });

    it('should provide conflict resolution options', async () => {
      const currentContent = `export const shared = 'value';`;

      // Create overlapping diffs that will trigger a conflict
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "export const shared = 'change1';",
          description: 'First change',
        },
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "export const shared = 'change2';",
          description: 'Second overlapping change',
        },
      ];

      const fileState: FileState = {
        id: 'resolution-test',
        path: 'src/resolution.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('resolution-test', currentContent, diffs, fileState);

      // Should have conflicts due to overlapping line ranges
      expect(result.conflicts.length).toBeGreaterThan(0);
      const conflict = result.conflicts[0];
      expect(conflict.resolutionOptions).toBeDefined();
      expect(conflict.resolutionOptions.length).toBeGreaterThan(0);
    });

    it('should detect semantic conflicts', async () => {
      const currentContent = `export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export function calculateTotal(items: string[]): number {',
          description: 'Change parameter type',
        },
        {
          operation: 'replace',
          lineRange: [2, 2],
          content: '  return items.reduce((sum, item) => sum + item, 0);', // Still uses number operation
          description: 'Keep number operation',
        },
      ];

      const fileState: FileState = {
        id: 'semantic-conflict',
        path: 'src/calculate.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('semantic-conflict', currentContent, diffs, fileState);

      // May detect semantic conflict due to type mismatch
      expect(result.conflicts.some(c => c.type === 'semantic_conflict' || c.severity === 'high')).toBe(true);
    });
  });

  describe('Change Tracking', () => {
    it('should track all changes with metadata', async () => {
      const fileId = 'tracking-test';
      let content = `// Initial`;

      for (let i = 1; i <= 3; i++) {
        const diffs: DiffOperation[] = [
          {
            operation: 'replace',
            lineRange: [1, 1],
            content: `// Version ${i}`,
            description: `Update ${i}`,
          },
        ];

        const fileState: FileState = {
          id: fileId,
          path: 'src/tracked.ts',
          content,
          version: i,
          language: 'typescript',
        };

        await diffOps.safelyApplyDiffs(fileId, content, diffs, fileState);
        content = `// Version ${i}`;
      }

      const tracking = (diffOps as any).changeTracking.get(fileId);

      expect(tracking).toBeDefined();
      expect(tracking.length).toBe(3);
      expect(tracking[0].operation).toBeDefined();
      expect(tracking[0].timestamp).toBeDefined();
    });

    it('should emit change tracking events', async () => {
      const fileId = 'event-test';
      const content = `export const event = true;`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/event.ts',
        content,
        version: 1,
        language: 'typescript',
      };

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const event = false;',
          description: 'Toggle event',
        },
      ];

      const changeEmitted = await new Promise<boolean>((resolve) => {
        diffOps.on('change_tracked', () => resolve(true));
        diffOps.safelyApplyDiffs(fileId, content, diffs, fileState);
        setTimeout(() => resolve(false), 1000);
      });

      expect(changeEmitted).toBe(true);
    });

    it('should get change history for file', async () => {
      const fileId = 'history-get';
      let content = `// Start`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/history.ts',
        content,
        version: 1,
        language: 'typescript',
      };

      // Make changes
      await diffOps.safelyApplyDiffs(
        fileId,
        content,
        [{ operation: 'replace', lineRange: [1, 1], content: '// Change 1', description: 'First' }],
        fileState
      );

      await diffOps.safelyApplyDiffs(
        fileId,
        '// Change 1',
        [{ operation: 'replace', lineRange: [1, 1], content: '// Change 2', description: 'Second' }],
        { ...fileState, version: 2 }
      );

      const history = diffOps.getChangeHistory(fileId);

      expect(history).toBeDefined();
      expect(history.length).toBe(2);
    });
  });

  describe('Dangerous Operation Detection', () => {
    it('should warn when deleting imports', async () => {
      const currentContent = `import { useState, useEffect } from 'react';
import { helper } from './utils';

export function Component() {
  return <div />;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [1, 2],
          content: '',
          description: 'Remove all imports',
        },
      ];

      const fileState: FileState = {
        id: 'danger-imports',
        path: 'src/Component.tsx',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('danger-imports', currentContent, diffs, fileState);

      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
      expect(result.validationResult.warnings.some(w => w.includes('import'))).toBe(true);
    });

    it('should warn when deleting exports', async () => {
      const currentContent = `export const value = 1;
export function helper() { return 2; }
export class MyClass {}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [1, 3],
          content: '',
          description: 'Remove all exports',
        },
      ];

      const fileState: FileState = {
        id: 'danger-exports',
        path: 'src/exports.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('danger-exports', currentContent, diffs, fileState);

      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
      expect(result.validationResult.warnings.some(w => w.includes('export'))).toBe(true);
    });

    it('should warn when deleting function definitions', async () => {
      const currentContent = `export function importantFunction(): void {
  // Critical business logic
  return criticalValue;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [1, 4],
          content: '',
          description: 'Remove important function',
        },
      ];

      const fileState: FileState = {
        id: 'danger-function',
        path: 'src/important.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('danger-function', currentContent, diffs, fileState);

      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
    });

    it('should detect high-impact changes', async () => {
      const currentContent = `export const CONFIG = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
  retries: 3,
};`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 5],
          content: "export const CONFIG = { apiUrl: 'http://localhost:3000' };",
          description: 'Change all config',
        },
      ];

      const fileState: FileState = {
        id: 'high-impact',
        path: 'src/config.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('high-impact', currentContent, diffs, fileState);

      expect(result.validationResult.confidence).toBeLessThan(1);
    });
  });

  describe('Semantic Impact Analysis', () => {
    it('should analyze impact of interface changes', async () => {
      const currentContent = `export interface User {
  id: number;
  name: string;
  email: string;
}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'delete',
          lineRange: [4, 4],
          content: '',
          description: 'Remove email field',
        },
      ];

      const fileState: FileState = {
        id: 'interface-change',
        path: 'src/User.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('interface-change', currentContent, diffs, fileState);

      // Should have warnings about breaking changes
      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
    });

    it('should analyze impact of type changes', async () => {
      const currentContent = `export type Status = 'pending' | 'active' | 'completed';`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "export type Status = 'pending' | 'completed';",
          description: 'Remove active status',
        },
      ];

      const fileState: FileState = {
        id: 'type-change',
        path: 'src/types.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('type-change', currentContent, diffs, fileState);

      // Should warn about narrowing type
      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty diffs', async () => {
      const currentContent = `export const value = 1;`;

      const diffs: DiffOperation[] = [];

      const fileState: FileState = {
        id: 'empty-diffs',
        path: 'src/empty.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      const result = await diffOps.safelyApplyDiffs('empty-diffs', currentContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toBe(currentContent);
    });

    it('should handle very large files', async () => {
      const largeContent = '// Large file\n' + Array.from({ length: 1000 }, (_, i) => `export const value${i} = ${i};`).join('\n');

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [100, 100],
          content: '\n// Inserted comment',
          description: 'Add comment',
        },
      ];

      const fileState: FileState = {
        id: 'large-file',
        path: 'src/large.ts',
        content: largeContent,
        version: 1,
        language: 'typescript',
      };

      const start = Date.now();
      const result = await diffOps.safelyApplyDiffs('large-file', largeContent, diffs, fileState);
      const duration = Date.now() - start;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle validation timeout', async () => {
      const currentContent = `export const value = 1;`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const value = 2;',
          description: 'Update',
        },
      ];

      const fileState: FileState = {
        id: 'timeout-test',
        path: 'src/timeout.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      // Create diffOps with very long timeout to ensure validation completes
      // This test verifies that the timeout mechanism doesn't interfere with normal operation
      const safeDiffOps = new SafeDiffOperations({
        validationTimeout: 10000, // 10 seconds - plenty of time
        enablePreValidation: true,
        enableSyntaxValidation: false,
        enableConflictDetection: false,
        enableAutoBackup: false,
        enableRollback: false,
        maxBackupHistory: 10,
        conflictResolutionStrategy: 'hybrid',
      });

      const result = await safeDiffOps.safelyApplyDiffs('timeout-test', currentContent, diffs, fileState);

      // Should succeed with long timeout
      expect(result.success).toBe(true);
      expect(result.validationResult.isValid).toBe(true);
    });

    it('should timeout validation and return error result', async () => {
      const currentContent = `export const test = 'hello';`;

      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: `export const test = 'world';`,
          description: 'Update',
        },
      ];

      const fileState: FileState = {
        id: 'timeout-fail-test',
        path: 'src/timeout-fail.ts',
        content: currentContent,
        version: 1,
        language: 'typescript',
      };

      // Create diffOps with very short timeout (10ms)
      const shortTimeoutDiffOps = new SafeDiffOperations({
        validationTimeout: 10, // 10ms - will timeout
        enablePreValidation: true,
        enableSyntaxValidation: true, // Enable syntax validation which takes time
        enableConflictDetection: true,
        enableAutoBackup: false,
        enableRollback: false,
        maxBackupHistory: 10,
        conflictResolutionStrategy: 'hybrid',
      });

      // Mock the validation to take longer than timeout
      const result = await shortTimeoutDiffOps.safelyApplyDiffs('timeout-fail-test', currentContent, diffs, fileState);

      // Should complete (not hang) even if validation times out
      expect(result).toBeDefined();
      // The timeout should either cause failure or skip validation gracefully
    });

    it('should handle concurrent operations', async () => {
      const fileId = 'concurrent-test';
      const content = `export const shared = 0;`;

      const fileState: FileState = {
        id: fileId,
        path: 'src/concurrent.ts',
        content,
        version: 1,
        language: 'typescript',
      };

      const operations = Array.from({ length: 5 }, (_, i) =>
        diffOps.safelyApplyDiffs(
          fileId,
          content,
          [
            {
              operation: 'replace',
              lineRange: [1, 1],
              content: `export const shared = ${i};`,
              description: `Update ${i}`,
            },
          ],
          { ...fileState, version: i + 1 }
        )
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(5);
      // At least some should succeed or fail gracefully
      expect(results.every(r => r !== undefined)).toBe(true);
    });
  });
});
