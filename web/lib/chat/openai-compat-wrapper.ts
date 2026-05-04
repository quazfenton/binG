/**
 * OpenAI Compatibility Wrapper for Non-Standard Providers
 *
 * Provides OpenAI-compatible interface for providers that don't natively
 * support the OpenAI chat completions format (e.g., Zo, custom APIs).
 *
 * This wrapper:
 * 1. Converts OpenAI messages → Provider-specific format
 * 2. Calls provider API directly
 * 3. Converts provider response → OpenAI format
 *
 * Usage with Vercel AI SDK:
 * ```typescript
 * import { createZoProvider } from './openai-compat-wrapper';
 * const zo = createZoProvider();
 * const result = streamText({ model: zo('zo-model'), messages });
 * ```
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText as generateTextOriginal } from 'ai';
import { chatLogger } from './chat-logger';

/**
 * Provider compatibility layer
 */
interface CompatProviderConfig {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  customRequestTransform?: (messages: any[], options: any) => Promise<any>;
  customResponseTransform?: (response: any) => Promise<any>;
  models?: string[];
}

/**
 * Zo API specific configuration
 */
const ZO_CONFIG: CompatProviderConfig = {
  name: 'zo',
  baseURL: 'https://api.zo.computer',
  apiKeyEnv: 'ZO_API_KEY',
  
  // Transform OpenAI messages to Zo format
  customRequestTransform: async (messages: any[], options: any) => {
    // Convert OpenAI-style messages → single prompt
    const prompt = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    return {
      input: prompt,
      // Pass through relevant options
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
    };
  },

  // Transform Zo response to OpenAI format
  customResponseTransform: async (response: any) => {
    // Convert Zo response → OpenAI format
    return {
      id: 'zo-compat-' + Date.now(),
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.output || response.content || response.text || '',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      },
    };
  },

  models: ['zo', 'zo-pro', 'zo-mini'],
};

/**
 * Custom providers configuration
 */
const CUSTOM_PROVIDERS: Record<string, CompatProviderConfig> = {
  zo: ZO_CONFIG,
  // Add more custom providers here
  // custom: {
  //   name: 'custom',
  //   baseURL: 'https://api.custom.com',
  //   apiKeyEnv: 'CUSTOM_API_KEY',
  //   customRequestTransform: async (messages, options) => {...},
  //   customResponseTransform: async (response) => {...},
  // },
};

/**
 * Create OpenAI-compatible provider wrapper for custom APIs
 *
 * This creates a provider that:
 * 1. Intercepts requests
 * 2. Transforms to provider-specific format
 * 3. Makes HTTP call
 * 4. Transforms response back to OpenAI format
 */
export function createCompatProvider(providerName: string) {
  const config = CUSTOM_PROVIDERS[providerName];
  
  if (!config) {
    throw new Error(`Unknown custom provider: ${providerName}`);
  }

  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
  const apiKey = currentEnv[config.apiKeyEnv];

  if (!apiKey) {
    chatLogger.warn(`API key not configured for ${providerName}`, {
      envVar: config.apiKeyEnv,
    });
  }

  // Create OpenAI-compatible client with custom baseURL
  const openai = createOpenAI({
    apiKey: apiKey || currentEnv.OPENAI_API_KEY,
    baseURL: config.baseURL || currentEnv.OPENAI_BASE_URL,
  });

  // Return provider function that handles transformation
  return (model: string) => {
    return {
      specificationVersion: 'v1',
      provider: `${providerName}-${model}`,
      modelId: model,
      
      async doGenerate(options: any) {
        const { prompt, maxTokens, temperature, topP, topK, frequencyPenalty, presencePenalty } = options;
        
        try {
          // Transform request if custom transform provided
          let requestBody: any = {
            messages: prompt,
            max_tokens: maxTokens,
            temperature: temperature,
            top_p: topP,
            frequency_penalty: frequencyPenalty,
            presence_penalty: presencePenalty,
          };

          if (config.customRequestTransform) {
            requestBody = await config.customRequestTransform(prompt, {
              temperature,
              maxOutputTokens: maxTokens,
              topP,
              topK,
            });
          }

          // Make API call
          const response = await fetch(`${config.baseURL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${providerName} API error (${response.status}): ${errorText}`);
          }

          let result = await response.json();

          // Transform response if custom transform provided
          if (config.customResponseTransform) {
            result = await config.customResponseTransform(result);
          }

          // Parse OpenAI-format response
          const choice = result.choices?.[0];
          if (!choice) {
            throw new Error(`${providerName} returned invalid response format`);
          }

          return {
            text: choice.message?.content || '',
            usage: {
              promptTokens: result.usage?.prompt_tokens || 0,
              completionTokens: result.usage?.completion_tokens || 0,
              totalTokens: result.usage?.total_tokens || 0,
            },
            finishReason: choice.finish_reason || 'stop',
            rawCall: { rawPrompt: prompt, rawSettings: options },
          };
        } catch (error: any) {
          chatLogger.error(`${providerName} provider failed`, {
            provider: providerName,
            model,
            error: error.message,
          });
          throw error;
        }
      },

      async doStream(options: any) {
        // For providers that don't support streaming, fall back to doGenerate
        chatLogger.info(`${providerName} using non-streaming fallback`, {
          provider: providerName,
          model,
        });

        const result = await this.doGenerate(options);

        // Create a simple stream from the result
        return {
          stream: (async function* () {
            if (result.text) {
              yield {
                type: 'text-delta',
                textDelta: result.text,
              };
            }
            yield {
              type: 'finish',
              finishReason: result.finishReason as any,
              usage: result.usage,
            };
          })(),
          rawCall: { rawPrompt: options.prompt, rawSettings: options },
        };
      },
    };
  };
}

