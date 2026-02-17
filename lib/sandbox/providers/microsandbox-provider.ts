import type { ToolResult } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
} from './sandbox-provider'
import * as path from 'node:path';

const WORKSPACE_DIR = '/workspace'
const MAX_INSTANCES = 100
const INSTANCE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

interface SandboxInstance {
  sandbox: any
  createdAt: number
  lastActive: number
}

const sandboxInstances = new Map<string, SandboxInstance>()

// Periodic cleanup of stale instances (every 30 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [id, instance] of sandboxInstances.entries()) {
    if (now - instance.lastActive > INSTANCE_TTL_MS) {
      console.log(`[Microsandbox] Cleaning up stale instance: ${id}`)
      instance.sandbox.stop().catch(console.error)
      sandboxInstances.delete(id)
    }
  }
}, 30 * 60 * 1000)

export class MicrosandboxProvider implements SandboxProvider {
  readonly name = 'microsandbox'

  constructor() {
    // Requires microsandbox server running on host
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const { NodeSandbox } = require('microsandbox')

    // Enforce max instances - evict oldest if at limit
    if (sandboxInstances.size >= MAX_INSTANCES) {
      let oldestId: string | null = null
      let oldestTime = Date.now()
      for (const [id, instance] of sandboxInstances.entries()) {
        if (instance.createdAt < oldestTime) {
          oldestTime = instance.createdAt
          oldestId = id
        }
      }
      if (oldestId) {
        console.log(`[Microsandbox] Evicting oldest instance: ${oldestId}`)
        sandboxInstances.get(oldestId)?.sandbox.stop().catch(console.error)
        sandboxInstances.delete(oldestId)
      }
    }

    const createOptions: any = {
      name: `session-${Date.now()}`,
    }

    if (config.mounts?.length) {
      createOptions.mounts = config.mounts.map((m) => ({
        hostPath: m.source,
        containerPath: m.target,
      }))
    }

    const sb = await NodeSandbox.create(createOptions)
    const now = Date.now()
    const sandboxId = sb.name || sb.id || createOptions.name
    sandboxInstances.set(sandboxId, {
      sandbox: sb,
      createdAt: now,
      lastActive: now,
    })

    const handle = new MicrosandboxSandboxHandle(sb)
    await handle.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const instance = sandboxInstances.get(sandboxId)
    if (!instance) throw new Error(`Microsandbox session ${sandboxId} not found`)
    instance.lastActive = Date.now() // Update last active time
    return new MicrosandboxSandboxHandle(instance.sandbox)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const instance = sandboxInstances.get(sandboxId)
    if (instance) {
      await instance.sandbox.stop()
      sandboxInstances.delete(sandboxId)
    }
  }
}

class MicrosandboxSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = '/workspace'
  private sb: any

  constructor(sb: any) {
    this.sb = sb
    this.id = sb.name || sb.id || 'unknown'
  }

  /**
   * Sanitize command to prevent shell injection
   */
  private sanitizeCommand(command: string): string {
    // Reject high-risk shell metacharacters, but allow pipes/redirection used by internal tooling
    // Blocked: ; (command separator), ` (command substitution), $ (variable expansion),
    //          () (subshell), {} (brace expansion), [] (glob/range), ! (history),
    //          # (comment injection), ~ (home dir), \ (escape)
    // Allowed: | (pipe), > (redirect), < (redirect), & (background)
    const dangerousChars = /[;`$(){}[\]!#~\\]/;
    if (dangerousChars.test(command)) {
      throw new Error('Command contains disallowed characters for security');
    }
    if (/[\n\r\0]/.test(command)) {
      throw new Error('Command contains invalid control characters');
    }
    return command;
  }

  /**
   * Resolve and validate path to prevent path traversal attacks
   */
  private resolvePath(filePath: string): string {
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, '/');
    
    // Reject path traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    
    // Reject absolute paths that aren't already in workspace
    if (filePath.startsWith('/')) {
      // Ensure it's within workspace
      const resolved = path.resolve(normalized);
      if (!resolved.startsWith(WORKSPACE_DIR)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }
      return resolved;
    }
    
    // For relative paths, resolve within workspace
    const resolved = path.resolve(WORKSPACE_DIR, normalized);
    
    // Double-check the resolved path is within workspace
    if (!resolved.startsWith(WORKSPACE_DIR)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    
    return resolved;
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    // Sanitize command to prevent injection
    const safeCommand = this.sanitizeCommand(command);

    // Sanitize cwd to prevent injection (consistent with sanitizeCommand - allow pipes/redirection)
    if (cwd) {
      if (/[;`$(){}[\]!#~\\]/.test(cwd) || cwd.includes('..') || /[\n\r\0]/.test(cwd)) {
        throw new Error(`Invalid working directory: ${cwd}`);
      }
    }

    // Use path.join for safe path construction instead of shell string interpolation
    const safeCwd = cwd ? this.resolvePath(cwd) : WORKSPACE_DIR;

    // Quote cwd to handle spaces and special characters safely
    const escapedCwd = safeCwd.replace(/'/g, "'\\''")
    const fullCommand = `cd '${escapedCwd}' && ${safeCommand}`;

    // Enforce timeout - default to 60 seconds if not specified
    const effectiveTimeout = timeout ?? 60_000;

    let timeoutId: NodeJS.Timeout | undefined;
    const execPromise = this.sb.command.run('bash', ['-c', fullCommand], effectiveTimeout);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Command timed out after ${effectiveTimeout}ms`)), effectiveTimeout);
    });

    try {
      const result = await Promise.race([execPromise, timeoutPromise]);

      return {
        success: result.exitCode === 0,
        output: result.success ? await result.output() : await result.error(),
        exitCode: result.exitCode,
      };
    } catch (error: any) {
      // Handle timeout or other errors
      if (error.message?.includes('timed out')) {
        return {
          success: false,
          output: error.message,
          exitCode: 124, // Standard exit code for timeout
        };
      }
      throw error;
    } finally {
      // Clear timeout to prevent resource leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Execute a trusted internal command (bypasses sanitization)
   * Used only for internal file operations with validated paths
   */
  private async executeTrustedCommand(command: string, timeoutMs: number = 60_000): Promise<ToolResult> {
    let timeoutId: NodeJS.Timeout | undefined;
    const cmdPromise = this.sb.command.run('bash', ['-c', command]);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      const result = await Promise.race([cmdPromise, timeoutPromise]);
      const output = result.success ? await result.output() : await result.error();

      return {
        success: result.exitCode === 0,
        output: output || '',
        exitCode: result.exitCode,
      };
    } finally {
      // Clear timeout to prevent resource leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    const dir = path.dirname(resolved)

    // Escape paths for shell safety (handle spaces and metacharacters)
    const escapedDir = dir.replace(/'/g, "'\\''")
    const escapedPath = resolved.replace(/'/g, "'\\''")

    // Create directory with sanitized path
    const mkdirResult = await this.executeTrustedCommand(`mkdir -p '${escapedDir}'`)
    if (!mkdirResult.success) {
      return {
        success: false,
        output: mkdirResult.output,
        exitCode: mkdirResult.exitCode,
      }
    }

    // Use shell-escaped content for safety - use trusted command for redirection
    const escaped = content.replace(/'/g, "'\\''")
    const writeResult = await this.executeTrustedCommand(`printf '%s' '${escaped}' > '${escapedPath}'`)
    return {
      success: writeResult.success,
      output: writeResult.success ? `File written: ${resolved}` : writeResult.output,
      exitCode: writeResult.exitCode,
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    const escapedPath = resolved.replace(/'/g, "'\\''")
    return this.executeTrustedCommand(`cat '${escapedPath}'`)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath)
    const escapedPath = resolved.replace(/'/g, "'\\''")
    return this.executeTrustedCommand(`ls -la '${escapedPath}'`)
  }

  async createPty(_options: PtyOptions): Promise<PtyHandle> {
    throw new Error('Microsandbox does not support PTY sessions. Use Daytona for interactive terminal access.')
  }
}
