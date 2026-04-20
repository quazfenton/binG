---
id: orchestration-modes-guide
title: Orchestration Modes Guide
aliases:
  - ORCHESTRATION_MODES
  - ORCHESTRATION_MODES.md
  - orchestration-modes-guide
  - orchestration-modes-guide.md
tags:
  - guide
layer: core
summary: "# Orchestration Modes Guide\r\n\r\n## Overview\r\n\r\nThe binG agent system supports **5 different orchestration frameworks** that can be selected at runtime via UI or API headers. This allows developers to test and compare different agent architectures without code changes.\r\n\r\n**Default**: `task-router` (u"
anchors:
  - Overview
  - Available Modes
  - 1. Task Router (`task-router`) ✅ Default
  - "2. Unified Agent (`unified-agent`) \U0001F7E1"
  - "3. Mastra Workflow (`mastra-workflow`) \U0001F7E1"
  - "4. CrewAI (`crewai`) \U0001F7E1"
  - 5. V2 Executor (`v2-executor`) ✅
  - How to Use
  - Via UI (Recommended)
  - Via API Headers
  - Programmatically
  - Architecture
  - Mode Comparison
  - Error Handling
  - Logging
  - Performance
  - Security
  - Troubleshooting
  - Mode not changing
  - Mode execution fails
  - Default behavior changed
  - Development Tips
  - Future Enhancements
  - Related Files
  - Support
relations:
  - type: example-of
    id: orchestration-visualizer-guide
    title: Orchestration Visualizer Guide
    path: orchestration-visualizer-guide.md
    confidence: 0.318
    classified_score: 0.422
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: opentelemetry-setup-guide
    title: OpenTelemetry Setup Guide
    path: opentelemetry-setup-guide.md
    confidence: 0.308
    classified_score: 0.379
    auto_generated: true
    generator: apply-classified-suggestions
---
# Orchestration Modes Guide

## Overview

The binG agent system supports **5 different orchestration frameworks** that can be selected at runtime via UI or API headers. This allows developers to test and compare different agent architectures without code changes.

**Default**: `task-router` (unchanged behavior)

---

## Available Modes

### 1. Task Router (`task-router`) ✅ Default

**Backend**: `lib/agent/task-router.ts`

**Description**: Intelligent task routing between OpenCode (coding tasks) and Nullclaw (non-coding tasks).

**Features**:
- Automatic task classification
- Execution policy selection (local-safe, sandbox-required, etc.)
- OpenCode for coding tasks
- Nullclaw for messaging, browsing, automation

**Best For**: General purpose tasks, mixed coding + automation workflows

**Configuration**:
```typescript
// No configuration needed - this is the default
```

---

### 2. Unified Agent (`unified-agent`) 🟡

**Backend**: `lib/orchestra/unified-agent-service.ts`

**Description**: Intelligent fallback chain with StatefulAgent as primary executor.

**Features**:
- StatefulAgent for complex multi-step tasks
- Automatic fallback: StatefulAgent → V2 Native → V2 Local → V1 API
- Mastra workflow integration
- Tool execution support
- Streaming support

**Best For**: Complex agentic workflows requiring planning and verification

**Configuration**:
```env
AI_SDK_MAX_STEPS=15
OPENCODE_SYSTEM_PROMPT="..."
```

---

### 3. Mastra Workflow (`mastra-workflow`) 🟡

**Backend**: `lib/agent/mastra-workflow-integration.ts`

**Description**: Mastra workflow engine with quality evaluations and memory.

**Features**:
- Workflow-based execution
- Quality evaluations (security, code quality)
- Memory system for context retention
- MCP integration
- Task proposal/review workflow

**Best For**: Structured workflows with quality gates and compliance requirements

**Configuration**:
```env
MASTRA_TELEMETRY_ENABLED=false
MASTRA_MEMORY_ENABLED=true
MASTRA_EVALS_ENABLED=false
MASTRA_SCHEMA=mastra
```

---

### 4. CrewAI (`crewai`) 🟡

