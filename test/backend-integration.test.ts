/**
 * Backend Integration Tests
 * Tests for all backend modules
 * 
 * Run with: npm test -- test/backend-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WebSocketTerminalServer,
  webSocketTerminalServer,
} from '@/lib/backend/websocket-terminal';
import {
  SandboxManager,
  sandboxManager,
} from '@/lib/backend/sandbox-manager';
import { QuotaManager, quotaManager } from '@/lib/backend/quota';
import { WorkspaceManager, workspaceManager } from '@/lib/backend/agent-workspace';
import { sandboxMetrics } from '@/lib/backend/metrics';

// Mock LocalStorageBackend for testing
class LocalStorageBackend {
  constructor(private baseDir: string) {}
  async upload(localPath: string, remotePath: string): Promise<{ location: string }> {
    return { location: remotePath };
  }
  async download(remotePath: string, localPath: string): Promise<boolean> {
    return true;
  }
  async delete(path: string): Promise<boolean> {
    return true;
  }
  async list(prefix: string): Promise<any[]> {
    return [];
  }
  async exists(path: string): Promise<boolean> {
    return false;
  }
}

// Mock ProcessRuntime for testing
class ProcessRuntime {
  constructor(private baseDir: string) {}
  async createSandbox(sandboxId: string): Promise<{ sandboxId: string; workspace: string }> {
    return { sandboxId, workspace: this.baseDir };
  }
  async execInSandbox(sandboxId: string, command: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
    return { stdout: 'mock output', exitCode: 0 };
  }
  async deleteSandbox(sandboxId: string): Promise<void> {}
  async shutdown(): Promise<void> {}
}

describe('Backend Integration Tests', () => {
  describe('WebSocketTerminalServer', () => {
    let server: WebSocketTerminalServer;

    beforeEach(() => {
      // Use a random port to avoid conflicts
      server = new WebSocketTerminalServer(0, { maxSessions: 10 });
    });

    afterEach(async () => {
      // Ensure server is stopped
      try {
        await server.stop();
      } catch (e) {
        // Server may not have been started
      }
    });

    it('should initialize with correct configuration', () => {
      expect(server).toBeDefined();
      expect(server.getActiveSessions()).toBe(0);
    });
  });

  describe('SandboxManager', () => {
    let manager: SandboxManager;

    beforeEach(() => {
      // Use temp directory for testing
      manager = new SandboxManager('/tmp/test-workspaces', '/tmp/test-snapshots');
    });

    it('should create a sandbox with valid id', async () => {
      const sandbox = await manager.createSandbox();
      expect(sandbox.sandboxId).toBeDefined();
      expect(sandbox.workspace).toBeDefined();
      expect(sandbox.status).toBe('running');
    });

    it('should get a sandbox by ID', async () => {
      const created = await manager.createSandbox({ sandboxId: 'test-get-id' });
      const retrieved = await manager.getSandbox(created.sandboxId);
      expect(retrieved.sandboxId).toBe(created.sandboxId);
    });

    it('should throw error for non-existent sandbox', async () => {
      await expect(manager.getSandbox('non-existent')).rejects.toThrow('not found');
    });

    it('should delete a sandbox', async () => {
      const sandbox = await manager.createSandbox({ sandboxId: 'test-delete' });
      await manager.deleteSandbox(sandbox.sandboxId);
      await expect(manager.getSandbox(sandbox.sandboxId)).rejects.toThrow('not found');
    });
  });

  describe('LocalStorageBackend', () => {
    let backend: LocalStorageBackend;

    beforeEach(() => {
      backend = new LocalStorageBackend('/tmp/test-storage');
    });

    it('should return location on upload', async () => {
      const result = await backend.upload('/tmp/test.txt', 'remote.txt');
      expect(result.location).toBe('remote.txt');
    });

    it('should return true on download', async () => {
      const result = await backend.download('test.txt', '/tmp/test.txt');
      expect(result).toBe(true);
    });

    it('should return true on delete', async () => {
      const result = await backend.delete('test.txt');
      expect(result).toBe(true);
    });

    it('should return empty array on list', async () => {
      const objects = await backend.list('');
      expect(objects).toEqual([]);
    });

    it('should return false for non-existent file', async () => {
      const exists = await backend.exists('non-existent.txt');
      expect(exists).toBe(false);
    });
  });

  describe('ProcessRuntime', () => {
    let runtime: ProcessRuntime;

    beforeEach(() => {
      runtime = new ProcessRuntime('/tmp/test-process-runtime');
    });

    afterEach(async () => {
      await runtime.shutdown();
    });

    it('should create a sandbox with given id', async () => {
      const result = await runtime.createSandbox('test123');
      expect(result.sandboxId).toBe('test123');
      expect(result.workspace).toBeDefined();
    });

    it('should delete a sandbox', async () => {
      await runtime.createSandbox('test789');
      await runtime.deleteSandbox('test789');
    });
  });

  describe('QuotaManager', () => {
    let quotaManager: QuotaManager;

    beforeEach(() => {
      quotaManager = new QuotaManager({
        maxExecutionsPerHour: 10,
        maxConcurrentSandboxes: 5,
        maxMemoryMB: 1024,
        warningThreshold: 80,
      });
    });

    it('should allow execution within quota', () => {
      const allowed = quotaManager.allowExecution('sandbox1');
      expect(allowed).toBe(true);
    });

    it('should deny execution when quota exceeded', () => {
      // Use up quota
      for (let i = 0; i < 10; i++) {
        quotaManager.allowExecution('sandbox2');
      }
      
      // Next should be denied
      const allowed = quotaManager.allowExecution('sandbox2');
      expect(allowed).toBe(false);
    });

    it('should record usage', () => {
      quotaManager.recordUsage('sandbox3', {
        memoryMB: 512,
        storageMB: 1024,
        cpuCores: 2,
      });
      
      const usage = quotaManager.getUsage('sandbox3');
      expect(usage?.memoryMB).toBe(512);
    });

    it('should emit warning at threshold', () => {
      const warnings: any[] = [];
      quotaManager.on('warning', (warning) => warnings.push(warning));
      
      // Set usage at 85% (above 80% threshold)
      quotaManager.recordUsage('sandbox4', { memoryMB: 870 });
      
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].type).toBe('memory');
    });

    it('should track violations', () => {
      const violations: any[] = [];
      quotaManager.on('violation', (violation) => violations.push(violation));
      
      // Exceed quota
      for (let i = 0; i < 11; i++) {
        quotaManager.allowExecution('sandbox5');
      }
      
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].type).toBe('execution_rate');
    });
  });

  describe('WorkspaceManager', () => {
    let manager: WorkspaceManager;

    beforeEach(() => {
      manager = new WorkspaceManager();
    });

    it('should create a workspace', async () => {
      const workspace = await manager.createWorkspace('agent1', 'Test Workspace', 'Description');
      expect(workspace.workspaceId).toBeDefined();
      expect(workspace.name).toBe('Test Workspace');
      expect(workspace.agentId).toBe('agent1');
    });

    it('should list workspaces', async () => {
      await manager.createWorkspace('agent2', 'Workspace 1');
      await manager.createWorkspace('agent2', 'Workspace 2');
      
      const workspaces = await manager.listWorkspaces('agent2');
      expect(workspaces.length).toBe(2);
    });

    it('should share workspace', async () => {
      const workspace = await manager.createWorkspace('owner', 'Shared Workspace');
      const shares = await manager.shareWorkspace(workspace.workspaceId, ['agent3'], 'read');
      
      expect(shares.has('agent3')).toBe(true);
      expect(shares.get('agent3')).toBe('read');
    });

    it('should check access', async () => {
      const workspace = await manager.createWorkspace('owner2', 'Access Test');
      await manager.shareWorkspace(workspace.workspaceId, ['agent4'], 'write');
      
      const ownerAccess = await manager.checkAccess(workspace.workspaceId, 'owner2');
      const sharedAccess = await manager.checkAccess(workspace.workspaceId, 'agent4');
      const noAccess = await manager.checkAccess(workspace.workspaceId, 'stranger');
      
      expect(ownerAccess).toBe('admin');
      expect(sharedAccess).toBe('write');
      expect(noAccess).toBe(null);
    });

    it('should publish worker', async () => {
      const worker = await manager.publishWorker('author1', {
        name: 'Test Worker',
        description: 'A test worker',
        tags: ['test'],
        endpointUrl: 'http://localhost:8000/test',
      });
      
      expect(worker.workerId).toBeDefined();
      expect(worker.name).toBe('Test Worker');
    });

    it('should search marketplace', async () => {
      await manager.publishWorker('author2', {
        name: 'Python Runner',
        description: 'Run Python code',
        tags: ['python', 'code'],
        endpointUrl: 'http://localhost:8000/python',
      });
      
      const results = await manager.searchMarketplace('python');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Python Runner');
    });
  });

  describe('SandboxMetrics', () => {
    it('should have registry defined', () => {
      expect(sandboxMetrics.registry).toBeDefined();
    });

    it('should have counter metric', () => {
      expect(sandboxMetrics.sandboxCreatedTotal).toBeDefined();
    });

    it('should have gauge metric', () => {
      expect(sandboxMetrics.sandboxActive).toBeDefined();
    });

    it('should have histogram metric', () => {
      expect(sandboxMetrics.sandboxExecDuration).toBeDefined();
    });

    it('should export Prometheus format', () => {
      const format = sandboxMetrics.registry.toPrometheusFormat();
      expect(format).toContain('# HELP');
      expect(format).toContain('# TYPE');
    });
  });
});
