/**
 * Mastra Model Router
 *
 * Provides model selection across 40+ providers through unified interface.
 * Reuses existing provider configuration with cost/latency optimization.
 *
 * @see https://mastra.ai/docs/agents/overview
 * @see https://mastra.ai/docs/memory/overview
 */

import { Agent } from '@mastra/core/agent';
import { getMemory, withMemory } from '../memory';
import { getProviderForTask, getModelForTask } from '@/lib/config/task-providers';

/**
 * Model tier types for routing
 */
export type ModelTier = 'fast' | 'reasoning' | 'coder' | 'costEffective';

/**
 * Pre-configured model routers for different use cases
 *
 * FIXED: Added name property to all agents (required by Mastra SDK)
 * NEW: Added memory integration for conversation history
 */
// Get user's configured model for agent tasks
const defaultModel = getModelForTask('agent', 'gpt-4o');

/**
 * Model configuration based on user's provider settings
 * Uses environment-configured models for each tier
 */
function getModelConfig(tier: string): string {
  const modelMap: Record<string, string> = {
    fast: getModelForTask('fast', 'gpt-4o-mini'),
    reasoning: getModelForTask('reasoning', 'gpt-4o'),
    coder: getModelForTask('coder', 'claude-sonnet-4-20250514'),
    costEffective: getModelForTask('cost-effective', 'gemini-2.0-flash'),
  };
  
  return modelMap[tier] || defaultModel;
}

export const modelRouter = {
  /**
   * Fast model for simple tasks
   * Cost: ~$0.15/1M tokens
   * Use: Classification, extraction, simple Q&A
   */
  fast: withMemory(
    new Agent({
      id: 'fast-router',
      name: 'Fast Model Router',
      model: getModelConfig('fast'),
      instructions: [
        'You are a fast, efficient assistant.',
        'Provide concise, direct answers.',
        'Focus on speed and accuracy.',
      ],
    }),
    getMemory()
  ),

  /**
   * Reasoning model for complex tasks
   * Cost: ~$2.50/1M tokens
   * Use: Analysis, planning, complex reasoning
   */
  reasoning: withMemory(
    new Agent({
      id: 'reasoning-router',
      name: 'Reasoning Model Router',
      model: getModelConfig('reasoning'),
      instructions: [
        'You are a thoughtful reasoning assistant.',
        'Think step-by-step before answering.',
        'Consider multiple perspectives.',
        'Provide detailed explanations.',
      ],
    }),
    getMemory()
  ),

  /**
   * Coder model for development tasks
   * Cost: ~$3.00/1M tokens
   * Use: Code generation, refactoring, debugging
   */
  coder: withMemory(
    new Agent({
      id: 'coder-router',
      name: 'Coder Model Router',
      model: getModelConfig('coder'),
      instructions: [
        'You are an expert coding assistant.',
        'Write clean, maintainable code.',
        'Follow best practices and design patterns.',
        'Include error handling and edge cases.',
      ],
    }),
    getMemory()
  ),

  /**
   * Cost-effective model for budget-conscious tasks
   * Cost: ~$0.075/1M tokens
   * Use: Draft generation, brainstorming, iterations
   */
  costEffective: withMemory(
    new Agent({
      id: 'cost-effective-router',
      name: 'Cost-Effective Model Router',
      model: getModelConfig('costEffective'),
      instructions: [
        'You are a helpful, cost-effective assistant.',
        'Provide useful answers while being efficient.',
      ],
    }),
    getMemory()
  ),
};

/**
 * Get model by tier
 *
 * @param tier - Model tier
 * @returns Configured agent for the tier
 *
 * FIXED: Added proper error handling and validation
 *
 * @example
 * const agent = getModel('reasoning');
 * const response = await agent.generate(messages);
 */
export function getModel(tier: ModelTier) {
  const agent = modelRouter[tier];
  if (!agent) {
    const validTiers = Object.keys(modelRouter).join(', ');
    throw new Error(`Invalid model tier: ${tier}. Valid tiers: ${validTiers}`);
  }
  return agent;
}

/**
 * Get model for specific use case
 *
 * @param useCase - Use case description
 * @returns Recommended model tier
 */
export function recommendModel(useCase: string): ModelTier {
  const useCaseLower = useCase.toLowerCase();

  if (useCaseLower.includes('code') || useCaseLower.includes('program')) {
    return 'coder';
  }

  if (useCaseLower.includes('analyze') || useCaseLower.includes('plan')) {
    return 'reasoning';
  }

  if (useCaseLower.includes('simple') || useCaseLower.includes('quick')) {
    return 'fast';
  }

  return 'costEffective';
}

/**
 * Dynamic model selector based on request context
 *
 * @example
 * const agent = new Agent({
 *   id: 'dynamic-agent',
 *   model: ({ requestContext }) => {
 *     const tier = requestContext.get('tier') as ModelTier;
 *     return getModel(tier).model;
 *   },
 * });
 */
export type RequestContext = {
  get(key: string): any;
};

export type ModelSelector = (context: RequestContext) => string;
