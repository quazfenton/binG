# LangGraph & Modern Agentic Architecture Integration Plan

**Date**: 2026-02-27  
**Status**: Planning & Implementation  
**Goal**: Add LangGraph orchestration layer WITHOUT replacing existing custom stateful agent

---

## Executive Summary

After thorough review of LangChain/LangGraph documentation and the existing codebase:

### Current State
- ✅ LangChain packages installed: `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint`
- ❌ **NOT USED** in codebase - custom orchestration used instead
- ✅ Custom stateful agent is **production-ready** (~92% complete)
- ✅ Shadow commit system, checkpointer, HITL all working

### Opportunity
Add **LangGraph-based orchestration** as an **OPTIONAL alternative** to custom orchestration:
- ✅ **Builds upon** existing tools and state management
- ✅ **Does NOT replace** working custom implementation
- ✅ **Provides** graph-based workflows for complex multi-stage tasks
- ✅ **Enables** LangSmith observability integration

---

## Architecture Comparison

### Current Custom Orchestration ✅
```
User → StatefulAgent → Tools → VFS State → Shadow Commit
                       ↓
                 Self-Healing Loop
```

### New LangGraph Option (Addition)
```
User → LangGraph Graph → Nodes (Planner/Executor/Verifier) → Checkpointer
                         ↓
                   Existing Tools (reused!)
                         ↓
                   Existing VFS State (reused!)
```

**Key Insight**: LangGraph nodes can **CALL** existing tools and state management!

---

## Implementation Plan

### Phase 1: LangGraph Core Integration (NEW)

#### 1.1 State Definitions
**File**: `lib/langgraph/state.ts`

```typescript
import { Annotation } from '@langchain/langgraph';
import type { VfsState } from '@/lib/stateful-agent/state';

// Extend existing VfsState with LangGraph annotations
export const AgentState = Annotation.Root({
  // Reuse existing VFS state
  vfs: Annotation<Record<string, string>>,
  transactionLog: Annotation<Array<any>>,
  currentPlan: Annotation<any>,
  errors: Annotation<Array<any>>,
  retryCount: Annotation<number>,
  
  // Add LangGraph-specific state
  messages: Annotation<any[]>,
  next: Annotation<string | undefined>,
});
```

**Benefits**:
- ✅ Reuses existing `VfsState` interface
- ✅ Adds LangGraph message handling
- ✅ Compatible with existing checkpoint system

---

#### 1.2 Graph Nodes (NEW)
**File**: `lib/langgraph/nodes/index.ts`

```typescript
// Reuse existing agents as graph nodes!
import { StatefulAgent } from '@/lib/stateful-agent/agents/stateful-agent';
import type { AgentState } from '../state';

// Node 1: Planner (uses existing model-router)
export async function plannerNode(state: AgentState) {
  const agent = new StatefulAgent({ sessionId: state.sessionId });
  const plan = await agent.runPlanningPhase(state.messages);
  return { currentPlan: plan, next: 'executor' };
}

// Node 2: Executor (uses existing tools)
export async function executorNode(state: AgentState) {
  const agent = new StatefulAgent({ sessionId: state.sessionId });
  const result = await agent.runEditingPhase(state.currentPlan);
  return { vfs: result.vfs, transactionLog: result.transactionLog, next: 'verifier' };
}

// Node 3: Verifier (uses existing verification)
export async function verifierNode(state: AgentState) {
  const agent = new StatefulAgent({ sessionId: state.sessionId });
  const verified = await agent.runVerificationPhase();
  return { 
    errors: verified.errors,
    next: verified.errors.length > 0 ? 'self-healing' : 'end'
  };
}

// Node 4: Self-Healing (reuses existing self-healing)
export async function selfHealingNode(state: AgentState) {
  const agent = new StatefulAgent({ sessionId: state.sessionId });
  const healed = await agent.runSelfHealingPhase();
  return { 
    vfs: healed.vfs,
    retryCount: state.retryCount + 1,
    next: healed.errors.length > 0 ? 'end' : 'verifier'
  };
}
```

**Benefits**:
- ✅ **Reuses ALL existing agent logic**
- ✅ Adds explicit graph-based orchestration
- ✅ Enables conditional flows (retry loops, branching)

---

#### 1.3 Graph Compilation (NEW)
**File**: `lib/langgraph/graph.ts`

