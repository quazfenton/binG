/**
 * V2 Agent Integration Tests
 * 
 * Comprehensive test suite for V2 agent architecture including:
 * - Session lifecycle management
 * - VFS ↔ Sandbox sync
 * - Nullclaw integration
 * - MCP CLI server
 * - Streaming responses
 * - Regression tests for V1 flow
 * 
 * Prerequisites:
 * - Docker running
 * - Environment variables configured (see .env.test)
 * - MCP CLI server accessible (if testing MCP)
 * - Nullclaw service running (if testing Nullclaw)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';

// Test configuration
const TEST_CONFIG = {
  userId: 'test-user-v2',
  conversationId: `test-conv-${Date.now()}`,
  apiBaseUrl: process.env.TEST_API_BASE_URL || 'http://localhost:3000',
  timeout: {
    session: 30000,
    execution: 60000,
    sync: 15000,
    streaming: 45000,
  },
};

// Test state
let sessionToken: string | null = null;
let sessionId: string | null = null;
let v2SessionId: string | null = null;

// ============================================================================
// Utility Functions
// ============================================================================

async function makeApiRequest<T>(
  endpoint: string,
  method: string = 'GET',
  data?: any,
  headers: Record<string, string> = {}
): Promise<T> {
  const url = `${TEST_CONFIG.apiBaseUrl}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function createV2Session(): Promise<{ sessionId: string; v2SessionId: string }> {
  const result = await makeApiRequest<{ success: boolean; data: any }>(
    '/api/agent/v2/session',
    'POST',
    {
      conversationId: TEST_CONFIG.conversationId,
      enableNullclaw: process.env.NULLCLAW_ENABLED === 'true',
      enableMCP: process.env.MCP_ENABLED === 'true',
    }
  );

  if (!result.success) {
    throw new Error('Failed to create V2 session');
  }

  return {
    sessionId: result.data.sessionId,
    v2SessionId: result.data.v2SessionId,
  };
}

async function destroyV2Session(sessionIdToDelete: string): Promise<void> {
  try {
    await makeApiRequest(
      `/api/agent/v2/session?sessionId=${sessionIdToDelete}`,
      'DELETE'
    );
  } catch (error) {
    console.warn('Failed to destroy test session:', error);
  }
}

// ============================================================================
// Test Suite: V2 Session Lifecycle
// ============================================================================

describe('V2 Agent Session Management', () => {
  beforeAll(async () => {
    // Ensure clean state
    sessionToken = null;
    sessionId = null;
    v2SessionId = null;
  });

  afterAll(async () => {
    // Cleanup: destroy test session
    if (sessionId) {
      await destroyV2Session(sessionId);
    }
  });

  describe('Session Creation', () => {
    it('should create a new V2 session with UUID', async () => {
      const { sessionId: newSessionId, v2SessionId: newV2SessionId } = await createV2Session();

      expect(newSessionId).toBeDefined();
      expect(newSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      expect(newV2SessionId).toBeDefined();
      expect(newV2SessionId).toMatch(/^v2-/);

      sessionId = newSessionId;
      v2SessionId = newV2SessionId;
    }, TEST_CONFIG.timeout.session);

    it('should return session with workspace path', async () => {
      const result = await makeApiRequest<{ success: boolean; data: any }>(
        `/api/agent/v2/session?sessionId=${sessionId}`,
        'GET'
      );

      expect(result.success).toBe(true);
      expect(result.data.workspacePath).toBeDefined();
      expect(result.data.workspacePath).toContain(TEST_CONFIG.userId);
      expect(result.data.workspacePath).toContain(TEST_CONFIG.conversationId);
    }, TEST_CONFIG.timeout.session);

    it('should have synchronized state between AgentSessionManager and OpenCodeV2SessionManager', async () => {
      const result = await makeApiRequest<{ success: boolean; data: any }>(
        `/api/agent/v2/session/status?sessionId=${sessionId}`,
        'GET'
      );

      expect(result.success).toBe(true);
      expect(result.data.agentState).toBeDefined();
      expect(result.data.v2State).toBeDefined();
      
      // States should be mapped correctly
      const stateMapping: Record<string, string[]> = {
        'ready': ['active'],
        'busy': ['active'],
        'idle': ['idle'],
        'error': ['stopped'],
      };
      
      const expectedV2States = stateMapping[result.data.agentState] || [];
      expect(expectedV2States).toContain(result.data.v2State);
    }, TEST_CONFIG.timeout.session);
  });

  describe('Session ID Resolution', () => {
    it('should resolve session by UUID without split(:) logic', async () => {
      // This tests the fix for the sessionId.split(':') bug
      const result = await makeApiRequest<{ success: boolean; data: any }>(
        `/api/agent/v2/session?sessionId=${sessionId}`,
        'GET'
      );

      expect(result.success).toBe(true);
      expect(result.data.sessionId).toBe(sessionId);
      expect(result.data.v2SessionId).toBe(v2SessionId);
    }, TEST_CONFIG.timeout.session);

    it('should accept explicit conversationId parameter', async () => {
      const result = await makeApiRequest<{ success: boolean; data: any }>(
        `/api/agent/v2/session?conversationId=${TEST_CONFIG.conversationId}`,
        'GET'
      );

      expect(result.success).toBe(true);
      expect(result.data.conversationId).toBe(TEST_CONFIG.conversationId);
    }, TEST_CONFIG.timeout.session);
  });
});

// ============================================================================
// Test Suite: VFS ↔ Sandbox Sync
// ============================================================================

describe('VFS ↔ Sandbox Synchronization', () => {
  const testFilePath = 'project/test-vfs-sync.txt';
  const testContent = `Test content generated at ${Date.now()}`;

  beforeEach(async () => {
    // Ensure session exists
    if (!sessionId) {
      const { sessionId: newSessionId, v2SessionId: newV2SessionId } = await createV2Session();
      sessionId = newSessionId;
      v2SessionId = newV2SessionId;
    }
  });

  it('should sync VFS files to sandbox before execution', async () => {
    // Step 1: Write file to VFS
    const writeResult = await makeApiRequest<{ success: boolean; data: any }>(
      '/api/filesystem/write',
      'POST',
      {
        path: testFilePath,
        content: testContent,
        sessionId: sessionId,
      }
    );

    expect(writeResult.success).toBe(true);
    expect(writeResult.data.path).toBe(testFilePath);

    // Step 2: Trigger sync to sandbox
    const syncResult = await makeApiRequest<{ success: boolean; data: any }>(
      '/api/agent/v2/sync',
      'POST',
      {
        sessionId: sessionId,
        direction: 'to-sandbox',
      }
    );

    expect(syncResult.success).toBe(true);
    expect(syncResult.data.filesSynced).toBeGreaterThan(0);
  }, TEST_CONFIG.timeout.sync);

  it('should sync sandbox changes back to VFS after execution', async () => {
    // Step 1: Execute task that modifies filesystem
    const executeResult = await makeApiRequest<{ success: boolean; data: any }>(
      '/api/agent/v2/execute',
      'POST',
      {
        sessionId: sessionId,
        task: 'Create a file named project/test-output.txt with content "Hello from V2 agent"',
        stream: false,
      }
    );

    expect(executeResult.success).toBe(true);
    expect(executeResult.data.output).toBeDefined();

    // Step 2: Verify file exists in VFS
    const readResult = await makeApiRequest<{ success: boolean; data: any }>(
      '/api/filesystem/read',
      'POST',
      {
        path: 'project/test-output.txt',
      }
    );

    expect(readResult.success).toBe(true);
    expect(readResult.data.content).toContain('Hello from V2 agent');
  }, TEST_CONFIG.timeout.execution);

  it('should emit filesystem-updated event after sync', async () => {
    // This test requires browser environment or event listener mock
    // For now, verify that the sync response includes event metadata
    const syncResult = await makeApiRequest<{ success: boolean; data: any }>(
      '/api/agent/v2/sync',
      'POST',
      {
        sessionId: sessionId,
        direction: 'bidirectional',
      }
    );

    expect(syncResult.success).toBe(true);
    expect(syncResult.data.workspaceVersion).toBeDefined();
  }, TEST_CONFIG.timeout.sync);
});

// ============================================================================
// Test Suite: Nullclaw Integration
// ============================================================================

describe('Nullclaw Integration', () => {
  const isNullclawEnabled = process.env.NULLCLAW_ENABLED === 'true';

  it.skipIf(!isNullclawEnabled)(
    'should execute task through Nullclaw when enabled',
    async () => {
      if (!sessionId) {
        const { sessionId: newSessionId } = await createV2Session();
        sessionId = newSessionId;
      }

      const executeResult = await makeApiRequest<{ success: boolean; data: any }>(
        '/api/agent/v2/execute',
        'POST',
        {
          sessionId: sessionId,
          task: 'Send a test message via Nullclaw',
          preferredAgent: 'nullclaw',
        }
      );

      expect(executeResult.success).toBe(true);
      expect(executeResult.data.agent).toBe('nullclaw');
      expect(executeResult.data.nullclawResponse).toBeDefined();
    },
    TEST_CONFIG.timeout.execution
  );

  it.skipIf(!isNullclawEnabled)(
    'should use NULLCLAW_URL environment variable when set',
    async () => {
      // Verify NULLCLAW_URL is configured
      expect(process.env.NULLCLAW_URL).toBeDefined();
      expect(process.env.NULLCLAW_URL).toMatch(/^https?:\/\//);

      // Test health endpoint
      const healthUrl = `${process.env.NULLCLAW_URL}/health`;
      const response = await fetch(healthUrl);
      
      expect(response.ok).toBe(true);
    },
    TEST_CONFIG.timeout.execution
  );
});

// ============================================================================
// Test Suite: MCP CLI Server
// ============================================================================

describe('MCP CLI Server', () => {
  const isMcpEnabled = process.env.MCP_ENABLED === 'true';
  const mcpPort = process.env.MCP_CLI_PORT || '8888';
  const mcpUrl = `http://localhost:${mcpPort}`;

  it.skipIf(!isMcpEnabled)(
    'should have MCP CLI server running',
    async () => {
      const response = await fetch(`${mcpUrl}/health`);
      expect(response.ok).toBe(true);
    },
    5000
  );

  it.skipIf(!isMcpEnabled)(
    'should require authentication token when MCP_HTTP_AUTH_TOKEN is set',
    async () => {
      if (!process.env.MCP_HTTP_AUTH_TOKEN) {
        console.log('Skipping auth test - MCP_HTTP_AUTH_TOKEN not set');
        return;
      }

      // Test without token (should fail)
      const responseNoAuth = await fetch(`${mcpUrl}/tools`);
      expect(responseNoAuth.status).toBe(401);

      // Test with token (should succeed)
      const responseWithAuth = await fetch(`${mcpUrl}/tools`, {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN}`,
        },
      });
      expect(responseWithAuth.ok).toBe(true);
    },
    5000
  );

  it.skipIf(!isMcpEnabled)(
    'should discover MCP tools',
    async () => {
      const response = await fetch(`${mcpUrl}/tools`, {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN || ''}`,
        },
      });

      const data = await response.json();
      expect(data.tools).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.length).toBeGreaterThan(0);
    },
    5000
  );
});

// ============================================================================
// Test Suite: Streaming Responses
// ============================================================================

describe('V2 Streaming Responses', () => {
  it('should return SSE stream when stream=true', async () => {
    if (!sessionId) {
      const { sessionId: newSessionId } = await createV2Session();
      sessionId = newSessionId;
    }

    const response = await fetch(`${TEST_CONFIG.apiBaseUrl}/api/agent/v2/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionId,
        task: 'Count from 1 to 5',
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-cache');

    // Read and verify SSE format
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const events: string[] = [];

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('event:')) {
            events.push(line.replace('event:', '').trim());
          }
        }
      }
    }

    // Verify SSE events
    expect(events).toContain('init');
    expect(events).toContain('token');
    expect(events).toContain('done');
  }, TEST_CONFIG.timeout.streaming);

  it('should return JSON when stream=false', async () => {
    if (!sessionId) {
      const { sessionId: newSessionId } = await createV2Session();
      sessionId = newSessionId;
    }

    const response = await fetch(`${TEST_CONFIG.apiBaseUrl}/api/agent/v2/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionId,
        task: 'Say hello',
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.output).toBeDefined();
  }, TEST_CONFIG.timeout.execution);
});

// ============================================================================
// Test Suite: Regression Tests (V1 Flow)
// ============================================================================

describe('V1 Chat Flow Regression', () => {
  it('should work with agentMode: v1', async () => {
    const response = await fetch(`${TEST_CONFIG.apiBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello, this is a V1 test' }],
        agentMode: 'v1',
      }),
    });

    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.messages).toBeDefined();
    expect(data.messages.length).toBeGreaterThan(0);
  }, 30000);

  it('should work with agentMode unset (defaults to auto)', async () => {
    const response = await fetch(`${TEST_CONFIG.apiBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello, this is an auto-detect test' }],
      }),
    });

    expect(response.ok).toBe(true);
  }, 30000);

  it('should route to V2 when agentMode: v2 and V2_AGENT_ENABLED=true', async () => {
    const v2Enabled = process.env.V2_AGENT_ENABLED === 'true' || process.env.OPENCODE_CONTAINERIZED === 'true';
    
    if (!v2Enabled) {
      console.log('Skipping V2 routing test - V2 not enabled in environment');
      return;
    }

    const response = await fetch(`${TEST_CONFIG.apiBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Create a React component' }],
        agentMode: 'v2',
      }),
    });

    // V2 may return different structure than V1
    expect(response.ok).toBe(true);
  }, TEST_CONFIG.timeout.execution);
});

// ============================================================================
// Test Suite: Session Manager Consolidation
// ============================================================================

describe('Session Manager State Consistency', () => {
  it('should update both AgentSession and OpenCodeV2Session states', async () => {
    if (!sessionId) {
      const { sessionId: newSessionId } = await createV2Session();
      sessionId = newSessionId;
    }

    // Get initial state
    const statusBefore = await makeApiRequest<{ success: boolean; data: any }>(
      `/api/agent/v2/session/status?sessionId=${sessionId}`,
      'GET'
    );

    expect(statusBefore.success).toBe(true);
    const initialAgentState = statusBefore.data.agentState;
    const initialV2State = statusBefore.data.v2State;

    // Execute task (should set state to 'busy'/'active')
    await makeApiRequest(
      '/api/agent/v2/execute',
      'POST',
      {
        sessionId: sessionId,
        task: 'Echo test',
        stream: false,
      }
    );

    // Get state after
    const statusAfter = await makeApiRequest<{ success: boolean; data: any }>(
      `/api/agent/v2/session/status?sessionId=${sessionId}`,
      'GET'
    );

    expect(statusAfter.success).toBe(true);
    
    // State should have transitioned through busy/active
    // Note: May already be back to ready/idle if execution was fast
    expect(['ready', 'busy', 'idle']).toContain(statusAfter.data.agentState);
    expect(['active', 'idle']).toContain(statusAfter.data.v2State);
  }, TEST_CONFIG.timeout.execution);

  it('should cleanup both sessions on destroy', async () => {
    const { sessionId: tempSessionId, v2SessionId: tempV2SessionId } = await createV2Session();

    // Destroy session
    await destroyV2Session(tempSessionId);

    // Verify session is gone
    try {
      await makeApiRequest(
        `/api/agent/v2/session?sessionId=${tempSessionId}`,
        'GET'
      );
      // If we get here without error, check if session is actually gone
      fail('Session should have been destroyed');
    } catch (error: any) {
      expect(error.message).toContain('404');
    }
  }, TEST_CONFIG.timeout.session);
});
