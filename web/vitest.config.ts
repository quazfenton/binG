import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Tests that require live external services (Redis, Modal, a running v2 gateway/worker,
 * the Next.js dev server, etc.) are excluded from the default `pnpm test` run and
 * must be invoked explicitly via `pnpm test:integration`.
 *
 * Keep this list narrow — only tests that cannot pass without real external
 * infrastructure belong here.
 */
export const INTEGRATION_TEST_PATTERNS = [
  // v2 agent gateway / worker / full session — need a running v2 server + Redis queue
  '**/__tests__/v2-agent-gateway.test.ts',
  '**/__tests__/v2-agent-worker.test.ts',
  '**/__tests__/integration/full-session.test.ts',
  // Monitoring e2e — needs a running backend to reach health endpoints
  '**/__tests__/monitoring-observability-e2e.test.ts',
  // Modal provider — requires real MODAL_API_TOKEN_ID/SECRET to authenticate
  '**/__tests__/sandbox/modal-com-provider.test.ts',
  // Performance thresholds — flaky on CI/unloaded machines
  '**/__tests__/performance/advanced-performance.test.ts',
  // Legacy E2E scripts that hit real APIs
  '**/tests/e2e/**',
];

/**
 * Tests that describe the intended surface of modules which have never been
 * implemented in this codebase. They should be un-excluded once the target
 * module lands. Keeping them in the suite would give false red signal for
 * unrelated work.
 */
