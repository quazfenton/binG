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
  /**
   * Bug #30 (audit) — debounce state for `checkReEvalTrigger`. The trigger
   * function used to re-emit the same `reason` on every tool-call multiple
   * of 5, flooding run.log. Two mechanisms cooperate:
   *
   *  1. `lastTriggerReason` + `lastTriggerTime` — collapse identical reason
   *     strings emitted within RE_EVAL_DEBOUNCE_MS. This is enough for
   *     triggers with a constant reason text (e.g. "Reached 5 successive
   *     responses without evaluation").
   *
   *  2. `firedTriggersThisCycle: Set<string>` — for triggers whose reason
   *     text CHANGES with each emission (e.g. "Reached N total tool calls",
   *     "Low success rate: X%"). A `Set` keyed on a category ('tools',
   *     'consecutive', 'success', 'pattern', 'responses') is checked first;
   *     once a category fires in the current cycle, it cannot re-fire. The
   *     Set is cleared in `recordResponse()` and `recordReEval()` so a new
   *     cycle (a real response or a recorded re-eval) re-arms every
   *     category. This is the root-cause fix: the old `% 5 === 0` and
   *     "consecutive > 7" checks fired on every increment because the
   *     reason text includes the count, so a same-reason debounce could
   *     never match across multiple emissions.
   *
   * Note: `firedTriggersThisCycle` is a `Set` and is NOT JSON-serializable.
   * If the tracker is ever serialized (log dump, disk cache, network
   * response), the Set is lost and the next deserialized tracker starts
   * with all categories re-armed. In practice this is safe because
   * `recordResponse` re-arms anyway, but the field is in-process only.
   */
  lastTriggerReason: string;
  lastTriggerTime: number;
  firedTriggersThisCycle: Set<string>;
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
// Bug #89 (Pass-6 audit) — bumped from 15 to 50. The previous value
// fired mid-chat on legitimate multi-step tasks (e.g. scaffolding 10
// files + 5 tests + 2 fixes = 17) and caused silent state resets with
// no STEER message. 50 covers a reasonable task envelope while still
// catching runaway loops.
const DEFAULT_TOOL_CALL_THRESHOLD = 50;
const DEFAULT_CONSECUTIVE_TOOL_THRESHOLD = 7;
const RE_EVAL_WINDOW_MS = 60 * 1000; // 1 minute
/**
 * Bug #30 (audit) — debounce window for `checkReEvalTrigger` so the same
 * `reason` is not re-emitted on consecutive tool-call multiples of 5. The
 * 10s window is short enough that genuinely NEW reasons (e.g. crossing a
 * different threshold or a new consecutive-tool spike) still surface within
 * one tool-call of crossing, but long enough to collapse the noise from
 * the `% 5 === 0` check above.
 */
const RE_EVAL_DEBOUNCE_MS = 10 * 1000;
const MAX_WEIGHTED_HISTORY = 20;

// ============================================================================
// Tracker Management
// ============================================================================

const trackers: Map<string, SuccessiveTracker> = new Map();

/**
 * Get or create tracker for session.
 *
 * IMPORTANT: This function has a side effect — it resets counters that have
 * expired outside the time window. If you only need to READ the state without
 * mutation, use `getTrackerReadOnly()` instead.
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
      lastTriggerReason: '',
      lastTriggerTime: 0,
      firedTriggersThisCycle: new Set<string>(),
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
 * Read-only snapshot of tracker state — no side effects (won't reset counters).
 * Returns undefined if no tracker exists for the session.
 */
