---
id: bing-technical-improvement-and-integration-plan
title: binG Technical Improvement & Integration Plan
aliases:
  - r2TECHNICAL_PLAN
  - r2TECHNICAL_PLAN.md
tags: []
layer: core
summary: "# binG Technical Improvement & Integration Plan\r\n\r\n**Date:** March 4, 2026\r\n**Status:** In Progress - Initial Findings Phase\r\n\r\n## 1. Executive Summary\r\nThis document outlines the findings from a \"painstakingly granular\" review of the binG codebase. While the project has an ambitious scope with inte"
anchors:
  - 1. Executive Summary
  - 2. Core Orchestration Improvements
  - 2.1 Unified Agent Expansion
  - 2.2 Intent Detection Refinement
  - 3. Sandbox Provider Enhancements
  - 3.1 Security Relaxation with Safeguards
  - 3.2 Full SDK Integration & Fixes
  - Tool Integration Parsers
  - Daytona
  - E2B
  - Blaxel
  - Sprites
  - CodeSandbox
  - 4. Backend Production Readiness
  - 4.1 Replace Mock Data & Fix Types
  - 5. Next Steps
---
# binG Technical Improvement & Integration Plan

**Date:** March 4, 2026
**Status:** In Progress - Initial Findings Phase

## 1. Executive Summary
This document outlines the findings from a "painstakingly granular" review of the binG codebase. While the project has an ambitious scope with integrations for multiple sandbox and agent providers (E2B, Blaxel, Daytona, Composio, etc.), there are significant gaps between the claimed functionality and the actual implementation.

**Key Issues:**
1. **Simulation vs. Reality**: Many backend modules are theoretical or mock-based.
2. **Specialization Under-utilization**: Provider-specific advanced features (E2B Amp, Codex; Blaxel Batch; Daytona LSP) are not fully exposed to the unified agents.
3. **Restrictive Security**: The `SandboxSecurityManager` currently blocks essential shell features (pipes, redirects, multiple commands), limiting agent efficacy.
4. **Unwired Event System**: Frontend events for snapshots and previews are emitted but not listened to by the backend.

---

## 2. Core Orchestration Improvements

### 2.1 Unified Agent Expansion
The `UnifiedAgent` class needs to be expanded to support specialized provider services.

**Current State:**
- Supports terminal, desktop, and MCP.
- Does not expose E2B Amp/Codex or Blaxel Batch Jobs.

**Proposed Change:**
- Add `agent.advanced.executeAmp()` and `agent.advanced.runBatchJob()`.
- Implement provider-specific "capabilities" detection.

### 2.2 Intent Detection Refinement
The `intent-detector.ts` relies on basic pattern matching.

**Proposed Change:**
- Implement an `llm-intent-classifier` to more accurately route between `v1-api` and `v2-native`.
- Add support for detecting "complex" intents that require multi-agent collaboration.

---

## 3. Sandbox Provider Enhancements

### 3.1 Security Relaxation with Safeguards
The `SHELL_METADATA_CHARS` block in `SandboxSecurityManager.ts` is too aggressive.

**Proposed Change:**
- Move from a "black-list" of characters to a "validated-list" of patterns.
- Allow `;`, `&&`, `||`, and `|` when they don't precede dangerous commands.
- Implement a `SafeShellParser` that analyzes the command tree before allowing execution.

**CRITICAL SECURITY FIXES**:
- **Unified Agent Naive Escaping**: In `unified-agent.ts` lines 499-512, code execution uses naive shell escaping (`python3 -c '${escaped}'`) that is VULNERABLE to command injection. Replace with writing the script to a temporary file and executing that file directly without shell interpretation of the content.
- **Router Intent Bypasses**: In `priority-request-router.ts` lines 1096-1128, tool intent detection is brittle. Implement a more robust XML/JSON parser that cannot be fooled by hidden tags or malformed strings.

### 3.2 Full SDK Integration & Fixes
Reviewing `docs/sdk/` and subagent analysis reveals:

