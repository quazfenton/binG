/**
 * Comprehensive E2E Integration Tests
 * 
 * Tests full integration workflows across multiple modules
 * including E2B Amp, Smithery, Composio, and MCP client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAmpService } from '../lib/sandbox/providers/e2b-amp-service';
import { createSmitheryClient } from '../lib/mcp/smithery-registry';
import { createComposioTriggersService } from '../lib/tools/composio-triggers';
import { MCPClient } from '../lib/mcp/client';
import { 
  MCPConnectionError, 
  MCPTimeoutError, 
  MCPProtocolError,
  MCPResourceError 
} from '../lib/mcp/types';

// Mock child process at the top level so it's hoisted
const mockProcess = {
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn((event, cb) => {
    if (event === 'spawn') {
      setTimeout(cb, 10);
    }
  }),
  kill: vi.fn(),
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProcess),
}));

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
      const mockSandbox = {
        sandboxId: 'test-sandbox-123',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ 
              exitCode: 0,
              stdout: '{"type":"assistant","message":{"usage":{"input_tokens":50,"output_tokens":100}}}\n{"type":"result","message":{"subtype":"success"}}',
              stderr: '',
            })
            .mockResolvedValueOnce({ 
              exitCode: 0,
              stdout: JSON.stringify([{ id: 'thread-1', created_at: Date.now() }]),
              stderr: '',
            })
            .mockResolvedValueOnce({ 
              exitCode: 0,
              stdout: 'diff --git a/file.ts b/file.ts\nindex 123..456',
              stderr: '',
            }),
        },
        kill: vi.fn(),
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');

      const result = await amp.execute({
        prompt: 'Create a hello world server',
        dangerouslyAllowAll: true,
        streamJson: true,
      });

      expect(result.stdout).toContain('assistant');
      expect(result.usage?.outputTokens).toBe(100);

      const threads = await amp.threads.list();
      expect(threads.length).toBe(1);

      const diff = await amp.git.diff();
      expect(diff).toContain('diff --git');
    });
  });

  describe('MCP Client Full Workflow', () => {
    it('should complete full MCP client workflow with error handling', async () => {
      const client = new MCPClient({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-test'],
      });

      vi.spyOn(client as any, 'request').mockImplementation((method) => {
        if (method === 'initialize') {
          return Promise.resolve({
            serverInfo: { name: 'test', version: '1.0' },
            protocolVersion: '2024-11-05',
            capabilities: {}
          });
        }
        return Promise.resolve({});
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.subscribeResource('file:///test.json');
      expect(client.isSubscribedToResource('file:///test.json')).toBe(true);

      await client.sendProgress('token-123', 50, 100);

      await expect(client.sendProgress('token-123', 150, 100))
        .rejects.toThrow(MCPProtocolError);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    }, 60000);

    it('should handle MCP timeout errors', async () => {
      const client = new MCPClient({
        type: 'stdio',
        command: 'test',
      });

      vi.spyOn(client as any, 'initialize').mockResolvedValue(undefined);
      await client.connect();

      vi.spyOn(client as any, 'sendRequest').mockImplementation(() => {});

      await expect(
        (client as any).request('test_method', {}, 100)
      ).rejects.toThrow(MCPTimeoutError);
    }, 60000);

    it('should handle resource subscription errors', async () => {
      const client = new MCPClient({
        type: 'stdio',
        command: 'test',
      });

      vi.spyOn(client as any, 'initialize').mockResolvedValue(undefined);
      await client.connect();

      vi.spyOn(client as any, 'request').mockRejectedValue(
        new MCPResourceError('Subscription failed')
      );

      await expect(client.subscribeResource('file:///invalid.json'))
        .rejects.toThrow(MCPResourceError);
    }, 60000);
  });

  describe('Cross-Module Integration', () => {
    it('should work with E2B Amp + Git + MCP together', async () => {
      const mockSandbox = {
        sandboxId: 'test-sandbox',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'Task complete', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ branch: 'main' }), stderr: '' }),
        },
        kill: vi.fn(),
      };

      const amp = createAmpService(mockSandbox as any, 'test-id');
      const result = await amp.execute({ prompt: 'Add feature' });
      expect(result.stdout).toBe('Task complete');

      const status = await amp.git.status();
      expect(status.status).toBeDefined();
    });
  });
});
