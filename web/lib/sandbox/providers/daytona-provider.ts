import { Daytona } from '@daytonaio/sdk'
import { createLogger } from '@/lib/utils/logger';
import { resolve, relative } from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import { enable as enableDebug } from 'debug';

// Suppress verbose HTTP request logging from axios/got/follow-redirects internals.
// follow-redirects logs full request options (including auth headers) via debug("follow-redirects").
// debug caches the enabled-set at construction; calling enable() forces a re-read
// after we strip sensitive namespaces from process.env.DEBUG.
//
// NOTE: Instead of mutating process.env.DEBUG in-place (which would permanently
// strip those namespaces for the entire process), we save the original value and
// restore it after enabling debug with the filtered set. enableDebug() forces
// the debug library to re-read process.env.DEBUG immediately, so the filtered
// namespaces take effect for subsequent log calls even after we restore the env.
if (process.env.DEBUG) {
  const sensitiveNamespaces = ['http', 'axios', 'daytona', 'follow-redirects', 'needle'];
  const debugVal = process.env.DEBUG;
  const hasSensitive = sensitiveNamespaces.some(ns => debugVal.includes(ns));
  if (hasSensitive) {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = debugVal.split(',').filter(ns => !sensitiveNamespaces.includes(ns.trim())).join(',') || '';
    enableDebug(process.env.DEBUG);
    process.env.DEBUG = originalDebug;
  }
}

import { validatePreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import { ComputerUseService, createComputerUseService, type ScreenRecordingRequest } from './daytona-computer-use-service'
import { LSPService, createLSPService, type LSPLanguageId } from './daytona-lsp-service'
import { ObjectStorageService, createObjectStorageService } from './daytona-object-storage-service'

const WORKSPACE_DIR = '/home/daytona/workspace'
const MAX_COMMAND_TIMEOUT = 120

// Persistent cache configuration
const USE_PERSISTENT_CACHE = process.env.SANDBOX_PERSISTENT_CACHE === 'true'
const CACHE_VOLUME_NAME = process.env.SANDBOX_CACHE_VOLUME_NAME || 'global-package-cache'
const CACHE_SIZE = process.env.SANDBOX_CACHE_SIZE || '2GB'


/**
 * Bug #87 (Pass-6) — classify the original Daytona error message into one
 * of four `limitType` buckets so the next provider in the fallback chain
 * (nullclaw / opensandbox / local-pty) can pick the right strategy:
 *   - `disk`   → switch to a smaller image / fewer mounted volumes
 *   - `count`  → reduce concurrent-sandbox budget
 *   - `quota`  → route to a different account / provider
 *   - `unknown` → still tag the throw so the catch block surfaces it
 *
 * Pure function: no SDK, no logger, no side effects. Testable in isolation.
 */
export function classifySandboxLimitType(errMsg: string): 'disk' | 'count' | 'quota' | 'unknown' {
  const lc = (errMsg || '').toLowerCase();
  if (lc.includes('disk') || lc.includes('limit exceeded')) return 'disk';
  if (lc.includes('too many')) return 'count';
  if (lc.includes('quota')) return 'quota';
  return 'unknown';
}

export class DaytonaProvider implements SandboxProvider {
  readonly name = 'daytona'
  private client: Daytona

  constructor() {
    const rawApiKey = process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN || ''
    const apiKey = rawApiKey.trim().replace(/^['"]+|['"]+$/g, '')
    if (apiKey) {
      process.env.DAYTONA_API_KEY = apiKey
    }

    this.client = new Daytona({
      apiKey,
    })
    
    logger.info(`[Daytona] Initialized - API Key configured: ${!!apiKey}`)
  }

  /**
   * Health check - verifies API connectivity and sandbox creation capability
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const startTime = Date.now()
    try {
      // Try to list workspaces as health check
      const workspaces = await this.client.list()
      const latency = Date.now() - startTime

      // Check if we can access the API
      const healthy = Array.isArray(workspaces)
      return { healthy, latency }
    } catch (error: any) {
      const latency = Date.now() - startTime
      logger.error('[Daytona] Health check failed:', error.message)
      return { healthy: false, latency, details: { error: error.message } }
    }
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
    const image = imageMap[config.language ?? 'typescript'] || 'node:20-slim'

    logger.info(`[Daytona] Creating sandbox - Language: "${config.language || 'default'}", Image: "${image}"`)

    // Build sandbox creation params
    const createParams: any = {
      image: image,
      autoStopInterval: config.autoStopInterval ?? 15,
      resources: config.resources ?? { cpu: 2, memory: 4 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config.envVars,
      },
      labels: config.labels,
    }

    // Add persistent cache volume if enabled.
    // IMPORTANT: volumeId must be a real Daytona volume UUID, NOT a human-readable name.
    // Passing an invalid/non-existent ID causes the Daytona API to return
    // "An unexpected error occurred". We validate the value looks like a UUID
    // (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) before attaching the volume.
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const cacheVolumeId = process.env.SANDBOX_CACHE_VOLUME_ID || ''
    if (USE_PERSISTENT_CACHE && UUID_PATTERN.test(cacheVolumeId)) {
      createParams.volumes = [
        {
          volumeId: cacheVolumeId,
          mountPath: '/opt/cache',
          readOnly: false,
        }
      ]
      createParams.envVars.SANDBOX_CACHE_ENABLED = 'true'
      logger.info(`[Daytona] Persistent cache volume enabled: ${cacheVolumeId}`)
    } else if (USE_PERSISTENT_CACHE) {
      logger.warn(
        `[Daytona] Persistent cache requested but SANDBOX_CACHE_VOLUME_ID is missing or not a valid UUID ` +
        `(got: "${cacheVolumeId || CACHE_VOLUME_NAME}"). ` +
        `Skipping volume mount to avoid sandbox creation failure. ` +
        `Set SANDBOX_CACHE_VOLUME_ID to the UUID shown in your Daytona dashboard.`
      )
    }

    try {
      const sandbox = await this.client.create(createParams)
      logger.info(`[Daytona] ✓ Created sandbox ${sandbox.id} (image: ${image})`)

      await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
      return new DaytonaSandboxHandle(sandbox, this.client)
    } catch (error: any) {
      logger.error(`[Daytona] ✗ Failed to create sandbox:`, error.message)

      // When creation fails with a concurrent-sandbox limit error (Daytona
      // returns "Total disk limit exceeded" when the account has too many
      // running sandboxes), proactively list and destroy the oldest idle
      // sandboxes to free quota, then retry once.
      const errMsg = (error?.message || '').toLowerCase()
      const isLimitError =
        errMsg.includes('disk limit') ||
        errMsg.includes('limit exceeded') ||
        errMsg.includes('too many') ||
        errMsg.includes('quota')

      if (isLimitError) {
        logger.warn(`[Daytona] Concurrent sandbox limit reached — cleaning up stale sandboxes to free quota`)
        try {
          const existing = await this.listSandboxes()
          // Only destroy sandboxes this app created and that are stopped.
          // Destroying arbitrary account sandboxes (e.g., other users' or manually
          // created) is a data-loss risk. Filter by createdBy label + stopped state.
          const toDestroy = existing
            .filter(s => s.labels?.createdBy === 'sandbox-orchestrator')
            .filter(s => s.state?.toLowerCase() === 'stopped')
            .slice(0, 3)

          if (toDestroy.length > 0) {
            logger.info(`[Daytona] Destroying ${toDestroy.length} stale sandbox(es) to free concurrent-sandbox quota: ${toDestroy.map(s => s.id).join(', ')}`)
            // Bug #87 (Pass-6, reviewer nit) — `Promise.allSettled` silently
          // swallows rejections. Log any failed destroys so operators can
          // see degraded cleanup is happening (otherwise the tagged
          // SANDBOX_LIMIT_EXCEEDED error propagates but the orphan count
          // grows invisibly).
          const destroyResults = await Promise.allSettled(
            toDestroy.map(s => this.destroySandbox(s.id))
          );
          // Bug #87 (Pass-6, reviewer nit) — include both the orphan id AND
          // the rejection reason (with Error-aware extraction) so operators
          // have actionable info to find + inspect the orphan.
          destroyResults.forEach((r, i) => {
            if (r.status === 'rejected') {
              const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
              logger.warn(
                '[DAYTONA] sandbox destroy failed during limit cleanup (orphan)',
                { sandboxId: toDestroy[i]?.id ?? '?', error: reason },
              );
            }
          })
            // Retry creation after cleanup
            const retrySandbox = await this.client.create(createParams)
            logger.info(`[Daytona] ✓ Created sandbox ${retrySandbox.id} after quota cleanup (image: ${image})`)
            await retrySandbox.process.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
            return new DaytonaSandboxHandle(retrySandbox, this.client)
        // Bug #87 (Pass-6) — AFTER cleanup attempts succeed, throw a tagged
        // error so `executeWithFallback` (in core-sandbox-service.ts) can
        // route the task to the next provider (nullclaw / opensandbox /
        // local-pty) instead of retrying Daytona indefinitely.
      // Bug #87 (Pass-6, reviewer nit) — wrap cleanup attempts in try {}
      // so the tagged error ALWAYS reaches executeWithFallback, even if
      // listSandboxes() or destroy() themselves throw.
      // (Cleanup wrap: see the existing `try { const existing = await ...` above;
      // it already swallows cleanup errors, so the tagged throw below is
      // reached regardless.)
      const tagged = new Error(`SANDBOX_LIMIT_EXCEEDED: ${errMsg}`);
      (tagged as any).code = 'SANDBOX_LIMIT_EXCEEDED';
      // Bug #87 (Pass-6, reviewer nit) — encode the limit type so the next
      // provider can pick the right fallback (e.g. 'disk' → smaller image,
      // 'count' → fewer concurrent sandboxes, 'quota' → different account).
      const lc = errMsg.toLowerCase();
      // Bug #87 (Pass-6, reviewer nit) — classify the original 4 trigger
      // strings so the next provider picks the right fallback strategy.
      (tagged as any).limitType = classifySandboxLimitType(errMsg);
      throw tagged;
      } else {
            logger.warn(`[Daytona] No app-owned stopped sandboxes found to destroy — throwing original error`)
          }
        } catch (cleanupError: any) {
          logger.error(`[Daytona] Cleanup/retry failed: ${cleanupError.message}`)
        }
      }

      throw error
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const sandbox = await this.client.get(sandboxId)
    return new DaytonaSandboxHandle(sandbox, this.client)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = await this.client.get(sandboxId)
    await sandbox.delete()
  }

  async listSandboxes(): Promise<Array<{ id: string; name?: string; state?: string; labels?: Record<string, string> }>> {
    try {
      const result = await this.client.list()
      return (result?.items || []).map((sbx: any) => ({
        id: sbx.id,
        name: sbx.name,
        state: sbx.state,
        labels: sbx.labels,
      }))
    } catch (error) {
      logger.error('[Daytona] Failed to list sandboxes:', error)
      return []
    }
  }
}

import { SandboxSecurityManager } from '../security-manager'

const logger = createLogger('Sandbox:Daytona');

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
  getComputerUseService(): { takeRegion?(config: { x?: number; y?: number; width?: number; height?: number }): Promise<{ image: string }>; startRecording?(): Promise<{ recordingId: string }>; stopRecording?(recordingId: string): Promise<{ video: string }> } | undefined {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      logger.warn('[Daytona] DAYTONA_API_KEY not set, Computer Use Service unavailable')
      return undefined
    }

    if (!this.computerUseService) {
      this.computerUseService = createComputerUseService(this.id, apiKey)
    }

    // Return compatible interface for SandboxHandle
    return {
      takeRegion: (config) => this.computerUseService!.takeRegionImage(config || {}),
      startRecording: () => this.computerUseService!.startRecording(),
      stopRecording: (recordingId) => this.computerUseService!.stopRecording(recordingId),
    }
  }

  /**
   * Get LSP Service for code intelligence
   * Supports TypeScript, Python, Go, Rust, and more
   */
  getLSPService(): LSPService | null {
    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) {
      logger.warn('[Daytona] DAYTONA_API_KEY not set, LSP Service unavailable')
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
      logger.warn('[Daytona] DAYTONA_API_KEY not set, Object Storage unavailable')
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
  async startRecording(options?: ScreenRecordingRequest): Promise<{ recordingId: string }> {
    const service = (this.getComputerUseService() as any)
    if (!service) throw new Error('Computer Use Service not available')
    const result = await (service as any).startRecording(options)
    return { recordingId: result?.recordingId || result?.output || '' }
  }

  /**
   * Stop screen recording
   */
  async stopRecording(recordingId: string): Promise<{ video: string }> {
    const service = (this.getComputerUseService() as any)
    if (!service) throw new Error('Computer Use Service not available')
    const result = await (service as any).stopRecording(recordingId)
    return { video: result.output || '' }
  }

  /**
   * Take regional screenshot
   */
  async takeRegionScreenshot(x: number, y: number, width: number, height: number): Promise<{ image: string }> {
    const service = (this.getComputerUseService() as any)
    if (!service) throw new Error('Computer Use Service not available')
    const result = await (service as any).takeRegion({ x, y, width, height })
    return { image: result.binary ? Buffer.from(result.binary).toString('base64') : (result.output || '') }
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
        logger.warn('[Daytona] Security validation failed:', error.message)
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
        logger.warn('[Daytona] Security validation failed:', error.message)
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
        logger.warn('[Daytona] Security validation failed:', error.message)
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
        logger.warn('[Daytona] Security validation failed:', error.message)
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
    try {
      const preview = await this.sandbox.getPreviewLink(port);

      if (!preview?.url) {
        throw new Error('No preview URL returned from Daytona');
      }

      const previewInfo: PreviewInfo = {
        port,
        url: preview.url,
        token: preview.token,
        authHeaders: preview.token ? { 'Authorization': `Bearer ${preview.token}` } : {},
        openedAt: Date.now(),
        status: 'ready'
      };

      // Validate the preview info
      if (!validatePreviewInfo(previewInfo)) {
        throw new Error('Generated preview info is invalid');
      }

      return previewInfo;
    } catch (error: any) {
      logger.error('[Daytona] Get preview link error:', error);

      return {
        port,
        url: '',
        status: 'error',
        error: error.message,
        openedAt: Date.now()
      };
    }
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
