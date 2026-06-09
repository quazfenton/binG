/**
 * Vercel AI SDK Tool Adapter — Type-Safe Tool Conversion
 *
 * Converts capability definitions and MCP tools into Vercel AI SDK format
 * with proper schema preservation, type safety, and priority-based filtering.
 */

import { tool, type Tool, type ToolExecutionOptions } from 'ai';
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
    const k = String(key || '');
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    // Special-case files arrays to avoid huge payloads in logs
    if (k === 'files' && Array.isArray(value)) {
      sanitized[key] = (value as any[]).map(f => ({ path: f?.path, name: f?.name }));
      continue;
    }
    sanitized[key] = value;
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
    inputSchema: capability.inputSchema ? capability.inputSchema as any : z.object({}),
    execute: async (args: any): Promise<any> => {
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
  }) as any;
}

function createVFSToolSet(context: ToolExecutionContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  
  for (const [name, mcpTool] of Object.entries(mcpVFSTools)) {
    tools[name] = tool({
      description: (mcpTool as any).description,
      inputSchema: (mcpTool as any).inputSchema || (mcpTool as any).parameters || z.object({}),
      execute: async (args: any) => {
        return await callMCPToolFromAI_SDK(name, args, context.userId, context.scopePath);
      },
    } as any);
  }
  
  return tools;
}

async function createMCPToolSet(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  const tools: Record<string, Tool> = {};
  
  try {
    // Pass the user's actual message as taskFilter so the existing
    // task-aware filtering in getMCPToolsForAI_SDK() can decide which
    // tools are relevant (Arcade tools for web tasks, provider tools
    // for sandbox/computer-use tasks, etc.). Falls back to undefined
    // on the first request before any user message is sent.
    const mcpTools = await getMCPToolsForAI_SDK(context.userId, context.lastUserMessage);
    for (const mcpTool of mcpTools) {
      const name = mcpTool.function.name;
      // Blaxel codegen and Nullclaw messaging/automation tools are
      // bloated and rarely needed. Filter them unconditionally — they
      // remain accessible through direct getMCPToolsForAI_SDK() calls.
      if (name.startsWith('blaxel_') || name.startsWith('nullclaw_')) continue;
      tools[name] = tool({
        description: mcpTool.function.description,
        inputSchema: mcpTool.function.parameters || z.object({}),
        execute: async (args: any) => {
          return await callMCPToolFromAI_SDK(name, args, context.userId, context.scopePath);
        },
      } as any);
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
    inputSchema: z.object({
      steps: z.array(z.object({
        capabilityId: z.string().describe('The ID of the capability to execute (e.g., "file.read")'),
        args: z.record(z.any()).describe('Arguments for the capability'),
      })),
    }),
    execute: async ({ steps }: any) => {
      const results = [];
      const router = getCapabilityRouter();
      
      for (const step of steps) {
        try {
          const result = await router.execute(step.capabilityId, step.args, {
            userId: context.userId,
            conversationId: context.conversationId,
            sessionId: context.sessionId,
            scopePath: context.scopePath,
          } as any);
          results.push({ capabilityId: step.capabilityId, result });
        } catch (err: any) {
          results.push({ capabilityId: step.capabilityId, error: err.message });
        }
      }
      
      return results;
    },
  });
  
  return tools;
}

// ============================================================================
// Task-Aware Additive Capability Filtering
// ============================================================================

/**
 * Task groups define which capabilities to load when the user's message
 * mentions certain topics. Instead of starting from all 80+ capabilities
 * and subtracting (which causes broad keywords like "search" to match 6+
 * loosely-related tools), we start from empty and only ADD capabilities
 * whose group keywords match the message.
 *
 * Each group has a set of keywords and a list of capability patterns to
 * add when any keyword matches. Patterns support wildcards: "terminal.*"
 * matches all ids starting with "terminal.".
 *
 * Falls back to all capabilities when nothing matches, so the LLM is
 * never stranded.
 */
type TaskGroup = { keywords: string[]; add: string[] };

