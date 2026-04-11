import { NextResponse } from 'next/server'
import { getMCPToolCount } from '@/lib/mcp/config'
import { isDesktopMode } from '@bing/platform/env'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('MCP-Status')

export async function GET() {
  try {
    let toolCount = 0
    let serverCount = 0
    let initialized = false

    try {
      toolCount = await getMCPToolCount()
      serverCount = (await import('@/lib/mcp/registry')).mcpToolRegistry.getAllServerStatuses().length
      initialized = toolCount > 0
    } catch {
      // MCP not initialized yet
    }

    return NextResponse.json({
      initialized,
      toolCount,
      serverCount,
      isDesktop: isDesktopMode(),
    })
  } catch (error: any) {
    logger.error('Failed to get MCP status:', error.message)
    return NextResponse.json({
      initialized: false,
      toolCount: 0,
      serverCount: 0,
      isDesktop: isDesktopMode(),
      error: error.message,
    }, { status: 500 })
  }
}
