/**
 * Tests for Stateful Agent Schemas
 */

import { describe, it, expect } from 'vitest';
import type {
  ModelRole,
  FileModificationIntent,
  PlanFile,
  PlanJSON,
  ApplyDiffInput,
  SyntaxError,
  VerificationResult,
  ApprovalRequest,
  TransactionLogEntry,
  AgentCheckpoint
} from '../schemas';

describe('Stateful Agent Schemas', () => {
  describe('ModelRole', () => {
    it('should allow valid roles', () => {
      const roles: ModelRole[] = ['architect', 'builder', 'linter'];
      expect(roles).toHaveLength(3);
    });
  });

  describe('FileModificationIntent', () => {
    it('should create a valid file modification intent', () => {
      const intent: FileModificationIntent = {
        file_path: '/test/file.ts',
        action: 'edit',
        reason: 'Fix a bug',
        dependencies: ['/test/dependency.ts'],
        risk_level: 'medium'
      };
      
      expect(intent.file_path).toBe('/test/file.ts');
      expect(intent.action).toBe('edit');
      expect(intent.risk_level).toBe('medium');
    });

    it('should allow all action types', () => {
      const actions: FileModificationIntent['action'][] = ['read', 'edit', 'create', 'delete'];
      actions.forEach(action => {
        const intent: FileModificationIntent = {
          file_path: '/test/file.ts',
          action,
          reason: 'Test',
          dependencies: [],
          risk_level: 'low'
        };
        expect(intent.action).toBe(action);
      });
    });

    it('should allow all risk levels', () => {
      const levels: FileModificationIntent['risk_level'][] = ['low', 'medium', 'high'];
      levels.forEach(level => {
        const intent: FileModificationIntent = {
          file_path: '/test/file.ts',
          action: 'edit',
          reason: 'Test',
          dependencies: [],
          risk_level: level
        };
        expect(intent.risk_level).toBe(level);
      });
    });
  });

  describe('PlanFile', () => {
    it('should create a valid plan file', () => {
      const planFile: PlanFile = {
        path: '/test/file.ts',
        action: 'edit',
        original_hash: 'abc123',
        new_hash: 'def456',
        diff_preview: '--- a/test\n+++ b/test',
        blocked_by: ['/test/blocked.ts'],
        reason: 'Update functionality'
      };
      
      expect(planFile.path).toBe('/test/file.ts');
      expect(planFile.action).toBe('edit');
      expect(planFile.blocked_by).toContain('/test/blocked.ts');
    });

    it('should allow optional new_hash for read operations', () => {
      const planFile: PlanFile = {
        path: '/test/file.ts',
        action: 'read',
        original_hash: 'abc123',
        diff_preview: 'file content here',
        reason: 'Testing read operation',
      };

      expect(planFile.new_hash).toBeUndefined();
    });
  });

  describe('PlanJSON', () => {
    it('should create a valid plan', () => {
      const plan: PlanJSON = {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        task: 'Fix the login bug',
        files: [
          {
            path: '/test/file.ts',
            action: 'edit',
            original_hash: 'abc123',
            diff_preview: 'changes',
            reason: 'Fixing bug',
          }
        ],
        execution_order: ['/test/file.ts'],
        rollback_plan: 'Revert changes'
      };
      
      expect(plan.version).toBe('1.0.0');
      expect(plan.files).toHaveLength(1);
      expect(plan.execution_order).toHaveLength(1);
    });

    it('should track multiple files in execution order', () => {
      const plan: PlanJSON = {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        task: 'Add feature',
        files: [
          { path: '/test/a.ts', action: 'create', original_hash: '', diff_preview: '', reason: 'Creating file A' },
          { path: '/test/b.ts', action: 'create', original_hash: '', diff_preview: '', reason: 'Creating file B' },
          { path: '/test/c.ts', action: 'create', original_hash: '', diff_preview: '', reason: 'Creating file C' }
        ],
        execution_order: ['/test/a.ts', '/test/b.ts', '/test/c.ts'],
        rollback_plan: 'Delete files',
      };

      expect(plan.execution_order).toEqual(['/test/a.ts', '/test/b.ts', '/test/c.ts']);
    });
  });

  describe('ApplyDiffInput', () => {
    it('should create a valid apply diff input', () => {
      const input: ApplyDiffInput = {
        path: '/test/file.ts',
        search: 'old code',
        replace: 'new code',
        thought: 'Replacing old code with new implementation',
        plan_ref: 'plan-123'
      };
      
      expect(input.path).toBe('/test/file.ts');
      expect(input.search).toBe('old code');
      expect(input.replace).toBe('new code');
      expect(input.plan_ref).toBe('plan-123');
    });

    it('should allow optional plan_ref', () => {
      const input: ApplyDiffInput = {
        path: '/test/file.ts',
        search: 'old code',
        replace: 'new code',
        thought: 'Quick fix'
      };
      
      expect(input.plan_ref).toBeUndefined();
    });
  });

  describe('SyntaxError', () => {
    it('should create a valid syntax error', () => {
      const error: SyntaxError = {
        path: '/test/file.ts',
        line: 42,
        column: 10,
        error: 'Unexpected token',
        severity: 'error'
      };
      
      expect(error.path).toBe('/test/file.ts');
      expect(error.line).toBe(42);
      expect(error.severity).toBe('error');
    });

    it('should allow all severity levels', () => {
      const severities: SyntaxError['severity'][] = ['error', 'warning', 'info'];
      severities.forEach(severity => {
        const error: SyntaxError = {
          path: '/test/file.ts',
          line: 1,
          error: 'Test',
          severity
        };
        expect(error.severity).toBe(severity);
      });
    });
  });

  describe('VerificationResult', () => {
    it('should create a passing verification result', () => {
      const result: VerificationResult = {
        passed: true,
        errors: [],
        warnings: []
      };
      
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should create a failing verification result with reprompt', () => {
      const result: VerificationResult = {
        passed: false,
        errors: [
          { path: '/test/file.ts', line: 10, error: 'Syntax error', severity: 'error' }
        ],
        warnings: [
          { path: '/test/file.ts', line: 5, error: 'Unused variable', severity: 'warning' }
        ],
        reprompt: 'Fix the syntax error and try again'
      };
      
      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.reprompt).toBeDefined();
    });
  });

  describe('ApprovalRequest', () => {
    it('should create a valid approval request', () => {
      const request: ApprovalRequest = {
        id: 'req-123',
        action: 'delete',
        target: '/test/important-file.ts',
        reason: 'Removing deprecated file',
        diff: '--- /test/file.ts\n+++ /dev/null',
        requested_at: new Date().toISOString(),
        status: 'pending'
      };
      
      expect(request.id).toBe('req-123');
      expect(request.action).toBe('delete');
      expect(request.status).toBe('pending');
    });

    it('should allow all action types', () => {
      const actions: ApprovalRequest['action'][] = ['delete', 'overwrite', 'execute_destructive', 'create_secret'];
      actions.forEach(action => {
        const request: ApprovalRequest = {
          id: 'req-1',
          action,
          target: '/test/file.ts',
          reason: 'Test',
          requested_at: new Date().toISOString(),
          status: 'pending'
        };
        expect(request.action).toBe(action);
      });
    });

    it('should track all status values', () => {
      const statuses: ApprovalRequest['status'][] = ['pending', 'approved', 'rejected'];
      statuses.forEach(status => {
        const request: ApprovalRequest = {
          id: 'req-1',
          action: 'delete',
          target: '/test/file.ts',
          reason: 'Test',
          requested_at: new Date().toISOString(),
          status
        };
        expect(request.status).toBe(status);
      });
    });
  });

  describe('TransactionLogEntry', () => {
    it('should create a valid transaction log entry', () => {
      const entry: TransactionLogEntry = {
        path: '/test/file.ts',
        type: 'UPDATE',
        timestamp: new Date().toISOString(),
        originalContent: 'old content',
        newContent: 'new content',
        search: 'old',
        replace: 'new'
      };
      
      expect(entry.path).toBe('/test/file.ts');
      expect(entry.type).toBe('UPDATE');
      expect(entry.originalContent).toBe('old content');
    });

    it('should allow all transaction types', () => {
      const types: TransactionLogEntry['type'][] = ['UPDATE', 'CREATE', 'DELETE'];
      types.forEach(type => {
        const entry: TransactionLogEntry = {
          path: '/test/file.ts',
          type,
          timestamp: new Date().toISOString()
        };
        expect(entry.type).toBe(type);
      });
    });
  });

  describe('AgentCheckpoint', () => {
    it('should create a valid checkpoint', () => {
      const checkpoint: AgentCheckpoint = {
        session_id: 'session-123',
        checkpoint_id: 'checkpoint-456',
        vfs_snapshot: {
          '/test/file.ts': 'file content'
        },
        transaction_log: [
          {
            path: '/test/file.ts',
            type: 'CREATE',
            timestamp: new Date().toISOString()
          }
        ],
        current_plan: null,
        errors: [],
        retry_count: 0,
        status: 'idle',
        created_at: new Date().toISOString(),
      };

      expect(checkpoint.session_id).toBe('session-123');
      expect(checkpoint.vfs_snapshot).toHaveProperty('/test/file.ts');
      expect(checkpoint.transaction_log).toHaveLength(1);
    });

    it('should include current plan in checkpoint', () => {
      const plan: PlanJSON = {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        task: 'Test',
        files: [],
        execution_order: [],
        rollback_plan: '',
      };

      const checkpoint: AgentCheckpoint = {
        session_id: 'session-123',
        checkpoint_id: 'checkpoint-456',
        vfs_snapshot: {},
        transaction_log: [],
        current_plan: plan,
        errors: [],
        retry_count: 0,
        status: 'idle',
        created_at: new Date().toISOString(),
      };

      expect(checkpoint.current_plan).not.toBeNull();
      expect(checkpoint.current_plan?.task).toBe('Test');
    });
  });
});
