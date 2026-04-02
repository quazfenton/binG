/**
 * MCP Store & Discovery Service
 *
 * Discovers, installs, and manages MCP servers from multiple sources:
 * - Smithery marketplace
 * - Local user configurations
 * - Community packages
 * - Custom user MCPs
 *
 * Features:
 * - Server discovery and search
 * - One-click installation
 * - API key management
 * - Local storage persistence
 * - Smithery scraping/integration
 * - User package publishing
 */

import { z } from 'zod';
import { getSmitheryService, type SmitheryServiceServer } from './smithery-service';
import type { MCPServerConfig } from './types';
import { createLogger } from '@/lib/utils/logger';

// Dynamic import for server-only modules (only used on server)
let mcpToolRegistry: any = null;
async function getMcpToolRegistry() {
  if (!mcpToolRegistry) {
    const module = await import('./registry');
    mcpToolRegistry = module.mcpToolRegistry;
  }
  return mcpToolRegistry;
}

const logger = createLogger('MCP:Store');

/**
 * Result of server installation
 */
interface InstallResult {
  success: boolean;
  serverId?: string;
  reason?: string;
  error?: string;
}

/**
 * Result of server uninstallation
 */
interface UninstallResult {
  success: boolean;
  reason?: string;
  error?: string;
}

// ============================================================================
// Types
// ============================================================================

export interface MCPServerPackage {
  id: string;
  name: string;
  namespace?: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  iconUrl?: string;
  source: 'smithery' | 'local' | 'community' | 'custom';
  mcpUrl?: string;
  transportType?: 'stdio' | 'http' | 'websocket';
  configSchema?: Record<string, any>;
  apiKeys?: MCPApiKeyConfig[];
  installed: boolean;
  enabled: boolean;
  starCount?: number;
  verified?: boolean;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface MCPApiKeyConfig {
  name: string;
  description?: string;
  required: boolean;
  envVar?: string;
  storedValue?: string;
}

export interface MCPStoreConfig {
  smitheryApiKey?: string;
  autoInstallUpdates?: boolean;
  allowCustomServers?: boolean;
  communitySources?: string[];
}

export interface MCPStoreStats {
  totalServers: number;
  installedServers: number;
  activeServers: number;
  smitheryServers: number;
  localServers: number;
}

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY = 'mcp-store-data';
const CONFIG_KEY = 'mcp-store-config';

interface StoredData {
  servers: MCPServerPackage[];
  apiKeys: Record<string, string>;
  config: MCPStoreConfig;
  lastSync?: number;
}

function loadStoredData(): StoredData {
  if (typeof window === 'undefined') {
    return { servers: [], apiKeys: {}, config: {} };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { servers: [], apiKeys: {}, config: {} };
    }
    return JSON.parse(stored);
  } catch (error) {
    logger.error('Failed to load MCP store data:', error);
    return { servers: [], apiKeys: {}, config: {} };
  }
}

function saveStoredData(data: Partial<StoredData>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = loadStoredData();
    const updated = { ...current, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    logger.error('Failed to save MCP store data:', error);
  }
}

// ============================================================================
// MCP Store Service
// ============================================================================

export class MCPStoreService {
  private servers: Map<string, MCPServerPackage> = new Map();
  private apiKeys: Map<string, string> = new Map();
  private config: MCPStoreConfig = {};
  private smitheryService = getSmitheryService();
  private syncInProgress = false;
  private lastSyncTime: number = 0;

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load data from local storage
   */
  private loadFromStorage(): void {
    const stored = loadStoredData();
    
    // Load servers
    for (const server of stored.servers) {
      this.servers.set(server.id, server);
    }

    // Load API keys
    for (const [name, value] of Object.entries(stored.apiKeys)) {
      this.apiKeys.set(name, value);
    }

    // Load config
    this.config = stored.config || {};

    // Update Smithery service with API key
    if (this.config.smitheryApiKey) {
      this.smitheryService = getSmitheryService(this.config.smitheryApiKey);
    }

    logger.info(`Loaded MCP store: ${this.servers.size} servers`);
  }

  /**
   * Save data to local storage
   */
  private saveToStorage(): void {
    const servers = Array.from(this.servers.values());
    const apiKeys = Object.fromEntries(this.apiKeys);
    
    saveStoredData({
      servers,
      apiKeys,
      config: this.config,
      lastSync: this.lastSyncTime,
    });
  }

