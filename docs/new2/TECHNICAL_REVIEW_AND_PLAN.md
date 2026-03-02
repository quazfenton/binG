# Technical Review and Integration Plan

## 1. SDK Integration & Syntax Issues

### 1.1 Duplicate Method Definitions (Critical)
Identified duplicate method definitions in multiple provider files which lead to runtime behavior where only the last definition is used:
- **BlaxelProvider (`blaxel-provider.ts`)**: Duplicate `executeCommandAsync`.
- **CodeSandboxProvider (`codesandbox-provider.ts`)**: Duplicate `watchFile` and `watchDirectory`.
- **SpritesSandboxHandle (`sprites-provider.ts`)**: Duplicate `restartService` and `createService`.

### 1.2 E2B Desktop Alignment
- **Method Mismatch**: Current code uses `sandbox.mouse.click({x, y, button})` but documentation in `docs/sdk/e2b/computer-use.md` specifies `sandbox.leftClick(x, y)` and other direct methods.
- **Service Mismatch**: Code uses `sandbox.screen.capture()` instead of the documented `sandbox.screenshot()`.
- **Action Inconsistency**: `moveMouse`, `drag`, `scroll`, `write`, and `press` should be updated to align with the high-level agentic API.

### 1.3 Composio SDK Modernization
- **Deprecated Patterns**: `ComposioAuthManager` uses discouraged low-level APIs (`authConfigs.list`, `connectedAccounts.list`).
- **Session Focus**: Integration should be refactored to focus on the `session` object returned by `composio.create(user_id)`.
- **Type Safety**: Remove excessive `@ts-ignore` by using correct SDK types or properly extending them.

### 1.4 CrewAI TypeScript Re-implementation
- **Feature Gaps**: Missing `manager_llm` support for automatic manager creation in hierarchical processes.
- **Telemetry**: `token_usage` and `usage_metrics` are currently hardcoded to 0.
- **Async Handling**: Improve consistency between `kickoff` and `kickoffAsync`.

---

## 2. Multi-Agent Collaboration & Orchestration

### 2.1 Moving Beyond Mock Logic
- **Real Execution**: Replace `simulateAgentExecution` in `multi-agent-collaboration.ts` with actual calls to the `lib/agent/` system.
- **Dynamic Tool Discovery**: In `plannerStep` (Mastra), tools should be dynamically pulled from the registry rather than hardcoded in the system prompt.

### 2.2 Orchestration Breadth
- Implement a "Simulated Orchestration" layer that allows agents in different frameworks (CrewAI, Mastra, LangGraph) to hand off tasks to each other via the Sandbox Bridge.

---

## 3. Filesystem & Sandbox Security

### 3.1 VFS Sync Improvements
- **Incremental Sync**: Standardize incremental sync using hashing across all providers (currently only in Sprites).
- **Batch Operations**: Standardize `batchWrite` and `batchRead` interfaces.

### 3.2 Security Audit
- **Path Traversal**: Ensure `resolvePath` is robust and consistent across all providers.
- **Command Sanitization**: Standardize command sanitization to prevent shell injection (currently inconsistent).

---

## 5. Architectural Findings & Proposed Refactoring

### 5.1 Fragmented Agentic Logic
Currently, the codebase has several fragmented and overlapping agent implementations:
- **Skeleton**: `unified-agent.ts` provides a good interface but lacks real implementation (many stubs).
- **Action-less**: `stateful-agent.ts` has state management but doesn't actually call tools to perform edits.
- **Advanced**: `fast-agent-service.ts` has sophisticated complexity detection and quality loops but is mostly external-focused.
- **Mock**: `multi-agent-collaboration.ts` defines roles but uses sleep-based simulation.
- **Robust**: `code-agent-workflow.ts` (Mastra) is high-quality but isolated.

### 5.2 The "Unified Orchestration" Proposal
To add breadth and agency as requested, we should consolidate these into a cohesive hierarchy:
1. **Strategic Layer (Orchestrator)**: Uses `FastAgentService`'s complexity detection to decide whether to use a simple LLM call or a complex `MultiAgentCollaboration` / `Mastra Workflow`.
2. **Tactical Layer (UnifiedAgent)**: Fulfill the `UnifiedAgent` methods to actually perform terminal, desktop, and filesystem operations using the `SandboxBridge`.
3. **Assurance Layer (Validator)**: Use the `CodeSandboxPreCommitValidator` and `Mastra Evals` to verify all agent actions before they are persisted to the VFS.

### 5.3 Specific Code Gaps
- **Terminal Integration**: `UnifiedAgent.terminalSend` is currently a placeholder. It must be connected to `enhancedTerminalManager`.
- **Code Execution**: `StatefulAgent.runEditingPhase` should be refactored to use `toolCalling` with the AI SDK, providing the sandbox tools to the model.
- **VFS Integration**: Filesystem operations in `UnifiedAgent` should use the `SandboxBridge`'s `writeFile`/`readFile` which handles provider-specific optimizations (like tar-pipe).

---

## 7. New Implementations & Fulfillment (Deep Review Update)

### 7.1 Unified Agent Capability Expansion (Fulfillment)
- **Structured Git Support**: Created `lib/agent/git-manager.ts` to provide a parsed, high-level Git API. Replaced basic shell-string Git operations in `UnifiedAgent` with this manager, enabling features like `ahead/behind` detection and clean status parsing.
- **Native Code Execution**: Enhanced `UnifiedAgent.codeExecute` to detect and use native `runCode` capabilities of sandbox providers (e.g., E2B) before falling back to manual shell command construction. This improves reliability and output capture.
- **User-Centric Sessions**: Refactored `UnifiedAgent` initialization to accept a `userId`, ensuring proper session ownership and lifecycle management within the `SandboxBridge`.

### 7.2 MCP Transport Robustness
- **Full Implementation of SSE/WS**: Replaced stubs in `lib/mcp/client.ts` with working SSE and WebSocket transport logic, including EventSource event listeners and JSON-RPC message handling.
- **Typed Error Hierarchy**: Defined specific error classes (`MCPServerError`, `MCPResourceError`, etc.) to provide better feedback during tool and resource operations.
- **OAuth Discovery Support**: Implemented `connectWithOAuth` in the MCP Client to support authorized tool calling as per the Smithery SDK cookbooks.

### 7.3 Advanced Sandbox Enhancements
- **Microsandbox Isolation Policy**: Hardened `microsandbox-provider.ts` to block local fallbacks in production environments. Added pattern-based shell sanitization that allows useful shell features while blocking dangerous RCE patterns.
- **Runloop Security**: Applied path validation and command sanitization to the Runloop provider, standardizing its security posture with the rest of the ecosystem.
- **Standardized Desktop Cleanup**: Added `kill()` and lifecycle management to `E2BDesktopProvider` to ensure VM resources are released when agents disconnect.
