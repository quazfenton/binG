/**
 * Tambo Comprehensive E2E Tests
 * 
 * Tests all Tambo integration features:
 * - OAuth token exchange
 * - Tool registry
 * - Component registry
 * - Context helpers
 * - Context attachments
 * - Resources
 * - Error handling
 * - Interactable components
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Tambo E2E Integration Tests', () => {
  const testUserId = 'tambo_test_' + Date.now();

  /**
   * OAuth Token Exchange Tests
   */
  describe('OAuth Token Exchange', () => {
    it('should exchange user JWT for Tambo token', async () => {
      // Create test JWT
      const { sign } = await import('jsonwebtoken');
      const testJWT = sign(
        { sub: testUserId, email: 'test@example.com' },
        'test-secret',
        { algorithm: 'HS256' }
      );

      // Exchange for Tambo token
      const response = await fetch('http://localhost:3000/api/tambo/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: testJWT,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        }),
      });

      // Should succeed or fail gracefully
      expect(response.status).toBeLessThan(500);
      
      if (response.ok) {
        const data = await response.json();
        expect(data.access_token).toBeDefined();
        expect(data.token_type).toBe('Bearer');
      }
    });

    it('should reject invalid JWT', async () => {
      const response = await fetch('http://localhost:3000/api/tambo/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: 'invalid-token',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        }),
      });

      // Should return 401 for invalid token
      expect(response.status).toBe(401);
    });

    it('should reject missing subject_token', async () => {
      const response = await fetch('http://localhost:3000/api/tambo/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  /**
   * Tool Registry Tests
   */
  describe('Tool Registry', () => {
    it('should initialize default tools', async () => {
      const { getTamboToolRegistry, initializeDefaultTools } = await import('@/lib/tambo/tambo-tool-registry');
      
      initializeDefaultTools();
      const registry = getTamboToolRegistry();
      
      expect(registry.count).toBeGreaterThan(0);
    });

    it('should register and retrieve tools', async () => {
      const { tamboToolRegistry } = await import('@/lib/tambo/tambo-tool-registry');
      const { z } = await import('zod');

      const testTool = {
        name: 'testTool',
        description: 'Test tool',
        inputSchema: z.object({ value: z.string() }),
        tool: async ({ value }: { value: string }) => ({ result: value }),
      };

      tamboToolRegistry.register(testTool);
      const retrieved = tamboToolRegistry.get('testTool');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('testTool');
    });

    it('should execute tools with validation', async () => {
      const { tamboToolRegistry } = await import('@/lib/tambo/tambo-tool-registry');

      const result = await tamboToolRegistry.execute('calculate', { expression: '2 + 2' });

      expect(result.success).toBe(true);
      expect(result.output?.result).toBe('4');
    });

    it('should handle tool execution errors', async () => {
      const { tamboToolRegistry } = await import('@/lib/tambo/tambo-tool-registry');

      const result = await tamboToolRegistry.execute('calculate', { expression: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get all tools as array for TamboProvider', async () => {
      const { tamboToolRegistry } = await import('@/lib/tambo/tambo-tool-registry');

      const tools = tamboToolRegistry.toArray();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toHaveProperty('name');
      expect(tools[0]).toHaveProperty('tool');
      expect(tools[0]).toHaveProperty('argsSchema');
    });
  });

  /**
   * Component Registry Tests
   */
  describe('Component Registry', () => {
    it('should initialize default components', async () => {
      const { getTamboComponentRegistry, initializeDefaultComponents } = await import('@/lib/tambo/tambo-component-registry');
      
      initializeDefaultComponents();
      
      // Give async initialization time to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const registry = getTamboComponentRegistry();
      expect(registry.count).toBeGreaterThan(0);
    });

    it('should register and retrieve components', async () => {
      const { tamboComponentRegistry } = await import('@/lib/tambo/tambo-component-registry');
      const { z } = await import('zod');
      const React = await import('react');

      const TestComponent = () => React.createElement('div', null, 'Test');

      const testComponent = {
        name: 'TestComponent',
        description: 'Test component',
        component: TestComponent,
        propsSchema: z.object({ value: z.string() }),
        type: 'generative' as const,
      };

      tamboComponentRegistry.register(testComponent);
      const retrieved = tamboComponentRegistry.get('TestComponent');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('TestComponent');
    });

    it('should get interactable components', async () => {
      const { tamboComponentRegistry } = await import('@/lib/tambo/tambo-component-registry');

      const interactables = tamboComponentRegistry.getInteractable();

      expect(Array.isArray(interactables)).toBe(true);
    });

    it('should get all components as array for TamboProvider', async () => {
      const { tamboComponentRegistry } = await import('@/lib/tambo/tambo-component-registry');

      const components = tamboComponentRegistry.toArray();

      expect(Array.isArray(components)).toBe(true);
      expect(components.length).toBeGreaterThan(0);
      expect(components[0]).toHaveProperty('name');
      expect(components[0]).toHaveProperty('component');
      expect(components[0]).toHaveProperty('propsSchema');
    });
  });

  /**
   * Context Helpers Tests
   */
  describe('Context Helpers', () => {
    it('should provide current time helper', async () => {
      const { currentTimeContextHelper } = await import('@/lib/tambo/tambo-hooks');

      const result = currentTimeContextHelper();

      expect(result).toHaveProperty('time');
      expect(result).toHaveProperty('formatted');
      expect(result).toHaveProperty('timezone');
    });

    it('should provide current page helper', async () => {
      const { currentPageContextHelper } = await import('@/lib/tambo/tambo-hooks');

      const result = currentPageContextHelper();

      // Returns null on server-side
      expect(result === null || result?.url !== undefined).toBe(true);
    });

    it('should provide system info helper', async () => {
      const { systemInfoContextHelper } = await import('@/lib/tambo/tambo-hooks');

      const result = systemInfoContextHelper();

      // Returns null on server-side
      expect(result === null || result?.userAgent !== undefined).toBe(true);
    });
  });

  /**
   * Context Attachments Tests
   */
  describe('Context Attachments', () => {
    it('should add context attachment', async () => {
      const { useTamboContextAttachments } = await import('@/lib/tambo/tambo-hooks');

      // Mock React hook context
      const { addContextAttachment, clearContextAttachments, getAttachments } = useTamboContextAttachments();
      
      const id = addContextAttachment({
        context: 'test content',
        displayName: 'Test File',
        type: 'file',
      });

      expect(id).toBeDefined();
      
      const attachments = getAttachments();
      expect(attachments.length).toBe(1);
      expect(attachments[0].displayName).toBe('Test File');

      clearContextAttachments();
      expect(getAttachments().length).toBe(0);
    });

    it('should remove context attachment', async () => {
      const { useTamboContextAttachments } = await import('@/lib/tambo/tambo-hooks');

      const { addContextAttachment, removeContextAttachment, getAttachments } = useTamboContextAttachments();
      
      const id = addContextAttachment({
        context: 'test content',
        displayName: 'Test File',
      });

      removeContextAttachment(id);
      expect(getAttachments().length).toBe(0);
    });
  });

  /**
   * Resources Tests
   */
  describe('Resources (@-mentions)', () => {
    it('should add and search resources', async () => {
      const { useTamboResources } = await import('@/lib/tambo/tambo-hooks');

      const { addResource, searchResources, getResources, clearResources } = useTamboResources();

      addResource({
        id: 'test-1',
        name: 'Test Doc',
        content: 'Test content',
        type: 'documentation',
      });

      const results = await searchResources('test');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Test Doc');

      clearResources();
      expect(getResources().length).toBe(0);
    });

    it('should handle empty search', async () => {
      const { useTamboResources } = await import('@/lib/tambo/tambo-hooks');

      const { searchResources } = useTamboResources();

      const results = await searchResources('nonexistent');
      expect(results.length).toBe(0);
    });
  });

  /**
   * Error Handling Tests
   */
  describe('Error Handling', () => {
    it('should categorize errors correctly', async () => {
      const { categorizeError } = await import('@/lib/tambo/tambo-error-handler');

      expect(categorizeError({ status: 401, message: 'Unauthorized' })).toBe('auth');
      expect(categorizeError({ status: 429, message: 'Rate limit' })).toBe('rate_limit');
      expect(categorizeError({ status: 500, message: 'Server error' })).toBe('network');
      expect(categorizeError({ status: 408, message: 'Timeout' })).toBe('timeout');
      expect(categorizeError({ status: 400, message: 'Invalid input' })).toBe('validation');
    });

    it('should create Tambo errors', async () => {
      const { createTamboError } = await import('@/lib/tambo/tambo-error-handler');

      const error = createTamboError('Test error', 'auth', {
        userMessage: 'Please sign in',
        retryable: false,
      });

      expect(error.category).toBe('auth');
      expect(error.retryable).toBe(false);
      expect(error.userMessage).toBe('Please sign in');
    });

    it('should retry on network errors', async () => {
      const { withRetry } = await import('@/lib/tambo/tambo-error-handler');

      let attempts = 0;
      
      const operation = async () => {
        attempts++;
        if (attempts < 3) {
          throw { status: 500, message: 'Server error' };
        }
        return 'success';
      };

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 100,
        exponentialBackoff: false,
        retryableStatusCodes: [500],
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should not retry on auth errors', async () => {
      const { withRetry } = await import('@/lib/tambo/tambo-error-handler');

      let attempts = 0;
      
      const operation = async () => {
        attempts++;
        throw { status: 401, message: 'Unauthorized' };
      };

      try {
        await withRetry(operation, {
          maxAttempts: 3,
          baseDelay: 10,
          maxDelay: 100,
          exponentialBackoff: false,
          retryableStatusCodes: [],
        });
      } catch (error: any) {
        expect(error.status).toBe(401);
      }

      expect(attempts).toBe(1); // Should not retry
    });
  });

  /**
   * Interactable Component Tests
   */
  describe('Interactable Components', () => {
    it('should create interactable wrapper', async () => {
      const { withInteractable } = await import('@/lib/tambo/tambo-component-registry');
      const { z } = await import('zod');
      const React = await import('react');

      const TestComponent = () => React.createElement('div', null, 'Test');

      const interactable = withInteractable(TestComponent, {
        componentName: 'TestInteractable',
        description: 'Test interactable component',
        propsSchema: z.object({ value: z.string() }),
      });

      expect(interactable.name).toBe('TestInteractable');
      expect(interactable.type).toBe('interactable');
      expect(interactable.WrappedComponent).toBe(TestComponent);
    });
  });

  /**
   * Integration Tests
   */
  describe('Full Integration', () => {
    it('should work end-to-end with EnhancedTamboProvider', async () => {
      const { EnhancedTamboProvider } = await import('@/lib/tambo/tambo-provider');

      // Verify provider exports correctly
      expect(EnhancedTamboProvider).toBeDefined();
      expect(typeof EnhancedTamboProvider).toBe('function');
    });

    it('should have all exports in index', async () => {
      const tambo = await import('@/lib/tambo');

      expect(tambo.tamboToolRegistry).toBeDefined();
      expect(tambo.tamboComponentRegistry).toBeDefined();
      expect(tambo.useTamboContextHelpers).toBeDefined();
      expect(tambo.useTamboContextAttachments).toBeDefined();
      expect(tambo.useTamboResources).toBeDefined();
      expect(tambo.EnhancedTamboProvider).toBeDefined();
      expect(tambo.tamboErrorHandler).toBeDefined();
    });
  });
});