```typescript
import { StateGraph, END } from '@langchain/langgraph';
import { AgentState } from './state';
import { plannerNode, executorNode, verifierNode, selfHealingNode } from './nodes';

export function createAgentGraph() {
  const graph = new StateGraph<AgentState>({
    channels: AgentState,
  });

  // Add nodes (reusing existing agent logic)
  graph.addNode('planner', plannerNode);
  graph.addNode('executor', executorNode);
  graph.addNode('verifier', verifierNode);
  graph.addNode('self-healing', selfHealingNode);

  // Define edges (explicit workflow)
  graph.addEdge('planner', 'executor');
  graph.addEdge('executor', 'verifier');
  
  // Conditional edge: retry or end
  graph.addConditionalEdges('verifier', (state) => state.next);
  graph.addConditionalEdges('self-healing', (state) => state.next);

  // Entry and exit points
  graph.setEntryPoint('planner');
  graph.setFinishPoint('end');

  // Compile with checkpointer (reuses existing checkpointer!)
  return graph.compile({
    checkpointer: await import('@/lib/stateful-agent/checkpointer').then(m => 
      m.createCheckpointer()
    ),
  });
}
```

**Benefits**:
- ✅ Uses existing checkpointer
- ✅ Explicit workflow visualization
- ✅ Built-in retry logic via graph edges

---

### Phase 2: Enhanced Tool Integration (BUILD UPON EXISTING)

#### 2.1 MCP Tool Server (NEW)
**File**: `lib/mcp/tool-server.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/http';
import { allTools } from '@/lib/stateful-agent/tools';

export async function createMCPToolServer(port: number = 3001) {
  const server = new McpServer({
    name: 'bing-virtual-fs',
    version: '1.0.0',
  });

  // Register existing tools as MCP tools
  server.tool(
    'WRITE',
    'Write content to a file in the virtual filesystem',
    allTools.applyDiffTool.parameters.shape, // Reuse existing schema
    async (args) => {
      // Call existing tool implementation
      return await allTools.applyDiffTool.execute(args);
    }
  );

  server.tool(
    'READ',
    'Read content from a file',
    allTools.readFileTool.parameters.shape,
    async (args) => {
      return await allTools.readFileTool.execute(args);
    }
  );

  // Start HTTP transport
  const transport = new StreamableHTTPServerTransport({ port });
  await server.connect(transport);

  console.log(`MCP Tool Server running on http://localhost:${port}`);
  return server;
}
```

**Benefits**:
- ✅ **Exposes existing tools** via MCP standard
- ✅ Works with ANY LLM provider (Claude, GPT, Gemini)
- ✅ No tool rewriting needed

---

#### 2.2 Tool Router Enhancement (ENHANCE EXISTING)
**File**: `lib/stateful-agent/tools/tool-router.ts`

```typescript
// Enhance existing tool executor with LangGraph ToolNode
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { allTools } from './sandbox-tools';

export function createToolNode() {
  // Convert existing tools to LangGraph ToolNode
  const langchainTools = Object.entries(allTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
  }));

  return new ToolNode(langchainTools);
}

// Usage in graph:
// graph.addNode('tools', createToolNode());
```

**Benefits**:
- ✅ Reuses all existing tool definitions
- ✅ Adds LangGraph tool orchestration
- ✅ Automatic parallel execution support

---

### Phase 3: Model Routing Layer (NEW)

#### 3.1 Model Router (NEW)
**File**: `lib/ai-sdk/models/model-router.ts`

```typescript
// Enhance existing model-router with LangGraph integration
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export type ModelTier = 'fast' | 'reasoning' | 'coder';

const modelMap = {
  fast: new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0.3 }),
  reasoning: new ChatOpenAI({ model: 'gpt-4o', temperature: 0.7 }),
  coder: new ChatAnthropic({ model: 'claude-sonnet-4-20250514', temperature: 0.2 }),
};

export async function routeLLM(tier: ModelTier, messages: any[]) {
  const model = modelMap[tier];
  return await model.invoke(messages);
}

// Dynamic routing based on task complexity
export function chooseTier(input: string): ModelTier {
  if (input.length < 500) return 'fast';
  if (input.includes('refactor') || input.includes('implement')) return 'coder';
  return 'reasoning';
}
```

**Benefits**:
- ✅ Cost optimization (use cheaper models for simple tasks)
- ✅ Model specialization (best model for each task type)
- ✅ Fallback support (if one provider fails)

---

### Phase 4: Multi-Agent Role Separation (NEW)

#### 4.1 Role-Based Agents (NEW)
**File**: `lib/stateful-agent/agents/role-agents.ts`

```typescript
// Build upon existing StatefulAgent with role specialization
import { StatefulAgent } from './stateful-agent';

export class PlannerAgent extends StatefulAgent {
  constructor() {
    super({ 
      sessionId: crypto.randomUUID(),
      maxSelfHealAttempts: 0, // Planner doesn't heal
      enforcePlanActVerify: false, // Planner just plans
    });
  }

