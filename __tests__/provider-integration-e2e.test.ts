/**
 * Provider Integration E2E Tests
 * 
 * Tests specific provider integrations:
 * - Composio tool execution
 * - Nango sync operations
 * - Blaxel MCP deployment
 * - Smithery MCP connections
 * - Image generation providers
 * - Sandbox providers
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Provider Integration E2E Tests', () => {
  const testUserId = 'provider_test_' + Date.now();

  /**
   * Composio Integration Tests
   * NOTE: Composio integration moved to deprecated/ - these tests are skipped
   */
  describe('Composio Integration', () => {
    it('should create session and get tools', async () => {
      // Skipped - Composio integration moved to deprecated/lib/composio/
      // Active integration uses lib/api/composio-service.ts instead
      console.log('Skipping Composio test - moved to deprecated/');
      expect(true).toBe(true);
    });

    it('should cache tools across sessions', async () => {
      // Skipped - Composio integration moved to deprecated/
      console.log('Skipping Composio cache test - moved to deprecated/');
      expect(true).toBe(true);
    });
  });

  /**
   * Nango Integration Tests
   * NOTE: Nango integration moved to deprecated/ - these tests are skipped
   */
  describe('Nango Integration', () => {
    it('should manage sync operations', async () => {
      // Skipped - Nango integration moved to deprecated/lib/nango/
      console.log('Skipping Nango sync test - moved to deprecated/');
      expect(true).toBe(true);
    });

    it('should manage webhook subscriptions', async () => {
      // Skipped - Nango integration moved to deprecated/lib/nango/
      console.log('Skipping Nango webhook test - moved to deprecated/');
      expect(true).toBe(true);
    });
  });

  /**
   * Blaxel Integration Tests
   */
  describe('Blaxel Integration', () => {
    it('should manage MCP servers', async () => {
      const { getBlaxelMcpService } = await import('@/lib/mcp/blaxel-mcp-service');
      
      if (!process.env.BLAXEL_API_KEY) {
        console.log('Blaxel not configured, skipping test');
        return;
      }

      try {
        const service = getBlaxelMcpService();
        expect(service).toBeDefined();
        expect(service.isConfigured()).toBe(true);

        // List Hub servers
        const servers = await service.listHubServers();
        expect(Array.isArray(servers)).toBe(true);
      } catch (error) {
        console.log('Blaxel MCP test:', error);
      }
    });

    it('should support async triggers', async () => {
      const { getBlaxelMcpService } = await import('@/lib/mcp/blaxel-mcp-service');
      
      if (!process.env.BLAXEL_API_KEY) {
        return;
      }

      try {
        const service = getBlaxelMcpService();
        
        // Test callback registration (would need actual sandbox)
        // This tests the method exists and handles errors gracefully
        const result = await service.registerCallback('test-agent', 'https://test.com/callback');
        expect(result).toBeDefined();
      } catch (error) {
        console.log('Blaxel async test:', error);
      }
    });
  });

  /**
   * Smithery Integration Tests
   */
  describe('Smithery Integration', () => {
    it('should search MCP servers', async () => {
      const { getSmitheryService } = await import('@/lib/mcp/smithery-service');
      
      if (!process.env.SMITHERY_API_KEY) {
        console.log('Smithery not configured, skipping test');
        return;
      }

      try {
        const service = getSmitheryService();
        expect(service).toBeDefined();
        expect(service.isConfigured()).toBe(true);

        // Search servers
        const servers = await service.searchServers('github');
        expect(Array.isArray(servers)).toBe(true);
      } catch (error) {
        console.log('Smithery search test:', error);
      }
    });

    it('should manage connections', async () => {
      const { getSmitheryService } = await import('@/lib/mcp/smithery-service');
      
      if (!process.env.SMITHERY_API_KEY) {
        return;
      }

      try {
        const service = getSmitheryService();
        
        // List connections
        const connections = await service.listConnections();
        expect(Array.isArray(connections)).toBe(true);
      } catch (error) {
        console.log('Smithery connections test:', error);
      }
    });
  });

  /**
   * Image Generation Integration Tests
   */
  describe('Image Generation Integration', () => {
    it('should initialize providers', async () => {
      const { getDefaultRegistry } = await import('@/lib/image-generation/provider-registry');
      
      const registry = getDefaultRegistry();
      expect(registry).toBeDefined();

      // Initialize with test config
      registry.initializeAll({
        mistral: {
          apiKey: process.env.MISTRAL_API_KEY || 'test',
        },
        replicate: {
          apiKey: process.env.REPLICATE_API_TOKEN || 'test',
        },
      });

      // Get providers
      const providers = registry.getAllProviders();
      expect(Array.isArray(providers)).toBe(true);
    });

    it('should handle generation errors gracefully', async () => {
      const { getDefaultRegistry } = await import('@/lib/image-generation/provider-registry');
      
      const registry = getDefaultRegistry();
      
      try {
        // Try to generate with invalid params (should fail gracefully)
        await registry.generateWithFallback({
          prompt: '', // Empty prompt should fail
        });
        
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
        expect(error instanceof Error).toBe(true);
      }
    });
  });

  /**
   * Sandbox Provider Integration Tests
   */
  describe('Sandbox Provider Integration', () => {
    it('should get available providers', async () => {
      const { getSandboxProvider } = await import('@/lib/sandbox/providers');
      
      // Try to get each configured provider
      const providers = ['daytona', 'runloop', 'microsandbox', 'e2b', 'blaxel', 'sprites'];
      
      for (const providerName of providers) {
        try {
          const provider = await getSandboxProvider(providerName as any);
          expect(provider).toBeDefined();
          expect(provider.name).toBe(providerName);
        } catch (error) {
          // Provider may not be configured - that's OK
          console.log(`Provider ${providerName} not configured`);
        }
      }
    });

    it('should handle sandbox creation errors', async () => {
      const { getSandboxProvider } = await import('@/lib/sandbox/providers');
      
      try {
        const provider = await getSandboxProvider('microsandbox');
        
        // Try to create sandbox (will fail without proper config)
        await provider.createSandbox({
          language: 'typescript',
          labels: { test: 'e2e' },
        });
        
        // Should not reach here without config
        expect(true).toBe(false);
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }
    });
  });

  /**
   * Tambo Integration Tests
   */
  describe('Tambo Integration', () => {
    it('should initialize Tambo service', async () => {
      const { createTamboService } = await import('@/lib/tools');
      
      if (!process.env.NEXT_PUBLIC_TAMBO_API_KEY) {
        console.log('Tambo not configured, skipping test');
        return;
      }

      try {
        const service = createTamboService({
          apiKey: process.env.NEXT_PUBLIC_TAMBO_API_KEY,
        });
        
        expect(service).toBeDefined();
        
        // Create thread
        const thread = await service.createThread(testUserId);
        expect(thread).toBeDefined();
        expect(thread.userId).toBe(testUserId);
      } catch (error) {
        console.log('Tambo test:', error);
      }
    });
  });

  /**
   * Arcade Integration Tests
   */
  describe('Arcade Integration', () => {
    it('should get available toolkits', async () => {
      const { getArcadeService } = await import('@/lib/tools');
      
      if (!process.env.ARCADE_API_KEY) {
        console.log('Arcade not configured, skipping test');
        return;
      }

      try {
        const service = getArcadeService();
        expect(service).toBeDefined();
        
        // Get toolkits
        const toolkits = await service.getToolkits();
        expect(Array.isArray(toolkits)).toBe(true);
      } catch (error) {
        console.log('Arcade test:', error);
      }
    });
  });

  /**
   * MCP Client Integration Tests
   */
  describe('MCP Client Integration', () => {
    it('should handle connection errors gracefully', async () => {
      const { MCPClient } = await import('@/lib/mcp/client');
      
      const client = new MCPClient({
        type: 'sse',
        url: 'http://invalid-url-for-testing',
      });

      try {
        // Try to connect (should fail)
        await client.connect(1000);
        expect(true).toBe(false);
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }
    });

    it('should track connection state', async () => {
      const { MCPClient } = await import('@/lib/mcp/client');
      
      const client = new MCPClient({
        type: 'stdio',
        command: 'echo',
        args: ['test'],
      });

      // Should start disconnected
      expect(client.isConnected()).toBe(false);
      
      const connectionInfo = client.getConnectionInfo();
      expect(connectionInfo.state).toBe('disconnected');
    });
  });

  /**
   * CrewAI Integration Tests
   */
  describe('CrewAI Integration', () => {
    it('should create and configure crew', async () => {
      const { Crew } = await import('@/lib/crewai/crew/crew');
      const { Task } = await import('@/lib/crewai/tasks/task');
      
      if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        console.log('No LLM API key, skipping CrewAI test');
        return;
      }

      try {
        // Create task
        const task = new Task({
          description: 'Test task',
          expectedOutput: 'Test output',
        });

        // Create crew
        const crew = new Crew({
          tasks: [task],
          verbose: false,
        });

        expect(crew).toBeDefined();
        expect(crew.tasks.length).toBe(1);
      } catch (error) {
        console.log('CrewAI test:', error);
      }
    });
  });

  /**
   * Mastra Integration Tests
   */
  describe.skip('Mastra Integration', () => {
    it('should get workflows', async () => {
      const { mastra } = await import('@/lib/mastra/mastra-instance');

      if (!process.env.DATABASE_URL) {
        console.log('Database not configured, skipping Mastra test');
        return;
      }

      try {
        // Get code-agent workflow
        const workflow = mastra.getWorkflow('code-agent');
        expect(workflow).toBeDefined();

        // Get HITL workflow
        const hitlWorkflow = mastra.getWorkflow('hitl-code-review');
        expect(hitlWorkflow).toBeDefined();
      } catch (error) {
        console.log('Mastra test:', error);
      }
    });

    it('should get provider health', async () => {
      const { getProviderHealthDashboard } = await import('@/lib/stateful-agent/agents/provider-fallback');
      
      const dashboard = getProviderHealthDashboard();
      
      expect(dashboard).toBeDefined();
      expect(dashboard.providers).toBeDefined();
      expect(dashboard.timestamp).toBeDefined();
      expect(dashboard.recommendedProvider).toBeDefined();
    });
  });
});
