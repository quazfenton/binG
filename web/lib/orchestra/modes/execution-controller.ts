/**
 * Execution Controller Mode (V1 Self-Correcting Execution Loop)
 *
 * This is NOT auto-continue — it's a self-correcting execution loop with
 * enforced quality thresholds and escalation on mediocrity or premature
 * completion.
 *
 * Architecture (3-layer loop):
 *   1. Worker (existing LLM) — generates code/responses
 *   2. Evaluator (new) — evaluates completeness, continuity, quality, depth
 *   3. Director (new) — injects structured critique + expanded plan if needed
 *
 * Triggers:
 *   Hard Triggers (always fire):
 *     - Premature Stop: tool use without continuation, partial output
 *     - Low Quality: trivial scaffold, no architecture decisions
 *     - Dead Flow: response ends without forward direction
 *
 *   Progress-Based Triggers:
 *     - 50% Progress: expand scope, add missing features
 *     - 70% Depth: force refinement, performance, architecture hardening
 *
 * Stop Condition (strict):
 *   Only stops when ALL thresholds pass: functional ≥ 0.95, structure ≥ 0.9,
 *   depth ≥ 0.9, production ≥ 0.9, quality ≥ 0.9, completeness ≥ 0.9
 *
 * Anti-Stagnation:
 *   - maxCycles: 8 (configurable)
 *   - minImprovementDelta: 0.03 (allow stop if improvement < this over 2 cycles)
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';

const log = createLogger('ExecutionControllerMode');

// ─── Shared Utility Functions ──────────────────────────────────────────────

/**
 * Extract key terms from text for comparison.
 * Exported for use in unit tests and other modules.
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9s]/g, ' ')
    .split(/\b\//)
    .flatMap(s => s.split(/\b/))
    .filter(w => w.length > 4 && !stopWords.has(w))
    .slice(0, 30);
}

// ─── LLM-Based Evaluation ───────────────────────────────────────────────────

/**
 * Multi-perspective evaluator roles for enhanced evaluation
 */
type EvaluatorRole = 'architect' | 'engineer' | 'qa' | 'critic';

interface PerspectiveEvaluation {
  role: EvaluatorRole;
  score: number;
  concerns: string[];
  suggestions: string[];
}

/**
 * Generate prompt for LLM-based evaluation
 */
function generateEvaluationPrompt(
  context: {
    originalTask: string;
    lastOutput: string;
    cumulativeOutput: string;
    cycle: number;
  },
  role: EvaluatorRole
): string {
  const roleDescriptions: Record<EvaluatorRole, string> = {
    architect: 'You evaluate system design, scalability, and architectural decisions.',
    engineer: 'You evaluate code correctness, structure, and technical implementation.',
    qa: 'You evaluate test coverage, edge cases, and quality assurance.',
    critic: 'You find everything wrong — harsh but constructive feedback.',
  };

  return `You are a ${role} evaluating code quality.

${roleDescriptions[role]}

ORIGINAL TASK:
${context.originalTask}

CURRENT OUTPUT (last cycle):
${context.lastOutput.slice(0, 2000)}

CUMULATIVE OUTPUT (truncated):
${context.cumulativeOutput.slice(-4000)}

Evaluate and respond with JSON:
{
  "score": 0-100,
  "concerns": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"]
}

Be critical but constructive. Score 100 only for exceptional work.`;
}

/**
 * Parse JSON from LLM evaluation response
 */
function parseEvaluationResponse(response: string): { score: number; concerns: string[]; suggestions: string[] } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: typeof parsed.score === 'number' ? parsed.score / 100 : 0.5,
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    }
  } catch {
    // Fall through to default
  }
  
  // Try to extract numeric score from text
  const scoreMatch = response.match(/score[:\s]*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) / 100 : 0.5;
  
  return { score, concerns: [], suggestions: [] };
}

/**
 * Run LLM-based multi-perspective evaluation
 * 
 * When enabled, this performs more nuanced evaluation by running
 * multiple specialized evaluators (architect, engineer, qa, critic)
 * and synthesizing their feedback.
 */
