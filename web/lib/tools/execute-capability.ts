/**
 * Execute Capability Helper
 * 
 * Provides a simple interface to execute tool capabilities from any agent execution path.
 * This enables v1 API, streaming, and non-Mastra workflows to use the centralized tool system.
 * 
 * Usage:
 * import { executeToolCapability, initToolSystem } from '@/lib/tools';
 * 
 * // Initialize once at startup
 * await initToolSystem('user123');
 * 
 * // Execute capabilities from any agent
 * const result = await executeToolCapability('file.read', { path: 'src/index.ts' }, { userId: 'user123' });
 */

import { 
  bootstrapToolSystem,
  type BootstrapResult,
  type BootstrapConfig,
} from './bootstrap';
import { type CapabilityRouter } from './router';
import { createLogger } from '../utils/logger';

const log = createLogger('execute-capability');

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
      initialized: true 
    };
  }
  
  if (!initPromise) {
    initPromise = bootstrapToolSystem(config || {
      userId: 'system',
      enableMCP: true,
      enableComposio: false,
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
 */
export async function executeToolCapability(
  capabilityId: string,
  params: Record<string, unknown>,
  context?: { userId?: string; sessionId?: string; workspaceId?: string }
): Promise<{ success: boolean; output?: unknown; error?: string; exitCode: number }> {
  // Lazy initialization if not already done
  if (!initialized) {
    await initToolSystem();
  }
  
  if (!routerInstance) {
    return { success: false, error: 'Tool system not initialized', exitCode: 1 };
  }
  
  try {
    const result = await routerInstance.execute(capabilityId, params, context);
    
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
  return routerInstance.hasCapability(capabilityId);
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