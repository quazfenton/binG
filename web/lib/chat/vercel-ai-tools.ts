/**
 * Vercel AI SDK Tool Integration
 *
 * Converts existing capability definitions and tools from lib/tools
 * into Vercel AI SDK tool format for seamless integration.
 *
 * @example
 * ```typescript
 * import { convertCapabilitiesToTools } from '@/lib/chat/vercel-ai-tools';
 *
 * const tools = await convertCapabilitiesToTools(['file.read', 'file.write', 'sandbox.execute']);
 *
 * const result = streamText({
 *   model: openai('gpt-4o'),
 *   messages,
 *   tools,
 * });
 * ```
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { chatLogger } from './chat-logger';
import type { ToolExecutionContext } from './vercel-ai-streaming';
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp/architecture-integration';
import { isMCPAvailable, vfsTools as mcpVFSTools, toolContextStore } from '@/lib/mcp';
import { ALL_CAPABILITIES, getCapability, type CapabilityDefinition } from '@/lib/tools/capabilities';
import { getCapabilityRouter, type CapabilityRouter } from '@/lib/tools/router';

/**
 * Create tools from capability definitions using the CapabilityRouter
 * This wires capabilities into Vercel AI tools for intelligent provider selection
 */
function createCapabilityTools(context: ToolExecutionContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  const router = getCapabilityRouter();

  for (const capability of ALL_CAPABILITIES) {
    const toolName = capability.id.replace('.', '_');

    tools[toolName] = (tool as any)({
      description: capability.description,
      parameters: capability.inputSchema as any,
      execute: async (args: any, execOptions: any) => {
        try {
          const result = await router.execute(capability.id, args, {
            userId: context.userId,
            conversationId: context.conversationId,
            sessionId: (context as any).sessionId,
            ...(execOptions || {}),
          } as any);
          if (result.success) {
            return result.output;
          } else {
            throw new Error(result.error || 'Capability execution failed');
          }
        } catch (error: any) {
          chatLogger.error(`Capability ${capability.id} failed`, { error: error.message });
          throw error;
        }
      },
    }) as unknown as Tool;
  }
  return tools;
}

/**
 * Create a capability chain tool for multi-step workflows
 * Exposes a single tool to the LLM that executes multiple capabilities in sequence
 */
function createCapabilityChainTool(context: ToolExecutionContext): Record<string, Tool> {
  const router = getCapabilityRouter();

  return {
    run_capability_chain: (tool as any)({
      description: `Execute a chain of capabilities in sequence for multi-step workflows. Available capabilities: ${ALL_CAPABILITIES.map(c => c.id).join(', ')}`,
      parameters: z.object({
        name: z.string().describe('Chain name/description'),
        steps: z.array(z.object({
          capability: z.string().describe('Capability ID (e.g., "file.read", "sandbox.shell", "web.browse")'),
          args: z.record(z.any()).describe('Arguments for this capability step'),
        })).describe('Ordered sequence of capabilities to execute'),
        stop_on_failure: z.boolean().optional().default(false).describe('Stop chain if a step fails'),
      }),
      execute: async (args: any) => {
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
            execute: async (capName: string, config: any, _chainCtx: any) => {
              return router.execute(capName, config, {
                userId: context.userId,
                conversationId: context.conversationId,
                sessionId: (context as any).sessionId,
              } as any);
            },
          });

          const serializedResults = Object.fromEntries(result.results.entries());
          return {
            success: result.success,
            results: serializedResults,
            errors: result.errors,
            steps: result.steps,
            duration: result.duration,
          };
        } catch (error: any) {
          chatLogger.error('Capability chain execution failed', { error: error.message });
          throw error;
        }
      },
    }) as unknown as Tool,
  };
}

/**
 * Convert a capability definition to Vercel AI SDK tool
 *
 * @param capabilityId - Capability ID (e.g., 'file.read', 'sandbox.execute')
 * @param executeFn - Function to execute the capability
 * @param options - Tool options (description, parameters)
 * @returns Vercel AI SDK tool
 */
export function createToolFromCapability(
  capabilityId: string,
  executeFn: (args: any, context: ToolExecutionContext) => Promise<any>,
  options?: {
    description?: string;
    parameters?: z.ZodSchema;
  }
): Tool {
  return (tool as any)({
    description: options?.description || `Execute ${capabilityId} capability`,
    parameters: options?.parameters || z.record(z.any()),
    execute: async (args: any) => {
      const context: ToolExecutionContext = {};

      try {
        chatLogger.debug('Executing capability via Vercel AI SDK tool', {
          capabilityId,
          args: sanitizeArgs(args),
        });

        const result = await executeFn(args, context);

        chatLogger.debug('Capability execution completed', {
          capabilityId,
          success: true,
        });

        return result;
      } catch (error: any) {
        chatLogger.error('Capability execution failed', {
          capabilityId,
          error: error.message,
        });
        throw error;
      }
    },
  }) as unknown as Tool;
}

/**
 * Sanitize arguments for logging (remove sensitive data)
 */
function sanitizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return args;

  const sanitized: any = {};
  const sensitiveKeys = ['apiKey', 'password', 'secret', 'token', 'authorization'];

  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create VFS MCP tools (structured file operations via MCP)
 * These tools use schema-enforced parameters instead of fragile tag parsing
 *
 * IMPORTANT: Each tool's execute is wrapped with toolContextStore.run() to ensure
 * the userId/sessionId context propagates into Vercel AI SDK's internal tool
 * execution. Using initializeVFSTools/enterWith() alone doesn't work because
 * streamText creates its own async context for tool calling, which loses the
 * enterWith scope. Without this wrap, getToolContext() falls back to 'default',
 * causing files to be written to the wrong user's workspace.
 */
