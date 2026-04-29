# Codebase Review: Trigger.dev Implementation

## Overview
Trigger.dev is used for durable, long-running agent workflows. The implementation is split into a **Consumer API** (wrappers with local fallback) and **Worker Tasks** (actual implementations for the Trigger.dev runtime).

## Key Folders
1.  **`web/lib/events/trigger/`**: Abstraction layer. Provides `executeTask` and `executeWithFallback`. This is the primary integration point for the rest of the application.
2.  **`web/trigger/`**: Task definitions for Trigger.dev v3. These files are discovered by the Trigger.dev worker via `trigger.config.ts`.
3.  **`packages/shared/trigger/`**: Contains specialized tasks (e.g., `broadway-monitor.ts`). This appears to be a separate or legacy area compared to the core `web/` integration.

## Findings

### 1. Robust Fallback Mechanism
The implementation in `web/lib/events/trigger/utils.ts` is highly robust. It:
- Detects the presence of `@trigger.dev/sdk/v3` at runtime.
- Automatically falls back to local execution if the SDK is missing or if `TRIGGER_SECRET_KEY` is not set.
- This allows developers to work on the codebase locally without needing a Trigger.dev account or local worker running.

### 2. Implementation Quality
- **Type Safety**: Tasks use `zod` for input schema validation, ensuring the LLM or caller provides correct data.
- **Error Handling**: `executeWithFallback` catches Trigger.dev execution errors and attempts local execution as a last resort.
- **V3 vs V4**: The code uses the `@trigger.dev/sdk/v3` subpath, which is the "durable" version of Trigger.dev. `desktop/package.json` references `@trigger.dev/sdk: ^4.4.3`, which suggests a transition phase or that they are using the compatibility layer.

### 3. Missing Links & Fragmentation
- **Unused Tasks**: `packages/shared/trigger/broadway-monitor.ts` is not referenced in `trigger.config.ts`. This means it likely won't be discovered or deployed by the standard `trigger.dev deploy` command unless configured elsewhere.
- **Circular Dependencies**: The tasks in `web/trigger/` perform dynamic imports (e.g., `import("@/lib/orchestra/agent-loop")`) to avoid loading the entire app logic during Trigger.dev's build/deployment phase. This is a good practice for performance.

## Logic Trace: Agent Loop Execution
1.  **Caller** (e.g., `ChatPanel`) calls `executeTask('agent-loop', payload)`.
2.  **`executeTask`** (in `web/lib/events/trigger/index.ts`) checks `isTriggerAvailable()`.
3.  **If available**: Calls `invokeTriggerTask('agent-loop', payload)`, which makes a `POST` request to the Trigger.dev Management API.
4.  **Trigger.dev Cloud** queues the task.
5.  **Local/Remote Worker** picks up the task and runs the handler in `web/trigger/agent-loop.ts`.
6.  **Handler** executes the real logic via `runAgentLoop`.

## Risks & Recommendations

| Risk | Severity | Description |
| :--- | :--- | :--- |
| **Silent Failures** | Medium | If `invokeTriggerTask` fails, the fallback might mask a broken production configuration. |
| **Fragmentation** | Low | `packages/shared/trigger` is orphaned from the main configuration. |
| **SDK Versioning** | Low | Potential confusion between v3 and v4 (Onyx) APIs. |

### Recommended Actions
1.  **Consolidate Tasks**: Move `packages/shared/trigger/broadway-monitor.ts` to `web/trigger/` or add its path to `trigger.config.ts`.
2.  **Enhance Monitoring**: Add logging to `executeWithFallback` that specifically highlights when it falls back *due to a failure* vs *due to a missing configuration*.
3.  **Verify v4 Readiness**: Ensure the usage of the `/v3` subpath is intentional and consistent with the intended Trigger.dev environment (Cloud vs Self-hosted).
