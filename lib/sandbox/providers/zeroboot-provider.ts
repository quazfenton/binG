/**
 * Zeroboot Provider
 *
 * Sub-millisecond VM sandboxes for AI agents using KVM copy-on-write forking.
 * Provides hardware-enforced memory isolation with ~0.79ms spawn latency.
 *
 * KEY CHARACTERISTICS:
 * - No network inside sandboxes (serial I/O only)
 * - Pre-baked templates (no runtime package installs)
 * - Hardware isolation via KVM
 * - Single vCPU per fork
 * - Best for: Untrusted code execution, security-critical workloads
 *
 * REQUIREMENTS:
 * - Linux host with KVM enabled (/dev/kvm)
 * - Hardware virtualization support (VT-x/AMD-V)
 * - Cannot run in standard Docker containers (needs /dev/kvm passthrough)
 *
 * @see https://github.com/zerobootdev/zeroboot
 */

import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  ToolResult,
  PreviewInfo,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('Sandbox:Zeroboot')

/**
 * Zeroboot API configuration
 */
export interface ZerobootConfig {
  /** Zeroboot API base URL (self-hosted or managed) */
  baseUrl: string
  /** API key for authentication */
  apiKey?: string
  /** Default runtime for code execution */
  defaultRuntime: 'node' | 'python'
  /** Timeout for code execution (ms) */
  timeout: number
}

/**
 * Zeroboot sandbox handle
 */
export interface ZerobootHandle extends SandboxHandle {
  readonly id: string
  readonly workspaceDir: string
  readonly runtime: 'node' | 'python'
  readonly templateId?: string
}

/**
 * Zeroboot execution request
 */
interface ZerobootExecRequest {
  runtime: 'node' | 'python'
  code: string
  timeout_ms?: number
  template_id?: string
}

/**
 * Zeroboot execution response
 */
interface ZerobootExecResponse {
  success: boolean
  output: string
  error?: string
  execution_time_ms?: number
  template_id?: string
}

/**
 * Zeroboot Provider Implementation
 *
 * NOTE: This provider is designed for CODE EXECUTION ONLY.
 * - No network access inside sandboxes
 * - No runtime package installation
 * - Templates must be pre-baked with dependencies
 *
 * Best used in a hybrid architecture:
 * - Docker sandboxes: npm install, git clone, builds (need network)
 * - Zeroboot: eval(), untrusted code, security-critical execution
 */
export class ZerobootProvider implements SandboxProvider {
  readonly name = 'zeroboot'
  private config: ZerobootConfig

  constructor(config?: Partial<ZerobootConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || process.env.ZERObOOT_BASE_URL || 'http://localhost:8080',
      apiKey: config?.apiKey || process.env.ZERObOOT_API_KEY,
      defaultRuntime: config?.defaultRuntime || 'node',
      timeout: config?.timeout || 5000,
    }