  async plan(userMessage: string) {
    return await this.runPlanningPhase(userMessage);
  }
}

export class ExecutorAgent extends StatefulAgent {
  constructor() {
    super({ 
      sessionId: crypto.randomUUID(),
      maxSelfHealAttempts: 3,
      enforcePlanActVerify: true,
    });
  }

  async execute(plan: any) {
    return await this.runEditingPhase(plan);
  }
}

export class CriticAgent extends StatefulAgent {
  constructor() {
    super({ 
      sessionId: crypto.randomUUID(),
      maxSelfHealAttempts: 0, // Critic just reviews
      enforcePlanActVerify: false,
    });
  }

  async critique(result: any) {
    return await this.runVerificationPhase(result);
  }
}

// Usage in graph:
// const planner = new PlannerAgent();
// const executor = new ExecutorAgent();
// const critic = new CriticAgent();
```

**Benefits**:
- ✅ **Reuses existing StatefulAgent** base class
- ✅ Model specialization per role
- ✅ Clear separation of concerns

---

### Phase 5: Observability Integration (OPTIONAL)

#### 5.1 LangSmith Tracing (OPTIONAL)
**File**: `lib/observability/langsmith.ts`

```typescript
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';

export function createLangSmithTracer() {
  const client = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT,
  });

  return new LangChainTracer({
    projectName: process.env.LANGSMITH_PROJECT || 'bing-agents',
    client,
  });
}

// Usage:
// const tracer = createLangSmithTracer();
// graph.compile({ checkpointer, callbacks: [tracer] });
```

**Benefits**:
- ✅ Production observability
- ✅ Trace agent reasoning steps
- ✅ Debug complex workflows

---

## Integration Points

### With Existing Stateful Agent

```typescript
// lib/langgraph/nodes/index.ts
import { runStatefulAgent } from '@/lib/stateful-agent';

export async function executorNode(state: AgentState) {
  // Call existing stateful agent!
  const result = await runStatefulAgent(state.currentPlan, {
    sessionId: state.sessionId,
    sandboxHandle: state.sandboxHandle,
  });
  
  return {
    vfs: result.vfs,
    transactionLog: result.transactionLog,
    errors: result.errors,
  };
}
```

### With Existing Tools

```typescript
// lib/langgraph/nodes/index.ts
import { allTools } from '@/lib/stateful-agent/tools';

export async function toolNode(state: AgentState) {
  // Use existing tools!
  const toolResult = await allTools.applyDiffTool.execute({
    path: state.currentPlan.path,
    search: state.currentPlan.search,
    replace: state.currentPlan.replace,
  });
  
  return { vfs: toolResult.vfs };
}
```

### With Existing Checkpointer

```typescript
// lib/langgraph/graph.ts
import { createCheckpointer } from '@/lib/stateful-agent/checkpointer';

export const graph = await createAgentGraph();
const compiledGraph = graph.compile({
  checkpointer: createCheckpointer(), // Reuse existing!
});
```

---

## Environment Variables (NEW)

Add to `env.example`:

```bash
# ===========================================
# LANGRAPH & MODERN AGENTIC ARCHITECTURE
# ===========================================

# Enable LangGraph orchestration (default: false - uses custom orchestration)
USE_LANGGRAPH=false

# LangSmith Observability (optional)
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=bing-agents
LANGSMITH_ENDPOINT=https://api.smith.langchain.com

# Model Routing (optional - cost optimization)
ENABLE_MODEL_ROUTING=false
FAST_MODEL=gpt-4o-mini
REASONING_MODEL=gpt-4o
CODER_MODEL=claude-sonnet-4-20250514

# MCP Tool Server (optional)
ENABLE_MCP_TOOL_SERVER=false
MCP_TOOL_SERVER_PORT=3001

# Multi-Agent Roles (optional)
ENABLE_MULTI_AGENT=false
PLANNER_MODEL=gpt-4o
EXECUTOR_MODEL=claude-sonnet-4-20250514
CRITIC_MODEL=gpt-4o-mini
```

---

## File Structure

```
lib/
├── stateful-agent/              # EXISTING - Custom orchestration
│   ├── agents/
│   │   ├── stateful-agent.ts    # ✅ Reused by LangGraph
│   │   ├── model-router.ts      # ✅ Enhanced with model routing
│   │   └── role-agents.ts       # NEW: Role-based agents
│   ├── tools/
│   │   ├── sandbox-tools.ts     # ✅ Reused by LangGraph
│   │   └── tool-router.ts       # ENHANCED: LangGraph ToolNode
│   ├── state/
│   │   └── index.ts             # ✅ Reused by LangGraph
│   └── checkpointer/
│       └── index.ts             # ✅ Reused by LangGraph
│
├── langgraph/                   # NEW: LangGraph integration
│   ├── state.ts                 # State definitions
│   ├── nodes/
│   │   └── index.ts             # Graph nodes (call existing agents)
│   ├── graph.ts                 # Graph compilation
│   └── index.ts                 # Exports
│
├── mcp/                         # NEW: MCP integration
│   └── tool-server.ts           # MCP tool server
│
├── ai-sdk/
│   └── models/
│       └── model-router.ts      # ENHANCED: Model routing
│
└── observability/               # NEW: Observability
    └── langsmith.ts             # LangSmith tracing