#### Tool Integration Parsers
- **Grammar Parser**: Fix regex greediness, add recursion depth limits, and address potential Regex DoS.
- **XML Parser**: Add CDATA support, handle nested structures, and handle XML attributes.
- **Self-Healing**: **CRITICAL FIX**: `validate()` is currently synchronous but calls an asynchronous LLM healing method (`attemptDeepHeal`). This causes silent failures or race conditions. Refactor `validate()` to be `async`.
- **Composio**: Migrate to v3 SDK session-based tool calling (`composio.create(userId)`). This replaces passing `entityId` to individual actions and provides a more cohesive context for tool execution.
- **Trigger Subscriptions**: Implement `composio.triggers.subscribe()` for enhanced real-time event handling from SaaS tools.
- **Smithery**: Fix type mismatch in `execute()` where `toolKey` is used instead of `toolName`.

#### Daytona
- **LSP Service**: Wire `getLSPService()` to the frontend for real-time code intelligence in the Monaco editor.
- **Object Storage**: Wire `getObjectStorageService()` for large file handling.
- **Missing Ops**: Implement `gitClone()`, `gitPull()`, `gitStatus()`, `gitDiff()`, and `watchDirectory()`.
- **Type Safety**: Replace `any` in `createParams` with typed configuration.

#### E2B
- **Amp/Codex**: Integrate these specialized agents into the `UnifiedAgent` flow for complex refactoring tasks.
- **Fix streamJson()**: **CRITICAL**: Yield events in the `streamJson()` generator; it currently parses them but discards the results.
- **Network Isolation (BYOC)**: Implement the `allow_internet_access` toggle and investigate BYOC (Bring Your Own Cloud) patterns for enterprise VPC isolation.
- **Session Persistence**: Implement `betaPause()` and `createSnapshot()` to persist **memory state** (running processes), enabling long-running agent sessions that can survive restarts.
- **Consolidate Git**: Merge `E2BSandboxHandle` manual git execution with `E2BGitIntegration` wrapper.

#### Blaxel
- **Mark 3.1 Runtime**: Fully leverage the Mark 3.1 runtime optimized for background tasks and AI code execution.
- **Fix createTrigger()**: **CRITICAL**: Replace mock trigger creation in `blaxel-async.ts` with real Blaxel API calls.
- **Async Execution**: Fully wire the callback mechanism to an API endpoint that updates the UI state. Use `async=true` query parameter to prevent HTTP timeouts for long-running tasks.
- **Volume Templates**: Allow users to create and use volume templates for rapid environment setup. Add caching and versioning.
- **Batch Jobs**: Fix type mismatch in job results and implement `job.wait_for_execution()` logic for background processing.
- **Handoff Orchestration**: Implement Handoff Orchestration (HO) patterns for multi-agent coordination within a single mono-repo deployment.
- **File Ops**: Implement missing `uploadFile()` and `downloadFile()` methods.

#### Sprites
- **Checkpoint System**: Wire the checkpoint manager to the frontend "Snapshot" buttons.
- **Auto-Suspend**: Fully utilize the memory preservation feature for better UX on wake.

#### CodeSandbox
- **Fix deleteSnapshot()**: Implement real snapshot deletion instead of just a `console.warn`.

---

## 4. Backend Production Readiness

### 4.1 Replace Mock Data & Fix Types
- **Snapshot System**: Replace `mockSnapshots` with real S3/MinIO operations.
- **Metrics**: Wire the counters in `sandbox-manager.ts` and `core-sandbox-service.ts`.
- **Unified Agent Service**: 
    - Remove duplicate `runV2Local` implementation (lines 347-389).
    - Fix `OpenCodeEngineResult` property mismatches (`commandsExecuted`, `steps`).
    - Add missing `sandboxId` to `runV2AgentLoop` calls.
    - Standardize `LLMMessage` role types.
- **Intent Detection**: Increase confidence threshold from 0.3 to at least 0.7 to reduce false positives. Implement weighted scoring improvements to prevent adversarial bypasses.
- **Simulated Orchestration**: Transition from a proof-of-concept to real execution. Improve the consensus logic from `approvals >= 1` to a true majority requirement.
- **Type Consolidation**: Remove duplicate definitions of `ToolResult`, `PtyOptions`, and `PtyHandle` across multiple files.
- **Interface Segregation**: Move provider-specific methods (like `runBatchJob` or `createProxy`) from the base `SandboxHandle` interface to specialized/extended interfaces to prevent leakage.


---

## 5. Next Steps
- [ ] Implement `SafeShellParser`.
- [ ] Wire Sprites Checkpoint Manager to Snapshot API.
- [ ] Expose Daytona LSP to frontend.
- [ ] Replace mock snapshots with real storage logic.
