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

export type ModelTier = 'fast' | 'reasoning' | 'coder' | 'auto';

/**
 * Model configuration map
 */
const modelMap = {
  fast: new ChatOpenAI({ 
    model: process.env.FAST_MODEL || 'gpt-4o-mini', 
    temperature: 0.3,
    maxTokens: 2000,
  }),
  reasoning: new ChatOpenAI({ 
    model: process.env.REASONING_MODEL || 'gpt-4o', 
    temperature: 0.7,
    maxTokens: 4000,
  }),
  coder: new ChatAnthropic({ 
    model: process.env.CODER_MODEL || 'claude-sonnet-4-20250514', 
    temperature: 0.2,
    maxTokens: 4000,
  }),
};

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

  const model = modelMap[tier];
  
  if (!model) {
    throw new Error(`Unknown model tier: ${tier}`);
  }

  try {
    return await model.invoke(messages);
  } catch (error) {
    // Fallback to reasoning model if tier fails
    if (tier !== 'reasoning') {
      console.warn(`Model ${tier} failed, falling back to reasoning model`);
      return await modelMap.reasoning.invoke(messages);
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

  // Short messages → fast model
  if (content.length < 500) {
    return 'fast';
  }

  // Code-related keywords → coder model
  const codeKeywords = [
    'refactor', 'implement', 'code', 'function', 'class',
    'component', 'API', 'endpoint', 'database', 'query',
  ];
  
  if (codeKeywords.some(keyword => content.toLowerCase().includes(keyword))) {
    return 'coder';
  }

  // Complex reasoning → reasoning model
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
      model: process.env.FAST_MODEL || 'gpt-4o-mini',
      cost: '$0.15/1M tokens',
      speed: 'Fast',
      bestFor: 'Simple tasks, classification, extraction',
    },
    reasoning: {
      model: process.env.REASONING_MODEL || 'gpt-4o',
      cost: '$2.50/1M tokens',
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
