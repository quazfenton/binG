/**
 * Priority Request Router - Routes requests through priority-based endpoint chain
 * Ensures requests are handled by the most capable available service with automatic fallback
 */

import { fastAgentService, type FastAgentRequest, type FastAgentResponse } from './fast-agent-service';
import { n8nAgentService, type N8nAgentRequest, type N8nAgentResponse } from './n8n-agent-service';
import { customFallbackService, type CustomFallbackRequest, type CustomFallbackResponse } from './custom-fallback-service';
import { enhancedLLMService, type EnhancedLLMRequest } from './enhanced-llm-service';
import { getToolManager } from '../tools';
import { toolAuthManager } from '../services/tool-authorization-manager';
import { toolContextManager } from '../services/tool-context-manager';
import { sandboxBridge } from '../sandbox';
import type { LLMMessage } from './llm-providers';
import { detectRequestType } from '../utils/request-type-detector';

export interface RouterRequest {
  messages: LLMMessage[];
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  apiKeys?: Record<string, string>;
  requestId?: string;
  userId?: string;
  enableTools?: boolean;
  enableSandbox?: boolean;
}

export interface RouterResponse {
  success: boolean;
  content?: string;
  data?: any;
  source: string;
  priority: number;
  fallbackChain?: string[];
  metadata?: Record<string, any>;
}

export interface EndpointConfig {
  name: string;
  priority: number;
  enabled: boolean;
  service: any;
  healthCheck: () => Promise<boolean>;
  canHandle: (request: any) => boolean;
  processRequest: (request: any) => Promise<any>;
}

class PriorityRequestRouter {
  private endpoints: EndpointConfig[];
  private routingStats: Map<string, { success: number; failures: number }>;

  constructor() {
    this.routingStats = new Map();
    this.endpoints = this.initializeEndpoints();
  }

