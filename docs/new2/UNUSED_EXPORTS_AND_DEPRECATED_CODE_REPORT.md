 343                                                                                                           │
  │    344 | Category | Count | Files |                                                                              │
  │    345 |----------|-------|-------|                                                                              │
  │    346 | Webhook Handlers | 18 | `app/api/webhooks/nango/route.ts` |                                             │
  │    347 | VPS Deployment | 4 | `lib/services/vps-deployment.ts` |                                                 │
  │    348 | Authentication | 1 | `app/api/auth/reset-password/route.ts` |                                           │
  │    349 | Workflow Execution | 1 | `app/api/agent/workflows/route.ts` |                                           │
  │    350 | Composio Webhooks | 3 | `lib/composio/webhook-handler.ts` |                                             │
  │    351 | CSP Reporting | 2 | `app/api/csp-report/route.ts` |                                                     │
  │    352 | SRI Hashes | 8 | `lib/security/sri-generator.ts` |                                                      │
  │    353 | Other | 27 | Various files |                                                                            │
  │    354 | **Total** | **64** | |                                                                                  │
  │    355                                                                                                           │
  │    356 ---                                                                                                       │
  │    357                                                                                                           │
  │    358 ## Part 4: FIXME Comments (8 findings)                                                                    │
  │    359                                                                                                           │
  │    360 Most FIXME comments are in the verification agent code that **detects** FIXMEs in user code, not actual   │
  │        issues in the codebase:                                                                                   │
  │    361                                                                                                           │
  │    362 | File | Line | Context |                                                                                 │
  │    363 |------|------|---------|                                                                                 │
  │    364 | `lib/stateful-agent/agents/verification.ts` | 292, 296, 845, 850 | Verification agent checks for FIXME  │
  │        comments |                                                                                                │
  │    365 | `test/stateful-agent/agents/verification.test.ts` | 108, 110, 115 | Test cases for FIXME detection |    │
  │    366                                                                                                           │
  │    367 ---                                                                                                       │
  │    368                                                                                                           │
  │    369 ## Recommendations                                                                                        │
  │    370                                                                                                           │
  │    371 ### Immediate Actions (Security)                                                                          │
  │    372                                                                                                           │
  │    373 1. **Migrate legacy encrypted API keys** in `lib/database/connection.ts`                                  │
  │    374    - Run `migrateLegacyEncryptedKeys()` function                                                          │
  │    375    - Update all encrypted data to use new encryption method                                               │
  │    376                                                                                                           │
  │    377 2. **Replace deprecated function calls**                                                                  │
  │    378    - Replace all `parsePromptForTools()` calls with `composioSessionManager.searchTools()`                │
  │    379    - Replace `sanitizeCommand()` with `validateCommand()`                                                 │
  │    380    - Migrate from `legacySandboxEvents` to `enhancedSandboxEvents`                                        │
  │    381                                                                                                           │
  │    382 ### Short-term (1-2 weeks)                                                                                │
  │    383                                                                                                           │
  │    384 3. **Remove incomplete Blaxel integration**                                                               │
  │    385    - Delete `lib/blaxel/` directory if not actively being developed                                       │
  │    386    - Or complete the implementation                                                                       │
  │    387                                                                                                           │
  │    388 4. **Implement critical webhook handlers**                                                                │
  │    389    - Complete Nango webhook handlers in `app/api/webhooks/nango/route.ts`                                 │
  │    390    - Complete Composio webhook handlers                                                                   │
  │    391                                                                                                           │
  │    392 5. **Clean up unused exports**                                                                            │
  │    393    - Remove or deprecate HIGH severity unused exports                                                     │
  │    394    - Add `@internal` JSDoc tags for internal-only exports                                                 │
  │    395                                                                                                           │
  │    396 ### Medium-term (1 month)                                                                                 │
  │    397                                                                                                           │
  │    398 6. **Audit component usage**                                                                              │
  │    399    - Review `components/stateful-agent/` - remove if not used                                             │
  │    400    - Review `components/plugins/` marketplace components                                                  │
  │    401                                                                                                           │
  │    402 7. **Remove legacy compatibility shims**                                                                  │
  │    403    - Remove `*Legacy()` functions after migration period                                                  │
  │    404    - Remove legacy event system references                                                                │
  │    405                                                                                                           │
  │    406 8. **Document public API**                                                                                │
  │    407    - Clearly mark public API exports with `@public` JSDoc                                                 │
  │    408    - Mark internal exports with `@internal`                                                               │
  │    409                                                                                                           │
  │    410 ### Configuration Recommendations                                                                         │
  │    411                                                                                                           │
  │    412 9. **Enable tree-shaking**                                                                                │
  │    413    - Add `"sideEffects": false` to `package.json`                                                         │
  │    414    - Use ES modules for better tree-shaking                                                               │
  │    415                                                                                                           │
  │    416 10. **Add linting rules**                                                                                 │
  │    417     - Add `@typescript-eslint/no-unused-vars` for exports                                                 │
  │    418     - Add custom rule to detect unused exports                                                            │
  │    419                                                                                                           │
  │    420 ---                                                                                                       │
  │    421                                                                                                           │
  │    422 ## Files Recommended for Deletion                                                                         │
  │    423                                                                                                           │
  │    424 These files/folders appear to be incomplete or entirely unused:                                           │
  │    425                                                                                                           │
  │    426 | Path | Reason |                                                                                         │
  │    427 |------|--------|                                                                                         │
  │    428 | `lib/blaxel/` | Incomplete integration - no imports found |                                             │
  │    429 | `lib/crewai/` | Incomplete integration - no imports found |                                             │
  │    430 | `components/stateful-agent/*.tsx` | Components not used in main app |                                   │
  │    431 | `components/plugins/plugin-*.tsx` | Plugin UI components not used |                                     │
  │    432 | `hooks/use-*.ts` (multiple) | Hooks only used in documentation |                                        │
  │    433 | `lib/agent/use-agent.ts` | Functions only used in documentation |                                       │
  │    434                                                                                                           │
  │    435 ---                                                                                                       │
  │    436                                                                                                           │
  │    437 ## Appendix: Export/Import Statistics                                                                     │
  │    438                                                                                                           │
  │    439 | Metric | Count |                                                                                        │
  │    440 |--------|-------|                                                                                        │
  │    441 | Total exports analyzed | ~563 |                                                                         │
  │    442 | Total imports analyzed | ~2,100+ |                                                                      │
  │    443 | Unused exports identified | 104+ |                                                                      │
  │    444 | Deprecated functions | 6 |                                                                              │
  │    445 | TODO comments | 64 |                                                                                    │
  │    446 | Files with deprecation | 25+ |                                                                          │
  │    447                                                                                                           │
  │    448 ---                                                                                                       │
  │    449                                                                                                           │
  │    450 *Report generated by comprehensive codebase analysis on March 1, 2026*                            




























  ------------------------------------------
















