/**
 * Unified Tool Registry
 *
 * Central registry for all tool providers.
 * Provides unified interface for tool discovery and execution.
 *
 * Features:
 * - Multi-provider support
 * - Automatic provider selection
 * - Fallback chain execution
 * - Centralized error handling
 * - Tool discovery across providers
 */

import { z } from 'zod';
import type { ToolProvider, ProviderExecutionRequest, ToolExecutionResult, ToolExecutionContext } from '../tool-integration/types';
import { SmitheryProvider } from '../tool-integration/providers/smithery';
import { getArcadeService } from '../api/arcade-service';
import { getNangoService } from '../api/nango-service';
import { getTamboService } from '../tambo/tambo-service';
import { getToolManager } from '../tools';

export interface ToolInfo {
  name: string;
  description: string;
  provider: string;
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  requiresAuth: boolean;
  category?: string;
}

export interface UnifiedToolRegistryConfig {
  providers?: ToolProvider[];
  defaultProvider?: string;
  fallbackChain?: string[];
  enableDiscovery?: boolean;
}

/**
 * Unified Tool Registry Class
 */
export class UnifiedToolRegistry {
  private providers = new Map<string, ToolProvider>();
  private tools = new Map<string, ToolInfo>();
  private config: UnifiedToolRegistryConfig;
  private initialized = false;

  constructor(config: UnifiedToolRegistryConfig = {}) {
    this.config = {
      defaultProvider: 'composio',
      fallbackChain: ['composio', 'arcade', 'nango', 'mcp', 'smithery', 'tambo'],
      enableDiscovery: true,
      ...config,
    };

    // Register configured providers
    if (config.providers) {
      for (const provider of config.providers) {
        this.registerProvider(provider);
      }
    }
  }

  /**
   * Initialize registry with all available providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Register Smithery if available
    const smitheryApiKey = process.env.SMITHERY_API_KEY;
    if (smitheryApiKey) {
      const smithery = new SmitheryProvider({ apiKey: smitheryApiKey });
      this.registerProvider(smithery);
    }

    // Register Arcade if available
    const arcadeService = getArcadeService();
    if (arcadeService) {
      this.registerProvider({
        name: 'arcade',
        isAvailable: () => true,
        supports: (request) => request.toolKey.startsWith('arcade:'),
        execute: async (request) => {
          const result = await arcadeService.executeTool(
            request.toolKey.replace('arcade:', ''),
            request.input,
            request.context.userId
          );
          return {
            success: result.success,
            output: result.output,
            error: result.error,
            authRequired: result.requiresAuth,
            authUrl: result.authUrl,
          };
        },
      });
    }

    // Register Nango if available
    const nangoService = getNangoService();
    if (nangoService) {
      this.registerProvider({
        name: 'nango',
        isAvailable: () => true,
        supports: (request) => request.toolKey.startsWith('nango:'),
        execute: async (request) => {
          const [providerConfigKey, ...endpointParts] = request.toolKey.replace('nango:', '').split(':');
          const endpoint = endpointParts.join(':');
          
          const result = await nangoService.executeTool(
            providerConfigKey,
            endpoint,
            request.input,
            request.context.userId
          );
          return {
            success: result.success,
            output: result.output,
            error: result.error,
            authRequired: result.requiresAuth,
            authUrl: result.authUrl,
          };
        },
      });
    }

    // Register Tambo if available
    const tamboService = getTamboService();
    if (tamboService) {
      this.registerProvider({
        name: 'tambo',
        isAvailable: () => true,
        supports: (request) => request.toolKey.startsWith('tambo:'),
        execute: async (request) => {
          const result = await tamboService.executeTool(
            request.context.userId,
            request.toolKey.replace('tambo:', ''),
            request.input
          );
          return {
            success: result.success,
            output: result.output,
            error: result.error,
          };
        },
      });
    }

    // Register MCP if available
    this.registerProvider({
      name: 'mcp',
      isAvailable: () => true,
      supports: (request) => request.toolKey.startsWith('mcp:'),
      execute: async (request) => {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          request.toolKey.replace('mcp:', ''),
          request.input,
          request.context
        );
        return result;
      },
    });

    // Register Composio if available
    this.registerProvider({
      name: 'composio',
      isAvailable: () => true,
      supports: () => true, // Composio is default fallback
      execute: async (request) => {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          request.toolKey,
          request.input,
          request.context
        );
        return result;
      },
    });

    this.initialized = true;
    console.log(`[UnifiedToolRegistry] Initialized with ${this.providers.size} providers`);
  }

  /**
   * Register a provider
   */
  registerProvider(provider: ToolProvider): void {
    this.providers.set(provider.name, provider);
    console.log(`[UnifiedToolRegistry] Registered provider: ${provider.name}`);
  }

  /**
   * Unregister a provider
   */
  unregisterProvider(providerName: string): void {
    this.providers.delete(providerName);
  }

  /**
   * Register a tool
   */
  registerTool(tool: ToolInfo): void {
    this.tools.set(`${tool.provider}:${tool.name}`, tool);
  }

