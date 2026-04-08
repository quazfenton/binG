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
import type { ToolExecutionContext, ToolExecutionResult } from './tool-integration/types';
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
 */
class VFSProvider implements CapabilityProvider {
  readonly id = 'vfs';
  readonly name = 'Virtual Filesystem';
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.search', 'memory.context', 'workspace.getChanges'];

  isAvailable(): boolean {
    // VFS is available by default (works with default config)
    // It's always available since virtualFilesystem service initializes with defaults
    return true;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
    const ownerId = input.ownerId || context.userId || 'default';

    // Input validation
    if (!ownerId) {
      return { success: false, error: 'Missing ownerId/userId' };
    }

    try {
      switch (capabilityId) {
        case 'file.read': {
          const file = await virtualFilesystem.readFile(ownerId, input.path);
          return {
            success: true,
            output: {
              content: file.content,
              path: file.path,
              language: file.language,
              size: file.size,
              version: file.version,
              lastModified: file.lastModified,
            },
          };
        }

        case 'file.write': {
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
          return {
            success: true,
            output: {
              success: true,
              path: file.path,
              bytesWritten: file.size,
            },
          };
        }

        case 'file.append': {
          const file = await virtualFilesystem.writeFile(
            ownerId,
            input.path,
            input.content,
            input.language,
            { failIfExists: false, append: true }
          );
          return {
            success: true,
            output: {
              success: true,
              path: file.path,
              bytesWritten: file.size,
            },
          };
        }

        case 'file.delete': {
          const result = await virtualFilesystem.deletePath(ownerId, input.path);
          return {
            success: true,
            output: {
              deletedCount: result.deletedCount,
              path: input.path,
            },
          };
        }

        case 'file.list': {
          const listing = await virtualFilesystem.listDirectory(ownerId, input.path || 'project');
          return {
            success: true,
            output: {
              path: listing.path,
              nodes: listing.nodes.map(node => ({
                name: node.name,
                path: node.path,
                type: node.type,
                language: node.language,
                size: node.size,
                lastModified: node.lastModified,
              })),
            },
          };
        }

        case 'file.search': {
          const results = await virtualFilesystem.search(ownerId, input.query, {
            path: input.path,
            limit: input.limit,
          });
          return {
            success: true,
            output: {
              results: results.map(r => ({
                path: r.path,
                name: r.name,
                language: r.language,
                score: r.score,
                snippet: r.snippet,
                lastModified: r.lastModified,
              })),
              total: results.length,
            },
          };
        }

        case 'workspace.getChanges': {
          // Get git-style diffs for client sync
          const { diffTracker } = await import('../virtual-filesystem/filesystem-diffs');
          const changedFiles = diffTracker.getChangedFilesForSync(ownerId, input.maxFiles || 50);
          return {
            success: true,
            output: {
              ownerId,
              count: changedFiles.length,
              files: changedFiles,
            },
          };
        }

        case 'memory.context': {
          // Get workspace state for context
          const workspace = await virtualFilesystem.exportWorkspace(ownerId);
          return {
            success: true,
            output: {
              root: workspace.root,
              version: workspace.version,
              fileCount: workspace.files.length,
              files: workspace.files.map(f => ({
                path: f.path,
                language: f.language,
                size: f.size,
                lastModified: f.lastModified,
              })),
            },
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

        // Build project context for smart command translation
        const { buildProjectContext, resolveVfsPathToRealPath, translateNaturalLanguageToCommand, formatSmartContextAsMarkdown } = await import('../project-detection');

        // Get file listing from VFS for project detection
        let projectContext: Awaited<ReturnType<typeof buildProjectContext>> | null = null;
        try {
          const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
          const ownerId = context.userId || 'default';
          const workspace = await virtualFilesystem.exportWorkspace(ownerId);
          const filePaths = workspace.files.map(f => f.path);

          // Read package.json if available
          projectContext = await buildProjectContext(filePaths, async (path: string) => {
            try {
              const file = await virtualFilesystem.readFile(ownerId, path.replace(/^\//, ''));
              return file.content;
            } catch {
              return null;
            }
          });

          // Translate natural language command using detected project context
          const translatedCommand = translateNaturalLanguageToCommand(command, projectContext);

          // Add smart context to system prompt so LLM knows what it's working with
          const smartContextMd = formatSmartContextAsMarkdown(projectContext.smartContext);
          const systemPrompt = `${smartContextMd}\n\nWorking directory: ${input.cwd || projectContext.projectRoot || session.workspacePath || ''}`;

          // Resolve cwd from VFS scoped path to real filesystem path
          const cwdPath = input.cwd || (projectContext.projectRoot ? `${session.workspacePath || ''}/${projectContext.projectRoot}`.replace(/\/\//g, '/') : undefined);
          let resolvedCwd: string | undefined;
          if (cwdPath) {
            resolvedCwd = resolveVfsPathToRealPath(cwdPath, session.workspacePath || process.cwd());
          }

          const result = await provider.runAgentLoop({
            userMessage: translatedCommand,
            tools: [],
            systemPrompt,
            maxSteps: 5,
            executeTool: async () => ({ success: true, output: '', exitCode: 0 }),
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
 * Memory Service Provider - key-value storage with TTL and namespaces
 * Uses KV store for persistent storage (Redis/SQLite/in-memory)
 */
class MemoryServiceProvider implements CapabilityProvider {
  readonly id = 'memory-service';
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
    this.registerProvider(new BlaxelProvider());
    this.registerProvider(new MemoryServiceProvider());
    this.registerProvider(new RipgrepProvider());
    this.registerProvider(new ContextPackProvider());
    this.registerProvider(new EmbeddingSearchProvider());
    this.registerProvider(new GitHelperProvider());
    // Register OAuth integration provider (Nango/Composio/Arcade)
    this.registerProvider(new OAuthIntegrationProvider());

    this.initialized = true;
    logger.info(`[CapabilityRouter] Initialized with ${this.providers.size} providers`);
  }

  /**
   * Get the best available provider for a capability (synchronous check)
   * For async checks, the provider will be validated during execution
   */
  private selectProvider(capability: CapabilityDefinition): CapabilityProvider | null {
    const availableProviders: Array<{ provider: CapabilityProvider; score: number }> = [];

    for (const providerId of capability.providerPriority) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const available = provider.isAvailable();

      // Handle both sync and async availability checks
      if (available === true || available instanceof Promise) {
        // Score this provider based on metadata
        const score = this.scoreProvider(providerId, capability);
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
  private scoreProvider(providerId: string, capability: CapabilityDefinition): number {
    let score = 100; // Base score

    // Apply metadata-based scoring
    if (capability.metadata) {
      // Latency scoring
      if (capability.metadata.latency === 'low') score += 20;
      else if (capability.metadata.latency === 'medium') score += 10;
      else if (capability.metadata.latency === 'high') score -= 10;

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
    // This prevents malformed LLM-generated inputs from reaching providers.
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

    // Use the parsed (and potentially default-enriched) input for providers
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

    // Get scored and sorted providers
    const providerScores = this.getScoredProviders(capability);

    // Try each provider in score order (highest first)
    const errors: string[] = [];

    for (const { providerId, provider, score } of providerScores) {
      // Check availability
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
        const result = await provider.execute(capabilityId, validatedInput, context);

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

        // If auth required, don't try other providers
        if (result.authRequired) {
          return result;
        }
      } catch (error: any) {
        errors.push(`${provider.name}: ${error.message}`);
        logger.debug(`[CapabilityRouter] Provider ${provider.name} failed:`, error.message);
      }
    }

    return {
      success: false,
      error: `All providers failed for ${capabilityId}: ${errors.join('; ')}`,
      fallbackChain: capability.providerPriority as any,  // string[] → IntegrationProvider[]
    };
  }

  /**
   * Get providers sorted by score (highest first)
   */
  private getScoredProviders(capability: CapabilityDefinition): Array<{
    providerId: string;
    provider: CapabilityProvider;
    score: number;
  }> {
    const scored: Array<{ providerId: string; provider: CapabilityProvider; score: number }> = [];

    for (const providerId of capability.providerPriority) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const score = this.scoreProvider(providerId, capability);
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
