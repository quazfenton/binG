/**
 * Tool Registry
 *
 * Central registry for all tools and capabilities.
 * Supports dynamic tool registration at runtime.
 *
 * @example
 * ```typescript
 * import { ToolRegistry } from '@/lib/tools/registry';
 *
 * const registry = ToolRegistry.getInstance();
 *
 * await registry.registerTool({
 *   name: 'filesystem.read_file',
 *   capability: 'file.read',
 *   provider: 'mcp',
 *   handler: async (args) => { ... },
 *   metadata: { latency: 'low', cost: 'low', reliability: 0.99 },
 *   permissions: ['file:read'],
 * });
 * ```
 */

import { createLogger } from '../utils/logger';
import type { z } from 'zod';

const logger = createLogger('Tools:Registry');

/**
 * Tool info for backwards compatibility
 */
export interface ToolInfo {
  name: string;
  description: string;
  provider: string;
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  requiresAuth: boolean;
  category?: string;
}

/**
 * Tool definition for registry
 */
export interface RegisteredTool {
  name: string;
  capability: string;
  provider: string;
  handler: (args: any, context: any) => Promise<any>;
  inputSchema?: z.ZodSchema;  // For schema lookup
  outputSchema?: z.ZodSchema;
  metadata?: {
    latency?: 'low' | 'medium' | 'high';
    cost?: 'low' | 'medium' | 'high';
    reliability?: number;
    tags?: string[];
  };
  permissions?: string[];
}

/**
 * Tool Registry Class
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools = new Map<string, RegisteredTool>();
  private toolsByCapability = new Map<string, RegisteredTool[]>();

  /**
   * Get singleton instance
   */
  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a tool
   *
   * @param tool - Tool definition
   */
  async registerTool(tool: RegisteredTool): Promise<void> {
    // Register by name
    this.tools.set(tool.name, tool);

    // Register by capability
    const existingTools = this.toolsByCapability.get(tool.capability) || [];
    const existingIndex = existingTools.findIndex(t => t.name === tool.name);

    if (existingIndex >= 0) {
      // Update existing tool
      existingTools[existingIndex] = tool;
      logger.debug(`Updated tool: ${tool.name}`);
    } else {
      // Add new tool
      existingTools.push(tool);
      this.toolsByCapability.set(tool.capability, existingTools);
      logger.debug(`Registered tool: ${tool.name} → ${tool.capability}`);
    }
  }

  /**
   * Register a capability (alias for registerTool for backwards compatibility)
   *
   * @param capability - Capability definition
   */
  async registerCapability(capability: any): Promise<void> {
    // For capabilities, we just ensure they're available
    // The actual tools are registered separately
    logger.debug(`Registered capability: ${capability.id}`);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool definition or undefined
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools for a capability
   *
   * @param capability - Capability ID
   * @returns Array of tool definitions
   */
  getToolsForCapability(capability: string): RegisteredTool[] {
    return this.toolsByCapability.get(capability) || [];
  }

  /**
   * Get all registered tools
   *
   * @returns Array of all tool definitions
   */
  getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all capabilities
   *
   * @returns Array of capability IDs
   */
  getAllCapabilities(): string[] {
    return Array.from(this.toolsByCapability.keys());
  }

  /**
   * Get tool schema by name
   *
   * @param toolName - Tool name
   * @returns Input schema or undefined
   */
  getToolSchema(toolName: string): z.ZodSchema | undefined {
    const tool = this.tools.get(toolName);
    return tool?.inputSchema;
  }

  /**
   * Unregister a tool
   *
   * @param name - Tool name
   */
  async unregisterTool(name: string): Promise<void> {
    const tool = this.tools.get(name);
    if (!tool) {
      logger.warn(`Tool not found: ${name}`);
      return;
    }

    // Remove from name index
    this.tools.delete(name);

    // Remove from capability index
    const tools = this.toolsByCapability.get(tool.capability) || [];
    const filtered = tools.filter(t => t.name !== name);

    if (filtered.length === 0) {
      this.toolsByCapability.delete(tool.capability);
    } else {
      this.toolsByCapability.set(tool.capability, filtered);
    }

    logger.debug(`Unregistered tool: ${name}`);
  }

  /**
   * Clear all registered tools
   */
  async clearAllTools(): Promise<void> {
    this.tools.clear();
    this.toolsByCapability.clear();
    logger.info('Cleared all tools');
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    totalCapabilities: number;
    toolsByProvider: Record<string, number>;
  } {
    const toolsByProvider: Record<string, number> = {};

    for (const tool of this.tools.values()) {
      toolsByProvider[tool.provider] = (toolsByProvider[tool.provider] || 0) + 1;
    }

    return {
      totalTools: this.tools.size,
      totalCapabilities: this.toolsByCapability.size,
      toolsByProvider,
    };
  }
}

// ============================================================================
// BACKWARDS COMPATIBILITY
// ============================================================================

