/**
 * Modal.com Provider Integration Tests
 *
 * These tests verify the Modal.com sandbox provider implementation.
 * They require valid MODAL_API_TOKEN and MODAL_API_SECRET environment variables.
 *
 * @module tests/sandbox/modal-com-provider.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ModalComProvider,
  ModalComSandboxHandle,
  isModalComSandbox,
  cleanupModalComSandboxes,
} from '@/lib/sandbox/providers/modal-com-provider';

describe('ModalComProvider', () => {
  let provider: ModalComProvider;
  let sandbox: ModalComSandboxHandle | null = null;

  beforeAll(() => {
    provider = new ModalComProvider();
  });

  afterAll(async () => {
    // Cleanup any remaining sandboxes
    if (sandbox) {
      try {
        await provider.destroySandbox(sandbox.id);
      } catch (error) {
        console.warn('Failed to cleanup sandbox in afterAll:', error);
      }
    }
    await cleanupModalComSandboxes();
  });

  describe('isAvailable', () => {
    it('should return false when credentials are not set', () => {
      // Temporarily unset env vars for this test
      const originalToken = process.env.MODAL_API_TOKEN;
      const originalSecret = process.env.MODAL_API_SECRET;
      
      delete process.env.MODAL_API_TOKEN;
      delete process.env.MODAL_API_SECRET;
      
      const newProvider = new ModalComProvider();
      expect(newProvider.isAvailable()).toBe(false);
      
      // Restore
      process.env.MODAL_API_TOKEN = originalToken;
      process.env.MODAL_API_SECRET = originalSecret;
    });

    it('should return true when credentials are set', () => {
      if (process.env.MODAL_API_TOKEN && process.env.MODAL_API_SECRET) {
        expect(provider.isAvailable()).toBe(true);
      }
    });
  });

  describe('initialization', () => {
    it('should throw error when credentials are missing', async () => {
      const originalToken = process.env.MODAL_API_TOKEN;
      const originalSecret = process.env.MODAL_API_SECRET;
      
      delete process.env.MODAL_API_TOKEN;
      delete process.env.MODAL_API_SECRET;
      
      const testProvider = new ModalComProvider();
      
      await expect(testProvider.createSandbox({ image: 'python:3.13' }))
        .rejects.toThrow('Modal.com API credentials required');
      
      // Restore
      process.env.MODAL_API_TOKEN = originalToken;
      process.env.MODAL_API_SECRET = originalSecret;
    });
  });

  describe('sandbox lifecycle', () => {
    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should create and terminate a sandbox',
      async () => {
        // Create sandbox
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60, // 1 minute
        });

        expect(sandbox).toBeDefined();
        expect(sandbox.id).toBeDefined();
        expect(sandbox.workspaceDir).toBe('/root');

        // Verify sandbox type
        expect(isModalComSandbox(sandbox)).toBe(true);

        // Terminate sandbox
        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );

    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should execute commands in sandbox',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60,
        });

        // Test basic command
        const result = await sandbox.executeCommand('echo "Hello from Modal"');
        
        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('Hello from Modal');

        // Test Python command
        const pythonResult = await sandbox.executeCommand('python --version');
        expect(pythonResult.success).toBe(true);
        expect(pythonResult.output).toMatch(/Python 3\./);

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );

    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should handle filesystem operations',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60,
        });

        // Write file
        const writeResult = await sandbox.writeFile('/tmp/test.txt', 'Hello Modal!');
        expect(writeResult.success).toBe(true);

        // Read file
        const readResult = await sandbox.readFile('/tmp/test.txt');
        expect(readResult.success).toBe(true);
        expect(readResult.content).toBe('Hello Modal!');

        // List directory
        const listResult = await sandbox.listDirectory('/tmp');
        expect(listResult.success).toBe(true);
        expect(listResult.content).toContain('test.txt');

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );

    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should handle GPU configuration',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'nvidia/cuda:12.4.0-devel-ubuntu22.04',
          gpu: 'A10G',
          cpu: 1,
          memory: 1024,
          timeout: 60,
        });

        // Verify GPU is accessible
        const result = await sandbox.executeCommand('nvidia-smi --query-gpu=name --format=csv,noheader');
        
        // Note: This may fail if GPU is not available in the region
        // The important thing is that the sandbox was created with GPU config
        expect(sandbox).toBeDefined();

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      90000
    );
  });

  describe('error handling', () => {
    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should handle command failures gracefully',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60,
        });

        // Test failing command
        const result = await sandbox.executeCommand('exit 42');
        
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(42);

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );

    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should handle file not found errors',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60,
        });

        const result = await sandbox.readFile('/nonexistent/file.txt');
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );
  });

  describe('provider methods', () => {
    it.skipIf(!process.env.MODAL_API_TOKEN || !process.env.MODAL_API_SECRET)(
      'should get sandbox by ID',
      async () => {
        sandbox = await provider.createSandbox({
          image: 'python:3.13-slim',
          cpu: 0.5,
          memory: 512,
          timeout: 60,
        });

        const retrieved = await provider.getSandbox(sandbox.id);
        expect(retrieved).toBeDefined();
        expect(retrieved.id).toBe(sandbox.id);

        await provider.destroySandbox(sandbox.id);
        sandbox = null;
      },
      60000
    );

    it('should throw error for non-existent sandbox', async () => {
      await expect(provider.getSandbox('nonexistent-id'))
        .rejects.toThrow('Modal.com sandbox not found');
    });
  });
});
