/**
 * RAG Retrieval Pipeline
 *
 * Full retrieval pipeline for the knowledge store:
 * 1. Query preprocessing (task type detection, entity extraction)
 * 2. Embed query via existing /api/embed endpoint
 * 3. Vector search (coarse top-20)
 * 4. Rerank with quality + recency + usage boosts
 * 5. Filter by quality threshold and dedup
 * 6. Format for prompt injection
 *
 * Integrates with existing infrastructure:
 * - Uses embed() from lib/memory/embeddings.ts
 * - Uses cosineSimilarity from lib/retrieval/similarity.ts
 * - Uses buildContext/injectContextIntoPrompt patterns from lib/context/contextBuilder.ts
 */

import { createLogger } from '@/lib/utils/logger';
import { embed } from '@/lib/memory/embeddings';
import { estimateTokens } from '@/lib/context/contextBuilder';
import { getKnowledgeStore } from './knowledge-store';
import type { KnowledgeSearchResult, KnowledgeSearchOptions, KnowledgeType, KnowledgeChunk } from './knowledge-store';

const log = createLogger('RAGRetrieval');

// ============================================================================
// Types
// ============================================================================

export interface RetrievalPipelineOptions {
  /** Maximum number of chunks to return (default: 3) */
  topK?: number;
  /** Coarse retrieval size before reranking (default: 20) */
  coarseTopN?: number;
  /** Minimum quality threshold (0-1, default: 0.4) */
  minQuality?: number;
  /** Filter by knowledge type */
  typeFilter?: KnowledgeType[];
  /** Filter by task type (e.g., 'vfs_write', 'vfs_batch') */
  taskTypeFilter?: string;
  /** Filter by model relevance */
  modelFilter?: string;
  /** Include source attribution in output */
  includeSource?: boolean;
  /** Token budget for formatted output (default: 2000) */
  maxTokens?: number;
}

export interface RetrievalResult {
  /** Formatted context string ready for prompt injection */
  context: string;
  /** Raw search results */
  chunks: KnowledgeSearchResult[];
  /** Whether any knowledge was found */
  hasResults: boolean;
  /** Estimated token count */
  estimatedTokens: number;
  /** Retrieval metadata */
  metadata: {
    queryLength: number;
    candidatesSearched: number;
    candidatesReturned: number;
    avgScore: number;
    durationMs: number;
  };
}

// ============================================================================
// Task Type Detection
// ============================================================================

/**
 * Detect task type from user query for retrieval filtering.
 * Mirrors the task classifier's taskType field.
 */
export function detectTaskType(query: string): string {
  const q = query.toLowerCase();

  if (/write.*file|create.*file|new.*file|generate.*file|make.*file/i.test(q)) {
    if (/multiple|batch|several|\d+\s*file/i.test(q)) return 'vfs_batch';
    return 'vfs_write';
  }
  if (/diff|patch|modify.*existing|edit.*file|update.*file/i.test(q)) return 'vfs_diff';
  if (/read.*file|show.*file|view.*content/i.test(q)) return 'vfs_read';
  if (/delete.*file|remove.*file/i.test(q)) return 'vfs_write'; // close enough
  if (/directory|folder|mkdir/i.test(q)) return 'vfs_write';
  if (/debug|fix.*bug|error|exception|crash|fail/i.test(q)) return 'debug';
  if (/refactor|restructure|reorganize|migrate/i.test(q)) return 'code_edit';
  if (/test|spec|unit|integration/i.test(q)) return 'code_gen';
  if (/research|search|find.*information|look.*up/i.test(q)) return 'research';
  if (/analyz|statistic|report|chart|graph/i.test(q)) return 'analysis';
  if (/implement|build|create|write.*code|function|class|component|api|endpoint/i.test(q)) return 'code_gen';

  return 'question';
}

// ============================================================================
// Query Preprocessing
// ============================================================================

interface PreprocessedQuery {
  normalized: string;
  taskType: string;
  entities: string[];
  embedText: string;
}

/**
 * Preprocess query for retrieval.
 * Normalizes, detects task type, extracts key entities.
 */
