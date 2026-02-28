/**
 * CrewAI Model Router
 * 
 * Advanced tiered routing for different agent roles.
 * Supports multiple LLM providers with fallback.
 */

import { z } from 'zod';

export type ModelTier = 'fast' | 'reasoning' | 'coder' | 'multimodal';

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'litellm';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelRouterConfig {
  fast?: ModelConfig;
  reasoning?: ModelConfig;
  coder?: ModelConfig;
  multimodal?: ModelConfig;
  defaultProvider?: ModelConfig;
}

const defaultModels: Record<ModelTier, ModelConfig> = {
  fast: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
  reasoning: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 },
  coder: { provider: 'openai', model: 'gpt-4o', temperature: 0.1 },
  multimodal: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 },
};

export class ModelRouter {
  private config: ModelRouterConfig;
  private clientCache: Map<string, any> = new Map();

  constructor(config: ModelRouterConfig = {}) {
    this.config = {
      fast: config.fast || defaultModels.fast,
      reasoning: config.reasoning || defaultModels.reasoning,
      coder: config.coder || defaultModels.coder,
      multimodal: config.multimodal || defaultModels.multimodal,
      defaultProvider: config.defaultProvider,
    };
  }

  private getClient(provider: string, apiKey?: string, baseUrl?: string): any {
    const key = `${provider}:${apiKey?.slice(0, 8)}:${baseUrl}`;
    
    if (this.clientCache.has(key)) {
      return this.clientCache.get(key);
    }

    let client: any;
    
    switch (provider) {
      case 'openai':
        const { OpenAI } = require('openai');
        client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY, baseURL: baseUrl });
        break;
      case 'anthropic':
        const { Anthropic } = require('@anthropic-ai/sdk');
        client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY, baseURL: baseUrl });
        break;
      case 'google':
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        client = new GoogleGenerativeAI(apiKey || process.env.GOOGLE_API_KEY);
        break;
      case 'ollama':
        client = { baseUrl: baseUrl || 'http://localhost:11434' };
        break;
      case 'litellm':
        client = { baseUrl: baseUrl || 'https://litellm.ai' };
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    this.clientCache.set(key, client);
    return client;
  }

  async call(
    tier: ModelTier,
    messages: Array<{ role: string; content: string | any }>,
    options: {
      temperature?: number;
      maxTokens?: number;
      tools?: any[];
      toolChoice?: string;
    } = {}
  ): Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: any }>;
    usage?: { prompt: number; completion: number; total: number };
  }> {
    const modelConfig = this.config[tier] || this.config.defaultProvider || defaultModels[tier];
    const client = this.getClient(
      modelConfig.provider,
      modelConfig.apiKey,
      modelConfig.baseUrl
    );

    const requestOptions = {
      model: modelConfig.model,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      temperature: options.temperature ?? modelConfig.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? modelConfig.maxTokens,
    };

    try {
      switch (modelConfig.provider) {
        case 'openai':
        case 'litellm': {
          const response = await client.chat.completions.create({
            ...requestOptions,
            ...(options.tools?.length ? { tools: options.tools, tool_choice: options.toolChoice ? { type: 'function', function: { name: options.toolChoice } } : undefined } : {}),
          });
          const choice = response.choices[0];
          return {
            content: choice.message.content || '',
            toolCalls: choice.message.tool_calls?.map((tc: any) => ({
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            })),
            usage: response.usage ? {
              prompt: response.usage.prompt_tokens,
              completion: response.usage.completion_tokens,
              total: response.usage.total_tokens,
            } : undefined,
          };
        }
        case 'anthropic': {
          const response = await client.messages.create({
            ...requestOptions,
            system: messages.find(m => m.role === 'system')?.content || undefined,
            max_tokens: requestOptions.max_tokens || 4096,
          });
          const content = response.content[0];
          return {
            content: content.type === 'text' ? content.text : '',
            usage: response.usage ? {
              prompt: response.usage.input_tokens,
              completion: response.usage.output_tokens,
              total: response.usage.input_tokens + response.usage.output_tokens,
            } : undefined,
          };
        }
        case 'google': {
          const model = client.getGenerativeModel({ model: modelConfig.model });
          const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
          }));
          const result = await model.generateContent({ contents });
          return {
            content: result.response.text(),
          };
        }
        default:
          throw new Error(`Provider ${modelConfig.provider} not supported for direct calls`);
      }
    } catch (error) {
      console.error(`Model router error (${tier}):`, error);
      throw error;
    }
  }

  selectTier(input: string): ModelTier {
    const lower = input.toLowerCase();
    
    if (lower.includes('refactor') || 
        lower.includes('implement') || 
        lower.includes('write code') ||
        lower.includes('debug') ||
        lower.includes('fix') ||
        lower.includes('create function')) {
      return 'coder';
    }
    
    if (lower.includes('analyze') || 
        lower.includes('evaluate') || 
        lower.includes('review') ||
        lower.includes('assess') ||
        lower.includes('plan')) {
      return 'reasoning';
    }
    
    if (lower.includes('image') || 
        lower.includes('vision') ||
        lower.includes('video') ||
        lower.includes('audio')) {
      return 'multimodal';
    }
    
    if (input.length < 500) {
      return 'fast';
    }
    
    return 'reasoning';
  }

  getConfig(): ModelRouterConfig {
    return { ...this.config };
  }

  setConfig(tier: ModelTier, config: ModelConfig): void {
    this.config[tier] = config;
  }
}

export const modelRouter = new ModelRouter();

export function createModelRouter(config: ModelRouterConfig): ModelRouter {
  return new ModelRouter(config);
}
