/**
 * Desktop MCP Server Manager
 *
 * In desktop mode, MCP servers are spawned as local processes via child_process
 * instead of cloud connections. This provides full MCP functionality on the
 * user's local machine.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { isDesktopMode } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';
import type { MCPServerConfig, MCPTransportConfig } from '@/lib/mcp/types';

const log = createLogger('DesktopMCP');

export interface DesktopMCPServer {
  id: string;
  name: string;
  config: MCPServerConfig;
  process?: ChildProcess;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
  startedAt?: Date;
}

/**
 * Desktop MCP Manager - manages local MCP server processes
 */
export class DesktopMCPManager extends EventEmitter {
  private servers: Map<string, DesktopMCPServer> = new Map();
  private logDir: string;

  constructor() {
    super();
    this.logDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.opencode', 'logs', 'mcp');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Check if running in desktop mode
   */
  isDesktop(): boolean {
    return isDesktopMode();
  }

  /**
   * Register an MCP server configuration
   */
  registerServer(config: MCPServerConfig): void {
    const server: DesktopMCPServer = {
      id: config.id,
      name: config.name || config.id,
      config,
      status: 'stopped',
    };

    this.servers.set(config.id, server);
    log.info('Registered MCP server', { id: config.id, name: config.name });
  }

  /**
   * Start an MCP server process
   */
  async startServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    // FIX: Add guard for 'starting' status to prevent concurrent calls spawning duplicate processes
    if (server.status === 'starting') {
      log.warn('Server is already starting, waiting for it to complete', { serverId });
      return;
    }

    if (server.status === 'running') {
      log.warn('Server already running', { serverId });
      return;
    }

    server.status = 'starting';
    this.emit('serverStarting', serverId);

    try {
      const transport = server.config.transport;

      if (transport.type !== 'stdio') {
        throw new Error(`Desktop MCP only supports stdio transport, got: ${transport.type}`);
      }

      if (!transport.command) {
        throw new Error('Transport command is required');
      }

      log.info('Starting MCP server', {
        serverId,
        command: transport.command,
        args: transport.args,
      });

      // FIX: On Windows, resolve 'npx' to 'npx.cmd' to avoid ENOENT error
      let command = transport.command;
      if (command === 'npx' && process.platform === 'win32') {
        command = 'npx.cmd';
      }
      
      const child = spawn(command, transport.args || [], {
        env: { ...process.env, ...transport.env },
        cwd: transport.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      server.process = child;
      server.status = 'running';
      server.startedAt = new Date();

      // Wait for spawn event or error before marking as running
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', (err) => {
          server.status = 'error';
          server.error = err.message;
          reject(err);
        });
      });