  /**
   * Get all servers
   */
  getAllServers(): MCPServerPackage[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get installed servers
   */
  getInstalledServers(): MCPServerPackage[] {
    return Array.from(this.servers.values()).filter(s => s.installed);
  }

  /**
   * Get active servers
   */
  getActiveServers(): MCPServerPackage[] {
    return Array.from(this.servers.values()).filter(s => s.installed && s.enabled);
  }

  /**
   * Search servers
   */
  searchServers(query: string, filters?: {
    source?: MCPServerPackage['source'];
    installed?: boolean;
    tags?: string[];
  }): MCPServerPackage[] {
    const lowerQuery = query.toLowerCase();
    
    return this.getAllServers().filter(server => {
      // Text search
      const matchesQuery = 
        server.name.toLowerCase().includes(lowerQuery) ||
        server.displayName.toLowerCase().includes(lowerQuery) ||
        server.description.toLowerCase().includes(lowerQuery) ||
        server.tags?.some(tag => tag.toLowerCase().includes(lowerQuery));

      if (!matchesQuery) return false;

      // Filters
      if (filters?.source && server.source !== filters.source) return false;
      if (filters?.installed !== undefined && server.installed !== filters.installed) return false;
      if (filters?.tags?.length) {
        const hasTag = filters.tags.some(tag => 
          server.tags?.some(serverTag => serverTag.toLowerCase().includes(tag.toLowerCase()))
        );
        if (!hasTag) return false;
      }

      return true;
    });
  }

  /**
   * Sync with Smithery marketplace
   */
  async syncWithSmithery(options?: {
    query?: string;
    limit?: number;
    verified?: boolean;
  }): Promise<MCPServerPackage[]> {
    if (this.syncInProgress) {
      logger.warn('Smithery sync already in progress');
      return [];
    }

    if (!this.config.smitheryApiKey) {
      logger.warn('Smithery API key not configured');
      return [];
    }

    this.syncInProgress = true;

    try {
      const query = options?.query || '';
      const servers = await this.smitheryService.searchServers(query, {
        limit: options?.limit || 50,
        verified: options?.verified,
      });

      const newServers: MCPServerPackage[] = [];

      for (const server of servers) {
        const id = `${server.namespace || 'smithery'}:${server.name}`;
        
        const existing = this.servers.get(id);
        const updated: MCPServerPackage = {
          id,
          name: server.name,
          namespace: server.namespace,
          displayName: server.displayName || server.name,
          description: server.description || '',
          version: 'latest',
          author: server.namespace,
          iconUrl: server.iconUrl,
          source: 'smithery' as const,
          mcpUrl: server.mcpEndpoint,
          transportType: this.detectTransportType(server.deploymentStatus),
          installed: existing?.installed || false,
          enabled: existing?.enabled || false,
          starCount: server.starCount,
          verified: server.verified,
          tags: this.extractTags(server),
          createdAt: existing?.createdAt || Date.now(),
          updatedAt: Date.now(),
        };

        this.servers.set(id, updated);
        newServers.push(updated);
      }

      this.lastSyncTime = Date.now();
      this.saveToStorage();

      logger.info(`Synced ${newServers.length} servers from Smithery`);
      return newServers;
    } catch (error: any) {
      logger.error('Failed to sync with Smithery:', error.message);
      return [];
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Install an MCP server
   */
  async installServer(serverId: string, config?: {
    mcpUrl?: string;
    apiKeys?: Record<string, string>;
  }): Promise<InstallResult> {
    const server = this.servers.get(serverId);
    if (!server) {
      logger.error(`Server not found: ${serverId}`);
      return { success: false, reason: 'not_found' };
    }

    try {
      // Store API keys if provided
      if (config?.apiKeys && server.apiKeys) {
        for (const [keyName, value] of Object.entries(config.apiKeys)) {
          this.apiKeys.set(`${serverId}:${keyName}`, value);
        }
      }

      // Create MCP server config
      const mcpConfig: MCPServerConfig = {
        id: serverId,
        name: server.displayName,
        transport: {
          type: server.transportType || 'http',
          url: config?.mcpUrl || server.mcpUrl || '',
        },
        enabled: true,
      };

      // Register with MCP tool registry (server-only)
      const registry = await getMcpToolRegistry();
      if (registry) {
        registry.registerServer(mcpConfig);
      }

      // Update server state
      server.installed = true;
      server.enabled = true;
      this.servers.set(serverId, server);
      this.saveToStorage();

      logger.info(`Installed MCP server: ${serverId}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to install server ${serverId}:`, error);
      return { success: false, reason: 'internal', error };
    }
  }

  /**
   * Uninstall an MCP server
   */
  async uninstallServer(serverId: string): Promise<UninstallResult> {
    const server = this.servers.get(serverId);
    if (!server) {
      logger.error(`Server not found: ${serverId}`);
      return { success: false, reason: 'not_found' };
    }

    try {
      // Unregister from MCP tool registry (server-only)
      const registry = await getMcpToolRegistry();
      if (registry) {
        await registry.unregisterServer(serverId);
      }

      // Update server state
      server.installed = false;
      server.enabled = false;
      this.servers.set(serverId, server);
      this.saveToStorage();

      logger.info(`Uninstalled MCP server: ${serverId}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to uninstall server ${serverId}:`, error);
      return { success: false, reason: 'internal', error };
    }
  }

  /**
   * Enable/disable a server
   */
  setServerEnabled(serverId: string, enabled: boolean): boolean {
    const server = this.servers.get(serverId);
    if (!server) {
      logger.error(`Server not found: ${serverId}`);
      return false;
    }

    server.enabled = enabled;
    this.servers.set(serverId, server);
    this.saveToStorage();

    logger.info(`${enabled ? 'Enabled' : 'Disabled'} MCP server: ${serverId}`);
    return true;
  }

  /**
   * Add custom MCP server
   */
  addCustomServer(config: {
    name: string;
    displayName: string;
    description: string;
    mcpUrl: string;
    transportType: 'stdio' | 'http' | 'websocket';
    apiKeys?: MCPApiKeyConfig[];
    tags?: string[];
  }): MCPServerPackage {
    const id = `custom:${config.name}`;
    
    const server: MCPServerPackage = {
      id,
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      version: '1.0.0',
      source: 'custom',
      mcpUrl: config.mcpUrl,
      transportType: config.transportType,
      apiKeys: config.apiKeys,
      installed: false,
      enabled: false,
      tags: config.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.servers.set(id, server);
    this.saveToStorage();

    logger.info(`Added custom MCP server: ${id}`);
    return server;
  }

  /**
   * Remove custom MCP server
   */
  removeCustomServer(serverId: string): boolean {
    const server = this.servers.get(serverId);
    if (!server || server.source !== 'custom') {
      logger.error(`Custom server not found: ${serverId}`);
      return false;
    }

    this.servers.delete(serverId);
    this.saveToStorage();

    logger.info(`Removed custom MCP server: ${serverId}`);
    return true;
  }

  /**
   * Store API key
   */
  storeApiKey(serverId: string, keyName: string, value: string): void {
    this.apiKeys.set(`${serverId}:${keyName}`, value);
    this.saveToStorage();
    logger.info(`Stored API key: ${keyName} for ${serverId}`);
  }

  /**
   * Get stored API key
   */
  getApiKey(serverId: string, keyName: string): string | undefined {
    return this.apiKeys.get(`${serverId}:${keyName}`);
  }

  /**
   * Delete stored API key
   */
  deleteApiKey(serverId: string, keyName: string): boolean {
    const key = `${serverId}:${keyName}`;
    if (!this.apiKeys.has(key)) {
      return false;
    }

    this.apiKeys.delete(key);
    this.saveToStorage();
    logger.info(`Deleted API key: ${keyName} for ${serverId}`);
    return true;
  }

  /**
   * Update store configuration
   */
  updateConfig(config: Partial<MCPStoreConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update Smithery service if API key changed
    if (config.smitheryApiKey) {
      this.smitheryService = getSmitheryService(config.smitheryApiKey);
    }

    this.saveToStorage();
    logger.info('Updated MCP store config');
  }

  /**
   * Get store configuration
   */
  getConfig(): MCPStoreConfig {
    return this.config;
  }

  /**
   * Get store statistics
   */
  getStats(): MCPStoreStats {
    const servers = this.getAllServers();
    const installed = servers.filter(s => s.installed);
    const active = servers.filter(s => s.installed && s.enabled);

    return {
      totalServers: servers.length,
      installedServers: installed.length,
      activeServers: active.length,
      smitheryServers: servers.filter(s => s.source === 'smithery').length,
      localServers: servers.filter(s => s.source === 'local' || s.source === 'custom').length,
    };
  }

  /**
   * Connect all installed servers (server-only)
   */
  async connectAllServers(timeout?: number): Promise<void> {
    const registry = await getMcpToolRegistry();
    if (registry) {
      await registry.connectAll(timeout);
      logger.info('Connected all MCP servers');
    }
  }

  /**
   * Disconnect all servers (server-only)
   */
  async disconnectAllServers(): Promise<void> {
    const registry = await getMcpToolRegistry();
    if (registry) {
      await registry.disconnectAll();
      logger.info('Disconnected all MCP servers');
    }
  }

  // ==================== Private Helpers ====================

  private detectTransportType(deploymentStatus?: string): 'stdio' | 'http' | 'websocket' {
    switch (deploymentStatus) {
      case 'stdio':
      case 'repo':
        return 'stdio';
      case 'hosted':
        return 'http';
      default:
        return 'http';
    }
  }

  private extractTags(server: SmitheryServiceServer): string[] {
    const tags: string[] = [];

    if (server.verified) tags.push('verified');
    if (server.deploymentStatus) tags.push(server.deploymentStatus);
    if (server.tools?.length) tags.push('tools');

    return tags;
  }
}

// Singleton instance
export const mcpStoreService = new MCPStoreService();
