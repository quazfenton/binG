# Comprehensive Codebase Wiring & Consolidation

## Overview

This document summarizes the comprehensive review and wiring of the best orchestration implementations across `lib/orchestra`, `lib/agent`, `lib/crewai`, and related modules.

---

## Key Findings

### 1. StatefulAgent (lib/orchestra/stateful-agent/) ✅ NOW WIRED

**What it is:** Comprehensive Plan-Act-Verify agent with:
- Task decomposition engine
- Self-healing capabilities (auto-retry on failure)
- Reflection engine for quality enhancement
- Memory graph for context tracking
- Execution graph for progress tracking
- Human-in-the-loop (HITL) approval workflows
- Transaction logging for VFS shadow commits

**Previously:** Only used internally by orchestra layer

**Now:** 
- Exported from `lib/agent/index.ts`
- Integrated into `processUnifiedAgentRequest()` for complex tasks
- Auto-detected for tasks matching: `create|build|implement|refactor|migrate|add feature|new file|multiple files|project structure`

**Usage:**
```typescript
import { StatefulAgent } from '@/lib/agent';

const agent = new StatefulAgent({
  sessionId: 'my-session',
  maxSelfHealAttempts: 3,
  enableReflection: true,
  enableTaskDecomposition: true,
});

const result = await agent.run('Create a React component with TypeScript');
```

---

### 2. ExecutionGraph (lib/agent/execution-graph.ts) ✅ NOW WIRED

**What it is:** DAG-based task execution engine with:
- Dependency tracking
- Parallel execution of independent tasks
- Real-time status tracking
- Automatic retry on failure
- Progress reporting

**Previously:** Defined but not exported from main agent module

**Now:** Exported from `lib/agent/index.ts` for use in complex workflows

**Usage:**
```typescript
import { executionGraphEngine } from '@/lib/agent';

const graph = executionGraphEngine.createGraph('session-123');
executionGraphEngine.addNode(graph, {
  id: 'task-1',
  type: 'agent_step',
  name: 'Read files',
  dependencies: [],
});
```

---

### 3. UnifiedAgent (lib/agent/unified-agent.ts) ✅ NOW WIRED

**What it is:** Multi-capability agent abstraction with:
- Terminal (WebSocket/SSE)
- Desktop (Computer Use)
- MCP Tools
- File System operations
- Code Execution
- Git Operations
- Preview generation

**Previously:** Available but not prominently exported

**Now:** Exported from `lib/agent/index.ts` as primary agent interface

**Usage:**
```typescript
import { createAgent } from '@/lib/agent';

const agent = await createAgent({
  provider: 'e2b',
  capabilities: ['terminal', 'desktop', 'mcp', 'code-execution'],
  mcp: {
    browserbase: { apiKey: process.env.BROWSERBASE_API_KEY },
  },
});

await agent.terminal.send('ls -la');
await agent.code.run('python', 'print("Hello!")');
```

---

### 4. ReflectionEngine (lib/orchestra/reflection-engine.ts) ✅ INTEGRATED

**What it is:** Multi-perspective quality enhancement with:
- Parallel processing (3 perspectives)
- Technical accuracy review
- Clarity/communication review
- Practical implementation review
- LLM-based analysis (not mock)

**Previously:** Used only by StatefulAgent internally

**Now:** 
- StatefulAgent uses it automatically when `enableReflection: true`
- Configurable via `ENABLE_REFLECTION` env var
- Timeout protection (15s default)

---

### 5. HITL Manager (lib/orchestra/stateful-agent/human-in-the-loop.ts) ✅ AVAILABLE

**What it is:** Human-in-the-loop approval workflows with:
- Configurable approval rules
- Risk-level based decisions
- File-path based rules
- Tool-name based rules
- Audit logging
- Timeout handling

**Previously:** Only used in stateful-agent workflows

**Now:** Exported from `lib/orchestra/stateful-agent/index.ts` for general use

**Usage:**
```typescript
import { requireApproval, createShellCommandRule } from '@/lib/orchestra/stateful-agent';

const approved = await requireApproval(
  'shell_command',
  'rm -rf /tmp/*',
  'Dangerous command requires approval'
);
```

---

### 6. CrewAI (lib/crewai/) ✅ AVAILABLE

**What it is:** Full multi-agent orchestration framework with:
- Role-based agents (Researcher, Writer, Coder, etc.)
- Memory system (short-term, entity, persistent)
- Self-healing execution
- Context window management
- Streaming output
- Knowledge base with RAG
- MCP server integration
- Observability (LangSmith export)
- Multi-crew swarms

**Previously:** Comprehensive but not well-known

**Now:** Well-documented and available for complex multi-agent scenarios

**Usage:**
```typescript
import { createCrew, createAgent, createTask } from '@/lib/crewai';

const researcher = createAgent({
  role: 'Researcher',
  goal: 'Find relevant information',
  backstory: 'Expert researcher with years of experience',
});

const writer = createAgent({
  role: 'Writer',
  goal: 'Write compelling content',
  backstory: 'Professional writer',
});

const crew = createCrew({
  name: 'Content Crew',
  agents: [researcher, writer],
  tasks: [
    createTask({
      description: 'Research topic X',
      agent: researcher,
    }),
    createTask({
      description: 'Write article',
      agent: writer,
    }),
  ],
});

const result = await crew.kickoff();
```

---

### 7. WorkforceManager (lib/agent/workforce-manager.ts) ✅ ALREADY WIRED

**What it is:** Task concurrency management with:
- Max concurrency limiting
- Task queue management
- Parallel task execution
- Status tracking

**Previously:** Already used in chat route for workforce-enabled tasks

**Now:** Still available, no changes needed

---

### 8. ToolExecutor (lib/orchestra/stateful-agent/tools/tool-executor.ts) ✅ COMPREHENSIVE