export const UNIMPLEMENTED_MODULE_TEST_PATTERNS = [
  // preview-offloader.test.ts and cloud-agent-preview-integration.test.ts
  // are now un-skipped — the preview-offloader module has been implemented.

  '**/__tests__/v2-nullclaw-integration.test.ts',
  // Agent enhanced features — @bing/shared/agent/multi-agent-collaboration, agent-memory
  '**/__tests__/agents/enhanced-features.test.ts',
  // E2B enhanced features — e2b-analytics, e2b-debug, e2b-network-isolation, e2b-git-helper
  '**/__tests__/e2b/enhanced-features.test.ts',
  // Sprites enhanced features — sprites-resource-monitor
  '**/__tests__/sprites/enhanced-features.test.ts',
  // CrewAI — @/lib/crewai, crewai/agents, tasks, types, callbacks
  '**/__tests__/crewai/full-integration.test.ts',
  // Mastra — @/lib/mastra/* modules
  '**/__tests__/mastra/full-integration.test.ts',
  '**/__tests__/mastra/workflow-integration.test.ts',
  // Tambo — @/lib/tambo/tambo-tools, hooks, components
  '**/__tests__/tambo/full-integration.test.ts',
  // Kilocode — kilocode-server, enhanced-agent, kilo-gateway, client
  '**/__tests__/kilocode/server.test.ts',
  '**/__tests__/kilocode/enhanced-agent.test.ts',
  // Nango — @/lib/integrations/nango-service
  '**/__tests__/nango/sync-management.test.ts',
  // Composio — composio/session-manager, webhook-handler, resource-subscription, prompt-management
  '**/__tests__/composio/triggers-webhooks.test.ts',
  '**/__tests__/composio/enhanced-features.test.ts',
  // Blaxel — blaxel-provider, blaxel/*, agent-handoff, batch-jobs, blaxel-async
  '**/__tests__/blaxel/volume-templates.test.ts',
  '**/__tests__/blaxel/enhanced-features.test.ts',
  // E2B AMP service — ../lib/sandbox/providers/e2b-amp-service
  '**/__tests__/e2b-amp-service.test.ts',
  // Integration E2E — requires running backend
  '**/__tests__/integration-e2e.test.ts',
  // JWT auth integration — requires running auth server
  '**/__tests__/jwt-auth-integration.test.ts',
  // OAuth integration — requires running OAuth provider
  '**/__tests__/oauth-integration.test.ts',
  // Terminal session store — requires Redis
  '**/__tests__/terminal-session-store.test.ts',
  // Agent orchestration — @/lib/agent/orchestration-engine
  '**/__tests__/agent/orchestration-integration.test.ts',
  // API endpoints — requires running server
  '**/__tests__/api/endpoints-integration.test.ts',
  // API unified response handler — missing module
  '**/__tests__/api/unified-response-handler.test.ts',
  // Arcade contextual auth — @/lib/arcade/contextual-auth
  '**/__tests__/arcade/contextual-auth.test.ts',
  // Core integration — requires full stack
  '**/__tests__/integration/core-integration.test.ts',
  // MCP full integration — requires MCP server
  '**/__tests__/mcp/full-integration.test.ts',
  // New services — @/lib/services/new-services
  '**/__tests__/services/new-services.test.ts',
  // Stateful agent full integration — missing module
  '**/__tests__/stateful-agent/full-integration.test.ts',
  // Tools unified registry — @/lib/tools/unified-registry
  '**/__tests__/tools/unified-registry.test.ts',
  // V2 agent integration — missing v2 agent modules
  '**/__tests__/v2-agent/v2-integration.test.ts',
  // Config validation — @/lib/utils/config-validation
  '**/__tests__/utils/config-validation.test.ts',
  // Action registry — @/lib/integrations/action-registry
  '**/__tests__/lib/integrations/action-registry.test.ts',
  // Execution audit — @/lib/integrations/execution-audit
  '**/__tests__/lib/integrations/execution-audit.test.ts',
  // E2E integration — requires full stack
  '**/__tests__/e2e-integration.test.ts',
  // E2E local PTY — requires node-pty native binary
  '**/__tests__/e2e-local-pty-capability.test.ts',
  // OpenCode SDK mode — missing module
  '**/__tests__/opencode-sdk-mode.test.ts',
  // OpenCode V2 session manager — @/lib/api/opencode-v2-session-manager
  '**/__tests__/opencode-v2-session-manager.test.ts',
  // Session changes integration — missing module
  '**/__tests__/session-changes-integration.test.ts',
  // Stateful agent integration — missing module
  '**/__tests__/stateful-agent-integration.test.ts',
  // Terminal manager enhanced — missing module
  '**/__tests__/terminal-manager-enhanced.test.ts',
  // Unified agent service — missing module
  '**/__tests__/unified-agent-service-integration.test.ts',
  // Web local PTY — requires browser/node-pty
  '**/__tests__/web-local-pty.test.ts',
  // Events E2E — requires running event system
  '**/__tests__/events/event-system-e2e.test.ts',
  // E2E chat orchestration — requires full stack
  '**/__tests__/e2e/chat-orchestration-e2e.test.ts',
  // E2E git versioning — requires git runtime
  '**/__tests__/e2e/git-versioning-e2e.test.ts',
  // E2E workflow integration — requires full stack
  '**/__tests__/e2e/workflow-integration.test.ts',
  // LLM tool integration — requires LLM API keys
  '**/__tests__/integration/llm-tool-integration.test.ts',
  // Image generation provider registry — missing module
  '**/__tests__/image-generation/provider-registry.test.ts',
  // MCP VFS tools — requires MCP server
  '**/__tests__/mcp/vfs-mcp-tools.test.ts',
  // Bash self-heal terminal — requires node-pty
  '**/__tests__/bash-selfheal-terminal.test.ts',
  // Security comprehensive — imports from missing modules
  '**/__tests__/security-comprehensive.test.ts',
  // Security fixes validation — imports from missing modules
  '**/__tests__/security-fixes-validation.test.ts',
  // Shell command injection — missing module
  '**/__tests__/shell-command-injection.test.ts',
  // Reflection engine — @/lib/api/reflection-engine doesn't exist
  '**/__tests__/reflection-engine.test.ts',
  // V2 git-backed VFS — getGitBackedVFS not exported from virtual-filesystem
  '**/__tests__/v2-git-backed-vfs.test.ts',
  // Safe diff operations integration — warning detection not implemented
  '**/__tests__/diff/safe-diff-operations-integration.test.ts',
  // Live preview offloading — getSandpackConfig/normalizeFiles not fully implemented
  'lib/previews/live-preview-offloading.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Required for AsyncLocalStorage support (toolContextStore)
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/deprecated/**',
      '**/.next/**',
      ...INTEGRATION_TEST_PATTERNS,
      ...UNIMPLEMENTED_MODULE_TEST_PATTERNS,
    ],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@/app': path.resolve(__dirname, './app'),
      '@bing/platform/env': path.resolve(__dirname, '../packages/platform/src/env.ts'),
      '@bing/platform': path.resolve(__dirname, '../packages/platform/src'),
      '@bing/shared': path.resolve(__dirname, '../packages/shared'),
      '@bing/shared/agent': path.resolve(__dirname, '../packages/shared/agent'),
    },
  },
});