const TASK_GROUPS: TaskGroup[] = [
  {
    keywords: ['search', 'grep', 'find', 'codebase', 'lookup', 'locate', 'ripgrep'],
    add: ['repo.search'],
  },
  {
    keywords: ['run', 'execute', 'eval', 'interpreter', 'python', 'javascript', 'script', 'snippet'],
    add: ['sandbox.execute'],
  },
  {
    keywords: ['shell', 'bash', 'command', 'exec', 'cli', 'cmd'],
    add: ['bash.execute', 'sandbox.session'],
  },
  {
    keywords: ['commit', 'push', 'pull', 'clone', 'git', 'branch', 'merge', 'rebase', 'stash', 'version control'],
    add: ['repo.git'],
  },
  {
    keywords: ['browse', 'scrape', 'url', 'http', 'fetch', 'webpage', 'web page', 'crawl'],
    add: ['web.browse', 'web.fetch', 'web.search'],
  },
  {
    keywords: ['discord', 'telegram', 'dm', 'direct message', 'send message', 'message'],
    add: ['automation.discord', 'automation.telegram'],
  },
  {
    keywords: ['task', 'todo', 'plan', 'steps', 'schedule', 'track', 'checklist'],
    add: ['task.*', 'workflow.discovery', 'workflow.plan'],
  },
  {
    keywords: ['desktop', 'click', 'screenshot', 'snapshot', 'window', 'screen', 'type text', 'keyboard', 'clipboard', 'app'],
    add: ['desktop.*', 'computer_use.*'],
  },
  {
    keywords: ['terminal', 'pty', 'interactive', 'tui'],
    add: ['terminal.*'],
  },
  {
    keywords: ['process', 'daemon', 'background', 'kill', 'ps', 'bg job'],
    add: ['process.stop', 'process.list', 'terminal.start_process', 'terminal.stop_process', 'terminal.list_processes'],
  },
  {
    keywords: ['port', 'preview', 'forward', 'listen', 'expose'],
    add: ['preview.*', 'terminal.get_port_status'],
  },
  {
    keywords: ['memory', 'remember', 'store', 'recall', 'cache', 'remember this'],
    add: ['memory.*'],
  },
  {
    keywords: ['workspace', 'sync', 'migrate', 'r2', 'storage', 'affinity', 'image', 'cas'],
    add: ['workspace.*', 'workspacefs.*', 'workspace.graph', 'workspace.graph_diagnostic', 'workspace.graph_find_process'],
  },
  {
    keywords: ['analyze', 'detect', 'framework', 'dependency', 'structure', 'stats'],
    add: ['repo.analyze', 'workspace.analyze', 'workspace.structure', 'workspace.stats', 'workspace.list_scripts'],
  },
  {
    keywords: ['bundle', 'context', 'repomix', 'export', 'project context'],
    add: ['workspace.bundle'],
  },
  {
    keywords: ['diff', 'syntax', 'ast', 'refactor', 'check', 'lint', 'validate', 'format'],
    add: ['code.ast_diff', 'code.syntax_check', 'workspace.getChanges'],
  },
  {
    keywords: ['provider', 'cost', 'runtime', 'broker', 'estimate'],
    add: ['runtime.*'],
  },
  {
    keywords: ['graph', 'diagnostic', 'diagnose', 'troubleshoot', 'state', 'runtime state'],
    add: ['workspace.graph', 'workspace.graph_diagnostic', 'workspace.graph_find_process', 'workspace.runtime_state'],
  },
  {
    keywords: ['mcp', 'tool list', 'list tools'],
    add: ['mcp.*'],
  },
  {
    keywords: ['workflow', 'automation', 'pipeline', 'cron', 'trigger'],
    add: ['automation.workflow', 'workflow.*', 'task.schedule', 'task.status', 'task.cancel'],
  },
  {
    keywords: ['batch', 'atomic', 'multiple files', 'write multiple'],
    add: ['file.batch_write'],
  },
  {
    keywords: ['changes', 'sync client', 'file sync', 'get changes'],
    add: ['file.sync', 'workspace.getChanges'],
  },
  {
    keywords: ['approval', 'human', 'confirm', 'hitl', 'human in the loop'],
    add: ['workflow.request_approval'],
  },
  {
    keywords: ['history', 'rollback', 'undo', 'restore', 'revert', 'snapshot'],
    add: ['workflow.history', 'workflow.rollback', 'workflow.commit'],
  },
  {
    keywords: ['list', 'ls', 'dir', 'read', 'write', 'edit', 'file', 'create file', 'delete file', 'append', 'cat'],
    add: [], // file.* is always covered by VFS — nothing extra needed
  },
];

