import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'
import { generateSecureId } from '@/lib/utils'

const WORKSPACE_DIR = '/workspace'

// Full FileSystemAPI types from WebContainer docs
interface FileSystemAPI {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string }): Promise<void>
  readFile(path: string, encoding?: string | null): Promise<Uint8Array | string>
  readdir(path: string, options?: { encoding?: string; withFileTypes?: boolean }): Promise<any[]>
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  watch(
    path: string,
    options?: { encoding?: string; recursive?: boolean },
    listener?: (event: 'rename' | 'change', filename: string | Buffer) => void
  ): { close(): void }
}

interface WebContainerProcess {
  output: ReadableStream<Uint8Array>
  input: WritableStream<string>
  exit: Promise<number>
  kill(): void
  resize(dimensions: { cols: number; rows: number }): void
}

interface WebContainerInstance {
  fs: FileSystemAPI
  spawn(command: string, args?: string[], options?: SpawnOptions): Promise<WebContainerProcess>
  mount(tree: FileSystemTree | Uint8Array, options?: { mountPoint?: string }): Promise<void>
  export(path: string, options?: ExportOptions): Promise<Uint8Array | FileSystemTree>
  on(event: 'port' | 'error' | 'server-ready' | 'preview-message', listener: (...args: any[]) => void): () => void
  teardown(): void
  readonly path: string
  readonly workdir: string
}

interface SpawnOptions {
  cwd?: string
  env?: Record<string, string | number | boolean>
  output?: boolean
  terminal?: { cols: number; rows: number }
}

interface ExportOptions {
  format?: 'json' | 'binary' | 'zip'
  includes?: string[]
  excludes?: string[]
}

interface FileSystemTree {
  [name: string]: FileNode | DirectoryNode | SymlinkNode
}

interface FileNode {
  file: { contents: string | Uint8Array }
}

interface DirectoryNode {
  directory: FileSystemTree
}

interface SymlinkNode {
  file: { symlink: string }
}

interface BootOptions {
  coep?: 'require-corp' | 'credentialless' | 'none'
  workdirName?: string
  forwardPreviewErrors?: boolean | 'exceptions-only'
}

type WebContainerModule = {
  WebContainer: {
    boot(options?: BootOptions): Promise<WebContainerInstance>
  }
  reloadPreview(preview: HTMLIFrameElement, hardRefreshTimeout?: number): Promise<void>
  configureAPIKey(key: string): void
  auth?: {
    init(options: { clientId: string; scope: string }): { status: 'need-auth' | 'authorized' } | any
    loggedIn(): Promise<void>
    logout(options?: { ignoreRevokeError?: boolean }): Promise<void>
    on(event: 'logged-out' | 'auth-failed', listener: () => void): () => void
  }
}

const filesystemHandles = new Map<string, WebContainerFileSystemHandle>()

export class WebContainerFileSystemProvider implements SandboxProvider {
  readonly name = 'webcontainer-filesystem'
  private modulePromise: Promise<WebContainerModule> | null = null

  private async loadModule(): Promise<WebContainerModule> {
    if (typeof window === 'undefined') {
      throw new Error('WebContainer provider requires a browser runtime')
    }

    if (!this.modulePromise) {
      this.modulePromise = new Function('return import("@webcontainer/api")')() as Promise<WebContainerModule>
    }

    return this.modulePromise
  }

  private async bootWebContainer(): Promise<WebContainerInstance> {
    const mod = await this.loadModule()
    const clientId = (process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____').trim()
    const scope = (process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '').trim()

    if (mod.auth?.init) {
      mod.auth.init({ clientId, scope })
    }

    const instance = await mod.WebContainer.boot()
    await instance.fs.mkdir(WORKSPACE_DIR, { recursive: true })
    return instance
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const instance = await this.bootWebContainer()

    // Pre-mount files if provided in config
    if (config.mounts && config.mounts.length > 0) {
      const tree = this.buildFileSystemTree(config.mounts)
      await instance.mount(tree)
    }

    const id = `wc-fs-${Date.now()}-${generateSecureId('fs').split('_')[2]}`
    const handle = new WebContainerFileSystemHandle(id, instance)
    filesystemHandles.set(id, handle)
    return handle
  }

  private buildFileSystemTree(mounts: Array<{ source: string; target: string }>): FileSystemTree {
    const tree: FileSystemTree = {}

    for (const mount of mounts) {
      const targetPath = mount.target.replace(/^\/workspace\//, '')
      const parts = targetPath.split('/')

      let current = tree
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isFile = i === parts.length - 1

        if (isFile) {
          current[part] = {
            file: {
              contents: '', // Would need to read source file content in real implementation
            },
          }
        } else {
          if (!current[part]) {
            current[part] = { directory: {} }
          }
          current = (current[part] as DirectoryNode).directory
        }
      }
    }

    return tree
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = filesystemHandles.get(sandboxId)
    if (!existing) {
      throw new Error(`WebContainer FileSystem sandbox not found: ${sandboxId}`)
    }
    return existing
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = filesystemHandles.get(sandboxId)
    if (handle) {
      handle.instance.teardown()
    }
    filesystemHandles.delete(sandboxId)
  }
}

class WebContainerFileSystemHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  private previews = new Map<number, string>()
  private watchers = new Map<string, { close(): void }>()

