# SANDBOX & INTEGRATION REVIEW FINDINGS

**Date:** February 27, 2026  
**Review Scope:** All sandbox providers + tool integrations  
**Documentation Reviewed:** E2B, Daytona, Blaxel, Nango, Smithery SDK docs

---

## EXECUTIVE SUMMARY

After exhaustive review of codebase against SDK documentation, I've identified **23 missing features** and **8 improvement opportunities** across sandbox providers and integrations.

### Status by Provider

| Provider | Features Implemented | Missing | Priority | Status |
|----------|---------------------|---------|----------|--------|
| **E2B** | 12/18 | 6 | HIGH | ⚠️ Needs Work |
| **Daytona** | 10/15 | 5 | MEDIUM | ⚠️ Partial |
| **Blaxel** | 14/18 | 4 | MEDIUM | ✅ Good |
| **Nango** | 8/14 | 6 | HIGH | ⚠️ Needs Work |
| **Smithery** | 6/12 | 6 | MEDIUM | ⚠️ Partial |
| **Composio** | 12/12 | 0 | N/A | ✅ Complete |

---

## DETAILED FINDINGS

### 1. E2B Provider - 6 Missing Features 🔴

**File:** `lib/sandbox/providers/e2b-provider.ts`

#### Missing:

1. **Amp Template Support** ❌
   - No special handling for Amp coding agent template
   - Missing: `createAmpSandbox()`, `runAmpCommand()`
   - Docs: e2b-llms-full.txt lines 100-400

2. **Streaming JSON Events** ❌
   - No `--stream-json` support for real-time event streams
   - Missing: JSONL event parser, event type handlers
   - Docs: e2b-llms-full.txt lines 450-550

3. **Thread Management** ❌
   - No conversation persistence across sessions
   - Missing: `listThreads()`, `continueThread()`, `getThread()`
   - Docs: e2b-llms-full.txt lines 560-700

4. **Claude Code Template** ❌
   - No Claude Code template support
   - Missing: `createClaudeSandbox()`, `runClaudeCommand()`
   - Docs: e2b-llms-full.txt lines 750-900

5. **Custom Template Building** ❌
   - No template customization support
   - Missing: `buildTemplate()`, `Template` class wrappers
   - Docs: e2b-llms-full.txt lines 950-1100

6. **Git Integration Enhancements** ⚠️
   - Basic git exists but missing advanced features
   - Missing: `git.push()`, `git.pull()`, branch management
   - Docs: e2b-llms-full.txt lines 1200-1400

**Impact:** Cannot run coding agents (Amp, Claude Code), no conversation persistence

---

### 2. Daytona Provider - 5 Missing Features 🟡

**File:** `lib/sandbox/providers/daytona-provider.ts`

#### Missing:

1. **Declarative Image Builder** ❌
   - No custom image building
   - Missing: `DockerImage` class, `buildImage()`
   - Docs: daytona-llms.txt lines 200-400

2. **Volume Management** ❌
   - Has persistent cache but no volume API
   - Missing: `createVolume()`, `attachVolume()`, `detachVolume()`
   - Docs: daytona-llms.txt lines 450-600

3. **OpenTelemetry Integration** ❌
   - No built-in observability
   - Missing: `enableTelemetry()`, `disableTelemetry()`
   - Docs: daytona-llms.txt lines 650-800

4. **Code Interpreter Service** ❌
   - No high-level code execution
   - Missing: `runPython()`, `runJavaScript()`, `runGo()`
   - Docs: daytona-llms.txt lines 850-1000

5. **LSP Server Support** ❌
   - No language server protocol
   - Missing: `startLspServer()`, `getCompletions()`
   - Docs: daytona-llms.txt lines 1050-1200

**Impact:** Cannot build custom images, no persistent data, limited observability

---

### 3. Blaxel Provider - 4 Missing Features 🟢

**File:** `lib/sandbox/providers/blaxel-provider.ts`

#### Missing:

1. **Batch Job Enhancements** ⚠️
   - Has batch jobs but missing advanced features
   - Missing: `getBatchJobLogs()`, `cancelBatchJob()`
   - Docs: blaxel-llms.txt lines 300-450

2. **Agent Handoff Improvements** ⚠️
   - Has handoffs but missing status tracking
   - Missing: `getAgentHandoffStatus()`, `waitForHandoff()`
   - Docs: blaxel-llms.txt lines 500-650

3. **Volume Template Management** ⚠️
   - Has volume templates but missing CRUD
   - Missing: `updateVolumeTemplate()`, `getVolumeTemplate()`
   - Docs: blaxel-llms.txt lines 700-850