/**
 * Create Zo provider specifically
 */
export function createZoProvider() {
  return createCompatProvider('zo');
}

/**
 * Direct Zo API call (without Vercel AI SDK wrapper)
 *
 * Use this for simple chat completions without the full Vercel AI SDK overhead.
 * Falls back to legacy streaming if Zo API is unavailable.
 */
export async function callZoAPI(
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
  }
) {
  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
  const apiKey = options?.apiKey || currentEnv.ZO_API_KEY;

  if (!apiKey) {
    throw new Error('ZO_API_KEY not configured');
  }

  try {
    // Convert OpenAI-style messages → single prompt
    const prompt = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const response = await fetch('https://api.zo.computer/zo/ask', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zo API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Convert Zo response → OpenAI format
    return {
      id: 'zo-' + Date.now(),
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.output || result.content || result.text || '',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: result.usage?.prompt_tokens || 0,
        completion_tokens: result.usage?.completion_tokens || 0,
        total_tokens: result.usage?.total_tokens || 0,
      },
    };
  } catch (error: any) {
    chatLogger.error('Zo API call failed', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Streaming wrapper for Zo API
 *
 * Simulates streaming by yielding chunks of the response.
 * Falls back to non-streaming if needed.
 */
export async function* streamZoAPI(
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
    chunkSize?: number;
  }
) {
  const chunkSize = options?.chunkSize || 20;
  
  try {
    const result = await callZoAPI(messages, options);
    const content = result.choices[0]?.message?.content || '';

    // Simulate streaming by yielding chunks
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      yield {
        type: 'text-delta',
        textDelta: chunk,
      };
      
      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    yield {
      type: 'finish',
      finishReason: 'stop',
      usage: result.usage,
    };
  } catch (error: any) {
    chatLogger.error('Zo streaming failed, yielding error', {
      error: error.message,
    });
    
    yield {
      type: 'error',
      error: error.message,
    };
  }
}

/**
 * Provider factory for Vercel AI SDK integration
 *
 * Automatically selects the best provider implementation:
 * 1. Try Vercel AI SDK native provider
 * 2. Try OpenAI compatibility wrapper
 * 3. Fall back to direct API call
 */
export function getProviderForModel(providerName: string, model: string) {
  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

  // Check if it's a custom provider requiring wrapper
  if (CUSTOM_PROVIDERS[providerName]) {
    try {
      const compatProvider = createCompatProvider(providerName);
      return compatProvider(model);
    } catch (error: any) {
      chatLogger.warn(`${providerName} compatibility wrapper failed, falling back`, {
        error: error.message,
      });
    }
  }

  // For Zo specifically, provide multiple fallback options
  if (providerName === 'zo') {
    // Option 1: Try compatibility wrapper
    try {
      const zoProvider = createZoProvider();
      return zoProvider(model || 'zo');
    } catch (error: any) {
      chatLogger.warn('Zo wrapper failed, will use direct API', {
        error: error.message,
      });
    }

    // Option 2: Direct API call (returned as function)
    return {
      callAPI: (messages: any[], options?: any) => callZoAPI(messages, options),
      streamAPI: (messages: any[], options?: any) => streamZoAPI(messages, options),
    };
  }

  // Unknown provider
  chatLogger.error('Unknown provider, no configuration found', { provider: providerName, model });
  throw new Error(`Unsupported or unknown provider: ${providerName}`);
}

/**
 * Register custom provider with enhanced-llm-service
 *
 * Call this during application initialization to make custom providers
 * available throughout the system.
 */
export function registerCustomProvider(
  name: string,
  config: CompatProviderConfig
) {
  CUSTOM_PROVIDERS[name] = config;
  chatLogger.info(`Registered custom provider: ${name}`, {
    baseURL: config.baseURL,
    models: config.models?.length || 0,
  });
}
