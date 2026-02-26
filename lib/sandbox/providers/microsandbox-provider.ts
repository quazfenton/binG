import type { ToolResult } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
} from './sandbox-provider'
import * as path from 'node:path';
import { ensureMicrosandboxDaemonRunning } from '../microsandbox-daemon';

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
    // Microsandbox daemon is auto-started by provider when needed.
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    try {
      await ensureMicrosandboxDaemonRunning()
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

      // Create sandbox with name option (per microsandbox docs)
      const createOptions: any = {
        name: `session-${Date.now()}`,
      }

      // Create the sandbox instance
      const sb = await NodeSandbox.create(createOptions)
      const now = Date.now()
      const sandboxId = sb.name || sb.id || createOptions.name
      sandboxInstances.set(sandboxId, {
        sandbox: sb,
        createdAt: now,
        lastActive: now,
      })

      const handle = new MicrosandboxSandboxHandle(sb)
      return handle
    } catch (error: any) {
      const allowLocalFallback = process.env.MICROSANDBOX_ALLOW_LOCAL_FALLBACK !== 'false'
      if (allowLocalFallback) {
        const localId = `local-${Date.now()}`
        console.warn(`[Microsandbox] Daemon unavailable, using local fallback sandbox: ${localId}`)
        return new LocalSandboxHandle(localId)
      }
      console.error('[Microsandbox] Failed to create sandbox:', error.message)
      throw new Error(
        `${error.message}. Start microsandbox with: msb server start --dev`,
      )
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const instance = sandboxInstances.get(sandboxId)
    if (!instance) {
      // Check if it's a local sandbox
      if (sandboxId.startsWith('local-')) {
        return new LocalSandboxHandle(sandboxId)
      }
      throw new Error(`Microsandbox session ${sandboxId} not found`)
    }
    instance.lastActive = Date.now() // Update last active time
    return new MicrosandboxSandboxHandle(instance.sandbox)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const instance = sandboxInstances.get(sandboxId)
    if (instance) {
      await instance.sandbox.stop()
      sandboxInstances.delete(sandboxId)
      return
    }
    
    // Handle local sandbox cleanup
    if (sandboxId.startsWith('local-')) {
      try {
        const fs = require('fs').promises
        const workspacePath = path.resolve(process.cwd(), 'local-workspace', sandboxId)
        await fs.rm(workspacePath, { recursive: true, force: true })
        console.log(`[Microsandbox] Cleaned up local sandbox: ${sandboxId}`)
      } catch (error: any) {
        console.warn(`[Microsandbox] Failed to cleanup local sandbox ${sandboxId}:`, error.message)
      }
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

    // Execute command using microsandbox's run() method
    // Per docs: sb.run(code) executes code in the sandbox
    const effectiveTimeout = timeout ?? 60_000;

    try {
      // Run the command in the sandbox
      const exec = await this.sb.run(safeCommand, { timeout: effectiveTimeout })
      
      // Check if execution had an error (per microsandbox docs)
      const hasError = await exec.has_error()
      const output = hasError ? await exec.error() : await exec.output()

      return {
        success: !hasError,
        output: output || '',
        exitCode: hasError ? 1 : 0,
      }
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

/**
 * Local Sandbox Handle - Fallback when microsandbox daemon is not running
 * Executes commands locally using Node.js child_process
 * NOTE: This is NOT sandboxed and should only be used for development/testing
 */
class LocalSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir: string
  private workspacePath: string

  constructor(id?: string) {
    this.id = id || `local-${Date.now()}`
    this.workspaceDir = './local-workspace'
    this.workspacePath = path.resolve(process.cwd(), 'local-workspace', this.id)
    
    // Create workspace directory
    const fs = require('fs')
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true })
    }
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const { exec } = require('child_process')
    const util = require('util')
    const execPromise = util.promisify(exec)

    const execCwd = cwd ? path.resolve(this.workspacePath, cwd.replace(/^\//, '')) : this.workspacePath
    
    try {
      const result = await execPromise(command, {
        cwd: execCwd,
        timeout: timeout || 60000,
        env: { ...process.env, NODE_ENV: 'development' },
      })

      return {
        success: true,
        output: result.stdout || result.stderr || '',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message || error.stderr || 'Command execution failed',
        exitCode: error.code || 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const fs = require('fs').promises
    const resolved = path.resolve(this.workspacePath, filePath.replace(/^\//, ''))
    
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, content, 'utf8')
      return {
        success: true,
        output: `File written: ${filePath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const fs = require('fs').promises
    const resolved = path.resolve(this.workspacePath, filePath.replace(/^\//, ''))
    
    try {
      const content = await fs.readFile(resolved, 'utf8')
      return {
        success: true,
        output: content,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async listDirectory(dirPath?: string): Promise<ToolResult> {
    const fs = require('fs').promises
    const resolved = dirPath 
      ? path.resolve(this.workspacePath, dirPath.replace(/^\//, ''))
      : this.workspacePath
    
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      const output = entries.map((entry: any) => {
        const prefix = entry.isDirectory() ? 'd' : '-'
        return `${prefix} ${entry.name}`
      }).join('\n')
      
      return {
        success: true,
        output: output,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async createPty(_options: PtyOptions): Promise<PtyHandle> {
    throw new Error('Local sandbox does not support PTY sessions.')
  }
}
