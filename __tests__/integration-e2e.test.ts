/**
 * Comprehensive E2E Integration Tests
 * 
 * Tests full integration workflows across multiple modules
 * including E2B Amp, Smithery, Composio, and MCP client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAmpService, executeAmpTask } from '../lib/sandbox/providers/e2b-amp-service';
import { createSmitheryClient } from '../lib/mcp/smithery-registry';
import { createComposioTriggersService } from '../lib/tools/composio-triggers';
import { MCPClient } from '../lib/mcp/client';
import { 
  MCPError, 
  MCPConnectionError, 
  MCPTimeoutError, 
  MCPProtocolError,
  MCPResourceError 
} from '../lib/mcp/types';

// Mock implementations for external dependencies
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

describe('E2E Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AMP_API_KEY', 'test-amp-key');
    vi.stubEnv('SMITHERY_API_KEY', 'test-smithery-key');
    vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
    vi.stubEnv('COMPOSIO_WEBHOOK_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('E2B Amp Full Workflow', () => {
    it('should complete full Amp workflow with git integration', async () => {
      // Mock sandbox
      const mockSandbox = {
        sandboxId: 'test-sandbox-123',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ // Amp execution
              exitCode: 0,
              stdout: '{"type":"assistant","message":{"usage":{"output_tokens":100}}}\n{"type":"result","message":{"subtype":"success"}}',
              stderr: '',
            })
            .mockResolvedValueOnce({ // Thread list
              exitCode: 0,
              stdout: JSON.stringify([{ id: 'thread-1', created_at: Date.now() }]),
              stderr: '',
            })
            .mockResolvedValueOnce({ // Git diff
              exitCode: 0,
              stdout: 'diff --git a/file.ts b/file.ts\nindex 123..456',
              stderr: '',
            }),
        },
        kill: vi.fn(),
        git: {
          clone: vi.fn().mockResolvedValue({}),
        },
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');

      // Execute Amp task
      const result = await amp.execute({
        prompt: 'Create a hello world server',
        dangerouslyAllowAll: true,
        streamJson: true,
      });

      expect(result.stdout).toContain('assistant');
      expect(result.usage?.outputTokens).toBe(100);

      // List threads
      const threads = await amp.threads.list();
      expect(threads.length).toBe(1);

      // Continue thread
      const continued = await amp.threads.continue(threads[0].id, 'Next step');
      expect(continued).toBeDefined();

      // Get git diff
      const diff = await amp.git.diff();
      expect(diff).toContain('diff --git');
    });

    it('should handle Amp execution with errors', async () => {
      const mockSandbox = {
        sandboxId: 'test-sandbox',
        commands: {
          run: vi.fn().mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'Error: Task failed',
          }),
        },
        kill: vi.fn(),
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');
      const result = await amp.execute({
        prompt: 'Failing task',
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Error: Task failed');
    });

    it('should handle Amp timeout', async () => {
      const mockSandbox = {
        sandboxId: 'test-sandbox',
        commands: {
          run: vi.fn().mockRejectedValue(new Error('Command timeout')),
        },
        kill: vi.fn(),
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');
      const result = await amp.execute({
        prompt: 'Long task',
        timeout: 1000,
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('timeout');
    });
  });

  describe('Smithery Full Workflow', () => {
    it('should discover, connect, and use MCP server', async () => {
      // Mock fetch for all Smithery API calls
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ // Search servers
          ok: true,
          json: async () => ({
            servers: [{
              qualifiedName: 'github/mcp-server',
              name: 'GitHub MCP',
              mcpUrl: 'https://github-mcp.example.com',
            }],
            total: 1,
            page: 1,
            pageSize: 10,
            hasMore: false,
          }),
        })
        .mockResolvedValueOnce({ // Get server details
          ok: true,
          json: async () => ({
            qualifiedName: 'github/mcp-server',
            name: 'GitHub MCP',
            description: 'GitHub integration',
            mcpUrl: 'https://github-mcp.example.com',
          }),
        })
        .mockResolvedValueOnce({ // Create connection
          ok: true,
          json: async () => ({
            id: 'conn-123',
            namespace: 'test',
            mcpUrl: 'https://github-mcp.example.com',
            status: 'active',
          }),
        })
        .mockResolvedValueOnce({ // Poll events
          ok: true,
          json: async () => ({
            events: [{ type: 'tool_call', data: {} }],
            done: false,
          }),
        })
        .mockResolvedValueOnce({ // Download bundle
          ok: true,
          blob: async () => new Blob(['bundle data'], { type: 'application/octet-stream' }),
        });

      const client = createSmitheryClient();

      // Step 1: Search for servers
      const searchResults = await client.searchServers({ q: 'github' });
      expect(searchResults.servers.length).toBe(1);
      expect(searchResults.servers[0].qualifiedName).toBe('github/mcp-server');

      // Step 2: Get server details
      const server = await client.getServer('github/mcp-server');
      expect(server.mcpUrl).toBe('https://github-mcp.example.com');

      // Step 3: Create connection
      const connection = await client.createConnection('test', {
        mcpUrl: server.mcpUrl,
      });
      expect(connection.id).toBe('conn-123');
      expect(connection.status).toBe('active');

      // Step 4: Poll for events
      const events = await client.pollEvents('test', 'conn-123');
      expect(events.events.length).toBe(1);
      expect(events.done).toBe(false);

      // Step 5: Download bundle
      const bundle = await client.downloadBundle('github/mcp-server');
      expect(bundle).toBeInstanceOf(Blob);
      expect(bundle.size).toBeGreaterThan(0);
    });

    it('should handle Smithery connection errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      });

      const client = createSmitheryClient();

      await expect(client.searchServers({ q: 'test' }))
        .rejects.toThrow('Smithery search failed');
    });

    it('should handle pagination', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            servers: Array(20).fill({ qualifiedName: 'server-1' }),
            total: 50,
            page: 1,
            pageSize: 20,
            hasMore: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            servers: Array(20).fill({ qualifiedName: 'server-2' }),
            total: 50,
            page: 2,
            pageSize: 20,
            hasMore: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            servers: Array(10).fill({ qualifiedName: 'server-3' }),
            total: 50,
            page: 3,
            pageSize: 20,
            hasMore: false,
          }),
        });

      const client = createSmitheryClient();

      // Get all pages
      let page = 1;
      let totalServers = 0;
      let hasMore = true;

      while (hasMore) {
        const results = await client.searchServers({ page, pageSize: 20 });
        totalServers += results.servers.length;
        hasMore = results.hasMore;
        page++;
      }

      expect(totalServers).toBe(50);
      expect(page).toBe(4); // 3 pages + 1
    });
  });

  describe('Composio Triggers Full Workflow', () => {
    it('should complete full trigger lifecycle', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ // List triggers
          ok: true,
          json: async () => ([
            { name: 'github-issue', toolkit: 'github' },
          ]),
        })
        .mockResolvedValueOnce({ // Create trigger
          ok: true,
          json: async () => ({
            id: 'trigger-123',
            name: 'github-issue',
            toolkit: 'github',
            status: 'enabled',
          }),
        })
        .mockResolvedValueOnce({ // Get trigger
          ok: true,
          json: async () => ({
            id: 'trigger-123',
            name: 'github-issue',
            status: 'enabled',
            triggerCount: 0,
          }),
        })
        .mockResolvedValueOnce({ // List executions
          ok: true,
          json: async () => ([]),
        })
        .mockResolvedValueOnce({ // Get stats
          ok: true,
          json: async () => ({
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageDurationMs: 0,
          }),
        });

      const triggers = createComposioTriggersService();

      // Step 1: List available triggers
      const available = await triggers.listAvailableTriggers({ toolkit: 'github' });
      expect(available.length).toBe(1);

      // Step 2: Create trigger
      const trigger = await triggers.createTrigger({
        name: 'github-issue',
        toolkit: 'github',
        config: { repo: 'myorg/myrepo' },
      });
      expect(trigger.id).toBe('trigger-123');
      expect(trigger.status).toBe('enabled');

      // Step 3: Get trigger details
      const details = await triggers.getTrigger('trigger-123');
      expect(details.id).toBe('trigger-123');

      // Step 4: List executions (should be empty)
      const executions = await triggers.listExecutions('trigger-123');
      expect(executions.length).toBe(0);

      // Step 5: Get stats
      const stats = await triggers.getStats('trigger-123');
      expect(stats.totalExecutions).toBe(0);

      // Step 6: Deactivate trigger
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'trigger-123', status: 'disabled' }),
      });
      const deactivated = await triggers.deactivateTrigger('trigger-123');
      expect(deactivated.status).toBe('disabled');

      // Step 7: Delete trigger
      global.fetch.mockResolvedValueOnce({ ok: true });
      await triggers.deleteTrigger('trigger-123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/triggers/trigger-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle webhook with signature verification', async () => {
      const crypto = await import('node:crypto');
      const secret = 'test-secret';
      const payload = {
        trigger_id: 'trigger-123',
        trigger_name: 'github-issue',
        toolkit: 'github',
        payload: { issue: { number: 1 } },
      };

      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const triggers = createComposioTriggersService();
      const event = await triggers.handleWebhook(payload, {
        'x-composio-signature': signature,
      });

      expect(event).not.toBeNull();
      expect(event?.triggerId).toBe('trigger-123');
      expect(event?.payload).toEqual({ issue: { number: 1 } });
    });

    it('should reject invalid webhook signature', async () => {
      const triggers = createComposioTriggersService();

      await expect(
        triggers.handleWebhook(
          { trigger_id: 'trigger-123' },
          { 'x-composio-signature': 'invalid' }
        )
      ).rejects.toThrow('Invalid webhook signature');
    });

    it('should subscribe to trigger events', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 'exec-1', status: 'success', startedAt: '2024-01-01', input: {} },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 'exec-2', status: 'success', startedAt: '2024-01-02', input: {} },
          ]),
        });

      const triggers = createComposioTriggersService();
      const callback = vi.fn();

      const unsubscribe = await triggers.subscribe('trigger-123', callback, {
        pollIntervalMs: 50,
      });

      // Wait for polls
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(callback).toHaveBeenCalled();

      unsubscribe();
    });
  });

  describe('MCP Client Full Workflow', () => {
    it('should complete full MCP client workflow with error handling', async () => {
      // Mock child process
      const mockProcess = {
        stdin: { write: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'spawn') cb();
        }),
        kill: vi.fn(),
      };

      vi.mock('node:child_process', () => ({
        spawn: vi.fn().mockReturnValue(mockProcess),
      }));

      const client = new MCPClient({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-test'],
      });

      // Connect
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Subscribe to resource
      await client.subscribeResource('file:///test.json');
      expect(client.isSubscribedToResource('file:///test.json')).toBe(true);

      // Get subscribed resources
      const subscribed = client.getSubscribedResources();
      expect(subscribed.length).toBe(1);

      // Send progress (valid)
      await client.sendProgress('token-123', 50, 100);

      // Send progress (invalid - should throw)
      await expect(client.sendProgress('token-123', 150, 100))
        .rejects.toThrow(MCPProtocolError);

      // Set log level
      await client.setLogLevel('debug');

      // Cancel request
      await client.cancelRequest('request-123');

      // Unsubscribe
      await client.unsubscribeResource('file:///test.json');
      expect(client.isSubscribedToResource('file:///test.json')).toBe(false);

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle MCP connection errors', async () => {
      vi.mock('node:child_process', () => ({
        spawn: vi.fn().mockImplementation(() => {
          throw new Error('Command not found');
        }),
      }));

      const client = new MCPClient({
        type: 'stdio',
        command: 'invalid-command',
      });

      await expect(client.connect())
        .rejects.toThrow(MCPConnectionError);
    });

    it('should handle MCP timeout errors', async () => {
      const mockProcess = {
        stdin: { write: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      vi.mock('node:child_process', () => ({
        spawn: vi.fn().mockReturnValue(mockProcess),
      }));

      const client = new MCPClient({
        type: 'stdio',
        command: 'test',
      });

      await client.connect();

      // Mock request that times out
      vi.spyOn(client as any, 'sendRequest').mockImplementation(() => {
        // Never respond - will timeout
      });

      await expect(
        (client as any).request('test_method', {}, 100)
      ).rejects.toThrow(MCPTimeoutError);
    });

    it('should handle resource subscription errors', async () => {
      const mockProcess = {
        stdin: { write: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'spawn') cb();
        }),
        kill: vi.fn(),
      };

      vi.mock('node:child_process', () => ({
        spawn: vi.fn().mockReturnValue(mockProcess),
      }));

      const client = new MCPClient({
        type: 'stdio',
        command: 'test',
      });

      await client.connect();

      // Mock failed request
      vi.spyOn(client as any, 'request').mockRejectedValue(
        new Error('Subscription failed')
      );

      await expect(client.subscribeResource('file:///invalid.json'))
        .rejects.toThrow(MCPResourceError);
    });
  });

  describe('Cross-Module Integration', () => {
    it('should work with E2B Amp + Git + MCP together', async () => {
      // This tests the integration between multiple modules
      const mockSandbox = {
        sandboxId: 'test-sandbox',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ // Amp execution
              exitCode: 0,
              stdout: 'Task complete',
              stderr: '',
            })
            .mockResolvedValueOnce({ // Git status
              exitCode: 0,
              stdout: JSON.stringify({ branch: 'main' }),
              stderr: '',
            }),
        },
        kill: vi.fn(),
        git: {
          clone: vi.fn().mockResolvedValue({}),
        },
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');

      // Execute Amp task
      const ampResult = await amp.execute({
        prompt: 'Add feature',
        dangerouslyAllowAll: true,
      });
      expect(ampResult.stdout).toBe('Task complete');

      // Git operations
      const gitStatus = await amp.git.status();
      expect(gitStatus.status).toBeDefined();
    });

    it('should handle Smithery + Composio integration', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ // Smithery search
          ok: true,
          json: async () => ({
            servers: [{ qualifiedName: 'composio/mcp-server' }],
            total: 1,
            page: 1,
            pageSize: 10,
            hasMore: false,
          }),
        })
        .mockResolvedValueOnce({ // Composio triggers
          ok: true,
          json: async () => ([{ name: 'github-issue' }]),
        });

      // Smithery discovery
      const smithery = createSmitheryClient();
      const servers = await smithery.searchServers({ q: 'composio' });
      expect(servers.servers.length).toBe(1);

      // Composio triggers
      const triggers = createComposioTriggersService();
      const available = await triggers.listAvailableTriggers();
      expect(available.length).toBe(1);
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle concurrent Amp executions', async () => {
      const mockSandbox = {
        sandboxId: 'test-sandbox',
        commands: {
          run: vi.fn().mockResolvedValue({
            exitCode: 0,
            stdout: 'Result',
            stderr: '',
          }),
        },
        kill: vi.fn(),
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');

      // Execute multiple tasks concurrently
      const [result1, result2, result3] = await Promise.all([
        amp.execute({ prompt: 'Task 1' }),
        amp.execute({ prompt: 'Task 2' }),
        amp.execute({ prompt: 'Task 3' }),
      ]);

      expect(result1.stdout).toBe('Result');
      expect(result2.stdout).toBe('Result');
      expect(result3.stdout).toBe('Result');
    });

    it('should handle network failures gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const smithery = createSmitheryClient();
      const triggers = createComposioTriggersService();

      await expect(smithery.searchServers({ q: 'test' }))
        .rejects.toThrow();

      await expect(triggers.listAvailableTriggers())
        .rejects.toThrow();
    });

    it('should handle empty responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
      });

      const smithery = createSmitheryClient();
      const results = await smithery.searchServers({ q: 'nonexistent' });

      expect(results.servers.length).toBe(0);
      expect(results.total).toBe(0);
    });

    it('should handle rate limiting', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ servers: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
        });

      const smithery = createSmitheryClient();

      // First request fails with 429
      await expect(smithery.searchServers({ q: 'test' }))
        .rejects.toThrow('Smithery search failed');

      // Second request succeeds
      const results = await smithery.searchServers({ q: 'test' });
      expect(results).toBeDefined();
    });
  });
});
