/**
 * Terminal Panel Local Filesystem Handler
 *
 * Migrates proven local filesystem handling from TerminalPanel.tsx
 * Preserves all working functionality:
 * - Path resolution with scope path awareness
 * - VFS sync integration (bidirectional)
 * - Command-mode fallback execution
 * - Security checks
 * - All 40+ shell commands
 * - Snapshot restoration with VFS sync-back
 *
 * This is a CAREFUL migration - no functionality is changed, just refactored.
 */

import { LocalCommandExecutor, type LocalFilesystemEntry, type LocalCommandExecutorConfig } from './local-filesystem-executor'
import { createLogger } from '../utils/logger'
import { checkCommandSecurity, formatSecurityWarning, detectObfuscation, DEFAULT_SECURITY_CONFIG } from '../terminal/terminal-security'
// Types only - no server module imports
import type { VFSyncResult } from './vfs-sync-back.types'

const logger = createLogger('TerminalLocalFS')

export interface TerminalLocalFSConfig {
  terminalId: string
  filesystemScopePath?: string
  onWrite?: (text: string) => void
  onWriteLine?: (text: string) => void
  onWriteError?: (text: string) => void
  syncToVFS?: (filePath: string, content: string) => Promise<void>
  getLocalFileSystem?: () => Record<string, LocalFilesystemEntry>
  setLocalFileSystem?: (fs: Record<string, LocalFilesystemEntry>) => void
  onOpenEditor?: (filePath: string, editorType: 'nano' | 'vim' | 'vi') => void
}

/**
 * Terminal Panel Local Filesystem Handler
 * Wraps LocalCommandExecutor with TerminalPanel-specific functionality
 */
export class TerminalLocalFSHandler {
  private executor: LocalCommandExecutor
  private filesystemScopePath?: string
  private getLocalFileSystem?: () => Record<string, LocalFilesystemEntry>
  private setLocalFileSystem?: (fs: Record<string, LocalFilesystemEntry>) => void
  private syncToVFS?: (filePath: string, content: string) => Promise<void>
  private onOpenEditor?: (filePath: string, editorType: 'nano' | 'vim' | 'vi') => void

  constructor(config: TerminalLocalFSConfig) {
    this.filesystemScopePath = config.filesystemScopePath
    this.getLocalFileSystem = config.getLocalFileSystem
    this.setLocalFileSystem = config.setLocalFileSystem
    this.syncToVFS = config.syncToVFS
    this.onOpenEditor = config.onOpenEditor

    // Create executor with TerminalPanel's write callbacks and filesystem access
    this.executor = new LocalCommandExecutor({
      terminalId: config.terminalId,
      onWrite: config.onWrite,
      onWriteLine: config.onWriteLine,
      onWriteError: config.onWriteError,
      syncToVFS: async (path, content) => {
        // Call TerminalPanel's VFS sync
        if (this.syncToVFS) {
          await this.syncToVFS(path, content)
        }
      },
      getFileSystem: config.getLocalFileSystem,
      setFileSystem: config.setLocalFileSystem,
      onOpenEditor: config.onOpenEditor,
    })
  }

  /**
   * Execute a command with full TerminalPanel features:
   * - Security checks
   * - Command history
   * - Path resolution with scope awareness
   * - VFS sync
   */
  async executeCommand(
    command: string,
    options?: {
      isPtyMode?: boolean
      terminalMode?: 'local' | 'pty' | 'sandbox-cmd' | 'connecting' | 'editor' | 'command-mode'
    }
  ): Promise<boolean> {
    const trimmed = command.trim()
    
    // Security check (only in non-PTY mode)
    if (!options?.isPtyMode) {
      const securityResult = checkCommandSecurity(trimmed)
      if (!securityResult.allowed) {
        if (this.executor['onWriteError']) {
          this.executor['onWriteError'](formatSecurityWarning(securityResult))
        }
        logger.warn('Blocked command', {
          command: trimmed,
          reason: securityResult.reason,
          severity: securityResult.severity,
        })
        return true
      }

      // Check for obfuscation
      if (DEFAULT_SECURITY_CONFIG.enableObfuscationDetection) {
        const obfuscation = detectObfuscation(trimmed)
        if (obfuscation.detected && DEFAULT_SECURITY_CONFIG.blockOnObfuscation) {
          if (this.executor['onWriteLine']) {
            this.executor['onWriteLine'](`\x1b[33m⚠️ Obfuscation detected: ${obfuscation.patterns.join(', ')}\x1b[0m`)
            this.executor['onWriteLine']('\x1b[90mThis command was blocked due to suspicious patterns.\x1b[0m')
            this.executor['onWriteLine']('\x1b[90mFor full terminal access, use the sandbox terminal (type "connect").\x1b[0m')
          }
          return true
        }
      }
    }

    // Execute command
    await this.executor.execute(trimmed)
    return true
  }