# Unused Exports and Deprecated Code Report

**Project:** binG - Agentic AI Workspace  
**Analysis Date:** March 1, 2026  
**Scope:** TypeScript/JavaScript/Python files (excluding node_modules, .next, dist, tests)

---

## Executive Summary

| Category | Count | Severity |
|----------|-------|----------|
| **Unused Exports** | 104+ | HIGH |
| **Unused Local Imports** | 16 | HIGH |
| **@deprecated JSDoc Tags** | 6 | HIGH |
| **TODO Comments** | 64 | MEDIUM |
| **FIXME Comments** | 8 | MEDIUM-HIGH |
| **DEPRECATED References** | 19 | MEDIUM-HIGH |
| **Legacy Named Functions** | 41 | MEDIUM |

---

## Part 1: Unused Exports

### HIGH SEVERITY - Clearly Exported But Never Imported

#### Cache Module (`lib/cache.ts`)

| Export Name | Type | Recommendation |
|-------------|------|----------------|
| `PersistentCache` | class | Remove or document usage |
| `userPrefsCache` | const | Remove or document usage |
| `chatHistoryCache` | const | Remove or document usage |
| `providerCache` | const | Remove or document usage |
| `cacheKey` | const | Remove or document usage |
| `cached` | function | Remove or document usage |
| `responseCache` | const | Remove or document usage (default export used) |
| `templateCache` | const | Remove or document usage |
| `fileCache` | const | Remove or document usage |
| `projectCache` | const | Remove or document usage |

