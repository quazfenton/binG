/**
 * Maximalist SPEC Enhancer
 * 
 * A comprehensive, multi-round spec enhancement system that emphasizes
 * big, intensive, multi-file, long, advanced professional code additions.
 * 
 * Key Features:
 * - More refinement rounds than minimalist mode (10 vs 3)
 * - Mid-point plan regeneration with full context at step N/2 + 1
 * - Progressive context weighting (latest additions get higher priority)
 * - Integration with smart-context.ts for intelligent context management
 * - Uses system prompts from packages/shared for prompt engineering
 * - Strategic meta-prompt injection at each enhancement round
 * - Can be toggled as default mode
 * 
 * Usage:
 * - Maximalist: Large feature additions, comprehensive implementations
 * - Minimalist: Small edits, quick improvements
 */

import { createLogger } from '@/lib/utils/logger';
import { Spec, buildSpecPrompt, validateSpec, scoreSpec } from '@/lib/prompts/spec-generator';
import { chunkSpec, safeParseSpec, mergeDuplicateTasks, filterChunksByQuality, type RefinementChunk } from './spec-parser';
import { getSystemPrompt, type AgentRole } from '@bing/shared/agent/system-prompts';
import { composeRoleWithTools } from '@bing/shared/agent/prompt-composer';
import { getMetaPromptForRound, getMetaPromptContextSummary, type MetaPromptConfig } from './spec-meta-prompts';

const logger = createLogger('MaximalistSpecEnhancer');

// ============================================================================
// Configuration
// ============================================================================

export type SpecEnhancementMode = 'maximalist' | 'minimalist';

export interface MaximalistConfig {
  /** Enhancement mode: maximalist (default) or minimalist */
  mode: SpecEnhancementMode;
  /** Number of refinement rounds - maximalist defaults to 10, minimalist to 3 */
  maxRounds: number;
  /** Whether maximalist is the default mode */
  defaultToMaximalist: boolean;
  /** Model to use for spec generation */
  model: string;
  /** Provider for LLM calls */
  provider: string;
  /** Temperature for LLM generation (0-1) */
  temperature: number;
  /** Max tokens per response */
  maxTokens: number;
  /** Context weight for previous additions (0-1, higher = more weight on latest) */
  contextWeight: number;
  /** Enable mid-point plan regeneration */
  enableMidPointRegen: boolean;
  /** Enable meta-prompt injection at each round */
  enableMetaPrompts: boolean;
  /** User ID for tracking */
  userId?: string;
  /** Conversation ID for context continuity */
  conversationId?: string;
}

/**
 * Default configuration for maximalist mode
 */
export const DEFAULT_MAXIMALIST_CONFIG: MaximalistConfig = {
  mode: 'maximalist',
  maxRounds: 10,
  defaultToMaximalist: true,
  model: 'gpt-4o',
  provider: 'openai',
  temperature: 0.7,
  maxTokens: 32000,
  contextWeight: 0.7,
  enableMidPointRegen: true,
  enableMetaPrompts: true,
};

/**
 * Default configuration for minimalist mode
 */
export const DEFAULT_MINIMALIST_CONFIG: MaximalistConfig = {
  mode: 'minimalist',
  maxRounds: 3,
  defaultToMaximalist: false,
  model: 'gpt-4o-mini',
  provider: 'openai',
  temperature: 0.5,
  maxTokens: 8000,
  contextWeight: 0.3,
  enableMidPointRegen: false,
  enableMetaPrompts: false,
};

// ============================================================================
// State Management
// ============================================================================

export interface EnhancementRound {
  roundNumber: number;
  spec: Spec;
  refinedOutput: string;
  chunksProcessed: number;
  startTime: number;
  endTime?: number;
  success: boolean;
  error?: string;
  /** Meta-prompt that was used in this round (if any) */
  metaPromptUsed?: string;
}