    logger.info('Zeroboot provider initialized', {
      baseUrl: this.config.baseUrl,
      hasApiKey: !!this.config.apiKey,
      defaultRuntime: this.config.defaultRuntime,
    })
  }

  /**
   * Create a Zeroboot sandbox (template fork)
   *
   * Note: Zeroboot sandboxes are ephemeral forks from a template.
   * They exist only for the duration of code execution.
   */
  async createSandbox(config: SandboxCreateConfig): Promise<ZerobootHandle> {
    logger.debug('Creating Zeroboot sandbox', { config })

    const runtime = (config.language === 'python' ? 'python' : 'node') as 'node' | 'python'

    const handle: ZerobootHandle = {
      id: `zeroboot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      workspaceDir: '/workspace',
      runtime,
      templateId: config.labels?.templateId,

      // These methods are no-ops for Zeroboot (ephemeral sandboxes)
      executeCommand: async (command, cwd, timeout) => {
        logger.warn('Zeroboot does not support shell commands - use executeCode instead')
        return {
          success: false,
          error: 'Zeroboot only supports code execution, not shell commands',
          exitCode: 1,
        }
      },

      writeFile: async (filePath, content) => {
        logger.warn('Zeroboot does not support file writes - files must be in template')
        return {
          success: false,
          error: 'Zeroboot sandboxes are read-only forks from template',
          exitCode: 1,
        }
      },

      readFile: async (filePath) => {
        logger.warn('Zeroboot does not support file reads - use code execution to access files')
        return {
          success: false,
          error: 'Zeroboot sandboxes are read-only forks from template',
          exitCode: 1,
        }
      },

      listDirectory: async (dirPath) => {
        logger.warn('Zeroboot does not support directory listing')
        return {
          success: false,
          error: 'Zeroboot sandboxes are read-only forks from template',
          exitCode: 1,
        }
      },

      getPreviewLink: async (port) => {
        logger.warn('Zeroboot does not support networking - no preview available')
        return {
          port,
          url: '',
          openedAt: Date.now(),
        }
      },

      // PTY not supported - Zeroboot is serial I/O only
      createPty: async (options: PtyOptions) => {
        throw new Error('Zeroboot does not support PTY - uses serial I/O only')
      },

      connectPty: async (sessionId: string, options: PtyConnectOptions) => {
        throw new Error('Zeroboot does not support PTY - uses serial I/O only')
      },

      killPty: async (sessionId: string) => {
        throw new Error('Zeroboot does not support PTY')
      },

      resizePty: async (sessionId: string, cols: number, rows: number) => {
        throw new Error('Zeroboot does not support PTY')
      },
    }

    logger.info('Zeroboot sandbox created', { id: handle.id, runtime })

    return handle
  }

  /**
   * Get sandbox by ID (no-op for Zeroboot - sandboxes are ephemeral)
   */
  async getSandbox(sandboxId: string): Promise<ZerobootHandle> {
    // Zeroboot sandboxes are ephemeral - recreate if needed
    logger.warn('Zeroboot sandboxes are ephemeral - returning new handle')
    return this.createSandbox({})
  }

  /**
   * Destroy sandbox (no-op for Zeroboot - sandboxes auto-terminate)
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    // Zeroboot sandboxes auto-terminate after execution
    logger.debug('Zeroboot sandbox auto-terminated', { sandboxId })
  }

  /**
   * Execute code in Zeroboot sandbox
   *
   * This is the PRIMARY method for Zeroboot - all other methods are no-ops.
   * Uses Zeroboot's HTTP API to fork a sandbox and execute code.
   */
  async executeCode(
    code: string,
    options?: {
      runtime?: 'node' | 'python'
      timeout?: number
      templateId?: string
    }
  ): Promise<ToolResult> {
    const runtime = options?.runtime || this.config.defaultRuntime
    const timeout = options?.timeout || this.config.timeout
    const templateId = options?.templateId

    logger.info('Executing code in Zeroboot', { runtime, timeout, templateId })

    const startTime = Date.now()

    try {
      const requestBody: ZerobootExecRequest = {
        runtime,
        code,
        timeout_ms: timeout,
        ...(templateId && { template_id: templateId }),
      }

      const response = await fetch(`${this.config.baseUrl}/v1/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && {
            'Authorization': `Bearer ${this.config.apiKey}`,
          }),
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Zeroboot API error: ${response.status} ${errorText}`)
      }

      const result: ZerobootExecResponse = await response.json()

      const executionTime = Date.now() - startTime

      logger.info('Zeroboot execution completed', {
        success: result.success,
        executionTime,
        zerobootExecutionTime: result.execution_time_ms,
      })

      return {
        success: result.success,
        output: result.output || '',
        error: result.error,
        executionTime: result.execution_time_ms || executionTime,
        exitCode: result.success ? 0 : 1,
        content: result.output,
      }
    } catch (error: any) {
      const executionTime = Date.now() - startTime

      logger.error('Zeroboot execution failed', {
        error: error.message,
        executionTime,
      })

      return {
        success: false,
        error: error.message,
        executionTime,
        exitCode: 1,
      }
    }
  }

  /**
   * Get provider info
   */
  async getProviderInfo() {
    return {
      provider: 'zeroboot',
      status: 'running' as const,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      characteristics: {
        spawnLatency: '~0.8ms',
        isolation: 'KVM hardware',
        networking: 'none (serial I/O only)',
        packageInstall: 'pre-baked templates only',
        vcpu: 'single',
      },
    }
  }

  /**
   * Get status
   */
  async getStatus(): Promise<{ status: string; uptime?: number }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
      })

      if (response.ok) {
        return {
          status: 'running',
          uptime: 0, // Zeroboot doesn't provide uptime
        }
      }
    } catch (error: any) {
      logger.debug('Zeroboot health check failed', { error: error.message })
    }

    return {
      status: 'unknown',
    }
  }
}

/**
 * Convenience function: Execute code in Zeroboot
 */
export async function executeInZeroboot(
  code: string,
  options?: {
    runtime?: 'node' | 'python'
    timeout?: number
    apiKey?: string
    baseUrl?: string
  }
): Promise<ToolResult> {
  const provider = new ZerobootProvider({
    apiKey: options?.apiKey,
    baseUrl: options?.baseUrl,
    timeout: options?.timeout,
    defaultRuntime: options?.runtime || 'node',
  })

  return provider.executeCode(code, {
    runtime: options?.runtime,
    timeout: options?.timeout,
  })
}