function createVFSTools(context: ToolExecutionContext): Record<string, Tool> {
  const userId = context.userId || 'default';
  // Use sessionId from context if available, otherwise extract from conversationId
  // The conversationId format is "ownerId:sessionId" so we can extract sessionId from it
  const sessionId = context.sessionId || (context.conversationId?.includes(':') ? context.conversationId.split(':')[1] : undefined);
  // Ensure scopePath is always defined - fallback to "project" for workspace root
  const scopePath = context.scopePath || 'project';
  const tools: Record<string, Tool> = {};

  for (const [name, vfsTool] of Object.entries(mcpVFSTools)) {
    tools[name] = {
      ...vfsTool,
      execute: async (args: any, execOptions: any) => {
        return toolContextStore.run(
          { userId, sessionId, scopePath },
          async () => (vfsTool as any).execute(args, execOptions),
        );
      },
    };
  }

  return tools;
}

/**
 * MCP tool wrapper for Vercel AI SDK
 * Wraps MCP tool definitions in Vercel's tool() format
 */
async function createMCPTools(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  const mcpTools: Record<string, Tool> = {};

  if (!isMCPAvailable()) {
    return mcpTools;
  }

  try {
    const mcpToolDefs = await getMCPToolsForAI_SDK(context.userId);

    for (const toolDef of mcpToolDefs) {
      const { name, description, parameters } = toolDef.function;

      mcpTools[name] = (tool as any)({
        description: description || `MCP tool: ${name}`,
        parameters: parameters || z.record(z.any()),
        execute: async (args: any) => {
          try {
            // Explicit logging for VFS MCP tools
            if (name.startsWith('write_') || name.startsWith('read_') || name.startsWith('list_') ||
                name.startsWith('search_') || name.startsWith('apply_') || name.startsWith('batch_') ||
                name.startsWith('delete_') || name.startsWith('create_') || name.startsWith('get_workspace')) {
              chatLogger.info('[VFS MCP] Tool invoked', {
                tool: name,
                userId: context.userId,
                args: Object.keys(args || {}),
                path: args?.path || args?.files?.map((f: any) => f.path)?.join(', ') || undefined,
              });
            }

            const result = await callMCPToolFromAI_SDK(name, args, context.userId || '');
            if (result.success) {
              // Log VFS MCP tool result summary
              if (name.startsWith('write_') || name.startsWith('read_') || name.startsWith('list_') ||
                  name.startsWith('search_') || name.startsWith('apply_') || name.startsWith('batch_') ||
                  name.startsWith('delete_') || name.startsWith('create_') || name.startsWith('get_workspace')) {
                chatLogger.info('[VFS MCP] Tool completed', {
                  tool: name,
                  success: true,
                  userId: context.userId,
                });
              }
              return { success: true, output: result.output };
            } else {
              return { success: false, error: result.error || 'Tool execution failed' };
            }
          } catch (error: any) {
            chatLogger.error('MCP tool execution failed', { tool: name, error: error.message });
            return { success: false, error: error.message };
          }
        },
      }) as unknown as Tool;
    }

    chatLogger.debug('Created MCP tools for Vercel AI SDK', { count: mcpToolDefs.length });
  } catch (error: any) {
    chatLogger.warn('Failed to create MCP tools', { error: error.message });
  }

  return mcpTools;
}

/**
 * Get all available tools for a given context (including MCP tools and VFS tools)
 *
 * Tool Priority (fallback chain):
 * 1. VFS MCP tools (structured, schema-enforced - PREFERRED for file operations)
 * 2. Capability-based tools (uses CapabilityRouter for intelligent provider selection)
 * 3. Capability chain tool (multi-step workflows)
 * 4. MCP server tools (remote MCP servers)
 */
export async function getAllTools(context: ToolExecutionContext): Promise<Record<string, Tool>> {
  // Get VFS MCP tools (structured, schema-enforced file operations)
  const vfsTools = createVFSTools(context);

  // Get MCP server tools (remote MCP servers)
  const mcpServerTools = await createMCPTools(context);

  // Get capability-based tools (uses CapabilityRouter for intelligent provider selection)
  const capabilityTools = createCapabilityTools(context);

  // Get capability chain tool for multi-step workflows
  const chainTool = createCapabilityChainTool(context);

  return {
    ...vfsTools,         // MCP VFS tools first (preferred)
    ...capabilityTools,  // Capability-based tools with smart routing
    ...chainTool,        // Multi-step capability chain tool
    ...mcpServerTools,   // Remote MCP server tools
  };
}

/**
 * Get tools by category
 */
export async function getToolsByCategory(
  category: 'file' | 'sandbox' | 'web' | 'all',
  context: ToolExecutionContext
): Promise<Record<string, Tool>> {
  switch (category) {
    case 'all':
    default:
      return getAllTools(context);
  }
}

/**
 * Extract public HTTPS URLs from user text.
 * Useful for pre-detecting URLs in prompts to auto-trigger web_fetch.
 */
export function extractPublicUrls(text: string): string[] {
  const urlRegex = /https:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) || [];

  // Deduplicate and filter to well-formed URLs
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const raw of matches) {
    // Strip trailing punctuation that's often part of prose
    const cleaned = raw.replace(/[.,;:!?)\]>]+$/, '');
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'https:' && !seen.has(cleaned)) {
        seen.add(cleaned);
        urls.push(cleaned);
      }
    } catch {
      // Skip malformed
    }
  }

  return urls;
}
