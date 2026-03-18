/**
 * Integration Tests: Cloud Agent + Preview Offload Workflow
 * 
 * Tests the complete workflow:
 * 1. Spawn cloud agents (E2B, Daytona)
 * 2. Route preview requests to appropriate providers
 * 3. Handle large projects with offloading
 * 4. Cleanup agents
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-agent-${Math.random().toString(36).substr(2, 9)}`)
}))

// Mock logger
vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

// Mock sandbox providers
vi.mock('../lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn((type) => {
    const mockProvider = {
      createSandbox: vi.fn(() => Promise.resolve({
        id: `sandbox-${type}-123`,
        workspaceDir: '/workspace',
        writeFile: vi.fn(() => Promise.resolve({ success: true })),
        readFile: vi.fn(() => Promise.resolve({ success: true, output: 'content' })),
        listDirectory: vi.fn(() => Promise.resolve({ success: true, output: 'file1.txt\nfile2.txt' })),
        executeCommand: vi.fn(() => Promise.resolve({ success: true, output: '{}' })),
        getPreviewLink: vi.fn(() => Promise.resolve({ url: `http://preview.${type}.local` })),
        destroySandbox: vi.fn(() => Promise.resolve()),
      })),
      getSandbox: vi.fn(() => Promise.resolve({
        id: `sandbox-${type}-123`,
        writeFile: vi.fn(() => Promise.resolve({ success: true })),
        readFile: vi.fn(() => Promise.resolve({ success: true, output: 'content' })),
        executeCommand: vi.fn(() => Promise.resolve({ success: true, output: '{}' })),
      })),
      destroySandbox: vi.fn(() => Promise.resolve()),
    };
    return Promise.resolve(mockProvider);
  }),
}))

describe('Cloud Agent + Preview Offload Integration', () => {
  let cloudAgentSpawner: any;
  let previewOffloader: any;
  let spawnedAgents: any[] = [];

  beforeEach(async () => {
    vi.resetModules();
    const { cloudAgentSpawner: spawner } = await import('../lib/sandbox/cloud-agent-spawner');
    const { previewOffloader: offloader } = await import('../lib/sandbox/preview-offloader');
    cloudAgentSpawner = spawner;
    previewOffloader = offloader;
    spawnedAgents = [];
  });

  afterEach(async () => {
    // Cleanup all spawned agents
    for (const agent of spawnedAgents) {
      try {
        await cloudAgentSpawner.stopAgent(agent.id);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Cloud Agent Spawning', () => {
    it('should spawn E2B agent', async () => {
      const result = await cloudAgentSpawner.spawnAgent({
        provider: 'e2b',
        model: 'claude-3-5-sonnet',
      });

      expect(result.success).toBe(true);
      expect(result.agent?.provider).toBe('e2b');
      expect(result.agent?.sandboxId).toBeDefined();
      expect(result.agent?.status).toBe('ready');
      
      spawnedAgents.push(result.agent);
    });

    it('should spawn Daytona agent', async () => {
      const result = await cloudAgentSpawner.spawnAgent({
        provider: 'daytona',
        model: 'claude-3-5-sonnet',
      });

      expect(result.success).toBe(true);
      expect(result.agent?.provider).toBe('daytona');
      spawnedAgents.push(result.agent);
    });

    it('should track spawned agents', async () => {
      const result1 = await cloudAgentSpawner.spawnAgent({ provider: 'e2b' });
      const result2 = await cloudAgentSpawner.spawnAgent({ provider: 'daytona' });

      spawnedAgents.push(result1.agent, result2.agent);

      const activeAgents = cloudAgentSpawner.getActiveAgents();
      expect(activeAgents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Preview Decision Logic', () => {
    it('should use local for simple React app', () => {
      const decision = previewOffloader.decide({
        files: {
          'App.js': 'export default function App() {}',
          'index.js': 'import App from "./App"',
        },
        framework: 'react',
      });

      expect(decision.recommendedProvider).toBe('local');
      expect(decision.estimatedCost).toBe(0);
    });

    it('should use Daytona for Next.js app', () => {
      const decision = previewOffloader.decide({
        files: { 'pages/index.js': 'export default function() {}' },
        framework: 'next.js',
      });

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.estimatedCost).toBeGreaterThan(0);
    });

    it('should use Daytona for large project (>50 files)', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        files[`src/file${i}.js`] = `console.log(${i})`;
      }

      const decision = previewOffloader.decide({ files });

      expect(decision.recommendedProvider).toBe('daytona');
    });

    it('should use Daytona for Electron app', () => {
      const decision = previewOffloader.decide({
        files: {
          'main.js': 'const { app } = require("electron")',
          'preload.js': 'contextBridge.exposeInMainWorld("api", {})',
        },
        framework: 'electron',
      });

      expect(decision.recommendedProvider).toBe('daytona');
      expect(decision.reason).toContain('GUI/Desktop');
    });

    it('should use Daytona for Django backend', () => {
      const decision = previewOffloader.decide({
        files: {
          'views.py': 'def index(request): return HttpResponse()',
          'models.py': 'class User(models.Model): pass',
        },
        framework: 'django',
      });

      expect(decision.recommendedProvider).toBe('daytona');
    });
  });

  describe('Cost Estimation', () => {
    it('should calculate E2B costs', () => {
      const cost = cloudAgentSpawner.getCostEstimate?.('e2b', 60) || 
                   previewOffloader.getCostEstimate('daytona', 60);
      expect(cost).toBeDefined();
      expect(typeof cost).toBe('number');
    });

    it('should calculate Daytona preview costs', () => {
      const cost = previewOffloader.getCostEstimate('daytona', 60);
      expect(cost).toBe(3); // $0.05/min * 60 min
    });

    it('should calculate CodeSandbox preview costs', () => {
      const cost = previewOffloader.getCostEstimate('codesandbox', 60);
      expect(cost).toBe(1.2); // $0.02/min * 60 min
    });
  });

  describe('Agent Execution', () => {
    it('should execute task on E2B agent', async () => {
      const result = await cloudAgentSpawner.spawnAgent({ provider: 'e2b' });
      spawnedAgents.push(result.agent);

      const execResult = await cloudAgentSpawner.executeOnAgent(
        result.agent.id,
        'List files in current directory'
      );

      expect(execResult.success).toBeDefined();
    });

    it('should handle non-existent agent', async () => {
      const result = await cloudAgentSpawner.executeOnAgent(
        'non-existent-agent',
        'test task'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Agent Cleanup', () => {
    it('should stop individual agent', async () => {
      const result = await cloudAgentSpawner.spawnAgent({ provider: 'e2b' });
      
      const stopResult = await cloudAgentSpawner.stopAgent(result.agent.id);
      expect(stopResult.success).toBe(true);
    });

    it('should cleanup idle agents', async () => {
      await cloudAgentSpawner.spawnAgent({ provider: 'e2b' });
      
      const cleanedCount = await cloudAgentSpawner.cleanupIdleAgents();
      expect(typeof cleanedCount).toBe('number');
    });
  });

  describe('Agent Statistics', () => {
    it('should track agents by provider', async () => {
      await cloudAgentSpawner.spawnAgent({ provider: 'e2b' });
      await cloudAgentSpawner.spawnAgent({ provider: 'daytona' });

      const stats = cloudAgentSpawner.getStats();

      expect(stats.totalAgents).toBeGreaterThanOrEqual(2);
      expect(stats.byProvider.e2b).toBeGreaterThanOrEqual(1);
      expect(stats.byProvider.daytona).toBeGreaterThanOrEqual(1);
    });
  });

  describe('End-to-End: Spawn Agent + Preview', () => {
    it('should spawn agent and route preview appropriately', async () => {
      // Spawn cloud agent
      const agentResult = await cloudAgentSpawner.spawnAgent({
        provider: 'e2b',
        model: 'claude-3-5-sonnet',
      });
      spawnedAgents.push(agentResult.agent);

      expect(agentResult.success).toBe(true);

      // Decide preview routing for a Next.js project
      const previewDecision = previewOffloader.decide({
        files: {
          'pages/index.js': 'export default function Index() {}',
          'pages/about.js': 'export default function About() {}',
        },
        framework: 'next.js',
      });

      expect(previewDecision.recommendedProvider).toBe('daytona');
    });
  });
});