  constructor(
    readonly id: string,
    readonly instance: WebContainerInstance,
  ) {
    this.instance.on('server-ready', (port: number, url: string) => {
      if (typeof port === 'number' && typeof url === 'string') {
        this.previews.set(port, url)
      }
    })

    this.instance.on('error', (error: { message: string }) => {
      console.error('[WebContainer FileSystem] Error:', error.message)
    })
  }

  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      const tokens = this.tokenizeCommand(sanitized)
      if (tokens.length === 0) {
        return { success: true, output: '', exitCode: 0 }
      }

      const [cmd, ...args] = tokens
      const process = await this.instance.spawn(cmd, args, {
        cwd: safeCwd,
        env: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
        output: true,
      })

      const output = await this.readStreamToString(process.output)
      const exitCode = await process.exit

      return {
        success: exitCode === 0,
        output,
        exitCode,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to execute command in WebContainer',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const dir = path.dirname(resolved)

      // Create directory structure if needed
      await this.instance.fs.mkdir(dir, { recursive: true })
      await this.instance.fs.writeFile(resolved, content)

      return {
        success: true,
        output: `File written: ${resolved}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to write file in WebContainer',
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const data = await this.instance.fs.readFile(resolved, 'utf-8')

      return {
        success: true,
        output: typeof data === 'string' ? data : new TextDecoder().decode(data),
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to read file in WebContainer',
        exitCode: 1,
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath || '.')
      const entries = await this.instance.fs.readdir(resolved, { withFileTypes: true })

      const output = entries
        .map((entry: any) => {
          const isDir = typeof entry?.isDirectory === 'function' ? entry.isDirectory() : false
          const isFile = typeof entry?.isFile === 'function' ? entry.isFile() : false
          const name = entry?.name || String(entry)
          const type = isDir ? 'd' : isFile ? '-' : '?'
          return `${type} ${name}`
        })
        .join('\n')

      return {
        success: true,
        output: output || '(empty)',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to list directory in WebContainer',
        exitCode: 1,
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    return {
      port,
      url: this.previews.get(port) || `http://localhost:${port}`,
    }
  }

  // ============================================
  // Extended FileSystemAPI Methods
  // ============================================

  /**
   * Remove a file or directory
   */
  async removeFile(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      await this.instance.fs.rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false })
      return { success: true, output: `Removed: ${resolved}`, exitCode: 0 }
    } catch (error: any) {
      return { success: false, output: error?.message || 'Failed to remove file', exitCode: 1 }
    }
  }

  /**
   * Rename/move a file
   */
  async renameFile(oldPath: string, newPath: string): Promise<ToolResult> {
    try {
      const resolvedOld = SandboxSecurityManager.resolvePath(this.workspaceDir, oldPath)
      const resolvedNew = SandboxSecurityManager.resolvePath(this.workspaceDir, newPath)
      await this.instance.fs.rename(resolvedOld, resolvedNew)
      return { success: true, output: `Renamed: ${resolvedOld} → ${resolvedNew}`, exitCode: 0 }
    } catch (error: any) {
      return { success: false, output: error?.message || 'Failed to rename file', exitCode: 1 }
    }
  }

  /**
   * Watch for file changes
   */
  watchFile(
    filePath: string,
    listener: (event: 'rename' | 'change', filename: string) => void
  ): { close(): void } {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    const watcher = this.instance.fs.watch(resolved, {}, listener)
    this.watchers.set(filePath, watcher)
    return watcher
  }

  /**
   * Watch directory recursively
   */
  watchDirectory(
    dirPath: string,
    listener: (event: 'rename' | 'change', filename: string) => void
  ): { close(): void } {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath)
    const watcher = this.instance.fs.watch(resolved, { recursive: true }, listener)
    this.watchers.set(dirPath, watcher)
    return watcher
  }

  /**
   * Mount a file system tree
   */
  async mount(tree: FileSystemTree): Promise<ToolResult> {
    try {
      await this.instance.mount(tree)
      return { success: true, output: 'Files mounted successfully', exitCode: 0 }
    } catch (error: any) {
      return { success: false, output: error?.message || 'Failed to mount files', exitCode: 1 }
    }
  }

  /**
   * Export filesystem to zip, binary, or json format
   */
  async export(path: string, format: 'zip' | 'binary' | 'json' = 'json'): Promise<ToolResult> {
    try {
      const data = await this.instance.export(path, { format })
      if (format === 'json') {
        return { success: true, output: JSON.stringify(data, null, 2), exitCode: 0 }
      }
      return { success: true, output: `[Binary data: ${(data as Uint8Array).length} bytes]`, exitCode: 0 }
    } catch (error: any) {
      return { success: false, output: error?.message || 'Failed to export filesystem', exitCode: 1 }
    }
  }

  /**
   * Create a process with terminal
   */
  async spawnWithTerminal(
    command: string,
    args: string[],
    terminal: { cols: number; rows: number }
  ): Promise<{ process: WebContainerProcess; output: string }> {
    const process = await this.instance.spawn(command, args, {
      terminal,
      output: true,
    })

    const output = await this.readStreamToString(process.output)
    return { process, output }
  }

  private tokenizeCommand(command: string): string[] {
    const matches = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) || []
    return matches.map(token => token.replace(/^['"]|['"]$/g, ''))
  }

  private async readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let output = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) output += decoder.decode(value, { stream: true })
    }

    output += decoder.decode()
    return output
  }
}
