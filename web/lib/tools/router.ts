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
import { assertScopePathMatchesSessionId } from '../virtual-filesystem/session-path-guard';
import { resolveScopePathFromOwnerId } from '../virtual-filesystem/scope-utils';
import { wireToolResultFalseSteer, wireCapabilityNotFoundSteer, wireToolNameAliasRewriteSteer, safeSteer } from '../orchestra/steer-service';
// Pass-2 cross-cutting theme: record tool-name misnamings, capability-not-found,
// and success:false results into the per-session degradation chain so run.log
// shows which silent failures contributed to the user reprompting.
import { recordDegradation } from '../observability/degradation-tracker';
import path from 'path';
import os from 'os';
import { sliceLines } from '../utils/slice-lines';

const logger = createLogger('Tools:CapabilityRouter');

// Re-export for backward compatibility with consumers importing from '../tools/router'
export { sliceLines };

// ============================================================================
// Bug #37: Centralized tool-name alias map.
//
// LLMs frequently invent alternate tool names that don't match our canonical
// capability IDs (which are dotted strings like `file.list`, `bash.execute`).
// Common offenders seen in run.log:
//   - list_directory / list_dir / ls / dir   → file.list
//   - bash / bash_execute / shell / run_cmd  → bash.execute
//   - read_file  (singular)                  → file.read
//   - read_files (plural)                    → file.read  (we expose only `file.read`; `read_files` is an MCP-only tool)
//   - write_file / write                     → file.write
//   - delete_file / rm / remove              → file.delete
//   - search / search_files                  → repo.search
//   - grep / rg / ripgrep                    → repo.search
//   - edit / patch / str_replace             → file.str_replace
//
// The map is consulted at the top of `router.execute()`. On a hit, the alias
// is silently rewritten to the canonical ID and a [STEER] hint is emitted
// so the model learns the canonical name for the next turn. Closes #37 by
// turning a "5× `is not a function` after LLM invents `list_directory`" loop
// into a single rewrite + one-line steer.
// ============================================================================

export const TOOL_NAME_ALIASES: Record<string, string> = {
  // ── VFS file operations ──
  list_directory: 'file.list',
  listdirectory: 'file.list',
  list_dir: 'file.list',
  listdir: 'file.list',
  dir: 'file.list',
  list: 'file.list',
  ls: 'file.list',
  read_file: 'file.read',
  readfile: 'file.read',
  read: 'file.read',
  // `read_files` (plural) is an MCP-only convenience; the capability layer
  // exposes only `file.read` (single). Map the plural to the single.
  read_files: 'file.read',
  readfiles: 'file.read',
  write_file: 'file.write',
  writefile: 'file.write',
  write: 'file.write',
  delete_file: 'file.delete',
  deletefile: 'file.delete',
  delete: 'file.delete',
  rm: 'file.delete',
  remove: 'file.delete',
  edit: 'file.str_replace',
  str_replace: 'file.str_replace',
  strreplace: 'file.str_replace',
  patch: 'file.str_replace',
  batch_write: 'file.batch_write',
  batchwrite: 'file.batch_write',
  write_files: 'file.batch_write',
  writefiles: 'file.batch_write',
  append: 'file.append',
  append_file: 'file.append',
  // ── Sandbox / bash execution ──
  bash: 'bash.execute',
  bash_execute: 'bash.execute',
  bashexecute: 'bash.execute',
  shell: 'bash.execute',
  shell_execute: 'bash.execute',
  run_cmd: 'bash.execute',
  runcmd: 'bash.execute',
  exec: 'bash.execute',
  exec_shell: 'bash.execute',
  execshell: 'bash.execute',
  sandbox: 'sandbox.execute',
  sandbox_execute: 'sandbox.execute',
  sandboxexecute: 'sandbox.execute',
  run_sandbox: 'sandbox.execute',
  // ── Search / repo ──
  search: 'repo.search',
  search_files: 'repo.search',
  searchfiles: 'repo.search',
  search_code: 'repo.search',
  searchcode: 'repo.search',
  grep: 'repo.search',
  grep_code: 'repo.search',
  grepcode: 'repo.search',
  rg: 'repo.search',
  ripgrep: 'repo.search',
  find: 'repo.search',
  // ── Web ──
  web_search: 'web.search',
  websearch: 'web.search',
  search_web: 'web.search',
  browse: 'web.browse',
  web_browse: 'web.browse',
  webbrowse: 'web.browse',
  fetch: 'web.fetch',
  web_fetch: 'web.fetch',
  webfetch: 'web.fetch',
  // ── Task / memory ──
  list_tasks: 'task.list',
  listtasks: 'task.list',
  create_task: 'task.create',
  createtask: 'task.create',
  add_task: 'task.create',
  store: 'memory.store',
  retrieve: 'memory.retrieve',
};

