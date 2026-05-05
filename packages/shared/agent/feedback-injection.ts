/**
 * Feedback Injection System
 * 
 * Handles regurgitation of failures, corrections, and direction into subsequent prompts.
 * Enables self-healing and auto-reprompting of broken or prematurely ceased flows.
 * 
 * Key features:
 * - Failure analysis and categorization
 * - Correction prompt generation with healing instructions
 * - Format/behavior engineering for responses
 * - Deterministic normalization of error handling
 * - Successive re-prompting with accumulated feedback
 */

import { formatRoleRedirectOptions } from './first-response-routing';

export interface FeedbackEntry {
  id: string;
  timestamp: number;
  type: 'failure' | 'correction' | 'direction' | 'format' | 'behavior';
  source: 'tool_execution' | 'llm_response' | 'timeout' | 'validation' | 'user_feedback';
  content: string;
  context: Record<string, any>;
  severity: 'critical' | 'high' | 'medium' | 'low';
  resolved: boolean;
  resolutionAttempts: number;
}

export interface FeedbackContext {
  sessionId: string;
  turnNumber: number;
  accumulatedFeedback: FeedbackEntry[];
  recentFailures: FeedbackEntry[];
  corrections: FeedbackEntry[];
}

export interface CorrectionPrompt {
  instruction: string;
  healingSteps: string[];
  formatRequirements?: string;
  behavioralGuidance?: string;
  redirectSuggestions?: RoleRedirect[];
}

export interface RoleRedirect {
  role: 'coder' | 'reviewer' | 'planner' | 'architect' | 'researcher' | 'debugger' | 'specialist';
  weight: number;
  reason: string;
  triggerCondition?: string;
}

const FEEDBACK_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FEEDBACK_ENTRIES = 50;
const MAX_CORRECTION_ATTEMPTS = 3;

// ============================================================================
// Feedback Entry Management
// ============================================================================

/**
 * Create a new feedback entry
 */
export function createFeedbackEntry(
  type: FeedbackEntry['type'],
  content: string,
  source: FeedbackEntry['source'],
  context: Record<string, any> = {},
  severity: FeedbackEntry['severity'] = 'medium'
): FeedbackEntry {
  return {
    id: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    type,
    source,
    content,
    context,
    severity,
    resolved: false,
    resolutionAttempts: 0,
  };
}

/**
 * Add feedback to context
 */
export function addFeedback(context: FeedbackContext, entry: FeedbackEntry): FeedbackContext {
  const entries = [...context.accumulatedFeedback, entry].slice(-MAX_FEEDBACK_ENTRIES);
  const recentFailures = entries.filter(f => f.type === 'failure' && !f.resolved && Date.now() - f.timestamp < FEEDBACK_TTL_MS);
  const corrections = entries.filter(f => f.type === 'correction');
  
  return {
    ...context,
    turnNumber: context.turnNumber + 1,
    accumulatedFeedback: entries,
    recentFailures,
    corrections,
  };
}

/**
 * Mark feedback as resolved
 */
export function resolveFeedback(context: FeedbackContext, feedbackId: string): FeedbackContext {
  const entries = context.accumulatedFeedback.map(f => 
    f.id === feedbackId ? { ...f, resolved: true } : f
  );
  return {
    ...context,
    accumulatedFeedback: entries,
    recentFailures: entries.filter(f => f.type === 'failure' && !f.resolved),
  };
}

// ============================================================================
// Failure Analysis & Categorization
// ============================================================================

export interface FailureAnalysis {
  category: 'tool_execution' | 'format_mismatch' | 'behavior_deviation' | 'timeout' | 'validation' | 'logic' | 'unknown';
  rootCause: string;
  healingApproach: string;
  correctionPrompt: CorrectionPrompt;
}

