/**
 * Kilocode SDK Integrations
 *
 * Provides integrations with popular AI SDKs and frameworks:
 * - Vercel AI SDK
 * - OpenAI SDK
 * - LangChain
 * - LlamaIndex
 * - Haystack
 */

import { createLogger } from '../utils/logger';
import { createKiloGatewayClient, type KiloGatewayConfig, type ChatCompletionRequest, type ChatMessage } from './kilo-gateway';

const logger = createLogger('KilocodeSDK');

/**
 * Vercel AI SDK Integration
 */
export class KilocodeVercelSDK {
  private gatewayClient: any;

  constructor(config: KiloGatewayConfig) {
    this.gatewayClient = createKiloGatewayClient(config);
  }

  /**
   * Create an OpenAI-compatible instance for Vercel AI SDK
   */
  createOpenAI() {
    return {
      chat: (modelName: string) => ({
        async doGenerate(options: any) {
          const messages: ChatMessage[] = options.prompt.map((msg: any) => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }));

          const request: ChatCompletionRequest = {
            model: modelName,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            top_p: options.topP,
            frequency_penalty: options.frequencyPenalty,
            presence_penalty: options.presencePenalty,
            stop: options.stopSequences,
            tools: options.tools?.map((tool: any) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
              }
            })),
            tool_choice: options.toolChoice,
          };

          const response = await this.gatewayClient.createChatCompletion(request);
          const choice = response.choices[0];

          return {
            text: choice.message.content,
            toolCalls: choice.message.tool_calls?.map(tc => ({
              toolCallId: tc.id,
              toolName: tc.function.name,
              args: JSON.parse(tc.function.arguments)
            })),
            finishReason: choice.finish_reason,
            usage: response.usage
          };
        },

        async doStream(options: any) {
          const messages: ChatMessage[] = options.prompt.map((msg: any) => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }));

          const request: ChatCompletionRequest = {
            model: modelName,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            top_p: options.topP,
            frequency_penalty: options.frequencyPenalty,
            presence_penalty: options.presencePenalty,
            stop: options.stopSequences,
            stream: true,
            tools: options.tools?.map((tool: any) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
              }
            })),
            tool_choice: options.toolChoice,
          };

          return this.gatewayClient.createStreamingChatCompletion(request);
        }
      })
    };
  }
}

/**
 * OpenAI SDK Integration
 */
export class KilocodeOpenAISDK {
  private gatewayClient: any;

  constructor(config: KiloGatewayConfig) {
    this.gatewayClient = createKiloGatewayClient(config);
  }

  /**
   * Create OpenAI-compatible chat completions
   */
  async createChatCompletion(options: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    stream?: boolean;
    tools?: any[];
    tool_choice?: any;
    response_format?: any;
  }) {
    const request: ChatCompletionRequest = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      stop: options.stop,
      stream: options.stream,
      tools: options.tools,
      tool_choice: options.tool_choice,
      response_format: options.response_format,
    };

    if (options.stream) {
      return this.gatewayClient.createStreamingChatCompletion(request);
    } else {
      return this.gatewayClient.createChatCompletion(request);
    }
  }

  /**
   * List available models
   */
  async listModels() {
    return this.gatewayClient.listModels();
  }
}

/**
 * LangChain Integration
 */
export class KilocodeLangChain {
  private openAISDK: KilocodeOpenAISDK;

  constructor(config: KiloGatewayConfig) {
    this.openAISDK = new KilocodeOpenAISDK(config);
  }

  /**
   * Create ChatOpenAI-compatible instance for LangChain
   */
  createChatOpenAI(modelName: string, options: any = {}) {
    return {
      _modelType: () => 'base_chat_model',
      _llmType: () => 'openai',

      async _generate(messages: any[], options: any) {
        const openaiMessages = messages.map((msg: any) => ({
          role: msg._getType(),
          content: msg.content
        }));

        const response = await this.openAISDK.createChatCompletion({
          model: modelName,
          messages: openaiMessages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          ...options
        });

        return {
          generations: response.choices.map(choice => ({
            text: choice.message.content,
            generationInfo: {
              finish_reason: choice.finish_reason,
              usage: response.usage
            }
          })),
          llmOutput: {
            tokenUsage: response.usage
          }
        };
      },

      async *_streamResponseChunks(messages: any[], options: any) {
        const openaiMessages = messages.map((msg: any) => ({
          role: msg._getType(),
          content: msg.content
        }));

        const stream = await this.openAISDK.createChatCompletion({
          model: modelName,
          messages: openaiMessages,
          stream: true,
          ...options
        });

        for await (const chunk of stream) {
          for (const choice of chunk.choices) {
            if (choice.delta.content) {
              yield {
                chunk: {
                  text: choice.delta.content
                },
                generationInfo: {
                  finish_reason: choice.finish_reason
                }
              };
            }
          }
        }
      }
    };
  }
}

/**
 * Create Vercel AI SDK integration
 */
export function createKilocodeVercelSDK(config: KiloGatewayConfig): KilocodeVercelSDK {
  return new KilocodeVercelSDK(config);
}

/**
 * Create OpenAI SDK integration
 */
export function createKilocodeOpenAISDK(config: KiloGatewayConfig): KilocodeOpenAISDK {
  return new KilocodeOpenAISDK(config);
}

/**
 * Create LangChain integration
 */
export function createKilocodeLangChain(config: KiloGatewayConfig): KilocodeLangChain {
  return new KilocodeLangChain(config);
}

/**
 * Utility function to create OpenAI-compatible client for any framework
 */
export function createKiloOpenAICompatible(config: KiloGatewayConfig) {
  const client = createKiloGatewayClient(config);

  return {
    baseURL: config.baseURL || 'https://api.kilo.ai/api/gateway',
    apiKey: config.apiKey,
    chat: {
      completions: {
        create: (options: ChatCompletionRequest) => {
          if (options.stream) {
            return client.createStreamingChatCompletion(options);
          } else {
            return client.createChatCompletion(options);
          }
        }
      }
    },
    models: {
      list: () => client.listModels()
    }
  };
}