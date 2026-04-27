---
id: bing-documentation-index
title: binG Documentation Index
aliases:
  - index
  - index.md
tags: []
layer: core
summary: '# binG Documentation Index'
anchors:
  - Quick Start for Agents
  - Module Overview
  - Core Documentation
  - Agent System
  - Sandbox & Execution
  - Terminal & WebSocket
  - Streaming & UI
  - Authentication
  - Skills & Tools
  - Containerized Agents
  - V2 Architecture
  - SDK Documentation
  - Implementation Guides
  - Codebase Consolidation
  - Bash & Execution
  - Event System
  - Desktop & Tauri
  - Reviews & Fixes
  - CLI & Tools
  - Reading Order
  - For New Contributors
  - For Implementing Features
  - For Debugging
  - Manifest Fields
  - Automation
  - Notes
---
# binG Documentation Index

Machine-readable index for agent retrieval: `manifest.jsonl`

## Quick Start for Agents

1. **Fetch manifest** — Load `docs/manifest.jsonl` for complete doc catalog
2. **Start here** — This index provides high-level module mapping
3. **Layer ordering** — Core → Implementation → Review → Guides

## Module Overview

| Module | Layer | Description |
|--------|-------|-------------|
| **Agent System** | core | StatefulAgent, orchestration, tool registration |
| **Sandbox** | core | Sandbox providers, warm pool, security |
| **Terminal** | core | Terminal WebSocket, PTY, pipe support |
| **Streaming** | core | Vercel AI SDK, diff viewing, UI streaming |
| **OAuth** | core | Auth integrations, permission tracking |
| **Skills System** | core | Skills MCP, auto-discovery, bootstrap |
| **Spawn** | core | Containerized agents, cloud sandbox |
| **V2 Architecture** | core | V2 agent mode, task flow, wiring |
| **Implementation** | implementation | Feature implementations, summaries |
| **Reviews** | review | Code reviews, fixes, status updates |
| **Guides** | guide | CLI, API, integration guides |

## Core Documentation

### Agent System
- [binG Agent Guidelines](bing-agent-guidelines.md) — Working contract for agents
- [StatefulAgent Architecture](v2-agent-gateway.md) — Agent gateway
- [Autonomous Agent Enhancements](autonomous-agent-enhancements-implementation-complete.md)
- [Capability Chaining](capability-chaining-and-bootstrapped-agency.md)

### Sandbox & Execution
- [Sandbox Architecture](sandbox-architecture-improvements-implementation-complete.md)
- [Warm Pool Manager](architecture-improvements-implementation-status.md)
- [Execution Policy](execution-policy-audit-and-integration-plan.md)
- [Security](containerization-security-guide.md)

### Terminal & WebSocket
- [Terminal Architecture](terminal-architecture-complete-system-design.md)
- [WebSocket Integration](websocket-terminal-integration-guide.md)
- [Pipe Support](terminal-pipe-support-and-enhancements-complete.md)

### Streaming & UI
- [Vercel AI SDK](vercel-ai-sdk-migration-complete-implementation-guide.md)
- [Streaming Diff View](streaming-diff-viewer-fix-final-review.md)
- [Agentic UI](agentic-ui-implementation-guide.md)

### Authentication
- [OAuth Implementation](oauth-integration-implementation-summary.md)
- [User API Keys](user-api-keys-and-credentials-guide.md)
- [Permission Tracking](oauth-permission-tracking-system.md)

### Skills & Tools
- [Skills System](skills-system-implementation-summary.md)
- [Tool Metadata](tool-metadata-implementation-complete.md)
- [Dynamic Tool Discovery](dynamic-tool-discovery-implemented.md)
- [Auto-Registration](auto-registration-system-implementation-complete.md)

### Containerized Agents
- [Containerized AI Agents](spawn/containerized-ai-coding-agents.md)
- [Advanced Agent Features](spawn/advanced-ai-agent-system-complete-summary.md)
- [Cloud Sandbox](spawn/cloud-sandbox-preview-improvements.md)

### V2 Architecture
- [V2 Implementation](v2-multi-agent-architecture-implementation-summary.md)
- [Agent Wiring Guide](v2-agent-system-complete-wiring-guide.md)
- [Task Flow](v2-agent-task-flow-guide.md)
- [Nullclaw Integration](opencode-v2-engine-nullclaw-integration-architecture.md)

### SDK Documentation
- [Trigger LLMs](sdk/trigger-llms.md/)
- [Vercel LLMs](sdk/vercel-llms.txt)
- [WebContainers](sdk/webcontainers-llms.txt)
- [Mastra](sdk/mastra-implementation-status-updated.md)

## Implementation Guides

### Codebase Consolidation
- [Consolidation Plan](codebase-consolidation-plan.md)
- [Final Report](codebase-consolidation-final-report-status.md)
- [Master TODO](bing-centralized-master-to-do-list.md)

### Bash & Execution
- [Bash Native Integration](bash-native-integration-plan.md)
- [Self-Healing](bash-self-healing-implementation-complete.md)
- [DAG Execution](phase-4-durable-event-sourced-task-system.md)

### Event System
- [Event Store](event-store-implementation-summary.md)
- [Durable Events](phase-4-durable-event-sourced-task-system.md)

### Desktop & Tauri
- [Tauri Desktop](tauri-desktop-implementation-plan.md)
- [OPFS Integration](opfs-integration-complete-implementation-report.md)

## Reviews & Fixes

- [Code Review Fixes](code-review-fixes-summary.md)
- [Architecture Review](architecture-improvements-implementation-status.md)
- [Build Environment Fix](build-environment-detection-fix.md)
- [Session Naming](session-naming-and-conflict-prevention-optimized-implementation.md)

## CLI & Tools

- [CLI Documentation](bing-cli-comprehensive-documentation.md)
- [CLI Reviews](bing-cli-review-fixes-and-improvements.md)
- [Tool Metadata](tool-metadata-implementation-complete.md)

## Reading Order

### For New Contributors
1. [binG Agent Guidelines](bing-agent-guidelines.md)
2. [CLI Quick Start](bing-cli-comprehensive-documentation.md)
3. [Architecture Overview](architecture-improvement-plan.md)

### For Implementing Features
1. [V2 Agent Wiring Guide](v2-agent-system-complete-wiring-guide.md)
2. [Auto-Registration](auto-registration-system-implementation-complete.md)
3. [Tool Metadata](tool-metadata-implementation-complete.md)

### For Debugging
1. [Session Management](session-and-tambo-fixes-summary.md)
2. [Code Review Fixes](code-review-fixes-summary.md)
3. [Event System](event-store-implementation-summary.md)

## Manifest Fields

Each document has:

```json
{
  "id": "unique-id",
  "path": "relative/path.md",
  "title": "Full Title",
  "summary": "1-2 sentence summary",
  "tags": ["agent", "spawn", "implementation"],
  "layer": "core|implementation|review|guide",
  "anchors": [{"id": "heading-id", "heading": "Heading Title"}],
  "aliases": ["old-filename", "alternate-title"]
}
```

## Automation

Run normalization:
```bash
npx tsx tools/docs-normalize.ts docs
```

Run link suggestion:
```bash
node tools/link-suggesters.ts docs
```

## Notes

- This index auto-generated from manifest
- Filenames normalized to LLM-friendly slugs
- Frontmatter contains rich metadata for retrieval