**Backend**: `lib/crewai/`

**Description**: Role-based multi-agent collaboration system.

**Features**:
- Role-based agents (Planner, Coder, Critic, Manager)
- Sequential/hierarchical/consensual processes
- Self-healing execution with retry budgets
- Knowledge base integration
- Memory system (short-term, entity, persistent)
- Streaming support

**Best For**: Complex tasks requiring multiple specialized agents working together

**Configuration**:
```env
USE_CREWAI=false  # Set to true to enable
CREWAI_DEFAULT_PROCESS=sequential  # sequential | hierarchical | consensual
CREWAI_PROCESS_LLM=gemini-2.5-flash
CREWAI_PLANNER_AGENT=planner
CREWAI_CODER_AGENT=coder
CREWAI_CRITIC_AGENT=critic
```

---

### 5. V2 Executor (`v2-executor`) ✅

**Backend**: `lib/agent/v2-executor.ts`

**Description**: OpenCode containerized execution with sandbox isolation.

**Features**:
- Containerized execution
- Sandbox isolation per user
- Direct file operations
- Bash command execution
- Tool manager integration
- Session management

**Best For**: Isolated code execution with full sandbox security

**Configuration**:
```env
# Uses standard OpenCode configuration
OPENCODE_SYSTEM_PROMPT="..."
```

---

## How to Use

### Via UI (Recommended)

1. Open workspace panel (click panel toggle)
2. Click **"Agent"** tab (Brain icon)
3. Select desired orchestration mode
4. Mode persists to localStorage
5. All subsequent requests use selected mode

### Via API Headers

```typescript
import { getOrchestrationModeHeaders } from '@/contexts/orchestration-mode-context';

// Client-side
const headers = {
  'Content-Type': 'application/json',
  ...getOrchestrationModeHeaders({ 
    mode: 'unified-agent',
    autoApply: false,
    streamEnabled: true,
  }),
};

fetch('/api/chat', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    messages: [...],
    stream: true,
  }),
});
```

**Headers Sent**:
- `X-Orchestration-Mode`: Mode name (e.g., `unified-agent`)
- `X-Orchestration-Auto-Apply`: `true` or `false`
- `X-Orchestration-Stream`: `true` or `false`

### Programmatically

```typescript
import { executeWithOrchestrationMode } from '@bing/shared/agent/orchestration-mode-handler';

const result = await executeWithOrchestrationMode('mastra-workflow', {
  task: 'Build a todo app with React',
  sessionId: 'session-123',
  ownerId: 'user-456',
  stream: false,
});

console.log(result);
// {
//   success: true,
//   response: '...',
//   steps: [...],
//   metadata: { agentType: 'mastra-workflow', duration: 1234 }
// }
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Request                        │
│  Headers: X-Orchestration-Mode: unified-agent           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│           app/api/chat/route.ts                          │
│  getOrchestrationModeFromRequest(req)                    │
│  executeWithOrchestrationMode(mode, request)             │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│      lib/agent/orchestration-mode-handler.ts             │
│  Switch statement routes to appropriate backend:         │
│  - task-router → lib/agent/task-router.ts               │
│  - unified-agent → lib/orchestra/unified-agent-service  │
│  - mastra-workflow → lib/agent/mastra-workflow-...      │
│  - crewai → lib/crewai/                                 │
│  - v2-executor → lib/agent/v2-executor.ts               │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│              Selected Backend Executes                   │
│  Returns unified OrchestrationResult format              │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│              Response to Client                          │
│  JSON or Streaming based on request                      │
└─────────────────────────────────────────────────────────┘
```

---

## Mode Comparison

| Feature | task-router | unified-agent | mastra-workflow | crewai | v2-executor |
|---------|-------------|---------------|-----------------|--------|-------------|
| **Status** | ✅ Stable | 🟡 Experimental | 🟡 Experimental | 🟡 Experimental | ✅ Stable |
| **Speed** | Fast | Medium | Medium | Slow | Fast |
| **Complexity** | Low | High | High | Very High | Medium |
| **Tool Support** | Basic | Full | Full | Full | Full |
| **Streaming** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Memory** | None | Stateful | Mastra Memory | Crew Memory | Session |
| **Evals** | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Multi-Agent** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Best For** | General | Complex | Quality | Collaboration | Isolation |

