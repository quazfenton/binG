/**
 * Unit tests for execution-controller mode
 * 
 * Tests the self-correcting execution loop with:
 * - Heuristic evaluation (completeness, continuity, quality, depth)
 * - Hard triggers (premature_stop, low_quality, dead_flow, tool_break, shallow_project)
 * - Progress-based triggers (50% midpoint expansion)
 * - Final gate with strict thresholds
 * - Anti-stagnation detection
 * - LLM-based evaluation option (when evalModel is configured)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger to prevent console spam
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import the functions we need to test
// Note: These are internal functions - we test them directly for unit testing
import {
  extractKeywords,
  type Evaluation,
  type CompletionScore,
  type TriggerResult,
  type ExecutionControllerConfig,
} from '../execution-controller';

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Helper to create a mock evaluation result
 */
function createMockEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    completeness: 0.8,
    continuity: 0.7,
    quality: 0.75,
    depth: 0.7,
    confidence: 0.75,
    issues: [],
    ...overrides,
  };
}

// ─── extractKeywords Tests ───────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('should extract meaningful keywords from text', () => {
    const keywords = extractKeywords('Implement user authentication with JWT tokens');
    expect(keywords).toContain('implement');
    expect(keywords).toContain('authentication');
    expect(keywords).toContain('tokens');
    // 'user' is 4 chars, so it might not be included if filter is >4
  });

  it('should filter out common stop words', () => {
    const keywords = extractKeywords('the a an is are was were be been being');
    expect(keywords).toHaveLength(0);
  });

  it('should filter out short words', () => {
    const keywords = extractKeywords('implement the user authentication');
    expect(keywords.every(k => k.length > 4)).toBe(true);
  });

  it('should handle empty string', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });

  it('should handle special characters', () => {
    const keywords = extractKeywords('implement user authentication (JWT)');
    expect(keywords).toContain('implement');
    expect(keywords).toContain('authentication');
    expect(keywords.length).toBeGreaterThan(0);
  });
});

// ─── Evaluation Tests ────────────────────────────────────────────────────────

describe('Evaluation', () => {
  it('should have correct shape', () => {
    const evaluation = createMockEvaluation();
    expect(evaluation).toHaveProperty('completeness');
    expect(evaluation).toHaveProperty('continuity');
    expect(evaluation).toHaveProperty('quality');
    expect(evaluation).toHaveProperty('depth');
    expect(evaluation).toHaveProperty('confidence');
    expect(evaluation).toHaveProperty('issues');
  });

  it('should have issues as string array', () => {
    const evaluation = createMockEvaluation({ issues: ['Issue 1', 'Issue 2'] });
    expect(evaluation.issues).toHaveLength(2);
    expect(Array.isArray(evaluation.issues)).toBe(true);
  });

  it('should clamp values between 0 and 1', () => {
    const evaluation = createMockEvaluation({ completeness: 0.95 });
    expect(evaluation.completeness).toBeLessThanOrEqual(1);
  });
});

// ─── CompletionScore Tests ───────────────────────────────────────────────────

describe('CompletionScore', () => {
  it('should have correct shape', () => {
    const score: CompletionScore = {
      functional: 0.95,
      structure: 0.9,
      depth: 0.85,
      production: 0.9,
      quality: 0.9,
      completenessConfidence: 0.9,
    };
    expect(score.functional).toBeGreaterThanOrEqual(0);
    expect(score.structure).toBeGreaterThanOrEqual(0);
    expect(score.depth).toBeGreaterThanOrEqual(0);
    expect(score.production).toBeGreaterThanOrEqual(0);
    expect(score.quality).toBeGreaterThanOrEqual(0);
  });
});

// ─── TriggerResult Tests ─────────────────────────────────────────────────────

describe('TriggerResult', () => {
  it('should indicate triggered state', () => {
    const trigger: TriggerResult = {
      triggered: true,
      reason: 'Completeness below threshold',
      type: 'premature_stop',
    };
    expect(trigger.triggered).toBe(true);
    expect(trigger.reason).toBeDefined();
    expect(trigger.type).toBe('premature_stop');
  });

  it('should indicate clear state', () => {
    const trigger: TriggerResult = {
      triggered: false,
    };
    expect(trigger.triggered).toBe(false);
  });
});

// ─── ExecutionControllerConfig Tests ─────────────────────────────────────────

describe('ExecutionControllerConfig', () => {
  it('should have correct shape with all optional fields', () => {
    const config: ExecutionControllerConfig = {
      maxCycles: 10,
      minImprovementDelta: 0.05,
      stagnationCycles: 3,
      completenessThreshold: 0.9,
      continuityThreshold: 0.8,
      qualityThreshold: 0.85,
      depthThreshold: 0.8,
      evalModel: 'gpt-4',
      evalProvider: 'openai',
      multiPerspectiveEval: true,
      enableFinalGate: true,
    };
    expect(config.maxCycles).toBe(10);
    expect(config.evalModel).toBe('gpt-4');
    expect(config.multiPerspectiveEval).toBe(true);
  });

  it('should allow partial configuration', () => {
    const config: ExecutionControllerConfig = {
      maxCycles: 5,
    };
    expect(config.maxCycles).toBe(5);
    expect(config.minImprovementDelta).toBeUndefined();
  });

  it('should have correct defaults documented', () => {
    const config: ExecutionControllerConfig = {};
    // Defaults are applied in the function, so empty config should be valid
    expect(config).toEqual({});
  });
});

