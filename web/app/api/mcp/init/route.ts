import { NextResponse } from 'next/server'
import { initializeMCPForArchitecture1 } from '@/lib/mcp/architecture-integration'
import { initializeDesktopMCP, desktopMCPPresets } from '@/lib/mcp/desktop-mcp-manager'
import { isDesktopMode } from '@bing/platform/env'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('MCP-Init')

export async function POST() {
  try {
    if (isDesktopMode()) {
      logger.info('Desktop mode detected, initializing local MCP servers...')
      const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
      const desktopConfigs = [
        desktopMCPPresets.filesystem(homeDir),
        desktopMCPPresets.memory(),
      ].filter(config => config.enabled)

      await initializeDesktopMCP(desktopConfigs)
      logger.info('Desktop MCP servers initialized', { count: desktopConfigs.length })
    } else {
      logger.info('Web mode detected, initializing remote MCP servers...')
    }

    await initializeMCPForArchitecture1()
    logger.info('MCP services initialized successfully')

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    logger.error('Failed to initialize MCP services', { error: error.message })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
