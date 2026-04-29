/**
 * Intent-Driven Mode (Harness Idea #1)
 *
 * Latent Intent Field (LIF) — instead of linear prompt chains, maintain
 * a persistent field of unresolved intents that evolves across iterations.
 *
 * Each LLM call samples and modifies this field. The system is pulled
 * forward by global unresolved structure rather than being told what to do next.
 *
 * Flow:
 *   1. Parse task → extract intent vectors (goals, subgoals, constraints)
 *   2. Each intent has: embedding, priority, entropy, resolved flag
 *   3. Each iteration:
 *      a. Sample top intents by priority × entropy
 *      b. Prompt focuses LLM on these unresolved intents
 *      c. LLM produces output
 *      d. Update intents: mark resolved, reduce entropy for addressed ones
 *      e. Decay all entropy by 0.97
 *   4. Stop when max(priority × entropy for unresolved) < 0.05
 *
 * Benefit: Tracks implicit subgoals that would otherwise be dropped;
 * provides objective stopping; focuses iteration on the most uncertain goals.
 */

import { createLogger } from '@/lib/utils/logger';
import { embed, embedBatch } from '@/lib/memory/embeddings';
import { cosineSimilarity } from '@/lib/retrieval/similarity';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';

const log = createLogger('IntentDrivenMode');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface IntentVector {
  id: string;
  description: string;
  embedding: number[];
  priority: number;       // How important this intent is (0-1)
  entropy: number;        // How uncertain/unresolved it is (0-1, decays over time)
  resolved: boolean;      // Whether this intent has been satisfied
  dependencies: string[]; // Other intent IDs this depends on
}

export interface IntentFieldConfig {
  /** Decay factor applied to all entropy each iteration (default: 0.97) */
  decayFactor?: number;
  /** Stopping threshold: max(priority*entropy) below this stops (default: 0.05) */
  stopThreshold?: number;
  /** Number of top intents to sample each iteration (default: 3) */
  sampleSize?: number;
  /** Maximum iterations before forced stop (default: 10) */
  maxIterations?: number;
  /** Custom intents (auto-extracted from task if not provided) */
  customIntents?: Array<{ description: string; priority: number }>;
}

// ─── Intent Field ──────────────────────────────────────────────────────────

class IntentField {
  vectors: Map<string, IntentVector> = new Map<string, IntentVector>();
  private decayFactor: number;

  constructor(decayFactor: number = 0.97) {
    this.decayFactor = decayFactor;
  }

  /**
   * Initialize the intent field from a list of descriptions and priorities.
   * Embeds all descriptions in a single batch call.
   */
  async initialize(intents: Array<{ description: string; priority: number }>): Promise<void> {
    const descriptions = intents.map(i => i.description);
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(descriptions);
    } catch {
      log.warn('Failed to embed intent descriptions, using zero vectors');
      embeddings = descriptions.map(() => new Array(1536).fill(0));
    }

