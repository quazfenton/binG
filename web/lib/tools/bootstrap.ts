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
import { logToolCount } from './bootstrap-health';

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

  // Phase 5 (CAS): Initialize content-addressable storage early
  // Ensures the local cache directory and file_content_blobs table exist
  // before any VFS operations trigger lazy initialization.
  try {
    const { getContentAddressableStorage } = await import('../storage/content-addressable-storage');
    await getContentAddressableStorage().initialize();
    logger.info('Content-addressable storage initialized (Phase 5 CAS)');
  } catch (error: any) {
    logger.warn('Content-addressable storage initialization deferred', error.message);
    errors.push(`CAS: ${error.message}`);
  }

  // Phase 8 (Runtime Broker): Initialize the cost/latency/capacity-aware scheduler
  // This replaces static execution policies with dynamic provider selection.
  try {
    const { getRuntimeBroker } = await import('../sandbox/runtime-broker');
    await getRuntimeBroker().initialize();
    logger.info('Runtime Broker initialized (Phase 8)');
  } catch (error: any) {
    logger.warn('Runtime Broker initialization deferred', error.message);
    errors.push(`RuntimeBroker: ${error.message}`);
  }

  // Phase 7 (Workspace Images): Initialize workspace image synthesis
  // Pre-builds cached images from dependency lockfiles for instant warm starts.
  try {
    const { workspaceImageRegistry } = await import('../sandbox/workspace-image-registry');
    logger.info('Workspace Image Registry initialized (Phase 7)', {
      enabled: workspaceImageRegistry.isEnabled(),
    });
  } catch (error: any) {
    logger.warn('Workspace Image Registry initialization deferred', error.message);
    errors.push(`WorkspaceImages: ${error.message}`);
  }

  // Phase 6 (Workspace Affinity): Initialize workspace-to-provider binding
  // The SandboxOrchestrator constructor starts the affinity cleanup loop.
  // This import ensures the singleton is created and the cleanup timer is running.
  try {
    const { sandboxOrchestrator } = await import('../sandbox/sandbox-orchestrator');
    const config = sandboxOrchestrator.getAffinityConfig();
    logger.info('Workspace Affinity initialized (Phase 6)', {
      enabled: config.enabled,
      ttlMs: config.ttlMs,
    });
  } catch (error: any) {
    logger.warn('Workspace Affinity initialization deferred', error.message);
    errors.push(`Affinity: ${error.message}`);
  }

  // Phase 9 (WorkspaceFS): Initialize unified R2 + VFS + sandbox sync layer
  // Provides durable cloud backup, conflict resolution, and cross-provider migration.
  try {
    const { workspaceFSSyncService } = await import('../sandbox/workspacefs-sync-service');
    const r2Status = workspaceFSSyncService.getR2Status();
    const config = workspaceFSSyncService.getConfig();
    logger.info('WorkspaceFS Sync initialized (Phase 9)', {
      enabled: config.enabled,
      r2Configured: r2Status.configured,
      r2Bucket: r2Status.bucket || 'none',
    });
  } catch (error: any) {
    logger.warn('WorkspaceFS Sync initialization deferred', error.message);
    errors.push(`WorkspaceFS: ${error.message}`);
  }

  // Phase ∞ (Unified Control Plane): Initialize the workspace lifecycle orchestrator
  // that wraps all 10 phases under a single create/bind/restore/destroy API.
  // This is the canonical entry point for workspace orchestration.
  try {
    const { workspaceControlPlane } = await import('../workspace/workspace-control-plane');
    const cpState = await workspaceControlPlane.initialize();
    logger.info('WorkspaceControlPlane initialized (all phases)', {
      activeWorkspaces: cpState.activeWorkspaces,
      affinityBindings: cpState.affinity.activeBindings,
      snapshots: cpState.snapshots.activeSnapshots,
    });
  } catch (error: any) {
    logger.warn('WorkspaceControlPlane initialization deferred', error.message);
    errors.push(`ControlPlane: ${error.message}`);
  }

  // Register workspace analysis tools (always enabled)
  try {
    const { registerProjectAnalysisTools } = await import('./bootstrap/bootstrap-project-analysis');
    const count = await registerProjectAnalysisTools(registry, config);
    capabilityCount += count;
    logger.info(`Registered ${count} workspace analysis tools/capabilities`);
  } catch (error: any) {
    logger.warn('Workspace analysis tools not available', error.message);
    errors.push(`Workspace analysis: ${error.message}`);
  }

  // Register workspace graph tools (always enabled — AI-native workspace state querying)
  try {
    const { registerWorkspaceGraphTools } = await import('./bootstrap/bootstrap-workspace-graph');
    const count = await registerWorkspaceGraphTools(registry, config);
    toolCount += count;
    logger.info(`Registered ${count} workspace graph tools`);
  } catch (error: any) {
    logger.warn('Workspace graph tools not available', error.message);
    errors.push(`Workspace graph: ${error.message}`);
  }

  // Register runtime broker tools (Phase 8 — dynamic provider scheduling)
  try {
    const { registerRuntimeBrokerTools } = await import('./bootstrap/bootstrap-runtime-broker');
    const count = await registerRuntimeBrokerTools(registry, config);
    toolCount += count;
    logger.info(`Registered ${count} runtime broker tools`);
  } catch (error: any) {
    logger.warn('Runtime broker tools not available', error.message);
    errors.push(`RuntimeBroker: ${error.message}`);
  }

  // Register MCP tools (if enabled)
  if (config.enableMCP !== false) {
    try {
      const { registerMCPTools } = await import('./bootstrap/bootstrap-mcp');
      const count = await registerMCPTools(registry, config);
      toolCount += count;
      logToolCount(logger, { registry: 'MCP', count });
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
      logToolCount(logger, { registry: 'Composio', count });
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

  // Register desktop automation tools (desktop mode only)
  try {
    const { registerDesktopAutomationTools } = await import('./bootstrap/bootstrap-desktop-automation');
    const count = await registerDesktopAutomationTools(registry);
    if (count > 0) {
      toolCount += count;
      logger.info(`Registered ${count} desktop automation tools`);
    }
  } catch (error: any) {
    logger.debug('Desktop automation tools not available (expected in web mode)', error.message);
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
      logToolCount(logger, { registry: 'OAuth', count });
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

  // Register advanced schedule tools (task.agent-loop, task.dag-run, task.skill-bootstrap)
  // These extend the basic event system with agent loop orchestration and DAG workflows
  try {
    const { registerAllScheduleTools } = await import('./bootstrap/schedule-bootstrap');
    const count = await registerAllScheduleTools(registry, config);
    toolCount += count;
    logger.info(`Registered ${count} advanced schedule tools`);
  } catch (error: any) {
    logger.debug('Advanced schedule tools not available', error.message);
  }

  // Register Arcade tools (auto-enabled if API key is set)
  if (shouldEnableArcade) {
    try {
      const { registerArcadeTools } = await import('./bootstrap/bootstrap-arcade');
      const count = await registerArcadeTools(registry, config);
      toolCount += count;
      logToolCount(logger, { registry: 'Arcade', count });
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
      toolCount += count;
      // Bug #12/#13/#24/#34: gateway configured but returned 0 tools → [WARN]
      logToolCount(logger, { registry: 'MCP gateway', count });
    } catch (error: any) {
      logger.warn('MCP gateway tools not available', error.message);
      errors.push(`MCP gateway: ${error.message}`);
    }
  }

  // Register Mem0 persistent memory tools (if configured).
  // Bug #12/#13/#24/#34: user explicitly listed Mem0 alongside Composio /
  // MCP-gateway / Arcade. When MEM0_API_KEY is unset OR the breaker is OPEN
  // we surface a [WARN] (not a [DEBUG]) so the degraded case is visible.
  try {
    const { registerMem0Tools } = await import('./bootstrap/bootstrap-mem0');
    const count = await registerMem0Tools(registry, config);
    toolCount += count;
  } catch (error: any) {
    logger.warn('Mem0 tools not available', error.message);
    errors.push(`Mem0: ${error.message}`);
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
