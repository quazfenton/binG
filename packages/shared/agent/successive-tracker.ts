/**
 * Successive Response & Tool Call Tracker
 * 
 * Tracks # of successive responses/tool calls and triggers re-evaluation at thresholds.
 * Enables rotated weighting of re-prompted successions.
 * 
 * Features:
 * - Response count tracking
 * - Tool call sequence detection
 * - Threshold-based re-evaluation triggers
 * - Weighted rotation for tool selection
 */

export interface SuccessiveTracker {
  sessionId: string;
  responseCount: number;
  toolCallCount: number;
  consecutiveToolCalls: number;
  lastResponseTime: number;
  lastToolCallTime: number;
  lastReEvalTime: number;
  turnsSinceLastEval: number;
  weightedHistory: WeightedHistoryEntry[];
  reEvalCount: number;
}

export interface WeightedHistoryEntry {
  turn: number;
  responseLength: number;
  toolCalls: number;
  success: boolean;
  weight: number;
  timestamp: number;
}

export interface ReEvalTrigger {
  triggered: boolean;
  reason: string;
  threshold: number;
  currentValue: number;
  recommendedAction: 'replan' | 'redirect' | 'simplify' | 'continue' | 'escalate';
  suggestedRoles?: string[];
}

const DEFAULT_RESPONSE_THRESHOLD = 5;
const DEFAULT_TOOL_CALL_THRESHOLD = 10;
const DEFAULT_CONSECUTIVE_TOOL_THRESHOLD = 7;
const RE_EVAL_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_WEIGHTED_HISTORY = 20;

// ============================================================================
// Tracker Management
// ============================================================================

const trackers: Map<string, SuccessiveTracker> = new Map();

/**
 * Get or create tracker for session
 */
export function getTracker(sessionId: string): SuccessiveTracker {
  let tracker = trackers.get(sessionId);
  
  if (!tracker) {
    tracker = {
      sessionId,
      responseCount: 0,
      toolCallCount: 0,
      consecutiveToolCalls: 0,
      lastResponseTime: Date.now(),
      lastToolCallTime: Date.now(),
      lastReEvalTime: Date.now(),
      turnsSinceLastEval: 0,
      weightedHistory: [],
      reEvalCount: 0,
    };
    trackers.set(sessionId, tracker);
  }
  
  // Reset consecutive tool calls if outside window
  if (Date.now() - tracker.lastToolCallTime > RE_EVAL_WINDOW_MS) {
    tracker.consecutiveToolCalls = 0;
  }
  
  // Reset turns counter if outside window
  if (Date.now() - tracker.lastReEvalTime > RE_EVAL_WINDOW_MS) {
    tracker.turnsSinceLastEval = 0;
  }
  
  return tracker;
}

/**
 * Reset tracker for session
 */
export function resetTracker(sessionId: string): void {
  trackers.delete(sessionId);
}

/**
 * Clean up old trackers
 */
export function cleanupTrackers(maxAgeMs: number = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [sessionId, tracker] of trackers.entries()) {
    if (now - tracker.lastResponseTime > maxAgeMs) {
      trackers.delete(sessionId);
    }
  }
}

// ============================================================================
// Tracking Functions
// ============================================================================

/**
 * Record a response in the tracker
 */
export function recordResponse(
  sessionId: string,
  responseLength: number,
  success: boolean = true
): SuccessiveTracker {
  const tracker = getTracker(sessionId);
  
  const now = Date.now();
  tracker.responseCount++;
  tracker.lastResponseTime = now;
  tracker.turnsSinceLastEval++;
  
  // Add to weighted history
  const weight = calculateResponseWeight(responseLength, success);
  tracker.weightedHistory.push({
    turn: tracker.responseCount,
    responseLength,
    toolCalls: tracker.consecutiveToolCalls,
    success,
    weight,
    timestamp: now,
  });
  
  // Trim history
  if (tracker.weightedHistory.length > MAX_WEIGHTED_HISTORY) {
    tracker.weightedHistory = tracker.weightedHistory.slice(-MAX_WEIGHTED_HISTORY);
  }
  
  // Reset consecutive tool calls after a response
  tracker.consecutiveToolCalls = 0;
  
  return tracker;
}

/**
 * Record a tool call in the tracker
 */
export function recordToolCall(sessionId: string): SuccessiveTracker {
  const tracker = getTracker(sessionId);
  
  const now = Date.now();
  tracker.toolCallCount++;
  tracker.consecutiveToolCalls++;
  tracker.lastToolCallTime = now;
  
  return tracker;
}