/**
 * Unified Tool Registry (Backwards Compatibility)
 *
 * @deprecated Use ToolIntegrationManager (getToolManager()) instead
 * This class wraps ToolIntegrationManager for backwards compatibility.
 * 
 * NOTE: The provider registration and fallback chain execution logic
 * is preserved in lib/tools/tool-integration/ and used by ToolIntegrationManager.
 */
export class UnifiedToolRegistry {
  private toolManager: any;
  private config: UnifiedToolRegistryConfig;
  private initialized = false;

  constructor(config: UnifiedToolRegistryConfig = {}) {
    this.config = {
      defaultProvider: 'composio',
      fallbackChain: ['composio', 'arcade', 'nango', 'mcp', 'smithery', 'tambo'],
      enableDiscovery: true,
      ...config,
    };
  }

  /**
   * Initialize registry - delegates to ToolIntegrationManager
   * @deprecated Use getToolManager() instead
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Lazy import to avoid circular dependency
    const { getToolManager } = await import('./index');
    this.toolManager = getToolManager();
    this.initialized = true;
  }

  /**
   * Register a provider - no-op (providers registered by ToolIntegrationManager)
   * @deprecated Providers are auto-registered by bootstrap system
   */
  registerProvider(_provider: any): void {
    // Providers are now auto-registered by bootstrap system
  }

  /**
   * Unregister a provider - no-op
   * @deprecated Providers are managed by bootstrap system
   */
  unregisterProvider(_providerName: string): void {
    // No-op
  }

  /**
   * Register a tool - delegates to ToolRegistry
   */
  registerTool(tool: ToolInfo): void {
    const registry = ToolRegistry.getInstance();
    registry.registerTool({
      name: tool.name,
      capability: tool.category || 'unknown',
      provider: tool.provider,
      handler: async () => {
        throw new Error('Tool registered via UnifiedToolRegistry cannot be executed directly');
      },
    });
  }

  /**
   * Execute a tool - delegates to ToolIntegrationManager
   * @deprecated Use getToolManager().executeTool() instead
   */
  async executeTool(
    toolName: string,
    input: any,
    context: any
  ): Promise<any> {
    await this.initialize();

    if (!this.toolManager) {
      return {
        success: false,
        error: 'ToolManager not initialized',
      };
    }

    return await this.toolManager.executeTool(toolName, input, context);
  }

  /**
   * Search for tools - delegates to ToolIntegrationManager with dynamic discovery
   * @deprecated Use getToolManager().searchTools() instead
   */
  async searchTools(query: string, userId?: string): Promise<ToolInfo[]> {
    await this.initialize();

    if (!this.toolManager) {
      return [];
    }

    const tools = await this.toolManager.searchTools(query, userId);
    return tools.map(t => ({
      name: t.toolName || t.name,
      description: t.description || '',
      provider: t.provider || 'unknown',
      requiresAuth: false,
      category: t.category,
    }));
  }

  /**
   * Get available tools - delegates to ToolIntegrationManager with dynamic discovery
   * @deprecated Use getToolManager().getAllTools() instead
   */
  async getAvailableTools(userId?: string): Promise<ToolInfo[]> {
    await this.initialize();

    if (!this.toolManager) {
      return [];
    }

    const tools = await this.toolManager.getAllTools(userId);
    return tools.map(t => ({
      name: t.toolName || t.name,
      description: t.description || '',
      provider: t.provider || 'unknown',
      requiresAuth: false,
      category: t.category,
    }));
  }

  /**
   * Get tool schema - delegates to ToolRegistry
   */
  getToolSchema(toolName: string): any {
    const registry = ToolRegistry.getInstance();
    return registry.getToolSchema(toolName);
  }

  /**
   * Get registered providers
   */
  getProviders(): string[] {
    if (!this.toolManager) {
      return [];
    }
    // Get providers from tool manager
    return Object.keys(this.toolManager.providers || {});
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    providersCount: number;
    toolsCount: number;
  } {
    const registry = ToolRegistry.getInstance();
    const stats = registry.getStats();

    return {
      initialized: this.initialized,
      providersCount: stats.toolsByProvider ? Object.keys(stats.toolsByProvider).length : 0,
      toolsCount: stats.totalTools,
    };
  }
}

let unifiedToolRegistryInstance: UnifiedToolRegistry | null = null;

export function getUnifiedToolRegistry(): UnifiedToolRegistry {
  if (!unifiedToolRegistryInstance) {
    unifiedToolRegistryInstance = new UnifiedToolRegistry();
  }
  return unifiedToolRegistryInstance;
}

export function initializeUnifiedToolRegistry(config?: UnifiedToolRegistryConfig): UnifiedToolRegistry {
  if (!unifiedToolRegistryInstance) {
    unifiedToolRegistryInstance = new UnifiedToolRegistry(config);
  }
  return unifiedToolRegistryInstance;
}

export interface UnifiedToolRegistryConfig {
  providers?: any[];
  defaultProvider?: string;
  fallbackChain?: string[];
  enableDiscovery?: boolean;
}

/**
 * Get tool registry instance (alias for ToolRegistry.getInstance())
 */
export function getToolRegistry(): ToolRegistry {
  return ToolRegistry.getInstance();
}
