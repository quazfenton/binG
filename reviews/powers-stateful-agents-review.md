# Codebase Review: Powers & Stateful Agents

## Overview
The "Powers" and "Stateful Agent" layers provide the cognitive and executive capabilities that transform a regular LLM into an autonomous agent. This includes long-term memory (Mem0), specialized capabilities (Search, Code Analysis), and durable workflow execution.

## Key Components

### 1. Agentic Powers (`web/lib/powers/`)
Specialized tools and capabilities that agents can "invoke".
- **Mem0 Integration (`mem0-power.ts`)**: Provides persistent, cross-session memory. It stores user preferences, past decisions, and project-specific knowledge, allowing the agent to "learn" over time.
- **Search & Lookup**: Specialized powers for `web-search`, `code-search` (Qdrant), and `doc-lookup`. These are schema-enforced tools that the agent can use to gather context.
- **WASM Support**: Includes a `/wasm` directory for running high-performance computations (like treesitter-based AST parsing) directly in the edge/node environment.

### 2. Workflow Templates (`workflow-templates.ts`)
A library of pre-defined, multi-step agentic workflows.
- **Durable Logic**: Templates for `code-review`, `security-audit`, `bug-fix`, and `deployment`.
- **Approval Gates**: Built-in support for `approval` steps, enabling Human-in-the-Loop (HITL) workflows where an agent pauses for a user's "OK" before proceeding to high-risk actions (like merging code).
- **Mastra Integration**: Wires the templates into the Mastra workflow engine for reliable, stateful execution with retries and timeout management.

### 3. Stateful Agent & Checkpointing (`web/lib/orchestra/stateful-agent/`)
- **Durable State**: Implements checkpointers that save the agent's internal thought process and tool execution history to SQLite or Redis.
- **HITL Audit Logger**: A specialized logger that captures every interaction where a human was involved, providing an audit trail for autonomous decisions.

## Findings

### 1. Advanced Memory Management
The `memory-wipe` and `context-refresh` workflows show a sophisticated approach to LLM context limits. The system can "summarize and reset" its own memory to stay within token windows while preserving key information.

### 2. Industry-Standard Workflows
The `deployment` and `security-audit` templates are not just stubs—they contain realistic steps (build, test, scan, approval, merge) that mirror production DevOps pipelines.

### 3. Memory Safety & Isolation
The `WorkflowTemplateService` uses `AsyncLocalStorage` (via `vfs-mcp-tools.ts`) and session-scoped checkpointers to ensure that one agent's state or memory never leaks into another user's session.

## Logic Trace: Running a Security Audit
1.  **User** requests a "Security Audit" of their repository.
2.  **Workflow Service** loads the `security-audit` template.
3.  **Step 1**: Executes `dependency_audit` (Tool).
4.  **Step 2**: Executes `code_security_scan` (Tool).
5.  **Step 3**: `reporter` (Agent) synthesizes findings from previous steps.
6.  **Mem0**: The agent records any discovered architectural patterns into long-term memory for future turns.
7.  **Final Report**: Emitted as a session event to the UI.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Tool Dependency Graph** | Medium | Expose the `steps` dependency graph in the UI's `OrchestrationVisualizer` to show users what the agent is currently waiting on. |
| **WASM Tree-sitter Update** | Medium | Ensure the WASM-based parsers are updated to support newer language features (e.g., TypeScript 5.0 decorators). |
| **Approval Timeout Policy** | Low | Add a configurable "Auto-deny" or "Auto-escalate" timeout for approval steps that sit idle for more than 24 hours. |
| **Mem0 Privacy Controls** | Low | Implement a "Forget Me" tool that allows users to explicitly delete specific memories or entire Mem0 profiles. |
