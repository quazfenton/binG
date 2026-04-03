/**
 * Bash Module Unit Tests
 * 
 * Tests for bash-native execution primitives
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock virtual filesystem
vi.mock('@/lib/virtual-filesystem', () => ({
  virtualFilesystem: {
    writeFile: vi.fn().mockResolvedValue({ path: '/test/output.txt' }),
    readFile: vi.fn().mockResolvedValue({ content: 'test content' }),
    listDirectory: vi.fn().mockResolvedValue({ nodes: [] }),
  },
}));

describe('Bash Event Schema', () => {
  it('should create valid bash execution event', async () => {
    const { createBashExecutionEvent } = await import('@/lib/bash/bash-event-schema');

    const event = createBashExecutionEvent('ls -la', 'agent-123');

    expect(event.type).toBe('BASH_EXECUTION');
    expect(event.command).toBe('ls -la');
    expect(event.agentId).toBe('agent-123');
    expect(event.persist).toBe(true);
    expect(event.selfHeal).toBe(true);
  });

  it('should create bash failure context', async () => {
    const { createBashFailureContext } = await import('@/lib/bash/bash-event-schema');
    
    const result = {
      command: 'invalid-cmd',
      stdout: '',
      stderr: 'command not found',
      exitCode: 127,
      workingDir: '/workspace',
      duration: 100,
      success: false,
    };
    
    const context = createBashFailureContext(result, ['file1.txt'], 1);
    
    expect(context.command).toBe('invalid-cmd');
    expect(context.exitCode).toBe(127);
    expect(context.attempt).toBe(1);
  });
});

describe('Bash Tool', () => {
  it('should execute simple command', async () => {
    const { executeBashCommand } = await import('@/lib/bash/bash-tool');

    const result = await executeBashCommand('echo "hello"');

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should handle command failure', async () => {
    const { executeBashCommand } = await import('@/lib/bash/bash-tool');

    const result = await executeBashCommand('nonexistent-command-xyz');

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('should check command safety', async () => {
    const { isCommandSafe } = await import('@/lib/bash/bash-tool');

    expect(isCommandSafe('ls -la')).toBe(true);
    expect(isCommandSafe('rm -rf /')).toBe(false);
    expect(isCommandSafe('echo "hello"')).toBe(true);
  });

  it('should extract output files', async () => {
    const { extractOutputFiles } = await import('@/lib/bash/bash-tool');
    
    const files = extractOutputFiles('cat file.txt > output.txt');
    
    expect(files).toContain('output.txt');
  });
});

describe('DAG Compiler', () => {
  it('should parse simple pipeline', async () => {
    const { parsePipeline } = await import('@/lib/bash/dag-compiler');

    const parts = parsePipeline('cat file.txt | grep pattern | wc -l');

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('cat file.txt');
    expect(parts[1]).toBe('grep pattern');
    expect(parts[2]).toBe('wc -l');
  });

  it('should handle quoted pipes', async () => {
    const { parsePipeline } = await import('@/lib/bash/dag-compiler');

    const parts = parsePipeline('echo "a | b" | grep "pattern"');

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('echo "a | b"');
  });

  it('should extract redirect', async () => {
    const { extractRedirect } = await import('@/lib/bash/dag-compiler');

    const { command, outputFile } = extractRedirect('cat file.txt > output.txt');

    expect(command).toBe('cat file.txt');
    expect(outputFile).toBe('output.txt');
  });

  it('should classify command types', async () => {
    const { classifyCommand } = await import('@/lib/bash/dag-compiler');

    expect(classifyCommand('ls -la')).toBe('bash');
    expect(classifyCommand('curl https://api.com')).toBe('tool');
    expect(classifyCommand('node script.js')).toBe('container');
  });

  it('should compile bash to DAG', async () => {
    const { compileBashToDAG } = await import('@/lib/bash/dag-compiler');

    const dag = compileBashToDAG('curl api | jq ".items"', 'agent-1');

    expect(dag.nodes).toHaveLength(2);
    expect(dag.nodes[0].type).toBe('tool');
    expect(dag.nodes[1].type).toBe('bash');
    expect(dag.nodes[1].dependsOn).toContain('step-0');
  });

  it('should validate DAG', async () => {
    const { validateDAG } = await import('@/lib/bash/dag-compiler');
    
    const validDag = {
      nodes: [
        { id: 'step-0', type: 'bash' as const, command: 'ls', dependsOn: [] },
        { id: 'step-1', type: 'bash' as const, command: 'grep', dependsOn: ['step-0'] },
      ],
    };
    
    const result = validateDAG(validDag);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Self-Healing', () => {
  it('should classify errors', async () => {
    const { classifyError } = await import('@/lib/bash/self-healing');

    expect(classifyError('command not found: jqq')).toBe('missing_binary');
    expect(classifyError('No such file: file.txt')).toBe('missing_file');
    expect(classifyError('permission denied')).toBe('permissions');
    expect(classifyError('syntax error')).toBe('syntax');
  });

  it('should normalize commands', async () => {
    const { normalizeCommand } = await import('@/lib/bash/self-healing');

    expect(normalizeCommand('curl https://api.com/data')).toBe('curl URL');
    expect(normalizeCommand('cat file123.txt')).toBe('cat fileN.txt');
  });

  it('should apply targeted fixes', async () => {
    const { applyTargetedFix } = await import('@/lib/bash/self-healing');

    const fix = applyTargetedFix('jqq .items file.json', 'missing_binary', 'command not found: jqq');

    expect(fix).toBe('jq .items file.json');
  });

  it('should validate repairs', async () => {
    const { validateRepair } = await import('@/lib/bash/self-healing');

    expect(validateRepair('ls -la', 'ls -la')).toBe(true);
    expect(validateRepair('ls -la', 'rm -rf /')).toBe(false);
  });

  it('should check minimal changes', async () => {
    const { isMinimalChange } = await import('@/lib/bash/self-healing');
    
    expect(isMinimalChange('curl api', 'curl https://api.com')).toBe(true);
    expect(isMinimalChange('ls', 'rm -rf / && ls -la && cat /etc/passwd')).toBe(false);
  });
});

describe('DAG Executor', () => {
  it('should execute single node', async () => {
    const { executeNode } = await import('@/lib/bash/dag-executor');

    const node = {
      id: 'step-0',
      type: 'bash' as const,
      command: 'echo "test"',
      dependsOn: [],
    };

    const ctx = {
      agentId: 'test-agent',
      workingDir: '/workspace',
      results: {},
    };

    const result = await executeNode(node, ctx);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('test');
  });

  it('should execute DAG sequentially', async () => {
    const { executeDAG } = await import('@/lib/bash/dag-executor');
    
    const dag = {
      nodes: [
        { id: 'step-0', type: 'bash' as const, command: 'echo "step1"', dependsOn: [] },
        { id: 'step-1', type: 'bash' as const, command: 'echo "step2"', dependsOn: ['step-0'] },
      ],
      metadata: {
        createdAt: Date.now(),
        agentId: 'test-agent',
      },
    };
    
    const ctx = {
      agentId: 'test-agent',
      workingDir: '/workspace',
      results: {},
    };
    
    const result = await executeDAG(dag, ctx);
    
    expect(result.success).toBe(true);
    expect(result.nodeResults['step-0']).toBeDefined();
    expect(result.nodeResults['step-1']).toBeDefined();
  });
});