  /**
   * Resolve path with TerminalPanel's scope-aware logic
   */
  resolvePath(cwd: string, input: string): string {
    const raw = (input || '').trim().replace(/\\/g, '/')
    if (!raw) return cwd

    const scopePath = this.filesystemScopePath || 'project'

    // Handle absolute paths
    if (raw.startsWith('/')) {
      const parts = raw.split('/').filter(Boolean)
      const stack: string[] = []
      for (const part of parts) {
        if (part === '.') continue
        if (part === '..') {
          if (stack.length > 0) stack.pop()
          continue
        }
        stack.push(part)
      }
      const result = stack.join('/')
      if (!result.startsWith(scopePath.replace(/^project\//, ''))) {
        return `${scopePath}/${result}`.replace(/\/+/g, '/')
      }
      return `${scopePath}/${result}`.replace(/\/+/g, '/')
    }

    // Handle relative paths
    const base = raw.startsWith('project') ? raw : `${cwd}/${raw}`.replace(/\/+/g, '/')
    const parts = base.split('/').filter(Boolean)
    const stack: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        if (stack.length > scopePath.split('/').length) {
          stack.pop()
        }
        continue
      }
      stack.push(part)
    }
    if (stack.length === 0 || !stack[0].startsWith('project')) {
      return scopePath
    }
    return stack.join('/')
  }

  /**
   * Get current working directory
   */
  getCwd(): string {
    return this.executor.getCwd()
  }

  /**
   * Set current working directory
   */
  setCwd(cwd: string): void {
    this.executor.setCwd(cwd)
  }

  /**
   * Get filesystem (for TerminalPanel's localFileSystemRef compatibility)
   */
  getFileSystem(): Record<string, LocalFilesystemEntry> {
    // Use TerminalPanel's filesystem if available
    if (this.getLocalFileSystem) {
      return this.getLocalFileSystem()
    }
    return this.executor.getFileSystem()
  }

  /**
   * Set filesystem (for TerminalPanel's localFileSystemRef compatibility)
   */
  setFileSystem(fs: Record<string, LocalFilesystemEntry>): void {
    // Update TerminalPanel's filesystem if available
    if (this.setLocalFileSystem) {
      this.setLocalFileSystem(fs)
    }
    this.executor.setFileSystem(fs)
  }

  /**
   * Ensure project root exists (TerminalPanel compatibility)
   */
  ensureProjectRootExists(): void {
    const fs = this.getFileSystem()
    const scopePath = this.filesystemScopePath || 'project'

    if (!fs['project']) {
      fs['project'] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }
    }
    if (scopePath !== 'project' && !fs[scopePath]) {
      fs[scopePath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }
    }

    if (this.setLocalFileSystem) {
      this.setLocalFileSystem(fs)
    }
  }

  /**
   * List local directory (TerminalPanel compatibility)
   */
  listDirectory(path: string): string[] {
    const fs = this.getFileSystem()
    const entries: string[] = []

    for (const key of Object.keys(fs)) {
      const parent = this.getParentPath(key)
      if (parent === path) {
        const name = key.split('/').pop() || key
        entries.push(name)
      }
    }
    return entries.sort()
  }

  /**
   * Get parent path (TerminalPanel compatibility)
   */
  getParentPath(path: string): string {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    return parts.join('/') || 'project'
  }

  /**
   * Sync file to VFS (TerminalPanel compatibility)
   */
  async syncFileToVFS(filePath: string, content: string): Promise<void> {
    if (this.syncToVFS) {
      await this.syncToVFS(filePath, content)
    }
  }

  /**
   * Restore snapshot and sync files back to local filesystem
   * Calls API route instead of direct service import to avoid bundling server modules
   */
  async restoreSnapshot(
    sessionId: string,
    options?: {
      syncToVFS?: boolean
      onProgress?: (progress: { synced: number; total: number; currentFile: string }) => void
    }
  ): Promise<VFSyncResult> {
    logger.info('Restoring snapshot', { sessionId, options })

    // Call API route instead of importing server module
    // This prevents bundling vfs-sync-back.ts and its dependencies in client bundle
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/filesystem/snapshot/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId,
          scopePath: this.filesystemScopePath || 'project',
          syncToVFS: options?.syncToVFS !== false,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to restore snapshot' }));
        throw new Error(error.error || 'Failed to restore snapshot');
      }

      const result = await response.json();
      
      logger.info('Snapshot restored via API', {
        filesSynced: result.data?.filesSynced,
        status: result.data?.status,
      });

      return result.data;
    } catch (error) {
      logger.error('Failed to restore snapshot', error);
      throw error;
    }
  }

  /**
   * Sync external filesystem to executor
   */
  syncFileSystem(fs: Record<string, LocalFilesystemEntry>): void {
    this.executor.setFileSystem(fs)
  }
}

/**
 * Create Terminal Panel Local FS Handler
 * Factory function for easy integration
 */
export function createTerminalLocalFSHandler(config: TerminalLocalFSConfig): TerminalLocalFSHandler {
  return new TerminalLocalFSHandler(config)
}