function preprocessQuery(query: string): PreprocessedQuery {
  // Normalize: lowercase, strip extra whitespace
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();

  // Detect task type
  const taskType = detectTaskType(query);

  // Extract entities (simple keyword-based for now)
  const entities: string[] = [];

  // File paths / names
  const fileMatches = query.match(/[a-zA-Z0-9_.\-]+\.(ts|tsx|js|jsx|py|go|rs|java|css|html|json|yaml|yml|md|txt|sh|sql)/gi);
  if (fileMatches) entities.push(...fileMatches.map(f => f.toLowerCase()));

  // Tech keywords
  const techKeywords = ['react', 'flask', 'express', 'next', 'api', 'rest', 'graphql', 'docker', 'kubernetes', 'database', 'auth', 'login', 'component', 'service', 'controller', 'model', 'view', 'hook', 'middleware'];
  for (const kw of techKeywords) {
    if (query.toLowerCase().includes(kw)) entities.push(kw);
  }

  // Build enriched embedding text
  const embedText = `Task: ${query}\nTask type: ${taskType}\nKey entities: ${entities.join(', ') || 'none detected'}`;

  return { normalized, taskType, entities, embedText };
}

// ============================================================================
// Retrieval Pipeline
// ============================================================================

/**
 * Run the full RAG retrieval pipeline.
 *
 * @param query - The user's query or task description
 * @param options - Retrieval configuration
 * @returns Formatted context with metadata
 */