```

---

## Usage Examples

### Option 1: Use Custom Orchestration (Existing)

```typescript
import { runStatefulAgent } from '@/lib/stateful-agent';

const result = await runStatefulAgent(userMessage, {
  sessionId: 'session-123',
  sandboxHandle,
});
```

### Option 2: Use LangGraph (NEW)

```typescript
import { createAgentGraph } from '@/lib/langgraph';

const graph = await createAgentGraph();
const result = await graph.invoke({
  messages: [{ role: 'user', content: userMessage }],
  sessionId: 'session-123',
});
```

### Option 3: Use MCP Tool Server (NEW)

```typescript
import { createMCPToolServer } from '@/lib/mcp';

const server = await createMCPToolServer(3001);
// Tools now accessible via MCP from ANY LLM provider
```

---

## Benefits Summary

| Feature | Custom (Existing) | LangGraph (NEW) | Combined |
|---------|------------------|-----------------|----------|
| **Orchestration** | Custom loop | Graph-based | **Both available** |
| **Tools** | ✅ Working | ✅ Reuses existing | **Best of both** |
| **State** | ✅ VfsState | ✅ Extends VfsState | **Compatible** |
| **Checkpointer** | ✅ Working | ✅ Reuses existing | **No duplication** |
| **HITL** | ✅ Working | ✅ Via interrupts | **Enhanced** |
| **Self-Healing** | ✅ Working | ✅ Via graph edges | **Explicit flows** |
| **Observability** | Basic logs | LangSmith tracing | **Optional** |
| **Model Routing** | Single model | Multi-model | **Cost optimized** |

---

## Implementation Priority

### HIGH (Implement First)
1. ✅ LangGraph state definitions (builds on existing VfsState)
2. ✅ Graph nodes that call existing agents
3. ✅ Graph compilation with existing checkpointer
4. ✅ Model router for cost optimization

### MEDIUM (Nice to Have)
5. ✅ MCP tool server (exposes existing tools)
6. ✅ Role-based agents (specialization)
7. ✅ ToolNode integration

### LOW (Optional)
8. LangSmith observability
9. Advanced graph patterns (parallel execution, etc.)

---

## Testing Strategy

### Unit Tests
```typescript
// __tests__/langgraph/state.test.ts
describe('LangGraph State', () => {
  it('should extend existing VfsState', () => {
    // Test state compatibility
  });
});

// __tests__/langgraph/nodes.test.ts
describe('LangGraph Nodes', () => {
  it('should call existing StatefulAgent', () => {
    // Test node reuses existing agent
  });
});
```

### Integration Tests
```typescript
// __tests__/langgraph/graph.test.ts
describe('LangGraph Graph', () => {
  it('should compile with existing checkpointer', () => {
    // Test graph compilation
  });
  
  it('should execute full workflow', async () => {
    const graph = await createAgentGraph();
    const result = await graph.invoke({ messages: [...] });
    expect(result.vfs).toBeDefined();
  });
});
```

---

## Migration Path

### For Existing Users
- ✅ **No breaking changes** - custom orchestration still default
- ✅ **Opt-in** LangGraph via `USE_LANGGRAPH=true`
- ✅ **Same tools, same state, same checkpointer**

### For New Users
- ✅ Can choose LangGraph for complex workflows
- ✅ Can use custom for simple tasks
- ✅ Can switch between them seamlessly

---

## Conclusion

**This plan ADDS LangGraph WITHOUT replacing the working custom implementation:**

1. ✅ **Reuses** all existing tools, state, and checkpointers
2. ✅ **Builds upon** existing StatefulAgent class
3. ✅ **Provides** graph-based orchestration as an OPTION
4. ✅ **Enables** advanced features (model routing, MCP, observability)
5. ✅ **Maintains** backward compatibility

**Implementation Status**: Ready to code!

---

**Plan Created**: 2026-02-27  
**Next Steps**: Implement Phase 1 (LangGraph Core)