export interface MaximalistState {
  /** Original user request */
  originalRequest: string;
  /** Initial spec generated from request */
  initialSpec: Spec;
  /** All enhancement rounds completed */
  rounds: EnhancementRound[];
  /** Current accumulated output (combines all rounds) */
  accumulatedOutput: string;
  /** Context history for smart-context weighting */
  contextHistory: Array<{
    round: number;
    content: string;
    weight: number;
  }>;
  /** Whether mid-point regeneration occurred */
  midPointRegenOccurred: boolean;
  /** Final enhanced output */
  finalOutput: string;
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Determine enhancement mode based on request characteristics
 */
export function determineEnhancementMode(
  request: string,
  config?: Partial<MaximalistConfig>
): SpecEnhancementMode {
  const effectiveConfig = { ...DEFAULT_MAXIMALIST_CONFIG, ...config };
  
  // Check for explicit mode indicators in request
  const lowerRequest = request.toLowerCase();
  
  // Minimalist indicators - small, quick, simple changes
  if (
    lowerRequest.includes('fix') ||
    lowerRequest.includes('quick') ||
    lowerRequest.includes('small') ||
    lowerRequest.includes('tiny') ||
    lowerRequest.includes('edit') ||
    lowerRequest.includes('refactor') ||
    lowerRequest.includes('simple')
  ) {
    return 'minimalist';
  }
  
  // Maximalist indicators - comprehensive, large, multi-file
  if (
    lowerRequest.includes('build') ||
    lowerRequest.includes('implement') ||
    lowerRequest.includes('create') ||
    lowerRequest.includes('comprehensive') ||
    lowerRequest.includes('full') ||
    lowerRequest.includes('complete') ||
    lowerRequest.includes('system') ||
    lowerRequest.includes('architecture') ||
    lowerRequest.includes('overhaul') ||
    lowerRequest.includes('enhance') ||
    lowerRequest.includes('advanced')
  ) {
    return 'maximalist';
  }
  
  // Request length as a heuristic
  if (request.length > 500) {
    return 'maximalist';
  }
  
  // Default based on config
  return effectiveConfig.defaultToMaximalist ? 'maximalist' : 'minimalist';
}

/**
 * Get configuration for specified mode
 */
export function getConfigForMode(mode: SpecEnhancementMode): MaximalistConfig {
  return mode === 'maximalist' 
    ? { ...DEFAULT_MAXIMALIST_CONFIG }
    : { ...DEFAULT_MINIMALIST_CONFIG };
}

/**
 * Build the maximalist system prompt for spec generation
 * Uses system prompts from packages/shared for high-quality output
 */
function buildMaximalistSystemPrompt(
  mode: SpecEnhancementMode,
  previousRounds?: EnhancementRound[],
  contextWeight: number = 0.7
): string {
  const isMaximalist = mode === 'maximalist';
  
  let basePrompt = getSystemPrompt('architect');
  
  // Enhance with specific instructions for maximalist vs minimalist
  const enhancementInstructions = isMaximalist
    ? `
============================================
# MAXIMALIST ENHANCEMENT MODE
============================================

You are generating a COMPREHENSIVE enhancement plan for a major code implementation.

FOCUS:
- Multi-file, multi-module implementations
- Production-ready, enterprise-grade code
- Complete feature coverage with all edge cases
- Advanced patterns: error handling, logging, monitoring, testing
- No shortcuts - every component fully implemented

REQUIREMENTS:
- Break down into specific, granular tasks
- Each task should be a substantial piece of work
- Include implementation details, not just high-level steps
- Consider integration points, dependencies, and testing
- Generate tasks that require multiple API calls to fully implement

OUTPUT: More sections, more tasks, deeper implementation details.
`
    : `
============================================
# MINIMALIST ENHANCEMENT MODE
============================================

You are generating a QUICK enhancement plan for a small, focused code improvement.

FOCUS:
- Single file or small multi-file changes
- Quick fixes and targeted improvements
- Minimal but effective implementation
- Essential error handling only

OUTPUT: Fewer sections, focused tasks, concise implementation.
`;
  
  // Add context from previous rounds if available
  let contextBlock = '';
  if (previousRounds && previousRounds.length > 0) {
    const recentRounds = previousRounds.slice(-3); // Last 3 rounds
    
    const weightedContext = recentRounds.map((round, idx) => {
      // Higher weight for more recent rounds
      const weight = contextWeight * Math.pow(1 - contextWeight, idx);
      return `## Round ${round.roundNumber} (weight: ${weight.toFixed(2)})\n${round.spec.goal}\nTasks: ${round.spec.sections.map(s => s.tasks.join(', ')).join('; ')}`;
    }).join('\n\n');
    
    contextBlock = `
============================================
# PREVIOUS ENHANCEMENT ROUNDS
============================================

The following enhancements have already been applied. Use this context to
ensure new enhancements integrate well and build upon previous work:

${weightedContext}

INSTRUCTION: Generate enhancements that COMPLEMENT and EXTEND the previous work.
Do not duplicate. Build upon the accumulated implementation.
`;
  }
  
  return basePrompt + enhancementInstructions + contextBlock;
}

/**
 * Generate a spec for the given request
 */
async function generateSpec(
  request: string,
  mode: SpecEnhancementMode,
  config: MaximalistConfig,
  previousRounds?: EnhancementRound[]
): Promise<Spec> {
  const systemPrompt = buildMaximalistSystemPrompt(mode, previousRounds, config.contextWeight);
  
  const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service');
  
  const response = await enhancedLLMService.generateResponse({
    provider: config.provider,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request }
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    stream: false
  });
  
