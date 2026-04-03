/**
 * Tests for Unified Error Handler
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UnifiedErrorHandler, getErrorHandler, handleError, createValidationError, createAuthError } from '@/lib/utils/error-handler';

describe('Unified Error Handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const handler1 = getErrorHandler();
      const handler2 = getErrorHandler();
      expect(handler1).toBe(handler2);
    });
  });

  describe('handleError', () => {
    it('should handle validation errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Required field missing');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('validation');
      expect(result.retryable).toBe(false);
      expect(result.message).toContain('Invalid input');
    });

    it('should handle authentication errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Unauthorized: Invalid token');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('authentication');
      expect(result.retryable).toBe(false);
      expect(result.message).toContain('Authentication required');
    });

    it('should handle authorization errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Forbidden: Insufficient permissions');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('authorization');
      expect(result.retryable).toBe(false);
    });

    it('should handle rate limit errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Rate limit exceeded: 429');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('rate_limit');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(60000); // 1 minute
    });

    it('should handle timeout errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Request timed out');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('timeout');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(5000); // 5 seconds
    });

    it('should handle network errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Network error: ECONNREFUSED');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('network');
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(10000); // 10 seconds
    });

    it('should handle not found errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Tool not found: 404');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('not_found');
      expect(result.retryable).toBe(false);
    });

    it('should handle provider errors', () => {
      const handler = getErrorHandler();
      const error = new Error('Composio SDK error');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.category).toBe('provider');
      expect(result.retryable).toBe(true);
    });

    it('should provide hints', () => {
      const handler = getErrorHandler();
      const error = new Error('Rate limit exceeded');
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.hints).toBeDefined();
      expect(result.hints!.length).toBeGreaterThan(0);
    });

    it('should sanitize parameters', () => {
      const handler = getErrorHandler();
      const error = new Error('Error');
      const params = { apiKey: 'sk-123', data: 'test' };
      
      const result = handler.handleError(error, 'test_tool', params);
      
      expect(result.parameters).toBeDefined();
      expect(result.parameters.apiKey).toBe('[REDACTED]');
    });
  });

  describe('createValidationError', () => {
    it('should create validation error', () => {
      const error = createValidationError('Missing field', { field: 'title' });
      
      expect(error.category).toBe('validation');
      expect(error.message).toContain('Invalid input');
      expect(error.retryable).toBe(false);
    });
  });

  describe('createAuthError', () => {
    it('should create auth error', () => {
      const error = createAuthError('Token expired', '/auth/connect');
      
      expect(error.category).toBe('authentication');
      expect(error.message).toContain('Authentication required');
      expect(error.retryable).toBe(false);
    });

    it('should include auth URL in hints', () => {
      const error = createAuthError('Token expired', '/auth/connect');
      
      expect(error.hints).toContainEqual(
        expect.stringContaining('/auth/connect')
      );
    });
  });

  describe('toExecutionResult', () => {
    it('should convert auth error to execution result', () => {
      const handler = getErrorHandler();
      const error = handler.handleError(
        new Error('Unauthorized'),
        'test_tool'
      );
      
      const result = handler.toExecutionResult(error);
      
      expect(result.success).toBe(false);
      expect(result.authRequired).toBe(true);
    });

    it('should convert other errors to execution result', () => {
      const handler = getErrorHandler();
      const error = handler.handleError(
        new Error('Validation failed'),
        'test_tool'
      );
      
      const result = handler.toExecutionResult(error);
      
      expect(result.success).toBe(false);
      expect(result.authRequired).toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('should mark rate limit as retryable', () => {
      const handler = getErrorHandler();
      const error = handler.handleError(
        new Error('429 Too Many Requests'),
        'test_tool'
      );
      
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBeGreaterThan(0);
    });

    it('should mark validation as not retryable', () => {
      const handler = getErrorHandler();
      const error = handler.handleError(
        new Error('Invalid input'),
        'test_tool'
      );
      
      expect(error.retryable).toBe(false);
    });

    it('should mark auth errors as not retryable', () => {
      const handler = getErrorHandler();
      const error = handler.handleError(
        new Error('Unauthorized'),
        'test_tool'
      );
      
      expect(error.retryable).toBe(false);
    });
  });

  describe('error details', () => {
    it('should extract status code from response', () => {
      const handler = getErrorHandler();
      const error = {
        message: 'Error',
        response: { status: 401 },
      };
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.details?.statusCode).toBe(401);
    });

    it('should sanitize response data', () => {
      const handler = getErrorHandler();
      const error = {
        message: 'Error',
        response: {
          data: { apiKey: 'sk-123', message: 'test' },
        },
      };
      
      const result = handler.handleError(error, 'test_tool');
      
      expect(result.details?.responseData.apiKey).toBe('[REDACTED]');
    });
  });

  describe('helper function', () => {
    it('should handle error with default handler', () => {
      const error = handleError(
        new Error('Test error'),
        'test_context'
      );
      
      expect(error.category).toBeDefined();
      expect(error.message).toBeDefined();
    });
  });
});

describe('Error categories', () => {
  const handler = getErrorHandler();

  const testCases = [
    { message: 'Required field', expected: 'validation' },
    { message: 'Invalid schema', expected: 'validation' },
    { message: 'Unauthorized', expected: 'authentication' },
    { message: 'Invalid token', expected: 'authentication' },
    { message: 'Forbidden', expected: 'authorization' },
    { message: 'Permission denied', expected: 'authorization' },
    { message: 'Rate limit', expected: 'rate_limit' },
    { message: '429 Too Many Requests', expected: 'rate_limit' },
    { message: 'Timeout', expected: 'timeout' },
    { message: 'Timed out', expected: 'timeout' },
    { message: 'Network error', expected: 'network' },
    { message: 'ECONNREFUSED', expected: 'network' },
    { message: 'Not found', expected: 'not_found' },
    { message: '404', expected: 'not_found' },
    { message: 'Blocked', expected: 'security' },
    { message: 'SDK error', expected: 'provider' },
  ];

  testCases.forEach(({ message, expected }) => {
    it(`should categorize "${message}" as ${expected}`, () => {
      const error = handler.handleError(new Error(message), 'test');
      expect(error.category).toBe(expected);
    });
  });
});
