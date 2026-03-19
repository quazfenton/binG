/**
 * Vercel Sandbox Live Preview Service
 * 
 * Manages live preview URLs for applications running in Vercel Sandbox
 * Exposes ports and generates public preview URLs
 * 
 * @example
 * ```typescript
 * const previewService = new VercelPreviewService()
 * 
 * // Start a dev server and get preview URL
 * const { url, port } = await previewService.startPreview({
 *   sandboxId: 'sandbox-123',
 *   command: 'npm run dev',
 *   port: 3000,
 * })
 * 
 * console.log(`Preview available at: ${url}`)
 * 
 * // Stop preview
 * await previewService.stopPreview(sandboxId)
 * ```
 */

import { vercelSandboxProvider } from '../sandbox/providers/vercel-sandbox-provider'
import type { PreviewInfo } from '../sandbox/types'

export interface PreviewConfig {
  sandboxId: string
  port: number
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  autoStop?: boolean
  timeout?: number
}

export interface PreviewSession {
  sandboxId: string
  port: number
  url: string
  command?: string
  startedAt: Date
  timeout?: NodeJS.Timeout
  autoStop: boolean
}

export class VercelPreviewService {
  private activePreviews = new Map<string, PreviewSession>()
  private readonly defaultTimeout = 30 * 60 * 1000 // 30 minutes

  /**
   * Start a live preview for a sandbox
   * 
   * 1. Gets or creates sandbox
   * 2. Starts dev server command
   * 3. Waits for port to be ready
   * 4. Generates public preview URL
   * 5. Sets up auto-cleanup
   */
  async startPreview(config: PreviewConfig): Promise<PreviewInfo & { startedAt: Date }> {
    const {
      sandboxId,
      port,
      command = 'npm run dev',
      args = [],
      cwd = '/vercel/sandbox/workspace',
      env = {},
      autoStop = true,
      timeout = this.defaultTimeout,
    } = config

    // Check if preview already exists
    const existing = this.activePreviews.get(sandboxId)
    if (existing) {
      console.log('[VercelPreview] Preview already running for sandbox:', sandboxId)
      return {
        port: existing.port,
        url: existing.url,
        startedAt: existing.startedAt,
      }
    }

    console.log('[VercelPreview] Starting preview for sandbox:', sandboxId, 'on port:', port)

    // Get sandbox handle
    const sandbox = await vercelSandboxProvider.getSandbox(sandboxId)

    // Parse command
    const [cmd, ...cmdArgs] = command.split(/\s+/)
    const allArgs = [...cmdArgs, ...args]
    const fullCommand = [cmd, ...allArgs].join(' ')

    // Start dev server in background
    try {
      // Start command (detached so it keeps running)
      await sandbox.executeCommand(fullCommand, cwd)
      
      // Wait for port to be ready (poll with timeout)
      await this.waitForPort(sandbox, port, timeout)

      // Get preview URL
      const previewInfo = await sandbox.getPreviewLink(port)

      // Create preview session
      const session: PreviewSession = {
        sandboxId,
        port,
        url: previewInfo.url,
        command,
        startedAt: new Date(),
        autoStop,
      }

      // Set up auto-stop timeout
      if (autoStop && timeout > 0) {
        session.timeout = setTimeout(() => {
          console.log('[VercelPreview] Auto-stopping preview for sandbox:', sandboxId)
          this.stopPreview(sandboxId).catch(console.error)
        }, timeout)
      }

      this.activePreviews.set(sandboxId, session)

      console.log('[VercelPreview] Preview started:', previewInfo.url)

      return {
        port: previewInfo.port,
        url: previewInfo.url,
        startedAt: session.startedAt,
      }
    } catch (error: any) {
      console.error('[VercelPreview] Failed to start preview:', error.message)
      throw error
    }
  }

