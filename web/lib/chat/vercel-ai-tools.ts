/**
 * Vercel AI SDK Tool Adapter — Type-Safe Tool Conversion
 *
 * Converts capability definitions and MCP tools into Vercel AI SDK format
 * with proper schema preservation, type safety, and priority-based filtering.
 */

import { tool, type Tool, type ToolCallOptions } from 'ai';
import { z } from 'zod';
import { chatLogger } from './chat-logger';
import type { ToolExecutionContext } from './vercel-ai-streaming';
import type { ToolExecutionContext as RouterToolContext } from '@/lib/tools/tool-integration/types';
import { isMCPAvailable, vfsTools as mcpVFSTools, toolContextStore, getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp';
import { ALL_CAPABILITIES, type CapabilityDefinition } from '@/lib/tools/capabilities';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { getCapabilityRouter } from '@/lib/tools/router';
import { createWebFetchTool } from '@/lib/tools/web-fetch-tool';
import { chooseRoleCapability } from './tools/choose-role-tool';

// ============================================================================
// Types
// ============================================================================

export type ToolSource = 'vfs' | 'capability' | 'capability-chain' | 'mcp';
export type ToolPriority = ToolSource | 'none';

export interface ToolSetOptions {
  priority?: ToolPriority[];
  allowedCapabilities?: string[];
  excludedTools?: string[];
  includeCapabilityChain?: boolean;
}

export interface ToolSet {
  tools: Record<string, Tool>;
  stats: {
    vfs: number;
    capability: number;
    mcp: number;
    total: number;
    excluded: string[];
  };
}

// ============================================================================
// Schema Conversion
// ============================================================================

function toToolParameters(schema: z.ZodSchema | undefined): z.ZodObject<z.ZodRawShape> {
  if (!schema) return z.object({}).describe('No parameters required');
  if (schema instanceof z.ZodObject) return schema;

  const typeName = (schema as any)._def?.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
    const inner = (schema as any).unwrap?.();
    if (inner) return toToolParameters(inner);
  }
  if (typeName === 'ZodEffects') {
    const inner = (schema as any)._def?.schema;
    if (inner) return toToolParameters(inner);
  }
  if (typeName === 'ZodLazy') {
    try {
      const inner = (schema as any)._def?.getter?.();
      if (inner) return toToolParameters(inner);
    } catch { /* fall through */ }
  }
  if (typeName === 'ZodDefault' || typeName === 'ZodCatch') {
    const inner = (schema as any)._def?.innerType;
    if (inner) return toToolParameters(inner);
  }

  chatLogger.warn('Capability schema is not a ZodObject, using empty params', {
    schemaType: typeName || schema.constructor?.name || 'unknown',
  });
  return z.object({}).describe('Parameters not available');
}

function sanitizeArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const sensitiveKeys = ['apikey', 'password', 'secret', 'token', 'authorization', 'credential'];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ============================================================================
// Tool Builders
// ============================================================================

function createCapabilityTool(
  capability: CapabilityDefinition,
  context: ToolExecutionContext
): Tool {
  const toolName = capability.id.replace(/\./g, '_');
  
  return tool({
    description: capability.description,
    parameters: toToolParameters(capability.inputSchema),
    execute: async (args: any) => {
      const startTime = Date.now();
      chatLogger.info(`[Tool:${toolName}] Executing`, { args: sanitizeArgs(args) });

      try {
        const router = getCapabilityRouter();
        const result = await router.execute(capability.id, args, {
          userId: context.userId,
          conversationId: context.conversationId,
          sessionId: context.sessionId,
          scopePath: context.scopePath,
        } as any);

        const duration = Date.now() - startTime;
        chatLogger.info(`[Tool:${toolName}] Success`, { duration });

        return result;
      } catch (err: any) {
        chatLogger.error(`[Tool:${toolName}] Failed`, { error: err.message });
        throw err;
      }
    },
  });
}

function createVFSToolSet(context: ToolExecutionContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  
  for (const [name, mcpTool] of Object.entries(mcpVFSTools)) {
    tools[name] = tool({
      description: (mcpTool as any).description,
      parameters: (mcpTool as any).parameters,
      execute: async (args: any) => {
        return await callMCPToolFromAI_SDK(name, args, context.userId, context.scopePath);
      },
    });
  }
  
  return tools;
}

async function createMCPToolSet(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  const tools: Record<string, Tool> = {};
  
  try {
    const mcpTools = await getMCPToolsForAI_SDK(context.userId, '');
    for (const mcpTool of mcpTools) {
      const name = mcpTool.function.name;
      tools[name] = tool({
        description: mcpTool.function.description,
        parameters: mcpTool.function.parameters as any,
        execute: async (args: any) => {
          return await callMCPToolFromAI_SDK(name, args, context.userId, context.scopePath);
        },
      });
    }
  } catch (err: any) {
    chatLogger.warn('Failed to load MCP tools', { error: err.message });
  }
  
  return tools;
}

