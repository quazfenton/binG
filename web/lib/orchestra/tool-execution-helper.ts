/**
 * Tool Execution Helper - Wires centralized tool system into all agent execution paths
 * 
 * This module provides a unified interface for tool execution across:
 * - V1 API (standard LLM calls)
 * - Streaming responses  
 * - Non-Mastra workflows
 * - OpenCode-like CLI tool integration (v2)
 * 
 * Usage:
 * import { executeToolCapability, initializeToolSystem } from './tool-execution-helper';
 * 
 * await initializeToolSystem();
 * const result = await executeToolCapability('file.read', { path: 'src/index.ts' }, { userId: 'user123' });
 */

import {
  executeCapability,
  initToolSystem,
  bootstrapToolSystem,
  hasToolCapability,
} from '@/lib/tools';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ToolExecutionHelper');

// Lazy initialization
let initialized = false;
let initPromise: Promise<any> | null = null;

/**
 * Initialize the tool system - called once at startup
 */
export async function initializeToolSystem(userId: string = 'system'): Promise<void> {
  if (initialized) return;
  
  if (!initPromise) {
    initPromise = bootstrapToolSystem({
      userId,
      enableMCP: true,
      enableComposio: false,
      enableSandbox: true,
      enableNullclaw: false,
      enableOAuth: true,
    });
  }
  
  const result = await initPromise;
  log.info('Tool system initialized', { toolCount: result.toolCount });
  initialized = true;
}

/**
 * Execute a tool capability with automatic provider selection
 */
export async function executeToolCapability(
  capabilityName: string,
  params: Record<string, unknown>,
  context?: { userId?: string; sessionId?: string; workspaceId?: string }
): Promise<{ success: boolean; output?: unknown; error?: string; exitCode?: number }> {
  if (!initialized) {
    await initializeToolSystem(context?.userId || 'system');
  }
  
  try {
    const result = await executeCapability(capabilityName, params, context as any);
    return result.success
      ? { success: true, output: (result as any).data, exitCode: 0 }
      : { success: false, error: result.error, exitCode: 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Tool execution failed', { capability: capabilityName, error: msg });
    return { success: false, error: msg, exitCode: 1 };
  }
}

/**
 * Check if a capability is available
 */
export function isCapabilityAvailable(capabilityName: string): boolean {
  return hasToolCapability(capabilityName);
}

/**
 * Get tool definitions for LLM function calling
 */
export async function getCapabilityTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>> {
  if (!initialized) return [];
  const system = await initToolSystem();
  return Array.from((system.registry as any).capabilities.entries()).map(([id, cap]) => ({
    name: id,
    description: cap.description || `Execute ${id}`,
    parameters: (cap as any).inputSchema || {},
  }));
}
