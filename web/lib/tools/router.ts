// Tool capability router
/**
 * Capability Router - Maps capabilities to actual tool providers
 *
 * This is the middle layer between capabilities and providers:
 *   Agent → Capability → Router → Provider → Execution
 *
 * The router:
 * - Selects the best available provider for a capability
 * - Handles provider fallback if primary fails
 * - Transforms inputs/outputs between capability and provider schemas
 * - Manages provider health and availability
 */

import { createLogger } from '../utils/logger';
import {
  CapabilityDefinition,
  getCapability,
  ALL_CAPABILITIES,
  type CapabilityCategory,
} from './capabilities';
import type { ToolExecutionContext, ToolExecutionResult, LatencyBudget } from './tool-integration/types';
import { getToolManager } from './index';
import { getArcadeService } from '../integrations/arcade-service';
import { getNangoService } from '../integrations/nango-service';
import path from 'path';

const logger = createLogger('Tools:CapabilityRouter');

// ============================================================================
// Provider Adapters
// ============================================================================

/**
 * Provider adapter interface - each provider implements this to handle
 * specific capabilities
 */
export interface CapabilityProvider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Capabilities this provider can handle */
  readonly capabilities: string[];
  /** Check if provider is available */
  isAvailable(): boolean | Promise<boolean>;
  /** Execute a capability */
  execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
  /** Get provider health status */
  getHealth?(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}

/**
 * VFS Provider - handles file operations via Virtual Filesystem
 *
 * Uses a declarative method map instead of a switch statement.
 * Each capability is a typed method with input/output schemas.
 */
class VFSProvider implements CapabilityProvider {
  readonly id = 'vfs';
  readonly name = 'Virtual Filesystem';
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.search', 'memory.context', 'workspace.getChanges'];

  isAvailable(): boolean {
    return true;
  }

  // ─── Declarative Method Map ──────────────────────────────────────────────

  private readonly methods: Record<string, (ownerId: string, input: any) => Promise<any>> = {
    'file.read': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const file = await virtualFilesystem.readFile(ownerId, input.path);
      return {
        content: file.content,
        path: file.path,
        language: file.language,
        size: file.size,
        version: file.version,
        lastModified: file.lastModified,
      };
    },