      // Log stdout/stderr
      child.stdout?.on('data', (data: Buffer) => {
        this.writeLog(serverId, 'stdout', data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        this.writeLog(serverId, 'stderr', data.toString());
      });

      child.on('exit', (code, signal) => {
        log.info('MCP server exited', { serverId, code, signal });
        server.status = 'stopped';
        server.process = undefined;
        this.emit('serverStopped', serverId, code, signal);
      });

      child.on('error', (error) => {
        log.error('MCP server error', { serverId, error: error.message });
        server.status = 'error';
        server.error = error.message;
        this.emit('serverError', serverId, error);
      });

      this.emit('serverStarted', serverId);
      log.info('MCP server started', { serverId });
    } catch (error: any) {
      server.status = 'error';
      server.error = error.message;
      this.emit('serverError', serverId, error);
      throw error;
    }
  }

  /**
   * Stop an MCP server process
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (server.status !== 'running' || !server.process) {
      log.warn('Server not running', { serverId });
      return;
    }

    const process = server.process;

    return new Promise((resolve, reject) => {
      // Use once listeners to simply resolve/reject the promise.
      // Do NOT mutate state or re-emit events - startServer's listeners already handle that.
      const exitHandler = () => {
        resolve();
      };

      const errorHandler = (error: Error) => {
        reject(error);
      };

      process.once('exit', exitHandler);
      process.once('error', errorHandler);

      // Try graceful shutdown first
      const gracefulKilled = process.kill('SIGTERM');

      if (!gracefulKilled) {
        // Process already dead, resolve immediately
        resolve();
        return;
      }

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (server.process?.pid) {
          try {
            process.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
        }
      }, 5000);
    });
  }

  /**
   * Start all registered servers
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.servers.values())
      .filter((s) => s.config.enabled !== false)
      .map((s) => this.startServer(s.id).catch((err) => {
        log.error('Failed to start server', { serverId: s.id, error: err.message });
      }));

    await Promise.all(promises);
  }

  /**
   * Stop all MCP servers
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.values())
      .filter((s) => s.status === 'running')
      .map((s) => this.stopServer(s.id));

    await Promise.all(promises);
  }

  /**
   * Get server status
   */
  getServerStatus(serverId: string): DesktopMCPServer | undefined {
    return this.servers.get(serverId);
  }

  /**
   * Get all servers
   */
  getAllServers(): DesktopMCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get running servers
   */
  getRunningServers(): DesktopMCPServer[] {
    return Array.from(this.servers.values()).filter((s) => s.status === 'running');
  }

  /**
   * Write log to file
   */
  private writeLog(serverId: string, stream: string, data: string): void {
    const logFile = path.join(this.logDir, `${serverId}-${stream}.log`);
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${data}\n`;

    fs.appendFile(logFile, entry, (err) => {
      if (err) {
        log.error('Failed to write log', { serverId, stream, error: err.message });
      }
    });
  }

  /**
   * Get log path for a server
   */
  getLogPath(serverId: string): { stdout: string; stderr: string } {
    return {
      stdout: path.join(this.logDir, `${serverId}-stdout.log`),
      stderr: path.join(this.logDir, `${serverId}-stderr.log`),
    };
  }
}

// Singleton instance
export const desktopMCPManager = new DesktopMCPManager();

/**
 * Initialize desktop MCP with configuration
 */
export async function initializeDesktopMCP(
  configs: MCPServerConfig[]
): Promise<DesktopMCPManager> {
  if (!isDesktopMode()) {
    log.warn('Not in desktop mode, skipping desktop MCP initialization');
    return desktopMCPManager;
  }

  // Register all servers
  for (const config of configs) {
    desktopMCPManager.registerServer(config);
  }

  // Start all enabled servers
  await desktopMCPManager.startAll();

  log.info('Desktop MCP initialized', { serverCount: configs.length });

  return desktopMCPManager;
}

/**
 * Shutdown desktop MCP
 */
export async function shutdownDesktopMCP(): Promise<void> {
  await desktopMCPManager.stopAll();
  log.info('Desktop MCP shutdown complete');
}

/**
 * Create stdio transport config for desktop
 */
export function createDesktopStdioTransport(
  command: string,
  args: string[] = [],
  env?: Record<string, string>,
  cwd?: string
): MCPTransportConfig {
  return {
    type: 'stdio',
    command,
    args,
    env,
    cwd,
  };
}

/**
 * Common desktop MCP server presets
 */
export const desktopMCPPresets = {
  /**
   * Filesystem server for local file access
   */
  filesystem: (rootPath: string): MCPServerConfig => ({
    id: 'filesystem',
    name: 'Filesystem',
    transport: createDesktopStdioTransport(
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', rootPath]
    ),
    enabled: true,
  }),

  /**
   * GitHub server for GitHub API access
   */
  github: (token: string): MCPServerConfig => ({
    id: 'github',
    name: 'GitHub',
    transport: createDesktopStdioTransport(
      'npx',
      ['-y', '@modelcontextprotocol/server-github'],
      { GITHUB_PERSONAL_ACCESS_TOKEN: token }
    ),
    enabled: !!token,
  }),

  /**
   * Memory server for persistent memory
   */
  memory: (): MCPServerConfig => ({
    id: 'memory',
    name: 'Memory',
    transport: createDesktopStdioTransport(
      'npx',
      ['-y', '@modelcontextprotocol/server-memory']
    ),
    enabled: true,
  }),

  /**
   * SQLite server for local database
   */
  sqlite: (databasePath: string): MCPServerConfig => ({
    id: 'sqlite',
    name: 'SQLite',
    transport: createDesktopStdioTransport(
      'npx',
      ['-y', '@modelcontextprotocol/server-sqlite', databasePath]
    ),
    enabled: true,
  }),
};