  const rawSpec = response.content || '';
  const parsedSpec = safeParseSpec(rawSpec);
  
  if (!parsedSpec || !validateSpec(parsedSpec)) {
    logger.warn('Spec generation failed, using fallback', { rawSpec: rawSpec.substring(0, 200) });
    
    // Return a basic spec structure
    return {
      goal: `Enhance: ${request.substring(0, 100)}`,
      sections: [
        {
          title: 'Implementation',
          tasks: ['Implement the requested feature']
        }
      ]
    };
  }
  
  return parsedSpec;
}

/**
 * Build context-weighted prompt for refinement
 * Uses smart-context principles to prioritize recent additions
 * INCLUDES strategic meta-prompt injection for each round
 */
function buildRefinementPrompt(
  chunk: RefinementChunk,
  accumulatedOutput: string,
  contextHistory: MaximalistState['contextHistory'],
  mode: SpecEnhancementMode,
  roundNumber: number,
  totalRounds: number,
  enableMetaPrompts: boolean
): string {
  const isMaximalist = mode === 'maximalist';
  
  // Build weighted context from history
  const recentContexts = contextHistory.slice(-5); // Last 5 entries
  const weightedContext = recentContexts.map(ctx => {
    return `[Round ${ctx.round}] (${ctx.weight.toFixed(2)} weight):\n${ctx.content.substring(0, 500)}...`;
  }).join('\n\n---PRIOR CONTEXT---\n\n');
  
  const tasksList = chunk.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
  
  const focusInstruction = isMaximalist
    ? `
You are performing a MAXIMALIST enhancement - go as deep as possible.
- Implement COMPLETE solutions, not stubs
- Add comprehensive error handling and logging
- Include edge cases and boundary conditions
- Write production-ready code with proper types
- Add tests and documentation
- Make it as comprehensive as possible
`
    : `
You are performing a MINIMALIST enhancement - keep it focused.
- Implement just what's needed
- Basic error handling
- Minimal but functional implementation
`;

  // Get the strategic meta-prompt for this round (if enabled)
  let metaPromptBlock = '';
  if (enableMetaPrompts && isMaximalist) {
    const metaPrompt = getMetaPromptForRound(roundNumber, totalRounds);
    if (metaPrompt) {
      metaPromptBlock = `
${metaPrompt.content}
`;
      logger.debug('Injecting meta-prompt for round', { 
        round: roundNumber, 
        metaPrompt: metaPrompt.title 
      });
    }
  }

  return `${focusInstruction}
${metaPromptBlock}
============================================
# PREVIOUS IMPLEMENTATIONS (Weighted Context)
============================================

${weightedContext}

============================================
# CURRENT FOCUS AREA
============================================

${chunk.title}

TASKS:
${tasksList}

============================================
# CURRENT ACCUMULATED OUTPUT
============================================

${accumulatedOutput.substring(0, 3000)}${accumulatedOutput.length > 3000 ? '\n...[truncated]...' : ''}

============================================
# INSTRUCTIONS
============================================

Enhance the accumulated output with the focus area tasks.
- Build upon existing code, don't replace it
- Add new functionality while preserving what works
- Output the COMPLETE enhanced result
- Make it production-ready

Return the improved output that includes all previous work plus the new enhancements.
`;
}

/**
 * Execute a single refinement round
 */
