/**
 * MCP Health Check & Monitoring
 * 
 * Provides health monitoring for MCP servers and tools.
 * Includes server health status, tool availability, performance metrics.
 */

import { createLogger } from '../utils/logger';
import { mcpToolRegistry } from './registry';
import { isMCPAvailable } from './config';
import { desktopMCPManager } from './desktop-mcp-manager';
import { getVFSToolDefinitions } from './vfs-mcp-tools';

const logger = createLogger('MCP-Health');

/**
 * Health check result for a single MCP server
 */
export interface MCPServerHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  url?: string;
  transport: 'stdio' | 'http' | 'sse';
  latencyMs?: number;
  error?: string;
  lastChecked: string;
  toolCount: number;
}

/**
 * Overall MCP health status
 */
export interface MCPHealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  servers: MCPServerHealth[];
  summary: {
    totalServers: number;
    healthyServers: number;
    totalTools: number;
  };
}

/**
 * Monitor MCP health
 */
export async function checkMCPHealth(): Promise<MCPHealthStatus> {
  const servers: MCPServerHealth[] = [];
  let healthyCount = 0;

  // Check registered MCP servers
  try {
    const serverStatuses = mcpToolRegistry.getAllServerStatuses();
    const allTools = mcpToolRegistry.getAllTools();

    for (const status of serverStatuses) {
      servers.push({
        name: status.name,
        status: status.info.state === 'connected' ? 'healthy' : 'unhealthy',
        transport: 'stdio', // stdio is the only transport for registry servers
        latencyMs: undefined,
        lastChecked: new Date().toISOString(),
        toolCount: allTools.filter(t => t.serverId === status.id).length,
      });

      if (status.info.state === 'connected') healthyCount++;
    }
  } catch (error: any) {
    logger.warn('Failed to check registered servers', { error: error.message });
  }

  // Check VFS MCP server
  const vfsTools = getVFSToolDefinitions();
  
  // Calculate overall status
  const overall = servers.length === 0 
    ? (vfsTools.length > 0 ? 'healthy' : 'unhealthy')
    : healthyCount === servers.length 
      ? 'healthy' 
      : servers.some(s => s.status === 'unhealthy') 
        ? 'unhealthy' 
        : 'degraded';

  return {
    overall,
    timestamp: new Date().toISOString(),
    servers,
    summary: {
      totalServers: servers.length,
      healthyServers: healthyCount,
      totalTools: servers.reduce((sum, s) => sum + s.toolCount, 0) + vfsTools.length,
    },
  };
}

/**
 * Quick health check - returns boolean
 */
export async function isMCPHealthy(): Promise<boolean> {
  try {
    const health = await checkMCPHealth();
    return health.overall === 'healthy' || health.overall === 'degraded';
  } catch {
    return false;
  }
}

/**
 * Get health for specific server
 */
export async function getServerHealth(serverName: string): Promise<MCPServerHealth | null> {
  const health = await checkMCPHealth();
  return health.servers.find(s => s.name === serverName) || null;
}

// Health monitoring state
let healthMonitorInterval: NodeJS.Timeout | null = null;
let healthCheckCallback: ((status: MCPHealthStatus) => void) | null = null;

/**
 * Start periodic health monitoring
 */
export function startHealthMonitoring(intervalMs: number = 30000, callback?: (status: MCPHealthStatus) => void): void {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
  }
  
  healthCheckCallback = callback || null;
  
  healthMonitorInterval = setInterval(async () => {
    const status = await checkMCPHealth();
    healthCheckCallback?.(status);
    logger.debug('Health check', { overall: status.overall, servers: status.servers.length });
  }, intervalMs);
  
  logger.info('Health monitoring started', { intervalMs });
}

/**
 * Stop periodic health monitoring
 */
export function stopHealthMonitoring(): void {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
    healthCheckCallback = null;
    logger.info('Health monitoring stopped');
  }
}

/**
 * Handle MCP health check request (for API endpoint)
 */
export async function handleMCPHealthCheck(): Promise<MCPHealthStatus> {
  return checkMCPHealth();
}