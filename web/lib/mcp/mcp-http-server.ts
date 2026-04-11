/**
 * MCP HTTP Server for CLI Agent (Architecture 2)
 *
 * Provides HTTP endpoint for OpenCode CLI agent to call MCP tools
 * This allows the CLI agent to discover and use MCP tools without
 * needing to manage MCP connections directly
 *
 * SECURITY: This server requires authentication and binds to localhost only
 *
 * ENDPOINTS:
 * - GET  /health        - Health status
 * - GET  /tools         - List all registered tools
 * - POST /call          - Execute a tool
 * - GET  /discover      - Full MCP configuration
 * - POST /memory/add    - Mem0: Store memories
 * - POST /memory/search - Mem0: Search memories
 * - GET  /memory/all    - Mem0: Get all memories
 * - PATCH /memory/:id   - Mem0: Update memory
 * - DELETE /memory/:id  - Mem0: Delete memory
 * - DELETE /memory/all  - Mem0: Delete all memories
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
import { mcpToolRegistry } from './registry'
import {
  isMem0Configured,
  mem0Add,
  mem0Search,
  mem0GetAll,
  mem0Update,
  mem0Delete,
  mem0DeleteAll,
} from '../powers/mem0-power'
import { createLogger } from '../utils/logger'

const logger = createLogger('MCP:CLI-Server')

let httpServer: Server | null = null

// SECURITY: Authentication token for MCP HTTP server
// Required for all endpoints to prevent unauthorized tool execution
const MCP_HTTP_AUTH_TOKEN = process.env.MCP_HTTP_AUTH_TOKEN;

/**
 * Validate authentication token from request
 */
function validateAuthToken(req: IncomingMessage): boolean {
  if (!MCP_HTTP_AUTH_TOKEN) {
    // If no token configured, allow localhost only (dev mode)
    const host = req.headers.host || '';
    return host.startsWith('localhost') || host.startsWith('127.0.0.1');
  }

  const authHeader = req.headers.authorization || '';
  return authHeader === `Bearer ${MCP_HTTP_AUTH_TOKEN}`;
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Parse request body
 */
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) }
      catch (e) { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

// ============================================================================
// Memory (Mem0) Endpoints
// ============================================================================

async function handleMemoryAdd(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const body = await parseBody(req)
    if (!body.messages || !Array.isArray(body.messages)) {
      return sendJson(res, 400, { error: 'messages[] array is required' })
    }
    const result = await mem0Add(body, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemorySearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const body = await parseBody(req)
    if (!body.query) {
      return sendJson(res, 400, { error: 'query is required' })
    }
    const result = await mem0Search(body, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemoryGetAll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const params = new URL(req.url || '', 'http://localhost').searchParams
    const result = await mem0GetAll({
      userId: params.get('userId') || undefined,
      agentId: params.get('agentId') || undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!) : undefined,
    }, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemoryUpdate(req: IncomingMessage, res: ServerResponse, memoryId: string): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const body = await parseBody(req)
    if (!body.text) {
      return sendJson(res, 400, { error: 'text is required' })
    }
    const result = await mem0Update({ memoryId, text: body.text }, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemoryDelete(req: IncomingMessage, res: ServerResponse, memoryId: string): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const result = await mem0Delete({ memoryId }, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemoryDeleteAll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isMem0Configured()) {
    return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
  }
  try {
    const body = await parseBody(req)
    const result = await mem0DeleteAll(body || {}, {})
    sendJson(res, result.success ? 200 : 500, result)
  } catch (e: any) {
    sendJson(res, 500, { error: e.message })
  }
}

async function handleMemoryStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    configured: isMem0Configured(),
    apiKeySet: !!process.env.MEM0_API_KEY,
    baseUrl: 'https://api.mem0.ai',
  })
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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
        const pathParts = url.pathname.split('/').filter(Boolean)

        try {
          // Memory endpoints: /memory/*
          if (pathParts[0] === 'memory') {
            if (!isMem0Configured()) {
              return sendJson(res, 503, { error: 'Mem0 not configured (set MEM0_API_KEY)' })
            }

            const action = pathParts[1]
            switch (req.method) {
              case 'POST':
                if (action === 'add') return handleMemoryAdd(req, res)
                if (action === 'search') return handleMemorySearch(req, res)
                if (action === 'delete-all' || action === 'deleteAll' || action === 'all') return handleMemoryDeleteAll(req, res)
                break
              case 'GET':
                if (!action || action === 'all') return handleMemoryGetAll(req, res)
                if (action === 'status') return handleMemoryStatus(req, res)
                break
              case 'PATCH':
                if (action) return handleMemoryUpdate(req, res, action)
                break
              case 'DELETE':
                if (action) return handleMemoryDelete(req, res, action)
                break
            }
            return sendJson(res, 404, { error: 'Unknown memory endpoint' })
          }

          // Standard MCP endpoints
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
              sendJson(res, 404, { error: 'Not found' })
          }
        } catch (error: any) {
          logger.error('Request handling error', error)
          sendJson(res, 500, { error: error.message })
        }
      })

      // SECURITY: Bind to localhost only (not all interfaces)
      server.listen(port, '127.0.0.1', () => {
        logger.info(`MCP CLI server listening on 127.0.0.1:${port}`)
        const memoryStatus = isMem0Configured() ? 'enabled' : 'disabled (set MEM0_API_KEY)'
        logger.info(`Mem0 memory endpoints: ${memoryStatus}`)
        logger.warn('MCP HTTP server requires authentication. Set MCP_HTTP_AUTH_TOKEN environment variable.')
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