export function analyzeFailure(entry: FeedbackEntry): FailureAnalysis {
  const { content, source, context } = entry;
  
  // Categorize based on source and content patterns
  let category: FailureAnalysis['category'] = 'unknown';
  let rootCause = '';
  let healingApproach = '';
  
  // Tool execution failures
  if (source === 'tool_execution' || content.includes('tool') || content.includes('execute')) {
    category = 'tool_execution';
    rootCause = extractRootCause(content, [
      'command failed',
      'tool not found',
      'permission denied',
      'timeout',
      'invalid arguments',
      'execution error',
    ]);
    healingApproach = 'Check tool availability, validate arguments, simplify command, retry with adjusted parameters';
  }
  // Format mismatches
  else if (content.includes('format') || content.includes('expected') || content.includes('parse')) {
    category = 'format_mismatch';
    rootCause = extractRootCause(content, [
      'unexpected format',
      'parse error',
      'invalid JSON',
      'malformed',
      'wrong structure',
    ]);
    healingApproach = 'Review expected format, validate output structure, adjust response format';
  }
  // Behavior deviations
  else if (content.includes('behavior') || content.includes('should') || content.includes('expected')) {
    category = 'behavior_deviation';
    rootCause = extractRootCause(content, [
      'unexpected behavior',
      'incorrect response',
      'wrong approach',
      'deviation from',
    ]);
    healingApproach = 'Realign with expected behavior, follow guidelines, adjust approach';
  }
  // Timeouts
  else if (source === 'timeout' || content.includes('timeout') || content.includes('timed out')) {
    category = 'timeout';
    rootCause = extractRootCause(content, ['timeout', 'timed out', 'took too long', 'deadline']);
    healingApproach = 'Simplify task, break into smaller steps, increase timeout or reduce scope';
  }
  // Validation failures
  else if (source === 'validation' || content.includes('validation') || content.includes('invalid')) {
    category = 'validation';
    rootCause = extractRootCause(content, ['validation', 'invalid', 'constraint', 'requirement']);
    healingApproach = 'Review constraints, validate inputs, adjust to meet requirements';
  }
  // Logic errors
  else if (content.includes('error') || content.includes('bug') || content.includes('wrong')) {
    category = 'logic';
    rootCause = extractRootCause(content, ['logic error', 'incorrect', 'bug', 'mistake']);
    healingApproach = 'Review logic, identify mistake, correct approach, verify with test';
  }
  
  return {
    category,
    rootCause: rootCause || content.slice(0, 200),
    healingApproach,
    correctionPrompt: generateCorrectionPrompt(entry, category, rootCause, healingApproach),
  };
}

function extractRootCause(content: string, patterns: string[]): string {
  for (const pattern of patterns) {
    if (content.toLowerCase().includes(pattern)) {
      const idx = content.toLowerCase().indexOf(pattern);
      const start = Math.max(0, idx - 50);
      const end = Math.min(content.length, idx + pattern.length + 100);
      return content.slice(start, end).trim();
    }
  }
  return content.slice(0, 200);
}

// ============================================================================
// Correction Prompt Generation
// ============================================================================

export function generateCorrectionPrompt(
  entry: FeedbackEntry,
  category: FailureAnalysis['category'],
  rootCause: string,
  healingApproach: string
): CorrectionPrompt {
  const { content, type, severity } = entry;
  
  const healingSteps: string[] = [];
  
  // Add healing steps based on category
  switch (category) {
    case 'tool_execution':
      healingSteps.push(
        'Verify tool is available and properly configured',
        'Check argument format and validate inputs',
        'Simplify command if too complex',
        'Retry with adjusted parameters'
      );
      break;
    case 'format_mismatch':
      healingSteps.push(
        'Review expected output format',
        'Validate response structure before returning',
        'Adjust to match required format',
        'Include format validation in self-check'
      );
      break;
    case 'behavior_deviation':
      healingSteps.push(
        'Review behavior guidelines',
        'Align response with expected approach',
        'Re-evaluate logic and adjust',
        'Verify against success criteria'
      );
      break;
    case 'timeout':
      healingSteps.push(
        'Break task into smaller steps',
        'Simplify complexity of operation',
        'Consider incremental approach',
        'Prioritize critical path'
      );
      break;
    case 'validation':
      healingSteps.push(
        'Review validation constraints',
        'Ensure inputs meet requirements',
        'Adjust to satisfy constraints',
        'Include validation self-check'
      );
      break;
    case 'logic':
      healingSteps.push(
        'Review logic flow',
        'Identify error source',
        'Correct approach or algorithm',
        'Add verification steps'
      );
      break;
    default:
      healingSteps.push(
        'Analyze error context',
        'Identify root cause',
        'Apply appropriate fix',
        'Verify solution'
      );
  }
  
  // Add severity-based instructions
  const severityInstruction = severity === 'critical'
    ? 'IMMEDIATELY STOP and fix the critical issue before proceeding'
    : severity === 'high'
    ? 'Prioritize fixing this issue before continuing'
    : 'Consider this feedback for improvement';
  
  return {
    instruction: `${severityInstruction}\n\nFailure context: ${rootCause}\n\nRecommended approach: ${healingApproach}`,
    healingSteps,
    formatRequirements: getFormatRequirements(category),
    behavioralGuidance: getBehavioralGuidance(category),
    redirectSuggestions: getRedirectSuggestions(category, severity),
  };
}

