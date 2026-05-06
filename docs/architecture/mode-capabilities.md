# Agent Mode Capabilities

This document describes which execution modes support which architectures.

## Architecture Definitions

| Architecture | Description | Model Selection |
|--------------|-------------|----------------|
| **V1 (api)** | LLM API calls (OpenAI, Anthropic, etc.) | model-ranker.ts |
| **V2 (cli)** | CLI binary spawns (opencode-cli) | v2-model-config.ts |
| **V2 (http-sdk)** | HTTP API to remote engine | v2-model-config.ts |
| **V2 (container)** | Docker/containerized execution | v2-model-config.ts |

## Model Selection by Architecture

| Architecture | How Model is Set | Live Switch? | Integration File |
|--------------|-------------------|--------------|-----------------|
| V1 API | API call `model` param | N/A | model-ranker.ts |
| V2 CLI | CLI arg `--model` | No (new spawn) | v2-model-config.ts:getV2CLIArgs() |
| V2 HTTP | SDK init config | No (new session) | v2-model-config.ts:getV2SDKModel() |
| V2 Container | Env variable | No (new container) | v2-model-config.ts:getV2ContainerModel() |

## V2 Model Configuration File

The file `web/lib/orchestra/v2-model-config.ts` provides:

- `getV2CLIModel()` - Get model for CLI spawns
- `getV2CLIArgs(model)` - Get CLI args like `['--model', 'claude-3-5-sonnet-20241022']`
- `getV2SDKModel(baseUrl?)` - Get model for HTTP SDK
- `getV2ContainerModel()` - Get model for containerized
- `getV2ModelConfig(architecture)` - Factory based on architecture
- `getV2ModelsForUI()` - Models list for UI dropdown

**Status: EXISTS BUT NOT INTEGRATED** - needs to be wired into V2 execution paths.

### Core Modes (dispatched from unified-agent-service.ts)

| Mode | V1 | V2-CLI | V2-HTTP | V2-Container | Notes |
|------|:--:|:-----:|:------:|:------------:|-------|
| `v1-api` | ✅ | ❌ | ❌ | ❌ | Standard API calls |
| `v2-native` | ❌ | ✅ | ❌ | ❌ | opencode-cli spawn |
| `v2-local` | ❌ | ✅ | ❌ | ❌ | Same as v2-native |
| `v2-containerized` | ❌ | ❌ | ❌ | ✅ | Docker spawn |
| `opencode-sdk` | ❌ | ❌ | ✅ | ❌ | HTTP API |

### Extended Modes 
(all currently use processUnifiedAgentRequest from unified-agent-service.ts internally but this may possibly be abstracted to enable v2)

| Mode | V1 | V2 | Notes |
|------|:--:|:--:|-------|
| `stateful-agent` | ✅ | ❌ | Via V1 pipeline internally |
| `dual-process` | ✅ | ❌ | Fast/slow split via V1 |
| `intent-driven` | ✅ | ❌ | Intent field via V1 |
| `energy-driven` | ✅ | ❌ | Energy function via V1 |
| `attractor-driven` | ✅ | ❌ | Attractor field via V1 |
| `cognitive-resonance` | ✅ | ❌ | Multi-model agreement via V1 |
| `distributed-cognition` | ✅ | ❌ | Role-based via V1 |
| `execution-controller` | ✅ | ❌ | Self-correcting loop via V1 |
| `adversarial-verify` | ✅ | ❌ | Critic spawning via V1 |
| `mastra-workflow` | ✅ | ❌ | Config-based models |

## Mode Selection Guidance

```
┌─────────────────────────────────────────────────────────────┐
│                    MODE SELECTION                           │
├─────────────────────────────────────────────────────────────┤
│  Task Type           → Preferred Mode                      │
├─────────────────────────────────────────────────────────────┤
│  Simple chat         → v1-api                             │
│  Code editing       → v2-native (desktop) / v1-api      │
│  Multi-file changes → stateful-agent / v2-native       │
│  Build/refactor     → stateful-agent / v2-native         │
│  Research/summaries → v1-api / dual-process             │
│  Complex workflows → mastra-workflow / stateful-agent  │
└─────────────────────────────────────────────────────────────┘
```

## Fallback Chain

Default fallback when a mode fails:

1. `opencode-sdk` (web-friendly, HTTP API)
2. `v2-native` (desktop-specific, CLI spawn)
3. `v2-containerized` (desktop-specific, docker)
4. `v2-local` (desktop-specific, CLI spawn)
5. `v1-api` (universal, API calls)

## Health Tracking by Architecture

| Architecture | Tracking File | What it Tracks |
|--------------|--------------|----------------|
| V1 API | `middleware/circuit-breaker.ts` + `models/model-ranker.ts` | Provider failures, 429s, latencies |
| V2 CLI | `orchestra/model-health.ts` | Binary availability, exit codes |
| V2 HTTP | `orchestra/model-health.ts` | HTTP endpoint availability |
| V2 Container | `orchestra/model-health.ts` | Container health |

## Adding V2 Support to Extended Modes

To add V2 support to modes currently V1-only:

1. Import model-health:
   ```ts
   import { recordSuccess, recordFailure } from '@/lib/orchestra/model-health';
   ```

2. Wrap execution with health tracking:
   ```ts
   try {
     // Execute with V2 CLI or HTTP
     recordSuccess('v2-cli', 'my-provider');
   } catch (err) {
     recordFailure('v2-cli', 'my-provider', err.message);
   }
   ```

3. Update capability matrix in this document