/**
 * Action Registry Unit Tests
 *
 * Tests the pluggable handler registry system:
 * - Provider registration and lookup
 * - Action validation
 * - Execution envelope normalization
 * - Audit logging integration
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the audit module before importing action-registry
vi.mock('@/lib/integrations/execution-audit', () => ({
  recordAudit: vi.fn(),
  hashParams: vi.fn((p) => JSON.stringify(p)),
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { actionRegistry, ExecutionResult, HandlerContext } from './action-registry';

describe('ActionRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    (actionRegistry as any).providers.clear();
  });

  describe('registerProvider', () => {
    it('registers a provider with actions', () => {
      actionRegistry.registerProvider('test-provider', async () => ({ success: true }), ['action-a', 'action-b']);
      expect(actionRegistry.hasProvider('test-provider')).toBe(true);
      expect(actionRegistry.supportsAction('test-provider', 'action-a')).toBe(true);
      expect(actionRegistry.supportsAction('test-provider', 'action-b')).toBe(true);
    });

    it('normalizes provider and action names to lowercase', () => {
      actionRegistry.registerProvider('GitHub', async () => ({ success: true }), ['List_Repos', 'Create_PR']);
      expect(actionRegistry.hasProvider('github')).toBe(true);
      expect(actionRegistry.hasProvider('GitHub')).toBe(true);
      expect(actionRegistry.supportsAction('GitHub', 'list_repos')).toBe(true);
    });

    it('supports wildcard actions when empty array is passed', () => {
      actionRegistry.registerProvider('wildcard-provider', async () => ({ success: true }), []);
      expect(actionRegistry.supportsAction('wildcard-provider', 'any-action')).toBe(true);
    });
  });

  describe('execute', () => {
    it('returns error for unregistered provider', async () => {
      const res = await actionRegistry.execute('unknown', 'action', {}, { userId: '1' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('unknown');
    });

    it('returns error for unsupported action', async () => {
      actionRegistry.registerProvider('test', async () => ({ success: true }), ['allowed']);
      const res = await actionRegistry.execute('test', 'not-allowed', {}, { userId: '1' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('not-allowed');
    });

    it('returns success with handler data', async () => {
      actionRegistry.registerProvider('test', async () => ({
        success: true,
        data: { repos: ['repo1', 'repo2'] },
      }), ['list']);

      const res = await actionRegistry.execute('test', 'list', {}, { userId: '1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.repos).toEqual(['repo1', 'repo2']);
    });

    it('returns 401 for auth-required actions', async () => {
      actionRegistry.registerProvider('test', async () => ({
        success: false,
        requiresAuth: true,
        authUrl: 'https://auth.example.com',
      }), ['auth-action']);

      const res = await actionRegistry.execute('test', 'auth-action', {}, { userId: '1' });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.requiresAuth).toBe(true);
      expect(body.authUrl).toBe('https://auth.example.com');
    });

    it('handles handler exceptions gracefully', async () => {
      actionRegistry.registerProvider('test', async () => {
        throw new Error('Handler crash');
      }, ['crash']);

      const res = await actionRegistry.execute('test', 'crash', {}, { userId: '1' });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Handler crash');
    });

    it('includes execution metadata', async () => {
      actionRegistry.registerProvider('test', async () => ({
        success: true,
        metadata: { cached: true },
      }), ['cached-action']);

      const res = await actionRegistry.execute('test', 'cached-action', {}, { userId: '1' });
      const body = await res.json();
      expect(body.metadata).toBeDefined();
      expect(body.metadata.provider).toBe('test');
      expect(body.metadata.action).toBe('cached-action');
      expect(body.metadata.cached).toBe(true);
      expect(body.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('passes context to handler', async () => {
      let receivedContext: HandlerContext | undefined;
      actionRegistry.registerProvider('test', async (_action, _params, ctx) => {
        receivedContext = ctx;
        return { success: true };
      }, ['context-test']);

      const ctx: HandlerContext = { userId: 'user-123', ipAddress: '1.2.3.4', userAgent: 'test-agent' };
      await actionRegistry.execute('test', 'context-test', {}, ctx);
      expect(receivedContext).toEqual(ctx);
    });
  });

  describe('getProviderActions', () => {
    it('returns actions for registered provider', () => {
      actionRegistry.registerProvider('github', async () => ({ success: true }), ['repos', 'issues']);
      const actions = actionRegistry.getProviderActions('github');
      expect(actions).toContain('repos');
      expect(actions).toContain('issues');
    });

    it('returns empty array for unregistered provider', () => {
      expect(actionRegistry.getProviderActions('unknown')).toEqual([]);
    });
  });

  describe('providerRequiresAuth', () => {
    it('returns true for OAuth providers', () => {
      actionRegistry.registerProvider('github', async () => ({ success: true }), ['repos'], true);
      expect(actionRegistry.providerRequiresAuth('github')).toBe(true);
    });

    it('returns false for public providers', () => {
      actionRegistry.registerProvider('local', async () => ({ success: true }), ['bash'], false);
      expect(actionRegistry.providerRequiresAuth('local')).toBe(false);
    });

    it('returns true for unregistered provider (safe default)', () => {
      expect(actionRegistry.providerRequiresAuth('unknown')).toBe(true);
    });
  });
});