function getFormatRequirements(category: FailureAnalysis['category']): string {
  switch (category) {
    case 'format_mismatch':
      return 'CRITICAL: Response must match expected format. Validate structure before returning.';
    case 'tool_execution':
      return 'Output should be structured: { success: boolean, output: string, error?: string }';
    default:
      return 'Response should be clear, structured, and match expected conventions.';
  }
}

function getBehavioralGuidance(category: FailureAnalysis['category']): string {
  switch (category) {
    case 'behavior_deviation':
      return 'Follow established patterns and guidelines. Do not deviate from expected approach.';
    case 'logic':
      return 'Think through logic step-by-step. Verify each step before proceeding.';
    default:
      return 'Maintain consistent behavior. Self-check against guidelines.';
  }
}

function getRedirectSuggestions(category: FailureAnalysis['category'], severity: FeedbackEntry['severity']): RoleRedirect[] {
  // Suggest role redirects based on failure type and severity
  const suggestions: RoleRedirect[] = [];
  
  if (severity === 'critical' || severity === 'high') {
    if (category === 'tool_execution') {
      suggestions.push(
        { role: 'specialist', weight: 0.9, reason: 'Tool execution expertise needed', triggerCondition: 'repeated_tool_failure' },
        { role: 'debugger', weight: 0.7, reason: 'Debug the execution issue', triggerCondition: 'tool_error' },
      );
    } else if (category === 'logic') {
      suggestions.push(
        { role: 'architect', weight: 0.8, reason: 'Logic review needed', triggerCondition: 'logic_error' },
        { role: 'reviewer', weight: 0.7, reason: 'Code review needed', triggerCondition: 'code_logic_error' },
      );
    } else if (category === 'behavior_deviation') {
      suggestions.push(
        { role: 'planner', weight: 0.8, reason: 'Re-plan the approach', triggerCondition: 'approach_error' },
      );
    }
  }
  
  return suggestions;
}

// ============================================================================
// Feedback Injection into Prompts
// ============================================================================

export interface InjectedFeedback {
  correctionSection: string;
  healingInstructions: string;
  formatGuidance: string;
  roleRedirectSection?: string;
}

/**
 * Inject feedback into prompt context
 */