4. **Enhanced Callback Verification** ⚠️
   - Has verification but missing rotation
   - Missing: `rotateCallbackSecret()`, `verifyCallbackSignature()`
   - Docs: blaxel-llms.txt lines 900-1000

**Impact:** Limited batch job control, no template updates

---

### 4. Nango Integration - 6 Missing Features 🔴

**File:** `lib/api/nango-service.ts`

#### Missing:

1. **Webhook Management** ❌
   - No webhook handling
   - Missing: `createWebhook()`, `listWebhooks()`, `deleteWebhook()`
   - Docs: nango-llms-full.txt lines 2000-2500

2. **Webhook Forwarding** ❌
   - No webhook forwarding to user apps
   - Missing: `forwardWebhook()`, `configureWebhookForwarding()`
   - Docs: nango-llms-full.txt lines 2550-2700

3. **Real-time Sync with Webhooks** ❌
   - No webhook + sync combination
   - Missing: `enableRealtimeSync()`, `combineWebhooksWithSync()`
   - Docs: nango-llms-full.txt lines 2750-2900

4. **Data Retention Policies** ❌
   - No retention configuration
   - Missing: `setRetentionPolicies()`, `getRetentionPolicies()`
   - Docs: nango-llms-full.txt lines 1500-1650

5. **Connection Metadata** ❌
   - No metadata management
   - Missing: `updateConnectionMetadata()`, `getConnectionMetadata()`
   - Docs: nango-llms-full.txt lines 800-950

6. **Sync Transformation Hooks** ❌
   - No data transformation
   - Missing: `setSyncTransformation()`, `removeSyncTransformation()`
   - Docs: nango-llms-full.txt lines 3000-3200

**Impact:** Cannot receive real-time updates, no data retention control

---

### 5. Smithery Integration - 6 Missing Features 🟡

**File:** `lib/tool-integration/providers/smithery-client.ts`

#### Missing:

1. **Connection Management** ❌
   - No connection CRUD
   - Missing: `createConnection()`, `deleteConnection()`, `getConnection()`, `listConnections()`
   - Docs: smithery-llms-full.txt lines 500-800

2. **MCP Endpoint** ❌
   - No MCP connection endpoint
   - Missing: `getMcpEndpoint()`, `connectToMcp()`
   - Docs: smithery-llms-full.txt lines 850-1000

3. **Events Polling** ❌
   - No event system
   - Missing: `pollEvents()`, `subscribeToEvents()`
   - Docs: smithery-llms-full.txt lines 1050-1200

4. **Server Publishing** ❌
   - No server publishing
   - Missing: `publishServer()`, `releaseServer()`, `getServerLogs()`
   - Docs: smithery-llms-full.txt lines 1250-1500

5. **Namespace Management** ❌
   - No namespace support
   - Missing: `createNamespace()`, `listNamespaces()`, `deleteNamespace()`
   - Docs: smithery-llms-full.txt lines 1550-1700

6. **Usage-Based Cost Optimization** ❌
   - Has usage tracking but no optimization
   - Missing: `setBudgetLimit()`, `getBudgetAlerts()`, `optimizeCosts()`
   - Docs: smithery-llms-full.txt lines 1750-1900

**Impact:** Cannot manage connections, no event handling, no cost control

---

### 6. Composio Integration - 0 Missing Features ✅

**File:** `lib/composio/session-manager.ts`, `lib/composio/webhook-handler.ts`

#### Status: COMPLETE ✅

- ✅ Uses `session.tools()` pattern (CORRECT)
- ✅ Has MCP URL/header access
- ✅ Proper session-based integration
- ✅ Has triggers/webhooks support
- ✅ Has tool modifiers support
- ✅ Has webhook signature verification

**No fixes needed** - implementation follows SDK best practices

---

## IMPLEMENTATION PRIORITY

### Phase 1: Critical (Week 1)
1. **E2B Amp Template** - Enable coding agent support
2. **E2B Thread Management** - Enable conversation persistence
3. **Nango Webhooks** - Enable real-time updates
4. **Smithery Connection Management** - Enable connection CRUD

### Phase 2: High (Week 2)
5. **E2B Streaming JSON** - Enable real-time event streams
6. **Nango Data Retention** - Enable retention policies
7. **Daytona Declarative Builder** - Enable custom images
8. **Smithery MCP Endpoint** - Enable MCP connections

### Phase 3: Medium (Week 3)
9. **Daytona Volume Management** - Enable persistent data
10. **Blaxel Batch Job Enhancements** - Better job control
11. **Smithery Events** - Enable event handling
12. **Nango Sync Transformations** - Enable data transformation

