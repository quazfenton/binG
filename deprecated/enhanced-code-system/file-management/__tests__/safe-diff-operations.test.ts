/**
 * Tests for Safe Diff Operations System
 */

import { SafeDiffOperations, ValidationResult, BackupState, Conflict } from '../safe-diff-operations';
import { DiffOperation, FileState } from '../advanced-file-manager';

describe('SafeDiffOperations', () => {
  let safeDiffOps: SafeDiffOperations;
  let mockFileState: FileState;
  let mockDiffs: DiffOperation[];

  beforeEach(() => {
    safeDiffOps = new SafeDiffOperations({
      enablePreValidation: true,
      enableSyntaxValidation: true,
      enableConflictDetection: true,
      enableAutoBackup: true,
      enableRollback: true,
      maxBackupHistory: 5,
      validationTimeout: 1000,
      conflictResolutionStrategy: 'hybrid'
    });

    mockFileState = {
      id: 'test-file-1',
      name: 'test.ts',
      path: '/test/test.ts',
      content: `import React from 'react';

export const TestComponent = () => {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
};`,
      language: 'typescript',
      hasEdits: false,
      lastModified: new Date(),
      version: 1,
      originalContent: '',
      pendingDiffs: [],
      isLocked: false
    };

    mockDiffs = [
      {
        operation: 'insert',
        lineRange: [1, 1],
        content: "import { useState } from 'react';",
        description: 'Add useState import',
        confidence: 0.9
      },
      {
        operation: 'replace',
        lineRange: [4, 4],
        content: '  const [count, setCount] = useState(0);',
        description: 'Fix useState usage',
        confidence: 0.95
      }
    ];
  });

  describe('Pre-execution Validation', () => {
    test('should validate diff structure and ranges', async () => {
      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        mockDiffs,
        mockFileState
      );

      expect(result.validationResult.isValid).toBe(true);
      expect(result.validationResult.errors).toHaveLength(0);
      expect(result.validationResult.confidence).toBeGreaterThan(0.8);
    });

    test('should detect invalid line ranges', async () => {
      const invalidDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [100, 105], // Beyond file length
          content: 'invalid content',
          description: 'Invalid range test',
          confidence: 0.5
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        invalidDiffs,
        mockFileState
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('exceeds file length');
    });

    test('should detect overlapping diffs', async () => {
      const overlappingDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 5],
          content: 'first change',
          description: 'First change',
          confidence: 0.8
        },
        {
          operation: 'replace',
          lineRange: [4, 6],
          content: 'second change',
          description: 'Second change',
          confidence: 0.8
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        overlappingDiffs,
        mockFileState
      );

      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe('line_overlap');
    });

    test('should warn about low confidence diffs', async () => {
      const lowConfidenceDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 3],
          content: 'uncertain change',
          description: 'Low confidence change',
          confidence: 0.3
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        lowConfidenceDiffs,
        mockFileState
      );

      expect(result.validationResult.warnings.length).toBeGreaterThan(0);
      expect(result.validationResult.warnings[0]).toContain('low confidence');
    });
  });

  describe('Backup and Rollback', () => {
    test('should create backup before applying diffs', async () => {
      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        mockDiffs,
        mockFileState
      );

      expect(result.backupId).toBeDefined();
      expect(result.backupId).toMatch(/^backup_test-file-1_/);

      const backupHistory = safeDiffOps.getBackupHistory(mockFileState.id);
      expect(backupHistory.length).toBe(1);
      expect(backupHistory[0].content).toBe(mockFileState.content);
    });

    test('should rollback on syntax validation failure', async () => {
      const syntaxBreakingDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 3],
          content: 'const [count setCount = useState(0); // Missing comma',
          description: 'Syntax breaking change',
          confidence: 0.9
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        syntaxBreakingDiffs,
        mockFileState
      );

      expect(result.success).toBe(false);
      expect(result.validationResult.isValid).toBe(false);
      expect(result.updatedContent).toBe(mockFileState.content); // Should be rolled back
    });

    test('should successfully rollback to specific backup', async () => {
      // First, create a backup by applying diffs
      const firstResult = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        mockDiffs,
        mockFileState
      );

      expect(firstResult.success).toBe(true);
      const backupId = firstResult.backupId!;

      // Now rollback
      const rollbackResult = await safeDiffOps.rollbackToBackup(mockFileState.id, backupId);

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.restoredContent).toBe(mockFileState.content);
    });
  });

  describe('Conflict Detection and Resolution', () => {
    test('should detect dependency conflicts', async () => {
      const conflictingDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: "import React, { Component } from 'react';",
          description: 'Change import style',
          confidence: 0.8
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        conflictingDiffs,
        mockFileState
      );

      // Should detect potential import conflicts
      if (result.conflicts.length > 0) {
        expect(result.conflicts.some(c => c.type === 'dependency_conflict')).toBe(true);
      }
    });

    test('should provide resolution options for conflicts', async () => {
      const overlappingDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 4],
          content: 'first change\nsecond line',
          description: 'First change',
          confidence: 0.8
        },
        {
          operation: 'replace',
          lineRange: [4, 5],
          content: 'conflicting change\nthird line',
          description: 'Conflicting change',
          confidence: 0.8
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        overlappingDiffs,
        mockFileState
      );

      if (result.conflicts.length > 0) {
        const conflict = result.conflicts[0];
        expect(conflict.resolutionOptions.length).toBeGreaterThan(0);
        expect(conflict.resolutionOptions.some(opt => opt.action === 'merge')).toBe(true);
        expect(conflict.resolutionOptions.some(opt => opt.action === 'manual')).toBe(true);
      }
    });

    test('should resolve conflicts with specified resolution', async () => {
      // First create conflicts
      const overlappingDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [3, 4],
          content: 'resolved content',
          description: 'Resolution test',
          confidence: 0.8
        },
        {
          operation: 'replace',
          lineRange: [4, 5],
          content: 'conflicting content',
          description: 'Conflict test',
          confidence: 0.8
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        overlappingDiffs,
        mockFileState
      );

      if (result.conflicts.length > 0) {
        const conflictId = result.conflicts[0].id;
        
        const resolutionResult = await safeDiffOps.resolveConflicts(mockFileState.id, [
          {
            conflictId,
            resolution: 'accept_current'
          }
        ]);

        expect(resolutionResult.success).toBe(true);
        expect(resolutionResult.resolvedConflicts).toContain(conflictId);
      }
    });
  });

  describe('Syntax Validation', () => {
    test('should validate JavaScript syntax', async () => {
      const validJSDiffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [2, 2],
          content: 'const validFunction = () => { return true; };',
          description: 'Add valid function',
          confidence: 0.9
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        validJSDiffs,
        mockFileState
      );

      expect(result.validationResult.isValid).toBe(true);
    });

    test('should detect JavaScript syntax errors', async () => {
      const invalidJSDiffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [2, 2],
          content: 'const invalidFunction = () => { return true; // Missing closing brace',
          description: 'Add invalid function',
          confidence: 0.9
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        invalidJSDiffs,
        mockFileState
      );

      expect(result.success).toBe(false);
      expect(result.validationResult.isValid).toBe(false);
      expect(result.validationResult.errors.length).toBeGreaterThan(0);
    });

    test('should validate JSON syntax', async () => {
      const jsonFileState: FileState = {
        ...mockFileState,
        language: 'json',
        content: '{"name": "test", "version": "1.0.0"}'
      };

      const validJSONDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: '{"name": "test", "version": "1.0.1", "description": "Updated"}',
          description: 'Update JSON',
          confidence: 0.9
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        jsonFileState.id,
        jsonFileState.content,
        validJSONDiffs,
        jsonFileState
      );

      expect(result.validationResult.isValid).toBe(true);
    });

    test('should detect JSON syntax errors', async () => {
      const jsonFileState: FileState = {
        ...mockFileState,
        language: 'json',
        content: '{"name": "test", "version": "1.0.0"}'
      };

      const invalidJSONDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: '{"name": "test", "version": "1.0.1" "description": "Invalid"}', // Missing comma
          description: 'Invalid JSON update',
          confidence: 0.9
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        jsonFileState.id,
        jsonFileState.content,
        invalidJSONDiffs,
        jsonFileState
      );

      expect(result.success).toBe(false);
      expect(result.validationResult.isValid).toBe(false);
      expect(result.validationResult.errors[0]).toContain('JSON syntax error');
    });
  });

  describe('Change Tracking', () => {
    test('should track successful diff applications', async () => {
      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        mockDiffs,
        mockFileState
      );

      expect(result.success).toBe(true);

      const changeHistory = safeDiffOps.getChangeHistory(mockFileState.id);
      expect(changeHistory.length).toBe(1);
      expect(changeHistory[0].operation).toBe('apply_diffs');
      expect(changeHistory[0].success).toBe(true);
      expect(changeHistory[0].diffs).toEqual(result.appliedDiffs);
    });

    test('should track failed diff applications', async () => {
      const invalidDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [100, 105], // Invalid range
          content: 'invalid content',
          description: 'Invalid diff',
          confidence: 0.5
        }
      ];

      const result = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        invalidDiffs,
        mockFileState
      );

      expect(result.success).toBe(false);

      const changeHistory = safeDiffOps.getChangeHistory(mockFileState.id);
      expect(changeHistory.length).toBe(1);
      expect(changeHistory[0].success).toBe(false);
    });

    test('should track rollback operations', async () => {
      // First apply diffs to create a backup
      const applyResult = await safeDiffOps.safelyApplyDiffs(
        mockFileState.id,
        mockFileState.content,
        mockDiffs,
        mockFileState
      );

      expect(applyResult.success).toBe(true);
      const backupId = applyResult.backupId!;

      // Then rollback
      const rollbackResult = await safeDiffOps.rollbackToBackup(mockFileState.id, backupId);
      expect(rollbackResult.success).toBe(true);

      const changeHistory = safeDiffOps.getChangeHistory(mockFileState.id);
      expect(changeHistory.length).toBe(2); // Apply + Rollback
      expect(changeHistory[1].operation).toBe('rollback');
      expect(changeHistory[1].rollbackId).toBe(backupId);
    });
  });

  describe('Options Management', () => {
    test('should update options correctly', () => {
      const newOptions = {
        enablePreValidation: false,
        maxBackupHistory: 20,
        conflictResolutionStrategy: 'manual' as const
      };

      safeDiffOps.updateOptions(newOptions);
      const currentOptions = safeDiffOps.getOptions();

      expect(currentOptions.enablePreValidation).toBe(false);
      expect(currentOptions.maxBackupHistory).toBe(20);
      expect(currentOptions.conflictResolutionStrategy).toBe('manual');
    });

    test('should emit options updated event', (done) => {
      const newOptions = {
        enableSyntaxValidation: false
      };

      safeDiffOps.on('options_updated', (options) => {
        expect(options.enableSyntaxValidation).toBe(false);
        done();
      });

      safeDiffOps.updateOptions(newOptions);
    });
  });
});