/**
 * Resolve an LLM-supplied tool name to the canonical capability ID. Returns
 * `{ canonical, rewritten }` so the caller can emit a [STEER] hint when a
 * rewrite happened. The lookup is case-insensitive and strips a single
 * trailing/leading space, so `'List_Directory'` and `'list_directory'`
 * resolve identically.
 */
export function resolveToolNameAlias(rawName: string): { canonical: string; rewritten: boolean } {
  if (!rawName || typeof rawName !== 'string') {
    return { canonical: '', rewritten: false };
  }
  const key = rawName.trim().toLowerCase();
  const canonical = TOOL_NAME_ALIASES[key];
  if (canonical && canonical !== key) {
    return { canonical, rewritten: true };
  }
  return { canonical: key, rewritten: false };
}

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
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.batch_write', 'file.str_replace', 'memory.context', 'workspace.getChanges'];

  isAvailable(): boolean {
    return true;
  }

  // ─── Declarative Method Map ──────────────────────────────────────────────

  private readonly methods: Record<string, (ownerId: string, input: any, context: ToolExecutionContext) => Promise<any>> = {
    'file.read': async (ownerId, input, context) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const file = await virtualFilesystem.readFile(ownerId, input.path);
      const hasLineRange = input.startLine != null || input.endLine != null;
      const content = sliceLines(file.content, input.startLine, input.endLine);
      return {
        content,
        path: file.path,
        language: file.language,
        size: file.size,
        version: file.version,
        lastModified: file.lastModified,
        ...(hasLineRange ? {
          totalLines: file.content.split('\n').length,
          lineRangeRequested: true,
        } : {}),
      };
    },

    'file.write': async (ownerId, input, context) => {
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

    'file.batch_write': async (ownerId, input, context) => {
      // Delegate to the MCP batch_write tool which handles per-file validation,
      // scope path resolution, and event emission atomically
      const { callMCPToolFromAI_SDK } = await import('../mcp');
      const scopePath = context?.scopePath || input.scopePath;
      // Inject sessionId into input so callMCPToolFromAI_SDK can use it for VFS event tracking
      const sessionId = (context as any)?.sessionId || (context as any)?.conversationId || input.sessionId;
      const batchWriteInput = sessionId ? { ...input, sessionId } : input;
      const result = await callMCPToolFromAI_SDK('batch_write', batchWriteInput, ownerId, scopePath);
      // Check both top-level success AND dual-status pattern
      const innerFailure = result.output && typeof result.output === 'object' && !Array.isArray(result.output) && (result.output as any).success === false;
      if (!result.success || innerFailure) {
        const errorMsg = result.error || ((result.output as any)?.error) || 'batch_write failed';
        throw new Error(errorMsg);
      }
      return result.output;
    },

    'file.str_replace': async (ownerId, input, context) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const { path: filePath, oldString, newString, allowMultiple } = input;

      // Read current file
      const file = await virtualFilesystem.readFile(ownerId, filePath);
      const content = file.content;

      // Count occurrences (single split for both count and replacement)
      const parts = content.split(oldString);
      const occurrences = parts.length - 1;
      if (occurrences === 0) {
        return {
          success: false,
          path: filePath,
          replacements: 0,
          error: `String not found in ${filePath}: "${oldString.length > 80 ? oldString.slice(0, 80) + '...' : oldString}"`,
        };
      }
      if (!allowMultiple && occurrences > 1) {
        return {
          success: false,
          path: filePath,
          replacements: 0,
          error: `Found ${occurrences} occurrences of the string in ${filePath}, but allowMultiple is false. Use allowMultiple=true to replace all, or provide a more specific string.`,
        };
      }

      // Perform replacement
      const replacements = allowMultiple ? occurrences : 1;
      const newContent = allowMultiple
        ? parts.join(newString)
        : content.replace(oldString, newString);

      // Write back
      await virtualFilesystem.writeFile(ownerId, filePath, newContent, file.language);

      return {
        success: true,
        path: filePath,
        replacements,
        content: newContent,
      };
    }, 'file.append': async (ownerId, input, context) => {
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

    'file.delete': async (ownerId, input, context) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const result = await virtualFilesystem.deletePath(ownerId, input.path);
      return { deletedCount: result.deletedCount, path: input.path };
    },

    'file.list': async (ownerId, input, context) => {
      const { virtualFilesystem } = await import('../virtual-filesystem/virtual-filesystem-service');
      const listing = await virtualFilesystem.listDirectory(ownerId, input.path || 'workspace');
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

    'workspace.getChanges': async (ownerId, input, context) => {
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

    // Bug #26: pre-tool-call session-id guard. Verify the request's
    // scopePath (if any) still matches the session id encoded in the
    // ownerId. Catches the path-drift case where the session folder was
    // renamed out from under us (workspace/sessions/001 →
    // workspace/sessions/ai_terminal). The check is a no-op when the
    // request has no scopePath or when the ownerId has no extractable
    // session, so it doesn't affect non-session workflows.
    const scopePath = (input as any)?.scopePath || (context as any)?.scopePath;
    try {
      // Resolve the default-fallback scopePath to the ownerId's encoded session
      // before invoking the guard. Prevents false-positive SessionPathMismatchError
      // on app open when the scopePath is 'workspace/sessions/000' (the sentinel)
      // but the ownerId encodes a real session.
      const resolvedScopePath = resolveScopePathFromOwnerId(ownerId, scopePath);
      assertScopePathMatchesSessionId(ownerId, resolvedScopePath);
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }

    const handler = this.methods[capabilityId];
    if (!handler) {
      return { success: false, error: `Unknown capability: ${capabilityId}` };
    }

    try {
      const output = await handler(ownerId, input, context);
      // #22/#29 fix: surface the reason when a handler returns success:false
      // so the LLM (and run.log) can see WHY the call failed instead of a bare
      // {success:false}. Also emit a [STEER] hint via wireToolResultFalseSteer
      // so the orchestrator can re-prompt with a corrective message on
      // consecutive false results.
      if (output && typeof output === 'object' && (output as any).success === false) {
        const errorMsg =
          (output as any).error ?? (output as any).message ?? 'unknown error';
        logger.warn('[TOOL] success:false result', { capabilityId, ownerId, error: errorMsg });
        try {
          const hint = wireToolResultFalseSteer({
            tool: capabilityId,
            error: errorMsg,
            argsPreview: JSON.stringify(input ?? {}).slice(0, 200),
          });
          if (hint) logger.info('[STEER] tool result false', { capabilityId, hint });
        } catch { /* steer failure must never break the tool result */ }
        // Pass-2 cross-cutting theme: record the success:false result so
        // run.log shows which tool was the silent failure.
        try {
          recordDegradation(
            (context as any)?.sessionId || ownerId || 'default',
            'success_false',
            'router',
            { capabilityId, error: errorMsg.slice(0, 200) },
          );
        } catch { /* best-effort */ }
      }
      return { success: true, output };
    } catch (error: any) {
      // #22/#29 fix: same surface-the-reason treatment for thrown errors.
      logger.error('Tool execution failed', { capabilityId, ownerId, error: error.message });
      try {
        const hint = wireToolResultFalseSteer({
          tool: capabilityId,
          error: error.message ?? 'unknown error',
          argsPreview: JSON.stringify(input ?? {}).slice(0, 200),
        });
        if (hint) logger.info('[STEER] tool threw', { capabilityId, hint });
      } catch { /* steer failure must never break the error path */ }
      // Pass-2 cross-cutting theme: record the thrown error as success_false
      // (a thrown error is functionally a success:false from the LLM's POV).
      try {
        recordDegradation(
          (context as any)?.sessionId || ownerId || 'default',
          'success_false',
          'router',
          { capabilityId, error: (error.message ?? 'unknown').slice(0, 200), thrown: true },
        );
      } catch { /* best-effort */ }
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
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.batch_write', 'file.str_replace'];

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
      'file.batch_write': 'batch_write',
      'file.str_replace': 'str_replace',
    };

    const toolName = toolMap[capabilityId];
    if (!toolName) {
      return { success: false, error: `No MCP tool mapping for ${capabilityId}` };
    }

    try {
        // Defensive: if scopePath is missing, VFS operations will write to wrong workspace
        if (!context.scopePath) {
          console.warn('[MCPFilesystemProvider] Missing scopePath in tool context — VFS files may be written to wrong workspace. Ensure createCapabilityToolExecutor passes a valid scopePath.');
        }
        // Inject sessionId from context so trackMcpFileEdit stores the edit for SSE event emission
        const sessionId = (context as any)?.sessionId || (context as any)?.conversationId || input.sessionId;
        const enhancedInput = sessionId ? { ...input, sessionId } : input;
        const result = await callMCPToolFromAI_SDK(toolName, enhancedInput, context.userId, context.scopePath);
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
  readonly capabilities = ['file.read', 'file.write', 'file.append', 'file.delete', 'file.list', 'file.str_replace'];
  
  // SECURITY: Base directory restriction for file operations
  private readonly workspaceRoot: string;

  constructor() {
    // Default to workspace directory, fall back to a SAFE temp directory.
    //
    // SECURITY/HYGIENE: Never fall back to a project-relative `workspace/`
    // directory (e.g. `path.join(process.cwd(), 'workspace')`).
    //
    // In web mode, the server is the Next.js dev process whose CWD is the
    // project root (e.g. `/opt/bing`). Writing to that directory leaks user
    // VFS content into the repository, showing up in `git status` and
    // breaking the VFS-as-virtual contract (web mode is supposed to be
    // in-memory / OPFS / IndexedDB only).
    //
    // We always prefer:
    //   1. Explicit env override (WORKSPACE_DIR / USER_WORKSPACE_ROOT)
    //   2. A per-process subdirectory under `os.tmpdir()` so concurrent
    //      processes don't collide and the project tree stays clean.
    //
    // NOTE: This provider is constructed eagerly (singleton at module
    // load) and does NOT have request context. The resolveFilesystemOwner
    // helper needs a NextRequest, so we cannot scope by user here.
    // Callers in request scope that need user-scoped workspaces should
    // either set WORKSPACE_DIR per-request (not yet implemented) or
    // use the in-memory VFS (web mode default). Server-side callers
    // should not pass user data through this provider in production
    // until per-request workspace scoping is wired up.
    this.workspaceRoot =
      process.env.WORKSPACE_DIR ||
      process.env.USER_WORKSPACE_ROOT ||
      path.join(os.tmpdir(), 'bing-vfs-workspace');
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

          const rawContent = await fs.readFile(safePath, input.encoding || 'utf-8');
          const stats = await fs.stat(safePath);
          const hasLineRange = input.startLine != null || input.endLine != null;
          const isString = typeof rawContent === 'string';
          const slicedContent = isString
            ? sliceLines(rawContent, input.startLine, input.endLine)
            : rawContent;
          return {
            success: true,
            output: {
              content: isString ? slicedContent as string : (slicedContent as Buffer).toString('base64'),
              encoding: input.encoding || 'utf-8',
              size: stats.size,
              exists: true,
              path: safePath,
              ...(hasLineRange && isString ? {
                totalLines: (rawContent as string).split('\n').length,
                lineRangeRequested: true,
              } : {}),
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

        case 'file.str_replace': {
          const pathValidation = this.validatePath(input.path);
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error };
          }
          const safePath = pathValidation.resolvedPath!;
          const rawContent = await fs.readFile(safePath, 'utf-8');
          const content = rawContent as string;
          const { oldString, newString, allowMultiple } = input;

          const occurrences = content.split(oldString).length - 1;
          if (occurrences === 0) {
            return {
              success: false,
              error: `String not found in ${input.path}: "${oldString.length > 80 ? oldString.slice(0, 80) + '...' : oldString}"`,
            };
          }
          if (!allowMultiple && occurrences > 1) {
            return {
              success: false,
              error: `Found ${occurrences} occurrences, but allowMultiple is false. Use allowMultiple=true or provide a more specific string.`,
            };
          }

          const replacements = allowMultiple ? occurrences : 1;
          const newContent = allowMultiple
            ? content.split(oldString).join(newString)
            : content.replace(oldString, newString);

          await fs.writeFile(safePath, newContent, 'utf-8');
          return {
            success: true,
            output: { success: true, path: safePath, replacements, content: newContent },
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
 * OpenCode V2 Provider - handles sandbox execution
 */
class OpenCodeV2Provider implements CapabilityProvider {
  readonly id = 'opencode-v2';
  readonly name = 'OpenCode V2';
  readonly capabilities = ['sandbox.execute', 'bash.execute', 'sandbox.session', 'repo.git'];

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

      if (capabilityId === 'sandbox.execute' || capabilityId === 'bash.execute') {
        const command = capabilityId === 'sandbox.execute'
          ? `run ${input.language} code: ${input.code}`
          : input.command;

        // Get workspace context for the system prompt (lightweight — just file listing)
        let smartContextMd = '';
        let projectRoot = '';
        try {
          const { buildProjectContext, formatSmartContextAsMarkdown } = await import('@/lib/context/project-detection');
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
          // Workspace detection failed — LLM will work without it
        }

        // Build the tool set for the LLM: extended sandbox tools including
        // terminal sessions, workspace analysis, and port status.
        const { EXTENDED_SANDBOX_TOOLS, mapToolToCapability } = await import('../sandbox/extended-sandbox-tools');

        // Resolve cwd
        let resolvedCwd: string | undefined;
        if (input.cwd) {
          try {
            const { resolveVfsPathToRealPath } = await import('@/lib/context/project-detection');
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
            `If the command looks like natural language (e.g., "run the workspace"), ` +
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
            // exec_shell / bash.execute / sandbox.shell must NOT go through the capability router
            // because that would route back to OpenCodeV2Provider → infinite recursion.
            // Instead, execute directly on the provider.
            if (name === 'exec_shell' || name === 'sandbox.shell' || name === 'sandbox.execute' || name === 'bash.execute') {
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
          
          // Try SearXNG first if configured
          if (process.env.SEARXNG_BASE_URL) {
            try {
              const searxngUrl = process.env.SEARXNG_BASE_URL.replace(/\/$/, '');
              const searchUrl = `${searxngUrl}/search?q=${encodeURIComponent(input.query)}&format=json&language=en`;
              
              const headers: Record<string, string> = {
                'Accept': 'application/json',
              };
              if (process.env.SEARXNG_API_KEY) {
                headers['Authorization'] = `Bearer ${process.env.SEARXNG_API_KEY}`;
              }

              const response = await fetch(searchUrl, { headers });
              if (response.ok) {
                const data = await response.json();
                const results = (data.results || []).slice(0, input.limit || 10).map((r: any) => ({
                  title: r.title || 'No title',
                  url: r.url || '',
                  snippet: r.content || r.snippet || '',
                }));
                return {
                  success: true,
                  output: { results, query: input.query, source: 'searxng' },
                };
              }
            } catch (error: any) {
              // Fall through to DuckDuckGo fallback
              console.warn('[web.search] SearXNG failed, falling back to DuckDuckGo:', error.message);
            }
          }

          // Fallback to DuckDuckGo HTML for web search
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
              source: 'duckduckgo',
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
 * Context Pack Provider - generates workspace context bundles
 */
class ContextPackProvider implements CapabilityProvider {
  readonly id = 'context-pack';
  readonly name = 'Context Pack';
  readonly capabilities = ['memory.store', 'memory.context', 'workspace.bundle'];

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
      // Input validation for workspace.bundle
      if (capabilityId === 'workspace.bundle' && !input.path && !input.scopePath) {
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
  readonly capabilities = ['repo.search'];

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
        // Fallback: semantic search still handled for backward compat
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
  readonly capabilities = ['repo.git'];

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
        case 'repo.git': {
          // Input validated by Zod discriminatedUnion before reaching here.
          // Each sub-command is strongly typed.
          switch (input.command) {
            case 'clone': {
              if (!input.url) {
                return { success: false, error: 'Missing required field: url' };
              }
              const cloneResult = await git.clone({
                url: input.url,
                path: input.path,
                username: input.username,
                password: input.password,
                branch: input.branch,
                depth: input.depth,
                recursive: input.recursive,
              });
              return {
                success: cloneResult.success,
                output: cloneResult,
                error: cloneResult.error,
              };
            }

            case 'commit': {
              if (!input.message) {
                return { success: false, error: 'Missing required field: message' };
              }
              const commitResult = await git.commit({
                message: input.message,
                authorName: input.authorName,
                authorEmail: input.authorEmail,
                files: input.files,
              }, input.cwd);
              return {
                success: commitResult.success,
                output: commitResult,
                error: commitResult.error,
              };
            }

            case 'push': {
              const pushResult = await git.push({
                remote: input.remote,
                branch: input.branch,
                username: input.username,
                password: input.password,
                force: input.force,
              }, input.cwd);
              return {
                success: pushResult.success,
                output: pushResult,
                error: pushResult.error,
              };
            }

            case 'pull': {
              const pullResult = await git.pull(input.cwd);
              return {
                success: pullResult,
                output: { success: pullResult },
              };
            }

            default: {
              // Generic git commands: status, diff, branch, log, stash.
              // For diff with files: git diff -- file1 file2
              const cwd = input.cwd || session.workspacePath;
              let cmdString: string;
              if (input.command === 'diff' && input.files?.length) {
                cmdString = `git diff -- ${input.files.join(' ')}`;
              } else if (['status', 'diff', 'branch', 'log', 'stash'].includes(input.command)) {
                cmdString = `git ${input.command}`;
              } else {
                cmdString = input.command;
              }
              const execResult = await session.sandboxHandle.executeCommand(cmdString, cwd);
              return {
                success: execResult.success,
                output: {
                  stdout: execResult.output,
                  exitCode: execResult.exitCode,
                },
                error: execResult.success ? undefined : execResult.output,
              };
            }
          }
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
    'task.getUnfinished', 'task.enrichStep', 'task.enrichStepMulti', 'task.segmentStep', 
    'task.validateStep', 'task.expandStep', 'memory.store', 'memory.retrieve'
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
          const offset = Math.max(0, input.offset ?? 0);
          const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
          const allTasks = this.taskStore.getAll(filter);
          const paginatedTasks = allTasks.slice(offset, offset + limit);
          return {
            success: true,
            output: {
              tasks: paginatedTasks.map(t => ({
                id: t.id, title: t.title, description: t.description,
                status: t.status, retention: t.retention, priority: t.priority,
                progress: t.progress, steps: t.steps, tags: t.tags,
                createdAt: t.createdAt, updatedAt: t.updatedAt,
              })),
              pagination: {
                offset,
                limit,
                total: allTasks.length,
                hasMore: offset + limit < allTasks.length,
              },
            },
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
          // Refresh re-context TTL for newly created tasks
          const { markTasksForRecontext } = await import('../memory/cache-exporter');
          markTasksForRecontext([task.id]);

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

          // Mark task for re-context on completion
          if (task && (updates.status === 'completed' || updates.status === 'failed')) {
            const { markTasksForRecontext } = await import('../memory/cache-exporter');
            markTasksForRecontext([input.taskId]);
          }

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

        case 'task.enrichStep': {
          if (!input.step || typeof input.step !== 'string') {
            return { success: false, error: 'input.step is required and must be a string' };
          }
          try {
            const { enrichStep } = await import('../memory/task-persistence');
            const result = await enrichStep(
              input.step,
              input.context
            );
            return {
              success: true,
              output: result,
            };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }

        case 'task.enrichStepMulti': {
          if (!input.step || typeof input.step !== 'string') {
            return { success: false, error: 'input.step is required and must be a string' };
          }
          try {
            const { enrichStepMultiPerspective } = await import('../memory/task-persistence');
            const result = await enrichStepMultiPerspective(
              input.step,
              input.context,
              { includeMicroSteps: input.includeMicroSteps !== false }
            );
            return {
              success: true,
              output: result,
            };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }

        case 'task.segmentStep': {
          if (!input.step || typeof input.step !== 'string') {
            return { success: false, error: 'input.step is required and must be a string' };
          }
          try {
            const { segmentStepHierarchically } = await import('../memory/task-persistence');
            const microSteps = segmentStepHierarchically(input.step, {
              maxDepth: input.maxDepth,
              includeDependencies: input.includeDependencies !== false,
            });
            return {
              success: true,
              output: {
                microSteps,
                totalSteps: microSteps.length,
                estimatedTotalMinutes: microSteps.reduce((sum, m) => sum + (m.estimatedMinutes || 0), 0),
              },
            };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }

        case 'task.validateStep': {
          if (!input.step || typeof input.step !== 'string') {
            return { success: false, error: 'input.step is required and must be a string' };
          }
          try {
            const { validateStepQuality } = await import('../memory/task-persistence');
            const result = validateStepQuality(input.step);
            return {
              success: true,
              output: result,
            };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        }

        case 'task.expandStep': {
          if (!input.step || typeof input.step !== 'string') {
            return { success: false, error: 'input.step is required and must be a string' };
          }
          try {
            const { expandStepIntoDetail } = await import('../memory/task-persistence');
            const result = expandStepIntoDetail(input.step, input.context);
            return {
              success: true,
              output: result,
            };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
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
  readonly capabilities = ['repo.search'];

  async isAvailable(): Promise<boolean> {
    // Always available - uses VFS adapter that falls back gracefully
    return true;
  }

  async execute(
    capabilityId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    try {
      // Use VFS adapter that handles both desktop (native ripgrep) and web (VFS search)
      const { ripgrepVFS } = await import('@/lib/search/ripgrep-vfs-adapter');
      
      // Validate ownerId — must be a non-empty string from authenticated context.
      // SECURITY: Never default to a shared fallback like 'anon:public'.
      const rawOwnerId = context.userId;
      if (typeof rawOwnerId !== 'string' || !rawOwnerId.trim()) {
        return { success: false, error: 'VFS operations require a valid userId in context. Use resolveFilesystemOwner() to provide one.' };
      }
      // Normalize format: 'anon_xxx' → 'anon:xxx'
      const ownerId = rawOwnerId.startsWith('anon_') ? rawOwnerId.replace(/^anon_/, 'anon:') : rawOwnerId;
      if (ownerId === 'anonymous') {
        return { success: false, error: '"anonymous" is not a valid VFS ownerId. Use resolveFilesystemOwner() to generate a unique anonymous session ID.' };
      }

      const searchPath = input.path;
      const maxResults = input.maxResults || 50;
      const query = input.query;
      
      if (!query || typeof query !== 'string' || !query.trim()) {
        return { success: false, error: 'Query is required' };
      }

      const result = await ripgrepVFS({
        query,
        ownerId,
        path: searchPath,
        glob: input.glob,
        fixedString: input.fixedString,
        caseInsensitive: input.caseInsensitive,
        wordRegexp: input.wordRegexp,
        maxResults,
        maxCountPerFile: input.maxCountPerFile,
        contextLines: input.contextLines,
        timeoutMs: 30000,
      });

      if (result.errors.length > 0 && result.matches.length === 0) {
        return { 
          success: false, 
          error: result.errors.join('; '),
          metadata: {
            usedRipgrep: result.usedRipgrep,
            usedVFS: result.usedVFS,
            stats: result.stats,
          }
        };
      }

      // Format results to match expected output schema
      const formattedResults = result.matches.map(m => ({
        path: m.path,
        line: m.lineNumber,
        content: m.content,
        contextBefore: m.contextBefore,
        contextAfter: m.contextAfter,
      }));

      return { 
        success: true, 
        output: formattedResults,
        metadata: {
          usedRipgrep: result.usedRipgrep,
          usedVFS: result.usedVFS,
          stats: result.stats,
        }
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Search failed',
      };
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
      } = await import('../terminal/terminal');

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
  PROJECT_ANALYSIS = 'workspace-analysis',
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
   * Check if any registered provider supports a given capability.
   * Used by execute-capability.ts hasToolCapability for routing decisions.
   */
  async hasCapability(capabilityId: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }
    for (const provider of this.providers.values()) {
      if (provider.capabilities.includes(capabilityId)) {
        return true;
      }
    }
    return false;
  }

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

    // Bug #37: centralized tool-name alias rewrite. If the LLM invented a
    // tool name like `list_directory` or `bash_execute`, silently rewrite it
    // to the canonical capability ID and emit a [STEER] hint so the model
    // learns the canonical name for the next turn. Closes the
    // "5× `is not a function` after LLM invents `list_directory`" loop.
    const alias = resolveToolNameAlias(capabilityId);
    if (alias.rewritten) {
      logger.info('[CapabilityRouter] tool name aliased', {
        alias: capabilityId,
        canonical: alias.canonical,
        userId: context.userId,
      });
      const hint = safeSteer(() => wireToolNameAliasRewriteSteer({
        alias: capabilityId,
        canonical: alias.canonical,
        tool: 'capability_router',
      }));
      if (hint) logger.info('[STEER] tool name aliased', { alias: capabilityId, hint });
      // Pass-2 cross-cutting theme: record the alias rewrite into the
      // per-session degradation chain so run.log shows the silent misname.
      try {
        recordDegradation(
          (context as any)?.sessionId || context.userId || 'default',
          'tool_name_alias_rewrite',
          'router',
          { alias: capabilityId, canonical: alias.canonical },
        );
      } catch { /* best-effort */ }
      capabilityId = alias.canonical;
    }

    const capability = getCapability(capabilityId);
    if (!capability) {
      // Bug F: emit a [STEER] hint with the canonical capability names so the
      // model can self-correct on retry. wireCapabilityNotFoundSteer is
      // best-effort — a steer helper failure must never break the error path.
      const hint = safeSteer(() => wireCapabilityNotFoundSteer({
        capabilityId,
        availableCapabilities: ALL_CAPABILITIES.map(c => c.id),
        tool: 'capability_router',
      }));
      if (hint) logger.warn('[TOOL] capability not found', { capabilityId, hint });
      // Pass-2 cross-cutting theme: record the unknown capability into the
      // per-session degradation chain.
      try {
        recordDegradation(
          (context as any)?.sessionId || context.userId || 'default',
          'capability_not_found',
          'router',
          { capabilityId },
        );
      } catch { /* best-effort */ }
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

      // Skip LLM self-healing when no Mistral key is configured
      // (the call would just fail and waste time)
      if (!process.env.MISTRAL_API_KEY) {
        logger.debug(`[CapabilityRouter] Skipping self-heal for ${capabilityId}: no Mistral API key`);
        break;
      }

      // Skip self-healing when the error is about provider availability,
      // not about input validity — fixing the input won't help.
      if (lastError.includes('All providers failed') ||
          lastError.includes('ENOENT') ||
          lastError.includes('Tool not found')) {
        logger.debug(`[CapabilityRouter] Skipping self-heal for ${capabilityId}: provider-level error, not input issue`);
        break;
      }

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
          // Check for dual-status pattern: { success: true, output: { success: false, error: '...' } }
          // Some providers wrap inner failures as "successful" outer results, which would
          // silently swallow the actual error. Detect and surface this correctly.
          const outputObj = result.output;
          const isDualStatusFailure =
            outputObj && typeof outputObj === 'object' && !Array.isArray(outputObj) &&
            outputObj.success === false;

          if (isDualStatusFailure) {
            const innerError = (outputObj as any).error || 'Inner operation failed';
            errors.push(`${provider.name}: ${innerError} (dual-status failure)`);
            logger.debug(`[CapabilityRouter] Dual-status failure from ${provider.name} for ${capabilityId}: ${innerError}`);
            continue; // Try next provider instead of returning a false-positive success
          }

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
      const { generateText, Output } = await import('ai');

      // Use a fast, cheap model for healing
      const { createMistral } = await import('@ai-sdk/mistral');
      const model = createMistral({ apiKey: process.env.MISTRAL_API_KEY || '' })('mistral-small-latest');

      const result = await generateText({
        model,
        prompt: `A tool call failed. Fix the input arguments.

Capability: ${capabilityId}
Description: ${capability.description}
Original Input: ${JSON.stringify(originalInput, null, 2)}
Error: ${error}

Expected Schema:
${JSON.stringify(capability.inputSchema, null, 2)}

Return ONLY the corrected input object as JSON.`,
        output: Output.object({ schema: capability.inputSchema }),
        maxOutputTokens: 500,
        temperature: 0.1,
      });

      return (result as any).object as Record<string, unknown>;
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