#### Authentication Module

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `lib/auth/jwt.ts` | `getBlacklistStats` | function | Remove or add tests |
| `lib/auth/jwt.ts` | `invalidateAllUserTokens` | function | Remove or add tests |
| `lib/auth/jwt.ts` | `getTokenRemainingLifetime` | function | Remove or add tests |
| `lib/auth/auth-service.ts` | `getFailedLoginCount` | function | Remove or add tests |
| `lib/auth/auth-service.ts` | `clearAccountLockout` | function | Remove or add tests |
| `lib/auth/oauth-service.ts` | `verifyCodeChallenge` | function | Remove or add tests |
| `lib/auth-keys.ts` | `saveUserApiKeyForModel` | function | Remove or document usage |
| `lib/auth-keys.ts` | `getUserApiKeyForModel` | function | Remove or document usage |
| `lib/auth-keys.ts` | `listUserModelKeys` | function | Remove or document usage |

#### Blaxel Integration (Incomplete - Recommend Deletion)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `lib/blaxel/traffic-manager.ts` | `BlaxelTrafficManager` | class | **Remove** - Incomplete integration |
| `lib/blaxel/traffic-manager.ts` | `createTrafficManager` | function | **Remove** - Incomplete integration |
| `lib/blaxel/traffic-manager.ts` | `quickCanaryDeploy` | function | **Remove** - Incomplete integration |
| `lib/blaxel/batch-jobs.ts` | `BlaxelBatchJobsManager` | class | **Remove** - Incomplete integration |
| `lib/blaxel/batch-jobs.ts` | `blaxelBatchJobs` | const | **Remove** - Incomplete integration |
| `lib/blaxel/batch-jobs.ts` | `createBatchJobsManager` | function | **Remove** - Incomplete integration |
| `lib/blaxel/batch-jobs.ts` | `quickBatchExecute` | function | **Remove** - Incomplete integration |
| `lib/blaxel/agent-handoff.ts` | `BlaxelAgentHandoffManager` | class | **Remove** - Incomplete integration |
| `lib/blaxel/agent-handoff.ts` | `blaxelAgentHandoff` | const | **Remove** - Incomplete integration |
| `lib/blaxel/agent-handoff.ts` | `createAgentHandoffManager` | function | **Remove** - Incomplete integration |

#### MCP (Model Context Protocol) Module

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `lib/mcp/connection-pool.ts` | `MCPConnectionPool` | class | Remove or document usage |
| `lib/mcp/connection-pool.ts` | `mcpPoolRegistry` | const | Remove or document usage |
| `lib/mcp/connection-pool.ts` | `getMCPConnectionPool` | function | Remove or document usage |
| `lib/mcp/tool-server.ts` | `stopMCPToolServer` | function | Remove or document usage |
| `lib/mcp/smithery-service.ts` | `SmitheryService` | class | Only `getSmitheryService` is used |
| `lib/mcp/smithery-registry.ts` | `SmitheryClient` | class | Only used in tests |

#### CrewAI Integration

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `lib/crewai/tools/crewai-tools.ts` | `SerperDevTool` | class | Remove or document usage |
| `lib/crewai/tools/crewai-tools.ts` | `WikipediaTool` | class | Remove or document usage |
| `lib/crewai/tools/crewai-tools.ts` | `FileReadTool` | class | Remove or document usage |
| `lib/crewai/tools/crewai-tools.ts` | `CodeDocsSearchTool` | class | Remove or document usage |
| `lib/crewai/tools/crewai-tools.ts` | `createToolRegistry` | function | Remove or document usage |
| `lib/crewai/tools/tool-adapter.ts` | `setDelegationContext` | function | Remove or document usage |
| `lib/crewai/tools/tool-adapter.ts` | `clearDelegationContext` | function | Remove or document usage |
| `lib/crewai/tools/tool-adapter.ts` | `createCrewAITools` | function | Remove or document usage |
| `lib/crewai/tools/tool-adapter.ts` | `createAgentWithTools` | function | Remove or document usage |

