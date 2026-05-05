import { NextResponse } from 'next/server'


import { isDesktopMode } from '@bing/platform/env'
import { createLogger } from '@/lib/utils/logger'
import {
  initializeMCPForArchitecture1,
} from '@/lib/mcp/architecture-integration'
import {
  desktopMCPPresets,
  isTauriBridgeConnected,
  getTauriMCPToolCount,
} from '@/lib/mcp/desktop-mcp-manager'
import {
  createHTTPTransport,
  isValidMCPURL,
  parseMCPURL,
  registerHTTPTransport,
} from '@/lib/mcp/http-transport'
import { mcpToolRegistry } from '@/lib/mcp/registry'
import type { MCPServerConfig } from '@/lib/mcp/types'

const logger = createLogger('MCP-Connect')

interface ConnectRequest {
  serverId: string
  serverName: string
  npxArgs?: string[]
  remoteUrl?: string
  envVars?: Record<string, string>
  /** Connect Tauri MCP desktop automation server */
  mode?: 'stdio' | 'remote' | 'tauri-desktop'
  tauriBridgeUrl?: string
}

export async function POST(req: Request) {
  try {
    const body: ConnectRequest = await req.json()
    const { serverId, serverName, npxArgs, remoteUrl, envVars = {}, mode, tauriBridgeUrl } = body

    if (!serverId || !serverName) {
      return NextResponse.json(
        { error: 'serverId and serverName are required' },
        { status: 400 }
      )
    }

    const isDesktop = isDesktopMode()

    // === PATH 0: Tauri MCP desktop automation ===
    if (mode === 'tauri-desktop' && isDesktop) {
      logger.info('Connecting Tauri MCP desktop automation server')

      const tauriServer = desktopMCPPresets.tauriMCPServer();
      const config = { ...tauriServer, id: serverId || tauriServer.id, name: serverName || tauriServer.name };

      // Use mcpToolRegistry exclusively
      mcpToolRegistry.registerServer(config);
      await (mcpToolRegistry as any).connectServer(config.id);

      // Check bridge connectivity
      const bridgeConnected = await isTauriBridgeConnected(tauriBridgeUrl);
      const toolCount = getTauriMCPToolCount();

      return NextResponse.json({
        ok: true,
        mode: 'tauri-desktop',
        bridgeConnected,
        toolCount,
        tools: ['ping', 'screenshot', 'get_dom', 'execute_js', 'mouse_click', 'mouse_move', 'mouse_scroll', 'mouse_drag', 'keyboard_input', 'window_list', 'window_focus', 'window_resize', 'window_position', 'local_storage_get', 'local_storage_set', 'local_storage_clear', 'ipc_list_handlers', 'ipc_invoke'],
      });
    }

    // === PATH 1: Desktop stdio server (npx spawn) ===
    if (isDesktop && npxArgs) {
      logger.info(`Connecting to local MCP server: ${serverName}`, { serverId })

      // Use mcpToolRegistry exclusively — do NOT also call initializeDesktopMCP
      // to avoid double-spawning the same process.
      const config: MCPServerConfig = {
        id: serverId,
        name: serverName,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: npxArgs,
          env: envVars,
        },
        enabled: true,
      }

      mcpToolRegistry.registerServer(config)
      await (mcpToolRegistry as any).connectServer(serverId)

      return NextResponse.json({ ok: true, mode: 'desktop-stdio' })
    }

    // === PATH 2: Remote HTTP server ===
    if (remoteUrl) {
      const parsedUrl = parseMCPURL(remoteUrl)
      if (!isValidMCPURL(parsedUrl)) {
        return NextResponse.json(
          { error: 'Invalid remote URL' },
          { status: 400 }
        )
      }

      logger.info(`Connecting to remote MCP server: ${serverName} at ${parsedUrl}`)

      const transport = createHTTPTransport({
        url: parsedUrl,
        apiKey: envVars.API_KEY,
        transportType: 'streamable-http',
      })

      try {
        const tools = await transport.listTools()
        registerHTTPTransport(serverId, transport)

        return NextResponse.json({
          ok: true,
          mode: 'remote-http',
          toolCount: tools.length,
        })
      } catch (error: any) {
        logger.warn(`Remote MCP server connection test failed: ${serverName}`, error.message)
        return NextResponse.json(
          {
            error: `Connection test failed: ${error.message}. Check your API key and URL.`,
          },
          { status: 400 }
        )
      }
    }

    // === PATH 3: Web mode without remoteUrl — cannot connect stdio servers ===
    if (!isDesktop) {
      return NextResponse.json(
        {
          error: 'Cannot connect stdio MCP servers in web mode. Provide a remoteUrl for HTTP transport.',
          hint: 'In web mode, only remote HTTP MCP servers are supported. Local npx servers require desktop mode.',
        },
        { status: 400 }
      )
    }

    // === PATH 4: Desktop mode without npxArgs — trigger full architecture init ===
    for (const [key, val] of Object.entries(envVars)) {
      if (val) process.env[key] = val
    }

    await initializeMCPForArchitecture1()

    return NextResponse.json({ ok: true, mode: 'architecture-init' })
  } catch (error: any) {
    logger.error(`Failed to connect MCP server:`, error.message)
    return NextResponse.json(
      { error: 'Failed to connect MCP server' },
      { status: 500 }
    )
  }
}