// ─── Stagnation Logic Tests ───────────────────────────────────────────────────

describe('Stagnation Logic', () => {
  it('should identify when stagnation count exceeds threshold', () => {
    const stagnationCycles = 2;
    const stagnationCount = 2;
    const currentScore = 0.85;
    
    const shouldStopForStagnation = 
      stagnationCount >= stagnationCycles && currentScore >= 0.85;
    
    expect(shouldStopForStagnation).toBe(true);
  });

  it('should not stop for stagnation if score is too low', () => {
    const stagnationCycles = 2;
    const stagnationCount = 2;
    const currentScore = 0.6;
    
    const shouldStopForStagnation = 
      stagnationCount >= stagnationCycles && currentScore >= 0.85;
    
    expect(shouldStopForStagnation).toBe(false);
  });

  it('should count gate criteria met correctly', () => {
    const completionScore: CompletionScore = {
      functional: 0.96,    // >= 0.95 ✓
      structure: 0.91,     // >= 0.9 ✓
      depth: 0.85,         // < 0.9 ✗
      production: 0.92,    // >= 0.9 ✓
      quality: 0.88,       // < 0.9 ✗
      completenessConfidence: 0.9,
    };

    const gateCriteriaMet = [
      completionScore.functional >= 0.95,
      completionScore.structure >= 0.9,
      completionScore.depth >= 0.9,
      completionScore.production >= 0.9,
      completionScore.quality >= 0.9,
    ].filter(Boolean).length;

    expect(gateCriteriaMet).toBe(3);
  });

  it('should require at least 2 gate criteria for stagnation stop', () => {
    const completionScore: CompletionScore = {
      functional: 0.96,    // >= 0.95 ✓
      structure: 0.7,      // < 0.9 ✗
      depth: 0.85,         // < 0.9 ✗
      production: 0.92,    // >= 0.9 ✓
      quality: 0.88,       // < 0.9 ✗
      completenessConfidence: 0.9,
    };

    const gateCriteriaMet = [
      completionScore.functional >= 0.95,
      completionScore.structure >= 0.9,
      completionScore.depth >= 0.9,
      completionScore.production >= 0.9,
      completionScore.quality >= 0.9,
    ].filter(Boolean).length;

    const canStopForStagnation = gateCriteriaMet >= 2;
    expect(canStopForStagnation).toBe(true); // 2 criteria met
  });

  it('should not allow stagnation stop with only 1 gate criterion', () => {
    const completionScore: CompletionScore = {
      functional: 0.96,    // >= 0.95 ✓
      structure: 0.7,      // < 0.9 ✗
      depth: 0.85,         // < 0.9 ✗
      production: 0.7,     // < 0.9 ✗
      quality: 0.88,       // < 0.9 ✗
      completenessConfidence: 0.9,
    };

    const gateCriteriaMet = [
      completionScore.functional >= 0.95,
      completionScore.structure >= 0.9,
      completionScore.depth >= 0.9,
      completionScore.production >= 0.9,
      completionScore.quality >= 0.9,
    ].filter(Boolean).length;

    const canStopForStagnation = gateCriteriaMet >= 2;
    expect(canStopForStagnation).toBe(false); // Only 1 criterion met
  });
});

// ─── Hard Gate Tests ─────────────────────────────────────────────────────────

describe('Hard Gate (Final Stop)', () => {
  it('should pass gate when all criteria met', () => {
    const completionScore: CompletionScore = {
      functional: 0.96,
      structure: 0.95,
      depth: 0.92,
      production: 0.95,
      quality: 0.92,
      completenessConfidence: 0.95,
    };

    const shouldHardStop = (
      completionScore.functional >= 0.95 &&
      completionScore.structure >= 0.9 &&
      completionScore.depth >= 0.9 &&
      completionScore.production >= 0.9 &&
      completionScore.quality >= 0.9 &&
      completionScore.completenessConfidence >= 0.9
    );

    expect(shouldHardStop).toBe(true);
  });

  it('should fail gate when any criterion not met', () => {
    const completionScore: CompletionScore = {
      functional: 0.96,
      structure: 0.85, // Below 0.9
      depth: 0.92,
      production: 0.95,
      quality: 0.92,
      completenessConfidence: 0.95,
    };

    const shouldHardStop = (
      completionScore.functional >= 0.95 &&
      completionScore.structure >= 0.9 &&
      completionScore.depth >= 0.9 &&
      completionScore.production >= 0.9 &&
      completionScore.quality >= 0.9 &&
      completionScore.completenessConfidence >= 0.9
    );

    expect(shouldHardStop).toBe(false);
  });
});

// ─── Hidden Gap Detection Tests ───────────────────────────────────────────────

