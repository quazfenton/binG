/**
 * Execute Capability Helper
 *
 * Provides a simple interface to execute tool capabilities from any agent execution path.
 * This enables v1 API, streaming, and non-Mastra workflows to use the centralized tool system.
 *
 * Usage:
 * import { executeToolCapability, initToolSystem, invalidateToolCache } from '@/lib/tools';
 *
 * // Initialize once at startup
 * await initToolSystem('user123');
 *
 * // Execute capabilities from any agent
 * const result = await executeToolCapability('file.read', { path: 'src/index.ts' }, { userId: 'user123' });
 *
 * // Invalidate cache when files change
 * invalidateToolCache('file.read', '/workspace/src/index.ts')
 */

import {
  bootstrapToolSystem,
  type BootstrapResult,
  type BootstrapConfig,
} from './bootstrap';
import { type CapabilityRouter } from './router';
import { createLogger } from '../utils/logger';
import { toolResultCache, toolCacheKey, Cache } from '../cache';

// Export Cache for external use
export { Cache };

const log = createLogger('execute-capability');

// ============================================================================
// Idempotent capabilities that can be cached
// ============================================================================

const IDEMPOTENT_CAPABILITIES = new Set([
  'file.read',
  'file.list',
  'file.search',
  'workspace.getChanges',
  'memory.context',
  'sandbox.info',
  'terminal.status',
]);

function isIdempotentCapability(capabilityId: string): boolean {
  return IDEMPOTENT_CAPABILITIES.has(capabilityId);
}

function generateToolCacheKey(capabilityId: string, params: Record<string, unknown>): string {
  switch (capabilityId) {
    case 'file.read':
      return toolCacheKey.fileRead(params.path as string, params.hash as string | undefined);
    case 'file.list':
      return toolCacheKey.fileList(params.path as string);
    case 'file.search':
      return toolCacheKey.fileSearch(params.query as string, params.path as string | undefined);
    case 'sandbox.info':
      return toolCacheKey.sandboxInfo(params.sandboxId as string);
    default:
      return `${capabilityId}:${JSON.stringify(params)}`;
  }
}

// Singleton state
let initialized = false;
let initPromise: Promise<BootstrapResult> | null = null;
let routerInstance: CapabilityRouter | null = null;
let toolCount = 0;
let capabilityCount = 0;

/**
 * Initialize the tool system - call once at startup
 * This ensures all execution paths have access to the same tool capabilities
 */
export async function initToolSystem(config?: BootstrapConfig): Promise<BootstrapResult> {
  if (initialized && routerInstance) {
    return {
      registry: {} as any,
      router: routerInstance,
      toolCount,
      capabilityCount,
      errors: [],
    };
  }
  
  if (!initPromise) {
    initPromise = bootstrapToolSystem(config || {
      userId: 'system',
      enableMCP: true,
      enableComposio: true,
      enableSandbox: true,
      enableNullclaw: false,
      enableOAuth: true,
    });
  }
  
  const result = await initPromise;
  routerInstance = result.router;
  toolCount = result.toolCount;
  capabilityCount = result.capabilityCount;
  initialized = true;
  
  log.info('Tool system initialized for capability execution', { 
    toolCount, 
    capabilityCount 
  });
  
  return result;
}

/**
 * Execute a tool capability with automatic provider selection
 * Main entry point for all agent types (v1, streaming, v2, non-Mastra)
 *
 * @param capabilityId - Semantic capability ID (e.g., 'file.read', 'sandbox.execute')
 * @param params - Parameters for the capability
 * @param context - Execution context (userId, sessionId, workspaceId)
 * @param options - Additional options (skipCache, ttl)
 */
export async function executeToolCapability(
  capabilityId: string,
  params: Record<string, unknown>,
  context?: { userId?: string; sessionId?: string; workspaceId?: string; scopePath?: string },
  options?: { skipCache?: boolean; ttl?: number }
): Promise<{ success: boolean; output?: unknown; error?: string; exitCode: number }> {
  // Lazy initialization if not already done
  if (!initialized) {
    await initToolSystem();
  }

  if (!routerInstance) {
    return { success: false, error: 'Tool system not initialized', exitCode: 1 };
  }

  // Check cache for idempotent capabilities
  const cacheKey = generateToolCacheKey(capabilityId, params);
  if (!options?.skipCache && isIdempotentCapability(capabilityId)) {
    const cached = toolResultCache.get(cacheKey);
    if (cached) {
      log.debug(`Cache hit for ${capabilityId}`);
      return {
        success: true,
        output: cached,
        exitCode: 0,
      };
    }
  }

  try {
    const result = await routerInstance.execute(capabilityId, params, context as any);

    // Cache successful results for idempotent capabilities
    if (!options?.skipCache && isIdempotentCapability(capabilityId)) {
      toolResultCache.set(cacheKey, result, options?.ttl);
    }

    return {
      success: true,
      output: result,
      exitCode: 0,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('Capability execution failed', { capability: capabilityId, error: errorMsg });
    return {
      success: false,
      error: errorMsg,
      exitCode: 1,
    };
  }
}

/**
 * Check if a capability is available
 */
export function hasToolCapability(capabilityId: string): boolean {
  if (!routerInstance) return false;
  return (routerInstance as any).hasCapability(capabilityId);
}

/**
 * Get the router instance for advanced usage
 */
export function getToolRouter(): CapabilityRouter | null {
  return routerInstance;
}

/**
 * Check if tool system is initialized
 */
export function isToolSystemReady(): boolean {
  return initialized && routerInstance !== null;
}

/**
 * Invalidate tool cache entries
 * Call this when the underlying data changes (e.g., file write, delete)
 *
 * @param capabilityId - Specific capability to invalidate, or '*' for all
 * @param path - Optional path prefix to match
 */
export function invalidateToolCache(capabilityId: string, path?: string): void {
  if (capabilityId === '*') {
    toolResultCache.clear()
    log.info('Tool cache cleared entirely')
    return
  }

  if (path) {
    // Invalidate specific path
    const key = generateToolCacheKey(capabilityId, { path } as Record<string, unknown>)
    toolResultCache.delete(key)

    // Also invalidate file.list for directory containing path
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir) {
      const listKey = toolCacheKey.fileList(dir)
      toolResultCache.delete(listKey)
    }
    log.debug(`Invalidated cache for ${capabilityId}:${path}`)
  } else {
    // Invalidate all entries for this capability type
    const prefix = `${capabilityId}:`
    for (const key of toolResultCache.getKeys()) {
      if (key.startsWith(prefix)) {
        toolResultCache.delete(key)
      }
    }
    log.debug(`Invalidated all cache for ${capabilityId}`)
  }
}

/**
 * Get tool cache statistics
 */
export function getToolCacheStats(): { size: number; maxSize: number } {
  return toolResultCache.getStats()
}