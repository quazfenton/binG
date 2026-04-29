# Codebase Review: MCP & Search

## Overview
The Model Context Protocol (MCP) and Semantic Search (Qdrant) layers provide the agent with the "tools" and "memory" needed to interact with the external world and understand large codebases.

## Key Components

### 1. VFS MCP Tools (`vfs-mcp-tools.ts`)
The bridge between the LLM's decision-making and the Virtual Filesystem.
- **Self-Healing Logic**: Includes sophisticated "argument normalization" that maps common LLM field mistakes (e.g., `filename` vs `path`) to the correct schema. This significantly reduces tool-call failures.
- **Schema Enforcement**: Uses Zod for strict validation of all tool arguments (write, read, diff, delete).
- **Tool Selection**: Replaces fragile text-based tag parsing with structured tool calls, making the agent's actions predictable and reversible.

### 2. MCP Client (`client.ts`)
A robust implementation of the Model Context Protocol client.
- **Transport Flexibility**: Supports `stdio` (local processes), `SSE` (streaming HTTP), and `WebSocket` transports.
- **Advanced Features**: Implements resource subscriptions, progress notifications, and a full OAuth flow for connecting to third-party services.
- **Resilience**: Includes automatic reconnection logic for stdio-based servers and robust NDJSON parsing for streaming output.

### 3. Semantic Search & Embeddings
Powered by Qdrant and the `background-worker`.
- **Hybrid Retrieval**: The system combines semantic vector search (via Qdrant) with AST-based symbol extraction. This "Hybrid" approach allows the agent to find code by "meaning" (e.g., "where is auth handled?") while still being precise about symbol definitions.
- **Background Indexing**: A dedicated worker handles the heavy lifting of generating embeddings and updating the vector database as files change.

## Findings

### 1. High-Quality Tool Abstraction
The `vfs-mcp-tools.ts` is exceptionally well-implemented. The use of `unwrapCodeBlock` and `normalizeToolArgs` shows a deep understanding of LLM "quirks" and proactively addresses them, leading to a much higher agent success rate.

### 2. Security Boundaries
MCP tools strictly enforce the `resolveToScopedPath` rules, ensuring that even if an LLM is tricked into a "jailbreak" attempt, it cannot access files outside the user's assigned sandbox directory.

### 3. Performance of Search
The background worker's reliance on Chokidar and Qdrant is efficient for medium-sized repos but might face latency issues during the "Initial Indexing" phase of a very large codebase.

## Logic Trace: Calling a Custom Tool
1.  **LLM** decides to use a tool (e.g., `list_files`).
2.  **API** (via `chat/route.ts`) receives the tool call.
3.  **MCP Registry** resolves the tool to the `vfs-mcp-tools` implementation.
4.  **Normalization Layer** fixes any argument naming errors.
5.  **VFS Service** executes the actual filesystem operation.
6.  **Event Bus** emits a `tool_invocation` event for the UI.
7.  **Result** is returned to the LLM to inform the next step in its plan.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Tool Execution Replay** | Medium | Enhance the `mcp-store-service` to allow replaying failed tool calls during debugging. |
| **Search Fallback** | Medium | Ensure that if Qdrant is unavailable, the system automatically falls back to the heuristic `searchRecursive` in the VFS. |
| **Standardize Log Levels** | Low | Align the MCP server's logging levels with the main `logger.ts` for unified observability. |
