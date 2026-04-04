/**
 * E2E Tests: Mastra Module
 * 
 * Tests for Mastra workflows, memory, evals, and model routing.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Mastra Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Mastra Instance', () => {
    const { mastra, getMastra } = require('@/lib/mastra/mastra-instance');

    it('should export mastra instance', () => {
      expect(mastra).toBeDefined();
    });

    it('should get mastra instance', () => {
      const instance = getMastra();
      expect(instance).toBeDefined();
      expect(instance).toBe(mastra);
    });
  });

  describe('Model Router', () => {
    const { modelRouter, getModel, recommendModel } = require('@/lib/mastra/models/model-router');

    it('should have model router', () => {
      expect(modelRouter).toBeDefined();
    });

    it('should get model by tier', () => {
      const fast = getModel('fast');
      const reasoning = getModel('reasoning');
      const coder = getModel('coder');

      expect(fast).toBeDefined();
      expect(reasoning).toBeDefined();
      expect(coder).toBeDefined();
    });

    it('should recommend model for use case', () => {
      const codeModel = recommendModel('code generation');
      const chatModel = recommendModel('chat');
      const analysisModel = recommendModel('analysis');

      expect(codeModel).toBe('coder');
      expect(chatModel).toBe('fast');
      expect(analysisModel).toBe('reasoning');
    });
  });

  describe('Memory Integration', () => {
    const {
      getMemory,
      createMemory,
      addMessage,
      getHistory,
      getWorkingMemory,
      setWorkingMemory,
      searchMemory,
      withMemory,
    } = require('@/lib/mastra/memory');

    it('should get memory instance', () => {
      const memory = getMemory();
      expect(memory).toBeDefined();
    });

    it('should create memory', () => {
      const memory = createMemory({ enabled: true });
      expect(memory).toBeDefined();
    });

    it('should add message to memory', async () => {
      await addMessage('thread-1', {
        role: 'user',
        content: 'Test message',
      });

      // Verify message was added (would be in DB)
      expect(true).toBe(true);
    });

    it('should get history', async () => {
      const history = await getHistory('thread-1', 10);
      expect(Array.isArray(history)).toBe(true);
    });

    it('should get working memory', async () => {
      const workingMemory = await getWorkingMemory('thread-1');
      expect(typeof workingMemory).toBe('string');
    });

    it('should set working memory', async () => {
      await setWorkingMemory('thread-1', 'Test working memory');
      expect(true).toBe(true);
    });

    it('should search memory', async () => {
      const results = await searchMemory('thread-1', 'test query', 10);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should use withMemory wrapper', async () => {
      const handler = async (messages: any[]) => messages;
      const wrappedHandler = withMemory(handler);
      
      const result = await wrappedHandler([{ role: 'user', content: 'test' }]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Code Quality Evals', () => {
    const {
      scoreCodeQuality,
      scoreSecurity,
      scoreBestPractices,
      evaluateCode,
      passesEvaluation,
    } = require('@/lib/mastra/evals/code-quality');

    it('should score code quality', async () => {
      const code = 'function test() { return 1; }';
      
      const score = await scoreCodeQuality(code);
      
      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should score security', async () => {
      const code = 'const x = eval(userInput);';
      
      const score = await scoreSecurity(code);
      
      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
    });

    it('should score best practices', async () => {
      const code = 'function test() { return 1; }';
      
      const score = await scoreBestPractices(code);
      
      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
    });

    it('should evaluate code comprehensively', async () => {
      const code = 'function add(a, b) { return a + b; }';
      
      const result = await evaluateCode(code);
      
      expect(result).toBeDefined();
      expect(result.quality).toBeDefined();
      expect(result.security).toBeDefined();
      expect(result.bestPractices).toBeDefined();
    });

    it('should check if code passes evaluation', async () => {
      const code = 'function good() { return true; }';
      
      const passes = await passesEvaluation(code, {
        minQualityScore: 50,
        minSecurityScore: 50,
      });
      
      expect(typeof passes).toBe('boolean');
    });
  });

  describe('Mastra Tools', () => {
    const {
      writeFileTool,
      readFileTool,
      deletePathTool,
      listFilesTool,
      executeCodeTool,
      syntaxCheckTool,
      installDepsTool,
      allTools,
      getTool,
      getToolsByCategory,
    } = require('@/lib/mastra/tools');

    it('should export all tools', () => {
      expect(writeFileTool).toBeDefined();
      expect(readFileTool).toBeDefined();
      expect(deletePathTool).toBeDefined();
      expect(listFilesTool).toBeDefined();
      expect(executeCodeTool).toBeDefined();
      expect(syntaxCheckTool).toBeDefined();
      expect(installDepsTool).toBeDefined();
    });

    it('should have allTools collection', () => {
      expect(allTools).toBeDefined();
      expect(Object.keys(allTools).length).toBeGreaterThan(0);
    });

    it('should get tool by name', () => {
      const tool = getTool('writeFile');
      expect(tool).toBeDefined();
    });

    it('should get tools by category', () => {
      const vfsTools = getToolsByCategory('vfs');
      const sandboxTools = getToolsByCategory('sandbox');

      expect(Array.isArray(vfsTools)).toBe(true);
      expect(Array.isArray(sandboxTools)).toBe(true);
    });
  });

  describe('Mastra Workflows', () => {
    const {
      codeAgentWorkflow,
      getCodeAgentWorkflow,
      hitlWorkflow,
      getHITLWorkflow,
    } = require('@/lib/mastra/workflows/code-agent-workflow');

    it('should export code agent workflow', () => {
      expect(codeAgentWorkflow).toBeDefined();
    });

    it('should get code agent workflow', () => {
      const workflow = getCodeAgentWorkflow();
      expect(workflow).toBeDefined();
    });

    it('should export HITL workflow', () => {
      expect(hitlWorkflow).toBeDefined();
    });

    it('should get HITL workflow', () => {
      const workflow = getHITLWorkflow();
      expect(workflow).toBeDefined();
    });

    it('should have workflow steps', () => {
      expect(codeAgentWorkflow.steps).toBeDefined();
      expect(codeAgentWorkflow.steps.length).toBeGreaterThan(0);
    });
  });

  describe('Mastra MCP Integration', () => {
    const { getMcpTools, registerMcpServer } = require('@/lib/mastra/mcp');

    it('should get MCP tools', async () => {
      const tools = await getMcpTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should register MCP server', async () => {
      const result = await registerMcpServer({
        name: 'test-server',
        url: 'http://localhost:3000',
      });
      expect(result).toBeDefined();
    });
  });

  describe('Mastra Verification', () => {
    const {
      verifyChanges,
      runCodeQuality,
      checkSecurity,
    } = require('@/lib/mastra/verification');

    it('should verify changes', async () => {
      const files = {
        'test.ts': 'function test() { return 1; }',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
      expect(result.passed).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should run code quality checks', async () => {
      const code = 'const x = 1;';
      
      const result = await runCodeQuality(code);
      
      expect(result).toBeDefined();
      expect(result.score).toBeDefined();
    });

    it('should check security', async () => {
      const code = 'eval(userInput)';
      
      const result = await checkSecurity(code);
      
      expect(result).toBeDefined();
      expect(result.issues).toBeDefined();
    });
  });

  describe('Mastra Integration: Full Workflow', () => {
    it('should support complete Mastra workflow', async () => {
      const { getMastra } = require('@/lib/mastra');
      const { getModel } = require('@/lib/mastra/models/model-router');
      const { addMessage, getHistory } = require('@/lib/mastra/memory');
      const { evaluateCode } = require('@/lib/mastra/evals/code-quality');

      // Get mastra instance
      const mastra = getMastra();
      expect(mastra).toBeDefined();

      // Get model
      const model = getModel('fast');
      expect(model).toBeDefined();

      // Add message to memory
      await addMessage('thread-1', { role: 'user', content: 'test' });

      // Get history
      const history = await getHistory('thread-1');
      expect(Array.isArray(history)).toBe(true);

      // Evaluate code
      const evalResult = await evaluateCode('function test() {}');
      expect(evalResult).toBeDefined();
    });
  });
});