async function executeRefinementRound(
  roundNumber: number,
  spec: Spec,
  accumulatedOutput: string,
  contextHistory: MaximalistState['contextHistory'],
  config: MaximalistConfig,
  totalRounds: number
): Promise<EnhancementRound> {
  const startTime = Date.now();
  
  // Get meta-prompt info for logging
  const metaPromptInfo = config.enableMetaPrompts && config.mode === 'maximalist'
    ? getMetaPromptContextSummary({ roundNumber, totalRounds, mode: config.mode, previousOutputs: [], originalRequest: '', currentSpecGoal: spec.goal })
    : 'No meta-prompt';
  
  logger.info(`Executing refinement round ${roundNumber}/${totalRounds}`, {
    sections: spec.sections.length,
    mode: config.mode,
    metaPrompt: metaPromptInfo
  });
  
  // Get chunks sorted by priority
  let chunks = chunkSpec(spec);
  chunks = mergeDuplicateTasks(chunks);
  chunks = filterChunksByQuality(chunks, 1);
  
  // Limit chunks based on mode
  const maxChunks = config.mode === 'maximalist' ? 5 : 2;
  chunks = chunks.slice(0, maxChunks);
  
  let roundOutput = accumulatedOutput;
  let chunksProcessed = 0;
  let metaPromptUsed: string | undefined;
  
  // Get meta-prompt for this round (for tracking)
  if (config.enableMetaPrompts && config.mode === 'maximalist') {
    const metaPrompt = getMetaPromptForRound(roundNumber, totalRounds);
    if (metaPrompt) {
      metaPromptUsed = metaPrompt.title;
    }
  }
  
  for (const chunk of chunks) {
    try {
      const prompt = buildRefinementPrompt(
        chunk, 
        roundOutput, 
        contextHistory, 
        config.mode,
        roundNumber,
        totalRounds,
        config.enableMetaPrompts
      );
      
      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service');
      const response = await enhancedLLMService.generateResponse({
        provider: config.provider,
        model: config.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: roundOutput || 'No previous output. Generate fresh implementation.' }
        ],
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        stream: false
      });
      
      const refined = response.content || '';
      if (refined.trim()) {
        roundOutput = refined;
        chunksProcessed++;
      }
      
    } catch (error: any) {
      logger.error(`Chunk refinement failed for "${chunk.title}"`, { error: error.message });
      // Continue with other chunks
    }
  }
  
  const endTime = Date.now();
  
  return {
    roundNumber,
    spec,
    refinedOutput: roundOutput,
    chunksProcessed,
    startTime,
    endTime,
    success: chunksProcessed > 0,
    metaPromptUsed
  };
}

/**
 * Main maximalist spec enhancement function
 */
