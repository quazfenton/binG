/**
 * Kilocode Client
 *
 * HTTP client for interacting with the Kilocode server API.
 * Provides typed methods for all Kilocode operations with
 * error handling, retries, and streaming support.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createLogger } from '../utils/logger';
import { withRetry, handleError } from '../utils/error-handling';
import {
  KilocodeConfig,
  KilocodeClient,
  CodeGenerationRequest,
  CodeCompletionRequest,
  CodeAnalysisRequest,
  CodeRefactorRequest,
  CodeReviewRequest,
  KilocodeResponse,
  StreamingResponse,
  CodeSuggestion,
  CodeAnalysisResult,
  RefactorResult,
  CodeReviewResult
} from './types';

const logger = createLogger('KilocodeClient');

export class KilocodeHTTPClient implements KilocodeClient {
  private client: AxiosInstance;
  private config: KilocodeConfig;

  constructor(config: KilocodeConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: `http://${config.host}:${config.port}`,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const errorResult = handleError(error, 'Kilocode API');
        throw new Error(errorResult.userMessage);
      }
    );
  }

  /**
   * Generate code from natural language prompt
   */
  async generate(request: CodeGenerationRequest): Promise<KilocodeResponse<string>> {
    return this.makeRequest<string>('/api/generate', request);
  }

  /**
   * Complete code at cursor position
   */
  async complete(request: CodeCompletionRequest): Promise<KilocodeResponse<CodeSuggestion[]>> {
    return this.makeRequest<CodeSuggestion[]>('/api/complete', request);
  }

  /**
   * Analyze code for issues and improvements
   */
  async analyze(request: CodeAnalysisRequest): Promise<KilocodeResponse<CodeAnalysisResult>> {
    return this.makeRequest<CodeAnalysisResult>('/api/analyze', request);
  }

  /**
   * Refactor code
   */
  async refactor(request: CodeRefactorRequest): Promise<KilocodeResponse<RefactorResult>> {
    return this.makeRequest<RefactorResult>('/api/refactor', request);
  }

  /**
   * Review code quality
   */
  async review(request: CodeReviewRequest): Promise<KilocodeResponse<CodeReviewResult>> {
    return this.makeRequest<CodeReviewResult>('/api/review', request);
  }

  /**
   * Stream code generation with real-time updates
   */
  async *generateStream(request: CodeGenerationRequest): AsyncIterable<StreamingResponse> {
    try {
      const response = await this.client.post('/api/generate/stream', request, {
        responseType: 'stream'
      });

      const stream = response.data;

      for await (const chunk of this.parseSSEStream(stream)) {
        yield chunk;
      }
    } catch (error) {
      logger.error('Streaming request failed', error);
      yield { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Make authenticated API request with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    data: any,
    options: { retries?: number } = {}
  ): Promise<KilocodeResponse<T>> {
    const requestFn = async () => {
      const response: AxiosResponse<KilocodeResponse<T>> = await this.client.post(endpoint, data);
      return response.data;
    };

    return withRetry(requestFn, {
      maxAttempts: options.retries || 3,
      delayMs: 1000,
      backoffMultiplier: 2
    })();
  }

  /**
   * Parse Server-Sent Events stream
   */
  private async *parseSSEStream(stream: any): AsyncIterable<StreamingResponse> {
    let buffer = '';

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');

      // Keep the last potentially incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch (error) {
            logger.warn('Failed to parse SSE data', { line, error });
          }
        }
      }
    }

    // Handle any remaining data in buffer
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        yield data;
      } catch (error) {
        logger.warn('Failed to parse final SSE data', { buffer, error });
      }
    }
  }

  /**
   * Check server health
   */
  async healthCheck(): Promise<{ status: string; version: string }> {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      throw new Error('Kilocode server health check failed');
    }
  }

  /**
   * Update client configuration
   */
  updateConfig(newConfig: Partial<KilocodeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.client.defaults.timeout = this.config.timeout;

    if (newConfig.apiKey) {
      this.client.defaults.headers['Authorization'] = `Bearer ${newConfig.apiKey}`;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): KilocodeConfig {
    return { ...this.config };
  }
}

/**
 * Create Kilocode client instance
 */
export function createKilocodeClient(config: KilocodeConfig): KilocodeClient {
  return new KilocodeHTTPClient(config);
}

/**
 * Default client configuration
 */
export const defaultKilocodeConfig: KilocodeConfig = {
  port: 3001,
  host: 'localhost',
  maxRequestsPerHour: 1000,
  enableStreaming: true,
  supportedLanguages: ['javascript', 'typescript', 'python', 'java', 'cpp', 'go', 'rust', 'php'],
  modelEndpoints: {
    'gpt-4': 'https://api.openai.com/v1/chat/completions',
    'claude-3': 'https://api.anthropic.com/v1/messages',
    'codellama': 'https://api.replicate.com/v1/predictions'
  },
  timeout: 30000,
  enableCors: true,
  trustedOrigins: ['http://localhost:3000', 'http://localhost:3001']
};