export function getTrackerReadOnly(sessionId: string): SuccessiveTracker | undefined {
  return trackers.get(sessionId);
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
  const toDelete: string[] = [];
  for (const [sessionId, tracker] of trackers.entries()) {
    if (now - tracker.lastResponseTime > maxAgeMs) {
      toDelete.push(sessionId);
    }
  }
  for (const sessionId of toDelete) {
    trackers.delete(sessionId);
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

  // Bug #30 (audit) — a real response marks the end of a cycle, so
  // re-arm every category for the next cycle. The `consecutive` category
  // is the most important to re-arm (a new spike of consecutive tool
  // calls should fire a fresh trigger), but we clear the whole Set so
  // the semantics are uniform: one fire per cycle, period.
  tracker.firedTriggersThisCycle.clear();

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

  // Bug #30 (audit) — a recorded re-eval marks the end of a cycle.
  // Re-arm every trigger category so the next spike (e.g. count climbing
  // from 20 to 35 after the re-eval) gets a fresh trigger.
  tracker.firedTriggersThisCycle.clear();

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
  const consecutiveToolThreshold = options.consecutiveToolThreshold || DEFAULT_CONSECUTIVE_TOOL_THRESHOLD;  // Check response count threshold. The reason is constant
  // (`responseThreshold` is fixed per call), so the same-reason debounce
  // alone is enough — but we still pass a category so the cycle-Set covers
  // it for free.
  if (tracker.turnsSinceLastEval >= responseThreshold) {
    return emitTrigger(tracker, {
      reason: `Reached ${responseThreshold} successive responses without evaluation`,
      threshold: responseThreshold,
      currentValue: tracker.turnsSinceLastEval,
      recommendedAction: 'replan',
    }, 'responses');
  }

  // Check total tool call threshold. Bug #30 (audit) — the old
  // `tracker.toolCallCount % 5 === 0` check fired on EVERY multiple of 5
  // (15, 20, 25, 30, …) because the reason text "Reached N total tool
  // calls" changes with N. The new approach: the `'tools'` category can
  // fire at most ONCE per cycle (cycle ends on recordResponse or
  // recordReEval). When the count later crosses a NEW re-eval threshold
  // (e.g. count = 30 after a re-eval at count = 18), the category is
  // re-armed and the trigger fires again.
  if (tracker.toolCallCount >= toolCallThreshold) {
    return emitTrigger(tracker, {
      reason: `Reached ${tracker.toolCallCount} total tool calls`,
      threshold: toolCallThreshold,
      currentValue: tracker.toolCallCount,
      recommendedAction: tracker.toolCallCount > toolCallThreshold * 2 ? 'simplify' : 'redirect',
      suggestedRoles: ['specialist', 'debugger'],
    }, 'tools');
  }

  // Check consecutive tool calls threshold. Same issue as the
  // total-tool-count case: the reason includes the count, so it changes
  // per emission. Category `'consecutive'` ensures we fire once per
  // consecutive-tool spike, then re-arm when a response resets
  // consecutiveToolCalls.
  if (tracker.consecutiveToolCalls >= consecutiveToolThreshold) {
    return emitTrigger(tracker, {
      reason: `${tracker.consecutiveToolCalls} consecutive tool calls without response`,
      threshold: consecutiveToolThreshold,
      currentValue: tracker.consecutiveToolCalls,
      recommendedAction: 'continue', // Need response first
    }, 'consecutive');
  }

  // Check for pattern: many short responses with high tool use. The
  // reason text is constant, so the same-reason debounce alone is enough;
  // the category is belt-and-braces.
  const recentHistory = tracker.weightedHistory.slice(-3);
  if (recentHistory.length >= 3) {
    const avgLength = recentHistory.reduce((sum, e) => sum + e.responseLength, 0) / recentHistory.length;
    const avgToolCalls = recentHistory.reduce((sum, e) => sum + e.toolCalls, 0) / recentHistory.length;

    if (avgLength < 200 && avgToolCalls > 3) {
      return emitTrigger(tracker, {
        reason: 'Pattern detected: short responses with high tool usage',
        threshold: 200,
        currentValue: avgLength,
        recommendedAction: 'redirect',
        suggestedRoles: ['planner', 'architect'],
      }, 'pattern');
    }
  }

  // Check success rate. Reason text changes with `successRate` percentage
  // ("Low success rate: 30%" then "Low success rate: 20%"), so the
  // category-based dedup is required.
  if (tracker.weightedHistory.length >= 5) {
    const successRate = tracker.weightedHistory.filter(e => e.success).length / tracker.weightedHistory.length;
    if (successRate < 0.4) {
      return emitTrigger(tracker, {
        reason: `Low success rate: ${(successRate * 100).toFixed(0)}%`,
        threshold: 0.5,
        currentValue: successRate,
        recommendedAction: 'replan',
        suggestedRoles: ['reviewer', 'debugger'],
      }, 'success');
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
 * Bug #30 (audit) — debounce helper with a category-based first
 * filter and a same-reason time-window second filter. A trigger can
 * only fire ONCE per cycle (per category). A "cycle" ends when
 * `recordResponse()` or `recordReEval()` clears the tracker's
 * `firedTriggersThisCycle` Set, re-arming every category.
 *
 * Suppressed triggers are intentionally indistinguishable in shape
 * from a "not triggered" response — the trigger was throttled, not
 * raised — so log readers see one event per genuine new condition.
 */
function emitTrigger(
  tracker: SuccessiveTracker,
  details: Omit<ReEvalTrigger, 'triggered'>,
  category: string,
): ReEvalTrigger {
  const suppressed = {
    triggered: false,
    reason: details.reason,
    threshold: details.threshold,
    currentValue: details.currentValue,
    recommendedAction: 'continue' as const,
  };
  // Category-based dedup: one fire per cycle, regardless of reason text.
  if (tracker.firedTriggersThisCycle.has(category)) {
    return suppressed;
  }
  // Same-reason debounce: collapse constant-reason emissions within the
  // 10s window (catches the "responses" and "pattern" categories where
  // the reason text never changes).
  const now = Date.now();
  const sameReason = tracker.lastTriggerReason === details.reason;
  const withinWindow = now - tracker.lastTriggerTime < RE_EVAL_DEBOUNCE_MS;
  if (sameReason && withinWindow) {
    return suppressed;
  }
  tracker.lastTriggerReason = details.reason;
  tracker.lastTriggerTime = now;
  tracker.firedTriggersThisCycle.add(category);
  return {
    triggered: true,
    reason: details.reason,
    threshold: details.threshold,
    currentValue: details.currentValue,
    recommendedAction: details.recommendedAction,
    ...(details.suggestedRoles ? { suggestedRoles: details.suggestedRoles } : {}),
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