export function injectFeedback(context: FeedbackContext): InjectedFeedback {
  const { recentFailures, corrections, accumulatedFeedback } = context;
  
  if (recentFailures.length === 0 && corrections.length === 0) {
    return {
      correctionSection: '',
      healingInstructions: '',
      formatGuidance: '',
    };
  }
  
  // Cache analyzeFailure results to avoid redundant computation
  const failureAnalyses = new Map<FeedbackEntry, FailureAnalysis>();
  for (const failure of recentFailures) {
    failureAnalyses.set(failure, analyzeFailure(failure));
  }
  
  // Build correction section
  let correctionSection = '';
  if (recentFailures.length > 0) {
    correctionSection += '\n## Feedback & Corrections\n';
    correctionSection += 'Address the following issues from previous attempts:\n\n';

    for (const failure of recentFailures.slice(-5)) { // Last 5 failures
      const analysis = failureAnalyses.get(failure);
      if (!analysis) continue;
      correctionSection += `### ${failure.type.toUpperCase()} (${failure.source})\n`;
      correctionSection += `${analysis.rootCause}\n`;
      correctionSection += `**Fix:** ${analysis.healingApproach}\n\n`;
    }
  }
  
  // Build healing instructions
  let healingInstructions = '\n## Healing Instructions\n';
  healingInstructions += 'Apply these steps to recover from failures:\n\n';

  for (const failure of recentFailures.slice(-3)) {
    const analysis = failureAnalyses.get(failure);
    if (!analysis) continue;
    healingInstructions += `1. ${analysis.correctionPrompt.instruction}\n`;
    analysis.correctionPrompt.healingSteps.forEach(step => {
      healingInstructions += `   - ${step}\n`;
    });
  }
  
  // Build format guidance
  let formatGuidance = '';
  const uniqueCategories = [...new Set(recentFailures.map(f => failureAnalyses.get(f)!.category))];
  if (uniqueCategories.includes('format_mismatch')) {
    formatGuidance = '\n## Format Requirements\n';
    formatGuidance += 'IMPORTANT: Ensure response matches expected format.\n';
    formatGuidance += '- Validate structure before returning\n';
    formatGuidance += '- Include required fields\n';
    formatGuidance += '- Match protocol specifications\n';
  }
  
  // Build role redirect section — ALWAYS active (response-embedded routing).
  // Even without failures, we include default role options so the first response
  // always contains routing metadata for the dynamic injector to use.
  let roleRedirectSection: string | undefined;
  const allRedirects: RoleRedirect[] = [];
  for (const failure of recentFailures.slice(-3)) {
    const analysis = failureAnalyses.get(failure)!;
    allRedirects.push(...(analysis.correctionPrompt.redirectSuggestions || []));
  }
  
  // If no failure-based redirects, generate default role options based on context
  if (allRedirects.length === 0) {
    allRedirects.push(
      { role: 'coder', weight: 0.8, reason: 'default primary role for code tasks', triggerCondition: 'always' },
      { role: 'reviewer', weight: 0.4, reason: 'secondary role for quality checks', triggerCondition: 'always' },
      { role: 'planner', weight: 0.3, reason: 'decomposition role for complex tasks', triggerCondition: 'complexity > low' },
    );
  }
  
  // Always generate the section (not conditional on allRedirects.length > 0)
  // Use shared formatting helper (deduplicates, sorts by weight, includes header)
  // Map RoleRedirect → RoleOption (drop triggerCondition which formatRoleRedirectOptions ignores)
  const roleOptions: Array<{ role: string; weight: number; reason: string }> =
    allRedirects.map(({ role, weight, reason }) => ({ role, weight, reason }));
  roleRedirectSection = formatRoleRedirectOptions(roleOptions);
  
  return {
    correctionSection,
    healingInstructions,
    formatGuidance,
    roleRedirectSection,
  };
}

/**
 * Generate feedback summary for prompt
 */
export function generateFeedbackSummary(context: FeedbackContext): string {
  const { recentFailures, corrections, turnNumber } = context;
  
  if (recentFailures.length === 0) {
    return '';
  }
  
  const summary = `\n
---
### Turn ${turnNumber} Feedback Summary
- Recent failures: ${recentFailures.length}
- Unresolved issues: ${recentFailures.filter(f => !f.resolved).length}
- Corrections applied: ${corrections.length}
---
`;
  
  return summary;
}

// ============================================================================
// Auto-healing Trigger Detection
// ============================================================================

export interface HealingTrigger {
  detected: boolean;
  reason: string;
  healingMode: 'retry' | 'replan' | 'redirect' | 'simplify' | 'escalate';
  prompt: string;
}

export interface IncompleteDetection {
  detected: boolean;
  reason: string;
  prompt: string;
  confidence: number;
}

/**
 * Detect incomplete responses with O(1) overhead for most checks.
 * Only scans the last 500 characters for efficiency.
 */
