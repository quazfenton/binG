/**
 * LLM Integration Layer for Enhanced Code System
 * 
 * Provides a unified interface to the main application's LLM services
 * including both streaming and non-streaming responses.
 */

import { EnhancedResponse, ProjectItem } from './enhanced-prompt-engine';
import { ERROR_CODES, createPromptEngineError, createStreamError } from './error-types';

// Import types from the main application
// These would need to be properly imported based on the actual application structure
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMRequest {
  messages: LLMMessage[];
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  apiKeys?: Record<string, string>;
  requestId?: string;
}

interface LLMResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
  timestamp: Date;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface StreamingChunk {
  content: string;
  isComplete: boolean;
  finishReason?: string;
  usage?: any;
}

interface StreamingSession {
  sessionId: string;
  isActive: boolean;
  chunksReceived: number;
  totalTokens: number;
  startTime: Date;
}

interface LLMStreamingResponse {
  [Symbol.asyncIterator](): AsyncIterator<StreamingChunk>;
}

interface LLMConfig {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export class LLMIntegration {
  private config: LLMConfig;
  private activeStreams: Map<string, StreamingSession> = new Map();
  private llmService: any; // This will be set during initialization

  constructor(config?: LLMConfig) {
    this.config = {
      defaultProvider: 'openrouter',
      defaultModel: 'deepseek/deepseek-r1-0528:free',
      defaultTemperature: 0.7,
      defaultMaxTokens: 80000,
      timeoutMs: 120000, // 2 minutes
      maxRetries: 3,
      ...config
    };
  }

  /**
   * Initialize the LLM integration by connecting to the main application's llm service
   */
  async initialize(): Promise<void> {
    try {
      // Dynamically import the main application's LLM service
      // This assumes the llm-providers module exists in the main application
      const mainModule = await import('../../lib/api/llm-providers');
      this.llmService = mainModule.llmService || mainModule.default;
      
      if (!this.llmService) {
        throw createPromptEngineError('LLM service not available', {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'critical',
          recoverable: false
        });
      }
      
      console.log('LLM Integration initialized successfully');
    } catch (error) {
      throw createPromptEngineError(
        `Failed to initialize LLM integration: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'critical',
          recoverable: false,
          context: { originalError: error }
        }
      );
    }
  }

  /**
   * Get a non-streaming response from LLM
   */
  async getResponse(prompt: string, projectFiles?: ProjectItem[]): Promise<LLMResponse> {
    if (!this.llmService) {
      await this.initialize();
    }

    try {
      // Prepare messages for the LLM
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: 'You are an expert software engineer. Generate high-quality, production-ready code with detailed explanations where appropriate.'
        },
        {
          role: 'user',
          content: this.buildEnhancedPrompt(prompt, projectFiles)
        }
      ];

      // Prepare the LLM request
      const llmRequest: LLMRequest = {
        messages,
        provider: this.config.defaultProvider!,
        model: this.config.defaultModel!,
        temperature: this.config.defaultTemperature,
        maxTokens: this.config.defaultMaxTokens,
        stream: false,
      };

      // Make the request with timeout and retry logic
      const result = await this.executeWithRetry(async () => {
        const response = await this.llmService.generateResponse(llmRequest);
        
        return {
          content: response.content || '',
          tokensUsed: response.usage?.completion_tokens || 0,
          finishReason: response.finishReason || 'stop',
          timestamp: new Date(),
          usage: response.usage
        };
      }, this.config.maxRetries!);

      return result;

    } catch (error) {
      throw createPromptEngineError(
        `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'high',
          recoverable: true,
          context: { prompt, projectFiles }
        }
      );
    }
  }

  /**
   * Get a streaming response from LLM
   */
  async getStreamingResponse(prompt: string, projectFiles?: ProjectItem[]): Promise<LLMStreamingResponse> {
    if (!this.llmService) {
      await this.initialize();
    }

    try {
      // Prepare messages for the LLM
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: 'You are an expert software engineer. Generate high-quality, production-ready code with detailed explanations where appropriate. Stream the response incrementally.'
        },
        {
          role: 'user',
          content: this.buildEnhancedPrompt(prompt, projectFiles)
        }
      ];

