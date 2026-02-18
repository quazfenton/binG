/**
 * Enhanced LLM Service with Fallback System
 *
 * Integrates the Enhanced API Client with the existing LLM service
 * to provide robust API communication with fallback mechanisms.
 *
 * Supports task-specific providers for optimized performance:
 * - EMBEDDING_PROVIDER for embeddings (e.g., mistral-embed)
 * - AGENT_PROVIDER for agent completions (e.g., Mistral)
 * - OCR_PROVIDER for OCR processing (e.g., Mistral OCR)
 * - etc.
 */

import { enhancedAPIClient, type RequestConfig, type APIResponse } from './enhanced-api-client';
import { llmService, type LLMRequest, type LLMResponse, type StreamingResponse, PROVIDERS } from './llm-providers';
import { toolContextManager } from '../services/tool-context-manager';
import { sandboxBridge } from '../sandbox';
import { getProviderForTask, getModelForTask } from '../config/task-providers';

export interface EnhancedLLMRequest extends LLMRequest {
  fallbackProviders?: string[];
  retryOptions?: {
    maxAttempts?: number;
    backoffStrategy?: 'exponential' | 'linear' | 'fixed';
    baseDelay?: number;
    maxDelay?: number;
  };
  enableCircuitBreaker?: boolean;
  enableTools?: boolean;
  enableSandbox?: boolean;
  isSandboxCommand?: boolean; // Explicit flag for sandbox/command requests
  userId?: string;
  conversationId?: string;
  task?: 'chat' | 'code' | 'embedding' | 'image' | 'tool' | 'agent' | 'ocr'; // Task-specific provider selection
}

export interface LLMEndpointConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

export class EnhancedLLMService {
  private endpointConfigs: Map<string, LLMEndpointConfig> = new Map();
  private fallbackChains: Map<string, string[]> = new Map();

  constructor() {
    this.initializeEndpointConfigs();
    this.setupFallbackChains();
    this.startHealthMonitoring();
  }

  private initializeEndpointConfigs(): void {
    const configs: LLMEndpointConfig[] = [
      {
        provider: 'openrouter',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        models: PROVIDERS.openrouter.models,
        priority: 1
      },
      {
        provider: 'chutes',
        baseUrl: 'https://llm.chutes.ai/v1',
        apiKey: process.env.CHUTES_API_KEY || '',
        models: PROVIDERS.chutes.models,
        priority: 2
      },
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        models: PROVIDERS.anthropic.models,
        priority: 3
      },
      {
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: process.env.GOOGLE_API_KEY || '',
        models: PROVIDERS.google.models,
        priority: 4
      },
      {
        provider: 'mistral',
        baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
        apiKey: process.env.MISTRAL_API_KEY || '',
        models: PROVIDERS.mistral.models,
        priority: 5
      },
      {
        provider: 'portkey',
        baseUrl: 'https://api.portkey.ai/v1',
        apiKey: process.env.PORTKEY_API_KEY || '',
        models: PROVIDERS.portkey.models,
        priority: 6
      },
      {
        provider: 'opencode',
        baseUrl: process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1',
        apiKey: process.env.OPENCODE_API_KEY || '',
        models: PROVIDERS.opencode.models,
        priority: 7
      }
    ];

