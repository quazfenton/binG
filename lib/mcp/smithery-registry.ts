/**
 * Smithery MCP Registry Integration
 * 
 * Provides access to the Smithery MCP server registry for discovering,
 * installing, and managing MCP servers.
 * 
 * Features:
 * - Server discovery and search
 * - Server installation and deployment
 * - Connection management
 * - Bundle download
 * - Release management
 * 
 * @see https://smithery.ai/docs/api-reference
 */

// SmitheryClient and related types/interfaces are defined within this file,
// so a self-import is not necessary and causes conflicts.
// Other modules importing from './smithery-registry' will get these exports.

export interface SmitheryServer {
  qualifiedName: string;
  namespace: string;
  name: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  keywords?: string[];
  deploymentStatus?: 'stdio' | 'http' | 'container';
  verified?: boolean;
  starCount?: number;
  createdAt?: string;
  updatedAt?: string;
  mcpUrl?: string;
  iconUrl?: string;
}

export interface SmitheryRelease {
  id: string;
  version: string;
  status: 'success' | 'failed' | 'building';
  deploymentType: 'stdio' | 'http' | 'container';
  createdAt: string;
  logs?: string;
  mcpEndpointUrl?: string;
}

export interface SmitheryConnection {
  id: string;
  namespace: string;
  serverQualifiedName: string;
  mcpUrl: string;
  status: 'active' | 'inactive' | 'error';
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SmitherySearchOptions {
  q?: string;
  deploymentStatus?: 'stdio' | 'http' | 'container';
  verified?: boolean;
  ownerId?: string;
  hasTools?: boolean;
  hasSkills?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SmitherySearchResults {
  servers: SmitheryServer[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SmitheryConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Smithery Registry - Wrapper class with additional registry features
 */
export class SmitheryRegistry {
  private client: SmitheryClient;
  private installedServers: Map<string, SmitheryServer> = new Map();
  
  constructor(config?: SmitheryConfig) {
    this.client = new SmitheryClient(config);
  }
  
  /**
   * Search for servers in the registry
   */
  async searchServers(query: string): Promise<SmitheryServer[]> {
    const results = await this.client.searchServers({ q: query });
    return results.servers;
  }
  
  /**
   * Get server details
   */
  async getServerDetails(qualifiedName: string): Promise<{
    name: string;
    config: { command: string; args: string[] };
  }> {
    const server = await this.client.getServer(qualifiedName);
    return {
      name: server.name,
      config: {
        command: 'npx',
        args: ['-y', `@smithery/${qualifiedName}`],
      },
    };
  }
  
  /**
   * Install a server
   */
  async installServer(qualifiedName: string): Promise<{ success: boolean; serverId: string }> {
    const server = await this.client.getServer(qualifiedName);
    this.installedServers.set(qualifiedName, server);
    return { success: true, serverId: qualifiedName };
  }
  
  /**
   * Get installed servers
   */
  getInstalledServers(): SmitheryServer[] {
    return Array.from(this.installedServers.values());
  }
}

export { SmitheryClient };

export interface SmitheryRelease {
  id: string;
  version: string;
  status: 'success' | 'failed' | 'building';
  deploymentType: 'stdio' | 'http' | 'container';
  createdAt: string;
  logs?: string;
  mcpEndpointUrl?: string;
}

export interface SmitheryConnection {
  id: string;
  namespace: string;
  serverQualifiedName: string;
  mcpUrl: string;
  status: 'active' | 'inactive' | 'error';
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SmitherySearchOptions {
  /** Search query for full-text and semantic search */
  q?: string;
  /** Filter by deployment status */
  deploymentStatus?: 'stdio' | 'http' | 'container';
  /** Filter by verification status */
  verified?: boolean;
  /** Filter by owner namespace */
  ownerId?: string;
  /** Filter servers with MCP tools */
  hasTools?: boolean;
  /** Filter servers with MCP skills */
  hasSkills?: boolean;
  /** Page number for pagination */
  page?: number;
  /** Page size */
  pageSize?: number;
}

export interface SmitherySearchResults {
  servers: SmitheryServer[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SmitheryConfig {
  /** Smithery API key (required for authenticated operations) */
  apiKey?: string;
  /** Base URL (default: https://smithery.ai/api) */
  baseUrl?: string;
}

/**
 * Smithery Registry Client
 */
export class SmitheryClient {
  private apiKey?: string;
  private baseUrl: string;

  constructor(config: SmitheryConfig = {}) {
    this.apiKey = config.apiKey || process.env.SMITHERY_API_KEY;
    this.baseUrl = config.baseUrl || 'https://smithery.ai/api';
  }

  /**
   * Get authentication headers
   * 
   * Smithery uses X-API-Key header for service tokens
   * @see https://smithery.ai/docs/api-reference/tokens/create-a-service-token
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      // Smithery uses X-API-Key header, not Authorization Bearer
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Search and browse public MCP servers in the Smithery registry
   * 
   * @example
   * ```typescript
   * const results = await client.searchServers({
   *   q: 'github',
   *   verified: true,
   *   hasTools: true
   * });
   * ```
   */
  async searchServers(options: SmitherySearchOptions = {}): Promise<SmitherySearchResults> {
    const params = new URLSearchParams();

    if (options.q) params.append('q', options.q);
    if (options.deploymentStatus) params.append('deploymentStatus', options.deploymentStatus);
    if (options.verified !== undefined) params.append('verified', String(options.verified));
    if (options.ownerId) params.append('ownerId', options.ownerId);
    if (options.hasTools !== undefined) params.append('hasTools', String(options.hasTools));
    if (options.hasSkills !== undefined) params.append('hasSkills', String(options.hasSkills));
    if (options.page) params.append('page', String(options.page));
    if (options.pageSize) params.append('pageSize', String(options.pageSize));

    const response = await fetch(`${this.baseUrl}/servers?${params.toString()}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Smithery search failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get details for a specific MCP server
   * 
   * @example
   * ```typescript
   * const server = await client.getServer('github/mcp-server');
   * ```
   */
  async getServer(qualifiedName: string): Promise<SmitheryServer> {
    const response = await fetch(
      `${this.baseUrl}/servers/${encodeURIComponent(qualifiedName)}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get server: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List all releases for a server
   * 
   * @example
   * ```typescript
   * const releases = await client.listReleases('github/mcp-server');
   * ```
   */
  async listReleases(qualifiedName: string): Promise<SmitheryRelease[]> {
    const response = await fetch(
      `${this.baseUrl}/servers/${encodeURIComponent(qualifiedName)}/releases`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list releases: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get details for a specific release
   * 
   * @example
   * ```typescript
   * const release = await client.getRelease('github/mcp-server', 'release-123');
   * ```
   */
  async getRelease(qualifiedName: string, releaseId: string): Promise<SmitheryRelease> {
    const response = await fetch(
      `${this.baseUrl}/servers/${encodeURIComponent(qualifiedName)}/releases/${releaseId}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get release: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Download the MCPB bundle for the latest successful stdio release
   * 
   * @example
   * ```typescript
   * const bundle = await client.downloadBundle('github/mcp-server');
   * // bundle is a Blob that can be saved to disk
   * ```
   */
  async downloadBundle(qualifiedName: string): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl}/servers/${encodeURIComponent(qualifiedName)}/download`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download bundle: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * List runtime logs for a server
   * 
   * @example
   * ```typescript
   * const logs = await client.getRuntimeLogs('github/mcp-server');
   * ```
   */
  async getRuntimeLogs(qualifiedName: string): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/servers/${encodeURIComponent(qualifiedName)}/logs`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get logs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List all connections in a namespace
   * 
   * @example
   * ```typescript
   * const connections = await client.listConnections('my-namespace');
   * ```
   */
  async listConnections(namespace: string, metadata?: Record<string, string>): Promise<SmitheryConnection[]> {
    const params = new URLSearchParams();

    // Add metadata filters
    if (metadata) {
      Object.entries(metadata).forEach(([key, value]) => {
        params.append(`metadata.${key}`, value);
      });
    }

    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list connections: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get details for a specific connection
   * 
   * @example
   * ```typescript
   * const connection = await client.getConnection('my-namespace', 'connection-123');
   * ```
   */
  async getConnection(namespace: string, connectionId: string): Promise<SmitheryConnection> {
    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}/${encodeURIComponent(connectionId)}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get connection: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new MCP connection with an auto-generated ID
   * 
   * @example
   * ```typescript
   * const connection = await client.createConnection('my-namespace', {
   *   mcpUrl: 'https://mcp-server.example.com/mcp'
   * });
   * ```
   */
  async createConnection(
    namespace: string,
    config: {
      mcpUrl: string;
      metadata?: Record<string, any>;
    }
  ): Promise<SmitheryConnection> {
    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}`,
      {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create connection: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create or update an MCP connection with a specific ID
   * 
   * @example
   * ```typescript
   * await client.upsertConnection('my-namespace', 'my-connection', {
   *   mcpUrl: 'https://mcp-server.example.com/mcp'
   * });
   * ```
   */
  async upsertConnection(
    namespace: string,
    connectionId: string,
    config: {
      mcpUrl: string;
      metadata?: Record<string, any>;
    }
  ): Promise<SmitheryConnection> {
    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}/${encodeURIComponent(connectionId)}`,
      {
        method: 'PUT',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to upsert connection: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a connection and terminate its MCP session
   * 
   * @example
   * ```typescript
   * await client.deleteConnection('my-namespace', 'connection-123');
   * ```
   */
  async deleteConnection(namespace: string, connectionId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}/${encodeURIComponent(connectionId)}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete connection: ${response.statusText}`);
    }
  }

  /**
   * Poll for MCP server events (unstable API)
   * 
   * @example
   * ```typescript
   * const events = await client.pollEvents('my-namespace', 'connection-123');
   * ```
   */
  async pollEvents(namespace: string, connectionId: string): Promise<{
    events: any[];
    done: boolean;
  }> {
    const response = await fetch(
      `${this.baseUrl}/connect/${encodeURIComponent(namespace)}/${encodeURIComponent(connectionId)}/events`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to poll events: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create or update a namespace
   * 
   * @example
   * ```typescript
   * await client.createNamespace('my-namespace');
   * ```
   */
  async createNamespace(name: string): Promise<{ success: boolean; name: string }> {
    const response = await fetch(
      `${this.baseUrl}/namespaces/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create namespace: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get user's namespaces or search namespaces
   * 
   * @example
   * ```typescript
   * // Get my namespaces
   * const namespaces = await client.listNamespaces();
   * 
   * // Search public namespaces
   * const results = await client.searchNamespaces({ q: 'github' });
   * ```
   */
  async listNamespaces(options?: {
    q?: string;
    hasServers?: boolean;
    hasSkills?: boolean;
    ownerId?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();

    if (options?.q) params.append('q', options.q);
    if (options?.hasServers !== undefined) params.append('hasServers', String(options.hasServers));
    if (options?.hasSkills !== undefined) params.append('hasSkills', String(options.hasSkills));
    if (options?.ownerId) params.append('ownerId', options.ownerId);

    const response = await fetch(
      `${this.baseUrl}/namespaces?${params.toString()}`,
      {
        headers: this.getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list namespaces: ${response.statusText}`);
    }

    return response.json();
  }
}

/**
 * Create Smithery client instance
 */
export function createSmitheryClient(config?: SmitheryConfig): SmitheryClient {
  return new SmitheryClient(config);
}

/**
 * Create Smithery registry instance
 */
export function createSmitheryRegistry(config?: SmitheryConfig): SmitheryRegistry {
  return new SmitheryRegistry(config);
}

/**
 * Default Smithery registry instance
 */
export const smitheryRegistry = new SmitheryRegistry();