      // Prepare the LLM request
      const llmRequest: LLMRequest = {
        messages,
        provider: this.config.defaultProvider!,
        model: this.config.defaultModel!,
        temperature: this.config.defaultTemperature,
        maxTokens: this.config.defaultMaxTokens,
        stream: true,
      };

      // Create streaming session
      const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.activeStreams.set(sessionId, {
        sessionId,
        isActive: true,
        chunksReceived: 0,
        totalTokens: 0,
        startTime: new Date()
      });

      // Get the streaming response
      const stream = await this.llmService.generateStreamingResponse(llmRequest);

      // Create async iterator that wraps the original stream
      const streamingResponse: LLMStreamingResponse = {
        [Symbol.asyncIterator]: async function* () {
          try {
            for await (const chunk of stream) {
              if (chunk?.content) {
                yield {
                  content: chunk.content,
                  isComplete: false
                };
              }
            }
            // When done, mark as complete
            yield {
              content: '',
              isComplete: true
            };
          } catch (error) {
            throw createStreamError(
              `Streaming failed: ${error instanceof Error ? error.message : String(error)}`,
              {
                code: ERROR_CODES.STREAMING.CHUNK_PROCESSING_FAILED,
                severity: 'high',
                recoverable: true,
                context: { sessionId, error }
              }
            );
          } finally {
            // Mark session as inactive
            const session = this.activeStreams.get(sessionId);
            if (session) {
              session.isActive = false;
            }
          }
        }.bind(this) as () => AsyncIterator<StreamingChunk>
      };

      return streamingResponse;

    } catch (error) {
      throw createStreamError(
        `Streaming LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.STREAMING.CONNECTION_TIMEOUT,
          severity: 'high',
          recoverable: true,
          context: { prompt, projectFiles }
        }
      );
    }
  }

  /**
   * Build enhanced prompt with project context
   */
  private buildEnhancedPrompt(prompt: string, projectFiles?: ProjectItem[]): string {
    let enhancedPrompt = prompt;

    if (projectFiles && projectFiles.length > 0) {
      enhancedPrompt += '\n\nProject Context:\n';
      enhancedPrompt += projectFiles.map(file => 
        `File: ${file.path}\nLanguage: ${file.language}\nContent Preview: ${file.content.substring(0, 200)}${file.content.length > 200 ? '...' : ''}\n---\n`
      ).join('\n');
    }

    return enhancedPrompt;
  }

  /**
   * Execute function with retry logic
   */
  private async executeWithRetry<T>(func: () => Promise<T>, maxRetries: number): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await func();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          // If this was the last attempt, re-throw the error
          throw error;
        }

        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, etc.
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Get available providers from the LLM service
   */
  async getAvailableProviders(): Promise<any[]> {
    if (!this.llmService) {
      await this.initialize();
    }

    try {
      return this.llmService.getAvailableProviders();
    } catch (error) {
      throw createPromptEngineError(
        `Failed to get available providers: ${error instanceof Error ? error.message : String(error)}`,
        {
          code: ERROR_CODES.PROMPT_ENGINE.PROMPT_GENERATION_FAILED,
          severity: 'medium',
          recoverable: true
        }
      );
    }
  }

  /**
   * Get active streaming sessions
   */
  getActiveStreamingSessions(): StreamingSession[] {
    return Array.from(this.activeStreams.values()).filter(session => session.isActive);
  }

  /**
   * Cancel a streaming session
   */
  async cancelStreamingSession(sessionId: string): Promise<boolean> {
    const session = this.activeStreams.get(sessionId);
    if (!session) {
      return false;
    }

    session.isActive = false;
    this.activeStreams.delete(sessionId);
    return true;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Cancel all active streams
    for (const [sessionId, session] of this.activeStreams.entries()) {
      if (session.isActive) {
        session.isActive = false;
      }
    }
    this.activeStreams.clear();
  }
}

// Global instance
export const llmIntegration = new LLMIntegration();