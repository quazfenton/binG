/**
 * MCP Server Service
 * 
 * Provides filesystem, memory, and other tools via MCP protocol.
 * Integrates with existing MCP infrastructure.
 * 
 * Features:
 * - Filesystem tools (read, write, edit, delete)
 * - Memory tools (entities, relations, observations)
 * - Tool routing to Nullclaw, Blaxel, Arcade
 * - HTTP + SSE transport
 */

import { createServer } from 'http';

// Dynamic import of MCP tools — avoids @/ path alias issues in shared package
// The web layer re-exports these, so we import from the web module at runtime
let getMCPToolsForAI_SDK: ((userId: string) => Promise<any[]>) | undefined;
let callMCPToolFromAI_SDK: ((name: string, args: Record<string, any>, userId: string) => Promise<any>) | undefined;

async function ensureMCPFunctions() {
  if (!getMCPToolsForAI_SDK || !callMCPToolFromAI_SDK) {
    try {
      const mcp = await import('../../../../web/lib/mcp/architecture-integration');
      getMCPToolsForAI_SDK = mcp.getMCPToolsForAI_SDK;
      callMCPToolFromAI_SDK = mcp.callMCPToolFromAI_SDK;
    } catch (err) {
      // Fallback: try absolute path from web build
      console.warn('[MCPServer] Could not import MCP functions via relative path, trying dynamic import');
    }
  }
}

const PORT = parseInt(process.env.MCP_PORT || '8888', 10);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const VFS_ROOT = process.env.VFS_ROOT || '/workspace/vfs';

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: any) {
  const prefix = `[MCPServer]`;
  const tag = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
  console.log(`${prefix} ${tag}: ${msg}`, meta ?? '');
}

// Configuration from environment
const PORT = parseInt(process.env.MCP_PORT || '8888', 10);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const VFS_ROOT = process.env.VFS_ROOT || '/workspace/vfs';

class MCPServerService {
  private tools: any[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    log('info', 'Initializing MCP server...', {
      port: PORT,
      workspaceRoot: WORKSPACE_ROOT,
      vfsRoot: VFS_ROOT,
    });

    // Load MCP tools
    try {
      await ensureMCPFunctions();
      if (getMCPToolsForAI_SDK) {
        this.tools = await getMCPToolsForAI_SDK('mcp-server');
        log('info', `Loaded ${this.tools.length} MCP tools`);
      } else {
        log('warn', 'MCP tools not available — imports failed');
      }
    } catch (error: any) {
      log('warn', `Failed to load MCP tools: ${error.message}`);
    }

    this.initialized = true;
  }

  /**
   * List available tools
   */
  listTools(): any[] {
    return this.tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }

  /**
   * Execute a tool
   */
  async executeTool(name: string, args: Record<string, any>, userId: string): Promise<any> {
    try {
      const result = await callMCPToolFromAI_SDK(name, args, userId);
      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
    } catch (error: any) {
      log('error', `Tool execution failed: ${name}`, error.message);
      return {
        success: false,
        output: '',
        error: error.message,
      };
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    initialized: boolean;
    toolCount: number;
    workspaceRoot: string;
    vfsRoot: string;
  } {
    return {
      initialized: this.initialized,
      toolCount: this.tools.length,
      workspaceRoot: WORKSPACE_ROOT,
      vfsRoot: VFS_ROOT,
    };
  }
}

// Singleton instance
const mcpServerService = new MCPServerService();

// HTTP server
const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      ...mcpServerService.getStatus(),
    }));
    return;
  }

  // List tools
  if (req.url === '/tools' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tools: mcpServerService.listTools(),
    }));
    return;
  }

  // Execute tool
  if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { name, args, userId } = JSON.parse(body);
        
        if (!name || !userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name and userId are required' }));
          return;
        }

        const result = await mcpServerService.executeTool(name, args, userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // SSE endpoint for tool events
  if (req.url === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });

    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Initialize and start server
async function main() {
  try {
    await mcpServerService.initialize();

    server.listen(PORT, () => {
      logger.info(`MCP server listening on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      server.close();
      process.exit(0);
    });
  } catch (error: any) {
    log('error', `Failed to start MCP server: ${error.message}`);
    process.exit(1);
  }
}

main();

export { mcpServerService };
