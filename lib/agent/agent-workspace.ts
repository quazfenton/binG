/**
 * Agent Workspace API
 * Higher-level workspace abstraction for AI agents
 * Migrated from ephemeral/agent_api.py
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'crypto';

export interface AgentWorkspace {
  agentId: string;
  workspaceId: string;
  sandboxId?: string;
  name: string;
  description?: string;
  createdAt: string;
  status: 'active' | 'suspended' | 'deleted';
  sharedWith: string[];
  tags: string[];
  permissions: Map<string, 'read' | 'write' | 'admin'>;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  tags?: string[];
  sandboxConfig?: any;
}

export interface ShareWorkspaceRequest {
  targetAgentIds: string[];
  permission: 'read' | 'write' | 'admin';
}

export interface WorkerListing {
  workerId: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  endpointUrl: string;
  pricing: Record<string, number>;
  rating: number;
  installs: number;
}

export interface PublishWorkerRequest {
  name: string;
  description: string;
  tags: string[];
  endpointUrl: string;
  pricing?: Record<string, number>;
}

export interface ExecRequest {
  command: string;
  args?: string[];
  timeout?: number;
}

export class WorkspaceManager extends EventEmitter {
  private workspaces: Map<string, AgentWorkspace> = new Map();
  private shares: Map<string, Map<string, 'read' | 'write' | 'admin'>> = new Map();
  private marketplace: Map<string, WorkerListing> = new Map();

  async createWorkspace(
    agentId: string,
    name: string,
    description?: string,
    tags?: string[]
  ): Promise<AgentWorkspace> {
    const workspaceId = randomUUID();
    const workspace: AgentWorkspace = {
      agentId,
      workspaceId,
      name,
      description,
      createdAt: new Date().toISOString(),
      status: 'active',
      sharedWith: [],
      tags: tags || [],
      permissions: new Map([[agentId, 'admin']]),
    };

    this.workspaces.set(workspaceId, workspace);
    this.shares.set(workspaceId, new Map());
    
    this.emit('workspace_created', workspace);
    
    return workspace;
  }

  async getWorkspace(workspaceId: string): Promise<AgentWorkspace> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  async listWorkspaces(agentId: string): Promise<AgentWorkspace[]> {
    const result: AgentWorkspace[] = [];
    
    for (const workspace of this.workspaces.values()) {
      // Include owned workspaces
      if (workspace.agentId === agentId) {
        result.push(workspace);
      }
      // Include shared workspaces
      else if (workspace.sharedWith.includes(agentId)) {
        result.push(workspace);
      }
    }
    
    return result;
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return false;
    }

    this.workspaces.delete(workspaceId);
    this.shares.delete(workspaceId);
    
    this.emit('workspace_deleted', workspaceId);
    
    return true;
  }

  async shareWorkspace(
    workspaceId: string,
    targetAgentIds: string[],
    permission: 'read' | 'write' | 'admin'
  ): Promise<Map<string, 'read' | 'write' | 'admin'>> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const shares = this.shares.get(workspaceId) || new Map();
    
    for (const agentId of targetAgentIds) {
      shares.set(agentId, permission);
      
      if (!workspace.sharedWith.includes(agentId)) {
        workspace.sharedWith.push(agentId);
      }
    }

    this.shares.set(workspaceId, shares);
    
    this.emit('workspace_shared', { workspaceId, targetAgentIds, permission });
    
    return shares;
  }

  async checkAccess(workspaceId: string, agentId: string): Promise<'read' | 'write' | 'admin' | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return null;
    }

    // Owner has admin access
    if (workspace.agentId === agentId) {
      return 'admin';
    }

    // Check shared permissions
    const shares = this.shares.get(workspaceId);
    if (shares) {
      return shares.get(agentId) || null;
    }

    return null;
  }

  async publishWorker(author: string, request: PublishWorkerRequest): Promise<WorkerListing> {
    const workerId = randomUUID();
    const worker: WorkerListing = {
      workerId,
      name: request.name,
      description: request.description,
      author,
      version: '1.0.0',
      tags: request.tags,
      endpointUrl: request.endpointUrl,
      pricing: request.pricing || {},
      rating: 0,
      installs: 0,
    };

    this.marketplace.set(workerId, worker);
    
    this.emit('worker_published', worker);
    
    return worker;
  }

  async searchMarketplace(query?: string, tags?: string[]): Promise<WorkerListing[]> {
    let results = Array.from(this.marketplace.values());

    // Filter by query
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(w => 
        w.name.toLowerCase().includes(q) || 
        w.description.toLowerCase().includes(q)
      );
    }

    // Filter by tags
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags);
      results = results.filter(w => 
        w.tags.some(tag => tagSet.has(tag))
      );
    }

    return results;
  }

  async getWorker(workerId: string): Promise<WorkerListing | null> {
    return this.marketplace.get(workerId) || null;
  }

  async installWorker(workerId: string, agentId: string): Promise<void> {
    const worker = this.marketplace.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    worker.installs++;
    this.marketplace.set(workerId, worker);
    
    this.emit('worker_installed', { workerId, agentId });
  }

  async rateWorker(workerId: string, agentId: string, rating: number): Promise<void> {
    const worker = this.marketplace.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    // Simple rating calculation (in production, use proper averaging)
    worker.rating = (worker.rating + rating) / 2;
    this.marketplace.set(workerId, worker);
    
    this.emit('worker_rated', { workerId, agentId, rating });
  }
}

// Singleton instance
export const workspaceManager = new WorkspaceManager();