export async function runRetrievalPipeline(
  query: string,
  options: RetrievalPipelineOptions = {}
): Promise<RetrievalResult> {
  const startTime = Date.now();
  const store = getKnowledgeStore();

  const {
    topK = 3,
    coarseTopN = 20,
    minQuality = 0.4,
    typeFilter,
    taskTypeFilter,
    modelFilter,
    includeSource = true,
    maxTokens = 2000,
  } = options;

  log.info('RAG retrieval started', { queryLength: query.length, topK, taskTypeFilter });

  // ── Step 1: Query Preprocessing ──────────────────────────────────────────
  const preprocessed = preprocessQuery(query);

  // If no task type filter provided, auto-detect from query
  const effectiveTaskType = taskTypeFilter || preprocessed.taskType;

  // ── Step 2: Embed Query ──────────────────────────────────────────────────
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(preprocessed.embedText);
  } catch (error) {
    log.error('Query embedding failed', { error: error instanceof Error ? error.message : String(error) });
    return {
      context: '',
      chunks: [],
      hasResults: false,
      estimatedTokens: 0,
      metadata: {
        queryLength: query.length,
        candidatesSearched: 0,
        candidatesReturned: 0,
        avgScore: 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // ── Step 3: Coarse Vector Search (top-20) ───────────────────────────────
  const coarseResults = await store.search(queryEmbedding, {
    topK: coarseTopN,
    typeFilter,
    taskTypeFilter: effectiveTaskType,
    modelFilter,
    minQuality: Math.max(0, minQuality - 0.1), // Slightly lower threshold for coarse retrieval
  });

  log.debug('Coarse retrieval complete', { candidates: coarseResults.length });

  // ── Step 4: Rerank ───────────────────────────────────────────────────────
  // Already scored by the store's search method with quality + recency + usage boosts
  // Additional deduplication by content hash
  const seen = new Set<number>();
  const deduped: KnowledgeSearchResult[] = [];
  for (const result of coarseResults) {
    const hash = simpleHash(result.chunk.content.slice(0, 200));
    if (!seen.has(hash)) {
      seen.add(hash);
      deduped.push(result);
    }
  }

  // ── Step 5: Filter and slice ─────────────────────────────────────────────
  const filtered = deduped
    .filter(r => r.score >= minQuality * 0.6) // Minimum score threshold
    .slice(0, topK);

  // ── Step 6: Format for Prompt ────────────────────────────────────────────
  const context = formatKnowledgeForPrompt(filtered, { includeSource, maxTokens });
  const estimatedTokens = estimateTokens(context);

  const duration = Date.now() - startTime;
  const avgScore = filtered.length > 0
    ? filtered.reduce((sum, r) => sum + r.score, 0) / filtered.length
    : 0;

  log.info('RAG retrieval complete', {
    candidatesSearched: coarseResults.length,
    candidatesReturned: filtered.length,
    avgScore: avgScore.toFixed(3),
    estimatedTokens,
    durationMs: duration,
  });

  return {
    context,
    chunks: filtered,
    hasResults: filtered.length > 0,
    estimatedTokens,
    metadata: {
      queryLength: query.length,
      candidatesSearched: coarseResults.length,
      candidatesReturned: filtered.length,
      avgScore,
      durationMs: duration,
    },
  };
}

// ============================================================================
// Prompt Formatting
// ============================================================================

interface FormatOptions {
  includeSource: boolean;
  maxTokens: number;
}

/**
 * Format knowledge chunks for injection into the system prompt.
 * Respects token budget and source attribution preferences.
 */
function formatKnowledgeForPrompt(
  results: KnowledgeSearchResult[],
  options: FormatOptions
): string {
  if (results.length === 0) return '';

  const { includeSource, maxTokens } = options;
  const maxChars = maxTokens * 3.8; // Token budget → char budget (3.8 chars/token)

  let output = '\n## Relevant Knowledge\n\n';
  let charCount = output.length;

  for (let i = 0; i < results.length; i++) {
    const { chunk } = results[i];
    const sourceTag = includeSource && chunk.metadata.source
      ? ` (${chunk.metadata.source}, quality: ${(chunk.metadata.quality ?? 0.5).toFixed(2)})`
      : '';

    const header = `[${i + 1}]${sourceTag}:\n`;
    const content = chunk.content.trim();
    const entry = header + content + '\n\n';

    if (charCount + entry.length > maxChars) {
      // Truncate this entry to fit budget
      const remaining = maxChars - charCount - header.length - 10;
      if (remaining > 20) {
        output += header + content.slice(0, remaining) + '...\n\n';
      }
      break;
    }

    output += entry;
    charCount += entry.length;
  }

  return output.trim();
}

// ============================================================================
// Knowledge Ingestion Helpers
// ============================================================================

/**
 * Ingest a few-shot example into the knowledge store.
 */
export async function ingestFewShot(params: {
  taskType: string;
  input: string;
  output: string;
  model?: string;
  quality?: number;
}): Promise<string> {
  const store = getKnowledgeStore();
  const content = `Task: ${params.input}\nExpected output:\n${params.output}`;

  return store.insert({
    type: 'few_shot',
    content,
    embedding: await embed(content),
    metadata: {
      taskType: params.taskType,
      model: params.model,
      quality: params.quality ?? 1.0,
      source: 'curated',
    },
  });
}

/**
 * Ingest a practice experience into the knowledge store.
 */
export async function ingestExperience(params: {
  experience: string;
  taskType?: string;
  model?: string;
  quality?: number;
}): Promise<string> {
  const store = getKnowledgeStore();

  return store.insert({
    type: 'experience',
    content: params.experience,
    embedding: await embed(params.experience),
    metadata: {
      taskType: params.taskType,
      model: params.model,
      quality: params.quality ?? 0.7,
      source: 'practice',
    },
  });
}

/**
 * Ingest a successful production trajectory.
 */
export async function ingestTrajectory(params: {
  task: string;
  toolCalls: string;
  model: string;
  quality?: number;
}): Promise<string> {
  const store = getKnowledgeStore();
  const content = `Task: ${params.task}\nTool calls:\n${params.toolCalls}`;

  return store.insert({
    type: 'task_solution',
    content,
    embedding: await embed(content),
    metadata: {
      taskType: detectTaskType(params.task),
      model: params.model,
      quality: params.quality ?? 0.8,
      source: 'production',
    },
  });
}

/**
 * Ingest a rule or constraint.
 */
export async function ingestRule(params: {
  rule: string;
  taskType?: string;
  model?: string;
}): Promise<string> {
  const store = getKnowledgeStore();

  return store.insert({
    type: 'rule',
    content: params.rule,
    embedding: await embed(params.rule),
    metadata: {
      taskType: params.taskType,
      model: params.model,
      quality: 1.0,
      source: 'curated',
    },
  });
}

/**
 * Ingest an anti-pattern (what NOT to do).
 */
export async function ingestAntiPattern(params: {
  antiPattern: string;
  correctApproach: string;
  taskType?: string;
}): Promise<string> {
  const store = getKnowledgeStore();
  const content = `DON'T: ${params.antiPattern}\nDO INSTEAD: ${params.correctApproach}`;

  return store.insert({
    type: 'anti_pattern',
    content,
    embedding: await embed(content),
    metadata: {
      taskType: params.taskType,
      quality: 0.9,
      source: 'curated',
    },
  });
}

// ============================================================================
// Utilities
// ============================================================================

function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
