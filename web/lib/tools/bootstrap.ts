/**
 * Tool System Bootstrap
 *
 * Auto-registers all tools from providers at runtime:
 * - MCP servers
 * - Composio toolkits
 * - Sandbox providers (E2B, Daytona, etc.)
 * - Nullclaw automation
 * - OAuth integration
 *
 * @example
 * ```typescript
 * import { bootstrapToolSystem } from '@/lib/tools/bootstrap';
 *
 * const { registry, router } = await bootstrapToolSystem({
 *   userId: 'user_123',
 *   workspace: '/workspace',
 *   permissions: ['file:read', 'file:write', 'sandbox:execute'],
 * });
 *
 * // Use the router to execute capabilities
 * const result = await router.execute('file.read', { path: 'src/index.ts' }, context);
 * ```
 */

import { ToolRegistry } from './registry';
import { getCapabilityRouter, type CapabilityRouter } from './router';
import { createLogger } from '../utils/logger';

const logger = createLogger('Tools:Bootstrap');

/**
 * Bootstrap configuration
 */
export interface BootstrapConfig {
  /** User ID for permission checking */
  userId: string;
  /** Workspace path */
  workspace?: string;
  /** User permissions */
  permissions?: string[];
  /** Enable MCP tool auto-discovery */
  enableMCP?: boolean;
  /** Enable Composio toolkits (auto-enabled if API key is set) */
  enableComposio?: boolean;
  /** Enable Arcade tools (auto-enabled if API key is set) */
  enableArcade?: boolean;
  /** Enable sandbox providers */
  enableSandbox?: boolean;
  /** Enable Nullclaw automation */
  enableNullclaw?: boolean;
  /** Enable OAuth integration */
  enableOAuth?: boolean;
}

/**
 * Bootstrap result
 */
export interface BootstrapResult {
  /** Tool registry instance */
  registry: ToolRegistry;
  /** Capability router instance */
  router: CapabilityRouter;
  /** Registered tool count */
  toolCount: number;
  /** Registered capabilities count */
  capabilityCount: number;
  /** Any errors during bootstrap */
  errors: string[];
}

/**
 * Bootstrap the tool system
 *
 * @param config - Bootstrap configuration
 * @returns Bootstrap result with registry and router
 */
