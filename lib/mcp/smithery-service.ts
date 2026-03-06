/**
 * Smithery.ai MCP Integration Service
 *
 * Provides access to the Smithery MCP marketplace for discovering,
 * connecting to, and managing MCP servers.
 *
 * API Reference: https://smithery.ai/docs
 */

import { z } from 'zod';

const SMITHERY_API_BASE = 'https://api.smithery.ai';

// Service-specific types (different API structure than smithery-registry.ts)
export interface SmitheryServiceServer {
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  verified: boolean;
  deploymentStatus: 'hosted' | 'external' | 'stdio' | 'repo';
  tools: string[];
  mcpEndpoint?: string;
  iconUrl?: string;
  starCount?: number;
}

export interface SmitheryServiceConnection {
  id: string;
  namespace: string;
  serverName: string;
  mcpUrl: string;
  status: 'active' | 'inactive' | 'error';
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt?: string;
}

export interface SmitheryToken {
  token: string;
  scopes: string[];
  expiresAt?: string;
}

export interface SmitheryNamespace {
  name: string;
  displayName: string;
  ownerId: string;
  serverCount: number;
  connectionCount: number;
}

export const SmitheryServerSchema = z.object({
  namespace: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  verified: z.boolean().optional(),
  deploymentStatus: z.enum(['hosted', 'external', 'stdio', 'repo']).optional(),
  tools: z.array(z.string()).optional(),
  mcpEndpoint: z.string().optional(),
  iconUrl: z.string().optional(),
  starCount: z.number().optional(),
});

