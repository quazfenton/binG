/**
 * Kilo AI Gateway Integration
 *
 * Provides OpenAI-compatible API integration with the Kilo AI Gateway.
 * Supports all major AI models through a unified interface with
 * streaming, tool calling, and structured output capabilities.
 */

import { createLogger } from '../utils/logger';
import { withRetry, handleError } from '../utils/error-handling';
import { maskSecrets } from '../utils/security';

const logger = createLogger('KiloGateway');

export interface KiloGatewayConfig {
  /** Gateway API key */
  apiKey: string;
  /** Gateway base URL */
  baseURL?: string;
  /** Request timeout */
  timeout?: number;
  /** Maximum retries */
  maxRetries?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamingChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionStreamResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: StreamingChoice[];
}

/**
 * Kilo AI Gateway Client
 */
export class KiloGatewayClient {
  private config: Required<KiloGatewayConfig>;

  constructor(config: KiloGatewayConfig) {
    this.config = {
      baseURL: 'https://api.kilo.ai/api/gateway',
      timeout: 60000,
      maxRetries: 3,
      ...config
    };
  }

  /**
   * Create a chat completion
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    return this.makeRequest<ChatCompletionResponse>('/chat/completions', request);
  }

  /**
   * Create a streaming chat completion
   */
  async *createStreamingChatCompletion(
    request: ChatCompletionRequest
  ): AsyncIterable<ChatCompletionStreamResponse> {
    const streamRequest = { ...request, stream: true };

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(streamRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming request');
      }

      yield* this.parseSSEStream(response.body);
    } catch (error) {
      logger.error('Streaming chat completion failed', error);
      throw error;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<{ object: string; data: Array<{ id: string; object: string; created: number; owned_by: string }> }> {
    return this.makeRequest('/models', {}, 'GET');
  }

  /**
   * Check API key validity
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      logger.error('API key validation failed', error);
      return false;
    }
  }

  /**
   * Make authenticated API request with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    data: any = {},
    method: 'POST' | 'GET' = 'POST'
  ): Promise<T> {
    const requestFn = async (): Promise<T> => {
      logger.debug(`Making ${method} request to ${endpoint}`, {
        data: maskSecrets(JSON.stringify(data))
      });

      const response = await fetch(`${this.config.baseURL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: method === 'POST' ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      return response.json();
    };

    return withRetry(requestFn, {
      maxAttempts: this.config.maxRetries,
      delayMs: 1000,
      backoffMultiplier: 2
    })();
  }

  /**
   * Parse Server-Sent Events stream
   */
  private async *parseSSEStream(
    stream: ReadableStream<Uint8Array>
  ): AsyncIterable<ChatCompletionStreamResponse> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last potentially incomplete line
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (error) {
              logger.warn('Failed to parse SSE data', { data, error });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Update client configuration
   */
  updateConfig(newConfig: Partial<KiloGatewayConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): KiloGatewayConfig {
    return { ...this.config };
  }
}

/**
 * Create Kilo Gateway client
 */
export function createKiloGatewayClient(config: KiloGatewayConfig): KiloGatewayClient {
  return new KiloGatewayClient(config);
}

/**
 * Default gateway configuration
 */
export const defaultKiloGatewayConfig: Partial<KiloGatewayConfig> = {
  baseURL: 'https://api.kilo.ai/api/gateway',
  timeout: 60000,
  maxRetries: 3,
};