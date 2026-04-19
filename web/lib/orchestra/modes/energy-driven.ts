/**
 * Energy-Driven Mode (Harness Idea #30)
 *
 * Defines a unified objective function (SystemEnergy) that combines:
 *   - Intent entropy: are goals still unclear?
 *   - Contradiction density: are there conflicting decisions?
 *   - Spec misalignment: does output match requirements?
 *   - Code complexity: is the code getting unnecessarily complex?
 *
 * Each iteration computes ΔE = E_after - E_before:
 *   - ΔE < 0 → accept (improvement)
 *   - 0 ≤ ΔE < ε → accept with probability exp(-ΔE / temperature)
 *   - ΔE ≥ ε → reject (regression), revert, try different approach
 *
 * Stops when: ΔE ≈ 0 for 2 consecutive iterations, or max iterations reached.
 *
 * Benefit: Single metric to decide "continue or stop" and "accept or reject."
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';

const log = createLogger('EnergyDrivenMode');

// ─── Configuration ─────────────────────────────────────────────────────────

export interface EnergyDrivenConfig {
  /** Maximum iterations (default: 8) */
  maxIterations?: number;
  /** Energy threshold for acceptance (default: 0.05) */
  acceptanceThreshold?: number;
  /** Exploration temperature for accepting slight regressions (default: 0.5) */
  explorationTemperature?: number;
  /** Number of consecutive zero-improvement iterations to stop (default: 2) */
  stagnationLimit?: number;
  /** Weights for energy components (must sum to 1.0, default: equal) */
  weights?: {
    intentEntropy: number;
    contradictionDensity: number;
    specMisalignment: number;
    codeComplexity: number;
  };
}

// ─── Energy Computation ────────────────────────────────────────────────────

interface EnergyComponents {
  /** How unclear the goals are (0-1, lower = clearer) */
  intentEntropy: number;
  /** How many conflicting decisions exist (0-1, lower = fewer) */
  contradictionDensity: number;
  /** How far output is from requirements (0-1, lower = closer) */
  specMisalignment: number;
  /** How complex the output is relative to task (0-1, lower = simpler) */
  codeComplexity: number;
}

/**
 * Compute the energy of the current system state.
 * Lower energy = better state.
 */
function computeEnergy(
  task: string,
  output: string,
  history: string[],
  weights: EnergyDrivenConfig['weights']
): EnergyComponents & { total: number } {
  const w = weights || {
    intentEntropy: 0.25,
    contradictionDensity: 0.25,
    specMisalignment: 0.25,
    codeComplexity: 0.25,
  };

  // ── Intent Entropy ─────────────────────────────────────────────────────
  // Measure how much the output diverges from addressing the task directly.
  // High entropy = output covers many unrelated topics (scattered focus).
  const taskWords = new Set(task.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const outputWords = output.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const relevantWords = outputWords.filter(w => taskWords.has(w));
  // If most words in output relate to task → low entropy (good)
  const intentEntropy = outputWords.length > 0
    ? 1 - (relevantWords.length / outputWords.length)
    : 1;

  // ── Contradiction Density ──────────────────────────────────────────────
  // Detect contradictions within the output itself and against history.
  const contradictionMarkers = [
    /\b(however|but|on the other hand|alternatively|instead)\b/gi,
    /\b(maybe|perhaps|might|could possibly)\b/gi,
    /\b(TODO|FIXME|not implemented|placeholder)\b/gi,
  ];
  let contradictionCount = 0;
  for (const marker of contradictionMarkers) {
    const matches = output.match(marker);
    if (matches) contradictionCount += matches.length;
  }
  // Also check against history for conflicting statements
  for (const prev of history) {
    if (prev.length > 50 && output.length > 50) {
      // Simple heuristic: very different outputs on same task = possible contradiction
      const similarity = computeTextSimilarity(prev, output);
      if (similarity < 0.3) contradictionCount += 0.5;
    }
  }
  const contradictionDensity = Math.min(1, contradictionCount / 10);

  // ── Spec Misalignment ─────────────────────────────────────────────────
  // Approximate: check if key terms from the task appear in the output.
  // This is a proxy for "does the output address the requirements?"
  const taskTerms = extractKeyTerms(task);
  const outputTerms = extractKeyTerms(output);
  const matchedTerms = taskTerms.filter(t => outputTerms.includes(t));
  const specMisalignment = taskTerms.length > 0
    ? 1 - (matchedTerms.length / taskTerms.length)
    : 0.5;

  // ── Code Complexity ───────────────────────────────────────────────────
  // Heuristic: ratio of code-like content to explanatory content.
  // High ratio = overly complex or verbose.
  const totalLines = output.split('\n').length;
  const codeLines = output.split('\n').filter(l =>
    l.match(/^\s*(const|let|var|function|class|import|export|return|if|for|while|def|import|from)/)
  ).length;
  const codeRatio = totalLines > 0 ? codeLines / totalLines : 0;
  // Ideal code ratio depends on task, but 0.3-0.7 is reasonable for coding tasks
  const codeComplexity = codeRatio < 0.1 ? 0.7  // Too little code for a coding task
    : codeRatio > 0.9 ? 0.6  // Almost all code, no explanation
    : 0.2 + Math.abs(codeRatio - 0.5) * 0.8;  // Sweet spot around 0.5

  // ── Total Energy ───────────────────────────────────────────────────────
  const total =
    w.intentEntropy * intentEntropy +
    w.contradictionDensity * contradictionDensity +
    w.specMisalignment * specMisalignment +
    w.codeComplexity * codeComplexity;

  return { intentEntropy, contradictionDensity, specMisalignment, codeComplexity, total };
}

/**
 * Extract key terms from text (nouns, technical terms, proper nouns).
 * Simple heuristic: words > 4 chars that aren't common English words.
 */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    'this', 'that', 'these', 'those', 'which', 'there', 'their', 'would',
    'could', 'should', 'about', 'after', 'before', 'between', 'through',
    'during', 'without', 'within', 'along', 'following', 'across',
    'function', 'return', 'const', 'let', 'var', 'import', 'export',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopWords.has(w));
}

