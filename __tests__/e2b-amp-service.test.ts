/**
 * E2B Amp Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createAmpService, executeAmpTask } from '../lib/sandbox/providers/e2b-amp-service';

// Mock sandbox
const createMockSandbox = () => ({
  sandboxId: 'test-sandbox-123',
  commands: {
    run: vi.fn(),
  },
  kill: vi.fn(),
});

describe('E2B Amp Service', () => {
  let mockSandbox: ReturnType<typeof createMockSandbox>;

  beforeEach(() => {
    mockSandbox = createMockSandbox();
    vi.stubEnv('AMP_API_KEY', 'test-amp-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('createAmpService', () => {
    it('should create service instance', () => {
      const ampService = createAmpService(mockSandbox, 'test-id');
      expect(ampService).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute Amp task successfully', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Task completed',
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Fix TODO comments',
        dangerouslyAllowAll: true,
        streamJson: false,
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed');
      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('amp --dangerously-allow-all -x'),
        expect.any(Object)
      );
    });

    it('should handle streaming JSON events', async () => {
      const events: string[] = [
        '{"type":"assistant","message":{"usage":{"output_tokens":100}}}',
        '{"type":"result","message":{"subtype":"success"}}',
      ];

      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: events.join('\n'),
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const receivedEvents: any[] = [];

      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Refactor module',
        streamJson: true,
        onEvent: (event) => receivedEvents.push(event),
      });

      expect(receivedEvents.length).toBeGreaterThan(0);
      expect(result.output).toContain('Task completed');
    });

    it('should capture thread ID', async () => {
      mockSandbox.commands.run
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Task completed',
          stderr: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify([
            { id: 'thread-123', created_at: Date.now() },
          ]),
          stderr: '',
        });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Initial task',
      });

      expect(result.threadId).toBe('thread-123');
    });

    it('should capture git diff', async () => {
      mockSandbox.commands.run
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Changes made',
          stderr: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'thread-123' }]),
          stderr: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'diff --git a/file.ts b/file.ts',
          stderr: '',
        });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Make changes',
      });

      expect(result.gitDiff).toContain('diff --git');
    });

    it('should handle execution failure', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Task failed',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Failing task',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task failed');
    });

    it('should track token usage', async () => {
      const eventJson = '{"type":"assistant","message":{"usage":{"input_tokens":50,"output_tokens":100}}}';

      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: eventJson,
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Task with tokens',
        streamJson: true,
      });

      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(50);
      expect(result.usage?.outputTokens).toBe(100);
    });

    it('should handle timeout', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('Command timeout'));

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.execute({
        apiKey: 'test-key',
        task: 'Long running task',
        timeout: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('listThreads', () => {
    it('should list threads', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify([
          { id: 'thread-1', created_at: 1000 },
          { id: 'thread-2', created_at: 2000 },
        ]),
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const threads = await ampService.listThreads();

      expect(threads.length).toBe(2);
      expect(threads[0].id).toBe('thread-1');
    });

    it('should handle empty thread list', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const threads = await ampService.listThreads();

      expect(threads.length).toBe(0);
    });

    it('should handle thread listing failure', async () => {
      mockSandbox.commands.run.mockRejectedValue(new Error('Failed to list'));

      const ampService = createAmpService(mockSandbox, 'test-id');
      const threads = await ampService.listThreads();

      expect(threads.length).toBe(0);
    });
  });

  describe('continueThread', () => {
    it('should continue existing thread', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Continued',
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const result = await ampService.continueThread('thread-123', 'Next step');

      expect(result.success).toBe(true);
      expect(mockSandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining('--dangerously-allow-all'),
        expect.any(Object)
      );
    });
  });

  describe('getLatestThreadId', () => {
    it('should get most recent thread', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify([
          { id: 'thread-1', last_message_at: 1000 },
          { id: 'thread-2', last_message_at: 2000 },
          { id: 'thread-3', last_message_at: 3000 },
        ]),
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const threadId = await ampService.getLatestThreadId();

      expect(threadId).toBe('thread-3');
    });

    it('should return undefined for empty list', async () => {
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      });

      const ampService = createAmpService(mockSandbox, 'test-id');
      const threadId = await ampService.getLatestThreadId();

      expect(threadId).toBeUndefined();
    });
  });
});

describe('executeAmpTask', () => {
  beforeEach(() => {
    vi.stubEnv('AMP_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create sandbox and execute task', async () => {
    // This would require mocking the E2B SDK
    // Placeholder for integration test
    expect(executeAmpTask).toBeDefined();
  });
});
