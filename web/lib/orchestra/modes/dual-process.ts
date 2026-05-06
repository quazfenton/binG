/**
 * Dual-Process Cognition Mode (Harness Idea #3)
 *
 * Fast path: cheap model, reactive, local edits, high frequency.
 * Slow path: expensive model, global restructuring, meta-reasoning.
 *
 * Flow:
 *   1. Fast LLM call produces initial response
 *   2. Detect instability (tool errors, low confidence, loop flags)
 *   3. If unstable → slow LLM call with expanded context + error signals
 *   4. Return best result
 *
 * Cost: ~1.5× cheap model on simple tasks, ~2.5× expensive model on complex.
 * Benefit: Cuts wasted expensive tokens on easy tasks; catches errors on hard ones.
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';
import { configureSubCall, resolveEngine, type EngineArchitecture } from '../execution-engines';

const log = createLogger('DualProcessMode');

// ─── Configuration ──────────────────────────────────────────────────────────

export interface DualProcessConfig {
  /** Model for the fast path (default: from env DEFAULT_MODEL or gpt-4o-mini) */
  fastModel?: string;
  /** Provider for the fast path (default: from env LLM_PROVIDER) */
  fastProvider?: string;
  /** Model for the slow path (default: from env DEFAULT_MODEL or claude-sonnet-4-5) */
  slowModel?: string;
  /** Provider for the slow path (default: from env LLM_PROVIDER) */
  slowProvider?: string;
  /** Confidence threshold below which slow path is triggered (default: 0.6) */
  instabilityThreshold?: number;
  /** Max tokens for fast path (default: 4096) */
  fastMaxTokens?: number;
  /** Max tokens for slow path (default: 16384) */
  slowMaxTokens?: number;
  /** Temperature for fast path (default: 0.7) */
  fastTemperature?: number;
  /** Temperature for slow path (default: 0.3) */
  slowTemperature?: number;

  /**
   * Architecture/engine for both fast and slow sub-calls. Defaults to the
   * parent baseConfig.engine (or env, or v1-api). Setting this lets dual-process
   * run on a v2 CLI/SDK/container engine without any other change.
   * Can be overridden per-path with `fastEngine` / `slowEngine` if you want a
   * v1-api fast path and v2-cli slow path, etc.
   */
  engine?: EngineArchitecture;
  /** Override engine for the fast path only */
  fastEngine?: EngineArchitecture;
  /** Override engine for the slow path only */
  slowEngine?: EngineArchitecture;
}

// ─── Instability Detection ─────────────────────────────────────────────────

interface InstabilitySignals {
  isUnstable: boolean;
  signals: string[];
  score: number; // 0-1, higher = more unstable
}

/**
 * Detect instability in the fast-path result.
 * Checks: tool errors, response quality markers, loop detection hints.
 */