    for (let i = 0; i < intents.length; i++) {
      const id = `intent_${i}`;
      this.vectors.set(id, {
        id,
        description: intents[i].description,
        embedding: embeddings[i],
        priority: intents[i].priority,
        entropy: 1.0, // Start fully uncertain
        resolved: false,
        dependencies: [],
      });
    }
  }

  /**
   * Sample the top-K intents by priority × entropy (unresolved uncertainty).
   * Returns intents sorted by score descending.
   */
  sampleTopK(k: number): IntentVector[] {
    return [...this.vectors.values()]
      .filter(v => !v.resolved)
      .map(v => ({ ...v, _score: v.priority * v.entropy }))
      .sort((a, b) => (b as any)._score - (a as any)._score)
      .slice(0, k)
      .map(({ _score, ...v }) => v);
  }

  /**
   * Update intent states based on the LLM output.
   * For each unresolved intent, check if the output addresses it
   * via embedding similarity. Mark as resolved if aligned.
   */
  async updateFromOutput(output: string, resolutionThreshold: number = 0.75): Promise<void> {
    let outputEmbedding: number[];
    try {
      const embeddings = await embedBatch([output]);
      outputEmbedding = embeddings[0];
    } catch {
      log.warn('Failed to embed output for intent update');
      return;
    }

    for (const intent of this.vectors.values()) {
      if (intent.resolved) continue;

      const similarity = cosineSimilarity(outputEmbedding, intent.embedding);
      // Normalize from [-1, 1] to [0, 1]
      const alignment = Math.max(0, Math.min(1, (similarity + 1) / 2));

      if (alignment >= resolutionThreshold) {
        intent.resolved = true;
        intent.entropy = Math.max(0, intent.entropy - 0.8);
        log.debug(`[IntentField] Resolved: ${intent.id} (${intent.description.slice(0, 50)}...)`, {
          alignment: alignment.toFixed(3),
        });
      } else if (alignment > 0.4) {
        // Partially addressed — reduce entropy
        intent.entropy = Math.max(0, intent.entropy * (1 - alignment * 0.5));
      }
    }
  }

  /**
   * Decay entropy for all intents (simulates natural forgetting of resolved tension).
   */
  decay(): void {
    for (const v of this.vectors.values()) {
      if (!v.resolved) {
        v.entropy *= this.decayFactor;
      }
    }
  }

  /**
   * Check if the field has converged (no significant unresolved intent).
   */
  hasConverged(threshold: number = 0.05): boolean {
    let maxUnresolved = 0;
    for (const v of this.vectors.values()) {
      if (!v.resolved) {
        const score = v.priority * v.entropy;
        if (score > maxUnresolved) maxUnresolved = score;
      }
    }
    return maxUnresolved < threshold;
  }

  /**
   * Get all unresolved intents for logging.
   */
  getUnresolved(): IntentVector[] {
    return [...this.vectors.values()]
      .filter(v => !v.resolved)
      .sort((a, b) => b.priority * b.entropy - a.priority * a.entropy);
  }

  /**
   * Summary string of the intent field state.
   */
  summary(): string {
    const total = this.vectors.size;
    const resolved = [...this.vectors.values()].filter(v => v.resolved).length;
    const unresolved = total - resolved;
    const maxUnresolvedScore = Math.max(
      0,
      ...[...this.vectors.values()]
        .filter(v => !v.resolved)
        .map(v => v.priority * v.entropy)
    );
    return `Intents: ${resolved}/${total} resolved, ${unresolved} unresolved, max unresolved score: ${maxUnresolvedScore.toFixed(3)}`;
  }
}

// ─── Intent Extraction ─────────────────────────────────────────────────────

/**
 * Extract intents from the task using a lightweight LLM call.
 * Returns a list of {description, priority} pairs.
 */