#### Agent Hooks (Documentation Only)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `lib/agent/use-agent.ts` | `useDesktopAgent` | function | **Documentation only** - Not used in code |
| `lib/agent/use-agent.ts` | `useTerminalAgent` | function | **Documentation only** - Not used in code |
| `lib/agent/unified-agent.ts` | `UnifiedAgent` | class | Only type imports found |

#### Stateful Agent Components (Not Used in Main App)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `components/stateful-agent/DiffViewer.tsx` | `DiffViewer` | component | Remove if not used |
| `components/stateful-agent/DiffViewer.tsx` | `DiffSummary` | component | Remove if not used |
| `components/stateful-agent/ApprovalDialog.tsx` | `ApprovalDialog` | component | Remove if not used |
| `components/stateful-agent/ApprovalDialog.tsx` | `ApprovalBanner` | component | Remove if not used |
| `components/stateful-agent/AgentStatus.tsx` | `AgentStatus` | component | Remove if not used |
| `components/stateful-agent/AgentStatus.tsx` | `PhaseIndicator` | component | Remove if not used |
| `components/stateful-agent/AgentStatus.tsx` | `AgentPhase` | type | Remove if not used |

#### Tambo Components

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `components/tambo/tambo-message-renderer.tsx` | `TamboMessageRenderer` | component | Remove or document usage |
| `components/tambo/tambo-components.tsx` | `tamboComponents` | const | Remove or document usage |
| `components/tambo/tambo-components.tsx` | `TamboComponentName` | type | Remove or document usage |
| `components/tambo/tambo-tools.tsx` | `tamboTools` | const | Remove or document usage |
| `components/tambo/tambo-tools.tsx` | `TamboToolName` | type | Remove or document usage |

#### Plugin System (Unused Components)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `components/plugins/plugin-marketplace.tsx` | `PluginMarketplace` | component | Remove or complete implementation |
| `components/plugins/plugin-health-monitor.tsx` | `PluginHealthMonitor` | component | Remove or complete implementation |
| `components/plugins/plugin-performance-dashboard.tsx` | `PluginPerformanceDashboard` | component | Remove or complete implementation |
| `components/plugins/plugin-dependency-visualizer.tsx` | `PluginDependencyVisualizer` | component | Remove or complete implementation |
| `components/plugins/plugin-version-manager.tsx` | `PluginVersionManager` | component | Remove or complete implementation |
| `components/plugins/notes/notion-connector.tsx` | `NotionConnector` | component | Remove or complete implementation |

#### UI Components

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `components/ui/error-boundary.tsx` | `ErrorBoundary` | class | Remove or document usage |
| `components/ui/error-boundary.tsx` | `useErrorBoundary` | hook | Remove or document usage |
| `components/ui/error-boundary.tsx` | `withErrorBoundary` | HOC | Remove or document usage |
| `components/ui/error-boundary.tsx` | `useGlobalErrorHandler` | hook | Remove or document usage |
| `components/ui/error-boundary.tsx` | `AppErrorBoundaryProvider` | component | Remove or document usage |
| `components/ui/responsive-container.tsx` | `ResponsiveContainer` | component | Remove or document usage |
| `components/ui/responsive-container.tsx` | `ResponsiveVisibility` | component | Remove or document usage |
| `components/ui/responsive-container.tsx` | `ResponsiveGrid` | component | Remove or document usage |
| `components/plugins/ToolAuthPrompt.tsx` | `ToolAuthPrompt` | component | Remove or document usage |
| `components/auth/user-profile-display.tsx` | `UserProfileDisplay` | component | Remove or document usage |
| `components/llm-selector.tsx` | `LLMSelector` | const | Remove or document usage |
| `components/code-mode.tsx` | `CodeMode` | component | Deprecated - only used in tests |

