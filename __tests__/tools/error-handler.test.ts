/**
 * Tests for Tool Error Handler
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolErrorHandler, getToolErrorHandler } from '../../tools/error-handler';

describe('ToolErrorHandler', () => {
  let handler: ToolErrorHandler;

  beforeEach(() => {
    handler = ToolErrorHandler.getInstance();
  });

  describe('error categorization', () => {
    it('should categorize validation errors', () => {
      const error = handler.handleError(
        new Error('Required parameter missing'),
        'test_tool',
        { param: 'value' }
      );
      expect(error.category).toBe('validation');
      expect(error.retryable).toBe(false);
    });

    it('should categorize authentication errors', () => {
      const error = handler.handleError(
        new Error('Authentication required: invalid token'),
        'test_tool'
      );
      expect(error.category).toBe('authentication');
      expect(error.retryable).toBe(false);
    });

    it('should categorize rate limit errors', () => {
      const error = handler.handleError(
        new Error('Rate limit exceeded: 429'),
        'test_tool'
      );
      expect(error.category).toBe('rate_limit');
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60000);
    });

    it('should categorize timeout errors', () => {
      const error = handler.handleError(
        new Error('Request timed out'),
        'test_tool'
      );
      expect(error.category).toBe('timeout');
      expect(error.retryable).toBe(true);
    });

    it('should categorize network errors', () => {
      const error = handler.handleError(
        new Error('Network error: connection refused'),
        'test_tool'
      );
      expect(error.category).toBe('network');
      expect(error.retryable).toBe(true);
    });

    it('should categorize not found errors', () => {
      const error = handler.handleError(
        new Error('Tool test_tool not found'),
        'test_tool'
      );
      expect(error.category).toBe('not_found');
      expect(error.retryable).toBe(false);
    });
  });

  describe('error messages', () => {
    it('should format error messages with prefix', () => {
      const error = handler.handleError(
        new Error('Token expired'),
        'test_tool'
      );
      expect(error.message).toContain('Authentication required');
    });

    it('should include hints for fixing errors', () => {
      const error = handler.handleError(
        new Error('Invalid input'),
        'test_tool',
        { param: 'value' }
      );
      expect(error.hints).toBeDefined();
      expect(error.hints!.length).toBeGreaterThan(0);
    });
  });

  describe('helper methods', () => {
    it('should create validation error', () => {
      const error = handler.createValidationError('Missing required field', { field: 'value' });
      expect(error.category).toBe('validation');
      expect(error.message).toContain('Invalid input');
      expect(error.parameters).toBeDefined();
    });

    it('should create auth error', () => {
      const error = handler.createAuthError('Token expired', 'https://auth.example.com');
      expect(error.category).toBe('authentication');
      expect(error.message).toContain('Authentication required');
      expect(error.hints).toContainEqual(expect.stringContaining('Authorization URL'));
    });

    it('should create not found error', () => {
      const error = handler.createNotFoundError('github_create_issue');
      expect(error.category).toBe('not_found');
      expect(error.message).toContain('not found');
    });
  });

  describe('execution result conversion', () => {
    it('should convert auth error to execution result', () => {
      const error = handler.createAuthError('Auth failed');
      const result = handler.toExecutionResult(error);
      
      expect(result.success).toBe(false);
      expect(result.authRequired).toBe(true);
    });

    it('should convert other errors to execution result', () => {
      const error = handler.createValidationError('Invalid input');
      const result = handler.toExecutionResult(error);
      
      expect(result.success).toBe(false);
      expect(result.authRequired).toBeUndefined();
    });
  });

  describe('singleton', () => {
    it('should return same instance from getInstance', () => {
      const instance1 = getToolErrorHandler();
      const instance2 = getToolErrorHandler();
      expect(instance1).toBe(instance2);
    });
  });
});

describe('ToolDiscoveryService', () => {
  // Basic tests - full integration tests would require API keys
  const { ToolDiscoveryService, getToolDiscoveryService } = require('../../tools/discovery');

  describe('initialization', () => {
    it('should create service instance', () => {
      const service = ToolDiscoveryService.getInstance();
      expect(service).toBeDefined();
    });

    it('should return same instance from getInstance', () => {
      const instance1 = getToolDiscoveryService();
      const instance2 = getToolDiscoveryService();
      expect(instance1).toBe(instance2);
    });
  });

  describe('usage tracking', () => {
    it('should record tool usage', () => {
      const service = getToolDiscoveryService();
      service.recordUsage('test_tool', true, 100);
      
      const stats = service.getUsageStats('test_tool');
      expect(stats).toBeDefined();
      expect(stats?.executionCount).toBe(1);
      expect(stats?.successRate).toBe(100);
    });

    it('should update success rate on multiple executions', () => {
      const service = getToolDiscoveryService();
      
      service.recordUsage('test_tool', true, 100);
      service.recordUsage('test_tool', false, 150);
      service.recordUsage('test_tool', true, 120);
      
      const stats = service.getUsageStats('test_tool');
      expect(stats?.executionCount).toBe(3);
      expect(stats?.successRate).toBeCloseTo(66.67, 0);
    });
  });

  describe('clear stats', () => {
    it('should clear usage stats for specific tool', () => {
      const service = getToolDiscoveryService();
      
      service.recordUsage('test_tool', true, 100);
      service.clearUsageStats('test_tool');
      
      const stats = service.getUsageStats('test_tool');
      expect(stats).toBeUndefined();
    });

    it('should clear all usage stats', () => {
      const service = getToolDiscoveryService();
      
      service.recordUsage('tool1', true, 100);
      service.recordUsage('tool2', true, 100);
      service.clearUsageStats();
      
      const allStats = service.getUsageStats();
      expect(allStats.size).toBe(0);
    });
  });
});