    configs.forEach(config => {
      if (config.apiKey) {
        this.endpointConfigs.set(config.provider, config);
      }
    });
  }

  private setupFallbackChains(): void {
    this.fallbackChains.set('openrouter', ['chutes', 'anthropic', 'google', 'mistral']);
    this.fallbackChains.set('chutes', ['openrouter', 'anthropic', 'google', 'mistral']);
    this.fallbackChains.set('anthropic', ['openrouter', 'chutes', 'google', 'mistral']);
    this.fallbackChains.set('google', ['openrouter', 'chutes', 'anthropic', 'mistral']);
    this.fallbackChains.set('mistral', ['openrouter', 'chutes', 'anthropic', 'google']);
    this.fallbackChains.set('portkey', ['openrouter', 'chutes', 'anthropic', 'mistral']);
    this.fallbackChains.set('opencode', ['openrouter', 'chutes', 'google', 'mistral']);
  }

  private startHealthMonitoring(): void {
    const endpoints = Array.from(this.endpointConfigs.values()).map(config => config.baseUrl);
    enhancedAPIClient.startHealthMonitoring(endpoints, 60000);
  }

  async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
    const { enableTools, enableSandbox, userId, conversationId, provider, fallbackProviders, retryOptions, enableCircuitBreaker = true, task, ...llmRequest } = request;

    // Use task-specific provider if specified
    const actualProvider = task ? getProviderForTask(task) : (provider || getProviderForTask('chat'));
    const actualModel = task ? getModelForTask(task, llmRequest.model) : llmRequest.model;

    // If tools are enabled and user ID is provided, process tools
    if (enableTools && userId && conversationId) {
      const toolResult = await this.processToolRequest(
        llmRequest.messages,
        userId,
        conversationId
      );

      if (toolResult.requiresAuth && toolResult.authUrl) {
        return {
          content: `I need authorization to use ${toolResult.toolName}. Please connect your account to proceed.`,
          tokensUsed: 0,
          finishReason: 'tool_auth_required',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          metadata: {
            requiresAuth: true,
            authUrl: toolResult.authUrl,
            toolName: toolResult.toolName
          }
        };
      }

      if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
        // Store tool results in request metadata instead of injecting synthetic messages
        // This avoids provider compatibility issues (Anthropic rejects 'tool' role, Google maps it incorrectly)
        const updatedRequest = {
          ...llmRequest,
          toolCalls: toolResult.toolCalls,
          toolResults: toolResult.toolResults
        };

        return await this.callProviderWithEnhancedClient(actualProvider, updatedRequest, retryOptions, enableCircuitBreaker);
      }
    }

    // Only process sandbox request if explicitly flagged as a sandbox/command request
    // This prevents short-circuiting normal LLM flow for all messages when sandbox is enabled
    if (request.isSandboxCommand && userId && conversationId) {
      return await this.processSandboxRequest(request, userId, conversationId);
    }

    // Try primary provider first
    try {
      const fullRequest = { ...llmRequest, provider: actualProvider, model: actualModel };
      return await this.callProviderWithEnhancedClient(actualProvider, fullRequest, retryOptions, enableCircuitBreaker);
    } catch (primaryError) {
      console.warn(`Primary provider ${actualProvider} failed:`, primaryError);

      const fallbacks = fallbackProviders || this.fallbackChains.get(actualProvider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider =>
        this.endpointConfigs.has(fallbackProvider) &&
        this.isProviderHealthy(fallbackProvider)
      );

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No healthy fallback providers available for ${actualProvider}`,
          'NO_FALLBACKS_AVAILABLE',
          primaryError as Error
        );
      }

      for (const fallbackProvider of availableFallbacks) {
        try {
          console.log(`Trying fallback provider: ${fallbackProvider}`);

          const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
          const supportedModel = this.findCompatibleModel(actualModel, fallbackConfig.models);

          if (!supportedModel) {
            console.warn(`Model ${actualModel} not supported by ${fallbackProvider}, skipping`);
            continue;
          }

          const fallbackRequest = {
            ...llmRequest,
            model: supportedModel,
            provider: fallbackProvider
          };

          const response = await this.callProviderWithEnhancedClient(
            fallbackProvider,
            fallbackRequest,
            retryOptions,
            enableCircuitBreaker
          );

          return {
            ...response,
            provider: `${provider} -> ${fallbackProvider}`,
            model: supportedModel  // Include the actual fallback model used
          };
        } catch (fallbackError) {
          console.warn(`Fallback provider ${fallbackProvider} failed:`, fallbackError);
          continue;
        }
      }

      throw this.createEnhancedError(
        'All providers failed to generate response',
        'ALL_PROVIDERS_FAILED',
        primaryError as Error
      );
    }
  }

  async *generateStreamingResponse(request: EnhancedLLMRequest): AsyncGenerator<StreamingResponse> {
    const { provider, fallbackProviders, ...llmRequest } = request;

    try {
      const fullRequest = { ...llmRequest, provider };
      yield* llmService.generateStreamingResponse(fullRequest);
    } catch (error) {
      console.warn(`Streaming failed for ${provider}:`, error);
      
      const fallbacks = fallbackProviders || this.fallbackChains.get(provider) || [];
      const availableFallbacks = fallbacks.filter(fallbackProvider => 
        this.endpointConfigs.has(fallbackProvider) && 
        this.isProviderHealthy(fallbackProvider) &&
        PROVIDERS[fallbackProvider]?.supportsStreaming
      );

      if (availableFallbacks.length === 0) {
        throw this.createEnhancedError(
          `No streaming fallback providers available for ${provider}`,
          'NO_STREAMING_FALLBACKS',
          error as Error
        );
      }

      const fallbackProvider = availableFallbacks[0];
      const fallbackConfig = this.endpointConfigs.get(fallbackProvider)!;
      const supportedModel = this.findCompatibleModel(llmRequest.model, fallbackConfig.models);

      if (supportedModel) {
        console.log(`Falling back to streaming provider: ${fallbackProvider}`);
        const fallbackRequest = {
          ...llmRequest,
          model: supportedModel,
          provider: fallbackProvider
        };

        yield* llmService.generateStreamingResponse(fallbackRequest);
      } else {
        throw this.createEnhancedError(
          `No compatible model found for streaming fallback`,
          'NO_COMPATIBLE_MODEL',
          error as Error
        );
      }
    }
  }

  private async callProviderWithEnhancedClient(
    provider: string,
    request: LLMRequest & { toolCalls?: any[]; toolResults?: any[] },
    retryOptions?: any,
    enableCircuitBreaker: boolean = true
  ): Promise<LLMResponse> {
    const config = this.endpointConfigs.get(provider);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }

    // Filter messages for provider compatibility
    // OpenAI supports 'tool' role, but Anthropic and Google do not
    const filteredMessages = this.filterMessagesForProvider(request.messages, provider);

    const providerRequest = {
      ...request,
      messages: filteredMessages
    };

    try {
      return await llmService.generateResponse(providerRequest);
    } catch (error) {
      throw this.enhanceError(error as Error, provider);
    }
  }

  /**
   * Filter messages for provider compatibility.
   * - OpenAI: Supports 'tool' and 'assistant' roles with tool calls
   * - Anthropic: Only supports 'user' and 'assistant' roles
   * - Google: Maps 'tool' to 'user' which is incorrect
   */
  private filterMessagesForProvider(
    messages: Array<{ role: string; content: string }>,
    provider: string
  ): Array<{ role: string; content: string }> {
    // OpenAI-compatible providers can handle tool messages
    const openAICompatible = ['openrouter', 'chutes', 'portkey'];
    if (openAICompatible.includes(provider)) {
      return messages;
    }

    // For other providers (Anthropic, Google, etc.), filter out synthetic tool messages
    return messages.filter(msg => {
      // Remove 'tool' role messages
      if (msg.role === 'tool') return false;

      // Remove assistant messages that are just JSON-stringified tool calls
      if (msg.role === 'assistant' && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed) && parsed.every(item => item.id && item.type && item.function)) {
            return false; // This is a synthetic tool call message
          }
        } catch {
          // Not JSON, keep the message
        }
      }

      return true;
    });
  }

  private findCompatibleModel(requestedModel: string, availableModels: string[]): string | null {
    if (availableModels.includes(requestedModel)) {
      return requestedModel;
    }

    const modelFamily = this.extractModelFamily(requestedModel);
    const compatibleModel = availableModels.find(model => 
      this.extractModelFamily(model) === modelFamily
    );

    return compatibleModel || availableModels[0] || null;
  }

  private extractModelFamily(model: string): string {
    const patterns = [
      /^(gpt-[34])/i,
      /^(claude-[23])/i,
      /^(gemini)/i,
      /^(llama)/i,
      /^(deepseek)/i,
      /^(mixtral)/i
    ];

    for (const pattern of patterns) {
      const match = model.match(pattern);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    return model.split('-')[0].toLowerCase();
  }

  private isProviderHealthy(provider: string): boolean {
    const config = this.endpointConfigs.get(provider);
    if (!config) return false;

    const health = enhancedAPIClient.getEndpointHealth(config.baseUrl) as any;
    return health.isHealthy !== false;
  }

  private enhanceError(error: Error, provider: string): Error {
    const enhancedError = new Error(error.message);
    
    if (error.message.includes('API key')) {
      enhancedError.message = `Authentication failed for ${provider}. Please check your API key configuration.`;
    } else if (error.message.includes('rate limit')) {
      enhancedError.message = `Rate limit exceeded for ${provider}. The system will automatically try alternative providers.`;
    } else if (error.message.includes('quota')) {
      enhancedError.message = `API quota exceeded for ${provider}. Switching to alternative provider.`;
    } else if (error.message.includes('timeout')) {
      enhancedError.message = `Request timeout for ${provider}. The system will retry with exponential backoff.`;
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      enhancedError.message = `Network error connecting to ${provider}. Checking alternative providers.`;
    } else {
      enhancedError.message = `Service error from ${provider}: ${error.message}`;
    }

    return enhancedError;
  }

  private createEnhancedError(message: string, code: string, originalError: Error): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).originalError = originalError;
    return error;
  }

  getProviderHealth(): Record<string, any> {
    const health: Record<string, any> = {};
    
    this.endpointConfigs.forEach((config, provider) => {
      const endpointHealth = enhancedAPIClient.getEndpointHealth(config.baseUrl);
      health[provider] = {
        ...config,
        health: endpointHealth,
        circuitBreaker: enhancedAPIClient.getCircuitBreakerStats()
          .find(cb => cb.endpoint === config.baseUrl)
      };
    });

    return health;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.endpointConfigs.keys())
      .filter(provider => this.isProviderHealthy(provider));
  }

  resetProviderHealth(provider?: string): void {
    if (provider) {
      const config = this.endpointConfigs.get(provider);
      if (config) {
        enhancedAPIClient.resetCircuitBreaker(config.baseUrl);
      }
    } else {
      enhancedAPIClient.resetCircuitBreaker();
    }
  }

  async processToolRequest(messages: LLMMessage[], userId: string, conversationId: string) {
    try {
      const result = await toolContextManager.processToolRequest(
        messages,
        userId,
        conversationId
      );

      return {
        requiresAuth: result.requiresAuth,
        authUrl: result.authUrl,
        toolName: result.toolName,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        content: result.content
      };
    } catch (error: any) {
      console.error('Tool request processing error:', error);
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Error processing tool request: ${error.message}`
      };
    }
  }

  async processSandboxRequest(request: EnhancedLLMRequest, userId: string, conversationId: string): Promise<LLMResponse> {
    try {
      const session = await sandboxBridge.getOrCreateSession(userId);

      const lastUserMessage = request.messages
        .filter(m => m.role === 'user')
        .pop()?.content;

      if (!lastUserMessage) {
        return {
          content: 'No user message found to process in sandbox',
          tokensUsed: 0,
          finishReason: 'error',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      // Type guard: Ensure content is a string, not an array of content parts
      let commandString: string;
      if (typeof lastUserMessage !== 'string') {
        // Handle array content by extracting text from parts
        if (Array.isArray(lastUserMessage)) {
          commandString = lastUserMessage
            .filter(part => typeof part === 'string' || (part as any).type === 'text')
            .map(part => typeof part === 'string' ? part : (part as any).text || '')
            .join(' ');
        } else {
          return {
            content: 'Invalid message format: expected string or text content',
            tokensUsed: 0,
            finishReason: 'error',
            timestamp: new Date(),
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          };
        }
      } else {
        commandString = lastUserMessage;
      }

      // Extract command from natural language input
      // Look for common command patterns and extract the actual shell command
      const extractedCommand = this.extractCommandFromNaturalLanguage(commandString);
      
      // Validate and sanitize command input before execution
      const validatedCommand = this.validateSandboxCommand(extractedCommand);
      if (!validatedCommand.isValid) {
        return {
          content: `Command rejected: ${validatedCommand.reason}`,
          tokensUsed: 0,
          finishReason: 'error',
          timestamp: new Date(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }

      const result = await sandboxBridge.executeCommand(session.sandboxId, validatedCommand.command);

      return {
        content: `Sandbox execution completed.\n\nOutput:\n${result.output || 'No output'}${result.exitCode !== undefined && result.exitCode !== 0 ? `\n\nExit code: ${result.exitCode}` : ''}`,
        tokensUsed: 0,
        finishReason: result.success ? 'stop' : 'error',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metadata: {
          success: result.success,
          exitCode: result.exitCode
        }
      };
    } catch (error: any) {
      console.error('Sandbox request processing error:', error);
      return {
        content: `Error executing in sandbox: ${error.message}`,
        tokensUsed: 0,
        finishReason: 'error',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  /**
   * Validates and sanitizes command input before sandbox execution.
   * Prevents command injection attacks by blocking dangerous patterns.
   */
  private validateSandboxCommand(command: string): { isValid: boolean; command: string; reason?: string } {
    return validateSandboxCommand(command);
  }

  /**
   * Extracts shell commands from natural language input.
   * Converts phrases like "please run ls -la" to "ls -la".
   */
  private extractCommandFromNaturalLanguage(input: string): string {
    const trimmedInput = input.trim();

    // Common natural language prefixes to strip
    const commandPrefixes = [
      /^(?:please\s+)?(?:run|execute|exec)\s+/i,
      /^(?:please\s+)?(?:can\s+you\s+)?(?:run|execute)\s+/i,
      /^(?:could\s+you\s+)?(?:please\s+)?(?:run|execute)\s+/i,
      /^(?:i\s+want\s+to\s+)?(?:run|execute)\s+/i,
      /^(?:i\s+need\s+to\s+)?(?:run|execute)\s+/i,
      /^(?:let['']s\s+)?(?:run|execute)\s+/i,
      /^(?:just\s+)?(?:run|execute)\s+/i,
      /^(?:show\s+me\s+)/i,
      /^(?:check\s+)/i,
      /^(?:list\s+)/i,
      /^(?:display\s+)/i,
    ];

    let command = trimmedInput;
    for (const prefix of commandPrefixes) {
      const match = command.match(prefix);
      if (match) {
        command = command.replace(prefix, '');
        break;
      }
    }

    // Remove trailing punctuation that's common in natural language
    command = command.replace(/[.!?,;]+$/, '').trim();

    // Remove quote wrappers if present
    const quoteMatch = command.match(/^["'](.+)["']$/);
    if (quoteMatch) {
      command = quoteMatch[1];
    }

    return command.trim() || trimmedInput;
  }

  destroy(): void {
    enhancedAPIClient.destroy();
  }
}

/**
 * Validates and sanitizes command input before sandbox execution.
 * Prevents command injection attacks by blocking dangerous patterns.
 * Exported as standalone function for use in sandbox execute API.
 */
export function validateSandboxCommand(command: string): { isValid: boolean; command: string; reason?: string } {
  if (!command || typeof command !== 'string') {
    return { isValid: false, command: '', reason: 'Command is required' };
  }

  // Length limit to prevent resource exhaustion
  const MAX_COMMAND_LENGTH = 10000;
  if (command.length > MAX_COMMAND_LENGTH) {
    return { isValid: false, command: '', reason: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters` };
  }

  const trimmedCommand = command.trim();

  // Block dangerous command patterns that could escape sandbox or cause harm
  const dangerousPatterns = [
    // Network exfiltration attempts (using [^|]* instead of .* to prevent backtracking)
    /\bcurl\b[^|]*\|\s*(?:ba)?sh\b/i,
    /\bwget\b[^|]*\|\s*(?:ba)?sh\b/i,
    // Privilege escalation
    /\bsudo\b/i,
    /\bsu\b\s+/i,
    // Container escape attempts
    /\bdocker\b/i,
    /\bkubectl\b/i,
    // Filesystem traversal beyond workspace
    /\.\.\/\.\./,
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    // Process manipulation
    /\bpkill\b/i,
    /\bkillall\b/i,
    // Code execution in other languages (using \s+ instead of .*)
    /\bpython[3]?\s+-c\b/i,
    /\bperl\s+-e\b/i,
    /\bruby\s+-e\b/i,
    // Base64 decode and execute patterns
    /\bbase64\b[^|]*\|\s*(?:ba)?sh\b/i,
    /\bbase64\b[^|]*\|\s*bash\b/i,
    // Eval patterns
    /\beval\s*\(/i,
    /\bexec\s*\(/i,
    // Netcat with exec flag
    /\bnc\s+-e\b/i,
    /\bnetcat\s+-e\b/i,
    // Additional dangerous patterns for common attack vectors
    /\bnode\s+-e\b/i,
    /\bphp\s+-r\b/i,
    /\bbash\s+-c\b/i,
    /\bzsh\s+-c\b/i,
    /\bsh\s+-c\b/i,
    // Piping to any shell variant
    /\|\s*(ba)?sh\b/i,
    /\|\s*bash\b/i,
    /\|\s*zsh\b/i,
    /\|\s*ash\b/i,
    // Command substitution
    /\$\([^)]+\)/,
    /`[^`]+`/,
  ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedCommand)) {
        return { isValid: false, command: '', reason: 'Command contains potentially dangerous pattern' };
      }
    }

    // Universal shell metacharacter check - applied to ALL commands
    // These characters can enable command injection or redirection attacks
    const dangerousChars = [';', '&&', '||', '|', '`', '$', '>', '<', '&', '\n', '\r'];
    for (const char of dangerousChars) {
      if (trimmedCommand.includes(char)) {
        return {
          isValid: false,
          command: '',
          reason: `Command contains unsafe character: ${char}`
        };
      }
    }

    // Allow-list of safe command prefixes for common development tasks
    // NOTE: Container tools and general-purpose interpreters are intentionally excluded
    // as they can be used to escape sandbox or execute arbitrary code
    // NOTE: Destructive commands (rm, chmod, chown) are excluded to prevent data loss
    const safeCommandPrefixes = [
      // File operations (read-only and safe create)
      'ls ', 'cat ', 'head ', 'tail ', 'wc ', 'grep ', 'find ', 'tree ',
      'pwd ', 'cd ', 'mkdir ', 'rmdir ', 'cp ', 'mv ', 'touch ',
      'ln ', 'readlink ',
      // Text processing
      'sed ', 'awk ', 'cut ', 'sort ', 'uniq ', 'tr ', 'rev ',
      'echo ', 'printf ',
      // Build tools and compilers (safe, produce deterministic output)
      'npm ', 'yarn ', 'pnpm ', 'bun ', 'cargo ', 'go ',
      'make ', 'cmake ', 'gcc ', 'g++ ', 'clang ', 'rustc ',
      // Version control
      'git ', 'svn ', 'hg ',
      // Testing
      'jest ', 'mocha ', 'pytest ', 'cargo test', 'go test ',
      // System info (read-only)
      'uname ', 'whoami ', 'id ', 'date ', 'time ', 'uptime ', 'df ', 'du ',
      'env ', 'printenv ', 'which ', 'whereis ', 'type ',
      // Network (read-only)
      'curl ', 'wget ', 'ping ', 'dig ', 'nslookup ', 'netstat ', 'ss ',
      // Process info (read-only)
      'ps ', 'top ', 'htop ', 'pgrep ', 'pidof ',
      // Package managers (read-only operations)
      'apt ', 'apt-get ', 'apt-cache ', 'yum ', 'dnf ', 'apk ', 'brew ',
      // Text editors (interactive, don't execute code)
      'vim ', 'vi ', 'nano ', 'emacs ', 'code ',
      // Documentation
      'man ', 'help ', '--help', '-h ',
    ];

    // Additional blocklist for dangerous argument patterns (defense in depth)
    const dangerousArgPatterns = [
      /rm\s+-rf\s/i,          // rm -rf (recursive force delete)
      /rm\s+--no-preserve-root/i,  // rm --no-preserve-root
      /chmod\s+(-[aR]*7|000)/i,    // chmod with dangerous permissions
      /chown\s+.*:.*\//i,     // chown with recursive paths
      /\s-\w*f\s/i,           // force flag patterns
    ];

    for (const pattern of dangerousArgPatterns) {
      if (pattern.test(trimmedCommand)) {
        return {
          isValid: false,
          command: '',
          reason: 'Command contains dangerous argument pattern'
        };
      }
    }

    // Check if command starts with a safe prefix or is a simple command
    const lowerCommand = trimmedCommand.toLowerCase();
    const isSafePrefix = safeCommandPrefixes.some(prefix =>
      lowerCommand.startsWith(prefix.toLowerCase())
    );

    // Also allow simple commands without arguments (e.g., "ls", "pwd")
    const simpleCommand = trimmedCommand.split(/\s+/)[0].toLowerCase();
    const isSimpleSafeCommand = safeCommandPrefixes.some(prefix =>
      prefix.trim() === simpleCommand
    );

    if (!isSafePrefix && !isSimpleSafeCommand) {
      return {
        isValid: false,
        command: '',
        reason: 'Command not in allowed list'
      };
    }

    return { isValid: true, command: trimmedCommand };
  }

export const enhancedLLMService = new EnhancedLLMService();