/**
 * Modal Sandbox Provider - Last Resort Fallback
 *
 * This provider serves as the absolute last fallback when all other sandbox
 * providers (daytona, e2b, sprites, codesandbox, microsandbox, etc.) fail.
 *
 * Instead of throwing an error, it returns a special handle that triggers
 * a UI modal to inform the user about the sandbox unavailability and
 * provides alternative options.
 *
 * Use Cases:
 * - All cloud providers are down/unavailable
 * - Local microsandbox daemon is not running
 * - Network connectivity issues
 * - API quota exceeded for all providers
 *
 * @see lib/sandbox/providers/modal-provider.ts
 * @see components/sandbox/modal-fallback.tsx
 */

import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import type { ToolResult, PreviewInfo } from '../types'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('ModalProvider')

/**
 * Modal sandbox handle - represents a "virtual" sandbox that shows a UI modal
 */
export class ModalSandboxHandle implements SandboxHandle {
  public readonly id: string
  public readonly workspaceDir = '/modal/fallback'
  public readonly createdAt: Date
  public readonly reason: ModalFallbackReason

  constructor(
    id: string,
    reason: ModalFallbackReason,
    public readonly failedProviders: string[]
  ) {
    this.id = id
    this.createdAt = new Date()
    this.reason = reason
  }