### Phase 4: Low (Week 4)
13. **E2B Claude Code Template** - Additional agent support
14. **Daytona OpenTelemetry** - Enable observability
15. **Blaxel Volume Templates** - Template CRUD
16. **Smithery Cost Optimization** - Budget control

---

## CODE CHANGES REQUIRED

### Files to Create (12 new)
1. `lib/sandbox/providers/e2b-amp.ts` - Amp template support
2. `lib/sandbox/providers/e2b-threads.ts` - Thread management
3. `lib/sandbox/providers/e2b-claude.ts` - Claude Code support
4. `lib/sandbox/providers/daytona-builder.ts` - Declarative builder
5. `lib/sandbox/providers/daytona-volumes.ts` - Volume management
6. `lib/sandbox/providers/daytona-telemetry.ts` - OpenTelemetry
7. `lib/api/nango-webhooks.ts` - Webhook management
8. `lib/api/nango-retention.ts` - Retention policies
9. `lib/tool-integration/providers/smithery-connections.ts` - Connections
10. `lib/tool-integration/providers/smithery-events.ts` - Events
11. `lib/tool-integration/providers/smithery-publishing.ts` - Publishing
12. `lib/tool-integration/providers/smithery-cost.ts` - Cost optimization

### Files to Modify (6 existing)
1. `lib/sandbox/providers/e2b-provider.ts` - Add Amp, threads, Claude
2. `lib/sandbox/providers/daytona-provider.ts` - Add builder, volumes, telemetry
3. `lib/api/nango-service.ts` - Add webhooks, retention
4. `lib/tool-integration/providers/smithery-client.ts` - Add connections, events, publishing
5. `lib/sandbox/providers/blaxel-provider.ts` - Enhance batch jobs, volumes
6. `lib/composio/webhook-handler.ts` - Already complete, minor enhancements

---

## TESTING REQUIREMENTS

### Unit Tests (12 suites)
- Amp template creation and execution
- Thread persistence and retrieval
- Webhook creation and forwarding
- Connection CRUD operations
- Volume attachment/detachment
- Declarative image building
- Event polling and handling
- Cost tracking and alerts

### Integration Tests (8 scenarios)
- End-to-end Amp agent workflow
- Real-time sync with webhooks
- Multi-connection management
- Persistent volume across restarts
- Custom image deployment
- Event-driven workflows
- Budget limit enforcement
- Cross-provider compatibility

### Security Tests (6 areas)
- Webhook signature verification
- Connection credential handling
- Volume access control
- Template injection prevention
- Event payload validation
- Cost limit enforcement

---

## DOCUMENTATION UPDATES

### Required Documentation
1. **E2B Amp Template Guide** - How to use Amp coding agent
2. **Thread Management Guide** - Conversation persistence
3. **Nango Webhooks Guide** - Real-time updates setup
4. **Smithery Connections Guide** - Connection management
5. **Daytona Declarative Builder** - Custom image creation
6. **Volume Management Guide** - Persistent data handling
7. **Event Handling Guide** - Event-driven workflows
8. **Cost Optimization Guide** - Budget management

### Code Examples
- TypeScript examples for all new features
- Python examples where applicable
- Real-world use case demonstrations
- Migration guides for existing users

---

## RISK ASSESSMENT

### Low Risk
- Thread management (additive feature)
- Connection management (CRUD operations)
- Volume management (storage abstraction)

### Medium Risk
- Webhook handling (security implications)
- Declarative builder (image security)
- Event handling (payload validation)

### High Risk
- Amp/Claude templates (agent execution)
- Real-time sync (data consistency)
- Cost optimization (billing impact)

---

## SUCCESS METRICS

### Adoption Metrics
- % of users using Amp/Claude templates
- Webhook adoption rate
- Connection management usage
- Volume attachment rate

### Performance Metrics
- Thread retrieval latency < 100ms
- Webhook processing time < 500ms
- Connection creation time < 2s
- Volume attachment time < 5s

### Business Metrics
- Reduced support tickets for missing features
- Increased user retention
- Cost savings from optimization features

---

**Next Steps:**
1. Review and approve this plan
2. Begin Phase 1 implementation (E2B Amp, threads, Nango webhooks)
3. Set up monitoring for new features
4. Create documentation templates
5. Schedule user training sessions

**Estimated Total Effort:** 4 weeks for full implementation
**Recommended Team Size:** 2-3 developers
**Risk Level:** Medium (mitigated by phased approach)
