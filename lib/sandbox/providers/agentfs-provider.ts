/**
 * AgentFS Sandbox Provider
 *
 * SQLite-backed (Turso/libSQL) persistent storage provider for AI agents.
 * NOT a container runtime — provides:
 * - Persistent key-value storage across sessions
 * - Cloud filesystem (VFS on Turso)
 * - Tool call tracking and auditing
 * - Data offloading between sandbox sessions
 *
 * Best used alongside container providers (daytona, e2b, etc.)
 * for persistent state that survives sandbox destroy/recreate cycles.
 *
 * @see https://docs.turso.tech/agentfs
 * @see https://www.npmjs.com/package/agentfs-sdk
 */

import type { SandboxProvider, SandboxHandle, SandboxCreateConfig } from './sandbox-provider'
import type { ToolResult } from '../types'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('AgentFS')

// Lazy-loaded AgentFS module
let AgentFSModule: any = null

async function getAgentFS() {
  if (!AgentFSModule) {
    AgentFSModule = await import('agentfs-sdk')
  }
  return AgentFSModule.AgentFS
}

export interface AgentFSConfig {
  /** Database ID for persistent storage (omitted = ephemeral) */
  id?: string
  /** Turso database URL (cloud) */
  databaseUrl?: string
  /** Turso auth token */
  authToken?: string
}

/**
 * AgentFS Sandbox Handle
 *
 * Wraps an AgentFS instance to provide KV, filesystem, and tool tracking.
 * Does NOT execute shell commands — use alongside a container provider.
 */
export class AgentFSSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir: string
  private agent: any
  private createdAt: number

  constructor(agent: any, id: string) {
    this.agent = agent
    this.id = id
    this.workspaceDir = '/agentfs'
    this.createdAt = Date.now()
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    // AgentFS does not execute commands — record the invocation for tracking
    const start = Date.now()
    try {
      const toolId = await this.agent.tools.record(
        'shell_command',
        Math.floor(start / 1000),
        Math.floor(Date.now() / 1000),
        { command, cwd },
        undefined,
        'AgentFS does not execute shell commands — use a container provider'
      )

      return {
        success: false,
        error: 'AgentFS does not execute shell commands. Use alongside a container provider (daytona, e2b, etc.) for command execution.',
        output: `Tool call tracked as #${toolId}`,
        executionTime: Date.now() - start,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - start,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const start = Date.now()
    try {
      await this.agent.fs.writeFile(filePath, content)
      return {
        success: true,
        output: `Written ${content.length} bytes to ${filePath}`,
        executionTime: Date.now() - start,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - start,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const start = Date.now()
    try {
      const content = await this.agent.fs.readFile(filePath, 'utf-8')
      return {
        success: true,
        output: content,
        content,
        executionTime: Date.now() - start,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - start,
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const start = Date.now()
    try {
      const entries = await this.agent.fs.readdir(dirPath)
      const details: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = []

      for (const entry of entries) {
        try {
          const stats = await this.agent.fs.stat(`${dirPath}/${entry}`)
          details.push({
            name: entry,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.isFile() ? stats.size : undefined,
          })
        } catch {
          details.push({ name: entry, type: 'file' })
        }
      }

      return {
        success: true,
        output: JSON.stringify(details, null, 2),
        executionTime: Date.now() - start,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - start,
      }
    }
  }

  async getStatus(): Promise<{ status: string; uptime?: number }> {
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - this.createdAt) / 1000),
    }
  }

  // ---- AgentFS-specific extensions ----

  /** Key-value store access */
  get kv() {
    return this.agent.kv
  }

  /** Direct AgentFS instance access */
  get fs() {
    return this.agent.fs
  }

  /** Tool call tracking access */
  get tools() {
    return this.agent.tools
  }

  /** Direct database access */
  get db() {
    return this.agent.db
  }

  /** Snapshot the filesystem as a map of path → content */
  async snapshotFilesystem(): Promise<Map<string, string>> {
    const snapshot = new Map<string, string>()
    const entries = await this.agent.fs.readdir('/')
    await this._snapshotDir('/', entries, snapshot)
    return snapshot
  }

  private async _snapshotDir(dir: string, entries: string[], snapshot: Map<string, string>): Promise<void> {
    for (const entry of entries) {
      const fullPath = `${dir === '/' ? '' : dir}/${entry}`
      try {
        const stats = await this.agent.fs.stat(fullPath)
        if (stats.isDirectory()) {
          const subEntries = await this.agent.fs.readdir(fullPath)
          await this._snapshotDir(fullPath, subEntries, snapshot)
        } else {
          const content = await this.agent.fs.readFile(fullPath, 'utf-8')
          snapshot.set(fullPath, content)
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }
}

/**
 * AgentFS Sandbox Provider
 *
 * Provides persistent cloud storage (Turso/libSQL) for AI agents.
 * Use alongside container providers for data that needs to survive
 * sandbox destroy/recreate cycles.
 */
export class AgentFSProvider implements SandboxProvider {
  readonly name = 'agentfs'

  private instances: Map<string, AgentFSSandboxHandle> = new Map()

  isAvailable(): boolean {
    // AgentFS works with local SQLite (no config needed) or Turso cloud (optional)
    return true
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const start = Date.now()
    try {
      const AgentFS = await getAgentFS()
      const test = await AgentFS.open()
      await test.kv.set('__health__', Date.now())
      await test.kv.delete('__health__')
      return {
        healthy: true,
        latency: Date.now() - start,
        details: { backend: 'local-sqlite' },
      }
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - start,
        details: { error: error.message },
      }
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const AgentFS = await getAgentFS()

    const sandboxId = config.labels?.['agentfs-id']
      || config.labels?.['conversationId']
      || `agentfs-${Date.now()}`

    const agentConfig: any = { id: sandboxId }

    // Use Turso cloud if credentials are provided
    const tursoUrl = process.env.AGENTFS_DATABASE_URL
    const tursoToken = process.env.AGENTFS_AUTH_TOKEN
    if (tursoUrl && tursoToken) {
      agentConfig.databaseUrl = tursoUrl
      agentConfig.authToken = tursoToken
      logger.info('Using Turso cloud backend', { sandboxId })
    }

    const agent = await AgentFS.open(agentConfig)
    const handle = new AgentFSSandboxHandle(agent, sandboxId)

    // Store env vars in KV if provided
    if (config.envVars) {
      for (const [key, value] of Object.entries(config.envVars)) {
        await agent.kv.set(`env:${key}`, value)
      }
    }

    this.instances.set(sandboxId, handle)
    logger.info('AgentFS sandbox created', { sandboxId, cloud: !!tursoUrl })

    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = this.instances.get(sandboxId)
    if (existing) return existing

    // Re-open existing database
    const AgentFS = await getAgentFS()
    const agentConfig: any = { id: sandboxId }

    const tursoUrl = process.env.AGENTFS_DATABASE_URL
    const tursoToken = process.env.AGENTFS_AUTH_TOKEN
    if (tursoUrl && tursoToken) {
      agentConfig.databaseUrl = tursoUrl
      agentConfig.authToken = tursoToken
    }

    const agent = await AgentFS.open(agentConfig)
    const handle = new AgentFSSandboxHandle(agent, sandboxId)
    this.instances.set(sandboxId, handle)
    return handle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    this.instances.delete(sandboxId)
    logger.info('AgentFS sandbox destroyed (in-memory handle removed)', { sandboxId })
  }
}

export const agentFSProvider = new AgentFSProvider()