/**
 * Record a re-evaluation event
 */
export function recordReEval(sessionId: string): SuccessiveTracker {
  const tracker = getTracker(sessionId);
  
  tracker.lastReEvalTime = Date.now();
  tracker.turnsSinceLastEval = 0;
  tracker.reEvalCount++;
  tracker.consecutiveToolCalls = 0;
  
  return tracker;
}

// ============================================================================
// Weight Calculation
// ============================================================================

/**
 * Calculate weight for a response based on length and success
 */
function calculateResponseWeight(responseLength: number, success: boolean): number {
  // Base weight from response length (normalized)
  const lengthWeight = Math.min(responseLength / 1000, 1);
  
  // Success multiplier
  const successWeight = success ? 1 : 0.5;
  
  // Recent decay (newer = higher weight)
  const ageWeight = 0.9;
  
  return lengthWeight * successWeight * ageWeight;
}

/**
 * Calculate weighted average for tool selection
 */
export function calculateToolSelectionWeights(tracker: SuccessiveTracker): Record<string, number> {
  const weights: Record<string, number> = {};
  
  if (tracker.weightedHistory.length === 0) {
    return { default: 1 };
  }
  
  // Calculate average weights for recent turns
  const recentHistory = tracker.weightedHistory.slice(-5);
  const avgWeight = recentHistory.reduce((sum, entry) => sum + entry.weight, 0) / recentHistory.length;
  
  // Tool call density affects selection
  const totalToolCalls = tracker.weightedHistory.reduce((sum, entry) => sum + entry.toolCalls, 0);
  const avgToolCalls = totalToolCalls / tracker.weightedHistory.length;
  
  // Higher tool call density suggests more tool use needed
  if (avgToolCalls > 5) {
    weights['tool_heavy'] = 0.8;
    weights['analysis'] = 0.2;
  } else if (avgToolCalls > 2) {
    weights['balanced'] = 0.6;
    weights['tool_heavy'] = 0.4;
  } else {
    weights['analysis'] = 0.7;
    weights['tool_heavy'] = 0.3;
  }
  
  // Success rate affects confidence
  const successCount = tracker.weightedHistory.filter(e => e.success).length;
  const successRate = successCount / tracker.weightedHistory.length;
  
  if (successRate < 0.5) {
    // Low success rate - suggest re-evaluation
    weights['re_eval'] = 0.3;
  }
  
  return weights;
}

// ============================================================================
// Re-Evaluation Triggers
// ============================================================================

/**
 * Check if re-evaluation should be triggered based on thresholds
 */
export function checkReEvalTrigger(
  sessionId: string,
  options: {
    responseThreshold?: number;
    toolCallThreshold?: number;
    consecutiveToolThreshold?: number;
  } = {}
): ReEvalTrigger {
  const tracker = getTracker(sessionId);
  
  const responseThreshold = options.responseThreshold || DEFAULT_RESPONSE_THRESHOLD;
  const toolCallThreshold = options.toolCallThreshold || DEFAULT_TOOL_CALL_THRESHOLD;
  const consecutiveToolThreshold = options.consecutiveToolThreshold || DEFAULT_CONSECUTIVE_TOOL_THRESHOLD;
  
  // Check response count threshold
  if (tracker.turnsSinceLastEval >= responseThreshold) {
    return {
      triggered: true,
      reason: `Reached ${responseThreshold} successive responses without evaluation`,
      threshold: responseThreshold,
      currentValue: tracker.turnsSinceLastEval,
      recommendedAction: 'replan',
    };
  }
  
  // Check total tool call threshold
  if (tracker.toolCallCount >= toolCallThreshold && tracker.toolCallCount % 5 === 0) {
    return {
      triggered: true,
      reason: `Reached ${tracker.toolCallCount} total tool calls`,
      threshold: toolCallThreshold,
      currentValue: tracker.toolCallCount,
      recommendedAction: tracker.toolCallCount > toolCallThreshold * 2 ? 'simplify' : 'redirect',
      suggestedRoles: ['specialist', 'debugger'],
    };
  }
  
  // Check consecutive tool calls threshold
  if (tracker.consecutiveToolCalls >= consecutiveToolThreshold) {
    return {
      triggered: true,
      reason: `${tracker.consecutiveToolCalls} consecutive tool calls without response`,
      threshold: consecutiveToolThreshold,
      currentValue: tracker.consecutiveToolCalls,
      recommendedAction: 'continue', // Need response first
    };
  }
  
  // Check for pattern: many short responses with high tool use
  const recentHistory = tracker.weightedHistory.slice(-3);
  if (recentHistory.length >= 3) {
    const avgLength = recentHistory.reduce((sum, e) => sum + e.responseLength, 0) / recentHistory.length;
    const avgToolCalls = recentHistory.reduce((sum, e) => sum + e.toolCalls, 0) / recentHistory.length;
    
    if (avgLength < 200 && avgToolCalls > 3) {
      return {
        triggered: true,
        reason: 'Pattern detected: short responses with high tool usage',
        threshold: 200,
        currentValue: avgLength,
        recommendedAction: 'redirect',
        suggestedRoles: ['planner', 'architect'],
      };
    }
  }
  
  // Check success rate
  if (tracker.weightedHistory.length >= 5) {
    const successRate = tracker.weightedHistory.filter(e => e.success).length / tracker.weightedHistory.length;
    if (successRate < 0.4) {
      return {
        triggered: true,
        reason: `Low success rate: ${(successRate * 100).toFixed(0)}%`,
        threshold: 0.5,
        currentValue: successRate,
        recommendedAction: 'replan',
        suggestedRoles: ['reviewer', 'debugger'],
      };
    }
  }
  
  return {
    triggered: false,
    reason: '',
    threshold: 0,
    currentValue: 0,
    recommendedAction: 'continue',
  };
}