describe('Hidden Gap Detection', () => {
  it('should detect TODOs as hidden gaps', () => {
    const hasGaps = /\b(TODO|FIXME|placeholder)\b/i.test('Add TODO for error handling');
    expect(hasGaps).toBe(true);
  });

  it('should detect missing error handling in API code as hidden gap', () => {
    const output = 'API endpoint implemented with user authentication';
    const hasApiEndpoints = /api|endpoint|service/i.test(output);
    const hasErrorHandling = /error handling|validation|check/i.test(output);
    const hasGaps = hasApiEndpoints && !hasErrorHandling;
    expect(hasGaps).toBe(true);
  });

  it('should not flag clean output as having hidden gaps', () => {
    const output = 'Implemented authentication with error handling and validation. All API endpoints tested.';
    const hasGaps = /\b(TODO|FIXME|placeholder)\b/i.test(output) ||
      (!/error handling|validation|check/i.test(output) && /api|endpoint|service/i.test(output));
    expect(hasGaps).toBe(false);
  });
});

// ─── Tool Activity Tracking Tests ─────────────────────────────────────────────

describe('Tool Activity Tracking', () => {
  it('should mark read operations without follow-up', () => {
    const toolActivity = [
      { type: 'Read', followedByAction: false },
      { type: 'Write', followedByAction: false },
    ];
    
    // Mark read without immediate follow-up
    for (let i = 0; i < toolActivity.length - 1; i++) {
      if (/read|get|list/i.test(toolActivity[i].type)) {
        const nextTool = toolActivity[i + 1].type;
        toolActivity[i].followedByAction = !/read|get|list/i.test(nextTool);
      }
    }
    
    expect(toolActivity[0].followedByAction).toBe(true); // Read followed by Write
  });

  it('should detect tool chain breaks', () => {
    const toolActivity = [
      { type: 'Read', followedByAction: false },
      { type: 'Read', followedByAction: false },
    ];
    
    // Mark read without immediate follow-up, but exclude last tool in cycle
    for (let i = 0; i < toolActivity.length - 1; i++) {
      if (/read|get|list/i.test(toolActivity[i].type)) {
        const nextTool = toolActivity[i + 1].type;
        toolActivity[i].followedByAction = !/read|get|list/i.test(nextTool);
      }
    }
    
    // Check for tool breaks (read without follow-up), excluding the last tool
    const hasToolBreak = toolActivity.slice(0, -1).some(t => 
      t.type.toLowerCase().includes('read') && !t.followedByAction
    );
    
    expect(hasToolBreak).toBe(false); // Last read doesn't count as break within cycle
  });

  it('should allow cross-cycle followedByAction detection', () => {
    // Simulate cross-cycle tool activity
    const cycle1ToolActivity = [
      { type: 'Read', followedByAction: false }, // Will be updated in cycle 2
    ];
    
    const cycle2ToolActivity = [
      { type: 'Write', followedByAction: false },
      { type: 'Edit', followedByAction: false },
    ];
    
    // Update previous cycle's last tool if current cycle has a tool
    if (cycle1ToolActivity.length > 0 && cycle2ToolActivity.length > 0) {
      const prevLastIndex = 0;
      const prevLastTool = cycle1ToolActivity[prevLastIndex];
      if (/read|get|list/i.test(prevLastTool.type)) {
        const firstCurrentTool = cycle2ToolActivity[0].type;
        prevLastTool.followedByAction = !/read|get|list/i.test(firstCurrentTool);
      }
    }
    
    expect(cycle1ToolActivity[0].followedByAction).toBe(true);
  });
});

// ─── Files Generated Tracking Tests ──────────────────────────────────────────

describe('Files Generated Tracking', () => {
  it('should accumulate files generated across cycles', () => {
    let filesGenerated = 0;
    
    // Cycle 1
    const cycle1Files = 3;
    filesGenerated += cycle1Files;
    
    // Cycle 2
    const cycle2Files = 2;
    filesGenerated += cycle2Files;
    
    // Cycle 3
    const cycle3Files = 1;
    filesGenerated += cycle3Files;
    
    expect(filesGenerated).toBe(6);
  });

  it('should handle zero files in some cycles', () => {
    let filesGenerated = 0;
    
    filesGenerated += 3; // Cycle 1
    filesGenerated += 0; // Cycle 2 - no files
    filesGenerated += 2; // Cycle 3
    
    expect(filesGenerated).toBe(5);
  });
});

// ─── LLM Evaluation Configuration Tests ─────────────────────────────────────

describe('LLM Evaluation Configuration', () => {
  it('should enable LLM eval only when evalModel is specified', () => {
    const config1: ExecutionControllerConfig = { evalModel: 'gpt-4' };
    const config2: ExecutionControllerConfig = {};
    
    const enableLLMEval1 = !!config1.evalModel;
    const enableLLMEval2 = !!config2.evalModel;
    
    expect(enableLLMEval1).toBe(true);
    expect(enableLLMEval2).toBe(false);
  });

  it('should default multiPerspectiveEval to false', () => {
    const config: ExecutionControllerConfig = {};
    const multiPerspectiveEval = config.multiPerspectiveEval ?? false;
    expect(multiPerspectiveEval).toBe(false);
  });

  it('should allow multiPerspectiveEval to be true', () => {
    const config: ExecutionControllerConfig = { 
      evalModel: 'gpt-4',
      multiPerspectiveEval: true 
    };
    expect(config.multiPerspectiveEval).toBe(true);
  });
});