/**
 * Filter capabilities by task relevance using additive task groups.
 * Starts from empty and only adds capabilities whose task-group keywords
 * match the user's message. This avoids the broad-match problem where
 * common words like "search" or "run" load 15+ loosely-related tools.
 *
 * Falls back to all capabilities when no message or no groups match.
 */
function filterCapabilitiesByTask(
  capabilities: readonly CapabilityDefinition[],
  userMessage: string | undefined
): CapabilityDefinition[] {
  if (!userMessage) return [...capabilities];

  const lower = userMessage.toLowerCase();

  // Collect capability patterns that match the user's message
  const matchedPatterns = new Set<string>();

  for (const group of TASK_GROUPS) {
    if (group.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      for (const pattern of group.add) {
        matchedPatterns.add(pattern);
      }
    }
  }

  // If nothing matched (e.g. "hi", "thanks", "yes"), load everything
  if (matchedPatterns.size === 0) {
    chatLogger.debug('[TaskFilter] No task groups matched — loading all capabilities', {
      messagePreview: lower.slice(0, 80),
    });
    return [...capabilities];
  }

  // Expand wildcard patterns and collect matching capability IDs
  const expandedIds = new Set<string>();
  for (const pattern of matchedPatterns) {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      for (const cap of capabilities) {
        if (cap.id.startsWith(prefix)) expandedIds.add(cap.id);
      }
    } else {
      expandedIds.add(pattern);
    }
  }

  const result = capabilities.filter(cap => expandedIds.has(cap.id));

  const skipped = capabilities.length - result.length;
  if (skipped > 0) {
    chatLogger.debug('[TaskFilter] Additive match', {
      total: capabilities.length,
      included: result.length,
      skipped,
      patterns: matchedPatterns.size,
      ids: expandedIds.size,
    });
  }

  return result;
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
    // Task-aware filtering: only load capabilities whose keywords match the
    // user's message (same pattern as powersRegistry.matchByTriggers()).
    // Falls back to all capabilities when no message or no match, so the
    // LLM always has at least some tools available.
    const capsToLoad = filterCapabilitiesByTask(ALL_CAPABILITIES, context.lastUserMessage);

    for (const cap of capsToLoad) {
      if (allowedCapabilities.length > 0 && !allowedCapabilities.includes(cap.id)) continue;
      if (excludedTools.includes(cap.id) || excludedTools.includes(cap.id.replace(/\./g, '_'))) continue;
      // VFS tools (write_file, read_file, etc.) already cover file.* capabilities with
      // richer descriptions and better error handling. Skip duplicates to save ~1,400-3,500
      // tokens per request from sending redundant schemas to the LLM.
      if (priority.includes('vfs') && cap.id.startsWith('file.')) continue;
      const toolName = cap.id.replace(/\./g, '_');
      sourceTools.capability[toolName] = createCapabilityTool(cap, context);
    }
  }

  // Log capability filter summary at info level so we can verify
  // token savings at runtime (debug-level detail is in filterCapabilitiesByTask).
  // Subtract file.* caps from the baseline since they're always skipped by VFS dedup
  // — this way the log only reflects task-filtering savings, not VFS dedup.
  const capCount = Object.keys(sourceTools.capability).length;
  const fileCapsTotal = ALL_CAPABILITIES.filter(c => c.id.startsWith('file.')).length;
  const baseline = priority.includes('vfs') ? ALL_CAPABILITIES.length - fileCapsTotal : ALL_CAPABILITIES.length;
  if (capCount < baseline) {
    chatLogger.info('[ToolSet] Capability task filter: loaded ' + capCount + '/' + baseline + ' (' + (baseline - capCount) + ' filtered by task)');
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
    chatLogger.error('Failed to create web_fetch tool - URL content extraction unavailable', { 
      error: err.message,
      stack: err.stack,
      userId: context.userId,
      sessionId: context.sessionId
    });
    // web_fetch is core functionality - surface the error prominently
    console.error('[VERCEL-AI-TOOLS] web_fetch tool creation failed:', err.message);
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