/**
 * Get current tracker state for logging/debugging
 */
export function getTrackerState(sessionId: string): Partial<SuccessiveTracker> {
  const tracker = getTracker(sessionId);
  
  return {
    sessionId: tracker.sessionId,
    responseCount: tracker.responseCount,
    toolCallCount: tracker.toolCallCount,
    consecutiveToolCalls: tracker.consecutiveToolCalls,
    turnsSinceLastEval: tracker.turnsSinceLastEval,
    reEvalCount: tracker.reEvalCount,
  };
}

/**
 * Generate tracker summary for injection into prompts
 */
export function generateTrackerSummary(sessionId: string): string {
  const tracker = getTracker(sessionId);
  
  if (tracker.responseCount === 0 && tracker.toolCallCount === 0) {
    return '';
  }
  
  const summary = `
### Interaction Summary
- Responses: ${tracker.responseCount}
- Tool calls: ${tracker.toolCallCount}
- Consecutive tools: ${tracker.consecutiveToolCalls}
- Turns since re-eval: ${tracker.turnsSinceLastEval}
- Re-evaluations: ${tracker.reEvalCount}
`;
  
  return summary;
}

// ============================================================================
// Rotation Weighting
// ============================================================================

export interface RotationRecommendation {
  primaryRole: string;
  alternativeRole: string;
  confidence: number;
  reasoning: string;
}

/**
 * Get rotation recommendation based on tracker state
 */
export function getRotationRecommendation(sessionId: string): RotationRecommendation {
  const tracker = getTracker(sessionId);
  
  // Default recommendation
  let primaryRole = 'coder';
  let alternativeRole = 'reviewer';
  let confidence = 0.5;
  let reasoning = 'Default routing based on session state';
  
  // High tool call count suggests need for planning
  if (tracker.toolCallCount > 15) {
    primaryRole = 'planner';
    alternativeRole = 'architect';
    confidence = 0.8;
    reasoning = 'High tool usage suggests need for structured planning';
  }
  // High consecutive tool calls without completion suggests simplify
  else if (tracker.consecutiveToolCalls > 5) {
    primaryRole = 'debugger';
    alternativeRole = 'specialist';
    confidence = 0.7;
    reasoning = 'Consecutive tool calls suggest execution issues';
  }
  // Many short responses suggests need for deeper analysis
  else if (tracker.responseCount > 5 && tracker.weightedHistory.length > 0) {
    const avgLength = tracker.weightedHistory.reduce((sum, e) => sum + e.responseLength, 0) / tracker.weightedHistory.length;
    if (avgLength < 300) {
      primaryRole = 'architect';
      alternativeRole = 'planner';
      confidence = 0.6;
      reasoning = 'Multiple short responses suggest need for comprehensive approach';
    }
  }
  // Low success rate suggests review needed
  else if (tracker.weightedHistory.length >= 3) {
    const successRate = tracker.weightedHistory.filter(e => e.success).length / tracker.weightedHistory.length;
    if (successRate < 0.5) {
      primaryRole = 'reviewer';
      alternativeRole = 'debugger';
      confidence = 0.75;
      reasoning = 'Low success rate suggests need for code review';
    }
  }
  
  return {
    primaryRole,
    alternativeRole,
    confidence,
    reasoning,
  };
}