export const SmitheryConnectionSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  serverName: z.string(),
  mcpUrl: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
  metadata: z.record(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export class SmitheryService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.SMITHERY_API_KEY || '';
    this.baseUrl = process.env.SMITHERY_API_BASE || SMITHERY_API_BASE;
  }

  /**
   * Check if Smithery is configured and available
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Smithery API key not configured');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Smithery API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Search for MCP servers in Smithery registry
   * @see https://smithery.ai/docs/api-reference/servers/list-all-servers
   */
  async searchServers(query: string, options?: {
    limit?: number;
    offset?: number;
    verified?: boolean;
    deploymentStatus?: 'hosted' | 'external' | 'stdio' | 'repo';
    namespace?: string;
    ownerId?: string;
  }): Promise<SmitheryServiceServer[]> {
    const params = new URLSearchParams({ q: query });

    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.verified !== undefined) params.set('verified', String(options.verified));
    if (options?.deploymentStatus) params.set('deploymentStatus', options.deploymentStatus);
    if (options?.namespace) params.set('namespace', options.namespace);
    if (options?.ownerId) params.set('ownerId', options.ownerId);

    const result = await this.request<{ servers: SmitheryServiceServer[] }>(
      `/servers?${params.toString()}`
    );

    return result.servers.map(server => SmitheryServerSchema.parse(server));
  }

  /**
   * Get details of a specific server
   * @see https://smithery.ai/docs/api-reference/servers/get-a-server
   */
  async getServer(namespace: string, serverName: string): Promise<SmitheryServiceServer> {
    const server = await this.request<SmitheryServiceServer>(`/servers/${namespace}/${serverName}`);
    return SmitheryServerSchema.parse(server);
  }

  /**
   * List all connections in a namespace
   * @see https://smithery.ai/docs/api-reference/connect/list-connections
   */
  async listConnections(namespace?: string): Promise<SmitheryServiceConnection[]> {
    const endpoint = namespace
      ? `/connections?namespace=${encodeURIComponent(namespace)}`
      : '/connections';

    const result = await this.request<{ connections: SmitheryServiceConnection[] }>(endpoint);
    return result.connections.map(conn => SmitheryConnectionSchema.parse(conn));
  }

  /**
   * Get a specific connection
   * @see https://smithery.ai/docs/api-reference/connect/get-connection
   */
  async getConnection(connectionId: string): Promise<SmitheryServiceConnection> {
    const conn = await this.request<SmitheryServiceConnection>(`/connections/${connectionId}`);
    return SmitheryConnectionSchema.parse(conn);
  }

  /**
   * Create a new MCP connection
   * @see https://smithery.ai/docs/api-reference/connect/create-connection
   */
  async createConnection(
    mcpUrl: string,
    metadata?: Record<string, string>
  ): Promise<SmitheryServiceConnection> {
    const conn = await this.request<SmitheryServiceConnection>('/connections', {
      method: 'POST',
      body: JSON.stringify({ mcpUrl, metadata }),
    });
    return SmitheryConnectionSchema.parse(conn);
  }

  /**
   * Create or update a connection
   * @see https://smithery.ai/docs/api-reference/connect/create-or-update-connection
   */
  async createOrUpdateConnection(
    connectionId: string,
    mcpUrl?: string
  ): Promise<SmitheryServiceConnection> {
    const conn = await this.request<SmitheryServiceConnection>(`/connections/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(mcpUrl ? { mcpUrl } : {}),
    });
    return SmitheryConnectionSchema.parse(conn);
  }

  /**
   * Delete a connection
   * @see https://smithery.ai/docs/api-reference/connect/delete-connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.request(`/connections/${connectionId}`, { method: 'DELETE' });
  }

  /**
   * Get MCP endpoint URL for a connection
   * @see https://smithery.ai/docs/api-reference/connectmcp/mcp-endpoint
   */
  async getMcpEndpoint(connectionId: string): Promise<string> {
    const result = await this.request<{ mcpEndpoint: string }>(
      `/connections/${connectionId}/mcp`
    );
    return result.mcpEndpoint;
  }

  /**
   * Create a service token for MCP access
   * @see https://smithery.ai/docs/api-reference/tokens/create-a-service-token
   */
  async createToken(
    scopes: string[], 
    restrictions?: {
      connectionIds?: string[];
      namespaces?: string[];
    }
  ): Promise<SmitheryToken> {
    return this.request<SmitheryToken>('/tokens', {
      method: 'POST',
      body: JSON.stringify({ scopes, restrictions }),
    });
  }

  /**
   * Poll for MCP server events
   * @see https://smithery.ai/docs/api-reference/connectevents/poll-events-unstable
   */
  async pollEvents(connectionId: string): Promise<{
    events: any[];
    done: boolean;
  }> {
    return this.request(`/connections/${connectionId}/events`, {
      method: 'POST',
    });
  }

  /**
   * List user's namespaces
   * @see https://smithery.ai/docs/api-reference/namespaces/get-users-namespaces-or-search-namespaces
   */
  async listNamespaces(): Promise<SmitheryNamespace[]> {
    const result = await this.request<{ namespaces: SmitheryNamespace[] }>('/namespaces');
    return result.namespaces;
  }

  /**
   * Create a new namespace
   * @see https://smithery.ai/docs/api-reference/namespaces/create-a-new-namespace
   */
  async createNamespace(name: string): Promise<SmitheryNamespace> {
    return this.request<SmitheryNamespace>('/namespaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  /**
   * Check service health
   * @see https://smithery.ai/docs/api-reference/health-check
   */
  async healthCheck(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/health');
  }

  /**
   * Update server configuration
   * @see https://smithery.ai/docs/api-reference/servers/update-a-server
   */
  async updateServer(
    qualifiedName: string,
    config: {
      displayName?: string;
      description?: string;
      iconUrl?: string;
    }
  ): Promise<SmitheryServiceServer> {
    const response = await this.request<SmitheryServiceServer>(`/servers/${qualifiedName}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
    return SmitheryServerSchema.parse(response);
  }

  /**
   * Delete a server
   * @see https://smithery.ai/docs/api-reference/servers/delete-a-server
   */
  async deleteServer(qualifiedName: string): Promise<void> {
    await this.request(`/servers/${qualifiedName}`, { method: 'DELETE' });
  }

  /**
   * Download server bundle (MCPB bundle for stdio releases)
   * @see https://smithery.ai/docs/api-reference/servers/download-server-bundle
   */
  async downloadBundle(qualifiedName: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('Smithery API key not configured');
    }

    const response = await fetch(`${this.baseUrl}/servers/${qualifiedName}/download`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to download bundle (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get server icon
   * @see https://smithery.ai/docs/api-reference/servers/get-server-icon
   */
  async getServerIcon(qualifiedName: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('Smithery API key not configured');
    }

    const response = await fetch(`${this.baseUrl}/servers/${qualifiedName}/icon`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get icon (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete server icon
   * @see https://smithery.ai/docs/api-reference/servers/delete-server-icon
   */
  async deleteServerIcon(qualifiedName: string): Promise<void> {
    await this.request(`/servers/${qualifiedName}/icon`, { method: 'DELETE' });
  }

  /**
   * List releases for a server
   * @see https://smithery.ai/docs/api-reference/servers/list-releases
   */
  async listReleases(qualifiedName: string): Promise<any[]> {
    return this.request(`/servers/${qualifiedName}/releases`);
  }

  /**
   * Get a specific release
   * @see https://smithery.ai/docs/api-reference/servers/get-a-release
   */
  async getRelease(qualifiedName: string, releaseId: string): Promise<any> {
    return this.request(`/servers/${qualifiedName}/releases/${releaseId}`);
  }

  /**
   * Publish a new release
   * @see https://smithery.ai/docs/api-reference/servers/publish-a-server
   */
  async publishRelease(
    qualifiedName: string,
    release: {
      version: string;
      sourceType: 'hosted' | 'external' | 'stdio' | 'repo';
      sourceUrl?: string;
      mcpEndpoint?: string;
      gitUrl?: string;
      gitRef?: string;
    }
  ): Promise<any> {
    return this.request(`/servers/${qualifiedName}/releases`, {
      method: 'PUT',
      body: JSON.stringify(release),
    });
  }

  /**
   * Resume a paused release
   * @see https://smithery.ai/docs/api-reference/servers/resume-a-release
   */
  async resumeRelease(qualifiedName: string, releaseId: string): Promise<any> {
    return this.request(`/servers/${qualifiedName}/releases/${releaseId}/resume`, {
      method: 'POST',
    });
  }

  /**
   * List runtime logs for a server
   * @see https://smithery.ai/docs/api-reference/servers/list-runtime-logs
   */
  async listRuntimeLogs(qualifiedName: string, limit?: number): Promise<string> {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<string>(`/servers/${qualifiedName}/logs${params}`);
  }

  /**
   * Delete a namespace
   * @see https://smithery.ai/docs/api-reference/namespaces/delete-a-namespace
   */
  async deleteNamespace(name: string): Promise<void> {
    await this.request(`/namespaces/${name}`, { method: 'DELETE' });
  }

  /**
   * Upload server icon (multipart/form-data)
   * @see https://smithery.ai/docs/api-reference/servers/upload-server-icon
   */
  async uploadServerIcon(
    qualifiedName: string,
    iconBuffer: Buffer,
    mimeType: string
  ): Promise<SmitheryServiceServer> {
    if (!this.apiKey) {
      throw new Error('Smithery API key not configured');
    }

    // Create form data
    const formData = new FormData();
    const blob = new Blob([iconBuffer], { type: mimeType });
    formData.append('icon', blob, 'icon');

    const response = await fetch(`${this.baseUrl}/servers/${qualifiedName}/icon`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // Don't set Content-Type - browser will set it with boundary for FormData
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload icon (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    return SmitheryServerSchema.parse(result);
  }

  /**
   * Stream release logs (SSE)
   * @see https://smithery.ai/docs/api-reference/servers/stream-release-logs
   */
  async streamReleaseLogs(
    qualifiedName: string,
    releaseId: string,
    onLog: (log: string) => void
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Smithery API key not configured');
    }

    const response = await fetch(
      `${this.baseUrl}/servers/${qualifiedName}/releases/${releaseId}/stream`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'text/event-stream',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to stream logs (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          onLog(line.slice(5).trim());
        }
      }
    }
  }
}

// Singleton instance
let smitheryServiceInstance: SmitheryService | null = null;

export function getSmitheryService(apiKey?: string): SmitheryService {
  if (!smitheryServiceInstance) {
    smitheryServiceInstance = new SmitheryService(apiKey);
  }
  return smitheryServiceInstance;
}
