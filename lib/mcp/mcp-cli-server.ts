/**
 * MCP HTTP Server for CLI Agent (Architecture 2)
 *
 * Provides HTTP endpoint for OpenCode CLI agent to call MCP tools
 * This allows the CLI agent to discover and use MCP tools without
 * needing to manage MCP connections directly
 *
 * SECURITY: This server requires authentication and binds to localhost only
 */

import { createServer, Server } from 'http'
import { mcpToolRegistry } from './registry'
import { createLogger } from '../utils/logger'

const logger = createLogger('MCP:CLI-Server')

let httpServer: Server | null = null

// SECURITY: Authentication token for MCP CLI server
// Required for all endpoints to prevent unauthorized tool execution
const MCP_CLI_AUTH_TOKEN = process.env.MCP_CLI_AUTH_TOKEN;

/**
 * Validate authentication token from request
 */
function validateAuthToken(req: any): boolean {
  if (!MCP_CLI_AUTH_TOKEN) {
    // If no token configured, allow localhost only (dev mode)
    const host = req.headers.host || '';
    return host.startsWith('localhost') || host.startsWith('127.0.0.1');
  }
  
  const authHeader = req.headers.authorization || '';
  return authHeader === `Bearer ${MCP_CLI_AUTH_TOKEN}`;
}

/**
 * Create HTTP server for CLI agent to call MCP tools
 * 
 * SECURITY CHANGES:
 * - Binds to 127.0.0.1 only (not all interfaces)
 * - Requires Bearer token authentication
 * - Restricted CORS to localhost only
 */
export async function createMCPServerForCLI(port: number = 8888): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const server = createServer(async (req, res) => {
        // SECURITY: Restricted CORS - localhost only
        const host = req.headers.host || '';
        if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
          res.setHeader('Access-Control-Allow-Origin', `http://localhost:${port}`)
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        // SECURITY: Require authentication for all endpoints
        if (!validateAuthToken(req)) {
          logger.warn('Unauthorized MCP CLI request', { 
            method: req.method, 
            path: req.url,
            host: req.headers.host 
          });
          res.writeHead(401)
          res.end(JSON.stringify({ error: 'Unauthorized - valid Bearer token required' }))
          return
        }

        // Route handling
        const url = new URL(req.url || '', `http://127.0.0.1:${port}`)

        try {
          switch (url.pathname) {
            case '/health':
              handleHealth(res)
              break

            case '/tools':
              await handleListTools(res)
              break

            case '/call':
              await handleCallTool(req, res)
              break

            case '/discover':
              await handleDiscover(res)
              break

            default:
              res.writeHead(404)
              res.end(JSON.stringify({ error: 'Not found' }))
          }
        } catch (error: any) {
          logger.error('Request handling error', error)
          res.writeHead(500)
          res.end(JSON.stringify({ error: error.message }))
        }
      })

      // SECURITY: Bind to localhost only (not all interfaces)
      server.listen(port, '127.0.0.1', () => {
        logger.info(`MCP CLI server listening on 127.0.0.1:${port}`)
        logger.warn('MCP CLI server requires authentication. Set MCP_CLI_AUTH_TOKEN environment variable.')
        httpServer = server
        resolve()
      })

      server.on('error', (error) => {
        logger.error('MCP CLI server error', error)
        reject(error)
      })
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Health check endpoint
 */
function handleHealth(res: any): void {
  const tools = mcpToolRegistry.getAllTools()
  const servers = mcpToolRegistry.getAllServerStatuses()

  res.writeHead(200)
  res.end(JSON.stringify({
    status: 'healthy',
    tools: tools.length,
    servers: servers.length,
    connected: servers.filter(s => s.info.state === 'connected').length,
    timestamp: new Date().toISOString(),
  }))
}

/**
 * List available tools
 */
async function handleListTools(res: any): Promise<void> {
  const tools = mcpToolRegistry.getAllTools()
  
  res.writeHead(200)
  res.end(JSON.stringify({
    tools: tools.map(wrapper => ({
      name: wrapper.tool.name,
      description: wrapper.tool.description,
      inputSchema: wrapper.tool.inputSchema,
      serverId: wrapper.serverId,
    })),
  }))
}

/**
 * Call a tool
 */
async function handleCallTool(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body = ''
  req.on('data', chunk => {
    body += chunk.toString()
  })

  req.on('end', async () => {
    try {
      const { toolName, args } = JSON.parse(body)

      if (!toolName) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'toolName is required' }))
        return
      }

      logger.info(`CLI calling tool: ${toolName}`, { args })

      const result = await mcpToolRegistry.callTool(toolName, args || {})

      res.writeHead(result.success ? 200 : 400)
      res.end(JSON.stringify({
        success: result.success,
        content: result.content,
        duration: result.duration,
      }))
    } catch (error: any) {
      logger.error('Tool call error', error)
      res.writeHead(500)
      res.end(JSON.stringify({ error: error.message }))
    }
  })
}

/**
 * Discover endpoint - provides full MCP configuration for CLI
 */
async function handleDiscover(res: any): Promise<void> {
  const tools = mcpToolRegistry.getAllTools()
  const servers = mcpToolRegistry.getAllServerStatuses()

  res.writeHead(200)
  res.end(JSON.stringify({
    version: '1.0.0',
    protocol: 'mcp-http',
    tools: tools.map(wrapper => ({
      name: wrapper.tool.name,
      description: wrapper.tool.description,
      inputSchema: wrapper.tool.inputSchema,
    })),
    servers: servers.map(s => ({
      id: s.id,
      name: s.name,
      connected: s.info.state === 'connected',
    })),
    endpoints: {
      health: '/health',
      tools: '/tools',
      call: '/call',
      discover: '/discover',
    },
  }))
}

/**
 * Shutdown the HTTP server
 */
export async function shutdownMCPServer(): Promise<void> {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => {
        logger.info('MCP CLI server shut down')
        resolve()
      })
    } else {
      resolve()
    }
  })
}
