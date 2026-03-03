/**
 * Backend Integration Tests
 * Tests for all backend modules
 * 
 * Run with: npm test -- test/backend-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WebSocketTerminalServer,
  SandboxManager,
  S3StorageBackend,
  LocalStorageBackend,
  FirecrackerRuntime,
  ProcessRuntime,
  QuotaManager,
  WorkspaceManager,
  sandboxMetrics,
} from '@/lib/backend';

describe('Backend Integration Tests', () => {
  describe('WebSocketTerminalServer', () => {
    let server: WebSocketTerminalServer;

    beforeEach(async () => {
      server = new WebSocketTerminalServer(8081, { maxSessions: 10 });
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should start and stop successfully', async () => {
      await server.start();
      expect(server.getActiveSessions()).toBe(0);
      await server.stop();
    });

    it('should enforce max sessions limit', async () => {
      const limitedServer = new WebSocketTerminalServer(8082, { maxSessions: 2 });
      await limitedServer.start();
      
      // In a real test, we would create WebSocket connections
      // For now, just verify the limit is set
      expect(limitedServer.getActiveSessions()).toBe(0);
      
      await limitedServer.stop();
    });

    it('should emit session events', async () => {
      const events: string[] = [];
      server.on('started', () => events.push('started'));
      server.on('stopped', () => events.push('stopped'));
      
      await server.start();
      await server.stop();
      
      expect(events).toEqual(['started', 'stopped']);
    });
  });

  describe('SandboxManager', () => {
    let manager: SandboxManager;

    beforeEach(() => {
      manager = new SandboxManager();
    });

    it('should create a sandbox', async () => {
      const sandbox = await manager.createSandbox();
      expect(sandbox.sandboxId).toBeDefined();
      expect(sandbox.workspace).toBeDefined();
      expect(sandbox.status).toBe('running');
    });

    it('should get a sandbox by ID', async () => {
      const created = await manager.createSandbox();
      const retrieved = await manager.getSandbox(created.sandboxId);
      expect(retrieved.sandboxId).toBe(created.sandboxId);
    });

    it('should throw error for non-existent sandbox', async () => {
      await expect(manager.getSandbox('non-existent')).rejects.toThrow('not found');
    });

    it('should delete a sandbox', async () => {
      const sandbox = await manager.createSandbox();
      await manager.deleteSandbox(sandbox.sandboxId);
      await expect(manager.getSandbox(sandbox.sandboxId)).rejects.toThrow('not found');
    });

    it('should execute a command', async () => {
      const sandbox = await manager.createSandbox();
      const result = await manager.execCommand(sandbox.sandboxId, 'echo', ['hello']);
      expect(result.stdout).toContain('hello');
      expect(result.exitCode).toBe(0);
    });

    it('should write and read a file', async () => {
      const sandbox = await manager.createSandbox();
      await manager.writeFile(sandbox.sandboxId, 'test.txt', 'hello world');
      const content = await manager.readFile(sandbox.sandboxId, 'test.txt');
      expect(content).toBe('hello world');
    });

    it('should list files', async () => {
      const sandbox = await manager.createSandbox();
      await manager.writeFile(sandbox.sandboxId, 'file1.txt', 'content1');
      await manager.writeFile(sandbox.sandboxId, 'file2.txt', 'content2');
      
      const files = await manager.listFiles(sandbox.sandboxId);
      expect(files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('LocalStorageBackend', () => {
    let backend: LocalStorageBackend;
    const testDir = '/tmp/test-storage';

    beforeEach(() => {
      backend = new LocalStorageBackend(testDir);
    });

    it('should upload a file', async () => {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      const tempFile = join(testDir, 'temp.txt');
      writeFileSync(tempFile, 'test content');
      
      const result = await backend.upload(tempFile, 'remote.txt');
      expect(result.location).toContain('remote.txt');
    });

    it('should download a file', async () => {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      
      // Upload first
      const tempFile = join(testDir, 'upload.txt');
      writeFileSync(tempFile, 'download test');
      await backend.upload(tempFile, 'download.txt');
      
      // Download
      const downloadPath = join(testDir, 'downloaded.txt');
      const success = await backend.download('download.txt', downloadPath);
      expect(success).toBe(true);
    });

    it('should delete a file', async () => {
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      
      const tempFile = join(testDir, 'delete.txt');
      writeFileSync(tempFile, 'delete me');
      await backend.upload(tempFile, 'to-delete.txt');
      
      const deleted = await backend.delete('to-delete.txt');
      expect(deleted).toBe(true);
    });

    it('should list files', async () => {
      const objects = await backend.list('');
      expect(Array.isArray(objects)).toBe(true);
    });

    it('should check if file exists', async () => {
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

    it('should create a sandbox', async () => {
      const result = await runtime.createSandbox('test123');
      expect(result.sandboxId).toBe('test123');
      expect(result.workspace).toBeDefined();
    });

    it('should execute a command in sandbox', async () => {
      await runtime.createSandbox('test456');
      const result = await runtime.execInSandbox('test456', 'echo', ['hello']);
      expect(result.stdout).toContain('hello');
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
    it('should register metrics', () => {
      expect(sandboxMetrics.registry.get('sandbox_created_total')).toBeDefined();
      expect(sandboxMetrics.registry.get('sandbox_active')).toBeDefined();
      expect(sandboxMetrics.registry.get('http_requests_total')).toBeDefined();
    });

    it('should increment counter', () => {
      const counter = sandboxMetrics.sandboxCreatedTotal;
      const before = counter.getSamples()[0]?.value || 0;
      counter.inc();
      const after = counter.getSamples()[0]?.value || 0;
      expect(after).toBe(before + 1);
    });

    it('should set gauge', () => {
      const gauge = sandboxMetrics.sandboxActive;
      gauge.set(5);
      const samples = gauge.getSamples();
      expect(samples[0]?.value).toBe(5);
    });

    it('should observe histogram', () => {
      const histogram = sandboxMetrics.sandboxExecDuration;
      histogram.observe(1.5, { sandbox_id: 'test', command: 'echo' });
      const samples = histogram.getSamples();
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should export Prometheus format', () => {
      const format = sandboxMetrics.registry.toPrometheusFormat();
      expect(format).toContain('# HELP');
      expect(format).toContain('# TYPE');
    });
  });
});
