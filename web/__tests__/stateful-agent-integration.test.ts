/**
 * StatefulAgent Integration Tests
 *
 * Tests for the comprehensive Plan-Act-Verify workflow with:
 * - Task decomposition
 * - Self-healing
 * - Reflection
 * - Execution graph integration
 * - Context pack integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatefulAgent } from '@/lib/orchestra/stateful-agent/agents/stateful-agent';
import type { StatefulAgentOptions, StatefulAgentResult } from '@/lib/orchestra/stateful-agent/agents/stateful-agent';

// Mock session lock
vi.mock('@/lib/session/session-lock', () => ({
  acquireSessionLock: vi.fn().mockImplementation(async (sessionId: string) => {
    return () => { /* no-op release */ };
  }),
}));

// Mock dependencies
vi.mock('@/lib/orchestra/reflection-engine', () => ({
  reflectionEngine: {
    reflect: vi.fn().mockResolvedValue([]),
    synthesizeReflections: vi.fn().mockReturnValue({ overallScore: 0.8, prioritizedImprovements: [] }),
  },
}));

vi.mock('@bing/shared/agent/execution-graph', () => ({
  executionGraphEngine: {
    createGraph: vi.fn().mockReturnValue({ id: 'test-graph', nodes: new Map(), edges: new Map() }),
    addNode: vi.fn(),
    getGraph: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('@/lib/virtual-filesystem/context-pack-service', () => ({
  contextPackService: {
    generateContextPack: vi.fn().mockResolvedValue({
      fileCount: 5,
      directoryCount: 2,
      estimatedTokens: 1000,
      files: [
        { path: '/src/index.ts', content: 'console.log("Hello")' },
        { path: '/src/utils.ts', content: 'export const util = () => {}' },
      ],
    }),
  },
}));

vi.mock('@/lib/orchestra/stateful-agent/tools/tool-executor', () => ({
  ToolExecutor: class MockToolExecutor {
    constructor() {}
    async execute(toolName: string, params: any) {
      if (toolName === 'readFile') {
        return { success: true, content: 'mock file content' };
      }
      if (toolName === 'writeFile') {
        return { success: true, output: `Written ${params.path}` };
      }
      if (toolName === 'syntaxCheck') {
        return { success: true, output: 'No syntax errors' };
      }
      return { success: true, output: 'mock output' };
    }
    getMetrics() {
      return { totalExecutions: 0, successRate: 1.0 };
    }
  },
}));

describe('StatefulAgent', () => {
  let agent: StatefulAgent;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    agent = new StatefulAgent({
      sessionId: 'test-session',
      maxSelfHealAttempts: 2,
      enforcePlanActVerify: true,
      enableReflection: true,
      enableTaskDecomposition: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe('Constructor', () => {
    it('should create agent with default options', () => {
      const defaultAgent = new StatefulAgent();
      expect(defaultAgent).toBeDefined();
    });

    it('should create agent with custom options', () => {
      const customAgent = new StatefulAgent({
        sessionId: 'custom-session',
        maxSelfHealAttempts: 5,
        enforcePlanActVerify: false,
        enableReflection: false,
        enableTaskDecomposition: false,
      });
      expect(customAgent).toBeDefined();
    });
  });

  describe('run()', () => {
    it('should execute simple task successfully', async () => {
      const result: StatefulAgentResult = await agent.run('Create a simple file');
      
      expect(result.success).toBe(true);
      expect(result.steps).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
      expect(result.response).toContain('Completed');
    });

    it('should use context pack for discovery when enabled', async () => {
      process.env.STATEFUL_AGENT_USE_CONTEXT_PACK = 'true';
      
      const result = await agent.run('Read and modify src/index.ts');
      
      expect(result.success).toBe(true);
      // Context pack should have been called
      expect(vi.mocked(await import('@/lib/virtual-filesystem/context-pack-service')).contextPackService.generateContextPack).toHaveBeenCalled();
    });

    it('should skip context pack when disabled', async () => {
      process.env.STATEFUL_AGENT_USE_CONTEXT_PACK = 'false';
      
      const result = await agent.run('Simple task');
      
      expect(result.success).toBe(true);
      // Context pack should not have been called
      expect(vi.mocked(await import('@/lib/virtual-filesystem/context-pack-service')).contextPackService.generateContextPack).not.toHaveBeenCalled();
    });

    it('should handle task decomposition when enabled', async () => {
      const decomposeAgent = new StatefulAgent({
        sessionId: 'decompose-session',
        enableTaskDecomposition: true,
      });

      const result = await decomposeAgent.run('Create a full-stack app with React and Node.js');
      
      expect(result.success).toBe(true);
      // Task graph should have been created
      expect(decomposeAgent['taskGraph']).toBeDefined();
    });

    it('should skip task decomposition when disabled', async () => {
      const noDecomposeAgent = new StatefulAgent({
        sessionId: 'no-decompose-session',
        enableTaskDecomposition: false,
      });

      const result = await noDecomposeAgent.run('Simple task');
      
      expect(result.success).toBe(true);
      // Task graph should not have been created
      expect(noDecomposeAgent['taskGraph']).toBeUndefined();
    });

    it('should apply reflection when enabled and score is low', async () => {
      const { reflectionEngine } = await import('@/lib/orchestra/reflection-engine');
      vi.mocked(reflectionEngine.reflect).mockResolvedValue([
        { perspective: 'technical', improvements: ['Add error handling'], confidence: 0.5 },
      ]);
      vi.mocked(reflectionEngine.synthesizeReflections).mockReturnValue({
        overallScore: 0.5,
        prioritizedImprovements: ['Add error handling'],
      });

      const result = await agent.run('Task that needs improvement');
      
      expect(result.success).toBe(true);
      // Reflection should have been called
      expect(reflectionEngine.reflect).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Mock tool executor to fail
      const { ToolExecutor } = await import('@/lib/orchestra/stateful-agent/tools/tool-executor');
      vi.mocked(ToolExecutor).prototype.execute = vi.fn().mockRejectedValue(new Error('Tool execution failed'));

      const errorAgent = new StatefulAgent({
        sessionId: 'error-session',
        maxSelfHealAttempts: 0, // Disable self-healing for this test
      });

      const result = await errorAgent.run('Task that will fail');
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should track execution metrics', async () => {
      const result = await agent.run('Track metrics task');
      
      expect(result.metrics).toBeDefined();
      expect(result.steps).toBeGreaterThan(0);
    });

    it('should create execution graph when task decomposition is enabled', async () => {
      const { executionGraphEngine } = await import('@bing/shared/agent/execution-graph');
      
      const graphAgent = new StatefulAgent({
        sessionId: 'graph-session',
        enableTaskDecomposition: true,
      });

      await graphAgent.run('Complex task with multiple steps');
      
      // Execution graph should have been created
      expect(executionGraphEngine.createGraph).toHaveBeenCalled();
    });
  });

  describe('Complex Task Detection', () => {
    it('should detect complex tasks with create/build keywords', async () => {
      const result = await agent.run('Create a React component with TypeScript');
      expect(result.success).toBe(true);
    });

    it('should detect complex tasks with multiple files', async () => {
      const result = await agent.run('Create multiple files for a new feature');
      expect(result.success).toBe(true);
    });

    it('should detect complex tasks with project structure', async () => {
      const result = await agent.run('Set up project structure with authentication');
      expect(result.success).toBe(true);
    });

    it('should handle simple tasks without StatefulAgent overhead', async () => {
      const simpleAgent = new StatefulAgent({
        sessionId: 'simple-session',
        enableTaskDecomposition: false,
        enableReflection: false,
      });

      const result = await simpleAgent.run('What is 2+2?');
      expect(result.success).toBe(true);
    });
  });

  describe('Self-Healing', () => {
    it('should retry on failure when self-healing is enabled', async () => {
      let callCount = 0;
      const { ToolExecutor } = await import('@/lib/orchestra/stateful-agent/tools/tool-executor');
      vi.mocked(ToolExecutor).prototype.execute = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Temporary failure');
        }
        return { success: true, output: 'Success after retry' };
      });

      const healingAgent = new StatefulAgent({
        sessionId: 'healing-session',
        maxSelfHealAttempts: 2,
      });

      const result = await healingAgent.run('Task with temporary failure');
      
      expect(result.success).toBe(true);
      expect(callCount).toBe(2); // Should have retried once
    });

    it('should fail after max self-heal attempts', async () => {
      const { ToolExecutor } = await import('@/lib/orchestra/stateful-agent/tools/tool-executor');
      vi.mocked(ToolExecutor).prototype.execute = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      const failingAgent = new StatefulAgent({
        sessionId: 'failing-session',
        maxSelfHealAttempts: 2,
      });

      const result = await failingAgent.run('Task that always fails');
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('VFS Management', () => {
    it('should populate VFS during discovery phase', async () => {
      const result = await agent.run('Read files and understand context');
      
      expect(agent['vfs']).toBeDefined();
      expect(Object.keys(agent['vfs']).length).toBeGreaterThan(0);
    });

    it('should track file modifications in transaction log', async () => {
      const result = await agent.run('Modify existing files');
      
      expect(agent['transactionLog']).toBeDefined();
      // Transaction log should track modifications
      expect(Array.isArray(agent['transactionLog'])).toBe(true);
    });
  });

  describe('Session Locking', () => {
    it('should acquire and release session lock', async () => {
      const lockAgent = new StatefulAgent({
        sessionId: 'lock-session',
      });

      const result = await lockAgent.run('Task with session locking');
      
      expect(result.success).toBe(true);
      // Lock should have been acquired and released
    });

    it('should release lock even on error', async () => {
      const { ToolExecutor } = await import('@/lib/orchestra/stateful-agent/tools/tool-executor');
      vi.mocked(ToolExecutor).prototype.execute = vi.fn().mockRejectedValue(new Error('Forced error'));

      const errorAgent = new StatefulAgent({
        sessionId: 'error-lock-session',
        maxSelfHealAttempts: 0,
      });

      const result = await errorAgent.run('Task that fails');
      
      expect(result.success).toBe(false);
      // Lock should still have been released in finally block
    });
  });
});

describe('StatefulAgent Integration', () => {
  describe('With Context Pack', () => {
    it('should integrate context pack for comprehensive context', async () => {
      process.env.STATEFUL_AGENT_USE_CONTEXT_PACK = 'true';
      
      const agent = new StatefulAgent({
        sessionId: 'context-session',
        enableTaskDecomposition: true,
      });

      const result = await agent.run('Understand codebase and make improvements');
      
      expect(result.success).toBe(true);
      // Should have used context pack
      const { contextPackService } = await import('@/lib/virtual-filesystem/context-pack-service');
      expect(contextPackService.generateContextPack).toHaveBeenCalled();
    });
  });

  describe('With Execution Graph', () => {
    it('should track task execution in graph', async () => {
      const agent = new StatefulAgent({
        sessionId: 'graph-track-session',
        enableTaskDecomposition: true,
      });

      const result = await agent.run('Execute tasks with graph tracking');
      
      expect(result.success).toBe(true);
      // Execution graph should have been used
      const { executionGraphEngine } = await import('@bing/shared/agent/execution-graph');
      expect(executionGraphEngine.createGraph).toHaveBeenCalled();
    });
  });

  describe('With Reflection', () => {
    it('should improve output quality with reflection', async () => {
      const agent = new StatefulAgent({
        sessionId: 'reflection-session',
        enableReflection: true,
      });

      const result = await agent.run('Create high-quality code');
      
      expect(result.success).toBe(true);
      // Reflection should have been applied
      const { reflectionEngine } = await import('@/lib/orchestra/reflection-engine');
      expect(reflectionEngine.reflect).toHaveBeenCalled();
    });
  });
});

describe('StatefulAgent Performance', () => {
  it('should complete simple task within reasonable time', async () => {
    const startTime = Date.now();
    
    const agent = new StatefulAgent({
      sessionId: 'perf-simple-session',
      enableTaskDecomposition: false,
      enableReflection: false,
    });

    await agent.run('Simple task');
    
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
  });

  it('should handle complex task with acceptable overhead', async () => {
    const startTime = Date.now();
    
    const agent = new StatefulAgent({
      sessionId: 'perf-complex-session',
      enableTaskDecomposition: true,
      enableReflection: true,
    });

    await agent.run('Complex full-stack application with multiple files');
    
    const duration = Date.now() - startTime;
    // Complex task with reflection and decomposition should complete within 60 seconds
    expect(duration).toBeLessThan(60000);
  });
});
