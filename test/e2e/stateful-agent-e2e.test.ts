import { test, expect, describe } from 'vitest';
import { createModelWithFallback } from '@/lib/stateful-agent/agents/provider-fallback';
import { ToolExecutor } from '@/lib/stateful-agent/tools/tool-executor';
import { verifyChanges } from '@/lib/stateful-agent/agents/verification';
import { executeWithSelfHeal, ErrorType, globalErrorTracker } from '@/lib/stateful-agent/agents/self-healing';
import { nangoConnectionManager, nangoRateLimiter } from '@/lib/stateful-agent/tools';
import { combinedTools } from '@/lib/stateful-agent/tools';

/**
 * End-to-End Tests for Vercel AI SDK Integration
 *
 * These tests verify the complete integration of:
 * - Tool execution with sandbox/VFS
 * - Self-healing error recovery
 * - Syntax verification
 * - Provider fallback chain
 * - Nango external integrations
 * - Combined tool workflows
 * 
 * Note: Skipped - requires external services
 */
describe.skip('Vercel AI SDK E2E Tests', () => {
  const originalEnv = process.env;

  test('complete agent workflow: discovery → planning → editing → verification', async () => {
    process.env.OPENAI_API_KEY = 'test-key-e2e';

    // Phase 1: Discovery - Read files to understand codebase
    const mockSandboxHandle = {
      readFile: async (path: string) => ({
        success: true,
        content: path.includes('config') ? 'export const config = {};' : 'export const utils = {};',
      }),
      writeFile: async () => ({ success: true, output: 'File created' }),
      listDirectory: async () => ({ success: true, output: 'config.ts\nutils.ts' }),
      executeCommand: async () => ({ success: true, output: 'Build successful' }),
    };

    const executor = new ToolExecutor({
      sandboxHandle: mockSandboxHandle,
      enableMetrics: true,
    });

    // Execute discovery
    const discoveryResult = await executor.execute('discovery', {
      files_to_analyze: ['/src/config.ts', '/src/utils.ts'],
      proposed_task: 'Add logging functionality',
    });

    expect(discoveryResult.success).toBe(true);
    expect(discoveryResult.output).toContain('Discovery phase');

    // Phase 2: Planning - Create structured plan
    const planResult = await executor.execute('createPlan', {
      task: 'Add logging functionality',
      files: [
        { path: '/src/logger.ts', action: 'create' as const, reason: 'New logger module' },
        { path: '/src/config.ts', action: 'edit' as const, reason: 'Add logger config' },
      ],
      execution_order: ['/src/logger.ts', '/src/config.ts'],
      rollback_plan: 'Remove logger files and revert config',
    });

    expect(planResult.success).toBe(true);
    const plan = JSON.parse(planResult.output || '{}');
    expect(plan.plan.task).toBe('Add logging functionality');
    expect(plan.plan.files).toHaveLength(2);

    // Phase 3: Editing - Create new file
    const createResult = await executor.execute('createFile', {
      path: '/src/logger.ts',
      content: 'export const logger = { log: (msg: string) => console.log(msg) };',
    });

    expect(createResult.success).toBe(true);

    // Phase 4: Editing - Apply diff to existing file
    const diffResult = await executor.execute('applyDiff', {
      path: '/src/config.ts',
      search: 'export const config = {};',
      replace: 'export const config = { logging: true };',
      thought: 'Add logging configuration',
    });

    expect(diffResult.success).toBe(true);

    // Phase 5: Verification - Check syntax
    const modifiedFiles = {
      '/src/logger.ts': 'export const logger = { log: (msg: string) => console.log(msg) };',
      '/src/config.ts': 'export const config = { logging: true };',
    };

    const verification = await verifyChanges(modifiedFiles);
    expect(verification.passed).toBe(true);

    // Phase 6: Syntax check
    const syntaxResult = await executor.execute('syntaxCheck', {
      paths: ['/src/logger.ts', '/src/config.ts'],
    });

    expect(syntaxResult.success).toBe(true);

    // Verify metrics were tracked
    const metrics = executor.getMetrics();
    expect(metrics.totalExecutions).toBeGreaterThanOrEqual(5);
    expect(metrics.successfulExecutions).toBe(metrics.totalExecutions);
  });

  test('self-healing workflow with error recovery', async () => {
    let attemptCount = 0;

    const flakyOperation = async () => {
      attemptCount++;

      // Simulate transient errors on first two attempts
      if (attemptCount < 3) {
        throw new Error(`Timeout - attempt ${attemptCount}`);
      }

      // Succeed on third attempt
      return { success: true, data: 'Operation completed' };
    };

    const result = await executeWithSelfHeal(flakyOperation, {
      step: 'flaky_api_call',
      prompt: 'Call external API',
    }, 5);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ success: true, data: 'Operation completed' });
    expect(attemptCount).toBe(3);
    expect(result.attempts).toBe(3);
  });

  test('error classification and appropriate retry behavior', async () => {
    // Test transient error - should retry
    const transientOp = async () => {
      throw new Error('Rate limit exceeded (429)');
    };

    const transientResult = await executeWithSelfHeal(transientOp, { step: 'test' }, 2);
    expect(transientResult.success).toBe(false);
    expect(transientResult.errorType).toBe(ErrorType.TRANSIENT);
    expect(transientResult.attempts).toBe(2); // Should retry

    // Test fatal error - should not retry
    let fatalAttempts = 0;
    const fatalOp = async () => {
      fatalAttempts++;
      throw new Error('Permission denied (403)');
    };

    const fatalResult = await executeWithSelfHeal(fatalOp, { step: 'test' }, 3);
    expect(fatalResult.success).toBe(false);
    expect(fatalResult.errorType).toBe(ErrorType.FATAL);
    expect(fatalAttempts).toBe(1); // Should not retry
  });

  test('verification catches syntax errors', async () => {
    const validCode = {
      '/src/valid.ts': `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      '/src/config.json': '{"name": "test", "value": 123}',
    };

    const validResult = await verifyChanges(validCode);
    expect(validResult.passed).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidCode = {
      '/src/invalid.ts': 'function broken() {', // Missing closing brace
      '/src/bad.json': '{"invalid": }', // Invalid JSON
    };

    const invalidResult = await verifyChanges(invalidCode);
    expect(invalidResult.passed).toBe(false);
    expect(invalidResult.errors.length + invalidResult.warnings.length).toBeGreaterThan(0);
    expect(invalidResult.reprompt).toBeDefined();
  });

  test('provider fallback chain works correctly', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    // Should use OpenAI when available
    const openaiResult = await createModelWithFallback('openai', 'gpt-4o');
    expect(openaiResult.provider).toBe('openai');
    expect(openaiResult.modelId).toBe('gpt-4o');
  });

  test('tool executor handles all tool types', async () => {
    const mockSandboxHandle = {
      readFile: async () => ({ success: true, content: 'content' }),
      writeFile: async () => ({ success: true }),
      listDirectory: async () => ({ success: true, output: 'file1\nfile2' }),
      executeCommand: async () => ({ success: true, output: 'done' }),
    };

    const executor = new ToolExecutor({ sandboxHandle: mockSandboxHandle });

    // Test all sandbox tools
    const results = await Promise.all([
      executor.execute('readFile', { path: '/test.ts' }),
      executor.execute('listFiles', { path: '/src' }),
      executor.execute('createFile', { path: '/new.ts', content: 'test' }),
      executor.execute('execShell', { command: 'npm test' }),
      executor.execute('syntaxCheck', { paths: ['/test.ts'] }),
    ]);

    results.forEach(result => {
      expect(result.success).toBe(true);
    });

    // Test planning tools
    const planResult = await executor.execute('createPlan', {
      task: 'Test task',
      files: [],
      execution_order: [],
      rollback_plan: 'Test rollback',
    });
    expect(planResult.success).toBe(true);

    // Test approval tool
    const approvalResult = await executor.execute('requestApproval', {
      action: 'delete',
      target: '/test.ts',
      reason: 'Testing',
    });
    expect(approvalResult.success).toBe(true);
    expect(approvalResult.output).toContain('requires_approval');
  });

  test('nango rate limiting works correctly', async () => {
    // Should allow requests under limit
    const rateLimit = await nangoRateLimiter.checkLimit('github');
    expect(rateLimit.allowed).toBe(true);

    // Check status
    const status = nangoRateLimiter.getStatus('github');
    expect(status.limit).toBe(100);
    expect(status.remaining).toBeLessThanOrEqual(100);
  });

  test('global error tracker records patterns', () => {
    globalErrorTracker.record(
      new Error('Test error for tracking'),
      { step: 'e2e_test', toolName: 'testTool' }
    );

    const history = globalErrorTracker.getHistory();
    expect(history.length).toBeGreaterThan(0);

    const lastError = history[history.length - 1];
    expect(lastError.step).toBe('e2e_test');
    expect(lastError.toolName).toBe('testTool');
  });

  test('combined tools object contains all tools', () => {
    // Verify sandbox tools
    expect(combinedTools.readFile).toBeDefined();
    expect(combinedTools.applyDiff).toBeDefined();
    expect(combinedTools.execShell).toBeDefined();

    // Verify Nango tools
    expect(combinedTools.github_list_repos).toBeDefined();
    expect(combinedTools.slack_send_message).toBeDefined();
    expect(combinedTools.notion_search).toBeDefined();

    // Count total tools
    const toolCount = Object.keys(combinedTools).length;
    expect(toolCount).toBeGreaterThanOrEqual(15); // 12 sandbox + 8 nango - some may overlap
  });

  test('concurrent tool executions work correctly', async () => {
    const mockSandboxHandle = {
      readFile: async (path: string) => ({ success: true, content: `content of ${path}` }),
      writeFile: async () => ({ success: true }),
    };

    const executor = new ToolExecutor({ sandboxHandle: mockSandboxHandle });

    // Execute multiple tools concurrently
    const results = await Promise.all([
      executor.execute('readFile', { path: '/file1.ts' }),
      executor.execute('readFile', { path: '/file2.ts' }),
      executor.execute('readFile', { path: '/file3.ts' }),
      executor.execute('createFile', { path: '/new1.ts', content: 'test' }),
      executor.execute('createFile', { path: '/new2.ts', content: 'test' }),
    ]);

    expect(results).toHaveLength(5);
    results.forEach(result => {
      expect(result.success).toBe(true);
    });

    const metrics = executor.getMetrics();
    expect(metrics.totalExecutions).toBe(5);
  });

  test('edge cases are handled gracefully', async () => {
    // Empty VFS
    const emptyExecutor = new ToolExecutor({ vfs: {} });

    const readMissing = await emptyExecutor.execute('readFile', { path: '/missing.ts' });
    expect(readMissing.success).toBe(false);
    expect(readMissing.error).toContain('not found');

    // Large file content
    const largeContent = 'x'.repeat(1000000);
    const largeExecutor = new ToolExecutor({
      vfs: { '/large.ts': largeContent },
    });

    const readLarge = await largeExecutor.execute('readFile', { path: '/large.ts' });
    expect(readLarge.success).toBe(true);
    expect(readLarge.content?.length).toBe(1000000);

    // Special characters in paths
    const specialExecutor = new ToolExecutor({
      vfs: { '/src/文件.ts': 'content', '/src/test file.ts': 'content' },
    });

    const readSpecial = await specialExecutor.execute('readFile', { path: '/src/文件.ts' });
    expect(readSpecial.success).toBe(true);
  });

  test('transaction logging works correctly', async () => {
    const transactionLog: any[] = [];
    const vfs: Record<string, string> = { '/test.ts': 'original content' };

    const executor = new ToolExecutor({ vfs, transactionLog });

    // Create file
    await executor.execute('createFile', { path: '/new.ts', content: 'new content' });
    expect(transactionLog.some(t => t.type === 'CREATE')).toBe(true);

    // Apply diff
    await executor.execute('applyDiff', {
      path: '/test.ts',
      search: 'original content',
      replace: 'modified content',
      thought: 'test',
    });
    expect(transactionLog.some(t => t.type === 'UPDATE')).toBe(true);
    expect(transactionLog.some(t => t.search === 'original content')).toBe(true);
  });

  test('security blocking works for dangerous commands', async () => {
    const mockSandboxHandle = {
      executeCommand: async () => ({ success: true, output: 'should not reach' }),
    };

    const executor = new ToolExecutor({ sandboxHandle: mockSandboxHandle });

    const dangerousCommands = [
      'rm -rf /',
      'mkfs.ext4 /dev/sda',
      'dd if=/dev/zero of=/dev/sda',
    ];

    for (const command of dangerousCommands) {
      const result = await executor.execute('execShell', { command });
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toContain('Blocked dangerous command');
    }
  });
});