function detectInstability(result: UnifiedAgentResult, responseText: string): InstabilitySignals {
  const signals: string[] = [];
  let score = 0;

  // Check for tool execution errors
  if (result.steps && result.steps.length > 0) {
    const failedSteps = result.steps.filter(s => !s.result?.success);
    if (failedSteps.length > 0) {
      signals.push(`${failedSteps.length}/${result.steps.length} tool calls failed`);
      score += 0.3 * (failedSteps.length / result.steps.length);
    }
  }

  // Check for error indicators in response text
  // Cap total regex-based score at 0.25 to avoid false positives
  // (legitimate responses may mention "error handling", "not found", etc.)
  const errorPatterns = [
    /failed to/i, /error:\s*\w+/i, /cannot\s+(find|open|read|write|connect)/i,
    /unable\s+to/i, /does\s+not\s+exist/i,
    /not\s+found/i, /missing\s+(required|field|argument)/i, /undefined\s+(is\s+not|reference)/i,
  ];
  let errorScore = 0;
  for (const pattern of errorPatterns) {
    if (pattern.test(responseText)) {
      signals.push(`Error indicator detected: "${pattern.source}"`);
      errorScore += 0.15;
    }
  }
  score += Math.min(0.25, errorScore);

  // Check for incomplete response (truncated, placeholder text)
  if (responseText.length < 100) {
    signals.push('Very short response (< 100 chars)');
    score += 0.2;
  }
  if (/TODO|FIXME|not implemented|placeholder/i.test(responseText)) {
    signals.push('Incomplete implementation detected');
    score += 0.25;
  }

  // Check metadata for error hints
  if (result.error) {
    signals.push(`Execution error: ${result.error}`);
    score += 0.4;
  }

  const isUnstable = score >= 0.3;
  return { isUnstable, signals, score };
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run dual-process cognition: fast path → instability check → slow path if needed.
 *
 * The fast path uses a cheaper model with higher temperature for exploration.
 * The slow path uses a stronger model with lower temperature for correction,
 * receiving the fast output and instability signals as context.
 */
export async function runDualProcessMode(
  baseConfig: UnifiedAgentConfig,
  options: DualProcessConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const fastProvider = options.fastProvider || process.env.LLM_PROVIDER || 'openai';
  const fastModel = options.fastModel || 'gpt-4o-mini';
  const slowProvider = options.slowProvider || process.env.LLM_PROVIDER || 'openai';
  const slowModel = options.slowModel || 'gpt-4o';
  const instabilityThreshold = options.instabilityThreshold ?? 0.3;

  log.info('[DualProcess] ┌─ ENTRY ─────────────────────────────────');
  log.info('[DualProcess] │ fast:', `${fastProvider}/${fastModel}`);
  log.info('[DualProcess] │ slow:', `${slowProvider}/${slowModel}`);
  log.info('[DualProcess] │ threshold:', instabilityThreshold);
  log.info('[DualProcess] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[DualProcess] └──────────────────────────────────────────');

  // ── Fast Path ───────────────────────────────────────────────────────────
  log.info('[DualProcess] → Fast path started');
  // Resolve which architecture to use for this sub-call. Honors per-path
  // override → orchestration-mode-wide engine → parent config.engine → env.
  const fastEngine = resolveEngine(options.fastEngine || options.engine, baseConfig.engine);
  const fastSubCall = configureSubCall(
    {
      ...baseConfig,
      provider: fastProvider,
      maxTokens: options.fastMaxTokens || 4096,
      temperature: options.fastTemperature ?? 0.7,
      systemPrompt: baseConfig.systemPrompt,
    },
    fastEngine,
    fastModel,
  );
  const fastResult = await processUnifiedAgentRequest(fastSubCall);

  if (!fastResult.success) {
    log.info('[DualProcess] → Fast path failed, escalating to slow path', {
      error: fastResult.error,
    });
    // Fast path completely failed — go straight to slow
    return runSlowPath(baseConfig, slowProvider, slowModel, options, 'Fast path execution failed', startTime, fastProvider, fastModel);
  }

  // ── Instability Detection ───────────────────────────────────────────────
  const instability = detectInstability(fastResult, fastResult.response);

  log.info('[DualProcess] ┌─ STABILITY CHECK ─────────────────────');
  log.info('[DualProcess] │ stable:', !instability.isUnstable);
  log.info('[DualProcess] │ score:', instability.score.toFixed(3));
  log.info('[DualProcess] │ signals:', instability.signals.length > 0 ? instability.signals.join('; ') : 'none');
  log.info('[DualProcess] │ threshold:', instabilityThreshold);
  log.info('[DualProcess] └──────────────────────────────────────────');

  if (!instability.isUnstable || instability.score < instabilityThreshold) {
    // Fast path was good enough — return quickly
    log.info('[DualProcess] ✓ Fast path stable, returning fast result');
    return {
      ...fastResult,
      mode: 'dual-process-fast',
      metadata: {
        ...fastResult.metadata,
        dualProcess: {
          path: 'fast',
          instabilityScore: instability.score,
          signals: instability.signals,
          duration: Date.now() - startTime,
        },
      },
    };
  }

  // ── Slow Path ───────────────────────────────────────────────────────────
  log.info('[DualProcess] → Slow path triggered (instability detected)');
  return runSlowPath(baseConfig, slowProvider, slowModel, options, instability.signals.join('; '), startTime, fastProvider, fastModel, fastResult);
}

/**
 * Run the slow (expensive) path with expanded context.
 * Receives the fast output and instability signals for correction.
 */
async function runSlowPath(
  baseConfig: UnifiedAgentConfig,
  slowProvider: string,
  slowModel: string,
  options: DualProcessConfig,
  instabilitySignals: string,
  startTime: number,
  fastProvider: string,
  fastModel: string,
  fastResult?: UnifiedAgentResult
): Promise<UnifiedAgentResult> {
  const slowSystemPrompt = [
    baseConfig.systemPrompt || 'You are an expert software engineer.',
    '',
    '## CORRECTION MODE',
    'A previous attempt produced this result. Review and correct it.',
    '',
    fastResult ? `### Previous Output:\n${fastResult.response.slice(0, 3000)}` : '',
    instabilitySignals ? `### Issues Detected:\n${instabilitySignals}` : '',
    '',
    'Focus on fixing the issues above. Produce a complete, correct result.',
  ].join('\n');

  log.info('[DualProcess] → Slow path executing', {
    provider: slowProvider,
    model: slowModel,
    promptLength: slowSystemPrompt.length,
    hasFastContext: !!fastResult,
  });

  const slowResult = await processUnifiedAgentRequest({
    ...baseConfig,
    provider: slowProvider,
    model: slowModel,
    maxTokens: options.slowMaxTokens || 16384,
    temperature: options.slowTemperature ?? 0.3,
    systemPrompt: slowSystemPrompt,
    mode: 'v1-api',
  });

  if (slowResult.success) {
    log.info('[DualProcess] ✓ Slow path succeeded');
  } else {
    log.info('[DualProcess] ✗ Slow path failed', { error: slowResult.error });
    // If slow path also fails, return the better of the two results
    if (fastResult && fastResult.response.length > 0) {
      log.info('[DualProcess] → Falling back to fast result (slow path failed)');
      return {
        ...fastResult,
        mode: 'dual-process-fast-fallback',
        metadata: {
          ...fastResult.metadata,
          dualProcess: {
            path: 'fast-fallback',
            instabilitySignals,
            slowPathError: slowResult.error,
            duration: Date.now() - startTime,
          },
        },
      };
    }
  }

  return {
    ...slowResult,
    mode: 'dual-process-slow',
    metadata: {
      ...slowResult.metadata,
      dualProcess: {
        path: slowResult.success ? 'slow' : 'slow-failed',
        instabilitySignals,
        fastProvider: fastProvider,
        fastModel: fastModel,
        slowProvider,
        slowModel,
        duration: Date.now() - startTime,
      },
    },
  };
}