#### Hooks (Unused)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `hooks/use-enhanced-mobile.ts` | `useEnhancedMobile` | hook | Remove or document usage |
| `hooks/use-tambo-chat.ts` | `useTamboChat` | hook | Documentation only |
| `hooks/use-tool-integration.ts` | `useToolIntegration` | hook | Documentation only |
| `hooks/use-tool-integration.ts` | `useToolDiscovery` | hook | Documentation only |
| `hooks/use-sandbox.ts` | `useSandbox` | hook | Remove or document usage |
| `hooks/use-chat-history-sync.ts` | `useChatHistorySync` | hook | Remove or document usage |
| `hooks/use-enhanced-streaming.ts` | `useEnhancedStreaming` | hook | Remove or document usage |
| `hooks/use-enhanced-api.ts` | `useEnhancedAPI` | hook | Documentation only |
| `hooks/use-enhanced-api.ts` | `useAPIHealth` | hook | Documentation only |
| `hooks/use-enhanced-api.ts` | `useEnhancedChat` | hook | Duplicate (also in use-enhanced-chat.ts) |
| `hooks/use-conversation.ts` | `useConversation` | hook | Commented out in usage |
| `hooks/use-responsive-layout.ts` | `calculateDynamicWidth` | function | Only 1 usage - consider inline |
| `hooks/use-responsive-layout.ts` | `getOverflowStrategy` | function | Only 1 usage - consider inline |

#### Contexts

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `contexts/responsive-layout-context.tsx` | `ResponsiveLayoutProvider` | component | Not imported anywhere |
| `contexts/responsive-layout-context.tsx` | `useResponsiveBreakpoints` | hook | Not imported anywhere |

#### Types (Potentially Unused Public API)

| File | Export Name | Type | Recommendation |
|------|-------------|------|----------------|
| `types/index.ts` | `ConversationContext` | interface | Keep as public API or remove |
| `types/index.ts` | `ConversationMood` | interface | Keep as public API or remove |
| `types/index.ts` | `VoiceSettings` | interface | Keep as public API or remove |
| `types/index.ts` | `VoiceEvent` | interface | Keep as public API or remove |
| `types/index.ts` | `ConversationSettings` | interface | Keep as public API or remove |
| `types/index.ts` | `TokenUsage` | interface | Keep as public API or remove |
| `types/index.ts` | `StreamingChunk` | interface | Keep as public API or remove |

---

## Part 2: Deprecated Code

### @deprecated JSDoc Tags (6 findings) - **HIGH PRIORITY**

| File | Function | Replacement | Line |
|------|----------|-------------|------|
| `lib/composio-adapter.ts` | `parsePromptForTools()` | `composioSessionManager.searchTools()` | 25 |
| `lib/composio-adapter.ts` | `registerDefaultTools()` | `composioSessionManager` for tool management | 102 |
| `lib/sandbox/security.ts` | `sanitizeCommand()` | `validateCommand()` | 265 |
| `lib/sandbox/sandbox-tools.ts` | `validateCommandLegacy()` | `validateCommand` from security.ts | 136 |
| `lib/sandbox/sandbox-events.ts` | `legacySandboxEvents` | `enhancedSandboxEvents` | 6 |
| `lib/sandbox/providers/e2b-amp.ts` | `createAmpSandbox()` | `runAmp()` with existing sandbox | 462 |

### Security-Critical Legacy Encryption - **IMMEDIATE ACTION REQUIRED**

**File:** `lib/database/connection.ts` (Lines 219-285)

Legacy encryption using deprecated `createDecipher` with MD5 key derivation - vulnerable to known-plaintext attacks.

**Action Required:** Run `migrateLegacyEncryptedKeys()` to migrate all legacy encrypted API keys.

### Legacy Named Functions (41 findings)

