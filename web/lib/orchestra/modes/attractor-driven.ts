/**
 * Attractor-Driven Mode (Harness Idea #5)
 *
 * Defines attractor states (target conditions) and scores each iteration
 * against them via embedding alignment. Iteration continues until all
 * attractors are satisfied or max iterations reached.
 *
 * Attractors are defined as natural-language descriptions of desired states:
 *   A1: "All files compile without errors"
 *   A2: "API matches the specification"
 *   A3: "Tests exist and pass"
 *
 * After each LLM output, cosine similarity between the output embedding
 * and each attractor embedding determines alignment score (0-1).
 *
 * Flow:
 *   1. Parse task → define attractor states (embed each)
 *   2. LLM produces output
 *   3. Score output against each attractor
 *   4. If ALL > threshold → STOP (converged)
 *   5. If ANY < lowThreshold → iterate with focused prompt on weakest attractor
 *   6. If max iterations → STOP with partial result
 *
 * Benefit: Objective stopping criteria beyond "LLM says it's done."
 */

import { createLogger } from '@/lib/utils/logger';
import { embed, embedBatch } from '@/lib/memory/embeddings';
import { cosineSimilarity } from '@/lib/retrieval/similarity';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';
import { configureSubCall, resolveEngine, type EngineArchitecture } from '../execution-engines';

const log = createLogger('AttractorDrivenMode');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Attractor {
  id: string;
  description: string;      // Natural language description of target state
  embedding: number[];      // Pre-computed embedding of the description
  weight: number;           // Importance of this attractor (0-1)
}

export interface AttractorAlignment {
  attractorId: string;
  description: string;
  score: number;            // Cosine similarity with output (0-1)
  weight: number;
  weightedScore: number;    // score * weight
}

export interface AttractorConfig {
  /** Custom attractors (auto-generated from task if not provided) */
  attractors?: Attractor[];
  /** Convergence threshold: all attractors must exceed this to stop (default: 0.7) */
  convergenceThreshold?: number;
  /** Low threshold: attractors below this trigger focused iteration (default: 0.4) */
  lowThreshold?: number;
  /** Maximum iterations before forced stop (default: 6) */
  maxIterations?: number;
  /** Architecture/engine for LLM calls (default: from baseConfig.engine or env) */
  engine?: EngineArchitecture;
}

// ─── Attractor Definition ──────────────────────────────────────────────────

/**
 * Default attractors for coding tasks.
 * These represent universal quality dimensions for code generation.
 */
const DEFAULT_ATTRACTORS: Array<{ id: string; description: string; weight: number }> = [
  {
    id: 'correctness',
    description: 'The code is correct, handles edge cases, and has no bugs. All logic is sound.',
    weight: 0.35,
  },
  {
    id: 'completeness',
    description: 'All requirements from the task are fully addressed. Nothing is missing or marked TODO.',
    weight: 0.25,
  },
  {
    id: 'structure',
    description: 'The code is well-organized, follows best practices, and has clean abstractions.',
    weight: 0.20,
  },
  {
    id: 'robustness',
    description: 'Error handling is present, inputs are validated, and failure modes are handled gracefully.',
    weight: 0.20,
  },
];

/**
 * Generate attractor embeddings from their descriptions.
 * Embeds all attractor descriptions in a single batch call.
 */
