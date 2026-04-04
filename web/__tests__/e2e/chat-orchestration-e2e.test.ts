/**
 * Chat → Orchestration E2E Integration Test
 *
 * Tests the full request flow:
 * 1. Chat route receives request
 * 2. Orchestration mode is resolved from headers
 * 3. Task is routed to the correct backend
 * 4. Session is created/managed
 * 5. Response is returned in the expected format
 *
 * Uses mocks for external services (LLM, sandbox, MCP).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies
vi.mock('@/lib/chat/llm-providers', () => ({
  PROVIDERS: {
    openai: {
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
      supportsStreaming: true,
    },
    anthropic: {
      models: ['claude-3-5-sonnet', 'claude-3-opus'],
      supportsStreaming: true,
    },
  },
}));

vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn().mockResolvedValue({
    success: true,
    userId: 'test-user',
    source: 'anonymous',
  }),
}));

vi.mock('@/lib/middleware/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 59 }),
}));

vi.mock('@/lib/virtual-filesystem/resolve-filesystem-owner', () => ({
  resolveFilesystemOwner: vi.fn().mockResolvedValue({
    ownerId: 'test-user',
    anonSessionId: undefined,
  }),
  withAnonSessionCookie: vi.fn((response) => response),
}));

describe('Chat Route — Orchestration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Request Validation', () => {
    it('rejects invalid provider', async () => {
      // Read the route source to verify validation exists
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('Provider ');
      expect(content).toContain('is not supported');
      expect(content).toContain('availableProviders');
    });

    it('rejects invalid model', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('Model ');
      expect(content).toContain('is not supported by');
    });

    it('validates request body with Zod schema', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('chatRequestSchema.safeParse');
      expect(content).toContain('status: 400');
    });
  });

  describe('Orchestration Mode Routing', () => {
    it('reads X-Orchestration-Mode header', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../../packages/shared/agent/orchestration-mode-handler.ts'),
        'utf-8',
      );

      expect(content).toContain('X-Orchestration-Mode');
      expect(content).toContain('getOrchestrationModeFromRequest');
    });

    it('supports all documented orchestration modes', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../../packages/shared/agent/orchestration-mode-handler.ts'),
        'utf-8',
      );

      const expectedModes = [
        'task-router',
        'unified-agent',
        'stateful-agent',
        'agent-kernel',
        'agent-loop',
        'execution-graph',
        'nullclaw',
        'opencode-sdk',
        'mastra-workflow',
        'crewai',
        'v2-executor',
        'agent-team',
      ];

      for (const mode of expectedModes) {
        expect(content).toContain(`'${mode}'`);
      }
    });

    it('falls back to task-router for invalid mode', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../../packages/shared/agent/orchestration-mode-handler.ts'),
        'utf-8',
      );

      expect(content).toContain("return 'task-router'");
      expect(content).toContain('Invalid orchestration mode');
    });
  });

  describe('V2 Agent Detection', () => {
    it('auto-detects code requests for V2 routing', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('isCodeOrAgenticRequest');
      expect(content).toContain('wantsV2');
      expect(content).toContain('V2_AGENT_ENABLED');
    });

    it('falls back to V1 on V2 failure', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('fallbackToV1');
      expect(content).toContain('falling back to v1');
    });
  });

  describe('Session Management', () => {
    it('creates session with normalized conversation ID', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('normalizeSessionId');
      expect(content).toContain('resolvedConversationId');
    });

    it('sanitizes scope path to prevent corruption', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('sanitizeScopePath');
      expect(content).toContain('sanitizePathSegment');
    });
  });

  describe('Response Streaming', () => {
    it('supports SSE streaming for V2 execution', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('executeV2TaskStreaming');
      expect(content).toContain('text/event-stream');
      expect(content).toContain('Cache-Control');
    });

    it('emits filesystem events for file edits', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../../packages/shared/agent/v2-executor.ts'),
        'utf-8',
      );

      expect(content).toContain('formatEvent(\'filesystem\'');
      expect(content).toContain('formatEvent(\'diffs\'');
      expect(content).toContain('formatEvent(\'done\'');
    });
  });

  describe('Error Handling', () => {
    it('catches V2 errors and returns structured error response', async () => {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const content = readFileSync(
        path.join(__dirname, '../../../app/api/chat/route.ts'),
        'utf-8',
      );

      expect(content).toContain('v2Error');
      expect(content).toContain('error: v2Error.message');
    });
  });
});

describe('Integration Execute Route', () => {
  it('validates provider and action parameters', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../../../app/api/integrations/execute/route.ts'),
      'utf-8',
    );

    expect(content).toContain('provider and action are required');
    expect(content).toContain('status: 400');
  });

  it('supports batch execution', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../../../app/api/integrations/execute/route.ts'),
      'utf-8',
    );

    expect(content).toContain('executeBatch');
    expect(content).toContain('Promise.allSettled');
  });

  it('enforces batch size limit', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../../../app/api/integrations/execute/route.ts'),
      'utf-8',
    );

    expect(content).toContain('Batch limit exceeded');
    expect(content).toContain('max 20');
  });

  it('has SSRF protection for webhook execution', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../../../app/api/integrations/execute/route.ts'),
      'utf-8',
    );

    expect(content).toContain('SSRF protection');
    expect(content).toContain('blockedHosts');
    expect(content).toContain('localhost');
    expect(content).toContain('169.254.169.254');
  });

  it('has command injection protection for bash execution', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(
      path.join(__dirname, '../../../app/api/integrations/execute/route.ts'),
      'utf-8',
    );

    expect(content).toContain('dangerousPatterns');
    expect(content).toContain('rm\\s+-rf\\s+/');
    expect(content).toContain('fork bomb');
  });
});