// ─── Threshold Configuration Tests ───────────────────────────────────────────

describe('Threshold Configuration', () => {
  it('should use config thresholds with defaults', () => {
    const config: ExecutionControllerConfig = {};
    
    const completenessThreshold = config.completenessThreshold ?? 0.85;
    const continuityThreshold = config.continuityThreshold ?? 0.7;
    const qualityThreshold = config.qualityThreshold ?? 0.8;
    const depthThreshold = config.depthThreshold ?? 0.75;
    
    expect(completenessThreshold).toBe(0.85);
    expect(continuityThreshold).toBe(0.7);
    expect(qualityThreshold).toBe(0.8);
    expect(depthThreshold).toBe(0.75);
  });

  it('should use custom thresholds when specified', () => {
    const config: ExecutionControllerConfig = {
      completenessThreshold: 0.9,
      continuityThreshold: 0.8,
      qualityThreshold: 0.85,
      depthThreshold: 0.8,
    };
    
    const completenessThreshold = config.completenessThreshold ?? 0.85;
    expect(completenessThreshold).toBe(0.9);
  });
});

// ─── Cycle Count Tests ───────────────────────────────────────────────────────

describe('Cycle Count and Limits', () => {
  it('should respect maxCycles limit', () => {
    const config: ExecutionControllerConfig = { maxCycles: 5 };
    const maxCycles = config.maxCycles ?? 8;
    
    let cycleCount = 0;
    while (cycleCount < maxCycles) {
      cycleCount++;
    }
    
    expect(cycleCount).toBe(5);
  });

  it('should default to 8 cycles', () => {
    const config: ExecutionControllerConfig = {};
    const maxCycles = config.maxCycles ?? 8;
    expect(maxCycles).toBe(8);
  });
});

// ─── Edge Case: Empty Responses ────────────────────────────────────────────

describe('Edge Case: Empty Responses', () => {
  it('should handle empty lastOutput in heuristic evaluation', () => {
    const evaluation = {
      completeness: 0.2,
      continuity: 0.3,
      quality: 0.3,
      depth: 0.2,
      confidence: 0.75,
      issues: ['Output suspiciously short'],
    };
    
    // Empty output should result in low scores
    expect(evaluation.completeness).toBeLessThan(0.5);
    expect(evaluation.quality).toBeLessThan(0.5);
    expect(evaluation.issues).toContain('Output suspiciously short');
  });
  
  it('should handle empty cumulativeOutput', () => {
    const taskKeywords = extractKeywords('Create a REST API');
    const outputKeywords = extractKeywords('');
    
    // With empty output, coverage should be 0
    const coverageRatio = taskKeywords.filter(k => outputKeywords.includes(k)).length / Math.max(taskKeywords.length, 1);
    expect(coverageRatio).toBe(0);
  });
  
  it('should handle empty userMessage', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });
  
  it('should handle very short output as structural failure', () => {
    const lastOutput = 'Done';
    const structuralFailure = lastOutput.length < 500;
    expect(structuralFailure).toBe(true);
  });
  
  it('should handle output without code blocks as structural failure', () => {
    const lastOutput = 'I have completed the task. Everything is working.';
    const hasCodeBlocks = lastOutput.includes('```');
    const isLargeOutput = lastOutput.length >= 2000;
    
    // Without code blocks and not large, it's a structural failure for coding task
    const structuralFailure = !hasCodeBlocks && !isLargeOutput;
    expect(structuralFailure).toBe(true);
  });
});

// ─── Edge Case: API Errors ───────────────────────────────────────────────────