  /**
   * Initialize endpoint configurations in priority order
   */
  private initializeEndpoints(): EndpointConfig[] {
    const endpoints: EndpointConfig[] = [
      // Priority 1: Tool Execution (Handle tool requests with authorization)
      {
        name: 'tool-execution',
        priority: 1,
        enabled: true,
        service: getToolManager(),
        healthCheck: async () => {
          // Check if Arcade/Nango are configured
          return !!(process.env.ARCADE_API_KEY || process.env.NANGO_API_KEY);
        },
        canHandle: (req) => {
          // Check if request contains tool intent and has user context
          return detectRequestType(req.messages) === 'tool' && !!req.userId && req.enableTools !== false;
        },
        processRequest: async (req) => {
          // Process tool request with authorization
          return await this.processToolRequest(req);
        }
      },
      // Priority 2: Sandbox Agent (Handle code execution requests)
      {
        name: 'sandbox-agent',
        priority: 2,
        enabled: true,
        service: sandboxBridge,
        healthCheck: async () => {
          // Check if sandbox provider is configured
          return !!(process.env.SANDBOX_PROVIDER);
        },
        canHandle: (req) => {
          // Check if request contains code execution intent and has user context
          return detectRequestType(req.messages) === 'sandbox' && !!req.userId && req.enableSandbox !== false;
        },
        processRequest: async (req) => {
          // Process sandbox request
          return await this.processSandboxRequest(req);
        }
      },
      // Priority 3: Fast-Agent (Most capable - tools, MCP, file handling)
      {
        name: 'fast-agent',
        priority: 3,
        enabled: process.env.FAST_AGENT_ENABLED === 'true',
        service: fastAgentService,
        healthCheck: () => fastAgentService.healthCheck(),
        canHandle: (req) => fastAgentService.shouldHandle(this.convertToFastAgentRequest(req)),
        processRequest: async (req) => {
          const response = await fastAgentService.processRequest(this.convertToFastAgentRequest(req));
          return this.normalizeFastAgentResponse(response);
        }
      },
      // Priority 4: n8n Agent Chaining (Complex workflows and external integrations)
      {
        name: 'n8n-agents',
        priority: 4,
        enabled: process.env.N8N_ENABLED === 'true',
        service: n8nAgentService,
        healthCheck: () => n8nAgentService.healthCheck(),
        canHandle: (req) => n8nAgentService.shouldHandle(this.convertToN8nRequest(req)),
        processRequest: async (req) => {
          const response = await n8nAgentService.processRequest(this.convertToN8nRequest(req));
          return this.normalizeN8nResponse(response);
        }
      },
      // Priority 5: Custom Fallback (Last resort before original system)
      {
        name: 'custom-fallback',
        priority: 5,
        enabled: process.env.CUSTOM_FALLBACK_ENABLED === 'true',
        service: customFallbackService,
        healthCheck: () => customFallbackService.healthCheck(),
        canHandle: () => true, // Always accepts
        processRequest: async (req) => {
          const response = await customFallbackService.processRequest(this.convertToCustomFallbackRequest(req));
          return this.normalizeCustomFallbackResponse(response);
        }
      },
      // Priority 6: Original Enhanced LLM Service (Built-in system)
      {
        name: 'original-system',
        priority: 6,
        enabled: true,
        service: enhancedLLMService,
        healthCheck: async () => true, // Always available
        canHandle: () => true, // Always accepts
        processRequest: async (req) => {
          const response = await enhancedLLMService.generateResponse(this.convertToEnhancedLLMRequest(req));
          return this.normalizeOriginalResponse(response);
        }
      }
    ];

    // Sort by priority and filter enabled
    return endpoints
      .filter(e => e.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Route request through priority chain
   */
  async route(request: RouterRequest): Promise<RouterResponse> {
    const errors: Array<{ endpoint: string; error: Error }> = [];
    const fallbackChain: string[] = [];
    const startTime = Date.now();

    console.log(`[Router] Starting request routing. Available endpoints: ${this.endpoints.map(e => e.name).join(', ')}`);

    for (const endpoint of this.endpoints) {
      try {
        console.log(`[Router] Trying endpoint: ${endpoint.name} (priority ${endpoint.priority})`);
        
        // Check if endpoint can handle this request
        if (!endpoint.canHandle(request)) {
          console.log(`[Router] ${endpoint.name} cannot handle this request type, skipping`);
          continue;
        }

        // Perform health check
        const isHealthy = await endpoint.healthCheck();
        if (!isHealthy) {
          console.warn(`[Router] ${endpoint.name} health check failed, trying next`);
          fallbackChain.push(`${endpoint.name} (unhealthy)`);
          continue;
        }

        // Process request
        console.log(`[Router] Routing to ${endpoint.name}`);
        const response = await endpoint.processRequest(request);
        
        // Track success
        this.updateStats(endpoint.name, true);
        
        const duration = Date.now() - startTime;
        console.log(`[Router] Request successfully handled by ${endpoint.name} in ${duration}ms`);

        return {
          success: true,
          ...response,
          source: endpoint.name,
          priority: endpoint.priority,
          fallbackChain: fallbackChain.length > 0 ? fallbackChain : undefined,
          metadata: {
            ...response.metadata,
            duration,
            routedThrough: endpoint.name,
            triedEndpoints: fallbackChain.length + 1
          }
        };

      } catch (error) {
        const err = error as Error;
        console.error(`[Router] ${endpoint.name} failed:`, err.message);
        
        // Track failure
        this.updateStats(endpoint.name, false);
        
        errors.push({ endpoint: endpoint.name, error: err });
        fallbackChain.push(`${endpoint.name} (error: ${err.message.substring(0, 50)})`);
        
        // Continue to next endpoint
      }
    }

    // All endpoints failed - this should be extremely rare with proper fallback configuration
    const duration = Date.now() - startTime;
    console.error('[Router] All endpoints failed:', errors);
    
    // Return a final emergency response
    return {
      success: false,
      content: "I apologize, but I'm currently unable to process your request due to technical difficulties. Please try again in a moment.",
      source: 'emergency-fallback',
      priority: 999,
      fallbackChain,
      metadata: {
        duration,
        errors: errors.map(e => ({ endpoint: e.endpoint, error: e.error.message })),
        allEndpointsFailed: true
      }
    };
  }

  /**
   * Convert router request to Fast-Agent format
   */
  private convertToFastAgentRequest(request: RouterRequest): FastAgentRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to n8n format
   */
  private convertToN8nRequest(request: RouterRequest): N8nAgentRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to custom fallback format
   */
  private convertToCustomFallbackRequest(request: RouterRequest): CustomFallbackRequest {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      })),
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      requestId: request.requestId
    };
  }

  /**
   * Convert router request to enhanced LLM format
   */
  private convertToEnhancedLLMRequest(request: RouterRequest): EnhancedLLMRequest {
    return {
      messages: request.messages,
      provider: request.provider,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: false, // Non-streaming for routing
      apiKeys: request.apiKeys,
      enableCircuitBreaker: true,
      retryOptions: {
        maxAttempts: 2,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000
      }
    };
  }

  /**
   * Normalize Fast-Agent response
   */
  private normalizeFastAgentResponse(response: FastAgentResponse): any {
    return {
      content: response.content || '',
      data: {
        content: response.content || '',
        toolCalls: response.toolCalls,
        files: response.files,
        chainedAgents: response.chainedAgents,
        qualityScore: response.qualityScore,
        processingSteps: response.processingSteps,
        reflectionResults: response.reflectionResults,
        multiModalContent: response.multiModalContent
      }
    };
  }

  /**
   * Normalize n8n response
   */
  private normalizeN8nResponse(response: N8nAgentResponse): any {
    return {
      content: response.content || '',
      data: {
        content: response.content || '',
        chainedAgents: response.chainedAgents,
        iterations: response.iterations,
        classifications: response.classifications,
        optimizations: response.optimizations
      }
    };
  }

  /**
   * Normalize custom fallback response
   */
  private normalizeCustomFallbackResponse(response: CustomFallbackResponse): any {
    return {
      content: response.content,
      data: {
        content: response.content,
        provider: response.provider,
        model: response.model,
        isFallback: response.isFallback,
        fallbackReason: response.fallbackReason
      }
    };
  }

  /**
   * Normalize original system response
   */
  private normalizeOriginalResponse(response: any): any {
    return {
      content: response.content || '',
      data: response
    };
  }

  /**
   * Update routing statistics
   */
  private updateStats(endpoint: string, success: boolean): void {
    const stats = this.routingStats.get(endpoint) || { success: 0, failures: 0 };
    
    if (success) {
      stats.success++;
    } else {
      stats.failures++;
    }
    
    this.routingStats.set(endpoint, stats);
  }

  /**
   * Get routing statistics
   */
  getStats(): Record<string, { success: number; failures: number; successRate: number }> {
    const stats: Record<string, any> = {};
    
    this.routingStats.forEach((value, key) => {
      const total = value.success + value.failures;
      stats[key] = {
        ...value,
        successRate: total > 0 ? (value.success / total) * 100 : 0
      };
    });
    
    return stats;
  }

  /**
   * Get available endpoints
   */
  getAvailableEndpoints(): string[] {
    return this.endpoints.map(e => e.name);
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.routingStats.clear();
  }

  /**
   * Process tool request with authorization
   */
  private async processToolRequest(request: RouterRequest): Promise<any> {
    if (!request.userId) {
      return {
        content: 'User authentication required for tool access',
        data: {
          source: 'tool-execution',
          requiresAuth: true,
          error: 'User ID not provided'
        }
      };
    }

    try {
      const result = await toolContextManager.processToolRequest(
        request.messages,
        request.userId,
        request.requestId || `conv_${Date.now()}`
      );

      if (result.requiresAuth && result.authUrl) {
        return {
          content: `I need authorization to use ${result.toolName}. Please connect your account to proceed.`,
          data: {
            source: 'tool-execution',
            requiresAuth: true,
            authUrl: result.authUrl,
            toolName: result.toolName,
            type: 'auth_required'
          }
        };
      }

      if (result.toolCalls && result.toolCalls.length > 0) {
        return {
          content: result.content,
          data: {
            source: 'tool-execution',
            toolCalls: result.toolCalls,
            toolResults: result.toolResults,
            type: 'tool_execution'
          }
        };
      }

      return {
        content: result.content,
        data: {
          source: 'tool-execution',
          type: 'no_tools_detected'
        }
      };
    } catch (error: any) {
      console.error('[Router] Tool processing error:', error);
      return {
        content: `I encountered an error while processing your tool request: ${error.message}`,
        data: {
          source: 'tool-execution',
          error: error.message,
          type: 'error'
        }
      };
    }
  }

  /**
   * Process sandbox request
   */
  private async processSandboxRequest(request: RouterRequest): Promise<any> {
    if (!request.userId) {
      return {
        content: 'User authentication required for sandbox access',
        data: {
          source: 'sandbox-agent',
          requiresAuth: true,
          error: 'User ID not provided'
        }
      };
    }

    try {
      const session = await sandboxBridge.getOrCreateSession(request.userId);
      
      const lastUserMessage = request.messages
        .filter(m => m.role === 'user')
        .pop()?.content;

      if (!lastUserMessage || typeof lastUserMessage !== 'string') {
        return {
          content: 'No user message found to process',
          data: {
            source: 'sandbox-agent',
            error: 'No message content'
          }
        };
      }

      // Use the agent loop (LLM-driven tool calling), NOT raw command execution
      try {
        const { runAgentLoop } = await import('../sandbox/agent-loop');
        const result = await runAgentLoop({
          userMessage: lastUserMessage,
          sandboxId: session.sandboxId,
          conversationHistory: request.messages,
        });

        return {
          content: result.response,
          data: {
            source: 'sandbox-agent',
            sandboxId: session.sandboxId,
            steps: result.steps,
            totalSteps: result.totalSteps,
            type: 'sandbox_execution'
          }
        };
      } catch (agentError: any) {
        // If the agent loop module is not available, fall back to informing the user
        console.warn('[Router] Sandbox agent loop not available:', agentError.message);
        return {
          content: 'The sandbox code execution module is not configured. Please set SANDBOX_PROVIDER and install the required SDK.',
          data: {
            source: 'sandbox-agent',
            error: 'sandbox_not_configured',
            type: 'error'
          }
        };
      }
    } catch (error: any) {
      console.error('[Router] Sandbox processing error:', error);
      return {
        content: `I encountered an error while executing in the sandbox: ${error.message}`,
        data: {
          source: 'sandbox-agent',
          error: error.message,
          type: 'error'
        }
      };
    }
  }
}

// Export singleton instance
export const priorityRequestRouter = new PriorityRequestRouter();
