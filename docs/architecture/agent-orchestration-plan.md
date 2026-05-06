# Agent Orchestration Architecture Plan

## Summary of Current State

### Mode Dispatch (unified-agent-service.ts lines 580-628)

| Mode | Architecture | Model Selection | Circuit/Ranker |
|------|-------------|--------------|-------------|
| **V1** `v1-api` | API calls | ✅ model-ranker | ✅ circuit-breaker |
| **V2** `v2-native` | opencode-cli spawn | ❌ internal only | ❌ |
| **V2** `v2-local` | opencode-cli spawn | ❌ internal only | ❌ |
| **V2** `opencode-sdk` | HTTP API | ❌ via SDK config | ❌ |
| **V2** `v2-containerized` | docker spawn | ❌ internal only | ❌ |
| **Ext** `stateful-agent` | API calls (via processUnifiedAgentRequest) | ✅ model-ranker | ✅ circuit-breaker |
| **Ext** `mastra-workflow` | API calls | ✅ via config | ❌ |

### Extended Modes (all use processUnifiedAgentRequest = V1 pipeline)

- dual-process → processUnifiedAgentRequest → runs through V1 with model-ranker
- intent-driven → processUnifiedAgentRequest → runs through V1
- energy-driven → processUnifiedAgentRequest → runs through V1
- attractor-driven → processUnifiedAgentRequest → runs through V1
- cognitive-resonance → processUnifiedAgentRequest → runs through V1
- distributed-cognition → processUnifiedAgentRequest → runs through V1
- execution-controller → processUnifiedAgentRequest → runs through V1
- adversarial-verify → processUnifiedAgentRequest → runs through V1

### What's NOT Covered

1. **V2 Native/Local/Containerized modes** - no model-ranker or circuit-breaker
2. **OpenCode SDK mode** - HTTP-based but no health tracking
3. **StatefulAgent** - uses processUnifiedAgentRequest internally so YES to V1
4. **Mastra workflows** - model passed via config, no health tracking
5. **V2-only CLI modes** - need different approach (CLI args, not API)

---

## Proposed Architecture

### V1 vs V2 Definition

| Aspect | V1 (API) | V2 (CLI/Spawn) |
|--------|----------|---------------|
| Engine | OpenAI/Anthropic/etc. API | opencode-cli, docker spawn |
| Integration | Full app engineering | Binary handles context/memory |
| Model selection | circuit-breaker + model-ranker | CLI args or config |
| Telemetry | API latencies, 429s | Exit codes, stdout parsing |
| Health | Provider API status | Binary availability |

### Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│ UnifiedAgentService (dispatch)                         │
├─────────────────────────────────────────────────────────┤
│ Mode Selection Layer                                │
│   - getStartupCapabilities()                      │
│   - getModeForTask(task, caps)                │
│   - getFallbackChain(caps)                    │
├─────────────────────────────────────────────────────────┤
│ Execution Layer                                 │
│   ┌──────────────┐  ┌──────────────┐          │
│   │ V1 Pipeline │  │ V2 Pipeline │          │
│   │ (API calls) │  │ (spawns)   │          │
│   └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────┤
│ Cross-Cutting concerns                        │
│   - agent-logger.ts (centralized logging)          │
│   - model-health.ts (unified health)        │
│     * wraps circuit-breaker + new V2 health  │
│   - capability-check.ts (startup caps)        │
└─────────────────────────────────────────────────────────┘
```

### Proposed Changes

#### Phase 1: Centralize Health Tracking

1. Create `agent-orchestra/model-health.ts`:
   - Wrap existing circuit-breaker for V1
   - Add V2 health (binary availability, exit codes)
   - Unified interface: `isHealthy()`, `recordSuccess()`, `recordFailure()`

2. Update modes to use centralized health:
   - `unified-agent-service.ts` V1 paths (already have, refactor imports)
   - `runV2Native` → call model-health
   - `runOpencodeSDKMode` → call model-health
   - `runMastraWorkflow` → call model-health

#### Phase 2: V2 Model Configuration

1. V2 Native/Local:
   - Read model from `OPENCODE_MODEL` env or CLI arg
   - Pass to spawn via `--model` flag
   - Track in model-health

2. OpenCode SDK:
   - Configurable via session manager options
   - Health tracks HTTP endpoint

3. Containerized:
   - Model via docker env or CLI arg
   - Health tracks container health

#### Phase 3: Abstract Execution Layer

1. Create `executeAgent()` abstraction:
   ```ts
   interface AgentExecutionConfig {
     architecture: 'v1' | 'v2';
     mode: 'api' | 'cli-spawn' | 'http-sdk' | 'container';
     provider?: string;
     model?: string;
     // ... etc
   }
   ```

2. Modes can declare supported architectures:
   ```ts
   const dualProcessCapabilities = {
     v1: true,  // uses processUnifiedAgentRequest 
     v2: false, // could add V2 support later
   };
   ```

3. Mode selection considers architecture:
   ```ts
   function getModeForTask(task: string, caps: StartupCapabilities): ModeSelection {
     // Consider V1 vs V2 preference based on task + caps
   }
   ```

---

## Files to Modify/Create

### New Files

| File | Purpose | Status |
|------|---------|--------|
| `agent-logger.ts` | ✅ Created | Centralized logging |
| `startup-capabilities.ts` | ✅ Created | Startup capability detection |
| `v2-model-config.ts` | ⚠️ EXISTS, NOT INTEGRATED | V2 model selection |
| `model-health.ts` | ✅ Created | Unified health tracking |
| `agent-orchestra/architecture.ts` | Not created yet | V1/V2 abstraction |

### Files Using V2 Model Config (NEEDS INTEGRATION)

Currently `v2-model-config.ts` exists but is NOT called by any execution path:

- `unified-agent-service.ts` V2 paths don't use `getV2CLIArgs()` 
- `opencode-sdk-provider.ts` uses its own `config.model` instead
- Need to import and wire up in V2 execution functions

### Modify

| File | Changes |
|------|--------|
| `unified-agent-service.ts` | Import v2-model-config.ts for V2 modes |
| `opencode-sdk-provider.ts` | Also use v2-model-config.ts |
| `model-health.ts` | Already tracks V2 health per model |

---

## Questions/Decisions

1. **V2 model arguments**: Does OpenCode CLI support `--model` flag? Need to verify
2. **Remote V2**: Are there remote V2 engines (not just SDK)? Need to confirm
3. **Containerized V2**: How to pass model config to docker? Env vars only?
4. **Scope**: Keep extended modes V1-only for now, or add V2 support?

---

## Implementation Priority

1. ✅ Done: agent-logger.ts, startup-capabilities.ts created
2. High: model-health.ts (unified health)
3. High: Update V2 modes to use health tracking
4. Medium: Document mode capabilities (V1-only vs V1+V2)
5. Low: Abstraction layer for dual-architecture modes