/**
 * Simple text similarity (Jaccard-like overlap of terms).
 * Returns 0-1 where 1 = identical term sets.
 */
function computeTextSimilarity(a: string, b: string): number {
  const termsA = new Set(extractKeyTerms(a));
  const termsB = new Set(extractKeyTerms(b));
  if (termsA.size === 0 || termsB.size === 0) return 0;
  const intersection = [...termsA].filter(t => termsB.has(t));
  const union = new Set([...termsA, ...termsB]);
  return intersection.length / union.size;
}

/**
 * Decide whether to accept or reject the output based on energy delta.
 * Uses simulated annealing: accept improvements always, accept slight
 * regressions with probability exp(-ΔE / temperature).
 */
function acceptOrReject(
  deltaE: number,
  temperature: number
): { accepted: boolean; reason: string } {
  if (deltaE < 0) {
    return { accepted: true, reason: 'Energy decreased (improvement)' };
  }
  if (deltaE === 0) {
    return { accepted: true, reason: 'No change (neutral)' };
  }
  // Simulated annealing: accept with decreasing probability
  const probability = Math.exp(-deltaE / Math.max(temperature, 0.01));
  const roll = Math.random();
  if (roll < probability) {
    return { accepted: true, reason: `Exploration accepted (ΔE=${deltaE.toFixed(3)}, P=${probability.toFixed(2)})` };
  }
  return { accepted: false, reason: `Exploration rejected (ΔE=${deltaE.toFixed(3)}, P=${probability.toFixed(2)})` };
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run energy-driven iteration.
 *
 * Each iteration computes energy before/after, accepts if ΔE < 0 or
 * with exploration probability. Stops on stagnation or max iterations.
 */
export async function runEnergyDrivenMode(
  baseConfig: UnifiedAgentConfig,
  options: EnergyDrivenConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const maxIterations = options.maxIterations ?? 8;
  const acceptanceThreshold = options.acceptanceThreshold ?? 0.05;
  const explorationTemperature = options.explorationTemperature ?? 0.5;
  const stagnationLimit = options.stagnationLimit ?? 2;

  log.info('[EnergyDriven] ┌─ ENTRY ──────────────────────────────');
  log.info('[EnergyDriven] │ maxIterations:', maxIterations);
  log.info('[EnergyDriven] │ acceptanceThreshold:', acceptanceThreshold);
  log.info('[EnergyDriven] │ explorationTemp:', explorationTemperature);
  log.info('[EnergyDriven] │ stagnationLimit:', stagnationLimit);
  log.info('[EnergyDriven] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[EnergyDriven] └───────────────────────────────────────');

  let bestResult: UnifiedAgentResult | null = null;
  let bestEnergy = Infinity;
  let prevEnergy: number | null = null;
  let stagnationCount = 0;
  let iterationHistory: string[] = [];
  let isImproving = false;

  for (let iter = 1; iter <= maxIterations; iter++) {
    log.info(`[EnergyDriven] ┌─ Iteration ${iter}/${maxIterations} ───────────`);

    // Build system prompt with iteration context
    const systemPrompt = buildEnergyPrompt(
      baseConfig.systemPrompt || 'You are an expert software engineer.',
      baseConfig.userMessage,
      iterationHistory,
      isImproving,
    );

    // Run LLM
    const result = await processUnifiedAgentRequest({
      ...baseConfig,
      systemPrompt,
      mode: 'v1-api',
    });

    if (!result.success) {
      log.info(`[EnergyDriven] ✗ Iteration ${iter} failed`, { error: result.error });
      stagnationCount++;
      isImproving = false;
      continue;
    }

    // Compute energy
    const energy = computeEnergy(
      baseConfig.userMessage,
      result.response,
      iterationHistory,
      options.weights,
    );

    log.info(`[EnergyDriven] ┌─ Energy Components (iteration ${iter}) ─────`);
    log.info(`[EnergyDriven] │ intentEntropy:        ${energy.intentEntropy.toFixed(3)}`);
    log.info(`[EnergyDriven] │ contradictionDensity: ${energy.contradictionDensity.toFixed(3)}`);
    log.info(`[EnergyDriven] │ specMisalignment:     ${energy.specMisalignment.toFixed(3)}`);
    log.info(`[EnergyDriven] │ codeComplexity:       ${energy.codeComplexity.toFixed(3)}`);
    log.info(`[EnergyDriven] │ TOTAL:                ${energy.total.toFixed(3)}`);
    log.info(`[EnergyDriven] └────────────────────────────────────────────`);

    // Track best
    if (energy.total < bestEnergy) {
      bestResult = result;
      bestEnergy = energy.total;
      isImproving = true;
    } else {
      isImproving = false;
    }

    // Accept/reject decision
    let accepted = true;
    if (prevEnergy !== null) {
      const deltaE = energy.total - prevEnergy;
      const decision = acceptOrReject(deltaE, explorationTemperature);
      accepted = decision.accepted;
      log.info(`[EnergyDriven] → ΔE = ${deltaE >= 0 ? '+' : ''}${deltaE.toFixed(3)} → ${decision.reason}`);

      // Check stagnation (no improvement)
      if (deltaE >= -acceptanceThreshold) {
        stagnationCount++;
      } else {
        stagnationCount = 0;
      }
    }

    // Record iteration
    iterationHistory.push(
      `Iter ${iter}: energy=${energy.total.toFixed(3)}, accepted=${accepted}` +
      (accepted ? '' : ' [rejected]')
    );

    // Check stopping conditions
    if (accepted && stagnationCount >= stagnationLimit && prevEnergy !== null) {
      log.info(`[EnergyDriven] → Stagnation detected (${stagnationCount} iterations without improvement)`);
      break;
    }

    if (energy.total < acceptanceThreshold) {
      log.info(`[EnergyDriven] ✓ Energy below threshold (${energy.total.toFixed(3)} < ${acceptanceThreshold}), converged`);
      return {
        ...result,
        mode: 'energy-driven',
        metadata: {
          ...result.metadata,
          energy: {
            iterations: iter,
            converged: true,
            finalEnergy: energy.total,
            components: {
              intentEntropy: energy.intentEntropy,
              contradictionDensity: energy.contradictionDensity,
              specMisalignment: energy.specMisalignment,
              codeComplexity: energy.codeComplexity,
            },
            duration: Date.now() - startTime,
          },
        },
      };
    }

    prevEnergy = energy.total;
  }

  // ── End of Loop ─────────────────────────────────────────────────────────
  log.info('[EnergyDriven] → Loop ended, returning best result');
  return {
    ...(bestResult || { success: false, response: '', mode: 'energy-driven', error: 'No iterations succeeded' }),
    mode: 'energy-driven',
    metadata: {
      ...(bestResult?.metadata || {}),
      energy: {
        iterations: maxIterations,
        converged: false,
        reason: 'Max iterations or stagnation',
        bestEnergy,
        duration: Date.now() - startTime,
      },
    },
  };
}

/**
 * Build system prompt for energy-driven iteration.
 */
function buildEnergyPrompt(
  basePrompt: string,
  _task: string,
  history: string[],
  improving: boolean,
): string {
  const parts = [basePrompt];

  if (history.length > 0) {
    parts.push('\n## Iteration History\n');
    parts.push(history.join('\n'));
    if (improving) {
      parts.push('\nYou are making progress. Continue in the current direction.');
    } else {
      parts.push('\nProgress has stalled. Try a different approach or perspective.');
    }
    parts.push('Build upon previous work. Do NOT start over.');
  }

  return parts.join('\n');
}
