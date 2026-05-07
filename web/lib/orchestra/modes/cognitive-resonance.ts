/**
 * Cognitive Resonance Mode (Harness Idea #32)
 *
 * Runs N independent agents on the same task, then clusters outputs by
 * embedding similarity. Directions where multiple agents independently
 * converge are amplified (high confidence). Outliers are suppressed
 * unless in exploratory phase.
 *
 * Flow:
 *   1. Spawn N agents (default: 3) with diverse system prompts
 *   2. Collect all outputs
 *   3. Embed each output and compute pairwise similarity
 *   4. Cluster: find groups of agents that converged on similar answers
 *   5. If a cluster has ≥ 2 agents → amplify (high confidence)
 *   6. Merge the largest cluster into the final output
 *   7. If no convergence → run a synthesizer to pick the best elements
 *
 * Cost: N + 1 LLM calls (N agents + 1 synthesizer if no convergence).
 * Benefit: Independent agreement = strong signal; catches cases where a
 * single agent goes off-track.
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

const log = createLogger('CognitiveResonanceMode');

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ResonanceConfig {
  /** Number of independent agents to run (default: 3) */
  numAgents?: number;
  /** Model for agent calls (default: from config) */
  agentModel?: string;
  /** Provider for agent calls (default: from config) */
  agentProvider?: string;
  /** Model for synthesizer if no convergence (default: from config) */
  synthesizerModel?: string;
  /** Provider for synthesizer (default: from config) */
  synthesizerProvider?: string;
  /** Minimum cluster size to consider "converged" (default: 2) */
  minClusterSize?: number;
  /** Similarity threshold for clustering (default: 0.7) */
  similarityThreshold?: number;
  /** Temperature diversity: spread across agents (default: [0.3, 0.5, 0.7]) */
  temperatures?: number[];
  /** Max tokens per agent (default: 8192) */
  maxTokens?: number;
  /** Architecture/engine for agent calls (default: from baseConfig.engine or env) */
  engine?: EngineArchitecture;
}

// ─── Diverse System Prompts ────────────────────────────────────────────────

/**
 * Generate N diverse system prompts that approach the same task
 * from different reasoning angles.
 */
function generateDiversePrompts(
  basePrompt: string,
  n: number
): string[] {
  const perspectives = [
    {
      label: 'conservative',
      instruction: 'Take a conservative, risk-averse approach. Prioritize correctness and simplicity. Avoid clever solutions.',
    },
    {
      label: 'thorough',
      instruction: 'Take a thorough, comprehensive approach. Address all edge cases and provide detailed error handling.',
    },
    {
      label: 'pragmatic',
      instruction: 'Take a pragmatic, get-it-done approach. Focus on working code quickly. Optimize later if needed.',
    },
    {
      label: 'architectural',
      instruction: 'Take an architectural, design-first approach. Build clean abstractions and separation of concerns.',
    },
    {
      label: 'minimalist',
      instruction: 'Take a minimalist approach. Write the least code possible. Every line must earn its place.',
    },
    {
      label: 'defensive',
      instruction: 'Take a defensive approach. Validate all inputs, handle all errors, and fail safely.',
    },
  ];

  const selected = perspectives.slice(0, n);
  return selected.map(p => [
    basePrompt || 'You are an expert software engineer.',
    '',
    `## Reasoning Style: ${p.label}`,
    p.instruction,
    '',
    'Produce your complete solution following this approach.',
  ].join('\n'));
}

// ─── Clustering ─────────────────────────────────────────────────────────────

interface AgentOutput {
  index: number;
  embedding: number[];
  response: string;
  success: boolean;
}

interface Cluster {
  members: number[];  // Agent indices
  centroid: number[];
  avgSimilarity: number;
}

/**
 * Compute pairwise similarity matrix between agent outputs.
 */