| File | Component | Recommendation |
|------|-----------|----------------|
| `lib/sandbox/sandbox-events.ts` | `LegacySandboxEventEmitter`, `legacySandboxEvents` | Migrate to enhanced events |
| `lib/sandbox/sandbox-tools.ts` | `validateCommandLegacy()` | Remove after migration |
| `lib/sandbox/terminal-manager.ts` | `LEGACY_PORT_PATTERNS` | Update to new patterns |
| `lib/plugins/plugin-registry.ts` | `getLegacyPlugins()` | Remove after migration |
| `lib/tambo/index.ts` | `TamboService` (legacy export) | Use new service pattern |
| `app/api/stateful-agent/route.ts` | Legacy agent mode | Complete migration to new agent |
| `enhanced-code-system/file-management/advanced-file-manager.ts` | `applyDiffsLegacy()` | Remove after migration |

---

## Part 3: Incomplete Implementations (TODO Comments)

### Critical TODOs Requiring Implementation

| Category | Count | Files |
|----------|-------|-------|
| Webhook Handlers (Nango) | 18 | `app/api/webhooks/nango/route.ts` |
| VPS Deployment | 4 | `lib/services/vps-deployment.ts` |
| Authentication | 1 | `app/api/auth/reset-password/route.ts` |
| Workflow Execution | 1 | `app/api/agent/workflows/route.ts` |
| Composio Webhooks | 3 | `lib/composio/webhook-handler.ts` |
| CSP Reporting | 2 | `app/api/csp-report/route.ts` |
| SRI Hashes | 8 | `lib/security/sri-generator.ts` |
| Other | 27 | Various files |
| **Total** | **64** | |

---

## Part 4: FIXME Comments (8 findings)

Most FIXME comments are in verification agent code that **detects** FIXMEs in user code, not actual issues in the codebase.

---

## Part 5: Unused Local Imports

### HIGH SEVERITY - Unused Service/Function Imports

#### 1. `lib/api/priority-request-router.ts` (5 unused imports)

| Import | Line | Status |
|--------|------|--------|
| `toolContextManager` | 18 | **UNUSED** |
| `getComposioService` | 22 | **UNUSED** |
| `getArcadeService` | 24 | **UNUSED** |
| `getNangoService` | 25 | **UNUSED** |
| `getTamboService` | 26 | **UNUSED** |

#### 2. `lib/tools/discovery.ts` (4 unused imports)

| Import | Line | Status |
|--------|------|--------|
| `getToolManager` | 16 | **UNUSED** |
| `getArcadeService` | 17 | **UNUSED** |
| `getNangoService` | 18 | **UNUSED** |
| `getTamboService` | 19 | **UNUSED** |

#### 3. `lib/virtual-filesystem/virtual-filesystem-service.ts` (1 unused import)

| Import | Line | Status |
|--------|------|--------|
| `diffTracker` | 12 | **UNUSED** |

#### 4. `lib/composio-adapter.ts` (2 unused imports)

| Import | Line | Status |
|--------|------|--------|
| `composioSessionManager` | 9 | **UNUSED** |
| `executeToolCall` | 9 | **UNUSED** |

#### 5. `lib/mcp/config.ts` (1 unused import)

| Import | Line | Status |
|--------|------|--------|
| `MCPClient` | 12 | **UNUSED** |

#### 6. `lib/email/email-service.ts` (1 unused import)

| Import | Line | Status |
|--------|------|--------|
| `type BrevoClient` | 19 | **UNUSED** - Type-only import |

#### 7. `lib/tool-integration/providers/smithery.ts` (1 unused import)

| Import | Line | Status |
|--------|------|--------|
| `z` | 18 | **UNUSED** |

#### 8. `lib/stateful-agent/tools/ast-aware-diff.ts` (1 unused import)

| Import | Line | Status |
|--------|------|--------|
| `type ToolResult` | 18 | **UNUSED** |

### MEDIUM SEVERITY - Unused Component/Hook Imports

#### 9. `components/interaction-panel.tsx` (2 unused imports)

| Import | Line | Status |
|--------|------|--------|
| `pluginMigrationService` | 95 | **UNUSED** |
| `PluginCategorizer` | 95 | **UNUSED** |

### Summary of Unused Local Imports

