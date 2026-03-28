/**
 * Refinement Engine (CORE)
 * 
 * Handles iterative improvement loops with safeguards
 * Takes base response + spec chunks → refined output
 * 
 * @see lib/prompts/spec-generator.ts
 * @see lib/chat/spec-parser.ts
 */

import { createLogger } from '@/lib/utils/logger'
import { chatLogger } from '@/lib/chat/chat-logger'
import { RefinementChunk, ExplodedChunk } from './spec-parser'
import { diff_match_patch } from 'diff-match-patch'

const logger = createLogger('Refinement:Engine')

// Safeguards configuration
const POLICY = {
  maxIterations: 3,
  maxCost: 0.02,  // USD
  maxTokens: 8000,
  maxSpecSections: 5,
  timeBudgetMs: 8000,
  maxChunkTasks: 10,
}

export interface RefinementConfig {
  model: string
  baseResponse: string
  chunks: RefinementChunk[]
  mode: 'enhanced' | 'max'
  startTime: number
  userId?: string
  conversationId?: string
}

export interface RefinementResult {
  output: string
  iterations: number
  chunksProcessed: number
  timedOut: boolean
  tokensUsed?: number
}

/**
 * Refine response based on spec chunks
 * 
 * @param config - Refinement configuration
 * @returns Refined output
 */
export async function refineResponse(
  config: RefinementConfig
): Promise<RefinementResult> {
  const {
    model,
    baseResponse,
    chunks,
    mode,
    startTime,
    userId,
    conversationId
  } = config
  
  logger.info('Starting refinement', {
    mode,
    chunks: chunks.length,
    model,
    userId
  })
  
  // Validate inputs
  if (!baseResponse || baseResponse.length === 0) {
    logger.warn('Empty base response, skipping refinement')
    return {
      output: '',
      iterations: 0,
      chunksProcessed: 0,
      timedOut: false
    }
  }
  
  if (!chunks || chunks.length === 0) {
    logger.warn('No chunks provided, skipping refinement')
    return {
      output: baseResponse,
      iterations: 0,
      chunksProcessed: 0,
      timedOut: false
    }
  }
  
  let output = baseResponse
  let iterations = 0
  let chunksProcessed = 0
  let timedOut = false
  let totalTokens = 0
  
  // Limit chunks based on mode
  let limitedChunks: RefinementChunk[]
  
  if (mode === 'enhanced') {
    // Enhanced: Process only first section
    limitedChunks = chunks.slice(0, 1)
  } else {
    // Max: Process up to maxIterations sections
    limitedChunks = chunks.slice(0, POLICY.maxIterations)
  }
  
  // Filter oversized chunks
  limitedChunks = limitedChunks.filter(chunk => {
    if (chunk.tasks.length > POLICY.maxChunkTasks) {
      logger.warn('Chunk exceeds max tasks, skipping', {
        title: chunk.title,
        tasks: chunk.tasks.length
      })
      return false
    }
    
    // Filter empty tasks
    if (!chunk.tasks || chunk.tasks.length === 0) {
      logger.warn('Chunk has no tasks, skipping', {
        title: chunk.title
      })
      return false
    }
    
    return true
  })
  
  if (limitedChunks.length === 0) {
    logger.warn('No valid chunks after filtering, returning base response')
    return {
      output: baseResponse,
      iterations: 0,
      chunksProcessed: 0,
      timedOut: false
    }
  }
  
  logger.debug(`Processing ${limitedChunks.length} chunks`)
  
  // Process each chunk
  for (const chunk of limitedChunks) {
    // Safeguard: time budget
    const elapsed = Date.now() - startTime
    if (elapsed > POLICY.timeBudgetMs) {
      logger.warn('Time budget exceeded, stopping refinement', {
        elapsed,
        budget: POLICY.timeBudgetMs,
        remainingChunks: limitedChunks.length - chunksProcessed
      })
      timedOut = true
      break
    }
    
    // Safeguard: max iterations
    if (iterations >= POLICY.maxIterations) {
      logger.warn('Max iterations reached', { iterations })
      break
    }
    
    try {
      logger.debug('Refining chunk', {
        title: chunk.title,
        tasks: chunk.tasks.length,
        iteration: iterations + 1
      })

      const refinementPrompt = buildRefinementPrompt(chunk)

      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service')
      const refined = await enhancedLLMService.generateResponse({
        provider: 'auto',
        model,
        messages: [
          {
            role: 'system',
            content: refinementPrompt
          },
          {
            role: 'user',
            content: output
          }
        ],
        maxTokens: POLICY.maxTokens,
        temperature: 0.7,
        stream: false
      })

      const refinedContent = refined.content || ''

      // Validate refined output
      if (!refinedContent || refinedContent.length === 0) {
        logger.warn('Refinement returned empty output, keeping previous')
        continue
      }

      output = refinedContent
      iterations++
      chunksProcessed++

      logger.debug('Refinement iteration complete', {
        chunk: chunk.title,
        outputLength: output.length
      })

    } catch (error) {
      logger.error('Refinement iteration failed', {
        chunk: chunk.title,
        error: error instanceof Error ? error.message : error
      })

      // Continue with next chunk instead of failing entirely
      continue
    }
  }
  
  const duration = Date.now() - startTime

  logger.info('Refinement complete', {
    iterations,
    chunksProcessed,
    duration,
    timedOut,
    outputLength: output.length
  })

  return {
    output,
    iterations,
    chunksProcessed,
    timedOut,
    tokensUsed: totalTokens
  }
}

