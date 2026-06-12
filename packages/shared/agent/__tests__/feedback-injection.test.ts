/**
 * Unit Tests for injectFeedback and generateTrackerSummary
 * 
 * Tests the feedback injection system functions that enable self-routing
 * via prompt engineering in the unified-agent-service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFeedbackEntry,
  addFeedback,
  injectFeedback,
  analyzeFailure,
  generateCorrectionPrompt,
  detectHealingTrigger,
  type FeedbackContext,
  type FeedbackEntry,
  type InjectedFeedback,
} from '../feedback-injection';

import {
  getTracker,
  resetTracker,
  recordResponse,
  recordToolCall,
  recordReEval,
  checkReEvalTrigger,
  generateTrackerSummary,
  cleanupTrackers,
} from '../successive-tracker';

describe('injectFeedback', () => {
  const testSessionId = 'inject-feedback-test-' + Date.now();

  beforeEach(() => {
    resetTracker(testSessionId);
  });

  afterEach(() => {
    resetTracker(testSessionId);
  });

  describe('returns empty feedback when no failures', () => {
    it('should return empty strings when context has no failures or corrections', () => {
      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 0,
        accumulatedFeedback: [],
        recentFailures: [],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.correctionSection).toBe('');
      expect(result.healingInstructions).toBe('');
      expect(result.formatGuidance).toBe('');
      expect(result.roleRedirectSection).toBeUndefined();
    });

    it('should return empty feedback even with accumulatedFeedback but no recentFailures', () => {
      const resolvedFailure = createFeedbackEntry(
        'failure',
        'Previous resolved failure',
        'tool_execution',
        {},
        'medium'
      );
      (resolvedFailure as any).resolved = true;

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [resolvedFailure],
        recentFailures: [], // Empty - failures are resolved
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.correctionSection).toBe('');
      expect(result.healingInstructions).toBe('');
    });
  });

  describe('generates correction section from failures', () => {
    it('should generate correction section with single failure', () => {
      const failure = createFeedbackEntry(
        'failure',
        'Tool execution failed: command not found - bash ls /invalid',
        'tool_execution',
        { toolName: 'bash', command: 'ls /invalid' },
        'high'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [failure],
        recentFailures: [failure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.correctionSection).toContain('## Feedback & Corrections');
      expect(result.correctionSection).toContain('FAILURE');
      expect(result.correctionSection).toContain('tool_execution');
      expect(result.correctionSection).toContain('**Fix:**');
    });

    it('should include multiple failures in correction section', () => {
      const failure1 = createFeedbackEntry(
        'failure',
        'Tool execution failed: permission denied on /root',
        'tool_execution',
        { toolName: 'bash', error: 'EACCES' },
        'high'
      );
      const failure2 = createFeedbackEntry(
        'failure',
        'Tool execution failed: command failed with exit code 1',
        'tool_execution',
        { toolName: 'npm', exitCode: 1 },
        'medium'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 2,
        accumulatedFeedback: [failure1, failure2],
        recentFailures: [failure1, failure2],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.correctionSection).toContain('permission denied');
      expect(result.correctionSection).toContain('exit code 1');
    });

    it('should limit to last 5 failures in correction section', () => {
      const failures: FeedbackEntry[] = [];
      for (let i = 0; i < 7; i++) {
        failures.push(
          createFeedbackEntry(
            'failure',
            `Failure ${i + 1}`,
            'tool_execution',
            { index: i },
            'medium'
          )
        );
      }

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 7,
        accumulatedFeedback: failures,
        recentFailures: failures,
        corrections: [],
      };

      const result = injectFeedback(context);

    // Should only include last 5 (Failure 3-7)
    for (let i = 3; i <= 7; i++) {
      expect(result.correctionSection).toContain(`Failure ${i}`);
    }
    });
  });

  describe('generates healing instructions from failures', () => {
    it('should generate healing instructions section', () => {
      const failure = createFeedbackEntry(
        'failure',
        'Tool execution failed: timeout after 30 seconds',
        'tool_execution',
        { toolName: 'bash', timeout: 30000 },
        'high'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [failure],
        recentFailures: [failure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.healingInstructions).toContain('## Healing Instructions');
      expect(result.healingInstructions).toContain('Apply these steps');
    });

    it('should include healing steps for each failure', () => {
      const toolFailure = createFeedbackEntry(
        'failure',
        'Tool execution failed: command not found',
        'tool_execution',
        { toolName: 'bash' },
        'high'
      );
      const formatFailure = createFeedbackEntry(
        'failure',
        'Format mismatch: expected JSON but received text',
        'validation',
        { expected: 'JSON', actual: 'text' },
        'medium'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 2,
        accumulatedFeedback: [toolFailure, formatFailure],
        recentFailures: [toolFailure, formatFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.healingInstructions).toContain('Verify tool is available');
      expect(result.healingInstructions).toContain('Review expected output format');
    });

    it('should include severity-based instructions', () => {
      const criticalFailure = createFeedbackEntry(
        'failure',
        'Critical system error: segmentation fault',
        'tool_execution',
        { severity: 'system' },
        'critical'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [criticalFailure],
        recentFailures: [criticalFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.healingInstructions).toContain('IMMEDIATELY STOP');
    });
  });

  describe('generates format guidance for format mismatches', () => {
    it('should include format guidance when format mismatch is detected', () => {
      // Use 'validation' source to avoid being categorized as 'tool_execution'
      // This allows the format patterns to be matched
      const formatFailure = createFeedbackEntry(
        'failure',
        'Format mismatch: expected JSON but received HTML',
        'validation',
        { expectedFormat: 'JSON', actualFormat: 'HTML' },
        'medium'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [formatFailure],
        recentFailures: [formatFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.formatGuidance).toContain('## Format Requirements');
      expect(result.formatGuidance).toContain('IMPORTANT');
      expect(result.formatGuidance).toContain('Validate structure');
    });

    it('should not include format guidance when no format mismatches', () => {
      const toolFailure = createFeedbackEntry(
        'failure',
        'Tool execution failed: command not found',
        'tool_execution',
        {},
        'medium'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [toolFailure],
        recentFailures: [toolFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.formatGuidance).toBe('');
    });
  });

  describe('generates role redirect section for critical failures', () => {
    it('should include role redirect section for critical failures', () => {
      const criticalFailure = createFeedbackEntry(
        'failure',
        'Critical tool failure: bash segfault',
        'tool_execution',
        { error: 'segfault' },
        'critical'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [criticalFailure],
        recentFailures: [criticalFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.roleRedirectSection).toBeDefined();
      expect(result.roleRedirectSection).toContain('## Role Redirect Options');
      expect(result.roleRedirectSection).toContain('specialist');
      expect(result.roleRedirectSection).toContain('debugger');
    });

    it('should include default role redirect section even for low severity failures', () => {
      // The injectFeedback function always generates a role redirect section
      // (with default role options) to support dynamic first-response routing,
      // even when no failure-based redirects are suggested.
      const lowSeverityFailure = createFeedbackEntry(
        'failure',
        'Minor issue with response format',
        'llm_response',
        {},
        'low'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 1,
        accumulatedFeedback: [lowSeverityFailure],
        recentFailures: [lowSeverityFailure],
        corrections: [],
      };

      const result = injectFeedback(context);

      expect(result.roleRedirectSection).toBeDefined();
      expect(result.roleRedirectSection).toContain('## Role Redirect Options');
      expect(result.roleRedirectSection).toContain('coder');
    });
  });

  describe('handles corrections in context', () => {
    it('should include correction tracking in feedback', () => {
      const failure = createFeedbackEntry(
        'failure',
        'Tool execution failed: command not found',
        'tool_execution',
        {},
        'high'
      );
      const correction = createFeedbackEntry(
        'correction',
        'Used sudo to execute command with elevated privileges - success',
        'llm_response',
        { solution: 'sudo' },
        'low'
      );

      const context: FeedbackContext = {
        sessionId: testSessionId,
        turnNumber: 2,
        accumulatedFeedback: [failure, correction],
        recentFailures: [failure],
        corrections: [correction],
      };

      const result = injectFeedback(context);

      // Corrections don't appear in correctionSection (only failures)
      // But they are tracked in context for statistics
      expect(result.correctionSection).toContain('FAILURE');
      expect(result.correctionSection).not.toContain('sudo'); // correction is separate
    });
  });
});

describe('generateTrackerSummary', () => {
  const testSessionId = 'tracker-summary-test-' + Date.now();

  beforeEach(() => {
    resetTracker(testSessionId);
    cleanupTrackers(0); // Clean all for test isolation
  });

  afterEach(() => {
    resetTracker(testSessionId);
    cleanupTrackers(0);
  });

  describe('returns empty string for new tracker', () => {
    it('should return empty string when no interactions recorded', () => {
      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toBe('');
    });
  });

  describe('generates summary with responses', () => {
    it('should include response count in summary', () => {
      recordResponse(testSessionId, 500, true);
      recordResponse(testSessionId, 300, true);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Responses: 2');
    });

    it('should track responses accurately', () => {
      for (let i = 0; i < 5; i++) {
        recordResponse(testSessionId, 100 + i * 50, true);
      }

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Responses: 5');
    });
  });

  describe('generates summary with tool calls', () => {
    it('should include tool call count in summary', () => {
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Tool calls: 3');
    });

    it('should track consecutive tool calls', () => {
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      // Record a response to reset consecutive count
      recordResponse(testSessionId, 200, true);
      recordToolCall(testSessionId);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Consecutive tools: 1'); // Reset after response
    });
  });

  describe('generates summary with re-evaluation tracking', () => {
    it('should include turns since re-eval in summary', () => {
      recordResponse(testSessionId, 300, true);
      recordResponse(testSessionId, 200, true);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Turns since re-eval: 2');
    });

    it('should track re-evaluation count', () => {
      recordReEval(testSessionId);
      recordResponse(testSessionId, 100, true);
      recordReEval(testSessionId);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Re-evaluations: 2');
    });

    it('should reset turns counter after re-eval', () => {
      recordResponse(testSessionId, 100, true);
      recordResponse(testSessionId, 100, true);
      recordResponse(testSessionId, 100, true);
      recordReEval(testSessionId);
      recordResponse(testSessionId, 100, true);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Turns since re-eval: 1'); // Reset after reEval
    });
  });

  describe('includes complete interaction summary', () => {
    it('should format complete summary with all metrics', () => {
      // Simulate a typical interaction
      recordResponse(testSessionId, 100, false); // First response failed
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      recordResponse(testSessionId, 400, true); // Second response success
      recordToolCall(testSessionId);
      recordToolCall(testSessionId);
      recordReEval(testSessionId);
      recordResponse(testSessionId, 300, true);

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('### Interaction Summary');
      expect(summary).toContain('Responses: 3');
      expect(summary).toContain('Tool calls: 5');
      expect(summary).toContain('Re-evaluations: 1');
    });

    it('should handle high activity sessions', () => {
      // Simulate high activity
      for (let i = 0; i < 20; i++) {
        recordToolCall(testSessionId);
      }
      for (let i = 0; i < 10; i++) {
        recordResponse(testSessionId, 200 + i * 20, i % 3 !== 0);
      }
      for (let i = 0; i < 5; i++) {
        recordReEval(testSessionId);
      }

      const summary = generateTrackerSummary(testSessionId);

      expect(summary).toContain('Responses: 10');
      expect(summary).toContain('Tool calls: 20');
      expect(summary).toContain('Re-evaluations: 5');
    });
  });
});

describe('integrated feedback injection with tracker', () => {
  const testSessionId = 'integrated-test-' + Date.now();

  beforeEach(() => {
    resetTracker(testSessionId);
    cleanupTrackers(0);
  });

  afterEach(() => {
    resetTracker(testSessionId);
    cleanupTrackers(0);
  });

  it('should combine feedback and tracker summary for self-routing', () => {
    // Simulate a failing session
    const failure1 = createFeedbackEntry(
      'failure',
      'Tool execution failed: permission denied on /root/.npm',
      'tool_execution',
      { toolName: 'npm', command: 'npm install', error: 'EACCES' },
      'high'
    );
    const failure2 = createFeedbackEntry(
      'failure',
      'Tool execution failed: npm command failed again',
      'tool_execution',
      { toolName: 'npm', error: 'EACCES' },
      'high'
    );

    let context: FeedbackContext = {
      sessionId: testSessionId,
      turnNumber: 0,
      accumulatedFeedback: [],
      recentFailures: [],
      corrections: [],
    };

    context = addFeedback(context, failure1);
    context = addFeedback(context, failure2);

    // Track interactions
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordToolCall(testSessionId);
    recordResponse(testSessionId, 150, false);

    // Get feedback injection
    const injectedFeedback = injectFeedback(context);
    const trackerSummary = generateTrackerSummary(testSessionId);

    // Verify feedback is present
    expect(injectedFeedback.correctionSection).toContain('permission denied');
    expect(injectedFeedback.correctionSection).toContain('FAILURE');
    expect(injectedFeedback.healingInstructions).toContain('Healing Instructions');

    // Verify tracker summary is present
    expect(trackerSummary).toContain('Responses: 1');
    expect(trackerSummary).toContain('Tool calls: 7');
    // After a response, consecutive tool count should be reset and less than total
  expect(trackerSummary).not.toContain('Consecutive tools: 7');
  });

  it('should detect healing trigger based on accumulated feedback', () => {
    const failures: FeedbackEntry[] = [];
    for (let i = 0; i < 3; i++) {
      failures.push(
        createFeedbackEntry(
          'failure',
          'Tool execution failed: same bash command error',
          'tool_execution',
          { error: 'command failed' },
          'high'
        )
      );
    }

    let context: FeedbackContext = {
      sessionId: testSessionId,
      turnNumber: 0,
      accumulatedFeedback: [],
      recentFailures: [],
      corrections: [],
    };

    for (const failure of failures) {
      context = addFeedback(context, failure);
    }

    const trigger = detectHealingTrigger(context, 'response with content', 2);

    expect(trigger.detected).toBe(true);
    expect(trigger.healingMode).toBe('replan');
    expect(trigger.reason).toContain('Stuck in loop');
  });
});

// ============================================================================
// Bug #30 (audit) — checkReEvalTrigger spam regression tests
// ============================================================================
//
// The original `checkReEvalTrigger` emitted a trigger on EVERY tool-call
// multiple of 5 (15, 20, 25, 30, ...) and on every consecutive-tool
// increment above the threshold (7, 8, 9, 10, ...), flooding run.log with
// identical re-eval events. The fix is a category-based dedup Set that's
// cleared only on `recordResponse()` or `recordReEval()` — so a category
// can fire at most once per cycle.

describe('checkReEvalTrigger — Bug #30 spam regression', () => {
  const spamTestSessionId = 'spam-test-' + Date.now();

  beforeEach(() => {
    resetTracker(spamTestSessionId);
    cleanupTrackers(0);
  });

  afterEach(() => {
    resetTracker(spamTestSessionId);
    cleanupTrackers(0);
  });

  it('fires the total-tool-count trigger exactly once across toolCallCount 15..24', () => {
    // Bump the consecutive threshold so the 'consecutive' category
    // never fires — this isolates the 'tools' category for this test.
    for (let i = 0; i < 10; i++) {
      recordToolCall(spamTestSessionId);
    }
    // toolCallCount is now 10 — below the default threshold of 15, so
    // the trigger should NOT have fired yet.
    const t10 = checkReEvalTrigger(spamTestSessionId, { consecutiveToolThreshold: 1000 });
    expect(t10.triggered).toBe(false);

    // 5 more tool calls → toolCallCount = 15 (first crossing).
    recordToolCall(spamTestSessionId);
    recordToolCall(spamTestSessionId);
    recordToolCall(spamTestSessionId);
    recordToolCall(spamTestSessionId);
    recordToolCall(spamTestSessionId);
    const t15 = checkReEvalTrigger(spamTestSessionId, { consecutiveToolThreshold: 1000 });
    expect(t15.triggered).toBe(true);
    expect(t15.reason).toContain('15 total tool calls');
    expect(t15.reason).toContain('total tool calls');

    // Tool calls 16..24 should all be SUPPRESSED — the 'tools' category
    // already fired in this cycle. This is the spam fix: the old code
    // would have fired at 20, 25, 30, 35, ...
    for (let i = 0; i < 9; i++) {
      recordToolCall(spamTestSessionId);
      const t = checkReEvalTrigger(spamTestSessionId, { consecutiveToolThreshold: 1000 });
      expect(t.triggered).toBe(false);
    }

    // toolCallCount is now 24. Exactly one fire across the whole 15..24
    // window — verified.
  });

  it('re-arms the tool-count trigger after recordResponse (new cycle)', () => {
    // First cycle: 16 tool calls, trigger fires at 15, suppressed at 16.
    for (let i = 0; i < 16; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t15 = checkReEvalTrigger(spamTestSessionId);
    expect(t15.triggered).toBe(true);

    // recordResponse clears the Set → re-armed.
    recordResponse(spamTestSessionId, 500, true);

    // Next call → count = 17, above threshold, category not in Set → fires.
    recordToolCall(spamTestSessionId);
    const tNew = checkReEvalTrigger(spamTestSessionId);
    expect(tNew.triggered).toBe(true);
    expect(tNew.reason).toContain('17 total tool calls');
  });

  it('re-arms the tool-count trigger after recordReEval (new cycle)', () => {
    for (let i = 0; i < 15; i++) {
      recordToolCall(spamTestSessionId);
    }
    checkReEvalTrigger(spamTestSessionId); // fires, marks 'tools' as fired

    recordReEval(spamTestSessionId);

    recordToolCall(spamTestSessionId);
    const t = checkReEvalTrigger(spamTestSessionId);
    expect(t.triggered).toBe(true);
    expect(t.reason).toContain('16 total tool calls');
  });

  it('fires the consecutive-tool trigger exactly once per spike', () => {
    // Bump the tool-call threshold so the 'tools' category never fires
    // — this isolates the 'consecutive' category for this test.
    for (let i = 0; i < 10; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t1 = checkReEvalTrigger(spamTestSessionId, { toolCallThreshold: 1000 });
    expect(t1.triggered).toBe(true);
    expect(t1.reason).toContain('consecutive tool calls');

    // 5 more tool calls (consecutive = 15) → category fired, suppressed.
    for (let i = 0; i < 5; i++) {
      recordToolCall(spamTestSessionId);
      const t = checkReEvalTrigger(spamTestSessionId, { toolCallThreshold: 1000 });
      expect(t.triggered).toBe(false);
    }
  });

  it('re-arms trigger categories after recordResponse resets the cycle', () => {
    // First cycle: 7 tool calls (count=7, no 'tools' fire because 7<15).
    // 'consecutive' fires (consecutive=7 >= 7), set={'consecutive'}.
    for (let i = 0; i < 7; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t1 = checkReEvalTrigger(spamTestSessionId);
    expect(t1.triggered).toBe(true);
    expect(t1.reason).toContain('consecutive tool calls');

    // 1 more → 'consecutive' in set, suppressed.
    recordToolCall(spamTestSessionId);
    const t2 = checkReEvalTrigger(spamTestSessionId);
    expect(t2.triggered).toBe(false);

    // recordResponse: clears Set, resets consecutive=0, toolCount=8.
    recordResponse(spamTestSessionId, 200, true);

    // 7 more tool calls: toolCount=15, consecutive=7. The 'tools'
    // check fires first (count=15 >= 15). The Set was cleared by
    // recordResponse, so 'tools' is a fresh fire (not suppressed by
    // a previous cycle). This proves the cycle re-arms.
    for (let i = 0; i < 7; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t3 = checkReEvalTrigger(spamTestSessionId);
    expect(t3.triggered).toBe(true);
    expect(t3.reason).toContain('15 total tool calls');
  });

  it('fires each category at most once per cycle (cross-category isolation)', () => {
    // 14 tool calls: toolCount=14 < 15, so 'tools' check is skipped.
    // 'consecutive' (consecutive=14 >= 7) fires on first check.
    for (let i = 0; i < 14; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t1 = checkReEvalTrigger(spamTestSessionId);
    expect(t1.triggered).toBe(true);
    expect(t1.reason).toContain('consecutive tool calls');

    // 1 more: toolCount=15, now 'tools' can fire. 'consecutive' is in
    // the Set so the 'consecutive' check is suppressed; the 'tools'
    // check fires (different category, not in Set).
    recordToolCall(spamTestSessionId);
    const t2 = checkReEvalTrigger(spamTestSessionId);
    expect(t2.triggered).toBe(true);
    expect(t2.reason).toContain('15 total tool calls');

    // 1 more: toolCount=16, both 'tools' and 'consecutive' in Set.
    // Both checks suppressed, no fire.
    recordToolCall(spamTestSessionId);
    const t3 = checkReEvalTrigger(spamTestSessionId);
    expect(t3.triggered).toBe(false);
  });

  it('fires the low-success-rate trigger exactly once across multiple checks', () => {
    // Drive 5 responses with 1 success (20% success rate) — below the
    // 40% threshold. The 'success' category fires.
    recordResponse(spamTestSessionId, 100, false);  // fail
    recordResponse(spamTestSessionId, 100, false);  // fail
    recordResponse(spamTestSessionId, 100, false);  // fail
    recordResponse(spamTestSessionId, 100, false);  // fail
    recordResponse(spamTestSessionId, 100, true);   // success
    // successRate = 0.2 < 0.4 → fires.
    const t1 = checkReEvalTrigger(spamTestSessionId);
    expect(t1.triggered).toBe(true);
    expect(t1.reason).toContain('Low success rate');

    // Multiple checks should all be SUPPRESSED — the 'success' category
    // already fired. The reason text also changes with successRate
    // ("Low success rate: 20%" then "Low success rate: 17%" then "15%"),
    // so the category-Set is the only way to dedup these.
    for (let i = 0; i < 5; i++) {
      const t = checkReEvalTrigger(spamTestSessionId);
      expect(t.triggered).toBe(false);
    }

    // recordResponse re-arms the 'success' category. The next
    // response drops successRate to 1/6 = 0.17, so the trigger fires
    // again on the next check.
    recordResponse(spamTestSessionId, 100, false);
    const t2 = checkReEvalTrigger(spamTestSessionId);
    expect(t2.triggered).toBe(true);
    expect(t2.reason).toContain('Low success rate');
  });

  it('recordResponse clears firedTriggersThisCycle (rapid-clear verification)', () => {
    // Drives 7 tool calls → 'consecutive' fires. Then 5 rapid
    // recordResponse calls (mimics streaming-chunk per-response). After
    // these, the Set MUST be empty. Then 7 more tool calls prove
    // 'consecutive' can fire again in the new cycle.
    for (let i = 0; i < 7; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t1 = checkReEvalTrigger(spamTestSessionId, { toolCallThreshold: 1000 });
    expect(t1.triggered).toBe(true);
    expect(t1.reason).toContain('consecutive tool calls');

    // Rapid recordResponse calls (mimics streaming).
    for (let i = 0; i < 5; i++) {
      recordResponse(spamTestSessionId, 100, true);
    }

    // If clear() is called per recordResponse, the Set is empty after
    // the 5 calls. If clear() is missing or behind a gate, 'consecutive'
    // would still be in the Set and the next fire would be suppressed.
    for (let i = 0; i < 7; i++) {
      recordToolCall(spamTestSessionId);
    }
    const t2 = checkReEvalTrigger(spamTestSessionId, { toolCallThreshold: 1000 });
    expect(t2.triggered).toBe(true);
    expect(t2.reason).toContain('consecutive tool calls');
  });
});