function computeSimilarityMatrix(outputs: AgentOutput[]): number[][] {
  const n = outputs.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(outputs[i].embedding, outputs[j].embedding);
      // Normalize from [-1, 1] to [0, 1]
      const normSim = Math.max(0, Math.min(1, (sim + 1) / 2));
      matrix[i][j] = normSim;
      matrix[j][i] = normSim;
    }
  }

  return matrix;
}

/**
 * Simple greedy clustering: find groups of agents with similarity >= threshold.
 */
function clusterOutputs(
  outputs: AgentOutput[],
  similarityMatrix: number[][],
  threshold: number,
  minClusterSize: number
): Cluster[] {
  const n = outputs.length;
  const assigned = new Set<number>();
  const clusters: Cluster[] = [];

  // Sort pairs by similarity (descending)
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (similarityMatrix[i][j] >= threshold) {
        pairs.push([i, j, similarityMatrix[i][j]]);
      }
    }
  }
  pairs.sort((a, b) => b[2] - a[2]);

  // Greedy clustering: build clusters from highest-similarity pairs
  for (const [i, j, sim] of pairs) {
    const iAssigned = assigned.has(i);
    const jAssigned = assigned.has(j);

    if (iAssigned && jAssigned) {
      // Both already in clusters — check if same cluster
      const clusterI = clusters.find(c => c.members.includes(i));
      const clusterJ = clusters.find(c => c.members.includes(j));
      if (clusterI && clusterJ && clusterI !== clusterJ) {
        // Merge clusters
        clusterI.members = [...new Set([...clusterI.members, ...clusterJ.members])];
        clusters.splice(clusters.indexOf(clusterJ), 1);
      }
    } else if (iAssigned) {
      const cluster = clusters.find(c => c.members.includes(i));
      if (cluster && !cluster.members.includes(j)) {
        cluster.members.push(j);
        assigned.add(j);
      }
    } else if (jAssigned) {
      const cluster = clusters.find(c => c.members.includes(j));
      if (cluster && !cluster.members.includes(i)) {
        cluster.members.push(i);
        assigned.add(i);
      }
    } else {
      // New cluster
      clusters.push({
        members: [i, j],
        centroid: [], // Will compute
        avgSimilarity: sim,
      });
      assigned.add(i);
      assigned.add(j);
    }
  }

  // Filter clusters below min size
  const validClusters = clusters.filter(c => c.members.length >= minClusterSize);

  // Compute centroids for valid clusters
  for (const cluster of validClusters) {
    const embeddings = cluster.members.map(i => outputs[i].embedding);
    cluster.centroid = computeCentroid(embeddings);
    // Recompute avg similarity to centroid
    cluster.avgSimilarity = cluster.members.reduce((sum, i) => {
      const sim = cosineSimilarity(cluster.centroid, outputs[i].embedding);
      return sum + Math.max(0, Math.min(1, (sim + 1) / 2));
    }, 0) / cluster.members.length;
  }

  // Sort by size (largest first)
  validClusters.sort((a, b) => b.members.length - a.members.length);

  return validClusters;
}

/**
 * Compute the centroid (mean vector) of a set of embeddings.
 */
function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run cognitive resonance mode.
 *
 * Spawns N independent agents with diverse reasoning approaches,
 * clusters outputs by embedding similarity, and merges the converged result.
 */
