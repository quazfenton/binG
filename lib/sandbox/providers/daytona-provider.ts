import { Daytona } from '@daytonaio/sdk'
import { resolve, relative } from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import { ComputerUseService, createComputerUseService } from './daytona-computer-use-service'
import { LSPService, createLSPService, type LSPLanguageId } from './daytona-lsp-service'
import { ObjectStorageService, createObjectStorageService } from './daytona-object-storage-service'

const WORKSPACE_DIR = '/home/daytona/workspace'
const MAX_COMMAND_TIMEOUT = 120

// Persistent cache configuration
const USE_PERSISTENT_CACHE = process.env.SANDBOX_PERSISTENT_CACHE === 'true'
const CACHE_VOLUME_NAME = process.env.SANDBOX_CACHE_VOLUME_NAME || 'global-package-cache'
const CACHE_SIZE = process.env.SANDBOX_CACHE_SIZE || '2GB'

export class DaytonaProvider implements SandboxProvider {
  readonly name = 'daytona'
  private client: Daytona

  constructor() {
    this.client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY!,
    })
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    // Map language to Docker image
    // Using official Docker Hub images - Daytona accepts any valid Docker image reference
    // See: https://www.daytona.io/docs/en/getting-started.md#create-a-sandbox
    const imageMap: Record<string, string> = {
      // TypeScript/JavaScript - Node.js official images
      'typescript': 'node:20-slim',
      'javascript': 'node:20-slim',
      'node': 'node:20-slim',
      'nodejs': 'node:20-slim',
      
      // Python official images
      'python': 'python:3.11-slim',
      'python3': 'python:3.11-slim',
      'py': 'python:3.11-slim',
      
      // Go official images
      'go': 'golang:1.21',
      'golang': 'golang:1.21',
      
      // Rust official images
      'rust': 'rust:1.74',
      'rustlang': 'rust:1.74',
      
      // Java official images
      'java': 'eclipse-temurin:17-jre-alpine',
      'jdk': 'eclipse-temurin:17-jre-alpine',
      'jvm': 'eclipse-temurin:17-jre-alpine',
      
      // C/C++ official images
      'c': 'gcc:13',
      'cpp': 'gcc:13',
      'c++': 'gcc:13',
      'gcc': 'gcc:13',
      
      // Ruby official images
      'ruby': 'ruby:3.2-slim',
      'rb': 'ruby:3.2-slim',
      
      // PHP official images
      'php': 'php:8.2-cli',
      
      // .NET official images
      'csharp': 'mcr.microsoft.com/dotnet/sdk:8.0',
      'dotnet': 'mcr.microsoft.com/dotnet/sdk:8.0',
      '.net': 'mcr.microsoft.com/dotnet/sdk:8.0',
      
      // General purpose / multi-language
      'ubuntu': 'ubuntu:22.04',
      'debian': 'debian:bookworm-slim',
      'alpine': 'alpine:3.19',
      'bash': 'ubuntu:22.04',
      'shell': 'ubuntu:22.04',
      
      // Daytona official images (if available)
      'daytona-base': 'daytonaio/sandbox:latest',
    };
    const image = imageMap[config.language ?? 'typescript'] || 'node:20-slim';

    // Build sandbox creation params
    const createParams: any = {
      image: image,
      autoStopInterval: config.autoStopInterval ?? 60,
      resources: config.resources ?? { cpu: 2, memory: 4 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config.envVars,
      },
      labels: config.labels,
    }

    // Add persistent cache volume if enabled
    if (USE_PERSISTENT_CACHE) {
      createParams.volumes = [
        {
          volumeId: CACHE_VOLUME_NAME,
          mountPath: '/opt/cache',
          readOnly: false,
        }
      ]
      createParams.envVars.SANDBOX_CACHE_ENABLED = 'true'
    }

    const sandbox = await this.client.create(createParams)

    await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
    return new DaytonaSandboxHandle(sandbox, this.client)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const sandbox = await this.client.get(sandboxId)
    return new DaytonaSandboxHandle(sandbox, this.client)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = await this.client.get(sandboxId)
    await sandbox.delete()
  }
}

import { SandboxSecurityManager } from '../security-manager'

class DaytonaSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = '/home/daytona/workspace'
  private sandbox: any
  private client: Daytona
  private computerUseService?: ComputerUseService
  private lspService?: LSPService
  private objectStorageService?: ObjectStorageService

  constructor(sandbox: any, client: Daytona) {
    this.sandbox = sandbox
    this.id = sandbox.id
    this.client = client
  }

  /**
   * Get Computer Use Service for this sandbox
   * Requires DAYTONA_API_KEY environment variable
   */
  getComputerUseService(): ComputerUseService | null {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      console.warn('[Daytona] DAYTONA_API_KEY not set, Computer Use Service unavailable')
      return null
    }
    
    if (!this.computerUseService) {
      this.computerUseService = createComputerUseService(this.id, apiKey)
    }
    
    return this.computerUseService
  }

  /**
   * Get LSP Service for code intelligence
   * Supports TypeScript, Python, Go, Rust, and more
   */
  getLSPService(): LSPService | null {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      console.warn('[Daytona] DAYTONA_API_KEY not set, LSP Service unavailable')
      return null
    }
    
    if (!this.lspService) {
      this.lspService = createLSPService(this.id, apiKey)
    }
    
    return this.lspService
  }

  /**
   * Get Object Storage Service for large file persistence
   */
  getObjectStorageService(): ObjectStorageService | null {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      console.warn('[Daytona] DAYTONA_API_KEY not set, Object Storage unavailable')
      return null
    }
    
    if (!this.objectStorageService) {
      this.objectStorageService = createObjectStorageService(this.id, apiKey)
    }
    
    return this.objectStorageService
  }

  /**
   * Start screen recording
   * @see https://www.daytona.io/docs/en/computer-use.md#start-recording
   */
  async startRecording(options?: ScreenRecordingRequest): Promise<ToolResult> {
    const service = this.getComputerUseService()
    if (!service) throw new Error('Computer Use Service not available')
    return service.startRecording(options)
  }

  /**
   * Stop screen recording
   */
  async stopRecording(recordingId: string): Promise<ToolResult> {
    const service = this.getComputerUseService()
    if (!service) throw new Error('Computer Use Service not available')
    return service.stopRecording(recordingId)
  }

  /**
   * Take regional screenshot
   */
  async takeRegionScreenshot(x: number, y: number, width: number, height: number): Promise<ToolResult> {
    const service = this.getComputerUseService()
    if (!service) throw new Error('Computer Use Service not available')
    return service.takeRegion({ x, y, width, height })
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Use combined validation and sanitization
      const sanitized = SandboxSecurityManager.validateAndSanitizeCommand(command)
      
      const response = await this.sandbox.process.executeCommand(
        sanitized,
        cwd ?? this.workspaceDir,
        undefined,
        timeout ?? MAX_COMMAND_TIMEOUT,
      )
      
      return {
        success: response.exitCode === 0,
        output: response.result,
        exitCode: response.exitCode,
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Daytona] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
        }
      }
      
      return {
        success: false,
        output: error.message || 'Command execution failed',
        exitCode: -1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Use combined validation for path and content
      const { resolvedPath, validatedContent } = SandboxSecurityManager.validateWriteFile(
        filePath,
        content,
        this.workspaceDir
      )
      
      const dir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'))
      if (dir) {
        await this.sandbox.fs.createFolder(dir, '755')
      }
      await this.sandbox.fs.uploadFile(Buffer.from(validatedContent, 'utf-8'), resolvedPath)
      
      return { 
        success: true, 
        output: `File written: ${resolvedPath}` 
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Daytona] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
        }
      }
      
      return {
        success: false,
        output: error.message || 'Failed to write file',
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Validate path before reading
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const buffer = await this.sandbox.fs.downloadFile(resolved)
      return { 
        success: true, 
        output: buffer.toString('utf-8') 
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Daytona] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
        }
      }
      
      return {
        success: false,
        output: error.message || 'Failed to read file',
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Validate path before listing
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath)
      const files = await this.sandbox.fs.listFiles(resolved)
      const listing = files.map((f: any) => `${f.isDir ? 'd' : '-'} ${f.name}`).join('\n')
      return { 
        success: true, 
        output: listing || '(empty directory)' 
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Daytona] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
        }
      }
      
      return {
        success: false,
        output: error.message || 'Failed to list directory',
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    const preview = await this.sandbox.getPreviewLink(port)
    return { port, url: preview.url, token: preview.token }
  }

  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const ptyHandle = await this.sandbox.process.createPty({
      id: options.id,
      cwd: options.cwd ?? this.workspaceDir,
      envs: options.envs ?? { TERM: 'xterm-256color' },
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      onData: options.onData,
    })

    return new DaytonaPtyHandle(options.id, ptyHandle)
  }

  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const ptyHandle = await this.sandbox.process.connectPty(sessionId, {
      onData: options.onData,
    })
    return new DaytonaPtyHandle(sessionId, ptyHandle)
  }

  async killPty(sessionId: string): Promise<void> {
    const ptyHandle = await this.sandbox.process.getPty(sessionId)
    if (ptyHandle) {
      await ptyHandle.kill()
    }
  }

  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    const ptyHandle = await this.sandbox.process.getPty(sessionId)
    if (ptyHandle) {
      await ptyHandle.resize(cols, rows)
    }
  }
}

class DaytonaPtyHandle implements PtyHandle {
  readonly sessionId: string
  private handle: any

  constructor(sessionId: string, handle: any) {
    this.sessionId = sessionId
    this.handle = handle
  }

  async sendInput(data: string): Promise<void> {
    await this.handle.sendInput(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.handle.resize(cols, rows)
  }

  async waitForConnection(): Promise<void> {
    await this.handle.waitForConnection()
  }

  async wait(): Promise<{ exitCode: number }> {
    await this.handle.wait()
    return { exitCode: this.handle.exitCode || 0 }
  }

  async disconnect(): Promise<void> {
    await this.handle.disconnect()
  }

  async kill(): Promise<void> {
    await this.handle.kill()
  }
}