    'file.write': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const file = await virtualFilesystem.writeFile(
        ownerId,
        input.path,
        input.content,
        input.language,
        input.append
          ? { failIfExists: false, append: true }
          : input.failIfExists
            ? { failIfExists: true }
            : undefined
      );
      return { success: true, path: file.path, bytesWritten: file.size };
    },

    'file.append': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const file = await virtualFilesystem.writeFile(
        ownerId,
        input.path,
        input.content,
        input.language,
        { failIfExists: false, append: true }
      );
      return { success: true, path: file.path, bytesWritten: file.size };
    },

    'file.delete': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const result = await virtualFilesystem.deletePath(ownerId, input.path);
      return { deletedCount: result.deletedCount, path: input.path };
    },

    'file.list': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const listing = await virtualFilesystem.listDirectory(ownerId, input.path || 'project');
      return {
        path: listing.path,
        nodes: listing.nodes.map(node => ({
          name: node.name,
          path: node.path,
          type: node.type,
          language: node.language,
          size: node.size,
          lastModified: node.lastModified,
        })),
      };
    },

    'file.search': async (ownerId, input) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const results = await virtualFilesystem.search(ownerId, input.query, {
        path: input.path,
        limit: input.limit,
      });
      return {
        results: results.map(r => ({
          path: r.path,
          name: r.name,
          language: r.language,
          score: r.score,
          snippet: r.snippet,
          lastModified: r.lastModified,
        })),
        total: results.length,
      };
    },

    'workspace.getChanges': async (ownerId, input) => {
      const { diffTracker } = await import('../virtual-filesystem/filesystem-diffs');
      const changedFiles = diffTracker.getChangedFilesForSync(ownerId, input.maxFiles || 50);
      return { ownerId, count: changedFiles.length, files: changedFiles };
    },

    'memory.context': async (ownerId) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const workspace = await virtualFilesystem.exportWorkspace(ownerId);
      return {
        root: workspace.root,
        version: workspace.version,
        fileCount: workspace.files.length,
        files: workspace.files.map(f => ({
          path: f.path,
          language: f.language,
          size: f.size,
          lastModified: f.lastModified,
        })),
      };
    },
  };

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const ownerId = input.ownerId || context.userId || 'default';

    if (!ownerId) {
      return { success: false, error: 'Missing ownerId/userId' };
    }

    const handler = this.methods[capabilityId];
    if (!handler) {
      return { success: false, error: `Unknown capability: ${capabilityId}` };
    }

    try {
      const output = await handler(ownerId, input);
      return { success: true, output };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// ============================================================================
// Built-in Provider Adapters
// ============================================================================

/**
 * MCP Filesystem Provider - handles file operations via MCP
 */
class MCPFilesystemProvider implements CapabilityProvider {
  readonly id = 'mcp-filesystem';
  readonly name = 'MCP Filesystem';
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.search'];

  isAvailable(): boolean {
    // Check if MCP server is configured
    return !!process.env.MCP_CLI_PORT || !!process.env.MCP_GATEWAY_URL;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { callMCPToolFromAI_SDK } = await import('../mcp');

    // Map capability to MCP tool name
    const toolMap: Record<string, string> = {
      'file.read': 'read_file',
      'file.write': 'write_file',
      'file.append': 'append_file',
      'file.delete': 'delete_file',
      'file.list': 'list_directory',
      'file.search': 'search_files',
    };

    const toolName = toolMap[capabilityId];
    if (!toolName) {
      return { success: false, error: `No MCP tool mapping for ${capabilityId}` };
    }

    try {
      const result = await callMCPToolFromAI_SDK(toolName, input, context.userId);
      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Local Filesystem Provider - handles file operations directly
 * SECURITY: Validates paths to prevent traversal attacks
 */
class LocalFilesystemProvider implements CapabilityProvider {
  readonly id = 'local-fs';
  readonly name = 'Local Filesystem';
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.search'];
  
  // SECURITY: Base directory restriction for file operations
  private readonly workspaceRoot: string;

  constructor() {
    // Default to workspace directory, fall back to temp if not configured
    this.workspaceRoot = process.env.WORKSPACE_DIR ||
                         process.env.USER_WORKSPACE_ROOT ||
                         path.join(process.cwd(), 'workspace');
  }

  isAvailable(): boolean {
    return true; // Always available on server
  }

  /**
   * SECURITY: Validate and resolve path to prevent traversal attacks
   * Ensures all paths stay within the workspace root
   */
  private validatePath(inputPath: string): { valid: boolean; resolvedPath?: string; error?: string } {
    // Reject null bytes
    if (inputPath.includes('\0')) {
      return { valid: false, error: 'Invalid path: contains null bytes' };
    }

    // Resolve the path against workspaceRoot (not process.cwd()) to support workspace-relative paths
    const resolvedPath = path.resolve(this.workspaceRoot, inputPath);

    // Ensure path is within workspace root
    const normalizedWorkspace = path.resolve(this.workspaceRoot);

    // Check if resolved path starts with workspace root
    if (!resolvedPath.startsWith(normalizedWorkspace + path.sep) &&
        resolvedPath !== normalizedWorkspace) {
      return {
        valid: false,
        error: `Path traversal detected: ${inputPath}. Paths must be within ${this.workspaceRoot}`
      };
    }

    return { valid: true, resolvedPath };
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const fs = await import('fs/promises');

    try {
      switch (capabilityId) {
        case 'file.read': {
          // SECURITY: Validate path
          const pathValidation = this.validatePath(input.path);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;

          const content = await fs.readFile(safePath, input.encoding || 'utf-8');
          const stats = await fs.stat(safePath);
          return {
            success: true,
            output: {
              content: typeof content === 'string' ? content : content.toString('base64'),
              encoding: input.encoding || 'utf-8',
              size: stats.size,
              exists: true,
              path: safePath,
            },
          };
        }

        case 'file.write': {
          // SECURITY: Validate path
          const pathValidation = this.validatePath(input.path);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;

          if (input.createDirs) {
            const dir = path.dirname(safePath);
            await fs.mkdir(dir, { recursive: true });
          }

          // Support append parameter
          if (input.append) {
            const bytesWritten = await fs.appendFile(safePath, input.content, input.encoding || 'utf-8');
            return {
              success: true,
              output: {
                success: true,
                path: safePath,
                bytesWritten: typeof bytesWritten === 'number' ? bytesWritten : input.content.length,
              },
            };
          }

          const bytesWritten = await fs.writeFile(safePath, input.content, input.encoding || 'utf-8');
          return {
            success: true,
            output: {
              success: true,
              path: safePath,
              bytesWritten: typeof bytesWritten === 'number' ? bytesWritten : input.content.length,
            },
          };
        }

        case 'file.append': {
          // SECURITY: Validate path
          const pathValidation = this.validatePath(input.path);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;

          if (input.createDirs) {
            const dir = path.dirname(safePath);
            await fs.mkdir(dir, { recursive: true });
          }
          const bytesWritten = await fs.appendFile(safePath, input.content, input.encoding || 'utf-8');
          return {
            success: true,
            output: {
              success: true,
              path: safePath,
              bytesWritten: typeof bytesWritten === 'number' ? bytesWritten : input.content.length,
            },
          };
        }

        case 'file.delete': {
          // SECURITY: Validate path
          const pathValidation = this.validatePath(input.path);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;
          
          if (input.recursive) {
            await fs.rm(safePath, { force: input.force, recursive: true });
          } else {
            await fs.unlink(safePath);
          }
          return {
            success: true,
            output: { success: true, path: safePath },
          };
        }

        case 'file.list': {
          // SECURITY: Validate path
          const pathValidation = this.validatePath(input.path || this.workspaceRoot);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;

          const entries = await fs.readdir(safePath, { withFileTypes: true });
          let results = entries.map(entry => ({
            name: entry.name,
            path: path.join(safePath, entry.name),
            type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          }));

          // Apply pattern filter
          if (input.pattern) {
            const regex = new RegExp(input.pattern.replace(/\*/g, '.*'));
            results = results.filter(e => regex.test(e.name));
          }

          // Filter hidden files
          if (!input.includeHidden) {
            results = results.filter(e => !e.name.startsWith('.'));
          }

          return { success: true, output: results };
        }

        case 'file.search': {
          // SECURITY: Validate search directory
          const searchInput = input.path || this.workspaceRoot;
          const pathValidation = this.validatePath(searchInput);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const searchDir = pathValidation.resolvedPath!;
          const results: any[] = [];

          const searchRecursive = async (dir: string, depth: number) => {
            if (depth > 5 || results.length >= (input.maxResults || 50)) return;

            try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                // SECURITY: Ensure we don't traverse outside workspace during recursion
                const childValidation = this.validatePath(fullPath);
                if (!childValidation.valid) continue;

                if (entry.name.toLowerCase().includes(input.query.toLowerCase())) {
                  results.push({ path: fullPath });
                  if (results.length >= (input.maxResults || 50)) break;
                }
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                  await searchRecursive(fullPath, depth + 1);
                }
              }
            } catch { /* ignore permission errors */ }
          };

          await searchRecursive(searchDir, 0);
          return { success: true, output: results };
        }

        default:
          return { success: false, error: `Unknown capability: ${capabilityId}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * OpenCode V2 Provider - handles sandbox execution
 */
class OpenCodeV2Provider implements CapabilityProvider {
  readonly id = 'opencode-v2';
  readonly name = 'OpenCode V2';
  readonly capabilities = ['sandbox.execute', 'sandbox.shell', 'sandbox.session', 'repo.git'];

  isAvailable(): boolean {
    return process.env.V2_AGENT_ENABLED === 'true' || process.env.OPENCODE_CONTAINERIZED === 'true';
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { OpencodeV2Provider } = await import('../sandbox/spawn/opencode-cli');
    const { agentSessionManager } = await import('../session/agent/agent-session-manager');

    try {
      // Get or create session
      const session = await agentSessionManager.getOrCreateSession(
        context.userId,
        context.conversationId || 'default',
        { enableMCP: true, enableNullclaw: true, mode: 'hybrid', noSandbox: true }
      );

      const provider = new OpencodeV2Provider({
        session: {
          userId: context.userId,
          conversationId: context.conversationId || 'default',
          enableMcp: true,
          enableNullclaw: true,
          workspaceDir: session.workspacePath,
        },
        sandboxHandle: session.sandboxHandle,
      });

      if (capabilityId === 'sandbox.execute' || capabilityId === 'sandbox.shell') {
        const command = capabilityId === 'sandbox.execute'
          ? `run ${input.language} code: ${input.code}`
          : input.command;

        // Get project context for the system prompt (lightweight — just file listing)
        let smartContextMd = '';
        let projectRoot = '';
        try {
          const { buildProjectContext, formatSmartContextAsMarkdown } = await import('../project-detection');
          const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
          const ownerId = context.userId || 'default';
          const workspace = await virtualFilesystem.exportWorkspace(ownerId);
          const filePaths = workspace.files.map(f => f.path);

          const projectContext = await buildProjectContext(filePaths, async (path: string) => {
            if (path === 'package.json' || path === '/package.json') {
              try {
                const file = await virtualFilesystem.readFile(ownerId, path.replace(/^\//, ''));
                return file.content;
              } catch { return null; }
            }
            return null;
          });

          smartContextMd = formatSmartContextAsMarkdown(projectContext.smartContext);
          projectRoot = projectContext.projectRoot || '';
        } catch {
          // Project detection failed — LLM will work without it
        }

        // Build the tool set for the LLM: extended sandbox tools including
        // terminal sessions, project analysis, and port status.
        const { EXTENDED_SANDBOX_TOOLS, mapToolToCapability } = await import('../sandbox/extended-sandbox-tools');

        // Resolve cwd
        let resolvedCwd: string | undefined;
        if (input.cwd) {
          try {
            const { resolveVfsPathToRealPath } = await import('../project-detection');
            resolvedCwd = resolveVfsPathToRealPath(input.cwd, session.workspacePath || process.cwd());
          } catch {
            resolvedCwd = input.cwd;
          }
        }

        const systemPrompt = smartContextMd
          ? `${smartContextMd}\n\nWorking directory: ${input.cwd || projectRoot || session.workspacePath || ''}\n\n` +
            `Available tools: exec_shell, write_file, read_file, list_dir, project_analyze, ` +
            `project_list_scripts, project_dependencies, project_structure, terminal_create_session, ` +
            `terminal_send_input, terminal_get_output, port_status.\n` +
            `If the command looks like natural language (e.g., "run the project"), ` +
            `first call project_analyze to detect the framework and recommended commands.`
          : `Working directory: ${input.cwd || session.workspacePath || ''}\n\n` +
            `Available tools: exec_shell, write_file, read_file, list_dir, project_analyze, ` +
            `project_list_scripts, project_dependencies, project_structure, terminal_create_session, ` +
            `terminal_send_input, terminal_get_output, port_status.`;

        const result = await provider.runAgentLoop({
          userMessage: command,
          tools: [...EXTENDED_SANDBOX_TOOLS] as any,
          systemPrompt,
          maxSteps: 8,
          executeTool: async (name: string, args: Record<string, any>): Promise<any> => {
            // exec_shell / sandbox.shell must NOT go through the capability router
            // because that would route back to OpenCodeV2Provider → infinite recursion.
            // Instead, execute directly on the provider.
            if (name === 'exec_shell' || name === 'sandbox.shell' || name === 'sandbox.execute') {
              const cmd = args.command || args.code || '';
              const cwd = args.cwd || resolvedCwd;
              const timeout = args.timeout || 30;
              return provider.executeCommandDirect(cmd, cwd || '', timeout, true);
            }

            // All other tools go through the capability router
            const capId = mapToolToCapability(name);
            const router = getCapabilityRouter();
            const routerResult = await router.execute(capId, args, {
              userId: context.userId,
              conversationId: context.conversationId || 'default',
            });
            return {
              success: routerResult.success,
              output: (routerResult as any).data || routerResult.output,
              exitCode: (routerResult as any).exitCode ?? (routerResult.success ? 0 : 1),
              error: routerResult.error,
            };
          },
          cwd: resolvedCwd,
          enableSelfHeal: true,
        });

        return {
          success: true,
          output: {
            success: true,
            output: result.response,
            exitCode: 0,
          },
        };
      }

      return { success: false, error: `Unhandled capability: ${capabilityId}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Nullclaw Provider - handles web browsing and automation
 */
class NullclawProvider implements CapabilityProvider {
  readonly id = 'nullclaw';
  readonly name = 'Nullclaw';
  readonly capabilities = ['web.browse', 'web.search', 'automation.discord', 'automation.telegram', 'automation.workflow'];

  async isAvailable(): Promise<boolean> {
    const { isNullclawAvailable } = await import('@bing/shared/agent/nullclaw-integration');
    return isNullclawAvailable();
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const {
      browseNullclawUrl,
      sendNullclawDiscordMessage,
      sendNullclawTelegramMessage,
      executeNullclawTask,
    } = await import('@bing/shared/agent/nullclaw-integration');

    try {
      switch (capabilityId) {
        case 'web.browse': {
          if (!input.url) {
            return { success: false, error: 'Missing required field: url' };
          }
          const result = await browseNullclawUrl(input.url, input.action, context.userId, context.conversationId);
          return {
            success: result.status === 'completed',
            output: result.result,
            error: result.error,
          };
        }

        case 'web.search': {
          if (!input.query) {
            return { success: false, error: 'Missing required field: query' };
          }
          // Use DuckDuckGo HTML for web search
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
          const result = await browseNullclawUrl(searchUrl, 'extract', context.userId, context.conversationId);
          return {
            success: result.status === 'completed',
            output: {
              results: result.result?.slice(0, input.limit || 10).map((r: any) => ({
                title: r.title || 'No title',
                url: r.link || r.url || '',
                snippet: r.snippet || r.text || '',
              })),
              query: input.query,
            },
            error: result.error,
          };
        }

        case 'automation.discord': {
          const result = await sendNullclawDiscordMessage(
            input.channelId,
            input.message,
            context.userId,
            context.conversationId
          );
          return {
            success: result.status === 'completed',
            output: result.result,
            error: result.error,
          };
        }

        case 'automation.telegram': {
          const result = await sendNullclawTelegramMessage(
            input.chatId,
            input.message,
            context.userId,
            context.conversationId
          );
          return {
            success: result.status === 'completed',
            output: result.result,
            error: result.error,
          };
        }

        case 'automation.workflow': {
          const taskType = input.trigger === 'scheduled' ? 'schedule' : 'automate';
          const result = await executeNullclawTask(
            taskType,
            `Execute workflow: ${input.workflow}`,
            input.params || {},
            context.userId,
            context.conversationId
          );
          return {
            success: result.status === 'completed',
            output: result.result,
            error: result.error,
          };
        }

        default:
          return { success: false, error: `Unknown capability: ${capabilityId}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Native Web Fetch Provider - fetches URL content using native fetch()
 * Provides web.fetch capability without requiring external services
 */
class NativeWebFetchProvider implements CapabilityProvider {
  readonly id = 'native';
  readonly name = 'Native Web Fetch';
  readonly capabilities = ['web.fetch'];

  isAvailable(): boolean {
    // Native fetch is always available in modern environments
    return typeof fetch !== 'undefined';
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (capabilityId !== 'web.fetch') {
      return { success: false, error: `Unknown capability: ${capabilityId}` };
    }

    if (!input.url) {
      return { success: false, error: 'Missing required field: url' };
    }

    const maxChars = input.maxChars || 8000;

    try {
      const response = await fetch(input.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BingAgent/1.0)',
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          output: {
            success: false,
            url: input.url,
            statusCode: response.status,
            contentType: response.headers.get('content-type') || 'unknown',
          },
        };
      }

      const contentType = response.headers.get('content-type') || 'text/plain';
      const text = await response.text();

      // Truncate if exceeds maxChars
      const truncated = text.length > maxChars;
      const content = truncated ? text.substring(0, maxChars) + '\n... [truncated]' : text;

      return {
        success: true,
        output: {
          success: true,
          content,
          url: input.url,
          statusCode: response.status,
          contentType,
          truncated,
          originalLength: text.length,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to fetch URL',
        output: {
          success: false,
          url: input.url,
        },
      };
    }
  }
}

/**
 * Blaxel Provider - handles repo search and analysis
 */
class BlaxelProvider implements CapabilityProvider {
  readonly id = 'blaxel';
  readonly name = 'Blaxel';
  readonly capabilities = ['repo.search', 'repo.analyze'];

  async isAvailable(): Promise<boolean> {
    // Blaxel service not currently available
    return false;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // Blaxel service not currently available
    return { success: false, error: 'Blaxel service not currently available' };
  }
}

/**
 * Context Pack Provider - generates project context bundles
 */
class ContextPackProvider implements CapabilityProvider {
  readonly id = 'context-pack';
  readonly name = 'Context Pack';
  readonly capabilities = ['memory.store', 'memory.context', 'project.bundle'];

  isAvailable(): boolean {
    // Context pack service is always available when VFS is available
    return !!process.env.VFS_ROOT || !!process.env.VIRTUAL_FS_ENABLED;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { contextPackService } = await import('../virtual-filesystem/context-pack-service');

    try {
      // Input validation for project.bundle
      if (capabilityId === 'project.bundle' && !input.path && !input.scopePath) {
        return { success: false, error: 'Missing required field: path or scopePath' };
      }

      const ownerId = input.ownerId || context.userId;
      const scopePath = input.path || input.scopePath || '/';

      const result = await contextPackService.generateContextPack(
        ownerId,
        scopePath,
        {
          format: input.format || 'markdown',
          maxFileSize: input.maxFileSize,
          maxTotalSize: input.maxTotalSize,
          includePatterns: input.includePatterns,
          excludePatterns: input.excludePatterns,
          includeContents: input.includeContents !== false,
          includeTree: input.includeTree !== false,
          maxLinesPerFile: input.maxLinesPerFile,
          lineNumbers: input.lineNumbers,
        }
      );

      return {
        success: true,
        output: {
          bundle: result.bundle,
          tree: result.tree,
          files: result.files,
          fileCount: result.fileCount,
          estimatedTokens: result.estimatedTokens,
          totalSize: result.totalSize,
          format: result.format,
          hasTruncation: result.hasTruncation,
          warnings: result.warnings,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Embedding Search Provider - semantic code search
 */
class EmbeddingSearchProvider implements CapabilityProvider {
  readonly id = 'embedding-search';
  readonly name = 'Embedding Search';
  readonly capabilities = ['repo.search', 'repo.semantic-search'];

  async isAvailable(): Promise<boolean> {
    // Check if embeddings are configured
    return !!process.env.EMBEDDING_PROVIDER || !!process.env.OPENAI_API_KEY;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    try {
      // Try CrewAI knowledge base first
      const { KnowledgeBase } = await import('../crewai/knowledge');
      const kb = new KnowledgeBase();

      if (capabilityId === 'repo.semantic-search' || input.semantic) {
        // Use semantic search via knowledge base
        const limit = input.limit || 10;
        const results = await kb.search(input.query, limit);

        // Filter by threshold if specified
        const threshold = input.similarityThreshold || 0.7;
        const filteredResults = results.filter((r: any) => r.score >= threshold);

        return {
          success: true,
          output: {
            results: filteredResults.map((r: any) => ({
              content: r.content,
              score: r.score,
              source: r.metadata?.source,
            })),
            total: filteredResults.length,
            type: 'semantic',
          },
        };
      }

      return { success: false, error: 'Embedding search requires semantic=true' };
    } catch (error: any) {
      return { success: false, error: `Embedding search failed: ${error.message}` };
    }
  }
}

/**
 * Git Helper Provider - Git operations in sandbox
 */
class GitHelperProvider implements CapabilityProvider {
  readonly id = 'git-helper';
  readonly name = 'Git Helper';
  readonly capabilities = ['repo.git', 'repo.clone', 'repo.commit', 'repo.push', 'repo.pull'];

  isAvailable(): boolean {
    return process.env.E2B_API_KEY !== undefined || process.env.OPENCODE_CONTAINERIZED === 'true';
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { agentSessionManager } = await import('../session/agent/agent-session-manager');
    const { E2BGitHelper } = await import('../virtual-filesystem/e2b-git-helper');

    try {
      // Get session with sandbox
      const session = await agentSessionManager.getOrCreateSession(
        context.userId,
        context.conversationId || 'default',
        { enableMCP: true, enableNullclaw: false, mode: 'opencode', noSandbox: false }
      );

      if (!session.sandboxHandle) {
        return { success: false, error: 'Sandbox not available for Git operations' };
      }

      const git = new E2BGitHelper(session.sandboxHandle);

      switch (capabilityId) {
        case 'repo.clone': {
          // Input validation
          if (!input.url) {
            return { success: false, error: 'Missing required field: url' };
          }
          const result = await git.clone({
            url: input.url,
            path: input.path,
            username: input.username,
            password: input.password,
            branch: input.branch,
            depth: input.depth,
            recursive: input.recursive,
          });
          return {
            success: result.success,
            output: result,
            error: result.error,
          };
        }

        case 'repo.commit': {
          // Input validation
          if (!input.message) {
            return { success: false, error: 'Missing required field: message' };
          }
          const result = await git.commit({
            message: input.message,
            authorName: input.authorName,
            authorEmail: input.authorEmail,
            files: input.files,
          }, input.cwd);
          return {
            success: result.success,
            output: result,
            error: result.error,
          };
        }

        case 'repo.push': {
          // Input validation - remote and branch optional but recommended
          if (!input.remote && !input.branch) {
            return { success: false, error: 'Missing required field: remote or branch' };
          }
          const result = await git.push({
            remote: input.remote,
            branch: input.branch,
            username: input.username,
            password: input.password,
            force: input.force,
          }, input.cwd);
          return {
            success: result.success,
            output: result,
            error: result.error,
          };
        }

        case 'repo.pull': {
          const result = await git.pull(input.cwd);
          return {
            success: result,
            output: { success: result },
          };
        }

        case 'repo.git': {
          // Input validation - command is required for generic git
          if (!input.command) {
            return { success: false, error: 'Missing required field: command' };
          }
          // Generic git command
          const cwd = input.cwd || session.workspacePath;
          const result = await session.sandboxHandle.executeCommand(input.command, cwd);
          return {
            success: result.success,
            output: {
              stdout: result.output,
              exitCode: result.exitCode,
            },
            error: result.success ? undefined : result.output,
          };
        }

        default:
          return { success: false, error: `Unknown capability: ${capabilityId}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Task Provider - handles task/plan management capabilities
 */
class TaskProvider implements CapabilityProvider {
  readonly id = 'memory-service';
  readonly name = 'Task Manager';
  readonly capabilities = [
    'task.list', 'task.create', 'task.edit', 'task.delete', 'task.search',
    'task.getUnfinished', 'memory.store', 'memory.retrieve'
  ];

  private taskStore: any = null;

  async isAvailable(): Promise<boolean> {
    try {
      const { getTaskStore } = await import('../memory/task-persistence');
      this.taskStore = getTaskStore();
      return true;
    } catch {
      return false;
    }
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (!this.taskStore) {
      await this.isAvailable();
    }
    if (!this.taskStore) {
      return { success: false, error: 'Task store not available' };
    }

    try {
      switch (capabilityId) {
        case 'task.list': {
          const filter: any = {};
          if (input.status) filter.status = [input.status];
          if (input.retention) filter.retention = [input.retention];
          if (input.tags) filter.tags = input.tags;
          const tasks = this.taskStore.getAll(filter).slice(0, input.limit || 20);
          return {
            success: true,
            output: tasks.map(t => ({
              id: t.id, title: t.title, description: t.description,
              status: t.status, retention: t.retention, priority: t.priority,
              progress: t.progress, steps: t.steps, tags: t.tags,
              createdAt: t.createdAt, updatedAt: t.updatedAt,
            })),
          };
        }

        case 'task.create': {
          const task = await this.taskStore.create({
            title: input.title,
            description: input.description,
            steps: input.steps?.map((s: any, i: number) => ({
              description: s.description,
              order: s.order ?? i,
            })),
            priority: input.priority ?? 50,
            retention: input.retention ?? 'queued',
            tags: input.tags ?? [],
            parentId: input.parentId,
            dueDate: input.dueDate,
          });
          return {
            success: true,
            output: {
              success: true,
              task: { id: task.id, title: task.title, status: task.status, steps: task.steps },
            },
          };
        }

        case 'task.edit': {
          const updates: any = {};
          if (input.title) updates.title = input.title;
          if (input.description) updates.description = input.description;
          if (input.priority !== undefined) updates.priority = input.priority;
          if (input.tags) updates.tags = input.tags;
          if (input.status) updates.status = input.status;

          if (input.addSteps) {
            await this.taskStore.appendSteps(input.taskId, input.addSteps);
          }
          if (input.editStep) {
            await this.taskStore.editStep(input.taskId, input.editStep.stepId, {
              description: input.editStep.description,
              status: input.editStep.status,
              notes: input.editStep.notes,
            });
          }
          if (input.reorderSteps) {
            await this.taskStore.reorderSteps(input.taskId, input.reorderSteps);
          }

          const task = await this.taskStore.update(input.taskId, updates);
          return {
            success: !!task,
            output: {
              success: !!task,
              task: task ? { id: task.id, title: task.title, steps: task.steps } : null,
            },
          };
        }

        case 'task.delete': {
          const deleted = await this.taskStore.delete(input.taskId);
          return { success: deleted, output: { success: deleted } };
        }

        case 'task.search': {
          const tasks = this.taskStore.search(input.query).slice(0, input.limit || 10);
          return {
            success: true,
            output: tasks.map(t => ({
              id: t.id, title: t.title, description: t.description,
              status: t.status, tags: t.tags,
            })),
          };
        }

        case 'task.getUnfinished': {
          const tasks = this.taskStore.getUnfinishedTasks({
            limit: input.limit ?? 10,
            minAge: input.minAgeMs,
          });
          return {
            success: true,
            output: tasks.map(t => ({
              id: t.id, title: t.title, status: t.status,
              priority: t.priority, progress: t.progress, updatedAt: t.updatedAt,
            })),
          };
        }

        default:
          return { success: false, error: `Unknown task capability: ${capabilityId}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Memory Service Provider - key-value storage with TTL and namespaces
 * Uses KV store for persistent storage (Redis/SQLite/in-memory)
 */
class MemoryServiceProvider implements CapabilityProvider {
  readonly id = 'memory-service-kv';
  readonly name = 'Memory Service';
  readonly capabilities = ['memory.store', 'memory.retrieve'];

  // KV store instance (initialized on first use)
  private kvStore: any = null;

  async isAvailable(): Promise<boolean> {
    try {
      const { getKVStore } = await import('../utils/kv-store');
      this.kvStore = getKVStore();
      return true;
    } catch (error: any) {
      logger.warn('KV store not available', error.message);
      return true; // Still available with fallback
    }
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    if (!this.kvStore) {
      return { success: false, error: 'KV store not initialized' };
    }

    try {
      switch (capabilityId) {
        case 'memory.store': {
          if (!input.key) {
            return { success: false, error: 'Missing required field: key' };
          }
          if (input.value === undefined) {
            return { success: false, error: 'Missing required field: value' };
          }

          await this.kvStore.set(input.key, input.value, {
            ttl: input.ttl,
            namespace: input.namespace,
          });

          return {
            success: true,
            output: {
              key: input.key,
              namespace: input.namespace || 'default',
              stored: true,
              expiresAt: input.ttl ? new Date(Date.now() + input.ttl * 1000).toISOString() : null,
            },
          };
        }

        case 'memory.retrieve': {
          // If key is provided, retrieve specific key; otherwise search by query
          if (input.key) {
            const value = await this.kvStore.get(input.key, { namespace: input.namespace });

            if (value === null || value === undefined) {
              return {
                success: true,
                output: {
                  key: input.key,
                  namespace: input.namespace || 'default',
                  found: false,
                  value: null,
                },
              };
            }

            return {
              success: true,
              output: {
                key: input.key,
                namespace: input.namespace || 'default',
                found: true,
                value,
                timestamp: new Date().toISOString(),
              },
            };
          }

          // Search by query
          if (input.query) {
            const results = await this.kvStore.search(input.query, {
              namespace: input.namespace,
              limit: input.limit || 10,
            });

            return {
              success: true,
              output: results,
            };
          }

          return {
            success: false,
            error: 'Either key or query must be provided',
          };
        }

        default:
          return {
            success: false,
            error: `Unknown memory capability: ${capabilityId}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Memory operation failed: ${error.message}`,
      };
    }
  }
}

/**
 * Ripgrep Provider - handles text search in files
 * SECURITY: Uses execFileSync to prevent command injection
 */
class RipgrepProvider implements CapabilityProvider {
  readonly id = 'ripgrep';
  readonly name = 'Ripgrep';
  readonly capabilities = ['file.search', 'repo.search'];

  async isAvailable(): Promise<boolean> {
    // Check if rg is actually installed (cross-platform)
    try {
      const { execSync } = await import('child_process');
      const isWindows = process.platform === 'win32';

      // Try different commands based on platform
      const checkCmd = isWindows
        ? 'where rg 2>nul || echo FAIL'
        : 'which rg || command -v rg || echo FAIL';

      const result = execSync(checkCmd, { stdio: 'pipe', encoding: 'utf-8' });
      return !result.includes('FAIL') && result.trim().length > 0;
    } catch {
      return false;
    }
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { execFileSync } = await import('child_process');

    try {
      const searchPath = input.path || '.';
      const maxResults = input.maxResults || 50;

      // SECURITY: Use execFileSync with arguments array to prevent command injection
      const output = execFileSync('rg', [
        '-n',
        '--max-count',
        String(maxResults),
        input.query,
        searchPath,
      ], { encoding: 'utf-8', timeout: 30000 });

      const results = output.split('\n')
        .filter(line => line.trim())
        .slice(0, maxResults)
        .map(line => {
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (match) {
            return { path: match[1], line: parseInt(match[2]), content: match[3] };
          }
          return { content: line };
        });

      return { success: true, output: results };
    } catch (error: any) {
      // No matches or error
      return { success: true, output: [] };
    }
  }
}

// ============================================================================
// Router Implementation
// ============================================================================

/**
 * OAuth Integration Provider - handles Nango/Composio/Arcade integration capabilities
 */
class OAuthIntegrationProvider implements CapabilityProvider {
  readonly id = 'oauth-integration';
  readonly name = 'OAuth Integration (Nango/Composio/Arcade)';
  readonly capabilities = [
    'integration.connect',
    'integration.execute',
    'integration.list_connections',
    'integration.revoke',
    'integration.search_tools',
    'integration.proxy',
  ];

  isAvailable(): boolean {
    // Available if any of the integration providers is configured
    return !!(
      process.env.NANGO_SECRET_KEY ||
      process.env.NANGO_API_KEY ||
      process.env.ARCADE_API_KEY ||
      process.env.COMPOSIO_API_KEY
    );
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    try {
      const { getNangoService } = await import('../integrations/nango-service');
      const { getArcadeService } = await import('../integrations/arcade-service');
      const { getToolManager } = await import('../tools');

      switch (capabilityId) {
        case 'integration.connect': {
          // Initiate OAuth connection
          const { provider, userId, redirectUrl, scopes } = input;

          // Use tool authorization manager to get auth URL
          const { toolAuthManager } = await import('../tools/tool-authorization-manager');
          const authUrl = toolAuthManager.getAuthorizationUrl(provider);
          
          return {
            success: true,
            output: {
              success: true,
              authUrl,
              provider,
              requiresAuth: true,
            },
          };
        }

        case 'integration.execute': {
          // Execute tool via integration provider
          const { provider, action, userId, params, connectionId } = input;
          const toolName = `${provider}.${action}`;

          // Use consolidated ToolIntegrationManager
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(toolName, params, {
            userId,
            conversationId: connectionId,
          });

          return {
            success: result.success,
            output: result.output,
            error: result.error,
            authRequired: result.authRequired,
            authUrl: result.authUrl,
          };
        }

        case 'integration.list_connections': {
          // List user connections
          const { userId, provider } = input;

          const nangoService = getNangoService();
          if (nangoService) {
            const connections = await nangoService.getConnections(userId);
            return {
              success: true,
              output: connections.map((c: any) => ({
                id: c.id,
                provider: c.provider,
                providerConfigKey: c.providerConfigKey,
                connectionId: c.connectionId,
                status: 'active',
                createdAt: c.created,
              })),
            };
          }

          const arcadeService = getArcadeService();
          if (arcadeService) {
            // Arcade doesn't have a direct list connections API, return empty
            return {
              success: true,
              output: [],
            };
          }

          return {
            success: false,
            error: 'No integration provider available for listing connections',
          };
        }

        case 'integration.revoke': {
          // Revoke connection
          const { provider, userId, connectionId } = input;

          const nangoService = getNangoService();
          if (nangoService && nangoService.deleteConnection) {
            await nangoService.deleteConnection(provider, connectionId || userId);
            return {
              success: true,
              output: {
                success: true,
                provider,
                revoked: true,
              },
            };
          }

          return {
            success: false,
            error: 'No integration provider available for revoking connections',
          };
        }

        case 'integration.search_tools': {
          // Search available tools
          const { query, provider, category, requiresAuth, limit } = input;

          // Use consolidated ToolIntegrationManager for tool search
          const toolManager = getToolManager();
          const tools = await toolManager.searchTools(query);

          // Filter by provider if specified
          let filtered = tools;
          if (provider) {
            filtered = tools.filter(t => t.provider === provider);
          }

          // Filter by auth requirement if specified
          if (requiresAuth !== undefined) {
            filtered = filtered.filter(t => t.requiresAuth === requiresAuth);
          }

          return {
            success: true,
            output: filtered.slice(0, limit || 20).map(t => ({
              name: t.toolName,
              description: t.description,
              provider: t.provider,
              category: t.category,
              requiresAuth: t.requiresAuth,
            })),
          };
        }

        case 'integration.proxy': {
          // Proxy API request
          const { provider, userId, endpoint, method, headers, params, data } = input;

          const nangoService = getNangoService();
          if (nangoService) {
            const response = await nangoService.proxy({
              providerConfigKey: provider,
              connectionId: userId,
              endpoint,
              method: method as any,
              headers,
              params,
              data,
            });

            return {
              success: response.status >= 200 && response.status < 300,
              output: {
                success: true,
                status: response.status,
                data: response.data,
                headers: response.headers,
              },
            };
          }

          return {
            success: false,
            error: 'No integration provider available for proxy requests',
          };
        }

        default:
          return {
            success: false,
            error: `Unknown integration capability: ${capabilityId}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Integration provider error: ${error.message}`,
      };
    }
  }
}

/**
 * Terminal Provider — handles interactive terminal/PTY operations
 *
 * Provides:
 * - terminal.create_session, terminal.send_input, terminal.get_output
 * - terminal.resize, terminal.close_session, terminal.list_sessions
 * - terminal.start_process, terminal.stop_process, terminal.list_processes
 * - terminal.get_port_status
 */
class TerminalProvider implements CapabilityProvider {
  readonly id = 'terminal';
  readonly name = 'Terminal / PTY';
  readonly capabilities = [
    'terminal.create_session',
    'terminal.send_input',
    'terminal.get_output',
    'terminal.resize',
    'terminal.close_session',
    'terminal.list_sessions',
    'terminal.start_process',
    'terminal.stop_process',
    'terminal.list_processes',
    'terminal.get_port_status',
  ];

  isAvailable(): boolean {
    // Terminal manager is always available (in-memory singleton)
    return true;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      const {
        createTerminalSession,
        sendTerminalInput,
        getTerminalOutput,
        resizeTerminal,
        closeTerminalSession,
        listTerminalSessions,
        startProcess,
        stopProcess,
        listProcesses,
        getPortStatus,
      } = await import('./terminal');

      const userId = context.userId || 'default';

      switch (capabilityId) {
        case 'terminal.create_session':
          return { success: true, output: await createTerminalSession(userId, input) };

        case 'terminal.send_input':
          return {
            success: true,
            output: await sendTerminalInput(input.sessionId, input.input),
          };

        case 'terminal.get_output':
          return {
            success: true,
            output: await getTerminalOutput(input.sessionId, {
              lines: input.lines,
              waitForPattern: input.waitForPattern,
              timeoutMs: input.timeoutMs,
            }),
          };

        case 'terminal.resize':
          return {
            success: true,
            output: await resizeTerminal(input.sessionId, input.cols, input.rows),
          };

        case 'terminal.close_session':
          return {
            success: true,
            output: await closeTerminalSession(input.sessionId),
          };

        case 'terminal.list_sessions':
          return { success: true, output: await listTerminalSessions(userId) };

        case 'terminal.start_process':
          return {
            success: true,
            output: await startProcess(input.command, {
              userId,
              cwd: input.cwd,
              env: input.env,
              timeout: input.timeout,
            }),
          };

        case 'terminal.stop_process':
          return {
            success: true,
            output: await stopProcess(input.pid, {
              userId,
              signal: input.signal,
            }),
          };

        case 'terminal.list_processes':
          return {
            success: true,
            output: await listProcesses({ userId, filter: input.filter }),
          };

        case 'terminal.get_port_status':
          return {
            success: true,
            output: await getPortStatus({ userId, port: input.port }),
          };

        default:
          return {
            success: false,
            error: `Unknown terminal capability: ${capabilityId}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Terminal provider error: ${error.message}`,
      };
    }
  }
}

/**
 * Provider ID Enum - Type-safe provider identifiers.
 * Using this enum instead of string[] prevents typos from silently failing.
 */
export enum ProviderId {
  VFS = 'vfs',
  LOCAL_FS = 'local-fs',
  MCP_FILESYSTEM = 'mcp-filesystem',
  OPENCODE_V2 = 'opencode-v2',
  NULLCLAW = 'nullclaw',
  BLAXEL = 'blaxel',
  MEMORY_SERVICE = 'memory-service',
  RIPGREP = 'ripgrep',
  CONTEXT_PACK = 'context-pack',
  EMBEDDING_SEARCH = 'embedding-search',
  GIT_HELPER = 'git-helper',
  OAUTH_INTEGRATION = 'oauth-integration',
  TERMINAL = 'terminal',
  PROJECT_ANALYSIS = 'project-analysis',
  CUSTOM = 'custom', // For dynamically registered providers
}

/**
 * Dynamic provider registration options.
 * Allows runtime registration of custom providers with full control over capabilities.
 */
export interface ProviderRegistrationOptions {
  /** Unique provider ID (use ProviderId.CUSTOM for auto-generated ID) */
  id?: string;
  /** Human-readable name */
  name: string;
  /** Capabilities this provider supports */
  capabilities: string[];
  /** Availability check function */
  isAvailable: () => boolean | Promise<boolean>;
  /** Execution function for capability calls */
  execute: (
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;
  /** Priority in provider list (higher = checked first) */
  priority?: number;
}

/**
 * Capability Router - selects and executes capabilities via providers
 */
export class CapabilityRouter {
  private providers = new Map<string, CapabilityProvider>();
  private initialized = false;
  /** Optional reference to bootstrapped agency for adaptive routing */
  private agency: any = null;

  /**
   * Set the bootstrapped agency instance for adaptive routing.
   * When set, the router uses learned capability success rates
   * to influence provider selection.
   */
  setAgency(agency: any): void {
    this.agency = agency;
  }

  /**
   * Register a provider
   */
  registerProvider(provider: CapabilityProvider): void {
    this.providers.set(provider.id, provider);
    logger.info(`[CapabilityRouter] Registered provider: ${provider.name} (${provider.id})`);
  }

  /**
   * Dynamically register a custom provider at runtime.
   * Returns the provider ID for use in capability definitions.
   */
  async registerCustomProvider(options: ProviderRegistrationOptions): Promise<string> {
    const providerId = options.id || `custom-${options.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const customProvider: CapabilityProvider = {
      id: providerId,
      name: options.name,
      capabilities: options.capabilities,
      isAvailable: options.isAvailable,
      execute: options.execute,
    };

    this.registerProvider(customProvider);
    return providerId;
  }

  /**
   * Unregister a provider by ID.
   * Returns true if provider was found and removed.
   */
  unregisterProvider(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  /**
   * Get list of registered provider IDs.
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get a provider by ID.
   */
  getProvider<T extends CapabilityProvider = CapabilityProvider>(providerId: string): T | undefined {
    return this.providers.get(providerId) as T | undefined;
  }

  /**
   * Initialize with built-in providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register built-in providers
    this.registerProvider(new VFSProvider());
    this.registerProvider(new LocalFilesystemProvider());
    this.registerProvider(new MCPFilesystemProvider());
    this.registerProvider(new OpenCodeV2Provider());
    this.registerProvider(new NullclawProvider());
    this.registerProvider(new NativeWebFetchProvider());
    this.registerProvider(new BlaxelProvider());
    // Register TaskProvider first (handles task.* + memory.* via task store)
    this.registerProvider(new TaskProvider());
    // Register MemoryServiceProvider for KV store operations (renamed to avoid ID conflict)
    this.registerProvider(new MemoryServiceProvider());
    this.registerProvider(new RipgrepProvider());
    this.registerProvider(new ContextPackProvider());
    this.registerProvider(new EmbeddingSearchProvider());
    this.registerProvider(new GitHelperProvider());
    // Register OAuth integration provider (Nango/Composio/Arcade)
    this.registerProvider(new OAuthIntegrationProvider());
    // Register Terminal provider (PTY, process management, port status)
    this.registerProvider(new TerminalProvider());

    this.initialized = true;
    logger.info(`[CapabilityRouter] Initialized with ${this.providers.size} providers`);
  }

  /**
   * Get the best available provider for a capability (synchronous check)
   * For async checks, the provider will be validated during execution
   */
  private selectProvider(capability: CapabilityDefinition, latencyBudget?: LatencyBudget): CapabilityProvider | null {
    const availableProviders: Array<{ provider: CapabilityProvider; score: number }> = [];

    for (const providerId of capability.providerPriority) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const available = provider.isAvailable();

      // Handle both sync and async availability checks
      if (available === true || available instanceof Promise) {
        // Score this provider based on metadata
        const score = this.scoreProvider(providerId, capability, latencyBudget);
        availableProviders.push({ provider, score });
      }
    }

    // Return highest scored provider
    if (availableProviders.length > 0) {
      availableProviders.sort((a, b) => b.score - a.score);
      return availableProviders[0].provider;
    }

    return null;
  }

  /**
   * Score a provider based on capability metadata and learned agency data
   * Higher score = better choice
   */
  private scoreProvider(providerId: string, capability: CapabilityDefinition, latencyBudget?: LatencyBudget): number {
    let score = 100; // Base score

    // Apply metadata-based scoring
    if (capability.metadata) {
      // Latency scoring (adjust based on budget)
      if (latencyBudget === 'fast') {
        // For fast budget, heavily penalize high-latency providers
        if (capability.metadata.latency === 'low') score += 30;
        else if (capability.metadata.latency === 'medium') score -= 10;
        else if (capability.metadata.latency === 'high') score -= 40;
      } else if (latencyBudget === 'quality') {
        // For quality budget, reward accuracy over speed
        if (capability.metadata.latency === 'high') score += 15;
        else if (capability.metadata.latency === 'low') score -= 5;
      } else {
        // Balanced: default latency scoring
        if (capability.metadata.latency === 'low') score += 20;
        else if (capability.metadata.latency === 'medium') score += 10;
        else if (capability.metadata.latency === 'high') score -= 10;
      }

      // Cost scoring
      if (capability.metadata.cost === 'low') score += 15;
      else if (capability.metadata.cost === 'medium') score += 5;
      else if (capability.metadata.cost === 'high') score -= 15;

      // Reliability scoring (0.0 - 1.0)
      if (capability.metadata.reliability) {
        score += capability.metadata.reliability * 30;
      }
    }

    // Provider priority bonus (earlier in list = higher priority)
    const priorityIndex = capability.providerPriority.indexOf(providerId);
    if (priorityIndex >= 0) {
      score += (capability.providerPriority.length - priorityIndex) * 5;
    }

    // Agency adaptive scoring — if agency has learned success rates for this
    // capability, boost providers with higher historical success
    if (this.agency && typeof this.agency.getCapabilitySuccessRate === 'function') {
      const rate = this.agency.getCapabilitySuccessRate(capability.id, providerId);
      if (typeof rate === 'number') {
        score += rate * 50; // Up to +50 for high success rate
      }
    }

    return score;
  }

  /**
   * Execute a capability - routes to best available provider
   * Uses intelligent provider selection based on metadata scoring
   * with self-healing retry on failure.
   */
  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    await this.initialize();

    const capability = getCapability(capabilityId);
    if (!capability) {
      return { success: false, error: `Unknown capability: ${capabilityId}` };
    }

    // SECURITY: Validate input against the capability's Zod schema before forwarding.
    const parsed = capability.inputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      logger.warn(`[CapabilityRouter] Input validation failed for ${capabilityId}`, {
        errors: fieldErrors,
        inputKeys: Object.keys(input || {}),
      });
      return {
        success: false,
        error: `Invalid input for ${capabilityId}: ${fieldErrors}`,
      };
    }

    const validatedInput = parsed.data;

    // Check permissions if specified
    if (capability.permissions && capability.permissions.length > 0) {
      const hasPermission = this.checkPermissions(capability.permissions, context);
      if (!hasPermission) {
        return {
          success: false,
          error: `Permission denied. Required: ${capability.permissions.join(', ')}`,
        };
      }
    }

    // Extract latency budget from context for provider selection
    const latencyBudget: LatencyBudget | undefined = context.latencyBudget;

    // Try execution with self-healing retry
    return this.executeWithSelfHeal(capabilityId, validatedInput, context, capability, 2, latencyBudget);
  }

  /**
   * Execute a capability with LLM-based self-healing retry.
   * If all providers fail, the LLM analyzes the error and suggests
   * a fix, then retries with the corrected input.
   */
  private async executeWithSelfHeal(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext,
    capability: CapabilityDefinition,
    maxAttempts: number = 2,
    latencyBudget?: LatencyBudget,
  ): Promise<ToolExecutionResult> {
    let lastError = '';
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      const result = await this.tryAllProviders(capabilityId, input, context, capability, latencyBudget);

      if (result.success) return result;

      lastError = result.error || 'Unknown error';

      // Don't self-heal if auth required or input is invalid
      if ((result as any).authRequired) return result;
      if (lastError.startsWith('Invalid input')) return result;

      // Last attempt — return the error
      if (attempt >= maxAttempts) break;

      // Try self-healing
      const healed = await this.selfHealAttempt(capabilityId, input, lastError, capability);
      if (!healed) {
        logger.debug(`[CapabilityRouter] Self-healing failed for ${capabilityId} (attempt ${attempt})`);
        break; // Can't heal — return original error
      }

      logger.info(`[CapabilityRouter] Self-healing ${capabilityId}: attempt ${attempt} → retrying with fixed input`);
      input = healed;
    }

    return {
      success: false,
      error: lastError || `All providers failed for ${capabilityId}`,
      fallbackChain: capability.providerPriority as any,
    };
  }

  /**
   * Try all providers in score order for a single attempt.
   */
  private async tryAllProviders(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext,
    capability: CapabilityDefinition,
    latencyBudget?: LatencyBudget,
  ): Promise<ToolExecutionResult> {
    const providerScores = this.getScoredProviders(capability, latencyBudget);
    const errors: string[] = [];

    for (const { providerId, provider, score } of providerScores) {
      let available = false;
      try {
        available = await Promise.resolve(provider.isAvailable());
      } catch {
        available = false;
      }

      if (!available) {
        logger.debug(`[CapabilityRouter] Provider ${provider.name} not available for ${capabilityId} (score: ${score})`);
        continue;
      }

      logger.debug(`[CapabilityRouter] Executing ${capabilityId} via ${provider.name} (score: ${score})`);

      try {
        const result = await provider.execute(capabilityId, input, context);

        if (result.success) {
          logger.debug(`[CapabilityRouter] ${capabilityId} succeeded via ${provider.name} (score: ${score})`);
          return {
            ...result,
            provider: provider.id as any,
          };
        }

        if (result.error) {
          errors.push(`${provider.name}: ${result.error}`);
        }

        if ((result as any).authRequired) return result;
      } catch (error: any) {
        errors.push(`${provider.name}: ${error.message}`);
        logger.debug(`[CapabilityRouter] Provider ${provider.name} failed:`, error.message);
      }
    }

    return {
      success: false,
      error: `All providers failed for ${capabilityId}: ${errors.join('; ')}`,
      fallbackChain: capability.providerPriority as any,
    };
  }

  /**
   * LLM-based self-healing: analyze the error and produce fixed input.
   * Uses a lightweight model for fast healing.
   */
  private async selfHealAttempt(
    capabilityId: string,
    originalInput: any,
    error: string,
    capability: CapabilityDefinition,
  ): Promise<Record<string, unknown> | null> {
    try {
      const { generateObject } = await import('ai');

      // Use a fast, cheap model for healing
      const { createMistral } = await import('@ai-sdk/mistral');
      const model = createMistral({ apiKey: process.env.MISTRAL_API_KEY || '' })('mistral-small-latest');

      const { object } = await generateObject({
        model,
        prompt: `A tool call failed. Fix the input arguments.

Capability: ${capabilityId}
Description: ${capability.description}
Original Input: ${JSON.stringify(originalInput, null, 2)}
Error: ${error}

Expected Schema:
${JSON.stringify(capability.inputSchema, null, 2)}

Return ONLY the corrected input object as JSON.`,
        schema: capability.inputSchema,
        maxOutputTokens: 500,
        temperature: 0.1,
      });

      return object as Record<string, unknown>;
    } catch (healError: any) {
      logger.debug(`[CapabilityRouter] Self-heal attempt failed for ${capabilityId}: ${healError.message}`);
      return null;
    }
  }

  /**
   * Get providers sorted by score (highest first)
   */
  private getScoredProviders(capability: CapabilityDefinition, latencyBudget?: LatencyBudget): Array<{
    providerId: string;
    provider: CapabilityProvider;
    score: number;
  }> {
    const scored: Array<{ providerId: string; provider: CapabilityProvider; score: number }> = [];

    for (const providerId of capability.providerPriority) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const score = this.scoreProvider(providerId, capability, latencyBudget);
      
      // Skip high-latency providers for 'fast' budget
      if (latencyBudget === 'fast' && capability.metadata?.latency === 'high') {
        continue;
      }
      
      scored.push({ providerId, provider, score });
    }

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Check if context has required permissions
   */
  private checkPermissions(required: string[], context: ToolExecutionContext): boolean {
    const userPermissions = (context.metadata?.permissions as string[]) || [];
    return required.every(p => userPermissions.includes(p));
  }

  /**
   * Get all capabilities with their provider status
   */
  async getCapabilityStatus(): Promise<Array<{
    capability: CapabilityDefinition;
    available: boolean;
    provider?: string;
  }>> {
    await this.initialize();

    const results: Array<{
      capability: CapabilityDefinition;
      available: boolean;
      provider?: string;
    }> = [];

    for (const capability of ALL_CAPABILITIES) {
      const provider = this.selectProvider(capability);
      results.push({
        capability,
        available: !!provider,
        provider: provider?.name,
      });
    }

    return results;
  }

  /**
   * Get all registered providers
   */
  getProviders(): CapabilityProvider[] {
    return Array.from(this.providers.values());
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let routerInstance: CapabilityRouter | null = null;

export function getCapabilityRouter(): CapabilityRouter {
  if (!routerInstance) {
    routerInstance = new CapabilityRouter();
  }
  return routerInstance;
}

/**
 * Wire a bootstrapped agency into the capability router for adaptive routing.
 * Call this after the agency is created (e.g., in StatefulAgent constructor).
 */
export function wireAgencyToRouter(agency: any): void {
  const router = getCapabilityRouter();
  router.setAgency(agency);
}

export async function initializeCapabilityRouter(): Promise<void> {
  const router = getCapabilityRouter();
  await router.initialize();
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute a capability directly
 */
export async function executeCapability(
  capabilityId: string,
  input: any,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const router = getCapabilityRouter();
  return router.execute(capabilityId, input, context);
}

/**
 * Execute a capability by name (shorthand)
 */
export async function executeCapabilityByName(
  name: string,
  input: any,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // Convert name to capability ID (e.g., 'file.read' -> 'file.read')
  return executeCapability(name, input, context);
}