async function extractIntentsFromTask(
  task: string,
  provider: string,
  model: string
): Promise<Array<{ description: string; priority: number }>> {
  const systemPrompt = [
    'You are an intent extraction system. Given a user task, identify all',
    'explicit and implicit goals, subgoals, and constraints.',
    'Output a JSON array of objects with "description" (string) and',
    '"priority" (0.0-1.0, where 1.0 is critical).',
    'Include at least 3 and at most 8 intents.',
    'Format: [{"description": "...", "priority": 0.9}, ...]',
    'Output ONLY the JSON array, nothing else.',
  ].join('\n');

  const { generateText } = await import('ai');
  const { getVercelModel } = await import('@/lib/chat/vercel-ai-streaming');

  try {
    const vercelModel = getVercelModel(provider, model);
    const result = await generateText({
      model: vercelModel as any,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
      temperature: 0.2,
      maxOutputTokens: 1024,
    });

    // Parse JSON from response
    const text = result.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p: any) => p.description && typeof p.priority === 'number')
          .map((p: any) => ({
            description: p.description,
            priority: Math.min(1, Math.max(0, p.priority)),
          }));
      }
    }
  } catch (error) {
    log.warn('Intent extraction failed, using fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Fallback: extract basic intents from task structure
  return fallbackIntentExtraction(task);
}

/**
 * Fallback intent extraction using keyword heuristics.
 */
function fallbackIntentExtraction(
  task: string
): Array<{ description: string; priority: number }> {
  const intents: Array<{ description: string; priority: number }> = [];

  // Split on common separators
  const segments = task.split(/[,.;]+/).filter(s => s.trim().length > 10);

  if (segments.length >= 3) {
    for (let i = 0; i < Math.min(segments.length, 6); i++) {
      intents.push({
        description: segments[i].trim().slice(0, 200),
        priority: 1.0 - (i * 0.15),
      });
    }
  } else {
    // Extract from common patterns
    const patterns = [
      { regex: /create\s+(.+)/i, desc: 'Create the requested component/feature', priority: 0.9 },
      { regex: /implement\s+(.+)/i, desc: 'Implement the required functionality', priority: 0.9 },
      { regex: /ensure\s+(.+)/i, desc: 'Ensure the specified requirement is met', priority: 0.7 },
      { regex: /test\s+(.+)/i, desc: 'Write tests for the implementation', priority: 0.6 },
      { regex: /document\s+(.+)/i, desc: 'Document the implementation', priority: 0.5 },
      { regex: /handle\s+(.+)/i, desc: 'Handle edge cases and error conditions', priority: 0.7 },
    ];

    for (const { regex, desc, priority } of patterns) {
      if (regex.test(task)) {
        intents.push({ description: desc, priority });
      }
    }

    // Always add a general completion intent
    if (intents.length === 0) {
      intents.push({ description: `Complete the task: ${task.slice(0, 200)}`, priority: 1.0 });
    }
  }

  return intents;
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run intent-driven iteration.
 *
 * Maintains a Latent Intent Field across iterations. Each iteration
 * samples the most uncertain high-priority intents and focuses the
 * LLM on resolving them.
 */
export async function runIntentDrivenMode(
  baseConfig: UnifiedAgentConfig,
  options: IntentFieldConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const decayFactor = options.decayFactor ?? 0.97;
  const stopThreshold = options.stopThreshold ?? 0.05;
  const sampleSize = options.sampleSize ?? 3;
  const maxIterations = options.maxIterations ?? 10;

  const provider = baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const model = baseConfig.model || process.env.DEFAULT_MODEL || 'gpt-4o';

  log.info('[IntentDriven] ┌─ ENTRY ─────────────────────────────');
  log.info('[IntentDriven] │ decay:', decayFactor);
  log.info('[IntentDriven] │ stopThreshold:', stopThreshold);
  log.info('[IntentDriven] │ sampleSize:', sampleSize);
  log.info('[IntentDriven] │ maxIterations:', maxIterations);
  log.info('[IntentDriven] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[IntentDriven] └──────────────────────────────────────');

  // ── Initialize Intent Field ───────────────────────────────────────────────
  const field = new IntentField(decayFactor);

  if (options.customIntents && options.customIntents.length > 0) {
    await field.initialize(options.customIntents);
  } else {
    const intents = await extractIntentsFromTask(baseConfig.userMessage, provider, model);
    await field.initialize(intents);
  }

  log.info('[IntentDriven] → Intent field initialized', {
    count: field.vectors.size,
    summary: field.summary(),
  });

  // ── Iteration Loop ───────────────────────────────────────────────────────
  let bestResult: UnifiedAgentResult | null = null;
  let bestScore = -1;
  let iterationLog: string[] = [];

  for (let iter = 1; iter <= maxIterations; iter++) {
    log.info(`[IntentDriven] ┌─ Iteration ${iter}/${maxIterations} ──────────`);

    // Check convergence
    if (field.hasConverged(stopThreshold)) {
      log.info('[IntentDriven] ✓ Converged! No significant unresolved intent');
      break;
    }

    // Sample top intents
    const sampledIntents = field.sampleTopK(sampleSize);
    const intentFocus = sampledIntents
      .map((i, idx) => `${idx + 1}. ${i.description} (priority: ${i.priority}, uncertainty: ${i.entropy.toFixed(2)})`)
      .join('\n');

    log.info(`[IntentDriven] │ Sampled intents:`);
    for (const si of sampledIntents) {
      log.info(`[IntentDriven] │   - ${si.description.slice(0, 60)}... (score: ${(si.priority * si.entropy).toFixed(3)})`);
    }

    // Build system prompt with intent context
    const systemPrompt = buildIntentPrompt(
      baseConfig.systemPrompt || 'You are an expert software engineer.',
      baseConfig.userMessage,
      intentFocus,
      iterationLog,
      iter,
    );

    // Run LLM
    const result = await processUnifiedAgentRequest({
      ...baseConfig,
      systemPrompt,
      mode: 'v1-api',
    });

    if (!result.success) {
      log.info(`[IntentDriven] ✗ Iteration ${iter} failed`, { error: result.error });
      iterationLog.push(`Iter ${iter}: FAILED — ${result.error}`);
      if (bestResult) continue;
      return result;
    }

    // Update intent field based on output
    await field.updateFromOutput(result.response);
    field.decay();

    // Track best result (by how many intents are resolved)
    const resolvedCount = [...field.vectors.values()].filter(v => v.resolved).length;
    const totalIntents = field.vectors.size;
    const resolveRatio = resolvedCount / totalIntents;
    if (resolveRatio > bestScore) {
      bestResult = result;
      bestScore = resolveRatio;
    }

    iterationLog.push(`Iter ${iter}: ${resolvedCount}/${totalIntents} intents resolved`);

    log.info(`[IntentDriven] │ Field state: ${field.summary()}`);

    // Check if all intents are resolved
    if (resolveRatio >= 1.0) {
      log.info('[IntentDriven] ✓ All intents resolved!');
      return {
        ...result,
        mode: 'intent-driven',
        metadata: {
          ...result.metadata,
          intentField: {
            iterations: iter,
            converged: true,
            intentsResolved: resolvedCount,
            totalIntents,
            field: [...field.vectors.values()].map(v => ({
              id: v.id,
              description: v.description.slice(0, 100),
              priority: v.priority,
              resolved: v.resolved,
            })),
            duration: Date.now() - startTime,
          },
        },
      };
    }

    // Check if we should continue (still have unresolved high-priority intents)
    const unresolved = field.getUnresolved();
    if (unresolved.length === 0 || unresolved[0].priority * unresolved[0].entropy < stopThreshold) {
      log.info('[IntentDriven] → No significant unresolved intent, stopping');
      break;
    }
  }

  // ── End of Loop ──────────────────────────────────────────────────────────
  log.info('[IntentDriven] → Loop ended', {
    bestScore,
    fieldSummary: field.summary(),
  });

  return {
    ...(bestResult || { success: false, response: '', mode: 'intent-driven', error: 'No iterations succeeded' }),
    mode: 'intent-driven',
    metadata: {
      ...(bestResult?.metadata || {}),
      intentField: {
        iterations: maxIterations,
        converged: field.hasConverged(stopThreshold),
        intentsResolved: [...field.vectors.values()].filter(v => v.resolved).length,
        totalIntents: field.vectors.size,
        unresolvedIntents: field.getUnresolved().map(v => ({
          id: v.id,
          description: v.description.slice(0, 100),
          priority: v.priority,
          entropy: v.entropy,
        })),
        field: [...field.vectors.values()].map(v => ({
          id: v.id,
          description: v.description.slice(0, 100),
          priority: v.priority,
          entropy: v.entropy,
          resolved: v.resolved,
        })),
        iterationLog,
        duration: Date.now() - startTime,
      },
    },
  };
}

/**
 * Build system prompt with intent context.
 */
function buildIntentPrompt(
  basePrompt: string,
  _task: string,
  intentFocus: string,
  history: string[],
  iteration: number,
): string {
  const parts = [basePrompt];

  if (history.length > 0) {
    parts.push('\n## Iteration History\n');
    parts.push(history.join('\n'));
    parts.push('\nBuild upon previous work. Do NOT start over.');
  }

  parts.push(`\n\n## Current Focus (Iteration ${iteration})`);
  parts.push('Address these unresolved intents in order of priority × uncertainty:');
  parts.push(intentFocus);
  parts.push('\nFocus on resolving the above. Skip items already addressed in previous iterations.');

  return parts.join('\n');
}
