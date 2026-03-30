/**
 * Vercel AI SDK Streaming Integration
 *
 * Provides unified streaming interface across all providers using Vercel AI SDK.
 * Benefits:
 * - Single interface for all providers (OpenAI, Anthropic, Google, Mistral, etc.)
 * - Automatic tool calling support with streaming tool calls
 * - Built-in reasoning stream support (Anthropic extended thinking, etc.)
 * - Better type safety with Zod validation
 * - Automatic retries and fallbacks
 * - Smooth streaming for natural token flow
 * - Edge runtime compatibility
 *
 * @see https://sdk.vercel.ai/docs
 */

import {
  streamText,
  extractReasoningMiddleware,
  smoothStream,
  type Tool,
  type LanguageModelUsage,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import type { StreamingResponse, LLMMessage } from './llm-providers';
import { chatLogger } from './chat-logger';
import { getProviderForModel } from './openai-compat-wrapper';
import { tokenTracker } from './ai-caching';
import { createReasoningMiddleware, withRetry, createSmoothStream, isTokenLimitError, handleTokenLimitError } from './ai-middleware';

/**
 * Tool execution context for Vercel AI SDK tools
 */
export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
  requestId?: string;
  [key: string]: any;
}

/**
 * Provider types supported by Vercel AI SDK
 */
export type VercelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'openrouter';

/**
 * Options for Vercel AI SDK streaming
 */
export interface VercelStreamOptions {
  provider: VercelProvider | string;
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseURL?: string;
  signal?: AbortSignal;
  tools?: Record<string, Tool>;
  toolCallStreaming?: boolean;
  smoothStreaming?: boolean;
  maxRetries?: number;
  maxSteps?: number;
  /** Provider-specific settings (e.g., Anthropic cache control) */
  providerOptions?: Record<string, any>;
}

/**
 * Provider configuration for OpenAI-compatible providers
 */
interface OpenAICompatibleConfig {
  baseURL: string;
  apiKeyEnv: string;
}

/**
 * Configuration for all OpenAI-compatible providers
 */
const OPENAI_COMPATIBLE_PROVIDERS: Record<string, OpenAICompatibleConfig> = {
  chutes: {
    baseURL: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1',
    apiKeyEnv: 'CHUTES_API_KEY',
  },
  github: {
    baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
    apiKeyEnv: 'GITHUB_MODELS_API_KEY',
  },
  zen: {
    baseURL: process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
    apiKeyEnv: 'ZEN_API_KEY',
  },
  nvidia: {
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  together: {
    baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
  groq: {
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  fireworks: {
    baseURL: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
  },
  anyscale: {
    baseURL: process.env.ANYSCALE_BASE_URL || 'https://api.endpoints.anyscale.com/v1',
    apiKeyEnv: 'ANYSCALE_API_KEY',
  },
  deepinfra: {
    baseURL: process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
  },
  lepton: {
    baseURL: process.env.LEPTON_BASE_URL || 'https://models.lepton.ai/v1',
    apiKeyEnv: 'LEPTON_API_KEY',
  },
  openrouter: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
};

/**
 * Get Vercel AI SDK model from provider config
 *
 * Supports:
 * 1. Direct Vercel AI SDK providers (OpenAI, Anthropic, Google, Mistral)
 * 2. OpenAI-compatible providers (NVIDIA, GitHub, Groq, etc.)
 * 3. Custom providers via compatibility wrapper (Zo, etc.)
 */
function getVercelModel(
  provider: VercelProvider | string,
  model: string,
  apiKey?: string,
  baseURL?: string
) {
  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

  // Check for custom providers requiring compatibility wrapper first
  if (provider === 'zo') {
    try {
      chatLogger.info('Using Zo compatibility wrapper', { provider, model });
      const zoProvider = getProviderForModel('zo', model || 'zo');
      return zoProvider;
    } catch (error: any) {
      chatLogger.warn('Zo wrapper failed, will use fallback', {
        error: error.message,
      });
      // Fall through to OpenAI fallback
    }
  }

  // Handle OpenAI-compatible providers
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google' && provider !== 'mistral') {
    const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
    if (config) {
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv[config.apiKeyEnv],
        baseURL: baseURL || config.baseURL,
      });
      return openai(model);
    }
    // Unknown provider, try OpenAI as fallback
    const openai = createOpenAI({
      apiKey: apiKey || currentEnv.OPENAI_API_KEY,
      baseURL: baseURL || currentEnv.OPENAI_BASE_URL,
    });
    return openai(model);
  }

  // Direct Vercel AI SDK providers
  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv.OPENAI_API_KEY,
        baseURL: baseURL || currentEnv.OPENAI_BASE_URL,
      });
      return openai(model);
    }

    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey || currentEnv.ANTHROPIC_API_KEY,
        baseURL: baseURL || currentEnv.ANTHROPIC_BASE_URL,
      });
      return anthropic(model);
    }

    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || currentEnv.GOOGLE_API_KEY,
      });
      return google(model);
    }

    case 'mistral': {
      const mistral = createMistral({
        apiKey: apiKey || currentEnv.MISTRAL_API_KEY,
        baseURL: baseURL || currentEnv.MISTRAL_BASE_URL,
      });
      return mistral(model);
    }

    default:
      throw new Error(`Unsupported provider for Vercel AI SDK: ${provider}`);
  }
}