  /**
   * All execution methods return errors explaining the fallback situation
   */
  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number
  ): Promise<ToolResult> {
    logger.warn('Attempted to execute command in modal fallback', { command })
    return {
      success: false,
      error: this.getFallbackMessage(),
      blocked: true,
      hint: 'Please use the modal UI to select an alternative action',
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    logger.warn('Attempted to write file in modal fallback', { filePath })
    return {
      success: false,
      error: this.getFallbackMessage(),
      blocked: true,
      hint: 'Sandbox unavailable - file operations disabled',
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    logger.warn('Attempted to read file in modal fallback', { filePath })
    return {
      success: false,
      error: this.getFallbackMessage(),
      blocked: true,
      hint: 'Sandbox unavailable - file operations disabled',
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    logger.warn('Attempted to list directory in modal fallback', { dirPath })
    return {
      success: false,
      error: this.getFallbackMessage(),
      blocked: true,
      hint: 'Sandbox unavailable - filesystem access disabled',
    }
  }

  async getPreviewLink?(port: number): Promise<PreviewInfo> {
    logger.warn('Attempted to get preview link in modal fallback', { port })
    throw new Error(this.getFallbackMessage())
  }

  async createPty?(options: PtyOptions): Promise<PtyHandle> {
    logger.warn('Attempted to create PTY in modal fallback')
    throw new Error(this.getFallbackMessage())
  }

  async connectPty?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    logger.warn('Attempted to connect PTY in modal fallback')
    throw new Error(this.getFallbackMessage())
  }

  async killPty?(sessionId: string): Promise<void> {
    logger.warn('Attempted to kill PTY in modal fallback')
    throw new Error(this.getFallbackMessage())
  }

  async resizePty?(sessionId: string, cols: number, rows: number): Promise<void> {
    logger.warn('Attempted to resize PTY in modal fallback')
    throw new Error(this.getFallbackMessage())
  }

  /**
   * Get the fallback message explaining the situation
   */
  private getFallbackMessage(): string {
    const providerList = this.failedProviders.length > 0
      ? `Failed providers: ${this.failedProviders.join(', ')}`
      : 'All sandbox providers are unavailable'

    return `SANDBOX_UNAVAILABLE: ${this.reason}. ${providerList}. Please try again later or use local execution mode.`
  }

  /**
   * Get modal state for UI rendering
   */
  getModalState(): ModalState {
    return {
      sandboxId: this.id,
      reason: this.reason,
      failedProviders: this.failedProviders,
      createdAt: this.createdAt.toISOString(),
      suggestions: this.getSuggestions(),
    }
  }

  /**
   * Get suggestions for the user
   */
  private getSuggestions(): ModalSuggestion[] {
    const suggestions: ModalSuggestion[] = []

    switch (this.reason) {
      case 'all_providers_down':
        suggestions.push({
          action: 'retry',
          label: 'Retry Connection',
          description: 'Try reconnecting to sandbox providers',
        })
        suggestions.push({
          action: 'use_local',
          label: 'Use Local Execution',
          description: 'Run commands locally without sandbox isolation',
        })
        suggestions.push({
          action: 'check_status',
          label: 'Check Provider Status',
          description: 'View status of all sandbox providers',
        })
        break

      case 'quota_exceeded':
        suggestions.push({
          action: 'upgrade_quota',
          label: 'Upgrade Quota',
          description: 'Increase your sandbox usage limits',
        })
        suggestions.push({
          action: 'wait_reset',
          label: 'Wait for Reset',
          description: 'Quota will reset at the beginning of next period',
        })
        suggestions.push({
          action: 'use_local',
          label: 'Use Local Execution',
          description: 'Run commands locally without sandbox isolation',
        })
        break

      case 'network_error':
        suggestions.push({
          action: 'check_connection',
          label: 'Check Network',
          description: 'Verify your internet connection',
        })
        suggestions.push({
          action: 'retry',
          label: 'Retry Connection',
          description: 'Try reconnecting to sandbox providers',
        })
        suggestions.push({
          action: 'use_local',
          label: 'Use Local Execution',
          description: 'Run commands locally without sandbox isolation',
        })
        break

      case 'configuration_error':
        suggestions.push({
          action: 'fix_config',
          label: 'Fix Configuration',
          description: 'Update your sandbox provider configuration',
        })
        suggestions.push({
          action: 'use_local',
          label: 'Use Local Execution',
          description: 'Run commands locally without sandbox isolation',
        })
        break

      default:
        suggestions.push({
          action: 'retry',
          label: 'Retry',
          description: 'Try again',
        })
        suggestions.push({
          action: 'use_local',
          label: 'Use Local Execution',
          description: 'Run commands locally without sandbox isolation',
        })
    }

    return suggestions
  }
}

/**
 * Modal fallback reason
 */
export type ModalFallbackReason =
  | 'all_providers_down'
  | 'quota_exceeded'
  | 'network_error'
  | 'configuration_error'
  | 'unknown_error'

/**
 * Modal state for UI rendering
 */
export interface ModalState {
  sandboxId: string
  reason: ModalFallbackReason
  failedProviders: string[]
  createdAt: string
  suggestions: ModalSuggestion[]
}

/**
 * User suggestion for resolving the fallback
 */
export interface ModalSuggestion {
  action: string
  label: string
  description: string
}

/**
 * Modal Sandbox Provider
 *
 * Last resort fallback provider that returns a special handle
 * to trigger UI modal instead of throwing errors.
 */
export class ModalSandboxProvider implements SandboxProvider {
  public readonly name = 'modal'

  private handles = new Map<string, ModalSandboxHandle>()

  /**
   * Create a modal sandbox handle
   */
  async createSandbox(config: SandboxCreateConfig & {
    reason?: ModalFallbackReason
    failedProviders?: string[]
  }): Promise<ModalSandboxHandle> {
    const sandboxId = `modal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    const reason = config.reason || 'unknown_error'
    const failedProviders = config.failedProviders || []

    logger.warn('Creating modal fallback sandbox', {
      sandboxId,
      reason,
      failedProviders,
    })

    const handle = new ModalSandboxHandle(sandboxId, reason, failedProviders)
    this.handles.set(sandboxId, handle)

    return handle
  }

  /**
   * Get existing modal sandbox handle
   */
  async getSandbox(sandboxId: string): Promise<ModalSandboxHandle> {
    const handle = this.handles.get(sandboxId)
    if (!handle) {
      throw new Error(`Modal sandbox not found: ${sandboxId}`)
    }
    return handle
  }

  /**
   * Destroy modal sandbox handle
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    logger.debug('Destroying modal sandbox', { sandboxId })
    this.handles.delete(sandboxId)
  }

  /**
   * Get all active modal sandboxes
   */
  getActiveSandboxes(): ModalSandboxHandle[] {
    return Array.from(this.handles.values())
  }

  /**
   * Get modal state for a specific sandbox
   */
  getModalState(sandboxId: string): ModalState | null {
    const handle = this.handles.get(sandboxId)
    return handle?.getModalState() || null
  }
}

// Singleton instance
export const modalProvider = new ModalSandboxProvider()

/**
 * Create modal provider instance
 */
export function createModalProvider(): ModalSandboxProvider {
  return modalProvider
}

/**
 * Check if a sandbox handle is a modal fallback
 */
export function isModalFallback(handle: any): handle is ModalSandboxHandle {
  return handle instanceof ModalSandboxHandle
}

/**
 * Get modal state from handle
 */
export function getModalState(handle: SandboxHandle): ModalState | null {
  if (isModalFallback(handle)) {
    return handle.getModalState()
  }
  return null
}
