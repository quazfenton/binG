# Codebase Review: API & UI Integration

## Overview
The API and UI layers are the most volatile and feature-rich parts of the binG platform, integrating dozens of specialized services into a unified developer experience.

## Key Components

### 1. Unified Chat API (`web/app/api/chat/route.ts`)
A massive (5800+ line) "Mega-Route" that orchestrates the entire request lifecycle.
- **Intelligence**: Uses a multi-factor `TaskClassifier` (Semantic + Keyword + Context) to decide whether to route a request to the standard V1 LLM path or the V2 Agentic path.
- **Streaming Excellence**: Implements progressive file edit parsing. As the LLM streams tokens, the API identifies diffs/file blocks and emits `FILE_EDIT` events via SSE *before* the response is even finished.
- **Resilience**: Includes complex retry logic with "Model Ranking"—if gpt-4-turbo fails with an empty response, the system automatically suggests or retries with a higher-ranked model based on telemetry.
- **Security**: Aggressive path sanitization ensures that LLM-generated file paths don't accidentally write outside the session boundary or contain malicious control characters.

### 2. Conversation Interface (`web/components/conversation-interface.tsx`)
The main React entry point.
- **State Management**: Orchestrates several complex contexts (Panel, Streaming, Orchestration, Auth, SpecEnhancement).
- **Durable UI**: Persists session state (current model, provider, conversation ID) to `localStorage`, providing a "hot reload" experience for developers.
- **Integration**: Wires together the `InteractionPanel` (Chat), `TerminalPanel` (PTY), and `CodePreviewPanel` (Monaco/Diffs).

### 3. Kernel API (`web/app/api/kernel/stats/route.ts`)
Provides real-time visibility into the `AgentKernel` scheduler, enabling the "Orchestration Visualizer" UI to show agent queue statuses and resource usage.

## Findings

### 1. Architectural Risk: The "Mega-Route"
The `api/chat/route.ts` has become a "God Object" in the API layer.
- **Risk**: It is difficult to test, prone to TDR (Temporal Dead Zone) errors due to closure complexity, and violates the Single Responsibility Principle.
- **Recommendation**: Refactor the route by extracting major sub-pipelines (Rate Limiting, Task Classification, V1 Loop, V2 Path, SSE Handling) into separate, testable service modules.

### 2. High Sophistication in SSE
The progressive parsing of file edits during streaming is an industry-leading feature. It makes the UI feel significantly faster than competing platforms that wait for the full response to finish.

### 3. Session Naming Logic
The transition to sequential session naming (001, 002) is a significant UX improvement over long UUIDs.
- **Observation**: The system intelligently attempts to rename these sequential folders to match the detected project name (e.g., `my-react-app`) after the first few messages.

## Logic Trace: End-to-End Request
1.  **UI** sends a POST request to `/api/chat`.
2.  **API** validates Auth/Anonymous session and checks Rate Limits.
3.  **Task Classifier** decides the request type (Code vs. Chat).
4.  **VFS** builds a "Context Pack" (file tree + contents) to inject into the LLM prompt.
5.  **Priority Router** selects the optimal LLM provider.
6.  **SSE Stream** starts:
    - Tokens are emitted as `TOKEN` events.
    - File edits are detected and emitted as `FILE_EDIT (detected)` events.
7.  **Stream Completes**:
    - Final file edits are parsed and applied to the **VFS**.
    - Session is renamed if a project structure is detected.
8.  **UI** receives the `DONE` event and refreshes the file tree.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Refactor Chat Route** | High | Split the 5800-line route into smaller, more manageable services. |
| **Atomic VFS Commits** | Medium | Ensure that batch file edits from a single response are committed atomically to prevent partial workspace states. |
| **Formalize Task Types** | Medium | Move the `strong_code_pattern` and `weak_code_patterns` into the shared `task-classifier` package for consistency. |
| **Telemetry for Classifier** | Low | Log classifier confidence scores to a dashboard to monitor and tune the "Auto-V2" routing threshold. |