async function runLLMEvaluation(
  context: {
    originalTask: string;
    lastOutput: string;
    cumulativeOutput: string;
    cycle: number;
  },
  config: {
    evalModel?: string;
    evalProvider?: string;
    multiPerspectiveEval?: boolean;
  },
  llmCall: (prompt: string, options?: { model?: string; provider?: string }) => Promise<string>
): Promise<{
  evaluation: Evaluation;
  perspectiveResults: PerspectiveEvaluation[];
}> {
  const perspectives: EvaluatorRole[] = config.multiPerspectiveEval
    ? ['architect', 'engineer', 'qa', 'critic']
    : ['critic']; // Always include critic for harsh feedback

  const perspectiveResults: PerspectiveEvaluation[] = [];
  
  // Run each perspective evaluation
  for (const role of perspectives) {
    const prompt = generateEvaluationPrompt(context, role);
    try {
      const response = await llmCall(prompt, {
        model: config.evalModel,
        provider: config.evalProvider,
      });
      const result = parseEvaluationResponse(response);
      perspectiveResults.push({
        role,
        score: result.score,
        concerns: result.concerns,
        suggestions: result.suggestions,
      });
    } catch (error) {
      // If LLM call fails, use heuristic as fallback
      perspectiveResults.push({
        role,
        score: 0.5,
        concerns: [`LLM evaluation failed: ${error}`],
        suggestions: [],
      });
    }
  }

  // Aggregate scores with weights
  const roleWeights: Record<EvaluatorRole, number> = {
    architect: 0.25,
    engineer: 0.30,
    qa: 0.20,
    critic: 0.25,
  };

  let weightedScore = 0;
  let totalWeight = 0;
  const allConcerns: string[] = [];
  const allSuggestions: string[] = [];

  for (const result of perspectiveResults) {
    const weight = roleWeights[result.role];
    weightedScore += result.score * weight;
    totalWeight += weight;
    allConcerns.push(...result.concerns);
    allSuggestions.push(...result.suggestions);
  }

  const finalScore = weightedScore / totalWeight;

  // Convert to Evaluation format
  const evaluation: Evaluation = {
    completeness: Math.min(1, finalScore + 0.1), // Slightly optimistic
    continuity: Math.min(1, finalScore),
    quality: finalScore,
    depth: Math.min(1, finalScore + 0.05),
    confidence: 0.9, // LLM evaluation is higher confidence
    issues: allConcerns.slice(0, 5), // Limit to top 5 concerns
  };

  return { evaluation, perspectiveResults };
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ExecutionControllerConfig {
  /** Maximum review cycles before forced stop (default: 8) */
  maxCycles?: number;
  /** Minimum improvement delta to continue (default: 0.03) */
  minImprovementDelta?: number;
  /** Number of cycles with no improvement before allowing stop (default: 2) */
  stagnationCycles?: number;
  /** Completeness threshold for trigger (default: 0.85) */
  completenessThreshold?: number;
  /** Continuity threshold for trigger (default: 0.7) */
  continuityThreshold?: number;
  /** Quality threshold for trigger (default: 0.8) */
  qualityThreshold?: number;
  /** Depth threshold for trigger (default: 0.75) */
  depthThreshold?: number;
  /** Model for evaluation LLM calls (default: same as primary) - FUTURE */
  evalModel?: string;
  /** Provider for evaluation LLM calls (default: same as primary) - FUTURE */
  evalProvider?: string;
  /** Enable multi-perspective evaluation (architect, engineer, product, critic) - FUTURE */
  multiPerspectiveEval?: boolean;
  /** Enable final gate check before termination */
  enableFinalGate?: boolean;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Evaluation {
  completeness: number;   // 0-1: did it finish the intended task?
  continuity: number;     // 0-1: did it naturally lead to next steps?
  quality: number;        // 0-1: is this anywhere near acceptable?
  depth: number;          // 0-1: how deeply was the task explored?
  confidence: number;     // evaluator certainty
  issues: string[];
}

export interface CompletionScore {
  functional: number;     // 0-1: core features implemented
  structure: number;      // 0-1: proper architecture
  depth: number;          // 0-1: state/API/error handling present
  production: number;     // 0-1: build system works
  quality: number;        // 0-1: no rushed scaffolding
  completenessConfidence: number;
}

export interface TriggerResult {
  triggered: boolean;
  reason?: string;
  type?: 'premature_stop' | 'low_quality' | 'dead_flow' | 'midpoint_expansion' | 'depth_trigger';
}

// ─── Heuristic Evaluator ────────────────────────────────────────────────────

/**
 * Fast heuristic-based evaluation for common failure patterns.
 * Falls back to LLM evaluation for nuanced scoring.
 */
function heuristicEvaluate(
  context: {
    lastOutput: string;
    cumulativeOutput: string;
    toolActivity?: Array<{ type: string; followedByAction?: boolean }>;
    filesGenerated?: number;
    progress?: number;
    originalTask: string;
  }
): Evaluation {
  const { lastOutput, cumulativeOutput, toolActivity, filesGenerated, progress = 0, originalTask } = context;

  const issues: string[] = [];
  let completeness = 0.5;
  let continuity = 0.5;
  let quality = 0.5;
  let depth = 0.5;

  // ── Completeness Heuristics ─────────────────────────────────────────────

  // File-based completeness
  if (filesGenerated !== undefined) {
    if (filesGenerated >= 8) completeness = 0.85;
    else if (filesGenerated >= 5) completeness = 0.7;
    else if (filesGenerated >= 3) completeness = 0.5;
    else if (filesGenerated > 0) completeness = 0.35;
    else completeness = 0.2;
  }

  // Check for TODOs/FIXMEs/placeholders indicating incomplete work
  if (/TODO|FIXME|not implemented|placeholder|mock data|sample data/i.test(cumulativeOutput)) {
    completeness -= 0.2;
    issues.push('Contains incomplete placeholders or TODOs');
  }

  // Check for key requirements coverage
  const taskKeywords = extractKeywords(originalTask);
  const outputKeywords = extractKeywords(cumulativeOutput);
  const coverageRatio = taskKeywords.filter(k => outputKeywords.includes(k)).length / Math.max(taskKeywords.length, 1);
  completeness = Math.min(1, completeness * 0.5 + coverageRatio * 0.5);

  // ── Continuity Heuristics ──────────────────────────────────────────────

  // Check for forward direction indicators
  const hasNextStep = /next|then|after that|continue|implement|add|create|build|write/i.test(lastOutput);
  const hasConclusion = /\b(finished|completed|done|all set|ready to use)\b/i.test(lastOutput);
  const endsAbruptly = lastOutput.length > 50 && !hasNextStep && !hasConclusion;

  if (!hasNextStep && !hasConclusion) {
    continuity = 0.3;
    issues.push('Response ends without forward direction');
  } else if (endsAbruptly) {
    continuity = 0.5;
    issues.push('Response may have stopped prematurely');
  } else if (hasNextStep) {
    continuity = 0.8;
  }

  // Tool break detection: tool used without follow-up
  if (toolActivity && toolActivity.length > 0) {
    const toolBreaks = toolActivity.filter(t => t.type.includes('read') && !t.followedByAction);
    if (toolBreaks.length > 0) {
      continuity -= 0.2;
      issues.push(`${toolBreaks.length} tool(s) used without follow-up action`);
    }
  }

  // ── Quality Heuristics ──────────────────────────────────────────────────

  // Output length check
  if (lastOutput.length < 200) {
    quality = 0.3;
    issues.push('Output suspiciously short');
  } else if (lastOutput.length > 500) {
    quality = Math.min(1, quality + 0.2);
  }

  // Code quality markers
  const hasErrorHandling = /try catch|error handling|validate|check.*null|if.*error/i.test(cumulativeOutput);
  const hasConfig = /config|env|environment|\btsconfig\b|package.json/i.test(cumulativeOutput);
  const hasTests = /test|spec|describe|it\/|jest|vitest/i.test(cumulativeOutput);

  if (hasErrorHandling) quality = Math.min(1, quality + 0.15);
  if (hasConfig) quality = Math.min(1, quality + 0.1);
  if (hasTests) quality = Math.min(1, quality + 0.1);

  // Vague quality indicators
  const hasVague = /stuff|things|something|etc\b|maybe|perhaps/i.test(lastOutput);
  if (hasVague) {
    quality -= 0.15;
    issues.push('Contains vague or non-committal language');
  }

  // ── Depth Heuristics ────────────────────────────────────────────────────

  // Architecture indicators
  const hasArchitecture = /src\/|components\/|services\/|api\/|lib\/|modules\//i.test(cumulativeOutput);
  const hasStateManagement = /state|store|redux|zustand|context|useState|useReducer/i.test(cumulativeOutput);
  const hasApiLayer = /endpoint|route|handler|middleware|controller|api\//i.test(cumulativeOutput);

  if (hasArchitecture) depth = Math.min(1, depth + 0.2);
  if (hasStateManagement) depth = Math.min(1, depth + 0.15);
  if (hasApiLayer) depth = Math.min(1, depth + 0.15);

  // Complexity check
  const totalLines = cumulativeOutput.split('\n').length;
  if (totalLines > 100) depth = Math.min(1, depth + 0.1);
  if (totalLines > 500) depth = Math.min(1, depth + 0.1);

  // ── Progress-Based Adjustments ─────────────────────────────────────────

  if (progress >= 0.5 && completeness < 0.8) {
    issues.push('50% progress but completion lagging');
  }
  if (progress >= 0.7 && depth < 0.7) {
    issues.push('70% progress but depth insufficient');
  }

  // Clamp values
  completeness = Math.max(0, Math.min(1, completeness));
  continuity = Math.max(0, Math.min(1, continuity));
  quality = Math.max(0, Math.min(1, quality));
  depth = Math.max(0, Math.min(1, depth));

  return {
    completeness,
    continuity,
    quality,
    depth,
    confidence: 0.75, // Heuristic is 75% confident
    issues,
  };
}

// ─── Trigger System ─────────────────────────────────────────────────────────

/**
 * Detect structural failure patterns.
 */
function detectStructuralFailure(context: {
  lastOutput: string;
  cumulativeOutput: string;
  filesGenerated?: number;
}): boolean {
  // Suspiciously small output
  if (context.lastOutput.length < 500) return true;

  // No code blocks for a coding task
  if (!context.lastOutput.includes('```') && context.lastOutput.length < 2000) return true;

  // Trivial scaffold check
  if ((context.filesGenerated || 0) < 3 && context.cumulativeOutput.length < 3000) return true;

  return false;
}

/**
 * Detect tool chain breaks.
 */
function detectToolBreak(toolActivity?: Array<{ type: string; followedByAction?: boolean }>): boolean {
  if (!toolActivity || toolActivity.length === 0) return false;
  return toolActivity.some(t => t.type.includes('read') && !t.followedByAction);
}

/**
 * Detect dead flow (no next step indication).
 */
function detectDeadFlow(output: string): boolean {
  const hasNextStep = /next|then|after that|continue|implement|add|create|build|write/i.test(output);
  const hasConclusion = /\b(finished|completed|done|all set|ready to use)\b/i.test(output);
  return !hasNextStep && !hasConclusion;
}

/**
 * Detect shallow project generation.
 */
function detectShallowProject(filesGenerated: number = 0): boolean {
  return filesGenerated < 5;
}

/**
 * Detect midpoint needing expansion.
 */
function detectMidpoint(progress: number, expanded: boolean): boolean {
  return progress >= 0.5 && !expanded;
}

/**
 * Main trigger evaluation function.
 */
function evaluateTriggers(
  context: {
    lastOutput: string;
    cumulativeOutput: string;
    toolActivity?: Array<{ type: string; followedByAction?: boolean }>;
    filesGenerated?: number;
    progress?: number;
  },
  evalResult: Evaluation,
  thresholds: {
    completeness: number;
    continuity: number;
    quality: number;
    depth: number;
  }
): TriggerResult {
  const { lastOutput, cumulativeOutput, toolActivity, filesGenerated, progress = 0 } = context;

  // Hard Trigger 1: Premature Stop
  if (detectStructuralFailure(context)) {
    return { triggered: true, reason: 'Structural failure: suspicious output size or missing code', type: 'premature_stop' };
  }

  // Hard Trigger 2: Low Quality Output
  if ((filesGenerated || 0) < 5 && evalResult.quality < 0.6) {
    return { triggered: true, reason: 'Low quality output: trivial scaffold or shallow implementation', type: 'low_quality' };
  }

  // Hard Trigger 3: Dead Flow
  if (detectDeadFlow(lastOutput)) {
    return { triggered: true, reason: 'Dead flow: response ends without forward direction', type: 'dead_flow' };
  }

  // Hard Trigger 4: Tool Chain Break
  if (detectToolBreak(toolActivity)) {
    return { triggered: true, reason: 'Tool chain break: file read without follow-up action', type: 'premature_stop' };
  }

  // Hard Trigger 5: Shallow Project
  if (detectShallowProject(filesGenerated)) {
    return { triggered: true, reason: 'Shallow project: insufficient files generated', type: 'low_quality' };
  }

  // Score-based triggers (use config thresholds)
  if (evalResult.completeness < thresholds.completeness) {
    return { triggered: true, reason: `Completeness below threshold: ${(evalResult.completeness * 100).toFixed(0)}% < ${(thresholds.completeness * 100).toFixed(0)}%`, type: 'premature_stop' };
  }
  if (evalResult.continuity < thresholds.continuity) {
    return { triggered: true, reason: `Continuity below threshold: ${(evalResult.continuity * 100).toFixed(0)}% < ${(thresholds.continuity * 100).toFixed(0)}%`, type: 'dead_flow' };
  }
  if (evalResult.quality < thresholds.quality) {
    return { triggered: true, reason: `Quality below threshold: ${(evalResult.quality * 100).toFixed(0)}% < ${(thresholds.quality * 100).toFixed(0)}%`, type: 'low_quality' };
  }
  if (evalResult.depth < thresholds.depth) {
    return { triggered: true, reason: `Depth below threshold: ${(evalResult.depth * 100).toFixed(0)}% < ${(thresholds.depth * 100).toFixed(0)}%`, type: 'low_quality' };
  }

  return { triggered: false };
}

// ─── Structured Review Generator ───────────────────────────────────────────

/**
 * Generate a structured review prompt with critique, expansion plan,
 * and continuation directive.
 */
function generateStructuredReview(
  context: {
    originalTask: string;
    lastOutput: string;
    cumulativeOutput: string;
    evaluation: Evaluation;
    trigger: TriggerResult;
    cycle: number;
  }
): string {
  const { originalTask, lastOutput, cumulativeOutput, evaluation, trigger, cycle } = context;

  // Analyze what went wrong
  const critiquePoints: string[] = [];
  if (evaluation.completeness < 0.85) {
    critiquePoints.push(`Completeness is at ${(evaluation.completeness * 100).toFixed(0)}% — task is not fully finished`);
  }
  if (evaluation.continuity < 0.7) {
    critiquePoints.push(`Continuity is at ${(evaluation.continuity * 100).toFixed(0)}% — no clear path forward`);
  }
  if (evaluation.quality < 0.8) {
    critiquePoints.push(`Quality is at ${(evaluation.quality * 100).toFixed(0)}% — output is substandard`);
  }
  if (evaluation.depth < 0.75) {
    critiquePoints.push(`Depth is at ${(evaluation.depth * 100).toFixed(0)}% — implementation is shallow`);
  }

  // Identify missing components
  const missingComponents: string[] = [];
  if (!cumulativeOutput.includes('error') && !cumulativeOutput.includes('Error')) {
    missingComponents.push('- Error handling layer');
  }
  if (!cumulativeOutput.includes('config') && !cumulativeOutput.includes('env')) {
    missingComponents.push('- Environment configuration');
  }
  if (!cumulativeOutput.includes('test') && !cumulativeOutput.includes('spec')) {
    missingComponents.push('- Test scaffolding');
  }
  if (!cumulativeOutput.includes('src/') && !cumulativeOutput.includes('components/')) {
    missingComponents.push('- Proper project structure');
  }

  // Generate expansion plan based on task type
  const taskType = classifyTask(originalTask);
  const expansionPlan = generateExpansionPlan(taskType, cumulativeOutput);

  return `[AUTO-REVIEW OVERRIDE — EXECUTION MUST CONTINUE]

[CYCLE ${cycle}] ${trigger.type?.toUpperCase() || 'REVIEW'} TRIGGERED

${trigger.reason || 'Review threshold not met'}

[CRITIQUE]
${critiquePoints.length > 0 ? critiquePoints.join('\n') : 'Output does not meet quality thresholds for production-grade completion.'}

${evaluation.issues.length > 0 ? `[ISSUES DETECTED]\n${evaluation.issues.map(i => `- ${i}`).join('\n')}` : ''}

${missingComponents.length > 0 ? `[MISSING COMPONENTS]\n${missingComponents.join('\n')}` : ''}

[EXPANSION PLAN]
${expansionPlan}

[IMMEDIATE NEXT ACTIONS]
1. Address the critical issues listed above
2. Implement missing components if any
3. Continue from where you left off — do NOT start over
4. Produce concrete, complete output — no TODOs or placeholders

[CONTINUATION DIRECTIVE]
Continue immediately. Do not explain. Do not summarize. Produce the next implementation steps now.
This is not a suggestion — it is a mandatory continuation.

[ORIGINAL TASK CONTEXT]
${originalTask.slice(0, 1000)}
`;
}

/**
 * Classify task type for targeted expansion.
 */
function classifyTask(task: string): 'create' | 'fix' | 'refactor' | 'test' | 'document' | 'general' {
  const lower = task.toLowerCase();
  if (/create|build|implement|add new|generate/i.test(lower)) return 'create';
  if (/fix|bug|error|issue/i.test(lower)) return 'fix';
  if (/refactor|restructure|reorganize/i.test(lower)) return 'refactor';
  if (/test|spec|verify/i.test(lower)) return 'test';
  if (/document|docs|write/i.test(lower)) return 'document';
  return 'general';
}

/**
 * Generate expansion plan based on task type and current state.
 */
function generateExpansionPlan(taskType: string, currentOutput: string): string {
  const plans: Record<string, string[]> = {
    create: [
      'Ensure proper project structure (src/, components/, services/, config/)',
      'Implement core functionality with error handling',
      'Add input validation and edge case handling',
      'Create configuration files (package.json, tsconfig.json, .env.example)',
      'Add basic test scaffolding',
      'Document main exports and usage patterns',
    ],
    fix: [
      'Identify root cause of the issue',
      'Implement fix with regression prevention',
      'Add tests to prevent recurrence',
      'Verify fix handles edge cases',
    ],
    refactor: [
      'Ensure new structure maintains all existing functionality',
      'Add migration path documentation',
      'Update all import references',
      'Verify refactored code passes existing tests',
    ],
    test: [
      'Define test cases covering happy path and edge cases',
      'Set up test infrastructure (jest/vitest config)',
      'Write unit tests for core functions',
      'Add integration tests for main workflows',
    ],
    document: [
      'Structure documentation with clear sections',
      'Add code examples and usage patterns',
      'Include setup and configuration instructions',
      'Document API endpoints and parameters',
    ],
    general: [
      'Continue development of remaining components',
      'Add error handling and validation',
      'Refine and polish output',
      'Verify completeness against original task',
    ],
  };

  const basePlan = plans[taskType] || plans.general;

  // Add context-specific items
  if (!currentOutput.includes('error')) {
    basePlan.push('Add comprehensive error handling');
  }
  if (!currentOutput.includes('log')) {
    basePlan.push('Add logging for debugging and monitoring');
  }

  return basePlan.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

// ─── Final Gate (Termination Authority) ────────────────────────────────────

/**
 * Check if the system has reached a production-grade completion state.
 */
function shouldHardStop(completionScore: CompletionScore): boolean {
  return (
    completionScore.functional >= 0.95 &&
    completionScore.structure >= 0.9 &&
    completionScore.depth >= 0.9 &&
    completionScore.production >= 0.9 &&
    completionScore.quality >= 0.9 &&
    completionScore.completenessConfidence >= 0.9
  );
}

/**
 * Detect hidden gaps that deny termination even if scores pass.
 */
function detectHiddenGaps(output: string): boolean {
  return (
    /TODO|FIXME|placeholder|mock|sample/i.test(output) ||
    (!/error handling|validation|check/i.test(output) && /api|endpoint|service/i.test(output))
  );
}

/**
 * Compute comprehensive completion score.
 */
function computeCompletionScore(context: {
  cumulativeOutput: string;
  originalTask: string;
  filesGenerated?: number;
}): CompletionScore {
  const { cumulativeOutput, originalTask, filesGenerated = 0 } = context;

  // Functional completeness
  const taskKeywords = extractKeywords(originalTask);
  const outputKeywords = extractKeywords(cumulativeOutput);
  const coverageRatio = taskKeywords.filter(k => outputKeywords.includes(k)).length / Math.max(taskKeywords.length, 1);
  const functional = coverageRatio > 0.7 ? 0.95 : 0.7;

  // Structural integrity
  const hasStructure = /src\/|components\/|services\/|lib\/|modules\//i.test(cumulativeOutput);
  const hasLayers = /api\/|pages\/|routes\//i.test(cumulativeOutput);
  const structure = hasStructure && hasLayers ? 0.95 : hasStructure ? 0.8 : 0.6;

  // Technical depth
  const hasErrorHandling = /try catch|error handling|validate|throw new Error/i.test(cumulativeOutput);
  const hasState = /state|store|useState|useContext|redux/i.test(cumulativeOutput);
  const hasConfig = /config|env|tsconfig|package.json/i.test(cumulativeOutput);
  const depth = (hasErrorHandling ? 0.3 : 0) + (hasState ? 0.3 : 0) + (hasConfig ? 0.3 : 0);

  // Production readiness
  const hasBuildScript = /build|start|dev|test/i.test(cumulativeOutput);
  const hasDependencies = /dependencies|peerDependencies/i.test(cumulativeOutput);
  const hasExports = /export|module.exports|import from/i.test(cumulativeOutput);
  const production = (hasBuildScript ? 0.3 : 0) + (hasDependencies ? 0.3 : 0) + (hasExports ? 0.4 : 0);

  // Quality & refinement
  const noVague = !/stuff|things|etc\b|maybe|perhaps/i.test(cumulativeOutput);
  const noPlaceholders = !/TODO|FIXME|placeholder/i.test(cumulativeOutput);
  const quality = (noVague && noPlaceholders) ? 0.9 : (noVague || noPlaceholders) ? 0.7 : 0.5;

  // Files generated (physical completeness)
  const filesCompleteness = filesGenerated >= 8 ? 0.95 : filesGenerated >= 5 ? 0.85 : filesGenerated >= 3 ? 0.7 : 0.5;

  return {
    functional,
    structure,
    depth: Math.min(1, depth),
    production: Math.min(1, production),
    quality,
    completenessConfidence: filesCompleteness,
  };
}

// ─── Mode Implementation ────────────────────────────────────────────────────

/**
 * Run execution controller mode.
 *
 * Implements a self-correcting execution loop that:
 * 1. Executes LLM (Worker)
 * 2. Evaluates output quality (Evaluator)
 * 3. Injects structured review if needed (Director)
 * 4. Continues until hard stop gate is passed
 */
export async function runExecutionControllerMode(
  baseConfig: UnifiedAgentConfig,
  options: ExecutionControllerConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Configuration with defaults
  const maxCycles = options.maxCycles ?? 8;
  const minImprovementDelta = options.minImprovementDelta ?? 0.03;
  const stagnationCycles = options.stagnationCycles ?? 2;
  const completenessThreshold = options.completenessThreshold ?? 0.85;
  const continuityThreshold = options.continuityThreshold ?? 0.7;
  const qualityThreshold = options.qualityThreshold ?? 0.8;
  const depthThreshold = options.depthThreshold ?? 0.75;
  const enableFinalGate = options.enableFinalGate ?? true;
  // LLM evaluation options
  const enableLLMEval = !!options.evalModel; // Enable LLM eval only if model specified
  const multiPerspectiveEval = options.multiPerspectiveEval ?? false;

  log.info('[ExecutionController] ┌─ ENTRY ─────────────────────────────');
  log.info('[ExecutionController] │ maxCycles:', maxCycles);
  log.info('[ExecutionController] │ minImprovementDelta:', minImprovementDelta);
  log.info('[ExecutionController] │ enableFinalGate:', enableFinalGate);
  log.info('[ExecutionController] │ enableLLMEval:', enableLLMEval);
  log.info('[ExecutionController] │ multiPerspectiveEval:', multiPerspectiveEval);
  log.info('[ExecutionController] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[ExecutionController] └──────────────────────────────────────');

  let bestResult: UnifiedAgentResult | null = null;
  let bestScore = -1;
  let previousScore: number | null = null;
  let stagnationCount = 0;
  let cycleCount = 0;
  let cumulativeOutput = '';
  let midpointExpanded = false;
  const cycleHistory: string[] = [];

  // Tool activity tracking for trigger detection
  let toolActivity: Array<{ type: string; followedByAction?: boolean }> = [];
  
  // Cumulative files generated across all cycles
  let filesGenerated = 0;

  while (cycleCount < maxCycles) {
    cycleCount++;
    log.info(`[ExecutionController] ┌─ Cycle ${cycleCount}/${maxCycles} ──────────────`);

    // ── Worker: Execute LLM ──────────────────────────────────────────────
    const result = await processUnifiedAgentRequest({
      ...baseConfig,
      mode: 'v1-api',
    });

    if (!result.success) {
      log.info(`[ExecutionController] ✗ Cycle ${cycleCount} failed`, { error: result.error });
      cycleHistory.push(`Cycle ${cycleCount}: FAILED — ${result.error}`);
      if (bestResult) continue;
      return result;
    }

    // Track cumulative output
    cumulativeOutput += '\n' + result.response;

    // Track tool activity from result with proper followedByAction detection
    const resultToolActivity = result.steps?.map(s => ({ type: s.toolName })) || [];
    if (resultToolActivity.length > 0) {
      // Mark read operations without immediate follow-up within this cycle
      for (let i = 0; i < resultToolActivity.length - 1; i++) {
        if (/read|get|list/i.test(resultToolActivity[i].type)) {
          const nextTool = resultToolActivity[i + 1].type;
          resultToolActivity[i].followedByAction = !/read|get|list/i.test(nextTool);
        }
      }
      // Last tool in cycle - check against first tool of next cycle later
      if (resultToolActivity.length > 0) {
        const lastTool = resultToolActivity[resultToolActivity.length - 1];
        lastTool.followedByAction = false; // Will be updated in next cycle if there's a follow-up
      }
      toolActivity.push(...resultToolActivity);
      
      // Update previous cycle's last tool if current cycle has a tool
      // This ensures followedByAction is correct across cycle boundaries
      if (toolActivity.length > resultToolActivity.length && resultToolActivity.length > 0) {
        const prevLastIndex = toolActivity.length - resultToolActivity.length - 1;
        if (prevLastIndex >= 0) {
          const prevLastTool = toolActivity[prevLastIndex];
          if (/read|get|list/i.test(prevLastTool.type)) {
            const firstCurrentTool = resultToolActivity[0].type;
            prevLastTool.followedByAction = !/read|get|list/i.test(firstCurrentTool);
          }
        }
      }
    }

    // Count files generated (cumulative across cycles)
    const cycleFilesGenerated = result.steps?.filter(s =>
      /write|create|edit/i.test(s.toolName)
    ).length || 0;
    filesGenerated += cycleFilesGenerated;

    // ── Evaluator: Score the output ──────────────────────────────────────
    let evaluation: Evaluation;
    
    if (enableLLMEval) {
      // Use LLM-based multi-perspective evaluation
      try {
        // Create actual LLM call using Vercel AI SDK
        const llmCall = async (prompt: string, opts?: { model?: string; provider?: string }) => {
          const { generateText } = await import('ai');
          const { getVercelModel } = await import('@/lib/chat/vercel-ai-streaming');
          
          const evalProvider = opts?.provider || options.evalProvider || baseConfig.provider || 'openai';
          const evalModel = opts?.model || options.evalModel || baseConfig.model || 'gpt-4o-mini';
          
          const vercelModel = getVercelModel(evalProvider, evalModel);
          const result = await generateText({
            model: vercelModel as any,
            messages: [
              { role: 'system', content: 'You are a critical code reviewer. Respond ONLY with valid JSON.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            maxOutputTokens: 1024,
          });
          
          return result.text || '';
        };
        
        const llmResult = await runLLMEvaluation(
          {
            originalTask: baseConfig.userMessage || '',
            lastOutput: result.response,
            cumulativeOutput,
            cycle: cycleCount,
          },
          {
            evalModel: options.evalModel,
            evalProvider: options.evalProvider,
            multiPerspectiveEval,
          },
          llmCall
        );
        
        evaluation = llmResult.evaluation;
        log.info(`[ExecutionController] │ LLM Evaluation (${llmResult.perspectiveResults.length} perspectives)`);
        for (const pr of llmResult.perspectiveResults) {
          log.info(`[ExecutionController] │   ${pr.role}: ${(pr.score * 100).toFixed(0)}%`);
        }
      } catch (error) {
        log.info(`[ExecutionController] │ LLM eval failed, using heuristic fallback`);
        evaluation = heuristicEvaluate({
          lastOutput: result.response,
          cumulativeOutput,
          toolActivity,
          filesGenerated,
          progress: cycleCount / maxCycles,
          originalTask: baseConfig.userMessage,
        });
      }
    } else {
      // Use fast heuristic evaluation
      evaluation = heuristicEvaluate({
        lastOutput: result.response,
        cumulativeOutput,
        toolActivity,
        filesGenerated,
        progress: cycleCount / maxCycles,
        originalTask: baseConfig.userMessage,
      });
    }

    log.info(`[ExecutionController] │ Evaluation:`);
    log.info(`[ExecutionController] │   completeness: ${(evaluation.completeness * 100).toFixed(0)}%`);
    log.info(`[ExecutionController] │   continuity:   ${(evaluation.continuity * 100).toFixed(0)}%`);
    log.info(`[ExecutionController] │   quality:      ${(evaluation.quality * 100).toFixed(0)}%`);
    log.info(`[ExecutionController] │   depth:        ${(evaluation.depth * 100).toFixed(0)}%`);
    log.info(`[ExecutionController] │   confidence:   ${(evaluation.confidence * 100).toFixed(0)}%`);

    // Track best result
    const currentScore = (evaluation.completeness + evaluation.continuity + evaluation.quality + evaluation.depth) / 4;
    if (currentScore > bestScore) {
      bestResult = result;
      bestScore = currentScore;
      log.info(`[ExecutionController] │   → New best score: ${(currentScore * 100).toFixed(1)}%`);
    }

    // Check for improvement (for anti-stagnation)
    if (previousScore !== null) {
      const improvement = currentScore - previousScore;
      if (improvement < minImprovementDelta) {
        stagnationCount++;
        log.info(`[ExecutionController] │   → Stagnation: ${stagnationCount} cycles (Δ=${(improvement * 100).toFixed(1)}%)`);
      } else {
        stagnationCount = 0;
      }
    }
    previousScore = currentScore;

    // ── Final Gate Check ─────────────────────────────────────────────────
    if (enableFinalGate && cycleCount >= 2) {
      const completionScore = computeCompletionScore({
        cumulativeOutput,
        originalTask: baseConfig.userMessage,
        filesGenerated,
      });

      log.info(`[ExecutionController] │ Completion Gate:`);
      log.info(`[ExecutionController] │   functional:   ${(completionScore.functional * 100).toFixed(0)}%`);
      log.info(`[ExecutionController] │   structure:    ${(completionScore.structure * 100).toFixed(0)}%`);
      log.info(`[ExecutionController] │   depth:        ${(completionScore.depth * 100).toFixed(0)}%`);
      log.info(`[ExecutionController] │   production:   ${(completionScore.production * 100).toFixed(0)}%`);
      log.info(`[ExecutionController] │   quality:      ${(completionScore.quality * 100).toFixed(0)}%`);

      const canStop = shouldHardStop(completionScore);
      const hasGaps = detectHiddenGaps(cumulativeOutput);

      if (canStop && !hasGaps && stagnationCount >= stagnationCycles) {
        log.info('[ExecutionController] ✓ Final gate passed — stopping');
        return {
          ...bestResult!,
          mode: 'execution-controller',
          metadata: {
            ...bestResult?.metadata,
            executionController: {
              cycles: cycleCount,
              finalScore: currentScore,
              completionScore,
              stopped: true,
              reason: 'Final gate passed',
              cycleHistory,
              duration: Date.now() - startTime,
            },
          },
        };
      }

      if (canStop && !hasGaps && cycleCount >= maxCycles) {
        log.info('[ExecutionController] ✓ Completed — max cycles reached with acceptable output');
        return {
          ...bestResult!,
          mode: 'execution-controller',
          metadata: {
            ...bestResult?.metadata,
            executionController: {
              cycles: cycleCount,
              finalScore: currentScore,
              completionScore,
              stopped: true,
              reason: 'Max cycles completed',
              cycleHistory,
              duration: Date.now() - startTime,
            },
          },
        };
      }
    }

    // ── Trigger Check ────────────────────────────────────────────────────
    const trigger = evaluateTriggers(
      {
        lastOutput: result.response,
        cumulativeOutput,
        toolActivity,
        filesGenerated,
        progress: cycleCount / maxCycles,
      },
      evaluation,
      {
        completeness: completenessThreshold,
        continuity: continuityThreshold,
        quality: qualityThreshold,
        depth: depthThreshold,
      }
    );

    log.info(`[ExecutionController] │ Trigger: ${trigger.triggered ? 'FIRED (' + (trigger.type || 'unknown') + ')' : 'clear'}`);
    if (trigger.triggered && trigger.reason) {
      log.info(`[ExecutionController] │   reason: ${trigger.reason}`);
    }

    // ── Midpoint Expansion (50% progress) ────────────────────────────────
    if (cycleCount / maxCycles >= 0.5 && !midpointExpanded) {
      midpointExpanded = true;
      log.info('[ExecutionController] │   → Midpoint expansion triggered (50%)');
      // Force continuation with expanded scope
      const expansionReview = generateStructuredReview({
        originalTask: baseConfig.userMessage,
        lastOutput: result.response,
        cumulativeOutput,
        evaluation,
        trigger: { triggered: true, type: 'midpoint_expansion', reason: '50% progress reached — expand scope' },
        cycle: cycleCount,
      });
      // Inject expansion directive
      baseConfig = {
        ...baseConfig,
        systemPrompt: [
          baseConfig.systemPrompt || 'You are an expert software engineer.',
          '',
          expansionReview,
        ].join('\n'),
      };
      cycleHistory.push(`Cycle ${cycleCount}: Midpoint expansion`);
      continue;
    }

    // ── Director: Inject Review if Triggered ─────────────────────────────
    if (trigger.triggered) {
      const review = generateStructuredReview({
        originalTask: baseConfig.userMessage,
        lastOutput: result.response,
        cumulativeOutput,
        evaluation,
        trigger,
        cycle: cycleCount,
      });

      cycleHistory.push(`Cycle ${cycleCount}: ${trigger.type} triggered — injected review`);

      // Build continuation prompt
      baseConfig = {
        ...baseConfig,
        systemPrompt: [
          baseConfig.systemPrompt || 'You are an expert software engineer.',
          '',
          review,
        ].join('\n'),
      };

      log.info(`[ExecutionController] │   → Review injected, continuing...`);
      continue;
    }

    // No trigger, continue naturally
    log.info(`[ExecutionController] │   → No trigger, continuing...`);
    cycleHistory.push(`Cycle ${cycleCount}: Clear (score: ${(currentScore * 100).toFixed(1)}%)`);

    // Anti-stagnation: if no improvement for several cycles AND significant progress made, allow stop
    // Require at least 2 gate criteria to pass (not just acceptable score)
    if (stagnationCount >= stagnationCycles && currentScore >= 0.85) {
      const completionScore = computeCompletionScore({
        cumulativeOutput,
        originalTask: baseConfig.userMessage,
        filesGenerated,
      });
      // Count how many gate criteria are met
      const gateCriteriaMet = [
        completionScore.functional >= 0.95,
        completionScore.structure >= 0.9,
        completionScore.depth >= 0.9,
        completionScore.production >= 0.9,
        completionScore.quality >= 0.9,
      ].filter(Boolean).length;
      
      if (gateCriteriaMet >= 2) {
        log.info(`[ExecutionController] → Stagnation with ${gateCriteriaMet} gate criteria met — stopping`);
        break;
      } else {
        log.info(`[ExecutionController] → Stagnation but only ${gateCriteriaMet}/5 gate criteria met — continuing`);
      }
    }
  }

  // ── End of Loop ──────────────────────────────────────────────────────────
  log.info('[ExecutionController] → Loop ended', {
    cycles: cycleCount,
    bestScore: bestScore.toFixed(3),
    stagnationCount,
  });

  return {
    ...(bestResult || { success: false, response: '', mode: 'execution-controller', error: 'No cycles succeeded' }),
    mode: 'execution-controller',
    metadata: {
      ...(bestResult?.metadata || {}),
      executionController: {
        cycles: cycleCount,
        finalScore: bestScore,
        stopped: true,
        reason: 'Max cycles or stagnation',
        cycleHistory,
        duration: Date.now() - startTime,
      },
    },
  };
}