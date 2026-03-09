/**
 * Tests for Stateful Agent State Management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState, type AgentState, type VfsState } from '../state';

describe('Stateful Agent State', () => {
  describe('createInitialState', () => {
    it('should create state with default values', () => {
      const state = createInitialState();
      
      expect(state.sessionId).toBeDefined();
      expect(state.sandboxId).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.vfs).toEqual({});
      expect(state.transactionLog).toEqual([]);
      expect(state.currentPlan).toBeNull();
      expect(state.discoveryIntents).toEqual([]);
      expect(state.errors).toEqual([]);
      expect(state.retryCount).toBe(0);
      expect(state.status).toBe('idle');
      expect(state.pendingApproval).toBeNull();
    });

    it('should accept custom session ID', () => {
      const state = createInitialState({ sessionId: 'custom-session-123' });
      expect(state.sessionId).toBe('custom-session-123');
    });

    it('should accept custom sandbox ID', () => {
      const state = createInitialState({ sandboxId: 'sandbox-456' });
      expect(state.sandboxId).toBe('sandbox-456');
    });

    it('should accept custom initial messages', () => {
      const initialMessages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' }
      ];
      const state = createInitialState({ initialMessages });
      
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[1].role).toBe('assistant');
    });

    it('should generate random UUID for session if not provided', () => {
      const state1 = createInitialState();
      const state2 = createInitialState();
      
      expect(state1.sessionId).not.toBe(state2.sessionId);
    });
  });

  describe('AgentState transitions', () => {
    let state: AgentState;

    beforeEach(() => {
      state = createInitialState();
    });

    it('should track discovery phase', () => {
      state.status = 'discovering';
      expect(state.status).toBe('discovering');
    });

    it('should track planning phase', () => {
      state.status = 'planning';
      expect(state.status).toBe('planning');
    });

    it('should track editing phase', () => {
      state.status = 'editing';
      expect(state.status).toBe('editing');
    });

    it('should track verifying phase', () => {
      state.status = 'verifying';
      expect(state.status).toBe('verifying');
    });

    it('should track committing phase', () => {
      state.status = 'committing';
      expect(state.status).toBe('committing');
    });

    it('should track error state', () => {
      state.status = 'error';
      expect(state.status).toBe('error');
    });

    it('should track idle state', () => {
      state.status = 'idle';
      expect(state.status).toBe('idle');
    });

    it('should track VFS changes', () => {
      state.vfs['/test/file.ts'] = 'file content';
      expect(state.vfs['/test/file.ts']).toBe('file content');
      expect(Object.keys(state.vfs)).toHaveLength(1);
    });

    it('should track transaction log', () => {
      state.transactionLog.push({
        path: '/test/file.ts',
        type: 'CREATE',
        timestamp: new Date().toISOString(),
        newContent: 'content'
      });
      
      expect(state.transactionLog).toHaveLength(1);
      expect(state.transactionLog[0].type).toBe('CREATE');
    });

    it('should track errors', () => {
      state.errors.push({
        step: 1,
        path: '/test/file.ts',
        message: 'Syntax error',
        timestamp: Date.now()
      });
      
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].message).toBe('Syntax error');
    });

    it('should track retry count', () => {
      state.retryCount = 3;
      expect(state.retryCount).toBe(3);
    });

    it('should track pending approval', () => {
      state.pendingApproval = {
        id: 'req-123',
        action: 'delete',
        target: '/important/file.ts',
        reason: 'Cleanup',
        requested_at: new Date().toISOString(),
        status: 'pending'
      };
      
      expect(state.pendingApproval).not.toBeNull();
      expect(state.pendingApproval?.status).toBe('pending');
    });

    it('should track messages', () => {
      state.messages.push({ role: 'user', content: 'Fix this bug' });
      state.messages.push({ role: 'assistant', content: 'I will fix it' });
      
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].content).toBe('Fix this bug');
    });
  });

  describe('VfsState', () => {
    it('should store VFS as record of path to content', () => {
      const vfsState: VfsState = {
        vfs: {
          '/src/index.ts': 'console.log("hello")',
          '/src/utils.ts': 'export const add = (a, b) => a + b'
        },
        transactionLog: [],
        currentPlan: null,
        discoveryIntents: [],
        errors: [],
        retryCount: 0,
        status: 'idle',
        sandboxId: null,
        sessionId: 'test-session',
        pendingApproval: null
      };
      
      expect(Object.keys(vfsState.vfs)).toHaveLength(2);
      expect(vfsState.vfs['/src/index.ts']).toContain('hello');
    });

    it('should handle empty VFS', () => {
      const vfsState: VfsState = {
        vfs: {},
        transactionLog: [],
        currentPlan: null,
        discoveryIntents: [],
        errors: [],
        retryCount: 0,
        status: 'idle',
        sandboxId: null,
        sessionId: 'test-session',
        pendingApproval: null
      };
      
      expect(vfsState.vfs).toEqual({});
    });
  });
});