async function embedAttractors(attractors: Attractor[]): Promise<void> {
  const descriptions = attractors.map(a => a.description);
  try {
    const embeddings = await embedBatch(descriptions);
    for (let i = 0; i < attractors.length; i++) {
      attractors[i].embedding = embeddings[i];
    }
  } catch (error) {
    log.warn('Failed to embed attractor descriptions', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: use zero embeddings (will produce low scores but won't crash)
    for (const a of attractors) {
      a.embedding = new Array(1536).fill(0);
    }
  }
}

// ─── Alignment Scoring ─────────────────────────────────────────────────────

/**
 * Score the output against all attractors via embedding alignment.
 * Returns alignment scores for each attractor.
 */
async function scoreOutputAgainstAttractors(
  output: string,
  attractors: Attractor[]
): Promise<AttractorAlignment[]> {
  let outputEmbedding: number[];
  try {
    const embeddings = await embedBatch([output]);
    outputEmbedding = embeddings[0];
  } catch {
    // If embedding fails, return neutral scores
    return attractors.map(a => ({
      attractorId: a.id,
      description: a.description,
      score: 0.5,
      weight: a.weight,
      weightedScore: 0.5 * a.weight,
    }));
  }

  return attractors.map(a => {
    const score = cosineSimilarity(outputEmbedding, a.embedding);
    // Normalize from [-1,1] to [0,1]
    const normalizedScore = Math.max(0, Math.min(1, (score + 1) / 2));
    return {
      attractorId: a.id,
      description: a.description,
      score: normalizedScore,
      weight: a.weight,
      weightedScore: normalizedScore * a.weight,
    };
  });
}

/**
 * Check if all attractors are satisfied (convergence check).
 */
function hasConverged(
  alignment: AttractorAlignment[],
  threshold: number
): boolean {
  return alignment.every(a => a.score >= threshold);
}

/**
 * Find the weakest attractor (lowest score below lowThreshold).
 */
function findWeakestAttractor(
  alignment: AttractorAlignment[],
  lowThreshold: number
): AttractorAlignment | null {
  const weak = alignment
    .filter(a => a.score < lowThreshold)
    .sort((a, b) => a.score - b.score);
  return weak.length > 0 ? weak[0] : null;
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run attractor-driven iteration.
 *
 * Each iteration scores the output against target attractor states.
 * If convergence threshold is met, stops. If not, iterates with focused
 * prompt on the weakest attractor.
 */
export async function runAttractorDrivenMode(
  baseConfig: UnifiedAgentConfig,
  options: AttractorConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const convergenceThreshold = options.convergenceThreshold ?? 0.7;
  const lowThreshold = options.lowThreshold ?? 0.4;
  const maxIterations = options.maxIterations ?? 6;

  log.info('[AttractorDriven] ┌─ ENTRY ───────────────────────────');
  log.info('[AttractorDriven] │ convergence:', convergenceThreshold);
  log.info('[AttractorDriven] │ low:', lowThreshold);
  log.info('[AttractorDriven] │ maxIterations:', maxIterations);
  log.info('[AttractorDriven] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[AttractorDriven] └────────────────────────────────────');

  // ── Define Attractors ───────────────────────────────────────────────────
  let attractors: Attractor[];

  if (options.attractors && options.attractors.length > 0) {
    attractors = options.attractors;
  } else {
    // Use default attractors, weighted for the task type
    attractors = DEFAULT_ATTRACTORS.map(a => ({
      ...a,
      embedding: [], // Will be filled by embedAttractors
    }));
  }

  // Embed all attractor descriptions
  await embedAttractors(attractors);

  log.info('[AttractorDriven] → Attractors defined', {
    count: attractors.length,
    names: attractors.map(a => a.id).join(', '),
  });

  // ── Iteration Loop ─────────────────────────────────────────────────────
  let currentSystemPrompt = baseConfig.systemPrompt || 'You are an expert software engineer.';
  let bestResult: UnifiedAgentResult | null = null;
  let bestWeightedScore = -1;
  let iterationHistory: string[] = [];
  let previousWeakest: AttractorAlignment | null = null;

  for (let iter = 1; iter <= maxIterations; iter++) {
    log.info(`[AttractorDriven] ┌─ Iteration ${iter}/${maxIterations} ────────`);

    // Build system prompt with attractor context
    const systemPrompt = buildAttractorPrompt(
      currentSystemPrompt,
      baseConfig.userMessage,
      iterationHistory,
      previousWeakest,
      attractors,
    );

    // Run LLM
    const result = await processUnifiedAgentRequest({
      ...baseConfig,
      systemPrompt,
      mode: 'v1-api',
    });

    if (!result.success) {
      log.info(`[AttractorDriven] ✗ Iteration ${iter} failed`, { error: result.error });
      // Keep the best previous result if available
      if (bestResult) {
        return {
          ...bestResult,
          mode: 'attractor-driven',
          metadata: {
            ...bestResult.metadata,
            attractors: {
              iterations: iter - 1,
              converged: false,
              reason: `Iteration ${iter} failed: ${result.error}`,
              bestWeightedScore,
            },
          },
        };
      }
      return result;
    }

    // Score against attractors
    const alignment = await scoreOutputAgainstAttractors(result.response, attractors);
    const totalWeightedScore = alignment.reduce((sum, a) => sum + a.weightedScore, 0);

    log.info(`[AttractorDriven] ┌─ Scores (iteration ${iter}) ─────────────`);
    for (const a of alignment) {
      const bar = '█'.repeat(Math.round(a.score * 10)) + '░'.repeat(10 - Math.round(a.score * 10));
      log.info(`[AttractorDriven] │ ${a.attractorId.padEnd(14)} ${bar} ${a.score.toFixed(2)} (w: ${a.weight})`);
    }
    log.info(`[AttractorDriven] │ weighted_total: ${totalWeightedScore.toFixed(3)}`);
    log.info(`[AttractorDriven] └──────────────────────────────────────────`);

    // Track best result
    if (totalWeightedScore > bestWeightedScore) {
      bestResult = result;
      bestWeightedScore = totalWeightedScore;
    }

    // Check convergence
    if (hasConverged(alignment, convergenceThreshold)) {
      log.info('[AttractorDriven] ✓ Converged! All attractors above threshold');
      return {
        ...result,
        mode: 'attractor-driven',
        metadata: {
          ...result.metadata,
          attractors: {
            iterations: iter,
            converged: true,
            alignment,
            weightedScore: totalWeightedScore,
            duration: Date.now() - startTime,
          },
        },
      };
    }

    // Check if we should iterate (find weakest attractor)
    const weakest = findWeakestAttractor(alignment, lowThreshold);
    if (!weakest) {
      // No attractor is critically low, but not fully converged either
      // Accept current result
      log.info('[AttractorDriven] → No critical weaknesses, accepting result');
      return {
        ...result,
        mode: 'attractor-driven',
        metadata: {
          ...result.metadata,
          attractors: {
            iterations: iter,
            converged: false,
            reason: 'No critical weaknesses but not fully converged',
            alignment,
            weightedScore: totalWeightedScore,
            duration: Date.now() - startTime,
          },
        },
      };
    }

    // Prepare for next iteration with focused prompt
    iterationHistory.push(`Iteration ${iter}: weighted_score=${totalWeightedScore.toFixed(3)}`);
    currentSystemPrompt = systemPrompt;
    previousWeakest = weakest;

    log.info(`[AttractorDriven] → Weakest: ${weakest.attractorId} (${weakest.score.toFixed(2)} < ${lowThreshold})`);
    log.info(`[AttractorDriven] → Next iteration will focus on: ${weakest.description.slice(0, 80)}...`);
  }

  // ── Max Iterations Reached ──────────────────────────────────────────────
  log.info('[AttractorDriven] → Max iterations reached, returning best result');
  return {
    ...(bestResult || { success: false, response: '', mode: 'attractor-driven', error: 'No iterations succeeded' }),
    mode: 'attractor-driven',
    metadata: {
      ...(bestResult?.metadata || {}),
      attractors: {
        iterations: maxIterations,
        converged: false,
        reason: 'Max iterations reached',
        bestWeightedScore,
        duration: Date.now() - startTime,
      },
    },
  };
}

/**
 * Build system prompt with attractor context.
 * Always includes the attractor definitions so the LLM knows what to aim for.
 * On iterations, adds focus on the weakest attractor and previous history.
 */
function buildAttractorPrompt(
  basePrompt: string,
  _task: string,
  history: string[],
  weakestAttractor: AttractorAlignment | null,
  attractors: Attractor[],
): string {
  const parts = [basePrompt];

  // Always include attractor definitions so the LLM knows the target states
  parts.push('\n## Quality Attractors to Aim For');
  parts.push('Your output will be scored against these target states. Try to satisfy all of them:');
  for (const a of attractors) {
    parts.push(`- **${a.id}** (weight: ${a.weight}): ${a.description}`);
  }

  if (history.length > 0) {
    parts.push('\n## Previous Iterations\n');
    parts.push(history.join('\n'));
    parts.push('\nBuild upon previous work. Do NOT start over.');
  }

  if (weakestAttractor) {
    parts.push(`\n\n## Focus Area — ${weakestAttractor.attractorId}`);
    parts.push(`Current alignment: ${(weakestAttractor.score * 100).toFixed(0)}%`);
    parts.push(`Target: ${weakestAttractor.description}`);
    parts.push('Revise your output to better satisfy this requirement.');
  }

  return parts.join('\n');
}