| Severity | Count | Files Affected |
|----------|-------|----------------|
| **HIGH** | 14 | 7 files |
| **MEDIUM** | 2 | 1 file |
| **False Positives Corrected** | 12 | Verified as used |
| **Total Verified Unused** | **16** | **8 files** |

---

## Recommendations

### Immediate Actions (Security)

1. **Migrate legacy encrypted API keys** in `lib/database/connection.ts`
2. **Replace deprecated function calls** with recommended alternatives

### Short-term (1-2 weeks)

3. **Remove incomplete Blaxel integration** - Delete `lib/blaxel/` directory
4. **Remove unused imports** from files listed in Part 5
5. **Implement critical webhook handlers** in `app/api/webhooks/nango/route.ts`

### Medium-term (1 month)

6. **Remove unused exports** or document as public API
7. **Remove legacy compatibility shims** after migration
8. **Enable TypeScript strict mode** for unused detection

### Configuration Recommendations

```json
// .eslintrc.json
{
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", {
      "vars": "all",
      "args": "after-used",
      "ignoreRestSiblings": true
    }]
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

---

## Files Recommended for Deletion

| Path | Reason |
|------|--------|
| `lib/blaxel/` | Incomplete integration - no imports found |
| `lib/crewai/` | Incomplete integration - no imports found |
| `components/stateful-agent/*.tsx` | Components not used in main app |
| `components/plugins/plugin-*.tsx` | Plugin UI components not used |
| `hooks/use-*.ts` (multiple) | Hooks only used in documentation |

---

## Complete Summary

| Category | Total | Action Required |
|----------|-------|-----------------|
| **Unused Exports** | 104+ | Remove or document |
| **Unused Local Imports** | 16 | Remove immediately |
| **@deprecated Functions** | 6 | Replace with alternatives |
| **Security-Critical Legacy Code** | 1 | Migrate immediately |
| **TODO Comments** | 64 | Implement or remove |
| **Legacy Named Functions** | 41 | Plan migration |
| **False Positives Corrected** | 12 | Verified as used |

---

## Appendix A: Analysis Statistics

| Metric | Count |
|--------|-------|
| Total exports analyzed | ~563 |
| Total imports analyzed | ~2,100+ |
| Files scanned | 715+ |
| TypeScript files | 600+ |
| TSX files | 100+ |

---

## Appendix B: Review Thoroughness Verification

### Analysis Methods Used

1. **Export Pattern Matching** - Searched for `^export (const|function|class|interface|type|enum)` patterns
2. **Import Pattern Matching** - Searched for all `import { } from`, `import * as`, `import default from` patterns
3. **Usage Verification** - Cross-referenced each flagged import against entire codebase
4. **Deprecated Code Detection** - Searched for `@deprecated`, TODO, FIXME, XXX, HACK, DEPRECATED, "legacy"

### Confidence Levels

| Finding Type | Confidence | Verification Method |
|--------------|------------|---------------------|
| Unused Exports | HIGH | Cross-referenced with all import statements |
| Unused Local Imports | HIGH | Verified by searching file contents |
| @deprecated Functions | HIGH | Formal JSDoc tags |
| TODO Comments | HIGH | Direct text search |
| Legacy Functions | MEDIUM | Named pattern matching |

### Known Limitations

1. **Dynamic Imports**: Files using dynamic `import()` may not be fully captured
2. **Re-exports**: Some exports may be intentionally re-exported for public API
3. **Entry Points**: CLI entry points may appear unused but are executed directly
4. **Event Handlers**: Some functions may be used as callbacks without direct imports
5. **Tests**: Test files may import modules that appear unused in production code

### Items Manually Verified as USED (False Positives)

- `secureRandom` in `components/interaction-panel.tsx` (lines 741, 1128)
- `toolContextManager` in `lib/api/enhanced-llm-service.ts` (line 480)
- `tool` and `z` in `lib/stateful-agent/commit/shadow-commit.ts` (lines 515-545)
- All service imports in `lib/api/priority-request-router.ts` that are actually used

---

*Report generated by comprehensive codebase analysis on March 1, 2026*  
*Last updated: Added unused local imports analysis with thoroughness verification*
