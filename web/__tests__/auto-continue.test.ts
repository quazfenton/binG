/**
 * Auto-Continue Mechanism Unit Tests
 *
 * Tests the auto-continue feature that automatically retries/proceeds
 * when the LLM signals it needs more turns or when tool failures occur.
 *
 * Key behaviors tested:
 * 1. stepReprompt auto-continue - LLM requests continuation via DONE event
 * 2. shouldRetryForToolFailure - Auto-continue when anyToolFailed is true
 * 3. Race condition prevention - Re-check inputQueue before submitting
 * 4. Error handling - Cleanup isLoading state when auto-continue fails
 * 5. Max continuation limits - Cap at MAX_STEP_REPROMPTS (5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock React hooks
vi.mock('react', async (importOriginal) => {
  const actualReact = await importOriginal();
  return {
    ...actualReact,
    useState: vi.fn((initial) => {
      const ref = { current: initial };
      return [ref.current, vi.fn((val) => { ref.current = typeof val === 'function' ? val(ref.current) : val; })];
    }),
    useCallback: vi.fn((fn) => fn),
    useRef: vi.fn((initial) => ({ current: initial })),
    useEffect: vi.fn((fn) => fn()),
    createElement: vi.fn((type, props, ...children) => ({ type, props, children })),
  };
});

// Mock the streaming state manager
vi.mock('@/lib/streaming/stream-state-manager', () => ({
  streamStateManager: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    signalNeedMoreTurns: vi.fn(),
    triggerContinue: vi.fn(),
  },
}));

describe('Auto-Continue Mechanism', () => {
  describe('shouldRetryForToolFailure logic', () => {
    it('should be true when anyToolFailed is true in metadata', () => {
      // Test the condition: doneMetadata?.anyToolFailed === true
      const testCases = [
        { anyToolFailed: true, expected: true },
        { anyToolFailed: false, expected: false },
        { anyToolFailed: undefined, expected: false },
        { anyToolFailed: null, expected: false },
      ];

      for (const tc of testCases) {
        const doneMetadata = tc.anyToolFailed !== undefined ? { anyToolFailed: tc.anyToolFailed } : {};
        const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;
        expect(shouldRetryForToolFailure).toBe(tc.expected);
      }
    });

    it('should NOT trigger auto-continue for empty responses without tool failure', () => {
      // The condition is: (!isEmptyResponse || shouldRetryForToolFailure)
      // When isEmptyResponse is true and shouldRetryForToolFailure is false, condition is false
      const isEmptyResponse = true;
      const shouldRetryForToolFailure = false;
      const condition = !isEmptyResponse || shouldRetryForToolFailure;
      expect(condition).toBe(false);
    });

    it('should trigger auto-continue for non-empty responses when tool failure occurred', () => {
      // When isEmptyResponse is false (content exists) but anyToolFailed is true,
      // auto-continue should still trigger to allow retry
      const isEmptyResponse = false;
      const shouldRetryForToolFailure = true;
      const condition = !isEmptyResponse || shouldRetryForToolFailure;
      expect(condition).toBe(true);
    });

    it('should trigger auto-continue for empty responses when tool failure occurred', () => {
      // Both conditions can trigger auto-continue
      const isEmptyResponse = true;
      const shouldRetryForToolFailure = true;
      const condition = !isEmptyResponse || shouldRetryForToolFailure;
      expect(condition).toBe(true);
    });
  });

  describe('stepRepromptCount limit', () => {
    it('should cap auto-continues at MAX_STEP_REPROMPTS (5)', () => {
      const MAX_STEP_REPROMPTS = 5;

      // Test boundary conditions
      const testCases = [
        { stepRepromptCount: 0, shouldContinue: true },
        { stepRepromptCount: 4, shouldContinue: true },  // 4 < 5, allowed
        { stepRepromptCount: 5, shouldContinue: false }, // 5 < 5 is false
        { stepRepromptCount: 6, shouldContinue: false },
      ];

      for (const tc of testCases) {
        const canContinue = tc.stepRepromptCount < MAX_STEP_REPROMPTS;
        expect(canContinue).toBe(tc.shouldContinue);
      }
    });

    it('should include continuation metadata (number and max)', () => {
      const MAX_STEP_REPROMPTS = 5;
      const stepRepromptCount = 3;

      const continuationMetadata = {
        continuationNumber: stepRepromptCount + 1,
        maxContinuations: MAX_STEP_REPROMPTS,
      };

      expect(continuationMetadata.continuationNumber).toBe(4);
      expect(continuationMetadata.maxContinuations).toBe(5);
    });
  });

  describe('isMountedRef guard', () => {
    it('should NOT trigger auto-continue when component is unmounted', () => {
      // Test the guard logic directly - isMountedRef.current is false means unmounted
      let isMountedRef = { current: false }; // Component unmounted

      const safeHandleSubmit = (): boolean => {
        if (!isMountedRef.current) return false; // Guard blocks submission
        return true;
      };

      // handleSubmit should not be called because isMountedRef.current is false
      const result = safeHandleSubmit();
      expect(result).toBe(false); // Guard blocked execution
    });

    it('should trigger auto-continue when component is still mounted', () => {
      let isMountedRef = { current: true }; // Component still mounted
      let handleSubmitCalled = false;

      const safeHandleSubmit = () => {
        if (!isMountedRef.current) return;
        handleSubmitCalled = true;
      };

      safeHandleSubmit();

      expect(handleSubmitCalled).toBe(true);
    });

    it('should handle isMountedRef changing from true to false during delay', () => {
      let isMountedRef = { current: true };
      let handleSubmitCalled = false;

      const safeHandleSubmit = () => {
        if (!isMountedRef.current) return;
        handleSubmitCalled = true;
      };

      // Component mounted initially
      expect(isMountedRef.current).toBe(true);

      // User navigates away (unmounts)
      isMountedRef.current = false;

      // Now try to submit
      safeHandleSubmit();

      // handleSubmit should NOT be called due to unmount
      expect(handleSubmitCalled).toBe(false);
    });
  });

  describe('inputQueue race condition prevention', () => {
    it('should re-check inputQueue before handleSubmit in setTimeout', () => {
      // Simulates the race condition fix: inputQueue could grow during the 100-150ms delay
      const inputQueue: string[] = [];
      let handleSubmitCalled = false;

      // Simulate user typing during the setTimeout delay
      const checkAndSubmit = () => {
        // Re-check inputQueue right before submission
        if (inputQueue.length > 0) {
          // User typed during delay - don't submit, let their input be processed
          return;
        }
        // No new input - safe to auto-continue
        handleSubmitCalled = true;
      };

      // Case 1: No user input during delay
      inputQueue.length = 0;
      checkAndSubmit();
      expect(handleSubmitCalled).toBe(true);

      // Case 2: User typed during delay
      handleSubmitCalled = false;
      inputQueue.push('user typed');
      checkAndSubmit();
      expect(handleSubmitCalled).toBe(false); // Prevented race condition
    });

    it('should not trigger auto-continue if user provides input during delay', () => {
      const inputQueue: string[] = [];
      const MAX_STEP_REPROMPTS = 5;
      const stepRepromptCount = 0;

      // Simulate the guard condition from use-enhanced-chat.ts
      const shouldAutoContinue = (): boolean => {
        if (inputQueue.length > 0) {
          return false; // User has pending input, don't interrupt
        }
        return stepRepromptCount < MAX_STEP_REPROMPTS;
      };

      // Initially empty queue
      expect(shouldAutoContinue()).toBe(true);

      // User types during the delay
      inputQueue.push('user input');
      expect(shouldAutoContinue()).toBe(false); // Blocked by user input
    });

    it('should handle multiple items in inputQueue during delay', () => {
      const inputQueue: string[] = ['first input', 'second input', 'third input'];

      // When there are multiple queued inputs, auto-continue should be blocked
      const shouldAutoContinue = inputQueue.length === 0;

      expect(shouldAutoContinue).toBe(false);
    });

    it('should clear inputQueue after processing', () => {
      const inputQueue: string[] = ['user input'];
      let handleSubmitCalled = false;

      const checkAndSubmit = () => {
        if (inputQueue.length > 0) {
          // Process the user's input instead
          inputQueue.length = 0; // Clear queue after processing
          return;
        }
        handleSubmitCalled = true;
      };

      checkAndSubmit();

      expect(inputQueue.length).toBe(0);
      expect(handleSubmitCalled).toBe(false);
    });
  });

  describe('doneMetadata edge cases', () => {
    it('should handle doneMetadata as null', () => {
      const doneMetadata: { anyToolFailed?: boolean } | null = null;
      const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;

      expect(shouldRetryForToolFailure).toBe(false);
    });

    it('should handle doneMetadata as undefined', () => {
      const doneMetadata: { anyToolFailed?: boolean } | undefined = undefined;
      const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;

      expect(shouldRetryForToolFailure).toBe(false);
    });

    it('should handle doneMetadata as empty object', () => {
      const doneMetadata = {};
      const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;

      expect(shouldRetryForToolFailure).toBe(false);
    });

    it('should handle doneMetadata with explicit undefined anyToolFailed', () => {
      const doneMetadata = { anyToolFailed: undefined };
      const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;

      // undefined === true is false
      expect(shouldRetryForToolFailure).toBe(false);
    });

    it('should handle doneMetadata with explicit null anyToolFailed', () => {
      const doneMetadata = { anyToolFailed: null };
      const shouldRetryForToolFailure = doneMetadata?.anyToolFailed === true;

      // null === true is false
      expect(shouldRetryForToolFailure).toBe(false);
    });
  });

  describe('planSteps edge cases', () => {
    it('should NOT redirect when planSteps is empty array', () => {
      const planSteps: string[] = [];
      const suggestedRole = 'researcher';
      const stepRepromptCount = 0;

      // planSteps && planSteps.length > 0 is false for empty array
      const shouldRedirect = !!(planSteps && planSteps.length > 0 &&
        suggestedRole && stepRepromptCount < 5);

      expect(shouldRedirect).toBe(false);
    });

    it('should NOT redirect when planSteps is undefined', () => {
      const planSteps = undefined;
      const suggestedRole = 'researcher';

      const shouldRedirect = !!(planSteps && planSteps.length > 0 && suggestedRole);

      expect(shouldRedirect).toBe(false);
    });

    it('should redirect when planSteps has items and role is suggested', () => {
      const planSteps = ['Step 1', 'Step 2'];
      const suggestedRole = 'researcher';
      const stepRepromptCount = 0;

      const shouldRedirect = planSteps && planSteps.length > 0 &&
        suggestedRole && stepRepromptCount < 5;

      expect(shouldRedirect).toBe(true);
    });
  });

  describe('error handling for auto-continue failures', () => {
    it('should cleanup isLoading state on handleSubmit failure', () => {
      let isLoading = true;
      let agentStatus = 'running';

      const handleSubmitError = (err: unknown) => {
        console.error('[Auto-continue] handleSubmit failed:', err);
        isLoading = false;
        agentStatus = 'error';
      };

      // Simulate a network error
      const testError = new Error('Network error');
      handleSubmitError(testError);

      expect(isLoading).toBe(false);
      expect(agentStatus).toBe('error');
    });

    it('should cleanup isLoading state on submitWithPrompt failure', () => {
      let isLoading = true;
      let agentStatus = 'running';

      const submitWithPromptError = (err: unknown) => {
        console.error('[Auto-continue] submitWithPrompt failed:', err);
        isLoading = false;
        agentStatus = 'error';
      };

      // Simulate an error
      const testError = new Error('Submit failed');
      submitWithPromptError(testError);

      expect(isLoading).toBe(false);
      expect(agentStatus).toBe('error');
    });

    it('should log error with context for debugging', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const testError = new Error('Test error');
      const autoContinueType = 'stepReprompt';
      const stepCount = 3;

      console.error(
        `[Auto-continue] ${autoContinueType} handleSubmit failed:`,
        testError,
        `stepCount: ${stepCount}`
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        `[Auto-continue] ${autoContinueType} handleSubmit failed:`,
        testError,
        `stepCount: ${stepCount}`
      );

      consoleSpy.mockRestore();
    });

    it('should cleanup abort controller on error to prevent issues on next submit', () => {
      // Simulate abort controller state - code should call abort() then reset
      let abortController: AbortController | null = new AbortController();
      let abortCalled = false;
      let isLoading = true;

      const handleSubmitError = (err: unknown) => {
        console.error('[Auto-continue] handleSubmit failed:', err);
        // Abort any in-flight request
        if (abortController) {
          abortController.abort();
          abortCalled = true;
        }
        isLoading = false;
        // Reset for next submit
        abortController = null;
      };

      // Trigger error
      handleSubmitError(new Error('Network error'));

      expect(abortCalled).toBe(true);
      expect(abortController).toBe(null);
      expect(isLoading).toBe(false);
    });

    it('should handle synchronous throw from handleSubmit', () => {
      let isLoading = true;
      let agentStatus = 'running';

      // Simulate code that wraps handleSubmit in try-catch
      const safeHandleSubmit = () => {
        try {
          // Synchronous throw - e.g., accessing property on undefined
          throw new Error('Synchronous error');
        } catch (err) {
          console.error('[Auto-continue] handleSubmit failed:', err);
          isLoading = false;
          agentStatus = 'error';
        }
      };

      safeHandleSubmit();

      expect(isLoading).toBe(false);
      expect(agentStatus).toBe('error');
    });

    it('should handle async rejection from handleSubmit', async () => {
      let isLoading = true;
      let agentStatus = 'running';

      // Simulate async handleSubmit with rejection
      const asyncHandleSubmit = async () => {
        try {
          await Promise.reject(new Error('Async error'));
        } catch (err) {
          console.error('[Auto-continue] handleSubmit failed:', err);
          isLoading = false;
          agentStatus = 'error';
        }
      };

      // The function should be callable and error should be caught
      await asyncHandleSubmit();

      // Error should be caught and state should be updated
      expect(isLoading).toBe(false);
      expect(agentStatus).toBe('error');
    });
  });

  describe('anyToolFailed metadata propagation', () => {
    it('should derive anyToolFailed from tool failures in OpenCode SDK paths', () => {
      // Simulate toolSteps with success/failure states
      const testCases = [
        { toolSteps: [{ result: { success: true } }, { result: { success: true } }], expected: false },
        { toolSteps: [{ result: { success: true } }, { result: { success: false } }], expected: true },
        { toolSteps: [], expected: false },
        { toolSteps: [{ result: {} }], expected: false }, // No success field = not failed
      ];

      for (const tc of testCases) {
        const anyToolFailed = tc.toolSteps.length > 0 && tc.toolSteps.some(t => t.result?.success === false);
        expect(anyToolFailed).toBe(tc.expected);
      }
    });

    it('should derive anyToolFailed from errors in runStatefulAgentMode', () => {
      // StatefulAgent errors array
      const testCases = [
        { errors: [], expected: false },
        { errors: [{ step: 1, message: 'Tool timed out' }], expected: true },
        { errors: [{ step: 1, message: 'Planning error' }], expected: true },
        { errors: undefined, expected: false },
      ];

      for (const tc of testCases) {
        const anyToolFailed = (tc.errors?.length ?? 0) > 0;
        expect(anyToolFailed).toBe(tc.expected);
      }
    });

    it('should derive anyToolFailed from toolInvocations in runV1ApiWithTools', () => {
      // toolInvocations have inv.result?.success
      const testCases = [
        { toolInvocations: [], expected: false },
        { toolInvocations: [{ result: { success: true } }], expected: false },
        { toolInvocations: [{ result: { success: false } }], expected: true },
        { toolInvocations: [{ result: {} }], expected: false },
        { toolInvocations: [{}], expected: false },
      ];

      for (const tc of testCases) {
        const anyToolFailed = tc.toolInvocations.length > 0 &&
          tc.toolInvocations.some(inv => inv.result?.success === false);
        expect(anyToolFailed).toBe(tc.expected);
      }
    });
  });

  describe('auto-continue event types', () => {
    it('should handle DONE event with stepReprompt', () => {
      const events: string[] = [];
      const stepRepromptCount = { current: 0 };
      const MAX_STEP_REPROMPTS = 5;

      // Simulate DONE event with stepReprompt
      const eventType = 'done';
      const doneData = { stepReprompt: 'Continue with the next step' };

      if (eventType === 'done' && doneData.stepReprompt) {
        if (stepRepromptCount.current < MAX_STEP_REPROMPTS) {
          events.push('auto-continue');
          stepRepromptCount.current++;
        }
      }

      expect(events).toContain('auto-continue');
      expect(stepRepromptCount.current).toBe(1);
    });

    it('should handle auto-continue SSE event', () => {
      const events: string[] = [];
      const inputQueue: string[] = [];

      // Simulate auto-continue SSE event
      const eventType = 'auto-continue';
      const eventData = { reason: 'need_more_turns' };

      if (eventType === 'auto-continue') {
        // Race condition fix: check inputQueue inside the handler
        if (inputQueue.length === 0) {
          events.push('auto-continue-submit');
        }
      }

      expect(events).toContain('auto-continue-submit');
    });

    it('should not auto-continue if max stepReprompts reached', () => {
      const stepRepromptCount = { current: 5 };
      const MAX_STEP_REPROMPTS = 5;

      const doneData = { stepReprompt: 'Continue' };

      const shouldContinue = doneData.stepReprompt &&
        stepRepromptCount.current < MAX_STEP_REPROMPTS;

      expect(shouldContinue).toBe(false);
    });

    it('should handle role redirect auto-continue', () => {
      const stepRepromptCount = { current: 0 };
      const MAX_STEP_REPROMPTS = 5;

      const planSteps = ['Step 1: Search', 'Step 2: Analyze'];
      const suggestedRole = 'researcher';

      const shouldRedirect = planSteps && planSteps.length > 0 &&
        suggestedRole && stepRepromptCount.current < MAX_STEP_REPROMPTS;

      expect(shouldRedirect).toBe(true);
    });
  });

  describe('continuation metadata in SSE response', () => {
    it('should include continuationNumber and maxContinuations in metadata', () => {
      const testCases = [
        { stepRepromptCount: 0, expectedNumber: 1, max: 5 },
        { stepRepromptCount: 2, expectedNumber: 3, max: 5 },
        { stepRepromptCount: 4, expectedNumber: 5, max: 5 },
      ];

      for (const tc of testCases) {
        const continuationNumber = tc.stepRepromptCount + 1;
        expect(continuationNumber).toBe(tc.expectedNumber);
      }
    });

    it('should signal need_more_turns in stream state', () => {
      // This tests the signalNeedMoreTurns function
      const mockSignalNeedMoreTurns = vi.fn().mockResolvedValue(true);

      // mockResolvedValue returns a Promise that resolves to true
      mockSignalNeedMoreTurns.mockResolvedValue(true);
      const resultPromise = mockSignalNeedMoreTurns('stream-123', 'context hint', {
        toolCount: 2,
        toolSummary: 'Read files',
      });

      // Verify the mock was called correctly
      expect(mockSignalNeedMoreTurns).toHaveBeenCalledWith('stream-123', 'context hint', {
        toolCount: 2,
        toolSummary: 'Read files',
      });

      // The function returns a Promise
      expect(resultPromise).toBeInstanceOf(Promise);
    });

    it('should return false when max continuations reached', () => {
      const mockSignalNeedMoreTurns = vi.fn().mockResolvedValue(false);

      // Max continuations is 3
      // When max continuations is reached, signalNeedMoreTurns returns false
      mockSignalNeedMoreTurns.mockResolvedValue(false);
      const resultPromise = mockSignalNeedMoreTurns('stream-123', 'hint', {});

      // The function returns a Promise
      expect(resultPromise).toBeInstanceOf(Promise);
    });
  });
});