export async function enhanceWithSpec(
  request: string,
  baseOutput: string,
  config?: Partial<MaximalistConfig>
): Promise<MaximalistState> {
  // Merge config with defaults based on mode
  const mode = config?.mode || determineEnhancementMode(request, config);
  const effectiveConfig = {
    ...getConfigForMode(mode),
    ...config,
    mode
  };
  
  logger.info('Starting SPEC enhancement', { 
    mode, 
    requestLength: request.length,
    maxRounds: effectiveConfig.maxRounds,
    enableMetaPrompts: effectiveConfig.enableMetaPrompts
  });
  
  // Generate initial spec
  const initialSpec = await generateSpec(request, mode, effectiveConfig);
  
  logger.info('Initial spec generated', {
    goal: initialSpec.goal,
    sections: initialSpec.sections.length,
    score: scoreSpec(initialSpec)
  });
  
  // Initialize state
  const state: MaximalistState = {
    originalRequest: request,
    initialSpec,
    rounds: [],
    accumulatedOutput: baseOutput,
    contextHistory: [],
    midPointRegenOccurred: false,
    finalOutput: baseOutput
  };
  
  const totalRounds = effectiveConfig.maxRounds;
  const midPoint = Math.floor(totalRounds / 2) + 1; // e.g., 10 rounds -> midPoint = 6
  
  // Execute enhancement rounds
  for (let round = 1; round <= totalRounds; round++) {
    // At mid-point, regenerate plan with full context
    if (round === midPoint && effectiveConfig.enableMidPointRegen && effectiveConfig.mode === 'maximalist') {
      logger.info('Mid-point plan regeneration', { round, totalRounds });
      
      // Generate new spec based on accumulated work
      const contextSummary = state.rounds.map(r => 
        `Round ${r.roundNumber}: ${r.spec.goal}`
      ).join('; ');
      
      const regenRequest = `${state.originalRequest}\n\nAlready completed: ${contextSummary}\n\nCurrent output preview: ${state.accumulatedOutput.substring(0, 500)}...\n\nContinue enhancing with the same intensity and depth. Build upon what exists.`;
      
      const newSpec = await generateSpec(regenRequest, mode, effectiveConfig, state.rounds);
      state.rounds.push({
        roundNumber: round,
        spec: newSpec,
        refinedOutput: state.accumulatedOutput,
        chunksProcessed: 0,
        startTime: Date.now(),
        endTime: Date.now(),
        success: true,
        note: 'Mid-point plan regeneration'
      } as any);
      state.midPointRegenOccurred = true;
      
      // Continue with new spec for next rounds
      continue;
    }
    
    // Use the most recent spec (initial or regenerated)
    const currentSpec = state.rounds.length > 0 
      ? state.rounds[state.rounds.length - 1].spec 
      : initialSpec;
    
    // Execute refinement round with meta-prompt injection
    const roundResult = await executeRefinementRound(
      round,
      currentSpec,
      state.accumulatedOutput,
      state.contextHistory,
      effectiveConfig,
      totalRounds
    );
    
    state.rounds.push(roundResult);
    state.accumulatedOutput = roundResult.refinedOutput;
    
    // Update context history with weights
    const weight = effectiveConfig.contextWeight * Math.pow(1 - effectiveConfig.contextWeight, round - 1);
    state.contextHistory.push({
      round: round,
      content: roundResult.refinedOutput,
      weight
    });
    
    logger.info(`Round ${round}/${totalRounds} complete`, {
      chunksProcessed: roundResult.chunksProcessed,
      outputLength: state.accumulatedOutput.length,
      metaPromptUsed: roundResult.metaPromptUsed || 'none'
    });
  }
  
  state.finalOutput = state.accumulatedOutput;
  
  logger.info('SPEC enhancement complete', {
    mode,
    totalRounds: state.rounds.length,
    midPointRegen: state.midPointRegenOccurred,
    finalOutputLength: state.finalOutput.length
  });
  
  return state;
}

/**
 * Quick enhancement - single round with minimal overhead
 * Use for quick improvements
 */
export async function quickEnhance(
  request: string,
  baseOutput: string,
  config?: Partial<MaximalistConfig>
): Promise<string> {
  const state = await enhanceWithSpec(request, baseOutput, {
    ...config,
    maxRounds: 1,
    enableMidPointRegen: false,
    enableMetaPrompts: false,
    mode: 'minimalist'
  });
  
  return state.finalOutput;
}

/**
 * Get enhancement statistics
 */
export function getEnhancementStats(state: MaximalistState): {
  mode: string;
  totalRounds: number;
  successfulRounds: number;
  midPointRegen: boolean;
  totalChunksProcessed: number;
  finalOutputLength: number;
  metaPromptsUsed: number;
} {
  return {
    mode: state.rounds[0]?.spec ? 'maximalist' : 'minimalist',
    totalRounds: state.rounds.length,
    successfulRounds: state.rounds.filter(r => r.success).length,
    midPointRegen: state.midPointRegenOccurred,
    totalChunksProcessed: state.rounds.reduce((sum, r) => sum + r.chunksProcessed, 0),
    finalOutputLength: state.finalOutput.length,
    metaPromptsUsed: state.rounds.filter(r => r.metaPromptUsed).length
  };
}

// ============================================================================
// Integration with existing refinement engine
// ============================================================================

/**
 * Convert maximalist state to refinement-engine compatible format
 */
export function toRefinementConfig(
  state: MaximalistState,
  config: MaximalistConfig
): {
  mode: 'enhanced' | 'max';
  baseResponse: string;
  chunks: RefinementChunk[];
} {
  const latestSpec = state.rounds.length > 0 
    ? state.rounds[state.rounds.length - 1].spec 
    : state.initialSpec;
  
  let chunks = chunkSpec(latestSpec);
  chunks = filterChunksByQuality(chunks, 1);
  
  return {
    mode: config.mode === 'maximalist' ? 'max' : 'enhanced',
    baseResponse: state.accumulatedOutput,
    chunks
  };
}