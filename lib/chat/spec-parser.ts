/**
 * Spec Parsing + Chunking Engine
 *
 * Parses raw LLM output into structured specs
 * Chunks specs for iterative refinement
 */

import { Spec } from '@/lib/prompts/spec-generator'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('Spec:Parser')

export interface RefinementChunk {
  title: string
  tasks: string[]
  priority?: number
}

export interface ExplodedChunk extends RefinementChunk {
  /** Single task for focused refinement */
  tasks: [string]
}

// ---------------------------------------------------------------------------
// Lightweight JSON fixup — handles the most common LLM formatting mistakes
// WITHOUT resorting to a full JSON5 parser.
// ---------------------------------------------------------------------------

/**
 * Remove trailing commas from JSON-like strings.
 * Handles: [1, 2,] and { "a": 1, } patterns.
 */
function removeTrailingCommas(raw: string): string {
  // Trailing comma before ] or }
  return raw.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Strip a single-line or multi-line JavaScript comment from a JSON string.
 * LLMs occasionally emit // and /* comments inside JSON blobs.
 */
function stripJsonComments(raw: string): string {
  // Remove single-line // comments (safe outside of strings for LLM outputs)
  return raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Apply a sequence of cheap fixups that make minor LLM JSON errors parseable.
 * Falls back to the original string if the result is not valid JSON.
 */
function tryRepairJson(raw: string): string {
  let s = stripJsonComments(raw)
  s = removeTrailingCommas(s)
  return s
}

// ---------------------------------------------------------------------------
// Brace-balanced JSON extraction — O(n) single-pass
// ---------------------------------------------------------------------------

/**
 * Extract the first top-level JSON object from an arbitrary string.
 * Uses a single O(n) pass that correctly handles escaped characters inside
 * string literals, so it won't mistake a { inside "some \"brace\" string"
 * for a real brace.
 */
function extractFirstJsonObject(text: string): string | null {
  let depth = 0
  let inString = false
  let escape = false
  let start = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Safely parse spec from raw LLM output.
 *
 * Strategy (in order):
 * 1. Direct JSON.parse (fast path, no allocation overhead)
 * 2. JSON inside a ``` … ``` fenced code block
 * 3. Brace-balanced extraction from surrounding prose
 * 4. Extraction + trailing-comma / comment repair
 *
 * @param raw - Raw LLM output
 * @returns Parsed spec or null
 */
export function safeParseSpec(raw: string): Spec | null {
  if (!raw || typeof raw !== 'string') {
    logger.debug('Empty or invalid raw spec')
    return null
  }

  const cleaned = raw.trim()
  if (cleaned.length < 20) {
    logger.debug('Raw spec too short', { length: cleaned.length })
    return null
  }

  // 1. Direct parse (cheapest — avoids regex overhead for well-formed output)
  try {
    const parsed = JSON.parse(cleaned)
    logger.debug('Direct JSON parse successful')
    return parsed as Spec
  } catch {
    // fall through
  }

  // 2. Fenced code block: ```json … ``` or ``` … ```
  //    Capture only the first fence block to avoid scanning the entire string
  //    multiple times.
  const fenceStart = cleaned.indexOf('```')
  if (fenceStart !== -1) {
    const innerStart = cleaned.indexOf('\n', fenceStart)
    const fenceEnd = cleaned.indexOf('```', innerStart + 1)
    if (innerStart !== -1 && fenceEnd !== -1) {
      const candidate = cleaned.slice(innerStart + 1, fenceEnd).trim()
      try {
        const parsed = JSON.parse(candidate)
        logger.debug('Parsed JSON from fenced code block')
        return parsed as Spec
      } catch {
        // Try with repair
        try {
          const parsed = JSON.parse(tryRepairJson(candidate))
          logger.debug('Parsed JSON from fenced code block after repair')
          return parsed as Spec
        } catch {
          // fall through
        }
      }
    }
  }

  // 3. Brace-balanced extraction (handles LLM that wraps JSON in prose)
  const extracted = extractFirstJsonObject(cleaned)
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted)
      logger.debug('Parsed JSON via brace-balanced extraction')
      return parsed as Spec
    } catch {
      // 4. Extraction + repair
      try {
        const parsed = JSON.parse(tryRepairJson(extracted))
        logger.debug('Parsed JSON via brace-balanced extraction + repair')
        return parsed as Spec
      } catch {
        // fall through
      }
    }
  }

  logger.warn('All spec parsing attempts failed', {
    rawLength: cleaned.length,
    first100: cleaned.substring(0, 100),
  })
  return null
}

/**
 * Chunk spec into refinement units sorted by priority.
 */
export function chunkSpec(spec: Spec): RefinementChunk[] {
  if (!spec || !spec.sections) {
    logger.warn('Invalid spec for chunking')
    return []
  }

  const chunks: RefinementChunk[] = spec.sections.map(section => ({
    title: section.title,
    tasks: section.tasks,
    priority: section.priority,
  }))

  const sorted = chunks.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))

  logger.debug(`Chunked spec into ${sorted.length} sections`, {
    sections: sorted.map(s => s.title),
  })

  return sorted
}

/**
 * Explode chunks into single-task units.
 * Used for "max" mode — each task gets individual refinement.
 */
export function explodeChunks(chunks: RefinementChunk[]): ExplodedChunk[] {
  const exploded: ExplodedChunk[] = []

  for (const chunk of chunks) {
    for (const task of chunk.tasks) {
      exploded.push({
        title: chunk.title,
        tasks: [task],
        priority: chunk.priority,
      })
    }
  }

  logger.debug(`Exploded ${chunks.length} chunks into ${exploded.length} tasks`)
  return exploded
}

/**
 * Merge duplicate tasks across chunks (case-insensitive, trimmed).
 * First occurrence wins.
 */
export function mergeDuplicateTasks(chunks: RefinementChunk[]): RefinementChunk[] {
  const seen = new Set<string>()
  const merged: RefinementChunk[] = []

  for (const chunk of chunks) {
    const dedupedTasks: string[] = []
    for (const task of chunk.tasks) {
      const key = task.toLowerCase().trim()
      if (!seen.has(key)) {
        seen.add(key)
        dedupedTasks.push(task)
      }
    }
    if (dedupedTasks.length > 0) {
      merged.push({ ...chunk, tasks: dedupedTasks })
    }
  }

  logger.debug(`Merged duplicates: ${chunks.length} → ${merged.length} chunks`)
  return merged
}

/**
 * Filter chunks by minimum quality.
 */
export function filterChunksByQuality(
  chunks: RefinementChunk[],
  minTasks: number = 1,
): RefinementChunk[] {
  const filtered = chunks.filter(
    chunk =>
      chunk.tasks.length >= minTasks && chunk.tasks.every(t => t.length > 5),
  )
  logger.debug(`Filtered chunks: ${chunks.length} → ${filtered.length}`)
  return filtered
}

/** Get total task count from chunks. */
export function getTotalTaskCount(chunks: RefinementChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.tasks.length, 0)
}

/**
 * Estimate refinement time based on chunks.
 * @param avgTimePerTask Average time per task in ms (default: 2000)
 */
export function estimateRefinementTime(
  chunks: RefinementChunk[],
  avgTimePerTask: number = 2000,
): number {
  return getTotalTaskCount(chunks) * avgTimePerTask
}