export async function runCognitiveResonanceMode(
  baseConfig: UnifiedAgentConfig,
  options: ResonanceConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const numAgents = options.numAgents ?? 3;
  const agentProvider = options.agentProvider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const agentModel = options.agentModel || baseConfig.model || process.env.DEFAULT_MODEL || 'gpt-4o';
  const synthesizerProvider = options.synthesizerProvider || agentProvider;
  const synthesizerModel = options.synthesizerModel || agentModel;
  const minClusterSize = options.minClusterSize ?? 2;
  const similarityThreshold = options.similarityThreshold ?? 0.7;
  const maxTokens = options.maxTokens ?? 8192;

  // Generate diverse temperatures
  const temperatures = options.temperatures ?? [0.3, 0.5, 0.7, 0.4, 0.6];

  log.info('[CognitiveResonance] ┌─ ENTRY ──────────────────────');
  log.info('[CognitiveResonance] │ numAgents:', numAgents);
  log.info('[CognitiveResonance] │ model:', `${agentProvider}/${agentModel}`);
  log.info('[CognitiveResonance] │ minClusterSize:', minClusterSize);
  log.info('[CognitiveResonance] │ similarityThreshold:', similarityThreshold);
  log.info('[CognitiveResonance] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[CognitiveResonance] └──────────────────────────────');

  // ── Phase 1: Spawn Independent Agents ─────────────────────────────────────
  const diversePrompts = generateDiversePrompts(
    baseConfig.systemPrompt || 'You are an expert software engineer.',
    numAgents,
  );

  log.info('[CognitiveResonance] → Spawning agents', {
    count: numAgents,
    perspectives: diversePrompts.map((_, i) => `agent-${i}`).join(', '),
  });

  const agentPromises = diversePrompts.map(async (prompt, i) => {
    const temp = temperatures[i % temperatures.length];
    log.info(`[CognitiveResonance] │ Agent ${i}: temp=${temp}`);

    const engine = resolveEngine(options.engine, baseConfig.engine);
    const subCall = configureSubCall({
      ...baseConfig,
      provider: agentProvider,
      model: agentModel,
      systemPrompt: prompt,
      temperature: temp,
      maxTokens,
      mode: 'v1-api',
    }, engine);
    const result = await processUnifiedAgentRequest(subCall);

    return {
      index: i,
      result,
      prompt: prompt.slice(0, 200),
    };
  });

  const agentResults = await Promise.all(agentPromises);

  // ── Phase 2: Embed Outputs ────────────────────────────────────────────────
  const validOutputs: AgentOutput[] = [];
  for (const ar of agentResults) {
    if (ar.result.success && ar.result.response.length > 0) {
      try {
        const embeddings = await embedBatch([ar.result.response]);
        validOutputs.push({
          index: ar.index,
          embedding: embeddings[0],
          response: ar.result.response,
          success: true,
        });
      } catch {
        log.warn(`[CognitiveResonance] Failed to embed agent ${ar.index} output`);
        // Include without embedding — won't cluster but still available
        validOutputs.push({
          index: ar.index,
          embedding: new Array(1536).fill(0),
          response: ar.result.response,
          success: true,
        });
      }
    } else {
      log.warn(`[CognitiveResonance] Agent ${ar.index} failed: ${ar.result.error}`);
    }
  }

  if (validOutputs.length === 0) {
    log.info('[CognitiveResonance] ✗ All agents failed');
    return { success: false, response: '', mode: 'cognitive-resonance', error: 'All agents failed' };
  }

  if (validOutputs.length === 1) {
    log.info('[CognitiveResonance] → Only 1 agent succeeded, returning its output');
    const single = agentResults.find(a => a.index === validOutputs[0].index)!;
    return {
      ...single.result,
      mode: 'cognitive-resonance-single',
      metadata: {
        ...single.result.metadata,
        resonance: {
          agentsSpawned: numAgents,
          agentsSucceeded: 1,
          converged: false,
          reason: 'Only 1 agent succeeded',
          duration: Date.now() - startTime,
        },
      },
    };
  }

  // ── Phase 3: Cluster by Similarity ────────────────────────────────────────
  const similarityMatrix = computeSimilarityMatrix(validOutputs);
  const clusters = clusterOutputs(validOutputs, similarityMatrix, similarityThreshold, minClusterSize);

  log.info('[CognitiveResonance] ┌─ CLUSTERING ───────────────────────');
  log.info('[CognitiveResonance] │ clusters:', clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    log.info(`[CognitiveResonance] │ cluster ${i}: ${clusters[i].members.length} agents, similarity: ${clusters[i].avgSimilarity.toFixed(3)}`);
  }
  log.info('[CognitiveResonance] └────────────────────────────────────');

  // ── Phase 4: Merge or Synthesize ──────────────────────────────────────────
  if (clusters.length > 0 && clusters[0].members.length >= minClusterSize) {
    // Convergence: use the output from the largest cluster
    const bestCluster = clusters[0];
    // Pick the member closest to centroid
    let bestMemberIdx = bestCluster.members[0];
    let bestSim = -1;
    for (const memberIdx of bestCluster.members) {
      const output = validOutputs.find(o => o.index === memberIdx)!;
      const sim = cosineSimilarity(bestCluster.centroid, output.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestMemberIdx = memberIdx;
      }
    }

    const bestResult = agentResults.find(a => a.index === bestMemberIdx)!;
    log.info(`[CognitiveResonance] ✓ Converged on agent ${bestMemberIdx} (cluster size: ${bestCluster.members.length})`);

    return {
      ...bestResult.result,
      mode: 'cognitive-resonance-converged',
      metadata: {
        ...bestResult.result.metadata,
        resonance: {
          agentsSpawned: numAgents,
          agentsSucceeded: validOutputs.length,
          converged: true,
          clusterSize: bestCluster.members.length,
          clusterAgents: bestCluster.members,
          similarity: bestSim,
          duration: Date.now() - startTime,
        },
      },
    };
  }

  // No convergence: run synthesizer to pick best elements
  log.info('[CognitiveResonance] → No convergence, running synthesizer');

  const synthesisContext = agentResults
    .filter(a => a.result.success)
    .map((a, i) => `### Agent ${a.index} Output:\n${a.result.response.slice(0, 2000)}`)
    .join('\n\n' + '='.repeat(60) + '\n\n');

  const synthesizerPrompt = [
    baseConfig.systemPrompt || 'You are an expert software engineer.',
    '',
    '## Multiple Independent Attempts',
    `${numAgents} agents independently attempted this task with different approaches.`,
    'Review all attempts below and produce the best final result.',
    'Combine the strongest ideas. Discard weak or incorrect approaches.',
    '',
    synthesisContext.slice(0, 12000),
  ].join('\n');

  const engine = resolveEngine(options.engine, baseConfig.engine);
  const synthCall = configureSubCall({
    ...baseConfig,
    provider: synthesizerProvider,
    model: synthesizerModel,
    systemPrompt: synthesizerPrompt,
    temperature: 0.4,
    maxTokens: maxTokens * 2,
    mode: 'v1-api',
  }, engine);
  const synthesisResult = await processUnifiedAgentRequest(synthCall);

  if (synthesisResult.success) {
    log.info('[CognitiveResonance] ✓ Synthesis succeeded');
    return {
      ...synthesisResult,
      mode: 'cognitive-resonance-synthesized',
      metadata: {
        ...synthesisResult.metadata,
        resonance: {
          agentsSpawned: numAgents,
          agentsSucceeded: validOutputs.length,
          converged: false,
          reason: 'No convergence, synthesized result',
          similarityMatrix: similarityMatrix.map(row => row.map(v => parseFloat(v.toFixed(3)))),
          duration: Date.now() - startTime,
        },
      },
    };
  }

  // Synthesis failed — return the best single agent output
  log.info('[CognitiveResonance] ✗ Synthesis failed, returning best single agent');
  const bestSingle = agentResults.reduce((best, a) =>
    a.result.success && a.result.response.length > (best?.result.response.length || 0) ? a : best
  , agentResults[0]);

  return {
    ...bestSingle.result,
    mode: 'cognitive-resonance-fallback',
    metadata: {
      ...bestSingle.result.metadata,
      resonance: {
        agentsSpawned: numAgents,
        agentsSucceeded: validOutputs.length,
        converged: false,
        reason: 'No convergence and synthesis failed',
        duration: Date.now() - startTime,
      },
    },
  };
}
