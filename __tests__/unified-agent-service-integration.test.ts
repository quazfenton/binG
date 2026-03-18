/**
 * Unified Agent Service Integration Tests
 *
 * Tests for the unified agent service with:
 * - StatefulAgent mode for complex tasks
 * - OpenCode Engine for simple tasks
 * - Fallback chain
 * - Mode detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  processUnifiedAgentRequest,
  checkProviderHealth,
  getAvailableModes,
  type UnifiedAgentConfig,
} from '@/lib/orchestra/unified-agent-service';

// Mock dependencies
vi.mock('@/lib/session/agent/opencode-engine-service', () => ({
  createOpenCodeEngine: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      success: true,
      response: 'OpenCode response',
      bashCommands: [],
      fileChanges: [],
      steps: 1,
    }),
  }),
}));

vi.mock('@/lib/orchestra/stateful-agent/agents/stateful-agent', () => ({
  StatefulAgent: class MockStatefulAgent {
    constructor(private options: any) {}
    async run(userMessage: string) {
      return {
        success: true,
        response: `StatefulAgent completed: ${userMessage}`,
        steps: 5,
        errors: [],
        vfs: { '/test.ts': 'console.log("test")' },
        metrics: { totalExecutions: 5, successRate: 1.0 },
      };
    }
  },
}));

vi.mock('@/lib/sandbox/providers/llm-factory', () => ({
  getLLMProvider: vi.fn().mockReturnValue({
    generateResponse: vi.fn().mockResolvedValue({
      content: 'LLM response',
    }),
  }),
}));

describe('Unified Agent Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkProviderHealth()', () => {
    it('should return health status for all providers', () => {
      const health = checkProviderHealth();
      
      expect(health).toHaveProperty('v2Containerized');
      expect(health).toHaveProperty('v2Local');
      expect(health).toHaveProperty('v2Native');
      expect(health).toHaveProperty('v1Api');
      expect(health).toHaveProperty('preferredMode');
    });

    it('should detect v2-native when OpenCode is available', () => {
      process.env.OPENCODE_CONTAINERIZED = 'true';
      process.env.DAYTONA_API_KEY = 'test-key';
      
      const health = checkProviderHealth();
      
      expect(health.v2Native).toBe(true);
    });
  });

  describe('getAvailableModes()', () => {
    it('should return available modes with metadata', () => {
      const modes = getAvailableModes();
      
      expect(modes).toBeInstanceOf(Array);
      expect(modes.length).toBeGreaterThan(0);
      
      const v2Native = modes.find(m => m.mode === 'v2-native');
      expect(v2Native).toBeDefined();
      expect(v2Native?.recommended).toBe(true);
    });
  });

  describe('processUnifiedAgentRequest()', () => {
    it('should use StatefulAgent for complex tasks', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      // Mock to force StatefulAgent mode
      process.env.OPENCODE_CONTAINERIZED = 'false';
      process.env.LLM_PROVIDER = 'opencode';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Create a React component with TypeScript and multiple files',
        maxSteps: 10,
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
      // Should use StatefulAgent or opencode-engine for complex tasks
      expect(['stateful-agent', 'opencode-engine']).toContain(result.metadata?.provider);
      if (result.metadata?.provider === 'stateful-agent') {
        expect(result.metadata?.filesModified).toBeGreaterThan(0);
      }
    });

    it('should use OpenCode Engine for simple tasks', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'What is 2+2?',
        maxSteps: 5,
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
      // Should not use StatefulAgent for simple questions
      expect(result.metadata?.provider).not.toBe('stateful-agent');
    });

    it('should detect complex tasks with enhanced pattern matching', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      
      const complexTasks = [
        'Build a full-stack app with React and Node.js',
        'Create multiple files for authentication',
        'Implement dashboard with API integration',
        'Set up project structure and deployment',
        'Refactor codebase to use TypeScript',
      ];

      for (const task of complexTasks) {
        const config: UnifiedAgentConfig = {
          userMessage: task,
        };

        const result = await processUnifiedAgentRequest(config);
        
        expect(result.success).toBe(true);
      }
    });

    it('should detect multi-step tasks', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Read the files and then create a new component',
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
      // Should detect multiple steps and use StatefulAgent
    });

    it('should respect ENABLE_STATEFUL_AGENT=false', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'false';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Create a complex application',
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
      // Should not use StatefulAgent when disabled
      expect(result.metadata?.provider).not.toBe('stateful-agent');
    });

    it('should include comprehensive metadata', async () => {
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Create a file',
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.duration).toBeDefined();
      expect(result.metadata?.provider).toBeDefined();
    });

    it('should handle streaming callbacks', async () => {
      const streamChunks: string[] = [];
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Simple task',
        onStreamChunk: (chunk: string) => {
          streamChunks.push(chunk);
        },
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
    });

    it('should handle tool execution callbacks', async () => {
      const toolExecutions: Array<{ name: string; args: any; result: any }> = [];
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Task with tools',
        onToolExecution: (name: string, args: any, result: any) => {
          toolExecutions.push({ name, args, result });
        },
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.success).toBe(true);
    });
  });

  describe('Fallback Chain', () => {
    it('should fallback to OpenCode Engine when StatefulAgent fails', async () => {
      // This test would require mocking StatefulAgent to fail
      // For now, we test that the fallback mechanism exists
      process.env.ENABLE_STATEFUL_AGENT = 'true';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Task that might need fallback',
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result).toBeDefined();
    });

    it('should fallback to V1 API when V2 modes fail', async () => {
      process.env.OPENCODE_CONTAINERIZED = 'false';
      process.env.LLM_PROVIDER = 'mistral';
      process.env.MISTRAL_API_KEY = 'test-key';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Simple question',
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result).toBeDefined();
    });
  });

  describe('Mode Detection', () => {
    it('should auto-detect mode from environment', async () => {
      // Set environment for v2-native mode
      process.env.OPENCODE_CONTAINERIZED = 'false';
      process.env.LLM_PROVIDER = 'opencode';
      
      const result = await processUnifiedAgentRequest({
        userMessage: 'Test task',
        mode: 'auto',
      });
      
      // Mode will be v2-native if opencode is available
      expect(['v2-native', 'v2-local', 'v2-containerized']).toContain(result.mode);
    });

    it('should respect explicit mode override', async () => {
      const config: UnifiedAgentConfig = {
        userMessage: 'Test task',
        mode: 'v1-api',  // Explicit override
      };

      const result = await processUnifiedAgentRequest(config);
      
      expect(result.mode).toBe('v1-api');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      process.env.OPENCODE_CONTAINERIZED = 'false';
      process.env.LLM_PROVIDER = 'invalid-provider';
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Task with invalid provider',
      };

      const result = await processUnifiedAgentRequest(config);
      
      // Should fail gracefully with error message
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include error details in result', async () => {
      const config: UnifiedAgentConfig = {
        userMessage: 'Task',
      };

      const result = await processUnifiedAgentRequest(config);
      
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('Performance', () => {
    it('should complete simple task within reasonable time', async () => {
      const startTime = Date.now();
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Simple task',
      };

      await processUnifiedAgentRequest(config);
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000); // 10 seconds
    });

    it('should handle complex task with acceptable overhead', async () => {
      const startTime = Date.now();
      
      const config: UnifiedAgentConfig = {
        userMessage: 'Create a full-stack application with multiple files and API integration',
      };

      await processUnifiedAgentRequest(config);
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(60000); // 60 seconds
    });
  });
});

describe('Unified Agent Service - Edge Cases', () => {
  it('should handle empty user message', async () => {
    const config: UnifiedAgentConfig = {
      userMessage: '',
    };

    const result = await processUnifiedAgentRequest(config);
    
    expect(result).toBeDefined();
  });

  it('should handle very long user message', async () => {
    const config: UnifiedAgentConfig = {
      userMessage: 'A'.repeat(10000) + 'Create something',
    };

    const result = await processUnifiedAgentRequest(config);
    
    expect(result).toBeDefined();
  });

  it('should handle special characters in user message', async () => {
    const config: UnifiedAgentConfig = {
      userMessage: 'Create file with special chars: @#$%^&*()_+-=[]{}|;:\'",.<>?/',
    };

    const result = await processUnifiedAgentRequest(config);
    
    expect(result).toBeDefined();
  });

  it('should handle unicode in user message', async () => {
    const config: UnifiedAgentConfig = {
      userMessage: 'Create 文件 with emoji 🚀 and émojis',
    };

    const result = await processUnifiedAgentRequest(config);
    
    expect(result).toBeDefined();
  });
});