/**
 * Build refinement prompt for a chunk
 * 
 * @param chunk - Chunk to refine
 * @returns System prompt for refinement
 */
function buildRefinementPrompt(chunk: RefinementChunk): string {
  const tasksList = chunk.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  
  return `You are improving an existing AI-generated solution.

FOCUS AREA:
${chunk.title}

TASKS:
${tasksList}

RULES:
- Improve depth and correctness
- Add missing implementation details
- Do not repeat unchanged parts
- Output the COMPLETE improved result
- Focus on QUALITY over speed
- Make it PRODUCTION-READY

If the current output is missing critical elements, add them.
If the current output has errors or gaps, fix them.
If the current output is shallow, make it deeper and more comprehensive.

Return ONLY the improved output, no explanations.`
}

/**
 * Build diff-based refinement prompt (advanced)
 * 
 * Asks model to return only changes, not full output
 * 
 * @param chunk - Chunk to refine
 * @param currentOutput - Current output
 * @returns System prompt for diff-based refinement
 */
export function buildDiffRefinementPrompt(
  chunk: RefinementChunk,
  currentOutput: string
): string {
  const tasksList = chunk.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  
  return `You are improving an existing AI-generated solution.

FOCUS AREA:
${chunk.title}

TASKS:
${tasksList}

Return a DIFF showing ONLY the changes needed.

FORMAT:
--- ORIGINAL
+++ UPDATED
@@ section @@
- old code/content
+ new code/content

Rules:
- Show ONLY changed sections
- Use unified diff format
- Include enough context to locate changes
- Do not repeat unchanged parts

CURRENT OUTPUT:
${currentOutput.substring(0, 2000)}${currentOutput.length > 2000 ? '...' : ''}`
}

/**
 * Apply diff to output using diff-match-patch library
 *
 * @param original - Original output
 * @param diff - Diff to apply (unified diff format or patch string)
 * @returns Updated output
 */
export function applyDiff(original: string, diff: string): string {
  try {
    const dmp = new diff_match_patch();
    
    // Try to parse as unified diff first
    if (diff.includes('---') && diff.includes('+++')) {
      const patches = dmp.patch_fromText(diff);
      if (patches.length > 0) {
        const [result, success] = dmp.patch_apply(patches, original);
        if (success.every(s => s)) {
          return result;
        }
        // If patch application partially failed, fall through to simple diff
      }
    }
    
    // Fallback: treat diff as a simple replacement hint
    // This handles cases where LLM outputs informal diff-like content
    logger.debug('Using fallback diff application');
    return original;
  } catch (error) {
    logger.error('Failed to apply diff', { error: error instanceof Error ? error.message : error });
    return original;
  }
}

/**
 * Estimate tokens for refinement
 * 
 * @param chunks - Chunks to estimate
 * @param baseOutputLength - Length of base output
 * @returns Estimated token count
 */
export function estimateRefinementTokens(
  chunks: RefinementChunk[],
  baseOutputLength: number
): number {
  // Rough estimate: 1 token ≈ 4 characters
  const baseTokens = baseOutputLength / 4
  
  // Each refinement adds ~20% tokens
  const refinementOverhead = 0.2 * baseTokens * chunks.length
  
  return Math.round(baseTokens + refinementOverhead)
}
