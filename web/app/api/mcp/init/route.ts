import { NextResponse } from 'next/server'


import { initializeMCPForArchitecture1 } from '@/lib/mcp/architecture-integration'
import { isDesktopMode } from '@bing/platform/env'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('MCP-Init')

/**
 * POST /api/mcp/init
 *
 * Called on app startup (providers.tsx) to initialize MCP servers.
 *
 * Desktop mode: initializes stdio (npx) servers from mcp.config.json
 * Web mode: skips stdio servers, only connects remote HTTP servers
 */
export async function POST() {
  try {
    const isDesktop = isDesktopMode()

    if (isDesktop) {
      logger.info('Desktop mode detected — stdio MCP servers will be initialized')
    } else {
      logger.info('Web mode detected — stdio MCP servers skipped (use remote HTTP servers)')
    }

    // This single function handles BOTH stdio (desktop-only) and HTTP (both modes)
    await initializeMCPForArchitecture1()

    return NextResponse.json({ ok: true, mode: isDesktop ? 'desktop' : 'web' })
  } catch (error: any) {
    logger.error('Failed to initialize MCP services', { error: error.message })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
