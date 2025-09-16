/**
 * Tests for Plugin Isolation System
 */

import { PluginIsolationManager, PluginError } from '../plugin-isolation';

describe('PluginIsolationManager', () => {
  let manager: PluginIsolationManager;

  beforeEach(() => {
    manager = new PluginIsolationManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('Sandbox Creation', () => {
    it('should create a sandbox with default configuration', () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      expect(sandboxId).toMatch(/^sandbox_test-plugin_\d+$/);
      
      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox).toBeDefined();
      expect(sandbox?.pluginId).toBe('test-plugin');
      expect(sandbox?.status).toBe('initializing');
    });

    it('should create a sandbox with custom configuration', () => {
      const config = {
        resourceLimits: {
          maxMemoryMB: 200,
          maxCpuPercent: 50,
          maxNetworkRequests: 100,
          maxStorageKB: 2048,
          timeoutMs: 60000
        }
      };

      const sandboxId = manager.createSandbox('test-plugin', config);
      const sandbox = manager.getSandboxInfo(sandboxId);
      
      expect(sandbox).toBeDefined();
      expect(sandbox?.pluginId).toBe('test-plugin');
    });
  });

  describe('Sandbox Execution', () => {
    it('should execute operations successfully in sandbox', async () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      const result = await manager.executeInSandbox(sandboxId, async () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
      
      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.status).toBe('running');
    });

    it('should handle execution errors', async () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      await expect(
        manager.executeInSandbox(sandboxId, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.status).toBe('error');
      expect(sandbox?.errors).toHaveLength(1);
      expect(sandbox?.errors[0].message).toBe('Test error');
    });

    it('should handle execution timeout', async () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      await expect(
        manager.executeInSandbox(sandboxId, async () => {
          return new Promise(resolve => setTimeout(resolve, 2000));
        }, 100) // 100ms timeout
      ).rejects.toThrow('timeout');

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.status).toBe('error');
    });
  });

  describe('Error Handling', () => {
    it('should register and trigger error handlers', async () => {
      const errorHandler = jest.fn();
      manager.registerErrorHandler('test-plugin', errorHandler);
      
      const sandboxId = manager.createSandbox('test-plugin');
      
      try {
        await manager.executeInSandbox(sandboxId, async () => {
          throw new Error('Test error');
        });
      } catch (error) {
        // Expected to throw
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          type: 'runtime',
          message: 'Test error'
        })
      );
    });
  });

  describe('Sandbox Management', () => {
    it('should pause and resume sandbox', () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      manager.pauseSandbox(sandboxId);
      let sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.status).toBe('paused');
      
      manager.resumeSandbox(sandboxId);
      sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.status).toBe('running');
    });

    it('should terminate sandbox', () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      manager.terminateSandbox(sandboxId);
      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox).toBeUndefined();
    });

    it('should get plugin sandboxes', () => {
      const sandboxId1 = manager.createSandbox('test-plugin');
      const sandboxId2 = manager.createSandbox('test-plugin');
      const sandboxId3 = manager.createSandbox('other-plugin');
      
      const pluginSandboxes = manager.getPluginSandboxes('test-plugin');
      expect(pluginSandboxes).toHaveLength(2);
      expect(pluginSandboxes.every(s => s.pluginId === 'test-plugin')).toBe(true);
    });
  });

  describe('Resource Monitoring', () => {
    it('should track resource usage over time', async () => {
      const sandboxId = manager.createSandbox('test-plugin');
      
      // Execute some operations to generate resource usage
      await manager.executeInSandbox(sandboxId, async () => {
        return 'test';
      });

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.resourceUsage).toBeDefined();
      expect(sandbox?.resourceUsage.executionTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up all resources', () => {
      const sandboxId1 = manager.createSandbox('test-plugin-1');
      const sandboxId2 = manager.createSandbox('test-plugin-2');
      
      manager.cleanup();
      
      expect(manager.getSandboxInfo(sandboxId1)).toBeUndefined();
      expect(manager.getSandboxInfo(sandboxId2)).toBeUndefined();
    });
  });
});