  /**
   * Stop a live preview
   */
  async stopPreview(sandboxId: string): Promise<void> {
    const session = this.activePreviews.get(sandboxId)
    
    if (!session) {
      console.log('[VercelPreview] No active preview for sandbox:', sandboxId)
      return
    }

    console.log('[VercelPreview] Stopping preview for sandbox:', sandboxId)

    // Clear timeout
    if (session.timeout) {
      clearTimeout(session.timeout)
    }

    // Stop sandbox
    try {
      const sandbox = await vercelSandboxProvider.getSandbox(sandboxId)
      // @ts-ignore - stop may not exist on all sandbox implementations
      await sandbox.stop()
    } catch (error: any) {
      console.warn('[VercelPreview] Failed to stop sandbox:', error.message)
    }

    // Remove session
    this.activePreviews.delete(sandboxId)
  }

  /**
   * Get preview info for active preview
   */
  getPreview(sandboxId: string): PreviewSession | undefined {
    return this.activePreviews.get(sandboxId)
  }

  /**
   * List all active previews
   */
  listActivePreviews(): PreviewSession[] {
    return Array.from(this.activePreviews.values())
  }

  /**
   * Extend preview timeout
   */
  async extendPreview(sandboxId: string, duration: number): Promise<void> {
    const session = this.activePreviews.get(sandboxId)
    
    if (!session) {
      throw new Error(`No active preview for sandbox: ${sandboxId}`)
    }

    // Clear existing timeout
    if (session.timeout) {
      clearTimeout(session.timeout)
    }

    // Set new timeout
    session.timeout = setTimeout(() => {
      console.log('[VercelPreview] Auto-stopping preview for sandbox:', sandboxId)
      this.stopPreview(sandboxId).catch(console.error)
    }, duration)

    // Extend sandbox timeout via Vercel SDK
    try {
      const sandbox = await vercelSandboxProvider.getSandbox(sandboxId)
      // @ts-ignore - extendTimeout may not exist on all sandbox implementations
      await sandbox.extendTimeout(duration)
    } catch (error: any) {
      console.warn('[VercelPreview] Failed to extend sandbox timeout:', error.message)
    }
  }

  /**
   * Update network policy for preview (firewall rules)
   */
  async updateNetworkPolicy(
    sandboxId: string,
    policy: 'allow-all' | 'deny-all' | { allow: string[] }
  ): Promise<void> {
    const { vercelSandboxProvider } = await import('../sandbox/providers/vercel-sandbox-provider')
    const sandbox = await vercelSandboxProvider.getSandbox(sandboxId)

    // @ts-ignore - updateNetworkPolicy is available on VercelSandboxHandle
    if (typeof (sandbox as any).updateNetworkPolicy === 'function') {
      // @ts-ignore
      await (sandbox as any).updateNetworkPolicy(policy)
    }
  }

  /**
   * Wait for port to be ready (polling)
   */
  private async waitForPort(
    sandbox: any,
    port: number,
    timeout: number,
    interval: number = 1000
  ): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        // Check if port is listening
        const result = await sandbox.executeCommand(
          'bash',
          undefined,
          undefined,
          `-c "nc -z localhost ${port} 2>/dev/null && echo 'ready' || echo 'waiting'"`
        )

        if (result.output.includes('ready')) {
          console.log('[VercelPreview] Port', port, 'is ready')
          return
        }
      } catch (error) {
        // Port not ready yet, continue polling
      }

      await new Promise(resolve => setTimeout(resolve, interval))
    }

    throw new Error(`Port ${port} did not become ready within ${timeout}ms`)
  }

  /**
   * Cleanup all previews on shutdown
   */
  async cleanup(): Promise<void> {
    console.log('[VercelPreview] Cleaning up', this.activePreviews.size, 'active previews')

    const promises = Array.from(this.activePreviews.keys()).map(sandboxId =>
      this.stopPreview(sandboxId).catch(console.error)
    )

    await Promise.all(promises)
    this.activePreviews.clear()
  }
}

// Export singleton instance
export const vercelPreviewService = new VercelPreviewService()

// Handle process shutdown
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => vercelPreviewService.cleanup())
  process.on('SIGTERM', () => vercelPreviewService.cleanup())
  process.on('exit', () => vercelPreviewService.cleanup())
}