export async function bootstrapToolSystem(config: BootstrapConfig): Promise<BootstrapResult> {
  const errors: string[] = [];
  let toolCount = 0;
  let capabilityCount = 0;

  // Auto-enable Composio if API key is set
  const shouldEnableComposio = config.enableComposio !== false && !!process.env.COMPOSIO_API_KEY;
  // Auto-enable Arcade if API key is set
  const shouldEnableArcade = config.enableArcade !== false && !!process.env.ARCADE_API_KEY;

  logger.info('Starting tool system bootstrap', {
    userId: config.userId,
    enableMCP: config.enableMCP,
    enableComposio: shouldEnableComposio,
    enableArcade: shouldEnableArcade,
    enableSandbox: config.enableSandbox,
    enableNullclaw: config.enableNullclaw,
    enableOAuth: config.enableOAuth,
  });

  // Get or create registry
  const registry = ToolRegistry.getInstance();

  // Register built-in capabilities (always enabled)
  try {
    const { registerBuiltInCapabilities } = await import('./bootstrap/bootstrap-builtins');
    const count = await registerBuiltInCapabilities(registry);
    capabilityCount += count;
    logger.info(`Registered ${count} built-in capabilities`);
  } catch (error: any) {
    logger.error('Failed to register built-in capabilities', error);
    errors.push(`Built-in capabilities: ${error.message}`);
  }

  // Register MCP tools (if enabled)
  if (config.enableMCP !== false) {
    try {
      const { registerMCPTools } = await import('./bootstrap/bootstrap-mcp');
      const count = await registerMCPTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} MCP tools`);
    } catch (error: any) {
      logger.warn('MCP tools not available', error.message);
      errors.push(`MCP tools: ${error.message}`);
    }
  }

  // Register Composio tools (auto-enabled if API key is set)
  if (shouldEnableComposio) {
    try {
      const { registerComposioTools } = await import('./bootstrap/bootstrap-composio');
      const count = await registerComposioTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} Composio tools`);
    } catch (error: any) {
      logger.warn('Composio tools not available', error.message);
      errors.push(`Composio tools: ${error.message}`);
    }
  }

  // Register Tauri invoke tools (desktop mode only)
  try {
    const { registerTauriTools } = await import('./bootstrap/bootstrap-tauri');
    const count = await registerTauriTools(registry);
    if (count > 0) {
      toolCount += count;
      logger.info(`Registered ${count} Tauri invoke tools`);
    }
  } catch (error: any) {
    logger.debug('Tauri invoke tools not available (expected in web mode)', error.message);
  }

  // Register sandbox tools (if enabled)
  if (config.enableSandbox !== false) {
    try {
      const { registerSandboxTools } = await import('./bootstrap/bootstrap-sandbox');
      const count = await registerSandboxTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} sandbox tools`);
    } catch (error: any) {
      logger.warn('Sandbox tools not available', error.message);
      errors.push(`Sandbox tools: ${error.message}`);
    }
  }

  // Register Nullclaw tools (if enabled)
  if (config.enableNullclaw) {
    try {
      const { registerNullclawTools } = await import('./bootstrap/bootstrap-nullclaw');
      const count = await registerNullclawTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} Nullclaw tools`);
    } catch (error: any) {
      logger.warn('Nullclaw tools not available', error.message);
      errors.push(`Nullclaw tools: ${error.message}`);
    }
  }

  // Register OAuth integration (if enabled)
  if (config.enableOAuth !== false) {
    try {
      const { registerOAuthTools } = await import('./bootstrap/bootstrap-oauth');
      const count = await registerOAuthTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} OAuth integration tools`);
    } catch (error: any) {
      logger.warn('OAuth tools not available', error.message);
      errors.push(`OAuth tools: ${error.message}`);
    }
  }

  // Register Event System tools (task.schedule, task.status, task.cancel)
  // These provide background task scheduling via trigger.dev patterns
  try {
    const { registerEventTools } = await import('./bootstrap/bootstrap-events');
    const count = await registerEventTools(registry, config);
    toolCount += count;
    logger.info(`Registered ${count} event system tools`);
  } catch (error: any) {
    logger.warn('Event system tools not available', error.message);
    errors.push(`Event system: ${error.message}`);
  }

  // Register Arcade tools (auto-enabled if API key is set)
  if (shouldEnableArcade) {
    try {
      const { registerArcadeTools } = await import('./bootstrap/bootstrap-arcade');
      const count = await registerArcadeTools(registry, config);
      toolCount += count;
      logger.info(`Registered ${count} Arcade tools`);
    } catch (error: any) {
      logger.warn('Arcade tools not available', error.message);
      errors.push(`Arcade tools: ${error.message}`);
    }
  }

  // Register MCP Gateway tools (if configured)
  if (process.env.MCP_GATEWAY_URL) {
    try {
      const { registerGatewayTools } = await import('./bootstrap-gateway');
      const count = await registerGatewayTools();
      if (count > 0) {
        toolCount += count;
        logger.info(`Registered ${count} MCP gateway tools`);
      }
    } catch (error: any) {
      logger.warn('MCP gateway tools not available', error.message);
      errors.push(`MCP gateway: ${error.message}`);
    }
  }

  // Get router instance (auto-registers built-in providers)
  const router = getCapabilityRouter();

  // Log summary
  const totalRegistrations = toolCount + capabilityCount;
  logger.info(`Tool system bootstrap complete: ${totalRegistrations} registrations (${capabilityCount} capabilities, ${toolCount} tools)`);

  if (errors.length > 0) {
    logger.warn(`Bootstrap completed with ${errors.length} errors`, errors);
  }

  return {
    registry,
    router,
    toolCount,
    capabilityCount,
    errors,
  };
}

/**
 * Quick bootstrap with default settings
 *
 * @param userId - User ID
 * @returns Bootstrap result
 */
export async function quickBootstrap(userId: string): Promise<BootstrapResult> {
  return bootstrapToolSystem({
    userId,
    enableMCP: true,
    enableComposio: true,  // Auto-enabled if API key is set
    enableArcade: true,    // Auto-enabled if API key is set
    enableSandbox: true,
    enableNullclaw: false,  // Disabled by default
    enableOAuth: true,
  });
}

/**
 * Get registered tools summary
 *
 * @returns Summary of registered tools and capabilities
 */
export async function getToolsSummary(): Promise<{
  capabilities: string[];
  tools: Array<{ name: string; capability: string; provider: string }>;
  providers: string[];
}> {
  const registry = ToolRegistry.getInstance();
  const router = getCapabilityRouter();

  // Get all capabilities
  const { ALL_CAPABILITIES } = await import('./capabilities');
  const capabilities = ALL_CAPABILITIES.map(c => c.id);

  // Get registered tools from registry
  const tools = registry.getAllTools().map(t => ({
    name: t.name,
    capability: t.capability,
    provider: t.provider,
  }));

  // Get providers from router
  await router.initialize();
  const providers = Array.from((router as any).providers.keys()) as string[];

  return {
    capabilities,
    tools,
    providers,
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a single tool
 *
 * @example
 * ```typescript
 * import { registerTool } from '@/lib/tools/bootstrap';
 *
 * await registerTool({
 *   name: 'filesystem.read_file',
 *   capability: 'file.read',
 *   provider: 'mcp',
 *   handler: async (args) => { ... },
 *   metadata: {
 *     latency: 'low',
 *     cost: 'low',
 *     reliability: 0.99,
 *   },
 *   permissions: ['file:read'],
 * });
 * ```
 */
export async function registerTool(tool: {
  name: string;
  capability: string;
  provider: string;
  handler: (args: any, context: any) => Promise<any>;
  metadata?: {
    latency?: 'low' | 'medium' | 'high';
    cost?: 'low' | 'medium' | 'high';
    reliability?: number;
    tags?: string[];
  };
  permissions?: string[];
}): Promise<void> {
  const registry = ToolRegistry.getInstance();
  await registry.registerTool(tool);
}

/**
 * Register multiple tools at once
 *
 * @example
 * ```typescript
 * import { registerTools } from '@/lib/tools/bootstrap';
 *
 * await registerTools([
 *   { name: 'file.read', capability: 'file.read', provider: 'vfs', handler: ... },
 *   { name: 'file.write', capability: 'file.write', provider: 'vfs', handler: ... },
 * ]);
 * ```
 */
export async function registerTools(tools: Array<{
  name: string;
  capability: string;
  provider: string;
  handler: (args: any, context: any) => Promise<any>;
  metadata?: {
    latency?: 'low' | 'medium' | 'high';
    cost?: 'low' | 'medium' | 'high';
    reliability?: number;
    tags?: string[];
  };
  permissions?: string[];
}>): Promise<void> {
  const registry = ToolRegistry.getInstance();
  for (const tool of tools) {
    await registry.registerTool(tool);
  }
}

/**
 * Unregister a tool
 *
 * @param toolName - Tool name to unregister
 */
export async function unregisterTool(toolName: string): Promise<void> {
  const registry = ToolRegistry.getInstance();
  await registry.unregisterTool(toolName);
}

/**
 * Clear all registered tools (useful for testing)
 */
export async function clearAllTools(): Promise<void> {
  const registry = ToolRegistry.getInstance();
  await registry.clearAllTools();
}