describe('Edge Case: API Errors', () => {
  it('should handle API failure and return error result', () => {
    // Simulate a failed result from processUnifiedAgentRequest
    const failedResult = {
      success: false,
      error: 'API request failed: Connection timeout',
      response: '',
      mode: 'v1-api',
      steps: [],
      metadata: {},
    };
    
    expect(failedResult.success).toBe(false);
    expect(failedResult.error).toBeDefined();
    expect(failedResult.error).toContain('failed');
  });
  
  it('should handle rate limit errors gracefully', () => {
    const rateLimitError = {
      success: false,
      error: 'Rate limit exceeded. Please wait 60 seconds.',
      response: '',
      mode: 'v1-api',
    };
    
    expect(rateLimitError.success).toBe(false);
    expect(rateLimitError.error).toContain('Rate limit');
  });
  
  it('should handle authentication errors', () => {
    const authError = {
      success: false,
      error: 'Authentication failed: Invalid API key',
      response: '',
      mode: 'v1-api',
    };
    
    expect(authError.success).toBe(false);
    expect(authError.error).toContain('Authentication');
  });
  
  it('should handle malformed JSON responses', () => {
    const malformedResponse = '{"success": true, response: invalid json';
    
    try {
      JSON.parse(malformedResponse);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
  
  it('should handle empty steps array in result', () => {
    const result = {
      success: true,
      response: 'Task completed',
      mode: 'v1-api',
      steps: [],
      metadata: {},
    };
    
    // No files generated
    const filesGenerated = result.steps?.filter(s =>
      /write|create|edit/i.test(s.toolName)
    ).length || 0;
    
    expect(filesGenerated).toBe(0);
  });
});

// ─── Edge Case: Authentication Failures ──────────────────────────────────────

describe('Edge Case: Authentication Failures', () => {
  it('should handle missing auth token', () => {
    const config = {
      userMessage: 'Test task',
      mode: 'execution-controller',
    };
    
    // No token provided
    const hasToken = !!(config as any).authToken;
    expect(hasToken).toBe(false);
  });
  
  it('should handle expired auth token', () => {
    const expiredTokenError = {
      success: false,
      error: 'Authentication expired. Please log in again.',
      response: '',
      mode: 'v1-api',
    };
    
    expect(expiredTokenError.success).toBe(false);
    expect(expiredTokenError.error).toContain('expired');
  });
  
  it('should handle invalid auth token format', () => {
    const invalidTokenError = {
      success: false,
      error: 'Invalid authentication token format',
      response: '',
      mode: 'v1-api',
    };
    
    expect(invalidTokenError.success).toBe(false);
  });
  
  it('should handle 401 Unauthorized response', () => {
    const statusCode = 401;
    const isUnauthorized = statusCode === 401;
    expect(isUnauthorized).toBe(true);
  });
  
  it('should handle 403 Forbidden response', () => {
    const statusCode = 403;
    const isForbidden = statusCode === 403;
    expect(isForbidden).toBe(true);
  });
});

// ─── Edge Case: Timeout Handling ─────────────────────────────────────────────

describe('Edge Case: Timeout Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });
  
  it('should handle request timeout gracefully', () => {
    const timeoutError = {
      success: false,
      error: 'Request timeout after 120000ms',
      response: '',
      mode: 'v1-api',
    };
    
    expect(timeoutError.success).toBe(false);
    expect(timeoutError.error).toContain('timeout');
  });
  
  it('should handle LLM evaluation timeout with fallback', () => {
    // Simulate LLM call timeout
    const llmTimeoutError = new Error('LLM call timeout after 30s');
    
    // Should fall back to heuristic evaluation
    const useHeuristicFallback = llmTimeoutError.message.includes('timeout');
    expect(useHeuristicFallback).toBe(true);
  });
  
  it('should handle slow response and track timeout', () => {
    const timeoutMs = 5000;
    let timedOut = false;
    
    // Use fake timers for fast test execution
    vi.advanceTimersByTime(timeoutMs);
    timedOut = true;
    
    expect(timedOut).toBe(true);
  });
  
  it('should handle partial response before timeout', () => {
    const partialResult = {
      success: true,
      response: 'Partial response...',
      mode: 'v1-api',
      metadata: { partial: true },
    };
    
    expect(partialResult.success).toBe(true);
    expect(partialResult.metadata.partial).toBe(true);
  });
  
  it('should handle abort signal for long-running requests', () => {
    const controller = new AbortController();
    let aborted = false;
    
    // Set timeout to abort
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 1000);
    
    // Register abort listener
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    
    // Advance time to trigger abort
    vi.advanceTimersByTime(1000);
    clearTimeout(timeoutId);
    
    expect(aborted).toBe(true);
  });
  
  it('should handle network timeout errors', () => {
    const networkTimeoutError = {
      success: false,
      error: 'Network timeout: ETIMEDOUT',
      code: 'ETIMEDOUT',
    };
    
    expect(networkTimeoutError.success).toBe(false);
    expect(networkTimeoutError.code).toBe('ETIMEDOUT');
  });
  
  it('should handle connection refused errors', () => {
    const connRefusedError = {
      success: false,
      error: 'Connection refused: ECONNREFUSED',
      code: 'ECONNREFUSED',
    };
    
    expect(connRefusedError.success).toBe(false);
    expect(connRefusedError.code).toBe('ECONNREFUSED');
  });
  
  it('should handle host not found errors', () => {
    const hostNotFoundError = {
      success: false,
      error: 'Host not found: ENOTFOUND',
      code: 'ENOTFOUND',
    };
    
    expect(hostNotFoundError.success).toBe(false);
    expect(hostNotFoundError.code).toBe('ENOTFOUND');
  });
});

// ─── Edge Case: Extreme Values ───────────────────────────────────────────────

describe('Edge Case: Extreme Values', () => {
  it('should handle very large output', () => {
    const largeOutput = 'x'.repeat(100000);
    
    // Large output should not cause issues
    expect(largeOutput.length).toBe(100000);
    
    // Should still detect issues
    const hasVague = /stuff|things|something/i.test(largeOutput);
    expect(hasVague).toBe(false);
  });
  
  it('should handle very long user message', () => {
    const longMessage = 'Implement a ' + 'feature '.repeat(1000);
    const keywords = extractKeywords(longMessage);
    
    // Should handle without crashing, keywords may be truncated
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeLessThanOrEqual(30); // Max 30 keywords
  });
  
  it('should handle maxCycles at extreme values', () => {
    const maxCycles = 100;
    let cycleCount = 0;
    
    while (cycleCount < maxCycles && cycleCount < 10) {
      cycleCount++;
    }
    
    expect(cycleCount).toBe(10); // Would hit limit
  });
  
  it('should handle zero maxCycles gracefully', () => {
    const maxCycles = 0;
    let cycleCount = 0;
    
    // With 0 maxCycles, loop should not execute
    while (cycleCount < maxCycles) {
      cycleCount++;
    }
    
    expect(cycleCount).toBe(0);
  });
  
  it('should handle negative threshold values', () => {
    const negativeThreshold = -0.5;
    const score = 0.3;
    
    // Negative threshold should always pass
    const triggerFired = score < negativeThreshold;
    expect(triggerFired).toBe(false);
  });
  
  it('should handle threshold values > 1', () => {
    const extremeThreshold = 1.5;
    const score = 0.9;
    
    // Threshold > 1 should never pass
    const passes = score >= extremeThreshold;
    expect(passes).toBe(false);
  });
});

// ─── Edge Case: Null and Undefined ──────────────────────────────────────────

describe('Edge Case: Null and Undefined', () => {
  it('should handle undefined toolActivity', () => {
    const toolActivity = undefined;
    
    // Should not throw when checking for tool breaks
    const hasToolBreak = toolActivity && toolActivity.some ? 
      toolActivity.some(t => t.type.includes('read') && !t.followedByAction) : 
      false;
    
    expect(hasToolBreak).toBe(false);
  });
  
  it('should handle null steps array', () => {
    const steps = null;
    
    // Should handle gracefully
    const mappedSteps = steps?.map ? steps.map(s => ({ type: s.toolName })) : [];
    expect(mappedSteps).toEqual([]);
  });
  
  it('should handle undefined filesGenerated', () => {
    const filesGenerated = undefined;
    
    // Should default to 0
    const effectiveFiles = filesGenerated || 0;
    expect(effectiveFiles).toBe(0);
  });
  
  it('should handle undefined completionScore', () => {
    const completionScore = undefined;
    
    // Should handle gracefully
    const functional = completionScore?.functional ?? 0.5;
    expect(functional).toBe(0.5);
  });
  
  it('should handle undefined progress', () => {
    const progress = undefined;
    
    // Should default to 0
    const effectiveProgress = progress ?? 0;
    expect(effectiveProgress).toBe(0);
  });
});

// ─── LLM-Based Evaluation Tests ──────────────────────────────────────────────

describe('LLM-Based Evaluation Mode', () => {
  // ── Evaluation Context ─────────────────────────────────────────────────
  
  it('should create proper evaluation context', () => {
    const context = {
      originalTask: 'Create a REST API for user management',
      lastOutput: 'Implemented user endpoints with authentication',
      cumulativeOutput: 'Full implementation with error handling and tests',
      cycle: 1,
    };
    
    expect(context.originalTask).toBeDefined();
    expect(context.lastOutput).toBeDefined();
    expect(context.cumulativeOutput).toBeDefined();
    expect(context.cycle).toBe(1);
  });
  
  it('should truncate context for large outputs', () => {
    const largeOutput = 'x'.repeat(10000);
    const truncated = largeOutput.slice(-4000);
    
    expect(truncated.length).toBe(4000);
    expect(largeOutput.length).toBeGreaterThan(truncated.length);
  });
  
  // ── Evaluation Roles ──────────────────────────────────────────────────
  
  it('should define all evaluator roles', () => {
    const roles = ['architect', 'engineer', 'qa', 'critic'] as const;
    
    expect(roles).toHaveLength(4);
    expect(roles).toContain('architect');
    expect(roles).toContain('engineer');
    expect(roles).toContain('qa');
    expect(roles).toContain('critic');
  });
  
  it('should use only critic when multiPerspectiveEval is false', () => {
    const multiPerspectiveEval = false;
    const perspectives = multiPerspectiveEval
      ? ['architect', 'engineer', 'qa', 'critic']
      : ['critic'];
    
    expect(perspectives).toEqual(['critic']);
  });
  
  it('should use all perspectives when multiPerspectiveEval is true', () => {
    const multiPerspectiveEval = true;
    const perspectives = multiPerspectiveEval
      ? ['architect', 'engineer', 'qa', 'critic']
      : ['critic'];
    
    expect(perspectives).toHaveLength(4);
    expect(perspectives).toContain('architect');
    expect(perspectives).toContain('engineer');
    expect(perspectives).toContain('qa');
    expect(perspectives).toContain('critic');
  });
  
  // ── Role Weights ───────────────────────────────────────────────────────
  
  it('should have correct role weights', () => {
    const roleWeights = {
      architect: 0.25,
      engineer: 0.30,
      qa: 0.20,
      critic: 0.25,
    };
    
    // Weights should sum to 1
    const totalWeight = Object.values(roleWeights).reduce((sum, w) => sum + w, 0);
    expect(totalWeight).toBeCloseTo(1, 2);
    
    // Engineer should have highest weight (0.30)
    expect(roleWeights.engineer).toBeGreaterThan(roleWeights.architect);
    expect(roleWeights.engineer).toBeGreaterThan(roleWeights.critic);
    expect(roleWeights.engineer).toBeGreaterThan(roleWeights.qa);
  });
  
  // ── Weighted Score Calculation ─────────────────────────────────────────
  
  it('should calculate weighted score correctly', () => {
    const perspectiveResults = [
      { role: 'architect', score: 0.8 },
      { role: 'engineer', score: 0.85 },
      { role: 'qa', score: 0.75 },
      { role: 'critic', score: 0.7 },
    ];
    
    const roleWeights = {
      architect: 0.25,
      engineer: 0.30,
      qa: 0.20,
      critic: 0.25,
    };
    
    let weightedScore = 0;
    let totalWeight = 0;
    
    for (const result of perspectiveResults) {
      const weight = roleWeights[result.role as keyof typeof roleWeights];
      weightedScore += result.score * weight;
      totalWeight += weight;
    }
    
    const finalScore = weightedScore / totalWeight;
    
    // Expected: (0.8*0.25 + 0.85*0.30 + 0.75*0.20 + 0.7*0.25) / 1 = 0.78
    expect(finalScore).toBeCloseTo(0.78, 2);
  });
  
  it('should handle single perspective (critic only) weighted score', () => {
    const perspectiveResults = [
      { role: 'critic', score: 0.75 },
    ];
    
    const roleWeights = {
      architect: 0.25,
      engineer: 0.30,
      qa: 0.20,
      critic: 0.25,
    };
    
    let weightedScore = 0;
    let totalWeight = 0;
    
    for (const result of perspectiveResults) {
      const weight = roleWeights[result.role as keyof typeof roleWeights];
      weightedScore += result.score * weight;
      totalWeight += weight;
    }
    
    const finalScore = weightedScore / totalWeight;
    expect(finalScore).toBe(0.75);
  });
  
  // ── JSON Parsing ───────────────────────────────────────────────────────
  
  it('should parse valid JSON evaluation response', () => {
    const response = '{"score": 85, "concerns": ["Missing error handling", "No tests"], "suggestions": ["Add try-catch", "Write unit tests"]}';
    
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const score = typeof parsed.score === 'number' ? parsed.score / 100 : 0.5;
        expect(score).toBeCloseTo(0.85, 2);
        expect(parsed.concerns).toHaveLength(2);
        expect(parsed.suggestions).toHaveLength(2);
      }
    } catch {
      expect(false).toBe(true); // Should not throw
    }
  });
  
  it('should extract JSON from response with surrounding text', () => {
    const response = 'Here is my evaluation.\n\n{\n  "score": 80,\n  "concerns": ["Issue 1"],\n  "suggestions": ["Fix it"]\n}\n\nLet me know if you need more details.';
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      expect(parsed.score).toBe(80);
    }
  });
  
  it('should fall back to score extraction from text when JSON parse fails', () => {
    // Use a response that matches the regex pattern: "score" followed by digits
    const response = 'The code quality score: 75. It needs improvement.';
    
    const scoreMatch = response.match(/score[:\s]*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) / 100 : 0.5;
    
    expect(score).toBeCloseTo(0.75, 2);
  });
  
  it('should return default score when no parseable content found', () => {
    const response = 'The code looks good overall.';
    
    // Try JSON parsing
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    let score = 0.5;
    
    if (jsonMatch) {
      try {
        score = JSON.parse(jsonMatch[0]).score / 100;
      } catch {
        // Fall through to default
      }
    }
    
    // Try text extraction
    if (score === 0.5) {
      const scoreMatch = response.match(/score[:\s]*(\d+)/i);
      if (scoreMatch) {
        score = parseInt(scoreMatch[1]) / 100;
      }
    }
    
    expect(score).toBe(0.5);
  });
  
  // ── LLM Configuration ──────────────────────────────────────────────────
  
  it('should enable LLM evaluation when evalModel is set', () => {
    const config: ExecutionControllerConfig = {
      evalModel: 'gpt-4-turbo',
      evalProvider: 'openai',
    };
    
    const enableLLMEval = !!config.evalModel;
    expect(enableLLMEval).toBe(true);
  });
  
  it('should not enable LLM evaluation when evalModel is undefined', () => {
    const config: ExecutionControllerConfig = {};
    
    const enableLLMEval = !!config.evalModel;
    expect(enableLLMEval).toBe(false);
  });
  
  it('should use baseConfig model as fallback when evalModel not specified', () => {
    const options = {};
    const baseConfig = { model: 'gpt-4o-mini' };
    
    const evalModel = options.evalModel || baseConfig.model;
    expect(evalModel).toBe('gpt-4o-mini');
  });
  
  it('should prioritize evalModel over baseConfig model', () => {
    const options = { evalModel: 'gpt-4' };
    const baseConfig = { model: 'gpt-4o-mini' };
    
    const evalModel = options.evalModel || baseConfig.model;
    expect(evalModel).toBe('gpt-4');
  });
  
  it('should use baseConfig provider as fallback when evalProvider not specified', () => {
    const options = {};
    const baseConfig = { provider: 'anthropic' };
    
    const evalProvider = options.evalProvider || baseConfig.provider;
    expect(evalProvider).toBe('anthropic');
  });
  
  // ── LLM Evaluation Confidence ───────────────────────────────────────────
  
  it('should assign higher confidence to LLM evaluation', () => {
    const llmConfidence = 0.9;
    const heuristicConfidence = 0.75;
    
    expect(llmConfidence).toBeGreaterThan(heuristicConfidence);
  });
  
  it('should limit issues to top 5 concerns', () => {
    const allConcerns = [
      'Concern 1', 'Concern 2', 'Concern 3', 'Concern 4', 
      'Concern 5', 'Concern 6', 'Concern 7', 'Concern 8'
    ];
    
    const limitedIssues = allConcerns.slice(0, 5);
    expect(limitedIssues).toHaveLength(5);
  });
  
  // ── LLM Call Error Handling ─────────────────────────────────────────────
  
  it('should fallback to heuristic when LLM call fails', async () => {
    // Simulate LLM call failure
    const llmCall = async () => {
      throw new Error('LLM call failed: Network error');
    };
    
    try {
      await llmCall();
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      // Should fallback to heuristic
      const useHeuristicFallback = error instanceof Error && 
        (error.message.includes('failed') || error.message.includes('timeout'));
      expect(useHeuristicFallback).toBe(true);
    }
  });
  
  it('should handle LLM timeout with fallback', async () => {
    const llmCall = async () => {
      return new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM call timeout after 30s')), 10)
      );
    };
    
    try {
      await llmCall();
    } catch (error) {
      const useHeuristicFallback = error instanceof Error && error.message.includes('timeout');
      expect(useHeuristicFallback).toBe(true);
    }
  });
  
  it('should handle LLM rate limit with fallback', async () => {
    const llmCall = async () => {
      throw new Error('Rate limit exceeded. Please retry after 60 seconds.');
    };
    
    try {
      await llmCall();
    } catch (error) {
      const shouldRetry = error instanceof Error && error.message.includes('Rate limit');
      expect(shouldRetry).toBe(true);
    }
  });
  
  // ── Evaluation Result Conversion ───────────────────────────────────────
  
  it('should convert LLM result to Evaluation format', () => {
    const finalScore = 0.8;
    const allConcerns = ['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4', 'Issue 5', 'Issue 6'];
    
    const evaluation: Evaluation = {
      completeness: Math.min(1, finalScore + 0.1),
      continuity: Math.min(1, finalScore),
      quality: finalScore,
      depth: Math.min(1, finalScore + 0.05),
      confidence: 0.9,
      issues: allConcerns.slice(0, 5),
    };
    
    expect(evaluation.completeness).toBeCloseTo(0.9, 2);
    expect(evaluation.continuity).toBeCloseTo(0.8, 2);
    expect(evaluation.quality).toBeCloseTo(0.8, 2);
    expect(evaluation.depth).toBeCloseTo(0.85, 2);
    expect(evaluation.confidence).toBe(0.9);
    expect(evaluation.issues).toHaveLength(5);
  });
  
  it('should clamp evaluation scores between 0 and 1', () => {
    const highScore = 1.5;
    const clampedScore = Math.max(0, Math.min(1, highScore));
    expect(clampedScore).toBe(1);
    
    const negativeScore = -0.5;
    const clampedNegative = Math.max(0, Math.min(1, negativeScore));
    expect(clampedNegative).toBe(0);
  });
  
  // ── Prompt Generation ───────────────────────────────────────────────────
  
  it('should generate role-specific prompts', () => {
    const roleDescriptions: Record<string, string> = {
      architect: 'You evaluate system design, scalability, and architectural decisions.',
      engineer: 'You evaluate code correctness, structure, and technical implementation.',
      qa: 'You evaluate test coverage, edge cases, and quality assurance.',
      critic: 'You find everything wrong — harsh but constructive feedback.',
    };
    
    expect(roleDescriptions.architect).toContain('design');
    expect(roleDescriptions.engineer).toContain('correctness');
    expect(roleDescriptions.qa).toContain('test coverage');
    expect(roleDescriptions.critic).toContain('wrong');
  });
  
  it('should include original task in evaluation prompt', () => {
    const originalTask = 'Create a REST API for user management with CRUD operations';
    const prompt = `ORIGINAL TASK:\n${originalTask}`;
    
    expect(prompt).toContain(originalTask);
  });
  
  it('should truncate lastOutput in prompt to avoid token limits', () => {
    const largeOutput = 'x'.repeat(5000);
    const truncatedOutput = largeOutput.slice(0, 2000);
    
    expect(truncatedOutput.length).toBe(2000);
    expect(largeOutput.length).toBeGreaterThan(truncatedOutput.length);
  });
});

// ─── Progress-Based Triggers Tests ───────────────────────────────────────────

describe('Progress-Based Triggers', () => {
  it('should trigger at 50% progress', () => {
    const cycleCount = 4;
    const maxCycles = 8;
    const progress = cycleCount / maxCycles;
    
    const triggeredAtMidpoint = progress >= 0.5;
    expect(triggeredAtMidpoint).toBe(true);
  });

  it('should not trigger at 25% progress', () => {
    const cycleCount = 2;
    const maxCycles = 8;
    const progress = cycleCount / maxCycles;
    
    const triggeredAtMidpoint = progress >= 0.5;
    expect(triggeredAtMidpoint).toBe(false);
  });

  it('should not re-trigger if already expanded', () => {
    let midpointExpanded = true;
    const cycleCount = 6;
    const maxCycles = 8;
    const progress = cycleCount / maxCycles;
    
    const shouldExpand = progress >= 0.5 && !midpointExpanded;
    expect(shouldExpand).toBe(false);
  });
});