export function detectIncompleteResponse(response: string): IncompleteDetection {
  const trimmed = response.trim();
  
  // Early exit for very short responses
  if (trimmed.length < 20) {
    return { detected: false, reason: '', prompt: '', confidence: 0 };
  }

  // Only scan the last 500 characters for most checks (O(1) for fixed window)
  const tailLength = Math.min(500, trimmed.length);
  const tail = trimmed.slice(-tailLength);
  const lines = tail.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  
  let confidence = 0;
  const reasons: string[] = [];

  // 1. Mid-sentence detection (ends without terminal punctuation) - O(1)
  // Check last 50 chars for sentence ending
  const last50 = trimmed.slice(-50);
  // Check if last line is a list item (starts with number or bullet)
  const isListItem = /^[\s]*\d+\./.test(lastLine) || /^[\s]*[-*+]/.test(lastLine);
  const endsMidSentence = /[a-zA-Z0-9]$/.test(last50) && 
    !/[.!?。！？]$/.test(last50) &&
    last50.length > 10 &&
    !isListItem; // Don't trigger if last line is a list item
  
  if (endsMidSentence) {
    confidence += 0.3;
    reasons.push('mid-sentence');
  }

  // 2. Mid-code-block detection (unclosed backticks) - O(1) for tail
  // Count backticks in tail only
  const backtickCount = (tail.match(/`/g) || []).length;
  const hasUnclosedCodeBlock = backtickCount % 2 !== 0;
  
  if (hasUnclosedCodeBlock) {
    confidence += 0.4;
    reasons.push('unclosed code block');
  }

  // 3. Mid-list detection (ends with list marker but no content) - O(1)
  // Fixed pattern to match "3." without requiring whitespace
  const endsWithListMarker = /^[\s]*[-*+]\s*$/.test(lastLine) ||
    /^[\s]*\d+\.\s*$/.test(lastLine) ||
    /^[\s]*\d+\.$/.test(lastLine);
  
  if (endsWithListMarker) {
    confidence += 0.35;
    reasons.push('incomplete list item');
  }

  // 4. Mid-JSON detection (unclosed braces/brackets) - O(1) for tail
  // Single pass through tail to count braces/brackets
  let openBraces = 0, closeBraces = 0, openBrackets = 0, closeBrackets = 0;
  for (let i = 0; i < tail.length; i++) {
    const char = tail[i];
    if (char === '{') openBraces++;
    else if (char === '}') closeBraces++;
    else if (char === '[') openBrackets++;
    else if (char === ']') closeBrackets++;
  }
  // Trigger if there's any imbalance (lowered threshold from >1 to >=1)
  const hasUnclosedJSON = (openBraces - closeBraces) >= 1 || (closeBraces - openBraces) >= 1 ||
                          (openBrackets - closeBrackets) >= 1 || (closeBrackets - openBrackets) >= 1;
  
  if (hasUnclosedJSON) {
    confidence += 0.4;
    reasons.push('unclosed JSON/braces');
  }

  // 5. Mid-header detection (incomplete markdown header) - O(1)
  const endsWithIncompleteHeader = /^#{1,6}\s[^#\n]*$/.test(lastLine) && 
    lastLine.length < 100;
  
  if (endsWithIncompleteHeader) {
    confidence += 0.35;
    reasons.push('incomplete header');
  }

  // 6. Abrupt cutoff detection (ends mid-word) - O(1)
  // Only trigger if the last line is very short and ends mid-word
  // Increased threshold from <30 to <20 to avoid false positives on complete list items
  const endsAbruptly = /[a-zA-Z]{3,}$/.test(lastLine) && 
    !/[.!?，。！？\s]$/.test(lastLine) &&
    lastLine.length < 20;
  
  if (endsAbruptly) {
    confidence += 0.25;
    reasons.push('abrupt cutoff');
  }

  // Only trigger if confidence is high enough
  // Lowered threshold from 0.4 to 0.3 to catch more incomplete responses
  if (confidence >= 0.3) {
    return {
      detected: true,
      reason: `Response appears incomplete: ${reasons.join(', ')}`,
      prompt: `Your response appears to be incomplete (${reasons.join(', ')}). Please complete your thought or indicate what remains.`,
      confidence,
    };
  }

  return { detected: false, reason: '', prompt: '', confidence: 0 };
}

/**
 * Detect when auto-healing should be triggered
 */
export function detectHealingTrigger(
  context: FeedbackContext,
  lastResponse: string,
  toolCallsInSequence: number
): HealingTrigger {
  const { recentFailures } = context;
  
  // Detect stuck in loop (same failure repeated)
  if (recentFailures.length >= 3) {
    const lastThree = recentFailures.slice(-3);
    const allSameCategory = lastThree.every(f => analyzeFailure(f).category === analyzeFailure(lastThree[0]).category);
    if (allSameCategory) {
      return {
        detected: true,
        reason: 'Stuck in loop - same failure repeated 3+ times',
        healingMode: 'replan',
        prompt: 'You appear stuck in a loop. Stop and reconsider the approach. Break down the task differently.',
      };
    }
  }
  
  // Detect consecutive tool calls without progress
  if (toolCallsInSequence >= 10) {
    return {
      detected: true,
      reason: 'Too many consecutive tool calls without completion',
      healingMode: 'simplify',
      prompt: 'Too many steps without reaching a conclusion. Simplify the approach or indicate partial completion.',
    };
  }
  
  // Detect incomplete response - use enhanced detection
  const incompleteDetection = detectIncompleteResponse(lastResponse);
  if (incompleteDetection.detected) {
    return {
      detected: true,
      reason: incompleteDetection.reason,
      healingMode: 'retry',
      prompt: incompleteDetection.prompt,
    };
  }
  
  // Detect critical failures
  const criticalFailures = recentFailures.filter(f => f.severity === 'critical');
  if (criticalFailures.length > 0) {
    return {
      detected: true,
      reason: 'Critical failure detected',
      healingMode: 'escalate',
      prompt: 'Critical issue encountered. Escalate by summarizing what was attempted and current state.',
    };
  }
  
  return {
    detected: false,
    reason: '',
    healingMode: 'retry',
    prompt: '',
  };
}

/**
 * Generate re-prompt with healing context
 */
export function generateHealingPrompt(
  trigger: HealingTrigger,
  context: FeedbackContext,
  originalTask: string
): string {
  const { healingMode, prompt: triggerPrompt } = trigger;
  
  let healingPrompt = `\n\n## Auto-Healing Re-Prompt\n`;
  healingPrompt += `Mode: ${healingMode.toUpperCase()}\n\n`;
  
  if (triggerPrompt) {
    healingPrompt += `Directive: ${triggerPrompt}\n\n`;
  }
  
  // Add accumulated feedback context
  const injected = injectFeedback(context);
  healingPrompt += injected.correctionSection;
  healingPrompt += injected.healingInstructions;
  healingPrompt += injected.formatGuidance;
  if (injected.roleRedirectSection) {
    healingPrompt += injected.roleRedirectSection;
  }
  
  // Add original task context
  healingPrompt += `\n## Original Task\n`;
  healingPrompt += `${originalTask.slice(0, 500)}${originalTask.length > 500 ? '...' : ''}\n`;
  
  // Add success criteria reminder
  healingPrompt += `\n## Success Criteria\n`;
  healingPrompt += `- Complete the task successfully\n`;
  healingPrompt += `- Return well-formed response\n`;
  healingPrompt += `- Avoid repeating previous failures\n`;
  
  return healingPrompt;
}

// ============================================================================
// Feedback Statistics
// ============================================================================

export interface FeedbackStats {
  totalEntries: number;
  unresolvedFailures: number;
  correctionAttempts: number;
  successRate: number;
  mostCommonCategory: FailureAnalysis['category'] | null;
}

export function getFeedbackStats(context: FeedbackContext): FeedbackStats {
  const { accumulatedFeedback, recentFailures, corrections } = context;
  
  const categories = recentFailures.map(f => analyzeFailure(f).category);
  const categoryCounts = categories.reduce((acc, cat) => {
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const mostCommon = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] as FailureAnalysis['category'] | undefined;
  
  const resolvedCount = accumulatedFeedback.filter(f => f.resolved).length;
  
  return {
    totalEntries: accumulatedFeedback.length,
    unresolvedFailures: recentFailures.length,
    correctionAttempts: corrections.length,
    successRate: accumulatedFeedback.length > 0 ? resolvedCount / accumulatedFeedback.length : 1,
    mostCommonCategory: mostCommon || null,
  };
}