**What it is:** Robust tool execution with:
- Sandbox health checks before execution
- Timeout enforcement per tool
- Execution logging and metrics
- Context management (VFS, transaction log)

**Previously:** Only used by StatefulAgent

**Now:** Available for any tool execution needs

**Key Features:**
```typescript
// Automatic timeout enforcement
const result = await executor.execute('execShell', { command: 'npm install' });
// Times out after 120s (configurable per tool)

// Sandbox health check
const health = await executor.checkSandboxHealth();
if (!health.healthy) {
  // Block execution on unhealthy sandbox
}
```

---

## Integration Points

### V1 LLM Chat API (`app/api/chat/route.ts`)

**Current:** Uses `processUnifiedAgentRequest()` which now includes:
- StatefulAgent for complex tasks (auto-detected)
- OpenCode Engine for simpler tasks
- V1 API as fallback

**Improvement:** Complex tasks now get Plan-Act-Verify workflow automatically

### V2 OpenCode Integration

**Current:** Uses OpenCode Engine directly

**Improvement:** Can now use StatefulAgent for better orchestration

### CrewAI Multi-Agent

**Current:** Available but separate

**Improvement:** Can be integrated via UnifiedAgent for role-based workflows

---

## Environment Variables

```bash
# Enable/disable StatefulAgent for complex tasks
ENABLE_STATEFUL_AGENT=true  # Default: true

# Enable/disable reflection for quality enhancement
ENABLE_REFLECTION=true  # Default: true

# Reflection settings
FAST_AGENT_REFLECTION_THREADS=3  # Parallel perspectives
FAST_AGENT_REFLECTION_TIMEOUT=15000  # 15s timeout
FAST_AGENT_REFLECTION_MODEL=gpt-4o-mini

# HITL settings
ENABLE_HITL=true  # Enable human-in-the-loop
HITL_TIMEOUT=300000  # 5 minute approval timeout
HITL_APPROVAL_REQUIRED_ACTIONS=shell_command,file_write
```

---

## Best Practices

### For Complex Multi-Step Tasks
```typescript
// Use StatefulAgent for Plan-Act-Verify workflow
import { StatefulAgent } from '@/lib/agent';

const agent = new StatefulAgent({
  enableTaskDecomposition: true,  // Break into subtasks
  enableReflection: true,  // Quality enhancement
  maxSelfHealAttempts: 3,  // Auto-retry on failure
});

const result = await agent.run('Build a full-stack app with React and Node.js');
```

### For Simple Tasks
```typescript
// Use UnifiedAgent for straightforward operations
import { createAgent } from '@/lib/agent';

const agent = await createAgent({
  provider: 'e2b',
  capabilities: ['terminal', 'file-ops'],
});

await agent.terminal.send('npm install express');
```

### For Multi-Agent Workflows
```typescript
// Use CrewAI for role-based collaboration
import { createCrew, createAgent } from '@/lib/crewai';

const crew = createCrew({
  name: 'Dev Team',
  agents: [
    createAgent({ role: 'Architect', /* ... */ }),
    createAgent({ role: 'Developer', /* ... */ }),
    createAgent({ role: 'Tester', /* ... */ }),
  ],
  process: 'sequential',  // or 'hierarchical'
});

await crew.kickoff();
```

---

## Migration Guide

### From V1 Simple LLM Calls
```typescript
// Before: Single LLM call, minimal orchestration
const response = await llmService.chat({ messages });

// After: Automatic orchestration for complex tasks
const result = await processUnifiedAgentRequest({
  userMessage: 'Create a React component',
  // StatefulAgent auto-used for complex tasks
});
```

### From Manual Tool Execution
```typescript
// Before: Manual tool calls
await filesystem.writeFile(path, content);
await sandbox.executeCommand('npm install');

// After: StatefulAgent with automatic orchestration
const agent = new StatefulAgent();
await agent.run('Add authentication to the app');
// Automatically: plan → read files → write files → verify → self-heal if needed
```

---

## Summary

### What Was Wired

| Module | Previously | Now |
|--------|-----------|-----|
| StatefulAgent | Internal only | Exported + auto-used for complex tasks |
| ExecutionGraph | Defined | Exported + available |
| UnifiedAgent | Available | Prominently exported |
| ReflectionEngine | Internal | Integrated into StatefulAgent |
| HITL Manager | Internal | Exported for general use |
| CrewAI | Available | Well-documented |
| ToolExecutor | Internal | Available with health checks |

### Benefits

1. **Better Orchestration:** Complex tasks get Plan-Act-Verify workflow automatically
2. **Self-Healing:** Automatic retry on failures
3. **Quality Enhancement:** Reflection improves output quality
4. **Task Decomposition:** Complex tasks broken into manageable subtasks
5. **Human Oversight:** HITL for dangerous operations
6. **Multi-Agent:** CrewAI for role-based collaboration
7. **Robust Execution:** ToolExecutor with health checks and timeouts

### Next Steps

1. **Monitor Usage:** Track StatefulAgent usage for complex tasks
2. **Tune Detection:** Adjust complex task regex based on real usage
3. **Add Examples:** Create more usage examples in docs
4. **Performance:** Monitor reflection overhead vs quality improvement

---

## Files Modified

1. `lib/agent/index.ts` - Added StatefulAgent, ExecutionGraph, UnifiedAgent exports
2. `lib/orchestra/unified-agent-service.ts` - Added StatefulAgent mode for complex tasks
3. `lib/agent/nullclaw-integration.ts` - Fixed parallel port collision (sequential spawn)
4. `lib/agent/multi-agent-collaboration.ts` - Fixed agent cleanup on error (try/finally)

**All comprehensive implementations are now properly wired and available!** 🎉
