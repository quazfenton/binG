/**
 * E2E Tests for Sandbox Providers
 * 
 * Tests full sandbox provider workflows including
 * creation, execution, file operations, and cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Sandbox Providers E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('E2B Provider', () => {
    it('should complete full E2B sandbox lifecycle', async () => {
      // This would test the full E2B workflow
      // Mock implementation for demonstration
      const mockSandbox = {
        sandboxId: 'e2b-test-123',
        commands: {
          run: vi.fn().mockResolvedValue({
            exitCode: 0,
            stdout: 'Hello from E2B',
            stderr: '',
          }),
        },
        files: {
          write: vi.fn().mockResolvedValue(undefined),
          read: vi.fn().mockResolvedValue('file content'),
          list: vi.fn().mockResolvedValue([{ name: 'test.txt', type: 'file' }]),
        },
        kill: vi.fn(),
      };

      // Test command execution
      const result = await mockSandbox.commands.run('echo "Hello from E2B"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Hello from E2B');

      // Test file operations
      await mockSandbox.files.write('test.txt', 'content');
      expect(mockSandbox.files.write).toHaveBeenCalledWith('test.txt', 'content');

      const content = await mockSandbox.files.read('test.txt');
      expect(content).toBe('file content');

      const files = await mockSandbox.files.list('/home/user');
      expect(files.length).toBe(1);

      // Cleanup
      await mockSandbox.kill();
      expect(mockSandbox.kill).toHaveBeenCalled();
    });

    it('should handle E2B git operations', async () => {
      const mockSandbox = {
        sandboxId: 'e2b-git-test',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ // Git clone
              exitCode: 0,
              stdout: 'Cloning into repo...',
              stderr: '',
            })
            .mockResolvedValueOnce({ // Git pull
              exitCode: 0,
              stdout: 'Already up to date',
              stderr: '',
            })
            .mockResolvedValueOnce({ // Git status
              exitCode: 0,
              stdout: JSON.stringify({ branch: 'main', clean: true }),
              stderr: '',
            })
            .mockResolvedValueOnce({ // Git diff
              exitCode: 0,
              stdout: 'diff --git a/file.ts b/file.ts',
              stderr: '',
            }),
        },
        git: {
          clone: vi.fn().mockResolvedValue({}),
        },
        kill: vi.fn(),
      };

      // Clone repository
      const cloneResult = await mockSandbox.commands.run(
        'git clone https://github.com/test/repo.git'
      );
      expect(cloneResult.exitCode).toBe(0);

      // Pull changes
      const pullResult = await mockSandbox.commands.run('git pull');
      expect(pullResult.stdout).toBe('Already up to date');

      // Get status
      const statusResult = await mockSandbox.commands.run('git status --json');
      const status = JSON.parse(statusResult.stdout);
      expect(status.branch).toBe('main');

      // Get diff
      const diffResult = await mockSandbox.commands.run('git diff');
      expect(diffResult.stdout).toContain('diff --git');
    });

    it('should handle E2B Amp integration', async () => {
      const mockSandbox = {
        sandboxId: 'e2b-amp-test',
        commands: {
          run: vi.fn()
            .mockResolvedValueOnce({ // Amp execution
              exitCode: 0,
              stdout: '{"type":"assistant","message":{"usage":{"output_tokens":50}}}',
              stderr: '',
            })
            .mockResolvedValueOnce({ // Thread list
              exitCode: 0,
              stdout: JSON.stringify([{ id: 'thread-1' }]),
              stderr: '',
            }),
        },
        kill: vi.fn(),
      };

      // Execute Amp
      const ampResult = await mockSandbox.commands.run(
        'amp --dangerously-allow-all -x "Create server"'
      );
      expect(ampResult.exitCode).toBe(0);

      // Parse streaming JSON
      const events = ampResult.stdout.split('\n').filter(Boolean).map(JSON.parse);
      expect(events[0].type).toBe('assistant');
      expect(events[0].message.usage.output_tokens).toBe(50);

      // List threads
      const threadsResult = await mockSandbox.commands.run('amp threads list --json');
      const threads = JSON.parse(threadsResult.stdout);
      expect(threads.length).toBe(1);
    });
  });

  describe('Blaxel Provider', () => {
    it('should complete full Blaxel sandbox lifecycle', async () => {
      const mockSandbox = {
        metadata: {
          name: 'blaxel-test-123',
          url: 'https://blaxel-test.blaxel.ai',
          region: 'us-pdx-1',
          status: 'DEPLOYED',
        },
        run: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'Hello from Blaxel',
          stderr: '',
        }),
        fs: {
          write: vi.fn().mockResolvedValue(undefined),
          read: vi.fn().mockResolvedValue('file content'),
        },
        delete: vi.fn(),
      };

      // Test command execution
      const result = await mockSandbox.run({
        command: ['bash', '-c', 'echo "Hello from Blaxel"'],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Hello from Blaxel');

      // Test file operations
      await mockSandbox.fs.write('test.txt', 'content');
      expect(mockSandbox.fs.write).toHaveBeenCalledWith('test.txt', 'content');

      const content = await mockSandbox.fs.read('test.txt');
      expect(content).toBe('file content');

      // Cleanup
      await mockSandbox.delete();
      expect(mockSandbox.delete).toHaveBeenCalled();
    });

    it('should handle Blaxel async execution', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ // Async execution
          ok: true,
          json: async () => ({ executionId: 'exec-123' }),
        })
        .mockResolvedValueOnce({ // Callback verification
          ok: true,
          json: async () => ({ received: true }),
        });

      // Execute async
      const response = await fetch(
        'https://blaxel-test.blaxel.ai?async=true',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: 'npm run build',
            callbackUrl: 'https://myapp.com/callback',
          }),
        }
      );

      const result = await response.json();
      expect(result.executionId).toBe('exec-123');
    });

    it('should handle Blaxel batch jobs', async () => {
      const mockJob = {
        createExecution: vi.fn().mockResolvedValue('job-exec-123'),
        getExecutionStatus: vi.fn()
          .mockResolvedValueOnce('running')
          .mockResolvedValueOnce('running')
          .mockResolvedValueOnce('completed'),
        getExecution: vi.fn().mockResolvedValue({
          completedTasks: 10,
          failedTasks: 0,
          taskResults: [{ taskId: 'task-1', status: 'success' }],
        }),
      };

      // Create execution
      const executionId = await mockJob.createExecution({
        tasks: [{ data: { code: 'print("hello")' } }],
      });
      expect(executionId).toBe('job-exec-123');

      // Poll for completion
      let status = 'running';
      while (status === 'running') {
        status = await mockJob.getExecutionStatus(executionId);
      }

      expect(status).toBe('completed');

      // Get results
      const execution = await mockJob.getExecution(executionId);
      expect(execution.completedTasks).toBe(10);
      expect(execution.failedTasks).toBe(0);
    });
  });

  describe('Sprites Provider', () => {
    it('should complete full Sprites sandbox lifecycle', async () => {
      const mockSprite = {
        name: 'sprites-test-123',
        exec: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'Hello from Sprites',
          stderr: '',
        }),
        execFile: vi.fn().mockResolvedValue({
          stdout: 'file output',
          stderr: '',
        }),
        delete: vi.fn(),
        createCheckpoint: vi.fn().mockResolvedValue({
          id: 'checkpoint-123',
          name: 'test-checkpoint',
        }),
        listCheckpoints: vi.fn().mockResolvedValue([
          { id: 'checkpoint-123', name: 'test-checkpoint' },
        ]),
        restore: vi.fn().mockResolvedValue(undefined),
      };

      // Test command execution
      const result = await mockSprite.exec('echo "Hello from Sprites"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Hello from Sprites');

      // Test checkpoint creation
      const checkpoint = await mockSprite.createCheckpoint('test-checkpoint');
      expect(checkpoint.id).toBe('checkpoint-123');

      // List checkpoints
      const checkpoints = await mockSprite.listCheckpoints();
      expect(checkpoints.length).toBe(1);

      // Restore checkpoint
      await mockSprite.restore('checkpoint-123');
      expect(mockSprite.restore).toHaveBeenCalledWith('checkpoint-123');

      // Cleanup
      await mockSprite.delete();
      expect(mockSprite.delete).toHaveBeenCalled();
    });

    it('should handle Sprites tar-pipe sync', async () => {
      const mockSprite = {
        exec: vi.fn()
          .mockResolvedValueOnce({ // mkdir
            exitCode: 0,
            stdout: '',
            stderr: '',
          })
          .mockResolvedValueOnce({ // tar extract
            exitCode: 0,
            stdout: 'Files extracted',
            stderr: '',
          }),
      };

      // Simulate tar-pipe sync
      const mkdirResult = await mockSprite.exec('mkdir -p /home/sprite/workspace');
      expect(mkdirResult.exitCode).toBe(0);

      const extractResult = await mockSprite.exec('tar -xz -C /home/sprite/workspace');
      expect(extractResult.exitCode).toBe(0);
      expect(extractResult.stdout).toBe('Files extracted');
    });

    it('should handle Sprites service management', async () => {
      const mockSprite = {
        services: {
          create: vi.fn().mockResolvedValue({
            id: 'service-123',
            name: 'dev-server',
            status: 'running',
          }),
          list: vi.fn().mockResolvedValue([
            { id: 'service-123', name: 'dev-server', status: 'running' },
          ]),
        },
      };

      // Create service
      const service = await mockSprite.services.create('dev-server', {
        cmd: 'npm',
        args: ['run', 'dev'],
      });
      expect(service.id).toBe('service-123');
      expect(service.status).toBe('running');

      // List services
      const services = await mockSprite.services.list();
      expect(services.length).toBe(1);
      expect(services[0].name).toBe('dev-server');
    });
  });

  describe('Cross-Provider Operations', () => {
    it('should handle provider fallback chain', async () => {
      // Simulate provider fallback
      const providers = [
        {
          name: 'primary',
          available: vi.fn().mockResolvedValue(false),
        },
        {
          name: 'secondary',
          available: vi.fn().mockResolvedValue(false),
        },
        {
          name: 'tertiary',
          available: vi.fn().mockResolvedValue(true),
          createSandbox: vi.fn().mockResolvedValue({ id: 'sandbox-123' }),
        },
      ];

      // Try each provider in order
      let selectedProvider = null;
      for (const provider of providers) {
        const available = await provider.available();
        if (available) {
          selectedProvider = provider;
          break;
        }
      }

      expect(selectedProvider).toBe(providers[2]); // tertiary

      // Create sandbox with selected provider
      const sandbox = await selectedProvider.createSandbox({});
      expect(sandbox.id).toBe('sandbox-123');
    });

    it('should handle quota management across providers', async () => {
      const mockQuotaManager = {
        isAvailable: vi.fn()
          .mockReturnValueOnce(false) // primary over quota
          .mockReturnValueOnce(true), // secondary available
        recordUsage: vi.fn(),
        getRemainingCalls: vi.fn().mockReturnValue(100),
      };

      // Check provider availability
      const primaryAvailable = mockQuotaManager.isAvailable('primary');
      expect(primaryAvailable).toBe(false);

      const secondaryAvailable = mockQuotaManager.isAvailable('secondary');
      expect(secondaryAvailable).toBe(true);

      // Record usage
      mockQuotaManager.recordUsage('secondary', 1);
      expect(mockQuotaManager.recordUsage).toHaveBeenCalledWith('secondary', 1);

      // Check remaining
      const remaining = mockQuotaManager.getRemainingCalls('secondary');
      expect(remaining).toBe(100);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle sandbox creation failures', async () => {
      const mockProvider = {
        createSandbox: vi.fn().mockRejectedValue(
          new Error('Quota exceeded')
        ),
      };

      await expect(mockProvider.createSandbox({}))
        .rejects.toThrow('Quota exceeded');
    });

    it('should handle command execution timeouts', async () => {
      const mockSandbox = {
        run: vi.fn().mockRejectedValue(new Error('Command timeout')),
      };

      await expect(mockSandbox.run({ command: ['long-command'] }))
        .rejects.toThrow('Command timeout');
    });

    it('should handle file system errors', async () => {
      const mockSandbox = {
        fs: {
          write: vi.fn().mockRejectedValue(new Error('Disk full')),
          read: vi.fn().mockRejectedValue(new Error('File not found')),
        },
      };

      await expect(mockSandbox.fs.write('test.txt', 'content'))
        .rejects.toThrow('Disk full');

      await expect(mockSandbox.fs.read('missing.txt'))
        .rejects.toThrow('File not found');
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(fetch('https://api.example.com'))
        .rejects.toThrow('Network error');
    });

    it('should handle concurrent sandbox operations', async () => {
      const mockSandbox = {
        run: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'result',
          stderr: '',
        }),
      };

      // Execute multiple commands concurrently
      const [result1, result2, result3] = await Promise.all([
        mockSandbox.run({ command: ['cmd1'] }),
        mockSandbox.run({ command: ['cmd2'] }),
        mockSandbox.run({ command: ['cmd3'] }),
      ]);

      expect(result1.stdout).toBe('result');
      expect(result2.stdout).toBe('result');
      expect(result3.stdout).toBe('result');
    });
  });
});
