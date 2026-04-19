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
  const parameters = toToolParameters(capability.inputSchema);
  const router = getCapabilityRouter();

  return tool({
    description: capability.description,
    inputSchema: parameters,
    execute: async (args, execOptions: ToolCallOptions) => {
      try {
        chatLogger.debug('Capability tool executing', { tool: capability.id, args: sanitizeArgs(args) });
        const routerContext: RouterToolContext = {
          userId: context.userId || 'system',
          conversationId: context.conversationId,
          scopePath: context.scopePath,
        };
        const result = await router.execute(capability.id, args as Record<string, unknown>, routerContext);
        if (result.success) return result.output;
        throw new Error(result.error || `${capability.id} execution failed`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        chatLogger.error('Capability tool failed', { tool: capability.id, error: message });
        throw error;
      }
    },
  });
}

function createVFSToolSet(context: ToolExecutionContext): Record<string, Tool> {
  const userId = context.userId || 'default';
  const sessionId = context.sessionId || normalizeSessionId(context.conversationId || '');
  const scopePath = context.scopePath || 'project/sessions/000';
  const tools: Record<string, Tool> = {};

  for (const [name, vfsTool] of Object.entries(mcpVFSTools)) {
    const baseTool = vfsTool as unknown as Tool;
    const originalExecute = (baseTool as any).execute as ((args: unknown, opts?: ToolCallOptions) => Promise<unknown>) | undefined;

    tools[name] = {
      ...baseTool,
      execute: async (args: unknown, opts?: ToolCallOptions) => {
        return toolContextStore.run(
          { userId, sessionId, scopePath },
          () => originalExecute?.(args, opts)
        );
      },
    };
  }

  return tools;
}

async function createMCPToolSet(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  const tools: Record<string, Tool> = {};
  if (!isMCPAvailable()) return tools;

  try {
    const mcpToolDefs = await getMCPToolsForAI_SDK(context.userId);

    for (const toolDef of mcpToolDefs) {
      const { name, description, parameters } = toolDef.function;

      let toolParams: z.ZodType<unknown>;
      if (parameters && typeof parameters === 'object' && '_def' in parameters && 'parse' in parameters) {
        toolParams = parameters as z.ZodType<unknown>;
      } else {
        toolParams = z.object({}).describe(description || `MCP tool: ${name}`);
      }

      const isVFSTool = name.startsWith('write_') || name.startsWith('read_') || name.startsWith('list_') ||
        name.startsWith('search_') || name.startsWith('apply_') || name.startsWith('batch_') ||
        name.startsWith('delete_') || name.startsWith('create_') || name.startsWith('get_workspace');

      tools[name] = tool({
        description: description || `MCP tool: ${name}`,
        inputSchema: toolParams,
        execute: async (args: unknown) => {
          if (isVFSTool) {
            chatLogger.info('[VFS MCP] Tool invoked', { tool: name, userId: context.userId, args: typeof args === 'object' && args ? Object.keys(args as Record<string, unknown>) : [] });
          }
          try {
            const result = await callMCPToolFromAI_SDK(name, args as Record<string, unknown>, context.userId || '');
            if (result.success) {
              if (isVFSTool) chatLogger.info('[VFS MCP] Tool completed', { tool: name, userId: context.userId });
              return result.output;
            }
            return { success: false, error: result.error || 'Tool execution failed' };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            chatLogger.error('MCP tool failed', { tool: name, error: message });
            return { success: false, error: message };
          }
        },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    chatLogger.warn('Failed to create MCP tools', { error: message });
  }

  return tools;
}

function createCapabilityChainTool(context: ToolExecutionContext): Record<string, Tool> {
  const router = getCapabilityRouter();
  const availableCaps = ALL_CAPABILITIES.map(c => c.id).join(', ');

  return {
    run_capability_chain: tool({
      description: `Execute a chain of capabilities in sequence. Available: ${availableCaps}`,
      inputSchema: z.object({
        name: z.string().describe('Chain name/description'),
        steps: z.array(z.object({
          capability: z.string().describe('Capability ID'),
          args: z.record(z.unknown()).describe('Arguments for this step'),
        })).describe('Ordered capabilities to execute'),
        stop_on_failure: z.boolean().optional().default(false).describe('Stop chain on first failure'),
      }),
      execute: async (args) => {
        try {
          const { createCapabilityChain } = await import('@bing/shared/agent/capability-chain');
          const chain = createCapabilityChain({
            name: args.name,
            enableParallel: false,
            stopOnFailure: args.stop_on_failure ?? false,
          });
          for (const step of args.steps) {
            chain.addStep(step.capability, step.args);
          }
          const result = await chain.execute({
            execute: async (capName: string, config: unknown) => {
              return router.execute(capName, config as Record<string, unknown>, {
                userId: context.userId || 'system',
                conversationId: context.conversationId,
                scopePath: context.scopePath,
              });
            },
          });
          return {
            success: result.success,
            results: Object.fromEntries(result.results.entries()),
            errors: result.errors,
            steps: result.steps,
            duration: result.duration,
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          chatLogger.error('Capability chain failed', { error: message });
          throw error;
        }
      },
    }),
  };
}

// ============================================================================
// Priority-Based Tool Set Builder
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
      conversationId: context.conversationId,
    });
    if (!result['web_fetch']) {
      result['web_fetch'] = webFetchTools.web_fetch;
    }
  } catch (err: any) {
    chatLogger.warn('Failed to create web_fetch tool', { error: err.message });
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

export { sanitizeArgs };
export type { ToolExecutionContext } from './vercel-ai-streaming';
