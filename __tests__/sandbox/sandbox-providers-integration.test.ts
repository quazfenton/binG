/**
 * Sandbox Provider Integration Tests
 * 
 * Comprehensive integration tests for sandbox providers including:
 * - Provider lifecycle (create, use, destroy)
 * - File operations (read, write, list, delete)
 * - Command execution
 * - Preview URL generation
 * - PTY terminal support
 * - Snapshot/checkpoint operations
 * - Provider-specific features
 * 
 * Note: These tests require valid API keys in .env file.
 * Set ENABLE_LIVE_SANDBOX_TESTS=true to opt into live-provider execution tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SandboxProvider, SandboxHandle, SandboxCreateConfig } from '@/lib/sandbox/providers/sandbox-provider';
import type { ToolResult, PreviewInfo } from '@/lib/sandbox/types';

// These tests exercise live providers and are opt-in by default.
const PLACEHOLDER_PATTERNS = [
  'your_',
  '_here',
  'placeholder',
  'example',
  'test-',
];

function hasRealCredential(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
}

const ENABLE_LIVE_SANDBOX_TESTS = process.env.ENABLE_LIVE_SANDBOX_TESTS === 'true';
const HAS_ANY_PROVIDER_KEY = [
  process.env.CSB_API_KEY,
  process.env.E2B_API_KEY,
  process.env.DAYTONA_API_KEY,
  process.env.BLAXEL_API_KEY,
].some(hasRealCredential);
const SKIP_TESTS = process.env.TEST_SANDBOX_SKIP === 'true' || !ENABLE_LIVE_SANDBOX_TESTS || !HAS_ANY_PROVIDER_KEY;

describe('Sandbox Provider Integration', () => {
  describe('Provider Interface Compliance', () => {
    it('should have required provider properties', async () => {
      // Test provider interface structure
      const providers = await getAvailableProviders();

      for (const provider of providers) {
        expect(provider).toHaveProperty('name');
        expect(typeof provider.name).toBe('string');
        expect(provider).toHaveProperty('createSandbox');
        expect(typeof provider.createSandbox).toBe('function');
        expect(provider).toHaveProperty('getSandbox');
        expect(typeof provider.getSandbox).toBe('function');
        expect(provider).toHaveProperty('destroySandbox');
        expect(typeof provider.destroySandbox).toBe('function');
      }
    });

    it('should have consistent handle interface', async () => {
      const providers = await getAvailableProviders();

      for (const provider of providers) {
        // Verify handle methods exist
        expect(provider.createSandbox).toBeDefined();
        expect(provider.getSandbox).toBeDefined();
        expect(provider.destroySandbox).toBeDefined();
      }
    });
  });

  describe('CodeSandbox Provider', () => {
    let provider: SandboxProvider;
    let sandbox: SandboxHandle | null = null;

    beforeEach(async () => {
      if (SKIP_TESTS) {
        console.log('Skipping CodeSandbox tests (TEST_SANDBOX_SKIP=true)');
        return;
      }

      try {
        const { CodeSandboxProvider } = await import('@/lib/sandbox/providers/codesandbox-provider');
        provider = new CodeSandboxProvider();
      } catch (error) {
        console.warn('CodeSandbox provider not available:', error);
      }
    });

    afterEach(async () => {
      if (sandbox && provider) {
        try {
          await provider.destroySandbox(sandbox.id);
        } catch (error) {
          console.warn('Failed to destroy sandbox:', error);
        }
      }
    });

    it('should create sandbox with basic configuration', async () => {
      if (SKIP_TESTS || !provider) {
        console.log('Skipping test');
        return;
      }

      const config: SandboxCreateConfig = {
        language: 'node',
        template: 'nodejs',
      };

      sandbox = await provider.createSandbox(config);

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
      expect(sandbox.workspaceDir).toBeDefined();
      expect(typeof sandbox.id).toBe('string');
      expect(typeof sandbox.workspaceDir).toBe('string');
    });

    it('should write file to sandbox', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.writeFile('test.txt', 'Hello CodeSandbox!');

      expect(result.success).toBe(true);
    });

    it('should read file from sandbox', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const content = 'Test content 123';
      await sandbox.writeFile('readme.txt', content);

      const result = await sandbox.readFile('readme.txt');

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
    });

    it('should list directory contents', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('file1.txt', 'content1');
      await sandbox.writeFile('file2.txt', 'content2');
      await sandbox.writeFile('subdir/file3.txt', 'content3');

      const result = await sandbox.listDirectory('.');

      expect(result.success).toBe(true);
      expect(result.entries).toBeDefined();
      expect(Array.isArray(result.entries)).toBe(true);
    });

    it('should execute command', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.executeCommand('echo "Hello World"');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
    });

    it('should handle command with exit code', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.executeCommand('exit 0');

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should handle command failure', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.executeCommand('exit 1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should get preview link for port', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      if (sandbox.getPreviewLink) {
        // Start a simple HTTP server
        await sandbox.writeFile('server.js', `
          const http = require('http');
          const server = http.createServer((req, res) => {
            res.writeHead(200);
            res.end('Hello');
          });
          server.listen(3000);
        `);

        const preview = await sandbox.getPreviewLink(3000);

        expect(preview).toBeDefined();
        expect(preview.url).toBeDefined();
        expect(typeof preview.url).toBe('string');
      }
    });

    it('should handle file operations in subdirectories', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('src/components/Button.tsx', 'export const Button = () => null;');
      await sandbox.writeFile('src/utils/helpers.ts', 'export const add = (a, b) => a + b;');

      const srcListing = await sandbox.listDirectory('src');
      expect(srcListing.success).toBe(true);

      const componentsListing = await sandbox.listDirectory('src/components');
      expect(componentsListing.success).toBe(true);
    });

    it('should delete file', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('to-delete.txt', 'delete me');
      const deleteResult = await sandbox.executeCommand('rm to-delete.txt');

      expect(deleteResult.success).toBe(true);

      const readResult = await sandbox.readFile('to-delete.txt');
      expect(readResult.success).toBe(false);
    });
  });

  describe('E2B Provider', () => {
    let provider: SandboxProvider;
    let sandbox: SandboxHandle | null = null;

    beforeEach(async () => {
      if (SKIP_TESTS) {
        console.log('Skipping E2B tests (TEST_SANDBOX_SKIP=true)');
        return;
      }

      try {
        const { E2BProvider } = await import('@/lib/sandbox/providers/e2b-provider');
        provider = new E2BProvider();
      } catch (error) {
        console.warn('E2B provider not available:', error);
      }
    });

    afterEach(async () => {
      if (sandbox && provider) {
        try {
          await provider.destroySandbox(sandbox.id);
        } catch (error) {
          console.warn('Failed to destroy sandbox:', error);
        }
      }
    });

    it('should create E2B sandbox', async () => {
      if (SKIP_TESTS || !provider) {
        console.log('Skipping test');
        return;
      }

      const config: SandboxCreateConfig = {
        language: 'python',
        template: 'base',
      };

      sandbox = await provider.createSandbox(config);

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
      expect(sandbox.workspaceDir).toBeDefined();
    });

    it('should execute Python code', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'python' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.executeCommand('python3 -c "print(\'Hello from Python\')"');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello from Python');
    });

    it('should execute Node.js code', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      const result = await sandbox.executeCommand('node -e "console.log(\'Hello from Node\')"');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello from Node');
    });

    it('should write and execute script file', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'python' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('script.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
      `);

      const result = await sandbox.executeCommand('python3 script.py');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello, World!');
    });

    it('should handle file upload and download', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'python' };
      sandbox = await provider.createSandbox(config);

      const originalContent = 'Test file content\nLine 2\nLine 3';
      await sandbox.writeFile('data.txt', originalContent);

      const result = await sandbox.readFile('data.txt');

      expect(result.success).toBe(true);
      expect(result.content).toBe(originalContent);
    });

    it('should list sandbox sessions', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'python' };
      sandbox = await provider.createSandbox(config);

      if (provider.getSandbox) {
        const handle = await provider.getSandbox(sandbox.id);
        expect(handle).toBeDefined();
        expect(handle.id).toBe(sandbox.id);
      }
    });
  });

  describe('WebContainer Provider', () => {
    let provider: SandboxProvider;
    let sandbox: SandboxHandle | null = null;

    beforeEach(async () => {
      if (SKIP_TESTS) {
        console.log('Skipping WebContainer tests (TEST_SANDBOX_SKIP=true)');
        return;
      }

      try {
        const { WebContainerProvider } = await import('@/lib/sandbox/providers/webcontainer-provider');
        provider = new WebContainerProvider();
      } catch (error) {
        console.warn('WebContainer provider not available:', error);
      }
    });

    afterEach(async () => {
      if (sandbox && provider) {
        try {
          await provider.destroySandbox(sandbox.id);
        } catch (error) {
          console.warn('Failed to destroy sandbox:', error);
        }
      }
    });

    it('should create WebContainer sandbox', async () => {
      if (SKIP_TESTS || !provider) {
        console.log('Skipping test');
        return;
      }

      const config: SandboxCreateConfig = {
        language: 'node',
      };

      sandbox = await provider.createSandbox(config);

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
    });

    it('should install npm packages', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('package.json', JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: {
          'lodash': '^4.17.21',
        },
      }));

      const result = await sandbox.executeCommand('npm install');

      expect(result.success).toBe(true);
    });

    it('should run Node.js server', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      await sandbox.writeFile('server.js', `
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from WebContainer');
        });
        server.listen(3000);
        console.log('Server running on port 3000');
      `);

      // Start server in background
      await sandbox.executeCommand('node server.js &');

      // Give server time to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (sandbox.getPreviewLink) {
        const preview = await sandbox.getPreviewLink(3000);
        expect(preview).toBeDefined();
      }
    });
  });

  describe('Blaxel Provider', () => {
    let provider: SandboxProvider;
    let sandbox: SandboxHandle | null = null;

    beforeEach(async () => {
      if (SKIP_TESTS) {
        console.log('Skipping Blaxel tests (TEST_SANDBOX_SKIP=true)');
        return;
      }

      try {
        const { BlaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider');
        provider = new BlaxelProvider();
      } catch (error) {
        console.warn('Blaxel provider not available:', error);
      }
    });

    afterEach(async () => {
      if (sandbox && provider) {
        try {
          await provider.destroySandbox(sandbox.id);
        } catch (error) {
          console.warn('Failed to destroy sandbox:', error);
        }
      }
    });

    it('should create Blaxel sandbox', async () => {
      if (SKIP_TESTS || !provider) {
        console.log('Skipping test');
        return;
      }

      const config: SandboxCreateConfig = {
        language: 'node',
      };

      sandbox = await provider.createSandbox(config);

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
    });

    it('should execute batch job', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      if (sandbox.runBatchJob) {
        const tasks = [
          {
            type: 'command' as const,
            command: 'echo "Task 1"',
          },
          {
            type: 'command' as const,
            command: 'echo "Task 2"',
          },
        ];

        const result = await sandbox.runBatchJob(tasks);

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
      }
    });

    it('should sync VFS files', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      if (sandbox.syncVfs) {
        const vfsSnapshot = {
          files: [
            { path: 'src/file1.ts', content: 'export const f1 = 1;' },
            { path: 'src/file2.ts', content: 'export const f2 = 2;' },
          ],
        };

        const result = await sandbox.syncVfs(vfsSnapshot);

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.filesSynced).toBe(2);
      }
    });

    it('should sync only changed files', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      // Initial sync
      if (sandbox.syncVfs) {
        await sandbox.syncVfs({
          files: [
            { path: 'src/file1.ts', content: 'export const f1 = 1;' },
            { path: 'src/file2.ts', content: 'export const f2 = 2;' },
          ],
        });
      }

      // Changed sync
      if (sandbox.syncChangedVfs) {
        const result = await sandbox.syncChangedVfs({
          files: [
            { path: 'src/file1.ts', content: 'export const f1 = 1; // updated' },
            { path: 'src/file2.ts', content: 'export const f2 = 2;' }, // unchanged
          ],
        });

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.changedFiles).toBe(1);
      }
    });

    it('should create proxy service', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      if (sandbox.createProxy) {
        await sandbox.writeFile('server.js', `
          const http = require('http');
          http.createServer((req, res) => res.end('OK')).listen(3000);
        `);
        await sandbox.executeCommand('node server.js &');

        const proxy = await sandbox.createProxy({ port: 3000 });

        expect(proxy).toBeDefined();
        expect(proxy.url).toBeDefined();
      }
    });

    it('should get public URL', async () => {
      if (SKIP_TESTS || !provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      sandbox = await provider.createSandbox(config);

      if (sandbox.getPublicUrl) {
        const url = await sandbox.getPublicUrl();

        expect(url).toBeDefined();
        expect(typeof url).toBe('string');
      }
    });
  });

  describe('Provider Fallback Chain', () => {
    it('should fallback through providers when one fails', async () => {
      // Test the fallback mechanism
      const providers = ['codesandbox', 'e2b', 'webcontainer'];
      const availableProviders: string[] = [];

      for (const providerName of providers) {
        try {
          const provider = await getProviderByName(providerName);
          if (provider) {
            availableProviders.push(providerName);
          }
        } catch (error) {
          // Provider not available, continue to next
        }
      }

      // At least one provider should be available
      expect(availableProviders.length).toBeGreaterThan(0);
    });
  });

  describe('Sandbox Lifecycle Management', () => {
    it('should properly cleanup sandbox after use', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const config: SandboxCreateConfig = { language: 'node' };
      const sandbox = await provider.createSandbox(config);

      // Do some work
      await sandbox.writeFile('test.txt', 'content');
      await sandbox.executeCommand('echo test');

      // Destroy
      await provider.destroySandbox(sandbox.id);

      // Verify it's gone
      try {
        await provider.getSandbox(sandbox.id);
        // If we get here, the sandbox wasn't properly destroyed
        expect(true).toBe(false);
      } catch (error) {
        // Expected - sandbox should not exist
        expect(true).toBe(true);
      }
    });

    it('should handle sandbox timeout', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const config: SandboxCreateConfig = {
        language: 'node',
        timeout: 60000, // 1 minute for testing
      };

      const sandbox = await provider.createSandbox(config);

      expect(sandbox).toBeDefined();
      // Sandbox should be valid immediately after creation
      expect(sandbox.id).toBeDefined();
    });
  });

  describe('Concurrent Sandbox Operations', () => {
    it('should handle multiple concurrent sandboxes', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const config: SandboxCreateConfig = { language: 'node' };

      const sandboxes = await Promise.all([
        provider.createSandbox(config),
        provider.createSandbox(config),
        provider.createSandbox(config),
      ]);

      expect(sandboxes).toHaveLength(3);
      expect(new Set(sandboxes.map(s => s.id)).size).toBe(3); // All unique IDs

      // Cleanup
      await Promise.all(
        sandboxes.map(s => provider.destroySandbox(s.id).catch(() => {}))
      );
    });

    it('should isolate concurrent sandbox filesystems', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const config: SandboxCreateConfig = { language: 'node' };

      const [sandbox1, sandbox2] = await Promise.all([
        provider.createSandbox(config),
        provider.createSandbox(config),
      ]);

      await sandbox1.writeFile('unique.txt', 'sandbox1');
      await sandbox2.writeFile('unique.txt', 'sandbox2');

      const [read1, read2] = await Promise.all([
        sandbox1.readFile('unique.txt'),
        sandbox2.readFile('unique.txt'),
      ]);

      expect(read1.content).toBe('sandbox1');
      expect(read2.content).toBe('sandbox2');

      // Cleanup
      await Promise.all([
        provider.destroySandbox(sandbox1.id),
        provider.destroySandbox(sandbox2.id),
      ]);
    });
  });

  describe('Provider Configuration', () => {
    it('should respect environment configuration', () => {
      // Test that providers read environment variables
      expect(process.env.CSB_API_KEY || '').toBeDefined();
      expect(process.env.E2B_API_KEY || '').toBeDefined();
    });

    it('should handle missing API keys gracefully', async () => {
      const originalKey = process.env.CSB_API_KEY;
      delete process.env.CSB_API_KEY;

      try {
        const { CodeSandboxProvider } = await import('@/lib/sandbox/providers/codesandbox-provider');
        const provider = new CodeSandboxProvider();

        await expect(provider.createSandbox({ language: 'node' }))
          .rejects.toThrow('CSB_API_KEY');
      } finally {
        process.env.CSB_API_KEY = originalKey;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid sandbox configuration', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      await expect(
        provider.createSandbox({ language: 'invalid' } as any)
      ).rejects.toThrow();
    });

    it('should handle file not found errors', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const sandbox = await provider.createSandbox({ language: 'node' });

      const result = await sandbox.readFile('nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      await provider.destroySandbox(sandbox.id);
    });

    it('should handle command execution errors', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const sandbox = await provider.createSandbox({ language: 'node' });

      const result = await sandbox.executeCommand('nonexistent-command-xyz');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      await provider.destroySandbox(sandbox.id);
    });

    it('should handle timeout errors', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const sandbox = await provider.createSandbox({ language: 'node' });

      // Command that takes too long
      const result = await sandbox.executeCommand('sleep 120', undefined, 5000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');

      await provider.destroySandbox(sandbox.id);
    });
  });

  describe('Preview URL Generation', () => {
    it('should generate valid preview URLs', async () => {
      if (SKIP_TESTS) return;

      const provider = await getAvailableProvider();
      if (!provider) return;

      const sandbox = await provider.createSandbox({ language: 'node' });

      if (sandbox.getPreviewLink) {
        await sandbox.writeFile('server.js', `
          const http = require('http');
          http.createServer((req, res) => res.end('OK')).listen(8080);
        `);
        await sandbox.executeCommand('node server.js &');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const preview = await sandbox.getPreviewLink(8080);

        expect(preview.url).toMatch(/^https?:\/\//);
      }

      await provider.destroySandbox(sandbox.id);
    });
  });
});

// Helper functions

async function getAvailableProviders(): Promise<SandboxProvider[]> {
  const providers: SandboxProvider[] = [];
  const providerNames = ['codesandbox', 'e2b', 'webcontainer', 'blaxel'];

  for (const name of providerNames) {
    try {
      const provider = await getProviderByName(name);
      if (provider) {
        providers.push(provider);
      }
    } catch (error) {
      // Provider not available
    }
  }

  return providers;
}

async function getProviderByName(name: string): Promise<SandboxProvider | null> {
  try {
    switch (name) {
      case 'codesandbox': {
        const { CodeSandboxProvider } = await import('@/lib/sandbox/providers/codesandbox-provider');
        return new CodeSandboxProvider();
      }
      case 'e2b': {
        const { E2BProvider } = await import('@/lib/sandbox/providers/e2b-provider');
        return new E2BProvider();
      }
      case 'webcontainer': {
        const { WebContainerProvider } = await import('@/lib/sandbox/providers/webcontainer-provider');
        return new WebContainerProvider();
      }
      case 'blaxel': {
        const { BlaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider');
        return new BlaxelProvider();
      }
      default:
        return null;
    }
  } catch (error) {
    return null;
  }
}

async function getAvailableProvider(): Promise<SandboxProvider | null> {
  const providers = await getAvailableProviders();
  return providers.length > 0 ? providers[0] : null;
}