/**
 * Convert LLMMessage to Vercel AI SDK format.
 * Extracts system messages into a separate string for the `system` parameter,
 * which is more reliable across providers than system-role messages in the array.
 */
function convertMessages(messages: LLMMessage[]): {
  chatMessages: any[];
  systemPrompt?: string;
} {
  const systemParts: string[] = [];
  const chatMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
      systemParts.push(text);
      continue;
    }

    if (typeof msg.content === 'string') {
      chatMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : msg.role === 'tool' ? 'tool' : 'user',
        content: msg.content,
      });
      continue;
    }

    // Handle multi-modal content — convert images to text placeholders for now
    const textContent = msg.content
      .map(c => {
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image_url') return '[Image]';
        return '';
      })
      .join(' ');

    chatMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: textContent,
    });
  }

  return {
    chatMessages,
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  };
}

/**
 * Detect reasoning tag for providers that support extended thinking
 */
function getReasoningTag(provider: string): { tagName: string; separator?: string; startWithReasoning?: boolean; } | undefined {
  switch (provider) {
    case 'anthropic':
      return { tagName: 'thinking', separator: '</thinking>' };
    case 'google':
      return { tagName: 'thought', separator: '</thought>' };
    case 'deepseek':
      return { tagName: 'reasoning', separator: '', startWithReasoning: true };
    default:
      return undefined;
  }
}

/**
 * Stream using Vercel AI SDK
 *
 * Unified streaming interface supporting all providers with:
 * - System prompt extraction
 * - Abort signal support
 * - Smooth streaming for natural token flow
 * - Reasoning extraction for supported providers
 * - Streaming tool calls
 * - Multi-step tool execution
 * - Automatic retries
 */
