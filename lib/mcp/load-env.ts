/**
 * MCP Environment Loader
 * 
 * Loads .env.mcp file for MCP configuration
 * Call this early in your application startup
 * 
 * Usage:
 *   import { loadMCPEnv } from '@/lib/mcp/load-env'
 *   loadMCPEnv()
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { existsSync } from 'fs'

/**
 * Load .env.mcp file if it exists and MCP is enabled
 * Call this BEFORE any MCP initialization
 */
export function loadMCPEnv(): boolean {
  // Check if MCP is enabled in main .env
  if (process.env.MCP_ENABLED !== 'true') {
    return false
  }

  const mcpEnvPath = resolve(process.cwd(), '.env.mcp')
  
  if (!existsSync(mcpEnvPath)) {
    console.log('[MCP] .env.mcp not found, using main .env for MCP config')
    return false
  }

  try {
    // Load .env.mcp
    const result = config({ path: mcpEnvPath })
    
    if (result.parsed) {
      const count = Object.keys(result.parsed).length
      console.log(`[MCP] Loaded .env.mcp with ${count} variables`)
      return true
    }
    
    return false
  } catch (error: any) {
    console.error('[MCP] Failed to load .env.mcp:', error.message)
    return false
  }
}

/**
 * Auto-load MCP env when module is imported
 * This ensures .env.mcp is loaded before any MCP code runs
 */
loadMCPEnv()
