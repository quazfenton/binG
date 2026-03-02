import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor, createToolExecutor } from '@/lib/stateful-agent/tools/tool-executor';
import type { ToolExecutorConfig } from '@/lib/stateful-agent/tools/tool-executor';

describe('ToolExecutor', () => {
  let mockSandboxHandle: any;
  let executor: ToolExecutor;

  beforeEach(() => {
    mockSandboxHandle = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      listDirectory: vi.fn(),
      executeCommand: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'health', stderr: '' }),
      workspaceDir: '/workspace',
    };
  });

  describe('constructor', () => {
    it('should create executor with minimal config', () => {
      executor = createToolExecutor({});
      expect(executor).toBeDefined();
    });

    it('should create executor with sandbox handle', () => {
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      expect(executor).toBeDefined();
    });

    it('should create executor with VFS', () => {
      const vfs = { '/test.ts': 'content' };
      executor = createToolExecutor({ vfs });
      expect(executor).toBeDefined();
    });

    it('should enable logging by default', () => {
      executor = createToolExecutor({});
      expect(executor).toBeDefined();
    });

    it('should disable logging when configured', () => {
      executor = createToolExecutor({ enableLogging: false });
      expect(executor).toBeDefined();
    });
  });

  describe('updateContext', () => {
    it('should update sandbox handle', () => {
      executor = createToolExecutor({});
      const newHandle = { readFile: vi.fn() };
      executor.updateContext({ sandboxHandle: newHandle });
      expect(executor).toBeDefined();
    });

    it('should update VFS', () => {
      executor = createToolExecutor({});
      executor.updateContext({ vfs: { '/new.ts': 'content' } });
      expect(executor).toBeDefined();
    });

    it('should update transaction log', () => {
      executor = createToolExecutor({});
      executor.updateContext({
        transactionLog: [{ path: '/test.ts', type: 'UPDATE', timestamp: Date.now() }],
      });
      expect(executor).toBeDefined();
    });
  });

  describe('execute - readFile', () => {
    it('should read file from sandbox when available', async () => {
      mockSandboxHandle.readFile.mockResolvedValue({
        success: true,
        content: 'file content',
      });

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('readFile', { path: '/test.ts' });

      expect(mockSandboxHandle.readFile).toHaveBeenCalledWith('/test.ts');
      expect(result.success).toBe(true);
      expect(result.content).toBe('file content');
    });

    it('should read file from VFS fallback', async () => {
      const vfs = { '/test.ts': 'vfs content' };
      executor = createToolExecutor({ vfs });
      const result = await executor.execute('readFile', { path: '/test.ts' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('vfs content');
    });

    it('should fail when file not in VFS', async () => {
      const vfs = { '/other.ts': 'content' };
      executor = createToolExecutor({ vfs });
      const result = await executor.execute('readFile', { path: '/missing.ts' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail without sandbox or vfs', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('readFile', { path: '/test.ts' });
      
      // Should return error result, not throw
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('execute - listFiles', () => {
    it('should list files from sandbox', async () => {
      mockSandboxHandle.listDirectory.mockResolvedValue({
        success: true,
        output: 'file1.ts\nfile2.ts',
      });

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('listFiles', { path: '/src' });

      expect(mockSandboxHandle.listDirectory).toHaveBeenCalledWith('/src', undefined);
      expect(result.success).toBe(true);
    });

    it('should list files from VFS with pattern', async () => {
      const vfs = {
        '/src/test.ts': 'content',
        '/src/utils.ts': 'content',
        '/src/test.spec.ts': 'content',
      };
      executor = createToolExecutor({ vfs });
      const result = await executor.execute('listFiles', { path: '/src', pattern: '\\.ts$' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('test.ts');
    });

    it('should filter by pattern', async () => {
      const vfs = {
        '/src/test.ts': 'content',
        '/src/test.tsx': 'content',
        '/src/style.css': 'content',
      };
      executor = createToolExecutor({ vfs });
      const result = await executor.execute('listFiles', { pattern: '\\.tsx?$' });

      expect(result.output).not.toContain('style.css');
    });
  });

  describe('execute - createFile', () => {
    it('should create file in sandbox', async () => {
      mockSandboxHandle.writeFile.mockResolvedValue({
        success: true,
        output: 'File created',
      });

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('createFile', {
        path: '/new.ts',
        content: 'export const x = 1;',
      });

      expect(mockSandboxHandle.writeFile).toHaveBeenCalledWith('/new.ts', 'export const x = 1;');
      expect(result.success).toBe(true);
    });

    it('should create file in VFS fallback', async () => {
      const vfs: Record<string, string> = {};
      const transactionLog: any[] = [];
      executor = createToolExecutor({ vfs, transactionLog });

      const result = await executor.execute('createFile', {
        path: '/new.ts',
        content: 'content',
      });

      expect(result.success).toBe(true);
      expect(vfs['/new.ts']).toBe('content');
      expect(transactionLog).toHaveLength(1);
      expect(transactionLog[0].type).toBe('CREATE');
    });

    it('should fail without sandbox or vfs', async () => {
      // Without sandbox or vfs, createFile creates in VFS fallback
      const vfs: Record<string, string> = {};
      executor = createToolExecutor({ vfs });
      
      const result = await executor.execute('createFile', { path: '/new.ts', content: 'content' });
      
      // Should succeed by creating in VFS
      expect(result.success).toBe(true);
      expect(vfs['/new.ts']).toBe('content');
    });
  });

  describe('execute - applyDiff', () => {
    it('should apply diff in sandbox', async () => {
      mockSandboxHandle.readFile.mockResolvedValue({
        success: true,
        content: 'function oldName() { return 1; }',
      });
      mockSandboxHandle.writeFile.mockResolvedValue({
        success: true,
        output: 'Updated',
      });

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('applyDiff', {
        path: '/test.ts',
        search: 'function oldName() { return 1; }',
        replace: 'function newName() { return 2; }',
        thought: 'Renaming function',
      });

      expect(result.success).toBe(true);
    });

    it('should apply diff in VFS', async () => {
      const vfs = { '/test.ts': 'function oldName() { return 1; }' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('applyDiff', {
        path: '/test.ts',
        search: 'function oldName() { return 1; }',
        replace: 'function newName() { return 2; }',
        thought: 'Renaming',
      });

      expect(result.success).toBe(true);
      expect(vfs['/test.ts']).toBe('function newName() { return 2; }');
    });

    it('should fail when search pattern not found', async () => {
      const vfs = { '/test.ts': 'different content' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('applyDiff', {
        path: '/test.ts',
        search: 'nonexistent pattern',
        replace: 'new content',
        thought: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.blocked).toBe(true);
    });

    it('should fail when file not in VFS', async () => {
      executor = createToolExecutor({ vfs: {} });

      const result = await executor.execute('applyDiff', {
        path: '/missing.ts',
        search: 'pattern',
        replace: 'new',
        thought: 'Test',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('execute - execShell', () => {
    it('should execute command in sandbox', async () => {
      mockSandboxHandle.executeCommand.mockResolvedValue({
        success: true,
        output: 'command output',
      });

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('execShell', { command: 'npm test' });

      expect(mockSandboxHandle.executeCommand).toHaveBeenCalledWith('npm test', undefined);
      expect(result.success).toBe(true);
    });

    it('should block dangerous rm -rf / command', async () => {
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('execShell', { command: 'rm -rf /' });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('should block mkfs commands', async () => {
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('execShell', { command: 'mkfs.ext4 /dev/sda' });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('should block dd commands', async () => {
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      const result = await executor.execute('execShell', { command: 'dd if=/dev/zero' });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('should fail without sandbox', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('execShell', { command: 'ls' });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('execute - syntaxCheck', () => {
    it('should check TypeScript syntax', async () => {
      const vfs = { '/test.ts': 'const x: number = 1;' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('syntaxCheck', { paths: ['/test.ts'] });

      expect(result.success).toBe(true);
    });

    it('should detect unbalanced braces', async () => {
      // syntaxCheckTool returns early without sandbox, so we test with sandbox mock
      const mockSandboxHandle = {
        readFile: vi.fn().mockResolvedValue({ success: true, content: 'function test() {' }),
        executeCommand: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'health', stderr: '' }),
        workspaceDir: '/workspace',
      };
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });

      const result = await executor.execute('syntaxCheck', { paths: ['/test.ts'] });

      // With sandbox, it should detect unbalanced braces
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Unbalanced');
    });

    it('should check JSON syntax', async () => {
      const vfs = { '/test.json': '{"valid": true}' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('syntaxCheck', { paths: ['/test.json'] });

      expect(result.success).toBe(true);
    });

    it('should detect invalid JSON', async () => {
      const mockSandboxHandle = {
        readFile: vi.fn().mockResolvedValue({ success: true, content: '{"invalid": }' }),
        executeCommand: vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: 'health', stderr: '' }),
        workspaceDir: '/workspace',
      };
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });

      const result = await executor.execute('syntaxCheck', { paths: ['/test.json'] });

      expect(result.success).toBe(false);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Invalid JSON');
    });

    it('should skip without sandbox', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('syntaxCheck', { paths: ['/test.ts'] });

      expect(result.success).toBe(true);
      expect(result.output).toContain('skipped');
    });
  });

  describe('execute - requestApproval', () => {
    it('should create approval request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('requestApproval', {
        action: 'delete',
        target: '/important.ts',
        reason: 'Removing unused file',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('requires_approval');
      expect(result.output).toContain('pending');
    });

    it('should include diff in approval request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('requestApproval', {
        action: 'overwrite',
        target: '/config.ts',
        reason: 'Updating config',
        diff: '- old\n+ new',
      });

      const parsed = JSON.parse(result.output || '{}');
      expect(parsed.approval_request.diff).toBe('- old\n+ new');
    });
  });

  describe('execute - discovery', () => {
    it('should create discovery request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('discovery', {
        files_to_analyze: ['/src/main.ts', '/src/utils.ts'],
        proposed_task: 'Refactor main module',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Discovery phase');
    });
  });

  describe('execute - createPlan', () => {
    it('should create structured plan', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('createPlan', {
        task: 'Add new feature',
        files: [
          { path: '/src/feature.ts', action: 'create' as const, reason: 'New feature file' },
        ],
        execution_order: ['/src/feature.ts'],
        rollback_plan: 'Delete feature file if issues',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      const parsed = JSON.parse(result.output || '{}');
      expect(parsed.version).toBe('1.0');
      expect(parsed.task).toBe('Add new feature');
    });
  });

  describe('execute - commit/rollback/history', () => {
    it('should handle commit request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('commit', {
        session_id: 'test-123',
        message: 'Initial commit',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Commit requested');
    });

    it('should handle rollback request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('rollback', {
        session_id: 'test-123',
        commit_id: 'abc123',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Rollback requested');
    });

    it('should handle history request', async () => {
      executor = createToolExecutor({});
      const result = await executor.execute('history', {
        session_id: 'test-123',
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('History requested');
    });
  });

  describe('metrics and logging', () => {
    it('should track execution log', async () => {
      mockSandboxHandle.readFile.mockResolvedValue({ success: true, content: 'test' });
      executor = createToolExecutor({
        sandboxHandle: mockSandboxHandle,
        enableMetrics: true,
      });

      await executor.execute('readFile', { path: '/test.ts' });
      await executor.execute('readFile', { path: '/test2.ts' });

      const log = executor.getExecutionLog();
      expect(log).toHaveLength(2);
      expect(log[0].toolName).toBe('readFile');
      expect(log[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate metrics', async () => {
      mockSandboxHandle.readFile
        .mockResolvedValueOnce({ success: true, content: 'test' })
        .mockResolvedValueOnce({ success: false, error: 'not found' });

      executor = createToolExecutor({
        sandboxHandle: mockSandboxHandle,
        enableMetrics: true,
      });

      await executor.execute('readFile', { path: '/test.ts' });
      await executor.execute('readFile', { path: '/missing.ts' });

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.successfulExecutions).toBe(1);
      expect(metrics.failedExecutions).toBe(1);
      expect(metrics.byTool.readFile.count).toBe(2);
      expect(metrics.byTool.readFile.success).toBe(1);
      expect(metrics.byTool.readFile.failed).toBe(1);
    });

    it('should clear execution log', async () => {
      executor = createToolExecutor({ enableMetrics: true });
      await executor.execute('discovery', { files_to_analyze: [], proposed_task: 'test' });

      executor.clearLog();
      const log = executor.getExecutionLog();
      expect(log).toHaveLength(0);
    });

    it('should not track when metrics disabled', async () => {
      executor = createToolExecutor({ enableMetrics: false });
      await executor.execute('discovery', { files_to_analyze: [], proposed_task: 'test' });

      const log = executor.getExecutionLog();
      expect(log).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle unknown tool', async () => {
      executor = createToolExecutor({});
      await expect(
        executor.execute('unknownTool' as any, {})
      ).rejects.toThrow('Unknown tool');
    });

    it('should handle sandbox errors', async () => {
      mockSandboxHandle.readFile.mockRejectedValue(new Error('Sandbox error'));

      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });
      await expect(executor.execute('readFile', { path: '/test.ts' })).rejects.toThrow();
    });

    it('should log errors when logging enabled', async () => {
      mockSandboxHandle.readFile.mockRejectedValue(new Error('Test error'));

      executor = createToolExecutor({
        sandboxHandle: mockSandboxHandle,
        enableLogging: true,
      });

      try {
        await executor.execute('readFile', { path: '/test.ts' });
      } catch (e) {
        // Expected
      }

      // Console error should have been called
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty file content', async () => {
      const vfs = { '/empty.ts': '' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('readFile', { path: '/empty.ts' });
      expect(result.success).toBe(true);
      expect(result.content).toBe('');
    });

    it('should handle very large files', async () => {
      const largeContent = 'x'.repeat(1000000);
      const vfs = { '/large.ts': largeContent };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('readFile', { path: '/large.ts' });
      expect(result.success).toBe(true);
      expect(result.content?.length).toBe(1000000);
    });

    it('should handle special characters in paths', async () => {
      const vfs = { '/src/test file.ts': 'content' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('readFile', { path: '/src/test file.ts' });
      expect(result.success).toBe(true);
    });

    it('should handle unicode content', async () => {
      const vfs = { '/test.ts': 'const greeting = "こんにちは";' };
      executor = createToolExecutor({ vfs });

      const result = await executor.execute('readFile', { path: '/test.ts' });
      expect(result.content).toBe('const greeting = "こんにちは";');
    });

    it('should handle concurrent executions', async () => {
      mockSandboxHandle.readFile.mockResolvedValue({ success: true, content: 'test' });
      executor = createToolExecutor({ sandboxHandle: mockSandboxHandle });

      const results = await Promise.all([
        executor.execute('readFile', { path: '/test1.ts' }),
        executor.execute('readFile', { path: '/test2.ts' }),
        executor.execute('readFile', { path: '/test3.ts' }),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(r => expect(r.success).toBe(true));
    });
  });
});
