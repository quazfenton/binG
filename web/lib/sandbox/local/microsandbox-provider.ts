import type { ToolResult } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
} from '../providers/sandbox-provider'
import * as path from 'node:path';
import { ensureMicrosandboxDaemonRunning } from './microsandbox-daemon';

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
    console.log('[Microsandbox] Provider initialized')
  }

  /**
   * Create Microsandbox instance
   *
   * SECURITY: Local fallback is DISABLED in production to prevent
   * command execution without sandbox isolation.
   *
   * In development, local fallback is allowed but shows security warning.
   */
  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    try {
      console.log(`[Microsandbox] Creating sandbox - User: ${config.labels?.userId || 'unknown'}, Language: ${config.language || 'default'}`)
      
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

      console.log(`[Microsandbox] ✓ Created sandbox ${sandboxId}`)

      const handle = new MicrosandboxSandboxHandle(sb)
      return handle
    } catch (error: any) {
      console.error(`[Microsandbox] ✗ Failed to create sandbox:`, error.message)
      console.error(`[Microsandbox] Error details:`, {
        name: error.name,
        message: error.message,
      })
      
      // SECURITY: NEVER allow local fallback in production
      // Local fallback executes commands on host system without isolation
      if (process.env.NODE_ENV === 'production') {
        console.error('[Microsandbox] Production error - daemon unavailable:', error.message)
        throw new Error(
          `Microsandbox daemon unavailable in production. ` +
          `This is a critical security requirement. ` +
          `Start microsandbox with: msb server start --prod`
        )
      }

      // Development mode - allow fallback with STRONG security warning
      const allowLocalFallback = process.env.MICROSANDBOX_ALLOW_LOCAL_FALLBACK !== 'false'
      if (allowLocalFallback) {
        const localId = `local-${Date.now()}`
        console.warn(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ⚠️  SECURITY WARNING: Using local fallback sandbox (NO ISOLATION)            ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  This is ONLY safe for local development. Commands will execute on your       ║
║  host system without any sandbox isolation.                                    ║
║                                                                                ║
║  For production or any multi-tenant environment:                               ║
║  1. Install microsandbox: npm install -g microsandbox                         ║
║  2. Start daemon: msb server start --dev                                      ║
║  3. Set MICROSANDBOX_ALLOW_LOCAL_FALLBACK=false                               ║
║                                                                                ║
║  This warning will not appear in production - local fallback is blocked.      ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`)
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
   * 
   * SECURITY: Uses pattern-based blocking instead of blanket metacharacter rejection.
   * This allows useful shell features (pipes, redirects, variables) while blocking
   * genuinely dangerous patterns.
   * 
   * Blocked patterns:
   * - Command chaining with dangerous commands (rm, chmod, sudo, etc.)
   * - Pipe to shell interpreters (| bash, | sh)
   * - Redirects to system directories (>/dev/, >/etc/)
   * - Command substitution with binaries ($(/bin/...))
   * - Null bytes and control characters
   */
  private sanitizeCommand(command: string): string {
    // First check for control characters (always blocked)
    if (/[\n\r\0]/.test(command)) {
      throw new Error('Command contains invalid control characters');
    }

    // Block dangerous command patterns (not individual characters)
    const dangerousPatterns = [
      // Dangerous command chaining with ; followed by destructive commands
      { pattern: /;\s*(rm\s+-rf|chmod\s+777|chown\s+root|sudo|su\s+|kill\s+-9|mkfs|dd\s+if=)/i, reason: 'Dangerous command chaining' },
      
      // Pipe to shell interpreters (classic RCE pattern)
      { pattern: /\|\s*(ba)?sh\b/i, reason: 'Pipe to shell interpreter' },
      { pattern: /\|\s*(curl|wget).*\|\s*(ba)?sh\b/i, reason: 'Download and execute pattern' },
      
      // Redirects to system directories
      { pattern: />\s*\/(dev|etc|proc|sys|root)\//i, reason: 'Redirect to system directory' },
      
      // Command substitution with system binaries
      { pattern: /\$\([^)]*\/bin\//i, reason: 'Command substitution with system binary' },
      { pattern: /`[^`]*\/bin\/[^`]*`/, reason: 'Backtick command substitution with system binary' },
      
      // Process substitution (bash-specific RCE)
      { pattern: /<\([^)]*\/bin\//i, reason: 'Process substitution with system binary' },
      
      // Eval/exec patterns
      { pattern: /\beval\b\s*[\(\{]/i, reason: 'Eval execution' },
      { pattern: /\bexec\b\s*[\(\{]/i, reason: 'Exec execution' },
      
      // Fork bomb pattern
      { pattern: /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, reason: 'Fork bomb pattern' },
    ];

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked by security policy: ${reason}`);
      }
    }

    // Command is safe to execute
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

  /**
   * Sanitize command to prevent shell injection (same as MicrosandboxSandboxHandle)
   */
  private sanitizeCommand(command: string): string {
    // Check for control characters
    if (/[\n\r\0]/.test(command)) {
      throw new Error('Command contains invalid control characters');
    }

    // Block dangerous command patterns
    const dangerousPatterns = [
      { pattern: /;\s*(rm\s+-rf|chmod\s+777|chown\s+root|sudo|su\s+|kill\s+-9|mkfs|dd\s+if=)/i, reason: 'Dangerous command chaining' },
      { pattern: /\|\s*(ba)?sh\b/i, reason: 'Pipe to shell interpreter' },
      { pattern: /\|\s*(curl|wget).*\|\s*(ba)?sh\b/i, reason: 'Download and execute pattern' },
      { pattern: />\s*\/(dev|etc|proc|sys|root)\//i, reason: 'Redirect to system directory' },
      { pattern: /\$\([^)]*\/bin\//i, reason: 'Command substitution with system binary' },
      { pattern: /`[^`]*\/bin\/[^`]*`/, reason: 'Backtick command substitution with system binary' },
      { pattern: /<\([^)]*\/bin\//i, reason: 'Process substitution with system binary' },
      { pattern: /\beval\b\s*[\(\{]/i, reason: 'Eval execution' },
      { pattern: /\bexec\b\s*[\(\{]/i, reason: 'Exec execution' },
      { pattern: /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, reason: 'Fork bomb pattern' },
    ];

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked by security policy: ${reason}`);
      }
    }

    return command;
  }

  /**
   * Resolve and validate path to prevent path traversal attacks
   */
  private resolvePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');

    // Reject path traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // For relative paths, resolve within workspace
    const resolved = path.resolve(this.workspacePath, normalized.replace(/^\//, ''));

    // Verify the resolved path is within workspace
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    return resolved;
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    // SECURITY: Sanitize command to prevent injection
    const safeCommand = this.sanitizeCommand(command);

    // SECURITY: Use execFile instead of exec for safer execution
    const { execFile } = require('child_process');
    const util = require('util');
    const execFilePromise = util.promisify(execFile);

    const execCwd = cwd ? path.resolve(this.workspacePath, cwd.replace(/^\//, '')) : this.workspacePath;

    try {
      // Convert timeout from seconds to milliseconds (callers pass seconds)
      // Default to 60 seconds if not specified
      const timeoutMs = timeout ? timeout * 1000 : 60000;

      // SECURITY: Parse command into binary + args for execFile
      // This prevents shell interpretation while preserving functionality
      const [binary, ...args] = safeCommand.split(' ').filter(Boolean);

      const result = await execFilePromise(binary, args, {
        cwd: execCwd,
        timeout: timeoutMs,
        env: { ...process.env, NODE_ENV: 'development' },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer limit
      });

      return {
        success: true,
        output: result.stdout || result.stderr || '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || error.stderr || 'Command execution failed',
        exitCode: error.code || 1,
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const fs = require('fs').promises
    // SECURITY: Use resolvePath to prevent path traversal
    const resolved = this.resolvePath(filePath)

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
    // SECURITY: Use resolvePath to prevent path traversal
    const resolved = this.resolvePath(filePath)

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
    // SECURITY: Use resolvePath to prevent path traversal
    const resolved = dirPath
      ? this.resolvePath(dirPath)
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