---

## Error Handling

All modes return a unified result format:

```typescript
interface OrchestrationResult {
  success: boolean;
  response?: string;
  steps?: any[];
  error?: string;
  metadata?: {
    agentType: string;
    duration?: number;
    [key: string]: any;
  };
}
```

**Error Scenarios**:
- Invalid mode → Falls back to `task-router`
- Backend failure → Returns `success: false` with error message
- Timeout → Returns error with duration metadata
- Unknown mode → Throws error (shouldn't happen due to type safety)

---

## Logging

All orchestration modes log to the console with prefix `[Agent:OrchestrationMode]`:

```
[Agent:OrchestrationMode] Executing with orchestration mode { mode: 'unified-agent', task: '...' }
[Agent:OrchestrationMode] Orchestration mode completed { mode: 'unified-agent', success: true, duration: 1234 }
[Agent:OrchestrationMode] Orchestration mode execution failed { mode: 'crewai', error: '...' }
```

---

## Performance

**Execution Time** (approximate, varies by task):
- `task-router`: 1-5 seconds
- `v2-executor`: 2-10 seconds
- `unified-agent`: 5-30 seconds
- `mastra-workflow`: 10-60 seconds
- `crewai`: 15-120 seconds

**Memory Usage**:
- All modes: < 50MB base
- `crewai`: +100MB for multi-agent state
- `mastra-workflow`: +50MB for memory system

---

## Security

- ✅ Mode selection is client-side only
- ✅ Server validates mode against whitelist
- ✅ Invalid modes fall back to safe default (`task-router`)
- ✅ No privilege escalation risk
- ✅ Uses existing authentication/authorization
- ✅ Sandboxing enforced per mode

---

## Troubleshooting

### Mode not changing
1. Check localStorage: `localStorage.getItem('orchestration_mode_config')`
2. Verify header is sent: Check Network tab in DevTools
3. Check server logs for mode selection

### Mode execution fails
1. Check server logs: `[Agent:OrchestrationMode] Orchestration mode execution failed`
2. Verify backend service is available
3. Check environment variables for mode-specific config

### Default behavior changed
1. Reset mode: Click "Reset to Default" in Agent tab
2. Clear localStorage: `localStorage.removeItem('orchestration_mode_config')`
3. Refresh page

---

## Development Tips

1. **Start with `task-router`** - It's the most stable and well-tested
2. **Test incrementally** - Try one mode at a time
3. **Check logs** - Orchestration logs provide detailed debugging info
4. **Use UI selector** - Easier than manually setting headers
5. **Monitor performance** - Some modes are significantly slower

---

## Future Enhancements

- [ ] Mode-specific configuration UI
- [ ] Performance benchmarking dashboard
- [ ] Automatic mode recommendation based on task
- [ ] Mode comparison (side-by-side results)
- [ ] Hybrid modes (combine multiple strategies)
- [ ] Mode presets (save favorite configurations)
- [ ] Analytics (track mode usage and success rates)

---

## Related Files

- **Handler**: `lib/agent/orchestration-mode-handler.ts`
- **Context**: `contexts/orchestration-mode-context.tsx`
- **UI**: `components/agent-tab.tsx`
- **API Route**: `app/api/chat/route.ts`
- **Task Router**: `lib/agent/task-router.ts`
- **Unified Agent**: `lib/orchestra/unified-agent-service.ts`
- **Mastra**: `lib/agent/mastra-workflow-integration.ts`
- **CrewAI**: `lib/crewai/`
- **V2 Executor**: `lib/agent/v2-executor.ts`

---

## Support

For issues or questions:
1. Check logs first: `[Agent:OrchestrationMode]`
2. Review this guide
3. Check individual mode documentation
4. Open GitHub issue with mode and error details