function createCapabilityChainTool(context: ToolExecutionContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  
  tools['capability_chain'] = tool({
    description: 'Execute a sequence of capabilities in a single step (e.g., search -> read -> analyze).',
    parameters: z.object({
      steps: z.array(z.object({
        capabilityId: z.string().describe('The ID of the capability to execute (e.g., "file.read")'),
        args: z.record(z.any()).describe('Arguments for the capability'),
      })),
    }),
    execute: async ({ steps }) => {
      const results = [];
      const router = getCapabilityRouter();
      
      for (const step of steps) {
        const result = await router.execute(step.capabilityId, step.args, {
          userId: context.userId,
          conversationId: context.conversationId,
          sessionId: context.sessionId,
          scopePath: context.scopePath,
        } as any);
        results.push({ capabilityId: step.capabilityId, result });
      }
      
      return results;
    },
  });
  
  return tools;
}

// ============================================================================
// Main Entry Points
// ============================================================================

export function createToolSet(
  context: ToolExecutionContext,
  options: ToolSetOptions = {}
): ToolSet {
  const {
    priority = ['vfs', 'capability', 'mcp'],
    allowedCapabilities = [],
    excludedTools = [],
    includeCapabilityChain = true,
  } = options;

  const sourceTools: Record<string, Record<string, Tool>> = {
    vfs: {}, capability: {}, 'capability-chain': {}, mcp: {},
  };

  if (priority.includes('vfs')) {
    sourceTools.vfs = createVFSToolSet(context);
  }

  if (priority.includes('capability')) {
    for (const cap of ALL_CAPABILITIES) {
      if (allowedCapabilities.length > 0 && !allowedCapabilities.includes(cap.id)) continue;
      if (excludedTools.includes(cap.id) || excludedTools.includes(cap.id.replace(/\./g, '_'))) continue;
      const toolName = cap.id.replace(/\./g, '_');
      sourceTools.capability[toolName] = createCapabilityTool(cap, context);
    }
  }

  if (includeCapabilityChain) {
    sourceTools['capability-chain'] = createCapabilityChainTool(context);
  }

  const merged: Record<string, Tool> = {};
  const excluded: string[] = [];

  for (const source of priority) {
    const tools = sourceTools[source];
    if (!tools) continue;
    for (const [name, t] of Object.entries(tools)) {
      if (merged[name]) {
        excluded.push(`${name} (shadowed by ${source})`);
        continue;
      }
      merged[name] = t;
    }
  }

  if (includeCapabilityChain && sourceTools['capability-chain']) {
    for (const [name, t] of Object.entries(sourceTools['capability-chain'])) {
      if (!merged[name]) merged[name] = t;
    }
  }

  return {
    tools: merged,
    stats: {
      vfs: Object.keys(sourceTools.vfs).length,
      capability: Object.keys(sourceTools.capability).length,
      mcp: Object.keys(sourceTools.mcp).length,
      total: Object.keys(merged).length,
      excluded,
    },
  };
}

export async function getAllTools(
  context: ToolExecutionContext,
  options: ToolSetOptions = {}
): Promise<Record<string, Tool>> {
  const {
    priority = ['vfs', 'capability', 'mcp'],
    allowedCapabilities = [],
    excludedTools = [],
    includeCapabilityChain = true,
  } = options;

  const syncSet = createToolSet(context, { priority, allowedCapabilities, excludedTools, includeCapabilityChain });
  const result = { ...syncSet.tools };

  if (priority.includes('mcp')) {
    const mcpTools = await createMCPToolSet(context);
    for (const [name, t] of Object.entries(mcpTools)) {
      if (!result[name] && !excludedTools.includes(name)) {
        result[name] = t;
      }
    }
  }

  // Add web_fetch tool - always available for URL content extraction
  try {
    const webFetchTools = await createWebFetchTool({
      userId: context.userId,
      conversationId: context.userId ? `${context.userId}\$${context.sessionId || '001'}` : (context.conversationId || '001'),
    });
    if (!result['web_fetch']) {
      result['web_fetch'] = webFetchTools.web_fetch;
    }
  } catch (err: any) {
    chatLogger.warn('Failed to create web_fetch tool', { error: err.message });
  }

  // Add choose_role capability - enables dynamic role redirection
  if (!result['choose_role'] && !excludedTools.includes('choose_role')) {
    result['choose_role'] = chooseRoleCapability;
  }

  // Add power tools (lazy-loaded — only action-tools for trigger-matched powers)
  try {
    const { buildPowerTools } = await import('@/lib/powers');
    const userMessage = context.lastUserMessage || '';
    const powerTools = await buildPowerTools(
      { userId: context.userId, conversationId: context.conversationId, sessionId: context.sessionId },
      userMessage,
    );
    for (const [name, t] of Object.entries(powerTools)) {
      if (!result[name]) {
        result[name] = t as Tool;
      }
    }
  } catch (err: any) {
    chatLogger.warn('Failed to create power tools', { error: err.message });
  }

  chatLogger.info('Tool set created', { total: Object.keys(result).length, priority, stats: syncSet.stats });

  return result;
}
