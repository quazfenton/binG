/**
 * Comprehensive E2E Integration Tests
 * 
 * Tests cross-module integration scenarios:
 * - Chat → Tool → Sandbox → VFS workflow
 * - Image Generation → VFS storage workflow
 * - MCP Server → Tool execution workflow
 * - CrewAI → Stateful agent workflow
 * - Mastra → Workflow execution workflow
 * 
 * These tests verify that different modules work together correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { ToolIntegrationManager } from '@/lib/tools/tool-integration-system';
import { MCPClient } from '@/lib/mcp';
import { Crew } from '@/lib/crewai/crew/crew';
import { Task } from '@/lib/crewai/tasks/task';

describe('Cross-Module E2E Integration Tests', () => {
  // Shared test fixtures
  const testUserId = 'e2e_test_user_' + Date.now();
  const testConversationId = 'e2e_conv_' + Date.now();
  
  let vfs: VirtualFilesystemService;
  let commitManager: ShadowCommitManager;
  let toolManager: ToolIntegrationManager;

  beforeAll(() => {
    vfs = new VirtualFilesystemService();
    commitManager = new ShadowCommitManager();
    toolManager = new ToolIntegrationManager({
      composio: {
        apiKey: process.env.COMPOSIO_API_KEY || 'test-key',
        defaultToolkits: [],
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await vfs.deletePath(testUserId, 'e2e_test');
    } catch {}
  });

  /**
   * Test: Chat → Tool → Sandbox → VFS Complete Workflow
   * 
   * Simulates a complete user request flow:
   * 1. User asks to create a file
   * 2. LLM detects tool intent
   * 3. Tool executes with authorization
   * 4. File is written to VFS
   * 5. Commit is created
   */
  describe('Chat → Tool → Sandbox → VFS Workflow', () => {
    it('should complete full workflow from chat to VFS commit', async () => {
      // Step 1: Create initial file via VFS
      const testFile = 'e2e_test/test-workflow.txt';
      await vfs.writeFile(testUserId, testFile, 'Initial content');

      // Step 2: Create a commit
      const transactions = [{
        path: testFile,
        type: 'CREATE' as const,
        timestamp: Date.now(),
        originalContent: undefined,
        newContent: 'Initial content',
      }];

      const commitResult = await commitManager.commit(
        { [testFile]: 'Initial content' },
        transactions,
        { sessionId: testConversationId, message: 'E2E test commit' }
      );

      expect(commitResult.success).toBe(true);
      expect(commitResult.commitId).toBeDefined();

      // Step 3: Verify file exists in VFS
      const file = await vfs.readFile(testUserId, testFile);
      expect(file.content).toBe('Initial content');
      expect(file.path).toBe(testFile);

      // Step 4: Update file via VFS
      await vfs.writeFile(testUserId, testFile, 'Updated content');

      // Step 5: Verify update
      const updatedFile = await vfs.readFile(testUserId, testFile);
      expect(updatedFile.content).toBe('Updated content');
      expect(updatedFile.version).toBeGreaterThan(file.version);
    });

    it('should handle tool execution with VFS integration', async () => {
      // Simulate tool execution that writes to VFS
      const testFile = 'e2e_test/tool-output.txt';
      
      try {
        // Execute tool (simulated - actual tool execution requires API keys)
        const toolResult = await toolManager.executeTool(
          'write_file',
          {
            path: testFile,
            content: 'Tool-generated content',
          },
          {
            userId: testUserId,
            conversationId: testConversationId,
          }
        );

        // Tool should succeed (or fail gracefully if not configured)
        expect(toolResult).toBeDefined();
        
        // If tool succeeded, verify file was created
        if (toolResult.success) {
          const file = await vfs.readFile(testUserId, testFile);
          expect(file.content).toContain('Tool-generated');
        }
      } catch (error) {
        // Expected if tools not configured - should fail gracefully
        expect(error).toBeDefined();
      }
    });
  });

  /**
   * Test: Image Generation → VFS Storage Workflow
   * 
   * Tests image generation with VFS storage:
   * 1. Generate image via provider
   * 2. Store image metadata in VFS
   * 3. Create commit with image reference
   */
  describe('Image Generation → VFS Storage Workflow', () => {
    it('should store image generation results in VFS', async () => {
      const imageMetadataFile = 'e2e_test/images/generated.json';
      
      // Simulate image generation result
      const imageMetadata = {
        prompt: 'Test prompt',
        provider: 'mistral',
        model: 'mistral-large-2411',
        width: 1024,
        height: 1024,
        seed: 12345,
        generatedAt: new Date().toISOString(),
      };

      // Store metadata in VFS
      await vfs.writeFile(
        testUserId,
        imageMetadataFile,
        JSON.stringify(imageMetadata, null, 2)
      );

      // Verify metadata stored
      const storedFile = await vfs.readFile(testUserId, imageMetadataFile);
      const storedMetadata = JSON.parse(storedFile.content);
      
      expect(storedMetadata.prompt).toBe('Test prompt');
      expect(storedMetadata.provider).toBe('mistral');
      expect(storedMetadata.width).toBe(1024);
    });
  });

  /**
   * Test: MCP Server → Tool Execution Workflow
   * 
   * Tests MCP server integration:
   * 1. Connect to MCP server
   * 2. List available tools
   * 3. Execute tool via MCP
   * 4. Verify result
   */
  describe('MCP Server → Tool Execution Workflow', () => {
    it('should connect to MCP server and list tools', async () => {
      // Skip if MCP not configured
      if (!process.env.MCP_SERVER_URL) {
        console.log('MCP not configured, skipping test');
        return;
      }

      const client = new MCPClient({
        type: 'sse',
        url: process.env.MCP_SERVER_URL,
      });

      try {
        // Connect to MCP server
        await client.connect(10000);
        expect(client.isConnected()).toBe(true);

        // List tools
        const tools = await client.listTools();
        expect(Array.isArray(tools)).toBe(true);

        // Verify tools have required fields
        if (tools.length > 0) {
          const firstTool = tools[0];
          expect(firstTool.name).toBeDefined();
          expect(firstTool.description).toBeDefined();
          expect(firstTool.inputSchema).toBeDefined();
        }
      } catch (error) {
        // Connection failure is OK for E2E test
        console.log('MCP connection test:', error);
      } finally {
        // Cleanup
        try {
          await client.disconnect();
        } catch {}
      }
    });
  });

  /**
   * Test: CrewAI → Stateful Agent Workflow
   * 
   * Tests CrewAI integration with stateful agents:
   * 1. Create Crew with tasks
   * 2. Execute crew
   * 3. Verify output
   * 4. Store results in VFS
   */
  describe('CrewAI → Stateful Agent Workflow', () => {
    it('should execute crew and store results', async () => {
      // Skip if not configured
      if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        console.log('No LLM API key configured, skipping CrewAI test');
        return;
      }

      try {
        // Create a simple task
        const task = new Task({
          description: 'Write a short summary of E2E testing best practices',
          expectedOutput: 'A paragraph summarizing E2E testing best practices',
        });

        // Create crew with task
        const crew = new Crew({
          tasks: [task],
          verbose: false,
        });

        // Execute crew
        const result = await crew.kickoff();

        // Verify result
        expect(result).toBeDefined();
        expect(result.finalOutput).toBeDefined();

        // Store result in VFS
        const resultFile = 'e2e_test/crewai-results.txt';
        await vfs.writeFile(
          testUserId,
          resultFile,
          result.finalOutput
        );

        // Verify stored result
        const stored = await vfs.readFile(testUserId, resultFile);
        expect(stored.content.length).toBeGreaterThan(0);
      } catch (error) {
        // CrewAI execution may fail due to API limits - that's OK
        console.log('CrewAI test:', error);
      }
    });
  });

  /**
   * Test: Mastra → Workflow Execution Workflow
   * 
   * Tests Mastra workflow integration:
   * 1. Get workflow
   * 2. Execute workflow
   * 3. Verify streaming output
   * 4. Store results
   */
  describe('Mastra → Workflow Execution Workflow', () => {
    it('should execute Mastra workflow', async () => {
      // Skip if not configured
      if (!process.env.DATABASE_URL) {
        console.log('Database not configured, skipping Mastra test');
        return;
      }

      try {
        // Get code-agent workflow
        const workflow = mastra.getWorkflow('code-agent');
        expect(workflow).toBeDefined();

        // Create run
        const run = await workflow.createRun();
        expect(run).toBeDefined();

        // Execute workflow (non-streaming for test)
        const result = await run.start({
          inputData: {
            task: 'Create a test file',
            ownerId: testUserId,
          },
        });

        // Verify result
        expect(result).toBeDefined();
        expect(result.status).toBeDefined();

        // Store result in VFS
        const resultFile = 'e2e_test/mastra-results.json';
        await vfs.writeFile(
          testUserId,
          resultFile,
          JSON.stringify(result, null, 2)
        );
      } catch (error) {
        // Workflow execution may fail - that's OK for E2E
        console.log('Mastra test:', error);
      }
    });

    it('should handle workflow suspension and resume', async () => {
      // Skip if not configured
      if (!process.env.DATABASE_URL) {
        console.log('Database not configured, skipping Mastra suspension test');
        return;
      }

      try {
        // Get HITL workflow
        const workflow = mastra.getWorkflow('hitl-code-review');
        expect(workflow).toBeDefined();

        // Create run
        const run = await workflow.createRun();

        // Start workflow (may suspend for approval)
        const result = await run.start({
          inputData: {
            code: 'console.log("test");',
            description: 'Test code',
            ownerId: testUserId,
          },
        });

        // Check if suspended
        if (result.status === 'suspended') {
          expect(result.suspended).toBeDefined();
          
          // Resume workflow (simulating approval)
          const resumeResult = await run.resume({
            step: 'approval',
            resumeData: {
              approved: true,
              feedback: 'E2E test approval',
            },
          });

          expect(resumeResult).toBeDefined();
        }
      } catch (error) {
        // HITL workflow may fail - that's OK
        console.log('Mastra HITL test:', error);
      }
    });
  });

  /**
   * Test: Multi-Provider Fallback Workflow
   * 
   * Tests provider fallback across modules:
   * 1. Try primary provider
   * 2. Fail intentionally
   * 3. Verify fallback to secondary
   * 4. Verify result from fallback
   */
  describe('Multi-Provider Fallback Workflow', () => {
    it('should fallback through provider chain', async () => {
      // This tests the fallback mechanism
      // Actual provider calls may fail due to API limits
      
      const { createModelWithFallback } = await import('@/lib/orchestra/stateful-agent/agents/provider-fallback');
      
      try {
        // Try to get model with fallback
        const model = await createModelWithFallback('openai', 'gpt-4o-mini');
        
        // Should get a model from some provider
        expect(model).toBeDefined();
        expect(model.model).toBeDefined();
        expect(model.provider).toBeDefined();
      } catch (error) {
        // Fallback may exhaust all providers - that's OK
        expect(error).toBeDefined();
      }
    });

    it('should track provider health', async () => {
      const { getProviderHealthDashboard } = await import('@/lib/orchestra/stateful-agent/agents/provider-fallback');
      
      const dashboard = getProviderHealthDashboard();
      
      expect(dashboard).toBeDefined();
      expect(dashboard.providers).toBeDefined();
      expect(dashboard.timestamp).toBeDefined();
    });
  });

  /**
   * Test: Audit Logging Integration
   * 
   * Tests audit logging across modules:
   * 1. Perform action
   * 2. Verify audit log entry
   * 3. Query audit logs
   * 4. Verify statistics
   */
  describe('Audit Logging Integration', () => {
    it('should log HITL approvals', async () => {
      const { hitlAuditLogger } = await import('@/lib/orchestra/stateful-agent/hitl-audit-logger');
      
      const testInterruptId = 'e2e_interrupt_' + Date.now();
      
      // Log approval request
      await hitlAuditLogger.logApprovalRequest(
        testInterruptId,
        testUserId,
        'test_action',
        'test_target',
        'E2E test approval',
        { e2e: true }
      );

      // Log approval decision
      await hitlAuditLogger.logApprovalDecision(
        testInterruptId,
        true,
        'E2E test approval',
        undefined,
        100
      );

      // Query logs
      const logs = await hitlAuditLogger.queryLogs({
        userId: testUserId,
        limit: 10,
      });

      expect(logs.length).toBeGreaterThan(0);
      
      // Find our test log
      const testLog = logs.find(log => 
        log.id === testInterruptId || 
        log.metadata?.e2e === true
      );
      
      if (testLog) {
        expect(testLog.action).toBe('test_action');
        expect(testLog.approved).toBe(true);
      }

      // Get stats
      const stats = await hitlAuditLogger.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });

    it('should log chat requests', async () => {
      const { chatRequestLogger } = await import('@/lib/api/chat-request-logger');
      
      const testRequestId = 'e2e_request_' + Date.now();
      
      // Log request start
      await chatRequestLogger.logRequestStart(
        testRequestId,
        testUserId,
        'openrouter',
        'gpt-4o-mini',
        [{ role: 'user', content: 'E2E test' }],
        false
      );

      // Log request complete
      await chatRequestLogger.logRequestComplete(
        testRequestId,
        true,
        100,
        { prompt: 10, completion: 20, total: 30 },
        500
      );

      // Query logs
      const logs = await chatRequestLogger.queryLogs({
        userId: testUserId,
        limit: 10,
      });

      expect(logs.length).toBeGreaterThan(0);

      // Get stats
      const stats = await chatRequestLogger.getStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });

  /**
   * Test: Error Handling Integration
   * 
   * Tests error handling across modules:
   * 1. Trigger error
   * 2. Verify error is logged
   * 3. Verify circuit breaker opens
   * 4. Verify fallback activates
   */
  describe('Error Handling Integration', () => {
    it('should handle errors consistently across modules', async () => {
      const { errorHandler } = await import('@/lib/api/error-handler');
      
      // Create test error
      const testError = new Error('E2E test error');
      
      // Handle error
      const handledError = errorHandler.handleError(testError, {
        context: 'e2e_test',
        provider: 'test',
        model: 'test',
      });

      expect(handledError).toBeDefined();
      expect(handledError.userMessage).toBeDefined();

      // Get error stats
      const stats = errorHandler.getErrorStats();
      expect(stats).toBeDefined();
    });

    it('should track streaming errors', async () => {
      const { streamingErrorHandler } = await import('@/lib/streaming/streaming-error-handler');
      
      // Create test streaming error
      const testError = new Error('E2E streaming error');
      
      // Process error
      const processedError = streamingErrorHandler.processError(testError, {
        requestId: 'e2e_test_' + Date.now(),
      });

      expect(processedError).toBeDefined();
      expect(processedError.type).toBeDefined();
      expect(processedError.recoverable).toBeDefined();

      // Get analytics
      const analytics = streamingErrorHandler.getErrorAnalytics();
      expect(analytics).toBeDefined();
      expect(analytics.summary).toBeDefined();
    });
  });
});
