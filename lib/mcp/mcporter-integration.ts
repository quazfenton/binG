import { createRuntime, type Runtime, type ServerDefinition } from 'mcporter'
import { parseMCPServerConfigs } from './config'
import { createLogger } from '../utils/logger'

const logger = createLogger('MCP:Mcporter')

interface MCPorterToolEntry {
  qualifiedName: string
  serverId: string
  toolName: string
  description?: string
  parameters: Record<string, any>
}

class MCPorterIntegration {
  private runtime: Runtime | null = null
  private runtimeInitPromise: Promise<Runtime> | null = null
  private toolCache: MCPorterToolEntry[] = []
  private lastRefreshAt = 0
  private readonly refreshIntervalMs = Number(process.env.MCPORTER_REFRESH_MS || 30000)

  isEnabled(): boolean {
    return process.env.MCPORTER_ENABLED !== 'false'
  }

  private toServerDefinitions(): ServerDefinition[] {
    const configs = parseMCPServerConfigs()

    return configs
      .filter((config) => config.enabled !== false)
      .flatMap((config) => {
        const transport = config.transport

        if (transport.type === 'stdio' && transport.command) {
          return [
            {
              name: config.id,
              description: config.name,
              command: {
                kind: 'stdio' as const,
                command: transport.command,
                args: transport.args || [],
                cwd: transport.cwd || process.cwd(),
              },
              // @ts-ignore - env is optional for http transport
              env: transport.env,
            } as any,
          ]
        }

        const remoteUrl = transport.type === 'sse' ? transport.url : transport.wsUrl
        if ((transport.type === 'sse' || transport.type === 'websocket') && remoteUrl) {
          try {
            const normalizedUrl =
              transport.type === 'websocket'
                ? remoteUrl.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:')
                : remoteUrl

            return [
              {
                name: config.id,
                description: config.name,
                command: {
                  kind: 'http' as const,
                  url: new URL(normalizedUrl),
                  headers: {},
                },
                env: {},
              } as any,
            ]
          } catch (error) {
            logger.warn(`Skipping invalid mcporter URL for server ${config.id}`)
            return []
          }
        }

        return []
      })
  }

  private async getRuntime(): Promise<Runtime> {
    if (this.runtime) {
      return this.runtime
    }

    if (this.runtimeInitPromise) {
      return this.runtimeInitPromise
    }

    this.runtimeInitPromise = createRuntime({
      servers: this.toServerDefinitions(),
      rootDir: process.cwd(),
    })

    try {
      this.runtime = await this.runtimeInitPromise
      return this.runtime
    } finally {
      this.runtimeInitPromise = null
    }
  }

  async listTools(forceRefresh: boolean = false): Promise<MCPorterToolEntry[]> {
    if (!this.isEnabled()) {
      return []
    }

    const now = Date.now()
    if (!forceRefresh && this.toolCache.length > 0 && now - this.lastRefreshAt < this.refreshIntervalMs) {
      return this.toolCache
    }

    try {
      const runtime = await this.getRuntime()
      const servers = runtime.listServers()
      const entries: MCPorterToolEntry[] = []

      for (const server of servers) {
        try {
          const tools = await runtime.listTools(server, {
            includeSchema: true,
            autoAuthorize: false,
            allowCachedAuth: true,
          })

          for (const tool of tools) {
            entries.push({
              qualifiedName: `${server}:${tool.name}`,
              serverId: server,
              toolName: tool.name,
              description: tool.description,
              parameters:
                (tool.inputSchema as Record<string, any>) ||
                { type: 'object', properties: {}, required: [] },
            })
          }
        } catch (error: any) {
          logger.warn(`mcporter list failed for server ${server}: ${error?.message || 'unknown error'}`)
        }
      }

      this.toolCache = entries
      this.lastRefreshAt = Date.now()
      return entries
    } catch (error: any) {
      logger.warn(`mcporter list failed: ${error?.message || 'unknown error'}`)
      return this.toolCache
    }
  }

  async findTool(qualifiedName: string): Promise<MCPorterToolEntry | undefined> {
    const tools = await this.listTools()
    return tools.find((tool) => tool.qualifiedName === qualifiedName)
  }

  private normalizeCallOutput(raw: unknown): string {
    if (typeof raw === 'string') {
      return raw
    }

    if (raw && typeof raw === 'object') {
      const payload = raw as any
      if (Array.isArray(payload.content)) {
        const combined = payload.content
          .map((item: any) => {
            if (item?.type === 'text' && typeof item.text === 'string') return item.text
            if (item?.type === 'image' && item.mimeType) return `[Image: ${item.mimeType}]`
            if (item?.type === 'resource' && item.resource?.uri) return `[Resource: ${item.resource.uri}]`
            return JSON.stringify(item)
          })
          .join('\n')

        if (combined) {
          return combined
        }
      }
    }

    try {
      return JSON.stringify(raw, null, 2)
    } catch {
      return String(raw)
    }
  }

  async callTool(
    qualifiedName: string,
    args: Record<string, any>,
    timeoutMs?: number,
  ): Promise<{ success: boolean; output: string; isError?: boolean; serverId: string }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        output: 'mcporter integration is disabled',
        isError: true,
        serverId: '',
      }
    }

    const colonIndex = qualifiedName.indexOf(':')
    if (colonIndex === -1) {
      return {
        success: false,
        output: `Invalid MCP tool name: ${qualifiedName}`,
        isError: true,
        serverId: '',
      }
    }

    const serverId = qualifiedName.slice(0, colonIndex)
    const toolName = qualifiedName.slice(colonIndex + 1)

    try {
      const runtime = await this.getRuntime()
      const result = await runtime.callTool(serverId, toolName, {
        args,
        timeoutMs,
      })

      const output = this.normalizeCallOutput(result)
      const isError = !!(result as any)?.isError

      return {
        success: !isError,
        output,
        isError,
        serverId,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'mcporter tool call failed',
        isError: true,
        serverId,
      }
    }
  }
}

export const mcporterIntegration = new MCPorterIntegration()

export async function getMCPorterToolDefinitions(): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, any>
  }
}>> {
  const tools = await mcporterIntegration.listTools()
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.qualifiedName,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

export async function callMCPorterTool(
  toolName: string,
  args: Record<string, any>,
): Promise<{ success: boolean; output: string; error?: string }> {
  const result = await mcporterIntegration.callTool(toolName, args)
  return {
    success: result.success,
    output: result.output,
    error: result.isError ? result.output : undefined,
  }
}
