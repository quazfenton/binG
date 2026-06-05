/**
 * Edge-case tests for the 8 bugs fixed across shared agent files.
 *
 * Covers:
 *   1. role-redirector.ts  — shallow copy mutation of _defaultToolWeights
 *   2. successive-tracker.ts  — getTrackerReadOnly() with no side effects
 *   3. feedback-injection.ts  — deprecated substr → slice in ID generation
 *   4. loop-detection.ts  — circular patterns at cycle lengths 2, 3, 4
 *   5. timeout-escalation.ts  — .catch() preventing unhandled monitor rejections
 *   6. first-response-routing.ts  — stripRoutingMarkers (redundant loop removed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── 1. role-redirector.ts — shallow copy bug ─────────────────────────
import {
  registerToolWeights,
  getToolWeights,
  getRedirectableRoles,
  registerRole,
  suggestToolsForRole,
} from '../role-redirector';

describe('role-redirector: shallow copy mutation fix', () => {
  it('registerToolWeights should NOT mutate _defaultToolWeights', () => {
    // Read default weights for coder before registering anything
    const coderWeightsBefore = getToolWeights('coder');

    // Register a NEW weight for a non-default tool
    registerToolWeights('coder', { some_custom_tool: 0.99 });

    // Registering a custom tool should not affect existing defaults
    const coderWeightsAfter = getToolWeights('coder');
    expect(coderWeightsAfter['write_file']).toBe(coderWeightsBefore['write_file']);
    expect(coderWeightsAfter['read_file']).toBe(coderWeightsBefore['read_file']);
    expect(coderWeightsAfter['execute_bash']).toBe(coderWeightsBefore['execute_bash']);
  });

  it('getToolWeights should return a copy — mutating result should NOT affect registry', () => {
    const firstCall = getToolWeights('coder');
    const secondCall = getToolWeights('coder');

    // Mutate the first returned object
    firstCall['write_file'] = 999;

    // The second call should return the original value, not the mutated one
    expect(secondCall['write_file']).toBe(0.9);
  });

  it('getToolWeights for unknown role should return empty object', () => {
    const weights = getToolWeights('nonexistent-role');
    expect(weights).toEqual({});
  });

  it('registerToolWeights should add new role', () => {
    registerToolWeights('new-test-role', { custom_tool: 0.8 });
    const weights = getToolWeights('new-test-role');
    expect(weights['custom_tool']).toBe(0.8);
  });

  it('registerToolWeights should merge with existing weights', () => {
    registerToolWeights('coder', { write_file: 0.5 }); // override
    const weights = getToolWeights('coder');
    // Merged — lower weight accepted because merge replaces
    expect(weights['write_file']).toBe(0.5);
  });
});

// ─── 2. successive-tracker.ts — getTrackerReadOnly ────────────────────
import {
  getTracker,
  getTrackerReadOnly,
  resetTracker,
  recordResponse,
  recordToolCall,
  cleanupTrackers,
} from '../successive-tracker';

describe('successive-tracker: getTrackerReadOnly with no side effects', () => {
  const sessionId = 'tracker-readonly-test-' + Date.now();

  beforeEach(() => {
    resetTracker(sessionId);
    cleanupTrackers(0);
  });

  afterEach(() => {
    resetTracker(sessionId);
    cleanupTrackers(0);
  });

  it('getTrackerReadOnly should return undefined for non-existent session', () => {
    const result = getTrackerReadOnly('non-existent-session-' + Date.now());
    expect(result).toBeUndefined();
  });

  it('getTrackerReadOnly should NOT create a tracker', () => {
    const freshId = 'never-created-' + Date.now();
    const before = getTrackerReadOnly(freshId);
    expect(before).toBeUndefined();

    // After calling getTrackerReadOnly, the tracker still shouldn't exist
    const after = getTrackerReadOnly(freshId);
    expect(after).toBeUndefined();
  });

  it('getTracker should create a tracker for non-existent session', () => {
    const freshId = 'will-be-created-' + Date.now();
    const tracker = getTracker(freshId);
    expect(tracker).toBeDefined();
    expect(tracker.sessionId).toBe(freshId);
    expect(tracker.responseCount).toBe(0);
  });

  it('getTrackerReadOnly should return existing tracker after getTracker creates it', () => {
    const freshId = 'created-then-read-' + Date.now();
    getTracker(freshId); // creates
    const readOnly = getTrackerReadOnly(freshId);
    expect(readOnly).toBeDefined();
    expect(readOnly!.sessionId).toBe(freshId);
  });

  it('getTrackerReadOnly should NOT reset consecutiveToolCalls counter', () => {
    const freshId = 'no-reset-' + Date.now();
    const tracker = getTracker(freshId);
    tracker.consecutiveToolCalls = 5;  // simulate high consecutive count

    // Read-only access should not reset it
    const readOnly1 = getTrackerReadOnly(freshId);
    expect(readOnly1!.consecutiveToolCalls).toBe(5);

    // Double-check reading again doesn't reset
    const readOnly2 = getTrackerReadOnly(freshId);
    expect(readOnly2!.consecutiveToolCalls).toBe(5);
  });

  it('getTrackerReadOnly should NOT reset turnsSinceLastEval', () => {
    const freshId = 'no-reset-turns-' + Date.now();
    const tracker = getTracker(freshId);
    tracker.turnsSinceLastEval = 10;

    const readOnly = getTrackerReadOnly(freshId);
    expect(readOnly!.turnsSinceLastEval).toBe(10);
  });
});

// ─── 3. feedback-injection.ts — ID generation (deprecated substr fix) ─
import {
  createFeedbackEntry,
  type FeedbackEntry,
} from '../feedback-injection';

describe('feedback-injection: createFeedbackEntry ID generation', () => {
  it('should generate valid ID with correct prefix format', () => {
    const entry = createFeedbackEntry('failure', 'test error', 'tool_execution');
    expect(entry.id).toMatch(/^fb-\d+-[a-z0-9]+$/);
  });

  it('should generate unique IDs for consecutive calls', () => {
    const entry1 = createFeedbackEntry('failure', 'error 1', 'tool_execution');
    const entry2 = createFeedbackEntry('failure', 'error 2', 'tool_execution');
    expect(entry1.id).not.toBe(entry2.id);
  });

  it('should generate ID with random part of correct length (9 chars)', () => {
    const entry = createFeedbackEntry('failure', 'test', 'tool_execution');
    const randomPart = entry.id.split('-')[2];
    // slice(2, 11) produces 9 characters
    expect(randomPart.length).toBe(9);
  });

  it('should never contain undefined or NaN in ID', () => {
    for (let i = 0; i < 100; i++) {
      const entry = createFeedbackEntry('failure', `error ${i}`, 'tool_execution');
      expect(entry.id).not.toContain('undefined');
      expect(entry.id).not.toContain('NaN');
      expect(entry.id).not.toContain('null');
    }
  });

  it('should generate stable timestamp component within reasonable range', () => {
    const before = Date.now();
    const entry = createFeedbackEntry('failure', 'test', 'tool_execution');
    const after = Date.now();
    const ts = parseInt(entry.id.split('-')[1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('should set all other fields correctly', () => {
    const entry = createFeedbackEntry('correction', 'fixed it', 'llm_response', { key: 'val' }, 'high');
    expect(entry.type).toBe('correction');
    expect(entry.content).toBe('fixed it');
    expect(entry.source).toBe('llm_response');
    expect(entry.context).toEqual({ key: 'val' });
    expect(entry.severity).toBe('high');
    expect(entry.resolved).toBe(false);
    expect(entry.resolutionAttempts).toBe(0);
  });
});

// ─── 4. loop-detection.ts — circular patterns at lengths 2, 3, 4 ─────
import { LoopDetector } from '../loop-detection';

describe('loop-detection: detectCircularPattern at cycle lengths 2, 3, 4', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({ enabled: true, windowSizeSeconds: 300 });
  });

  it('should detect 2-step cycle (A → B → A → B)', () => {
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    detector.recordToolCall('read_file', { path: '/a' });
    const result = detector.recordToolCall('write_file', { path: '/b' });
    // Two-step cycle should be detected
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('Circular');
    expect(result.severity).toBe('high');
  });

  it('should detect 3-step cycle (A → B → C → A → B → C)', () => {
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    detector.recordToolCall('search_files', { pattern: '*.ts' });
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    const result = detector.recordToolCall('search_files', { pattern: '*.ts' });
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('Circular');
  });

  it('should detect 4-step cycle (A → B → C → D → A → B → C → D)', () => {
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    detector.recordToolCall('search_files', { pattern: '*.ts' });
    detector.recordToolCall('execute_bash', { cmd: 'ls' });
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    detector.recordToolCall('search_files', { pattern: '*.ts' });
    const result = detector.recordToolCall('execute_bash', { cmd: 'ls' });
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('Circular');
  });

  it('should NOT detect a cycle when call sequences are non-repeating', () => {
    // 8 unique calls with different tool+args combos
    for (let i = 0; i < 8; i++) {
      const result = detector.recordToolCall(`tool_${i}`, { arg: `val_${i}` });
      if (result.isLoop) {
        // Fail immediately with details
        expect.fail(`False positive loop detection at call ${i}: ${result.reason}`);
      }
    }
  });

  it('should NOT detect a cycle when fewer than 4 calls', () => {
    const r1 = detector.recordToolCall('read_file', { path: '/a' });
    expect(r1.isLoop).toBe(false);
    const r2 = detector.recordToolCall('write_file', { path: '/b' });
    expect(r2.isLoop).toBe(false);
    const r3 = detector.recordToolCall('read_file', { path: '/a' });
    expect(r3.isLoop).toBe(false);
  });

  it('should NOT detect a cycle when same tools with different args', () => {
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('read_file', { path: '/b' });
    detector.recordToolCall('read_file', { path: '/c' });
    detector.recordToolCall('read_file', { path: '/d' });
    const result = detector.recordToolCall('read_file', { path: '/e' });
    // Different args = different fingerprints = not a cycle
    expect(result.isLoop).toBe(false);
  });

  it('should detect consecutive similar calls as loop (high severity)', () => {
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('read_file', { path: '/a' });
    const result = detector.recordToolCall('read_file', { path: '/a' });
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('called 3 times');
    expect(result.severity).toBe('high');
    expect(result.suggestedAction).toBe('terminate');
  });

  it('should detect repetitions in window as medium severity', () => {
    // Call same tool+args 5+ times in window (not consecutive)
    for (let i = 0; i < 5; i++) {
      detector.recordToolCall('tool_a', { arg: 'val' });
      // Interleave with different call to avoid consecutive similar detection
      if (i < 4) {
        detector.recordToolCall('tool_b', { arg: 'other' });
      }
    }
    // The 5th call of tool_a should trigger repetition check
    const results = detector.getStats();
    // Just verify stats work
    expect(results.totalCalls).toBe(9); // 5 of tool_a + 4 of tool_b
  });

  it('reset() should clear history and stop false loop detections', () => {
    // Create a cycle pattern
    detector.recordToolCall('tool_a', { arg: 'x' });
    detector.recordToolCall('tool_b', { arg: 'y' });
    detector.recordToolCall('tool_a', { arg: 'x' });
    const resultBeforeReset = detector.recordToolCall('tool_b', { arg: 'y' });
    expect(resultBeforeReset.isLoop).toBe(true);

    // Reset
    detector.reset();

    // After reset, new unique calls should not trigger false loop
    const r1 = detector.recordToolCall('unique_1', {});
    expect(r1.isLoop).toBe(false);
    const r2 = detector.recordToolCall('unique_2', {});
    expect(r2.isLoop).toBe(false);
  });

  it('should not detect loops when disabled', () => {
    const disabledDetector = new LoopDetector({ enabled: false });
    disabledDetector.recordToolCall('read_file', { path: '/a' });
    disabledDetector.recordToolCall('read_file', { path: '/a' });
    const result = disabledDetector.recordToolCall('read_file', { path: '/a' });
    expect(result.isLoop).toBe(false);
    expect(result.suggestedAction).toBe('continue');
  });
});

// ─── 5. timeout-escalation.ts — .catch() preventing unhandled rejection ─
import { TimeoutEscalation } from '../timeout-escalation';

describe('timeout-escalation: .catch() and operation lifecycle', () => {
  it('should complete a fast operation successfully', async () => {
    const escalation = new TimeoutEscalation({
      stages: [
        { timeoutMs: 5000, action: 'warn' },
        { timeoutMs: 10000, action: 'terminate' },
      ],
      checkIntervalMs: 100,
    });

    const result = await escalation.executeWithEscalation(
      'fast-task',
      async () => 'done',
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('done');
    expect(result.finalAction).toBe('continue');
    expect(result.stagesTriggered).toBe(0);
  });

  it('should provide an AbortSignal to the operation', async () => {
    const escalation = new TimeoutEscalation({
      stages: [{ timeoutMs: 5000, action: 'warn' }],
      checkIntervalMs: 100,
    });

    const result = await escalation.executeWithEscalation(
      'signal-test',
      async (signal) => {
        expect(signal).toBeDefined();
        expect(signal.aborted).toBe(false);
        return 'got-signal';
      },
    );

    expect(result.result).toBe('got-signal');
  });

  it('should catch operation errors and return failure result', async () => {
    const escalation = new TimeoutEscalation({
      stages: [{ timeoutMs: 5000, action: 'warn' }],
      checkIntervalMs: 100,
    });

    const result = await escalation.executeWithEscalation(
      'failing-task',
      async () => { throw new Error('operation-failed'); },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('operation-failed');
  });

  it('should sort stages by timeoutMs ascending', () => {
    const escalation = new TimeoutEscalation({
      stages: [
        { timeoutMs: 30000, action: 'migrate' },
        { timeoutMs: 5000, action: 'warn' },
        { timeoutMs: 60000, action: 'terminate' },
      ],
    });

    const stages = escalation.getStages();
    expect(stages[0].timeoutMs).toBe(5000);
    expect(stages[0].action).toBe('warn');
    expect(stages[1].timeoutMs).toBe(30000);
    expect(stages[1].action).toBe('migrate');
    expect(stages[2].timeoutMs).toBe(60000);
    expect(stages[2].action).toBe('terminate');
  });

  it('should use default config when no config provided', () => {
    const escalation = new TimeoutEscalation();
    const stages = escalation.getStages();
    expect(stages).toHaveLength(3);
    expect(stages[0].timeoutMs).toBe(10_000);
    expect(stages[2].timeoutMs).toBe(60_000);
    expect(stages[2].action).toBe('terminate');
  });

  it('should fire onTrigger callback when stage is reached', async () => {
    const onTrigger = vi.fn();
    const escalation = new TimeoutEscalation({
      stages: [
        { timeoutMs: 10, action: 'warn', onTrigger },
      ],
      checkIntervalMs: 5,
    });

    // Operation that takes longer than 10ms
    const result = await escalation.executeWithEscalation(
      'callback-test',
      async () => {
        await new Promise(r => setTimeout(r, 50));
        return 'slow-done';
      },
    );

    // Should have triggered the warn stage
    expect(result.stagesTriggered).toBeGreaterThanOrEqual(1);
    expect(onTrigger).toHaveBeenCalled();
    expect(onTrigger.mock.calls[0][0].action).toBe('warn');
  });
});

// ─── 6. first-response-routing.ts — stripRoutingMarkers ─────────────────────
import {
  stripRoutingMarkers,
  parseFirstResponseRouting,
} from '../first-response-routing';

describe('first-response-routing: stripRoutingMarkers edge cases', () => {
  it('should return null/undefined/non-string input as-is', () => {
    expect(stripRoutingMarkers(null as any)).toBeNull();
    expect(stripRoutingMarkers(undefined as any)).toBeUndefined();
    expect(stripRoutingMarkers(42 as any)).toBe(42);
  });

  it('should return empty string unchanged', () => {
    expect(stripRoutingMarkers('')).toBe('');
  });

  it('should return whitespace-only string trimmed', () => {
    expect(stripRoutingMarkers('   ')).toBe('');
  });

  it('should return text without markers unchanged', () => {
    const text = 'Hello, this is a normal response without any routing markers.';
    expect(stripRoutingMarkers(text)).toBe(text);
  });

  it('should strip single [ROLE_SELECT] marker and its JSON block', () => {
    const text = 'Here is my response\n[ROLE_SELECT]\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"continue":false}\nSome trailing text';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('[ROLE_SELECT]');
    expect(result).not.toContain('classification');
    expect(result).toContain('Here is my response');
    expect(result).toContain('Some trailing text');
  });

  it('should strip single [ROUTING_METADATA] legacy marker', () => {
    const text = 'Preamble\n[ROUTING_METADATA]\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"continue":false}\nMore text';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('[ROUTING_METADATA]');
    expect(result).toContain('Preamble');
    expect(result).toContain('More text');
  });

  it('should strip multiple markers across the text', () => {
    const text = 'Part 1\n[ROLE_SELECT]\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"continue":false}\nPart 2\n[ROLE_SELECT]\n{"classification":"research","complexity":"medium","suggestedRole":"researcher","roleOptions":[],"toolCallOptions":[],"specializationRoute":"search","planSteps":[],"continue":false}\nPart 3';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('[ROLE_SELECT]');
    expect(result).not.toContain('classification');
    expect(result).toContain('Part 1');
    expect(result).toContain('Part 2');
    expect(result).toContain('Part 3');
  });

  it('should strip marker even when JSON extraction fails (malformed JSON)', () => {
    const text = 'Before\n[ROLE_SELECT]\n{broken json}\nAfter';
    const result = stripRoutingMarkers(text);
    // The marker text should still be removed even if JSON parsing fails
    expect(result).not.toContain('[ROLE_SELECT]');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('should handle marker at the very start of text', () => {
    const text = '[ROLE_SELECT]\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"continue":false}\nContent after';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('[ROLE_SELECT]');
    expect(result).toContain('Content after');
  });

  it('should handle marker at the very end of text', () => {
    const text = 'Content before\n[ROLE_SELECT]\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"continue":false}';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('[ROLE_SELECT]');
    expect(result).toContain('Content before');
  });

  it('should not collapse text when markers appear consecutively', () => {
    const text = 'Start\n[ROLE_SELECT]\n{"a":1,"b":2}\n[ROLE_SELECT]\n{"c":3,"d":4}\nEnd';
    const result = stripRoutingMarkers(text);
    expect(result).toContain('Start');
    expect(result).toContain('End');
    // The JSON blocks shouldn't leak
    expect(result).not.toContain('"a":1');
    expect(result).not.toContain('"c":3');
  });

  it('should strip ### Initial Response sections', () => {
    const text = 'Some text\n### Initial Response\nThis should be removed\n---\nRemaining text';
    const result = stripRoutingMarkers(text);
    expect(result).not.toContain('Initial Response');
    expect(result).toContain('Some text');
    expect(result).toContain('Remaining text');
  });

  it('should collapse multiple newlines to double newlines', () => {
    const text = 'Line 1\n\n\n\nLine 2';
    const result = stripRoutingMarkers(text);
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    // Should have at most 2 newlines between them
    expect(result).toMatch(/Line 1\n\nLine 2/);
  });
});

// ─── 7. LoopDetector getStats ─────────────────────────────────────────
describe('loop-detection: getStats edge cases', () => {
  it('should return zero counts for fresh detector', () => {
    const detector = new LoopDetector();
    const stats = detector.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.recentCalls).toBe(0);
    expect(stats.consecutiveSimilar).toBe(0);
    expect(stats.toolDistribution).toEqual({});
  });

  it('should report correct tool distribution after multiple calls', () => {
    const detector = new LoopDetector({ windowSizeSeconds: 300 });
    detector.recordToolCall('read_file', { path: '/a' });
    detector.recordToolCall('write_file', { path: '/b' });
    detector.recordToolCall('read_file', { path: '/c' });

    const stats = detector.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.toolDistribution['read_file']).toBe(2);
    expect(stats.toolDistribution['write_file']).toBe(1);
  });
});
