/**
 * Model Router Layer
 *
 * Routes LLM requests to optimal model based on task complexity.
 * Provides cost optimization and model specialization.
 *
 * @example
 * ```typescript
 * // Automatic routing
 * const result = await routeLLM('auto', messages);
 *
 * // Manual tier selection
 * const fast = await routeLLM('fast', messages); // gpt-4o-mini
 * const reasoning = await routeLLM('reasoning', messages); // gpt-4o
 * const coder = await routeLLM('coder', messages); // claude-sonnet
 * ```
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { withRetry, isRetryableError } from '@/lib/vector-memory/retry';

export type ModelTier = 'fast' | 'reasoning' | 'coder' | 'auto';

// Lazy-load optional @langchain/mistralai (may not be installed)
async function getMistralAI(): Promise<any> {
  try {
    return (await import('@langchain/mistralai')).ChatMistralAI;
  } catch {
    return null;
  }
}

/**
 * Model configuration map — lazy-initialized to support async mistral import.
 * Priority: explicit env var -> sensible default (mistral/google over openai)
 */
type ModelMap = { fast: any; reasoning: any; coder: any };
let _modelMap: ModelMap | null = null;
let modelMapPromise: Promise<ModelMap> | null = null;

function getModelMap(): Promise<ModelMap> {
  if (_modelMap) return Promise.resolve(_modelMap);
  if (!modelMapPromise) {
    modelMapPromise = (async () => {
      const ChatMistralAI = await getMistralAI();
      const map = {
        fast: ChatMistralAI
          ? new ChatMistralAI({
              model: process.env.FAST_MODEL || 'mistral-small-latest',
              temperature: 0.3,
              maxTokens: 2000,
            })
          : null,
        reasoning: new ChatGoogleGenerativeAI({
          model: process.env.REASONING_MODEL || 'gemini-2.5-flash',
          temperature: 0.7,
          maxTokens: 4000,
        }),
        coder: new ChatAnthropic({
          model: process.env.CODER_MODEL || 'claude-sonnet-4-20250514',
          temperature: 0.2,
          maxTokens: 4000,
        }),
      } as any;
      _modelMap = map;
      return map;
    })();
  }
  return modelMapPromise;
}

/**
 * Route LLM request to appropriate model
 *
 * @param tier - Model tier or 'auto' for automatic routing
 * @param messages - Messages to send to LLM
 * @returns LLM response
 */
export async function routeLLM(
  tier: ModelTier,
  messages: any[]
): Promise<any> {
  // Auto-routing based on task complexity
  if (tier === 'auto') {
    tier = chooseTier(messages);
  }

  const models = await getModelMap();
  const model = models[tier];

  if (!model) {
    throw new Error(`Unknown model tier: ${tier}`);
  }

  try {
    return await withRetry(
      () => model.invoke(messages),
      {
        maxRetries: 2,
        baseDelay: 1000,
        context: `routeLLM:${tier}`,
        shouldRetry: (error) => isRetryableError(error),
      }
    );
  } catch (error) {
    // Fallback to reasoning model if tier fails
    if (tier !== 'reasoning') {
      console.warn(`Model ${tier} failed, falling back to reasoning model`);
      return await withRetry(
        () => modelMap.reasoning.invoke(messages),
        {
          maxRetries: 1,
          baseDelay: 1000,
          context: 'routeLLM:fallback',
          shouldRetry: (error) => isRetryableError(error),
        }
      );
    }
    throw error;
  }
}

/**
 * Choose model tier based on task complexity
 *
 * @param messages - Input messages
 * @returns Recommended model tier
 */
export function chooseTier(messages: any[]): ModelTier {
  const lastMessage = messages[messages.length - 1];
  const content = typeof lastMessage.content === 'string'
    ? lastMessage.content
    : lastMessage.content[0]?.text || '';

  // Short messages -> fast model
  if (content.length < 500) {
    return 'fast';
  }

  // Code-related keywords -> coder model
  const codeKeywords = [
    'refactor', 'implement', 'code', 'function', 'class',
    'component', 'API', 'endpoint', 'database', 'query',
  ];

  if (codeKeywords.some(keyword => content.toLowerCase().includes(keyword))) {
    return 'coder';
  }

  // Complex reasoning -> reasoning model
  const reasoningKeywords = [
    'analyze', 'explain', 'why', 'how', 'compare', 'evaluate',
    'strategy', 'architecture', 'design', 'optimize',
  ];

  if (reasoningKeywords.some(keyword => content.toLowerCase().includes(keyword))) {
    return 'reasoning';
  }

  // Default to reasoning for safety
  return 'reasoning';
}

/**
 * Get model info for a tier
 */
export function getModelInfo(tier: ModelTier) {
  const info = {
    fast: {
      model: process.env.FAST_MODEL || 'mistral-small-latest',
      cost: '~$0.20/1M tokens',
      speed: 'Fast',
      bestFor: 'Simple tasks, classification, extraction',
    },
    reasoning: {
      model: process.env.REASONING_MODEL || 'gemini-2.5-flash',
      cost: '~$0.30/1M tokens',
      speed: 'Medium',
      bestFor: 'Complex reasoning, analysis, planning',
    },
    coder: {
      model: process.env.CODER_MODEL || 'claude-sonnet-4-20250514',
      cost: '$3.00/1M tokens',
      speed: 'Medium',
      bestFor: 'Code generation, refactoring, debugging',
    },
  };

  return info[tier];
}

/**
 * Calculate estimated cost for a request
 */
export function estimateCost(tier: ModelTier, inputTokens: number, outputTokens: number) {
  const costs = {
    fast: { input: 0.00000015, output: 0.0000006 },
    reasoning: { input: 0.0000025, output: 0.00001 },
    coder: { input: 0.000003, output: 0.000015 },
  };

  const cost = costs[tier];
  return (inputTokens * cost.input) + (outputTokens * cost.output);
}