export async function* streamWithVercelAI(
  optionsOrProvider: VercelStreamOptions | VercelProvider | string,
  model?: string,
  messages?: LLMMessage[],
  temperature?: number,
  maxTokens?: number,
  apiKey?: string,
  baseURL?: string
): AsyncGenerator<StreamingResponse> {
  // Support both new options-object API and legacy positional API
  let opts: VercelStreamOptions;
  if (typeof optionsOrProvider === 'object') {
    opts = optionsOrProvider;
  } else {
    opts = {
      provider: optionsOrProvider,
      model: model!,
      messages: messages!,
      temperature,
      maxTokens,
      apiKey,
      baseURL,
    };
  }

  const {
    provider,
    model: modelName,
    messages: msgs,
    temperature: temp = 0.7,
    maxTokens: maxT = 4096,
    apiKey: key,
    baseURL: url,
    signal,
    tools,
    toolCallStreaming = true,
    smoothStreaming = true,
    maxRetries = 0,
    maxSteps = 5,
    providerOptions,
  } = opts;

  const startTime = Date.now();
  const requestId = `vercel-ai-${Date.now()}`;

  try {
    const vercelModel = getVercelModel(provider, modelName, key, url);
    const { chatMessages, systemPrompt } = convertMessages(msgs);

    chatLogger.debug('Vercel AI SDK streaming started', { requestId, provider, model: modelName });

    // Custom provider handling (Zo, etc.)
    const isCustomProvider = provider === 'zo';

    if (isCustomProvider) {
      chatLogger.info('Using custom provider direct API', { provider, model: modelName });

      const { streamZoAPI } = await import('./openai-compat-wrapper');

      try {
        for await (const chunk of streamZoAPI(chatMessages as any, {
          temperature: temp,
          maxTokens: maxT,
          apiKey: key,
        })) {
          if (signal?.aborted) return;

          if (chunk.type === 'text-delta') {
            yield {
              content: chunk.textDelta,
              isComplete: false,
              timestamp: new Date(),
            };
          } else if (chunk.type === 'finish') {
            yield {
              content: '',
              isComplete: true,
              finishReason: chunk.finishReason,
              tokensUsed: chunk.usage?.total_tokens || 0,
              usage: {
                promptTokens: chunk.usage?.prompt_tokens || 0,
                completionTokens: chunk.usage?.completion_tokens || 0,
                totalTokens: chunk.usage?.total_tokens || 0,
              },
              timestamp: new Date(),
              metadata: {
                vercelAI: true,
                provider,
                model: modelName,
                latencyMs: Date.now() - startTime,
              },
            };
          } else if (chunk.type === 'error') {
            throw new Error(chunk.error);
          }
        }
        return;
      } catch (error: any) {
        if (error.name === 'AbortError') return;
        chatLogger.error('Custom provider streaming failed', { provider, model: modelName, error: error.message });
        throw error;
      }
    }

    // Build middleware stack
    const transforms: any[] = [];

    // Smooth streaming for natural token flow
    if (smoothStreaming && typeof smoothStream === 'function') {
      try {
        transforms.push(smoothStream({ delayInMs: 15 }));
      } catch (smoothError) {
        chatLogger.warn('smoothStream middleware failed, skipping', { error: smoothError });
      }
    }

    // Reasoning extraction for providers that support extended thinking
    const reasoningTag = getReasoningTag(provider);
    if (reasoningTag && typeof extractReasoningMiddleware === 'function') {
      try {
        transforms.push(extractReasoningMiddleware(reasoningTag));
      } catch (reasoningError) {
        chatLogger.warn('extractReasoningMiddleware failed, skipping', { error: reasoningError });
      }
    }

    // Build streamText options - only include experimental_transform if transforms exist
    const streamOptions: any = {
      model: vercelModel as any,
      messages: chatMessages,
      temperature: temp,
      maxOutputTokens: maxT,
      maxRetries,
      maxSteps,
      abortSignal: signal,
      toolCallStreaming,
      ...(transforms.length > 0 ? { experimental_transform: transforms } : {}),
      experimental_telemetry: {
        isEnabled: false,
        functionId: 'llm-stream',
        metadata: { provider, model: modelName },
      },
    };

    // Add system prompt if present
    if (systemPrompt) {
      streamOptions.system = systemPrompt;
    }

    // Add tools if provided
    if (tools && Object.keys(tools).length > 0) {
      streamOptions.tools = tools;
    }

    // Provider-specific options (e.g., Anthropic cache control)
    if (providerOptions) {
      streamOptions.providerOptions = providerOptions;
    }

    const result = streamText(streamOptions);

    // Stream events including text, reasoning, and tool calls
    let reasoningContent = '';

    for await (const chunk of result.fullStream) {
      if (signal?.aborted) return;

      switch (chunk.type as string) {
        case 'text-delta': {
          yield {
            content: (chunk as any).text,
            isComplete: false,
            timestamp: new Date(),
          };
          break;
        }

        case 'reasoning-start': {
          // reasoning-start contains reasoning content in text property for some providers
          const reasoningText = (chunk as any).text ?? '';
          reasoningContent += reasoningText;
          yield {
            content: '',
            isComplete: false,
            reasoning: reasoningText,
            timestamp: new Date(),
          };
          break;
        }

        case 'tool-call': {
          yield {
            content: '',
            isComplete: false,
            toolCalls: [{
              id: (chunk as any).toolCallId,
              name: (chunk as any).toolName,
              arguments: (chunk as any).args || (chunk as any).arguments || {},
            }],
            timestamp: new Date(),
          };
          break;
        }

        case 'tool-result': {
          yield {
            content: '',
            isComplete: false,
            toolInvocations: [{
              toolCallId: (chunk as any).toolCallId,
              toolName: (chunk as any).toolName,
              state: 'result' as const,
              args: (chunk as any).args || {},
              result: (chunk as any).result,
            }],
            timestamp: new Date(),
          };
          break;
        }

        case 'error': {
          chatLogger.error('Stream error chunk', {
            requestId,
            provider,
            model: modelName,
            error: (chunk as any).error?.message || String((chunk as any).error),
          });
          throw (chunk as any).error;
        }

        case 'step-start':
        case 'step-finish':
        case 'start':
        case 'finish':
          // Skip these event types - handled elsewhere
          break;
      }
    }

    // Get final usage and metadata
    const usage = await result.usage;
    const finishReason = (await result.finishReason) || 'stop';
    const toolCalls = await result.toolCalls;
    const steps = await result.steps;

    // Collect all tool calls from steps (multi-step support)
    const allToolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];
    if (steps) {
      for (const step of steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            allToolCalls.push({
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: (tc as any).args || (tc as any).arguments || {},
            });
          }
        }
      }
    }
    // Fallback to top-level tool calls
    if (allToolCalls.length === 0 && toolCalls) {
      for (const tc of toolCalls) {
        allToolCalls.push({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: (tc as any).args || (tc as any).arguments || {},
        });
      }
    }

    // Final chunk with completion status and metadata
    yield {
      content: '',
      isComplete: true,
      finishReason,
      tokensUsed: usage?.totalTokens || 0,
      usage: {
        promptTokens: (usage as any).inputTokens || (usage as any).promptTokens || (usage as any).prompt_tokens || 0,
        completionTokens: (usage as any).outputTokens || (usage as any).completionTokens || (usage as any).completion_tokens || 0,
        totalTokens: usage?.totalTokens || 0,
      },
      reasoning: reasoningContent || undefined,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      timestamp: new Date(),
      metadata: {
        vercelAI: true,
        provider,
        model: modelName,
        latencyMs: Date.now() - startTime,
        steps: steps?.length || 0,
      },
    };

    chatLogger.info('Vercel AI SDK streaming completed', { requestId, provider, model: modelName }, {
      latencyMs: Date.now() - startTime,
      tokensUsed: usage?.totalTokens || 0,
      toolCallsCount: allToolCalls.length,
      steps: steps?.length || 0,
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      chatLogger.info('Vercel AI SDK streaming aborted', { requestId, provider, model: modelName });
      return;
    }

    chatLogger.error('Vercel AI SDK streaming failed', { requestId, provider, model: modelName }, {
      error: error.message,
      statusCode: error.statusCode,
      latencyMs: Date.now() - startTime,
    });

    error.metadata = {
      ...error.metadata,
      vercelAI: true,
      provider,
      model: modelName,
      requestId,
      latencyMs: Date.now() - startTime,
    };
    throw error;
  }
}

/**
 * Stream with tools using Vercel AI SDK
 *
 * Convenience wrapper around streamWithVercelAI for tool-enabled streams.
 */
export async function* streamWithTools(
  provider: VercelProvider | string,
  model: string,
  messages: LLMMessage[],
  tools: Record<string, Tool>,
  temperature: number = 0.7,
  maxTokens: number = 4096,
  apiKey?: string,
  baseURL?: string,
  signal?: AbortSignal,
  maxSteps: number = 5,
): AsyncGenerator<StreamingResponse> {
  yield* streamWithVercelAI({
    provider,
    model,
    messages,
    temperature,
    maxTokens,
    apiKey,
    baseURL,
    signal,
    tools,
    toolCallStreaming: true,
    maxSteps,
  });
}