  /**
   * Execute a tool
   */
  async executeTool(
    toolName: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    await this.initialize();

    const request: ProviderExecutionRequest = {
      toolKey: toolName,
      config: {
        provider: this.extractProvider(toolName),
        toolName: this.extractToolName(toolName),
        description: '',
        category: '',
        requiresAuth: false,
      },
      input,
      context,
    };

    // Try providers in fallback chain order
    const fallbackChain = this.config.fallbackChain || [];
    const errors: string[] = [];

    for (const providerName of fallbackChain) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.isAvailable()) {
        continue;
      }

      if (!provider.supports(request)) {
        continue;
      }

      try {
        const result = await provider.execute(request);
        if (result.success) {
          return result;
        }

        if (result.error) {
          errors.push(`${providerName}: ${result.error}`);
        }

        // If auth required, return immediately
        if (result.authRequired) {
          return result;
        }
      } catch (error: any) {
        errors.push(`${providerName}: ${error.message}`);
      }
    }

    // All providers failed
    return {
      success: false,
      error: errors.length > 0 ? errors.join('; ') : 'No provider could execute this tool',
    };
  }

  /**
   * Search for tools
   */
  async searchTools(query: string, userId?: string): Promise<ToolInfo[]> {
    await this.initialize();

    const results: ToolInfo[] = [];
    const queryLower = query.toLowerCase();

    // Search cached tools
    for (const tool of this.tools.values()) {
      if (
        tool.name.toLowerCase().includes(queryLower) ||
        tool.description.toLowerCase().includes(queryLower)
      ) {
        results.push(tool);
      }
    }

    // Search provider-specific tools
    for (const [providerName, provider] of this.providers.entries()) {
      try {
        if (providerName === 'smithery') {
          const smithery = provider as SmitheryProvider;
          const tools = await smithery.discoverAllTools();
          for (const tool of tools) {
            if (
              tool.name.toLowerCase().includes(queryLower) ||
              tool.description.toLowerCase().includes(queryLower)
            ) {
              results.push({
                name: tool.name,
                description: tool.description,
                provider: providerName,
                inputSchema: z.object(tool.inputSchema as any),
                requiresAuth: false,
              });
            }
          }
        } else if (providerName === 'arcade') {
          const arcadeService = getArcadeService();
          if (arcadeService) {
            const arcadeTools = await arcadeService.searchTools(query);
            for (const tool of arcadeTools) {
              results.push({
                name: tool.name,
                description: tool.description,
                provider: providerName,
                inputSchema: z.object(tool.inputSchema as any),
                requiresAuth: tool.requiresAuth,
                category: tool.toolkit,
              });
            }
          }
        }
      } catch (error: any) {
        console.error(`[UnifiedToolRegistry] searchTools failed for ${providerName}:`, error.message);
      }
    }

    return results;
  }

  /**
   * Get available tools
   */
  async getAvailableTools(userId?: string): Promise<ToolInfo[]> {
    await this.initialize();

    const results: ToolInfo[] = [];

    for (const [providerName, provider] of this.providers.entries()) {
      try {
        if (providerName === 'arcade') {
          const arcadeService = getArcadeService();
          if (arcadeService) {
            const arcadeTools = await arcadeService.getTools();
            for (const tool of arcadeTools) {
              results.push({
                name: tool.name,
                description: tool.description,
                provider: providerName,
                inputSchema: z.object(tool.inputSchema as any),
                requiresAuth: tool.requiresAuth,
                category: tool.toolkit,
              });
            }
          }
        }
      } catch (error: any) {
        console.error(`[UnifiedToolRegistry] getAvailableTools failed for ${providerName}:`, error.message);
      }
    }

    // Add cached tools
    for (const tool of this.tools.values()) {
      results.push(tool);
    }

    return results;
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName: string): z.ZodSchema | undefined {
    const key = toolName.includes(':') ? toolName : `composio:${toolName}`;
    const tool = this.tools.get(key);
    return tool?.inputSchema;
  }

  /**
   * Extract provider from tool name
   */
  private extractProvider(toolName: string): string {
    if (toolName.includes(':')) {
      return toolName.split(':')[0];
    }
    return this.config.defaultProvider || 'composio';
  }

  /**
   * Extract tool name from qualified name
   */
  private extractToolName(toolName: string): string {
    if (toolName.includes(':')) {
      return toolName.split(':').slice(1).join(':');
    }
    return toolName;
  }

  /**
   * Get registered providers
   */
  getProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    providersCount: number;
    toolsCount: number;
  } {
    return {
      initialized: this.initialized,
      providersCount: this.providers.size,
      toolsCount: this.tools.size,
    };
  }
}

/**
 * Singleton instance
 */
let unifiedToolRegistryInstance: UnifiedToolRegistry | null = null;

/**
 * Get or create unified tool registry instance
 */
export function getUnifiedToolRegistry(): UnifiedToolRegistry {
  if (!unifiedToolRegistryInstance) {
    unifiedToolRegistryInstance = new UnifiedToolRegistry();
  }
  return unifiedToolRegistryInstance;
}

/**
 * Initialize unified tool registry
 */
export function initializeUnifiedToolRegistry(config?: UnifiedToolRegistryConfig): UnifiedToolRegistry {
  if (unifiedToolRegistryInstance) {
    return unifiedToolRegistryInstance;
  }

  unifiedToolRegistryInstance = new UnifiedToolRegistry(config);
  return unifiedToolRegistryInstance;
}
