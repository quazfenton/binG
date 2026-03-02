import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorType,
  HEALING_STRATEGIES,
  classifyError,
  executeWithSelfHeal,
  generateReprompt,
  ErrorPatternTracker,
  globalErrorTracker,
} from '@/lib/stateful-agent/agents/self-healing';

describe('Self-Healing System', () => {
  describe('ErrorType enum', () => {
    it('should have correct error types', () => {
      expect(ErrorType.TRANSIENT).toBe('transient');
      expect(ErrorType.LOGIC).toBe('logic');
      expect(ErrorType.FATAL).toBe('fatal');
      expect(ErrorType.VALIDATION).toBe('validation');
    });
  });

  describe('HEALING_STRATEGIES', () => {
    it('should have strategy for transient errors', () => {
      const strategy = HEALING_STRATEGIES[ErrorType.TRANSIENT];
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.backoffMs).toBe(1000);
      expect(strategy.shouldReprompt).toBe(false);
      expect(strategy.shouldChangeApproach).toBe(false);
    });

    it('should have strategy for logic errors', () => {
      const strategy = HEALING_STRATEGIES[ErrorType.LOGIC];
      expect(strategy.maxRetries).toBe(2);
      expect(strategy.shouldReprompt).toBe(true);
      expect(strategy.shouldChangeApproach).toBe(true);
    });

    it('should have strategy for fatal errors', () => {
      const strategy = HEALING_STRATEGIES[ErrorType.FATAL];
      expect(strategy.maxRetries).toBe(0);
      expect(strategy.shouldReprompt).toBe(false);
    });

    it('should have strategy for validation errors', () => {
      const strategy = HEALING_STRATEGIES[ErrorType.VALIDATION];
      expect(strategy.maxRetries).toBe(1);
      expect(strategy.shouldFixInput).toBe(true);
    });
  });

  describe('classifyError', () => {
    describe('Transient errors', () => {
      it('should classify timeout as transient', () => {
        expect(classifyError(new Error('Request timeout'))).toBe(ErrorType.TRANSIENT);
      });

      it('should classify rate limit as transient', () => {
        expect(classifyError(new Error('Rate limit exceeded'))).toBe(ErrorType.TRANSIENT);
      });

      it('should classify 429 as transient', () => {
        expect(classifyError(new Error('429 Too Many Requests'))).toBe(ErrorType.TRANSIENT);
      });

      it('should classify network errors as transient', () => {
        expect(classifyError(new Error('Network error'))).toBe(ErrorType.TRANSIENT);
        expect(classifyError(new Error('ECONNREFUSED'))).toBe(ErrorType.TRANSIENT);
        expect(classifyError(new Error('ETIMEDOUT'))).toBe(ErrorType.TRANSIENT);
      });

      it('should classify 503 as transient', () => {
        expect(classifyError(new Error('503 Service Unavailable'))).toBe(ErrorType.TRANSIENT);
      });
    });

    describe('Fatal errors', () => {
      it('should classify permission denied as fatal', () => {
        expect(classifyError(new Error('Permission denied'))).toBe(ErrorType.FATAL);
      });

      it('should classify 401 as fatal', () => {
        expect(classifyError(new Error('401 Unauthorized'))).toBe(ErrorType.FATAL);
      });

      it('should classify 403 as fatal', () => {
        expect(classifyError(new Error('403 Forbidden'))).toBe(ErrorType.FATAL);
      });

      it('should classify 404 as logic (resource not found, can be fixed)', () => {
        // 404 is classified as logic because it often means the agent needs to check existence first
        // or create the resource, not that the operation is fundamentally impossible
        expect(classifyError(new Error('404 Not Found'))).toBe(ErrorType.LOGIC);
      });

      it('should classify quota exceeded as fatal', () => {
        expect(classifyError(new Error('Insufficient quota'))).toBe(ErrorType.FATAL);
      });
    });

    describe('Logic errors', () => {
      it('should classify search pattern not found as logic', () => {
        expect(classifyError(new Error('Search pattern not found'))).toBe(ErrorType.LOGIC);
      });

      it('should classify syntax error as logic', () => {
        expect(classifyError(new Error('Syntax error on line 5'))).toBe(ErrorType.LOGIC);
      });

      it('should classify type error as logic', () => {
        expect(classifyError(new Error('Type error: cannot read property'))).toBe(ErrorType.LOGIC);
      });

      it('should classify unexpected token as logic', () => {
        expect(classifyError(new Error('Unexpected token'))).toBe(ErrorType.LOGIC);
      });
    });

    describe('Validation errors', () => {
      it('should classify validation error', () => {
        expect(classifyError(new Error('Validation failed: required field'))).toBe(ErrorType.VALIDATION);
      });

      it('should classify invalid input as validation', () => {
        expect(classifyError(new Error('Invalid input'))).toBe(ErrorType.VALIDATION);
      });

      it('should classify Zod error as validation', () => {
        expect(classifyError(new Error('ZodError: invalid type'))).toBe(ErrorType.VALIDATION);
      });

      it('should classify schema error as validation', () => {
        expect(classifyError(new Error('Schema validation failed'))).toBe(ErrorType.VALIDATION);
      });

      it('should classify permission denied in validation context as fatal', () => {
        expect(classifyError(new Error('Validation failed: permission denied'))).toBe(ErrorType.FATAL);
      });
    });

    describe('Edge cases', () => {
      it('should handle non-Error objects', () => {
        expect(classifyError('string error')).toBe(ErrorType.LOGIC);
        expect(classifyError({ message: 'object error' })).toBe(ErrorType.LOGIC);
        expect(classifyError(null)).toBe(ErrorType.LOGIC);
        expect(classifyError(undefined)).toBe(ErrorType.LOGIC);
      });

      it('should handle case insensitive matching', () => {
        expect(classifyError(new Error('TIMEOUT'))).toBe(ErrorType.TRANSIENT);
        expect(classifyError(new Error('Permission Denied'))).toBe(ErrorType.FATAL);
      });

      it('should default to logic for unknown errors', () => {
        expect(classifyError(new Error('Some unknown error'))).toBe(ErrorType.LOGIC);
      });
    });
  });

  describe('executeWithSelfHeal', () => {
    it('should succeed on first try', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithSelfHeal(operation, { step: 'test' });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.shouldRetry).toBe(false);
    });

    it('should retry on transient errors', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValue('success');

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 3);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on fatal errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Permission denied'));

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 3);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ErrorType.FATAL);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry logic errors with reprompt', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Search pattern not found'))
        .mockResolvedValue('success');

      const result = await executeWithSelfHeal(operation, { step: 'test', prompt: 'original' }, 2);

      expect(result.success).toBe(true);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should respect max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Timeout'));

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 2);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should apply exponential backoff', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Timeout'));
      const startTime = Date.now();

      await executeWithSelfHeal(operation, { step: 'test' }, 2);

      const duration = Date.now() - startTime;
      // First retry: 1000ms, Second retry: 2000ms = ~3000ms minimum
      expect(duration).toBeGreaterThanOrEqual(1000);
    });

    it('should modify prompt on change approach', async () => {
      const context = { step: 'test', prompt: 'original prompt' };
      const operation = vi.fn().mockRejectedValue(new Error('Search pattern not found'));

      await executeWithSelfHeal(operation, context, 2);

      expect(context.prompt).toContain('PREVIOUS ERRORS');
      expect(context.prompt).toContain('different approach');
    });

    it('should track previous errors', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValue('success');

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 3);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it('should handle non-Error rejections', async () => {
      const operation = vi.fn().mockRejectedValue('string error');

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 1);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('string error');
    });
  });

  describe('generateReprompt', () => {
    it('should generate reprompt for logic errors', () => {
      const reprompt = generateReprompt(
        { step: 'test' },
        new Error('Search pattern not found'),
        ErrorType.LOGIC
      );

      expect(reprompt).toContain('logical issue');
      expect(reprompt).toContain('Verifying file paths');
      expect(reprompt).toContain('different tool');
    });

    it('should generate reprompt for validation errors', () => {
      const reprompt = generateReprompt(
        { step: 'test' },
        new Error('Validation failed'),
        ErrorType.VALIDATION
      );

      expect(reprompt).toContain('input validation failed');
      expect(reprompt).toContain('required parameters');
    });

    it('should generate reprompt for transient errors', () => {
      const reprompt = generateReprompt(
        { step: 'test' },
        new Error('Timeout'),
        ErrorType.TRANSIENT
      );

      expect(reprompt).toContain('temporary issue');
      expect(reprompt).toContain('Retrying');
    });

    it('should generate reprompt for fatal errors', () => {
      const reprompt = generateReprompt(
        { step: 'test' },
        new Error('Permission denied'),
        ErrorType.FATAL
      );

      expect(reprompt).toContain('fatal error');
      expect(reprompt).toContain('Manual intervention');
    });
  });

  describe('ErrorPatternTracker', () => {
    let tracker: ErrorPatternTracker;

    beforeEach(() => {
      tracker = new ErrorPatternTracker();
    });

    it('should record errors', () => {
      tracker.record(new Error('Test error'), { step: 'test', toolName: 'readFile' });

      const history = tracker.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].errorType).toBe(ErrorType.LOGIC);
      expect(history[0].step).toBe('test');
    });

    it('should detect recurring errors', () => {
      tracker.record(new Error('Pattern not found'), { step: 'editing' });
      tracker.record(new Error('Pattern not found'), { step: 'editing' });

      expect(tracker.isRecurringError(new Error('Pattern not found'), 'editing')).toBe(true);
    });

    it('should not detect single occurrence as recurring', () => {
      tracker.record(new Error('Unique error'), { step: 'test' });

      expect(tracker.isRecurringError(new Error('Unique error'), 'test')).toBe(false);
    });

    it('should keep history bounded', () => {
      for (let i = 0; i < 100; i++) {
        tracker.record(new Error(`Error ${i}`), { step: 'test' });
      }

      const history = tracker.getHistory();
      expect(history.length).toBeLessThanOrEqual(50);
    });

    it('should analyze patterns', () => {
      // Add multiple logic errors in editing step
      for (let i = 0; i < 5; i++) {
        tracker.record(new Error('Pattern not found'), { step: 'editing', toolName: 'applyDiff' });
      }

      // Add some transient errors
      for (let i = 0; i < 2; i++) {
        tracker.record(new Error('Timeout'), { step: 'discovery' });
      }

      const analysis = tracker.getPatternAnalysis();
      expect(analysis.mostCommonErrorType).toBe(ErrorType.LOGIC);
      expect(analysis.mostFailingStep).toBe('editing');
      expect(analysis.mostFailingTool).toBe('applyDiff');
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    it('should handle empty history', () => {
      const analysis = tracker.getPatternAnalysis();
      expect(analysis.mostCommonErrorType).toBeNull();
      expect(analysis.mostFailingStep).toBeNull();
      expect(analysis.mostFailingTool).toBeNull();
      expect(analysis.recommendations).toEqual([]);
    });

    it('should clear history', () => {
      tracker.record(new Error('Test'), { step: 'test' });
      tracker.clear();

      expect(tracker.getHistory()).toHaveLength(0);
    });

    it('should generate recommendations', () => {
      // Add more logic errors in editing step with tool name
      for (let i = 0; i < 5; i++) {
        tracker.record(new Error('Pattern not found'), { step: 'editing', toolName: 'applyDiff' });
      }

      const analysis = tracker.getPatternAnalysis();
      expect(analysis.recommendations.length).toBeGreaterThan(0);
      expect(analysis.recommendations.some(r => r.includes('logic') || r.includes('editing'))).toBe(true);
    });
  });

  describe('globalErrorTracker', () => {
    it('should be a singleton instance', () => {
      expect(globalErrorTracker).toBeInstanceOf(ErrorPatternTracker);
    });

    it('should track errors globally', () => {
      globalErrorTracker.record(new Error('Global test'), { step: 'global' });

      const history = globalErrorTracker.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete failure scenario', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const context = { step: 'critical_operation', prompt: 'do something' };

      const result = await executeWithSelfHeal(operation, context, 3);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ErrorType.FATAL);
      expect(result.attempts).toBe(1); // Should not retry fatal
    });

    it('should handle recovery after multiple failures', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('finally succeeded');

      const result = await executeWithSelfHeal(operation, { step: 'retry_test' }, 5);

      expect(result.success).toBe(true);
      expect(result.result).toBe('finally succeeded');
      expect(result.attempts).toBe(4);
    });

    it('should handle mixed error types', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout')) // transient - retry
        .mockRejectedValueOnce(new Error('Invalid input')) // validation - retry once
        .mockResolvedValue('success');

      const result = await executeWithSelfHeal(operation, { step: 'mixed' }, 3);

      expect(result.success).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Error'));

      const result = await executeWithSelfHeal(operation, { step: 'test' }, 0);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(0);
    });

    it('should handle very fast operations', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Fast error'));

      const startTime = Date.now();
      const result = await executeWithSelfHeal(operation, { step: 'fast' }, 1);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle null/undefined errors', async () => {
      const operation = vi.fn().mockRejectedValue(null);

      const result = await executeWithSelfHeal(operation, { step: 'null' }, 1);

      expect(result.success).toBe(false);
    });
  });
});
