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

/**
 * Safely parse spec from raw LLM output
 * 
 * Handles:
 * - Direct JSON
 * - JSON in markdown code blocks
 * - JSON objects extracted from text
 * - Minor JSON formatting issues (trailing commas, etc.)
 * 
 * @param raw - Raw LLM output
 * @returns Parsed spec or null
 */
export function safeParseSpec(raw: string): Spec | null {
  if (!raw || typeof raw !== 'string') {
    logger.debug('Empty or invalid raw spec')
    return null
  }
  
  // Trim and clean
  const cleaned = raw.trim()
  
  // Minimum length check
  if (cleaned.length < 20) {
    logger.debug('Raw spec too short', { length: cleaned.length })
    return null
  }
  
  try {
    // Try direct parse first
    const parsed = JSON.parse(cleaned)
    logger.debug('Direct JSON parse successful')
    return parsed
  } catch {
    logger.debug('Direct JSON parse failed, trying alternatives')
  }
  
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim())
        logger.debug('Successfully extracted JSON from markdown block')
        return parsed
      } catch {
        logger.debug('Markdown block extraction failed')
      }
    }
  } catch (e) {
    logger.debug('Markdown extraction error:', e)
  }
  
  try {
    // Try to extract JSON object from text (finds { ... })
    // Handle nested objects by counting braces
    let braceCount = 0
    let startIndex = -1
    let endIndex = -1
    
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (braceCount === 0) startIndex = i
        braceCount++
      } else if (cleaned[i] === '}') {
        braceCount--
        if (braceCount === 0) {
          endIndex = i
          break
        }
      }
    }
    
    if (startIndex !== -1 && endIndex !== -1) {
      const jsonStr = cleaned.substring(startIndex, endIndex + 1)
      try {
        const parsed = JSON.parse(jsonStr)
        logger.debug('Successfully extracted JSON object from text')
        return parsed
      } catch {
        logger.debug('JSON object extraction failed')
      }
    }
  } catch (e) {
    logger.debug('Object extraction error:', e)
  }
  
  logger.warn('All spec parsing attempts failed', { 
    rawLength: cleaned.length,
    first100: cleaned.substring(0, 100)
  })
  return null
}

/**
 * Chunk spec into refinement units
 * 
 * @param spec - Parsed spec
 * @returns Array of refinement chunks
 */
export function chunkSpec(spec: Spec): RefinementChunk[] {
  if (!spec || !spec.sections) {
    logger.warn('Invalid spec for chunking')
    return []
  }
  
  const chunks: RefinementChunk[] = spec.sections.map(section => ({
    title: section.title,
    tasks: section.tasks,
    priority: section.priority
  }))
  
  // Sort by priority if available
  const sorted = chunks.sort((a, b) => {
    const priorityA = a.priority ?? 999
    const priorityB = b.priority ?? 999
    return priorityA - priorityB
  })
  
  logger.debug(`Chunked spec into ${sorted.length} sections`, {
    sections: sorted.map(s => s.title)
  })
  
  return sorted
}

/**
 * Explode chunks into single-task units
 * 
 * Used for "max" mode - each task gets individual refinement
 * 
 * @param chunks - Standard chunks
 * @returns Exploded chunks with single tasks
 */
export function explodeChunks(chunks: RefinementChunk[]): ExplodedChunk[] {
  const exploded: ExplodedChunk[] = []
  
  for (const chunk of chunks) {
    for (const task of chunk.tasks) {
      exploded.push({
        title: chunk.title,
        tasks: [task],
        priority: chunk.priority
      })
    }
  }
  
  logger.debug(`Exploded ${chunks.length} chunks into ${exploded.length} tasks`)
  
  return exploded
}

/**
 * Merge duplicate tasks across chunks
 * 
 * @param chunks - Chunks to merge
 * @returns Merged chunks without duplicates
 */
export function mergeDuplicateTasks(chunks: RefinementChunk[]): RefinementChunk[] {
  const taskMap = new Map<string, RefinementChunk>()
  
  for (const chunk of chunks) {
    for (const task of chunk.tasks) {
      const taskKey = task.toLowerCase().trim()
      
      if (!taskMap.has(taskKey)) {
        taskMap.set(taskKey, {
          title: chunk.title,
          tasks: [task],
          priority: chunk.priority
        })
      }
    }
  }
  
  const merged = Array.from(taskMap.values())
  logger.debug(`Merged duplicates: ${chunks.length} → ${merged.length} chunks`)
  
  return merged
}

/**
 * Filter chunks by minimum quality
 * 
 * @param chunks - Chunks to filter
 * @param minTasks - Minimum tasks per chunk
 * @returns Filtered chunks
 */
export function filterChunksByQuality(
  chunks: RefinementChunk[],
  minTasks: number = 1
): RefinementChunk[] {
  const filtered = chunks.filter(chunk => 
    chunk.tasks.length >= minTasks &&
    chunk.tasks.every(t => t.length > 5)
  )
  
  logger.debug(`Filtered chunks: ${chunks.length} → ${filtered.length}`)
  
  return filtered
}

/**
 * Get total task count from chunks
 */
export function getTotalTaskCount(chunks: RefinementChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.tasks.length, 0)
}

/**
 * Estimate refinement time based on chunks
 * 
 * @param chunks - Chunks to estimate
 * @param avgTimePerTask - Average time per task in ms (default: 2000)
 * @returns Estimated time in ms
 */
export function estimateRefinementTime(
  chunks: RefinementChunk[],
  avgTimePerTask: number = 2000
): number {
  const totalTasks = getTotalTaskCount(chunks)
  return totalTasks * avgTimePerTask
}
