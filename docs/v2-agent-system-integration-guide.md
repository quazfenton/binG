---
id: v2-agent-system-integration-guide
title: "\U0001F50C V2 Agent System Integration Guide"
aliases:
  - V2_AGENT_TOOL_INTEGRATION_WIRING
  - V2_AGENT_TOOL_INTEGRATION_WIRING.md
  - v2-agent-system-integration-guide
  - v2-agent-system-integration-guide.md
tags:
  - agent
  - spawn
  - v2
  - guide
layer: core
summary: "# \U0001F50C V2 Agent System Integration Guide\r\n\r\n**Date:** March 2026\r\n**Architecture:** OpenCode in Docker Container + Redis Queue + Gateway\r\n\r\n---\r\n\r\n## \U0001F4CA Current Architecture\r\n\r\n### V2 Agent System Components\r\n\r\n```\r\n┌─────────────────────────────────────────────────────────────────┐\r\n│"
anchors:
  - "\U0001F4CA Current Architecture"
  - V2 Agent System Components
  - "\U0001F527 Tool Integration Wiring"
  - Current Integration Points
  - 1. **Main App → Tool System** ✅
  - 2. **V2 Executor → Tool System** ⚠️ **NEEDS WIRING**
  - "\U0001F4CB Integration Steps"
  - 'Step 1: Wire ToolIntegrationManager into V2 Executor'
  - 'Step 2: Wire into Agent Worker (Redis Queue)'
  - 'Step 3: Wire into OpenCode Engine'
  - 'Step 4: Wire into OpenCode Direct'
  - "\U0001F504 Redis Queue Integration"
  - Job Structure
  - Queue Operations
  - "\U0001F310 Gateway Integration"
  - MCP Gateway Wiring
  - Bootstrap Integration
  - "\U0001F4CA Complete Wiring Diagram"
  - ✅ Verification Checklist
  - Main App Integration
  - V2 Agent Integration
  - Gateway Integration
  - Redis Queue Integration
  - "\U0001F680 Next Steps"
---
# 🔌 V2 Agent System Integration Guide

**Date:** March 2026
**Architecture:** OpenCode in Docker Container + Redis Queue + Gateway

---

## 📊 Current Architecture

### V2 Agent System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Application (Next.js)                   │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │ /api/chat      │  │ /api/tools/    │  │ lib/tools/      │   │
│  │ route.ts       │  │ execute/route  │  │ tool-integration│   │
│  └───────┬────────┘  └───────┬────────┘  │ system.ts       │   │
│          │                   │           └────────┬────────┘   │
│          │                   │                    │             │
└──────────┼───────────────────┼────────────────────┼────────────┘
           │                   │                    │
           │ HTTP/gRPC         │ Redis Queue        │ Tool Registry
           │                   │                    │
           ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Worker (Docker)                         │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │ lib/agent/     │  │ lib/agent/     │  │ lib/agent/      │   │
│  │ services/      │  │ v2-executor.ts │  │ opencode-direct │   │
│  │ agent-worker/  │  │                │  │                 │   │
│  │ src/index.ts   │  │                │  │                 │   │
│  └───────┬────────┘  └────────────────┘  └─────────────────┘   │
│          │                                                     │
│          │ Redis Queue (agent:jobs)                            │
│          │ Redis PubSub (agent:events)                         │
└──────────┼─────────────────────────────────────────────────────┘
           │
           │ MCP Gateway
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode Engine (Persistent)                  │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │ opencode-engine│  │ task-router.ts │  │ MCP Tools       │   │
│  │ .ts            │  │                │  │                 │   │
│  └────────────────┘  └────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Tool Integration Wiring

### Current Integration Points

#### 1. **Main App → Tool System** ✅

**File:** `lib/tools/tool-integration-system.ts`

```typescript
export class ToolIntegrationManager {
  async executeTool(toolKey: string, input: any, context: any) {
    // Uses ToolProviderRouter with fallback chain
    return this.providerRouter.executeWithFallback({...});
  }
  
  async searchTools(query: string, userId?: string) {
    // Dynamic discovery from Smithery/Arcade APIs
  }
}
```

**Usage in Main App:**
```typescript
import { getToolManager } from '@/lib/tools';

const toolManager = getToolManager();
const result = await toolManager.executeTool('gmail.send', {...}, context);
```

#### 2. **V2 Executor → Tool System** ⚠️ **NEEDS WIRING**

**Current File:** `lib/agent/v2-executor.ts`

**Current Implementation:**
```typescript
// Currently uses direct OpenCode execution
const { runOpenCodeDirect } = await import('./opencode-direct');
result = await runOpenCodeDirect({...});
```

**Required Integration:**
```typescript
// Should integrate with ToolIntegrationManager
import { getToolManager } from '@/lib/tools';

const toolManager = getToolManager();

// For tool execution within OpenCode session
const toolResult = await toolManager.executeTool(
  toolName,
  args,
  { userId, conversationId }
);
```

---

## 📋 Integration Steps

### Step 1: Wire ToolIntegrationManager into V2 Executor

**File to Modify:** `lib/agent/v2-executor.ts`

```typescript
import { getToolManager } from '@/lib/tools';
import { agentSessionManager } from '../session/agent/agent-session-manager';

export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const toolManager = getToolManager();
  
  // Get or create session
  const session = await agentSessionManager.getOrCreateSession(
    options.userId,
    options.conversationId,
    { enableMCP: true, mode: 'opencode' }
  );
  
  // Execute task with tool integration
  const result = await toolManager.executeTool(
    'opencode:run',  // Or appropriate tool key
    {
      task: options.task,
      context: options.context,
      executionPolicy: options.executionPolicy,
    },
    {
      userId: options.userId,
      conversationId: options.conversationId,
      metadata: {
        sessionId: session.id,
        workspacePath: session.workspacePath,
      }
    }
  );
  
  return {
    success: result.success,
    data: result.output,
    sessionId: session.id,
  };
}
```

### Step 2: Wire into Agent Worker (Redis Queue)

**File to Modify:** `lib/agent/services/agent-worker/src/index.ts`

```typescript
import { getToolManager } from '@/lib/tools';

// In runOpenCode() function
async function runOpenCode(job: AgentJob): Promise<void> {
  const toolManager = getToolManager();
  
  // ... existing setup code ...
  
  // Execute tools via ToolIntegrationManager instead of direct MCP calls
  async function executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
    const result = await toolManager.executeTool(
      toolName,
      args,
      {
        userId: job.userId,
        conversationId: job.conversationId,
        metadata: { sessionId: job.sessionId }
      }
    );
    
    return {
      success: result.success,
      output: result.output || JSON.stringify(result),
      exitCode: result.success ? 0 : 1,
    };
  }
  
  // ... rest of OpenCode execution ...
}
```

### Step 3: Wire into OpenCode Engine

**File to Modify:** `lib/agent/services/agent-worker/src/opencode-engine.ts`

```typescript
import { getToolManager } from '@/lib/tools';

class OpenCodeEngine {
  private toolManager = getToolManager();
  
  async executeTool(toolName: string, args: Record<string, any>, sessionId: string) {
    // Use ToolIntegrationManager for tool execution
    const result = await this.toolManager.executeTool(
      toolName,
      args,
      { sessionId, metadata: { engine: 'opencode' } }
    );
    
    return result;
  }
}
```

### Step 4: Wire into OpenCode Direct

**File to Modify:** `lib/agent/opencode-direct.ts`

```typescript
import { getToolManager } from '@/lib/tools';

export async function runOpenCodeDirect(options: OpenCodeDirectOptions) {
  const toolManager = getToolManager();
  
  // ... existing session setup ...
  
  // Use ToolIntegrationManager for tool execution
  const result = await provider.runAgentLoop({
    userMessage: task,
    tools: await toolManager.searchTools(''),  // Get available tools
    onTool: async (toolName, args) => {
      const toolResult = await toolManager.executeTool(
        toolName,
        args,
        { userId, conversationId }
      );
      return toolResult.output;
    },
  });
  
  return result;
}
```

---

## 🔄 Redis Queue Integration

### Job Structure

```typescript
interface AgentJob {
  id: string;
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];  // List of tools to use
  model?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}
```

### Queue Operations

**Push Job to Queue:**
```typescript
import { getToolManager } from '@/lib/tools';

async function queueAgentTask(job: AgentJob) {
  const redis = new Redis(process.env.REDIS_URL);
  
  // Validate tools exist
  const toolManager = getToolManager();
  const availableTools = await toolManager.searchTools('');
  const validTools = job.tools?.filter(t => 
    availableTools.some(at => at.toolName === t)
  );
  
  await redis.lpush('agent:jobs', JSON.stringify({
    ...job,
    tools: validTools,
    status: 'pending'
  }));
}
```

**Process Job from Queue:**
```typescript
async function processAgentJob() {
  const redis = new Redis(process.env.REDIS_URL);
  const toolManager = getToolManager();
  
  // Blocking pop from queue
  const result = await redis.brpop('agent:jobs', 5);
  if (!result) return;
  
  const job: AgentJob = JSON.parse(result[1]);
  
  // Execute job with tool integration
  const session = await agentSessionManager.getOrCreateSession(
    job.userId,
    job.conversationId,
    { enableMCP: true }
  );
  
  // Execute tools via ToolIntegrationManager
  for (const toolName of job.tools || []) {
    const toolResult = await toolManager.executeTool(
      toolName,
      { /* tool args */ },
      {
        userId: job.userId,
        conversationId: job.conversationId,
        metadata: { sessionId: job.sessionId }
      }
    );
    
    // Publish result event
    await publishEvent({
      type: 'tool:executed',
      sessionId: job.sessionId,
      data: { toolName, result: toolResult },
      timestamp: Date.now()
    });
  }
}
```

---

## 🌐 Gateway Integration

### MCP Gateway Wiring

**File:** `lib/mcp/gateway.ts` (if exists) or create new

```typescript
import { getToolManager } from '@/lib/tools';

export class MCPGateway {
  private toolManager = getToolManager();
  
  /**
   * Register MCP tools from gateway
   */
  async registerGatewayTools(gatewayUrl: string) {
    const response = await fetch(`${gatewayUrl}/tools`);
    const gatewayTools = await response.json();
    
    for (const tool of gatewayTools) {
      await this.toolManager.registerTool({
        name: `gateway:${tool.name}`,
        capability: tool.capability,
        provider: 'gateway',
        handler: async (args, context) => {
          const response = await fetch(`${gatewayUrl}/tools/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: tool.name,
              args,
              context
            })
          });
          return await response.json();
        },
        metadata: {
          latency: 'medium',
          cost: 'low',
          reliability: 0.95
        }
      });
    }
  }
}
```

### Bootstrap Integration

**File:** `lib/tools/bootstrap-gateway.ts` (create new)

```typescript
import { getToolManager } from '@/lib/tools';
import { createLogger } from '../utils/logger';

const logger = createLogger('Tools:Gateway-Bootstrap');

export async function registerGatewayTools(): Promise<number> {
  let count = 0;
  
  const gatewayUrl = process.env.MCP_GATEWAY_URL;
  if (!gatewayUrl) {
    logger.debug('MCP gateway not configured');
    return 0;
  }
  
  try {
    const toolManager = getToolManager();
    const { MCPGateway } = await import('../mcp/gateway');
    
    const gateway = new MCPGateway();
    await gateway.registerGatewayTools(gatewayUrl);
    
    logger.info(`Registered gateway tools from ${gatewayUrl}`);
    count++;
  } catch (error: any) {
    logger.warn('Failed to register gateway tools', error.message);
  }
  
  return count;
}
```

---

## 📊 Complete Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Application                            │
│                                                                  │
│  /api/chat/route.ts                                            │
│  └─> executeV2Task()                                           │
│       └─> getToolManager().executeTool() ◄──────────────────┐  │
│                                                              │  │
│  /api/tools/execute/route.ts                                 │  │
│  └─> getToolManager().executeTool() ◄────────────────────┐  │  │
│                                                           │  │  │
│  lib/tools/tool-integration-system.ts                     │  │  │
│  └─> ToolIntegrationManager                               │  │  │
│       ├─> ToolProviderRouter                              │  │  │
│       │    ├─> Arcade Provider                            │  │  │
│       │    ├─> Nango Provider                             │  │  │
│       │    ├─> Composio Provider                          │  │  │
│       │    └─> MCP Gateway Provider                       │  │  │
│       └─> TOOL_REGISTRY                                   │  │  │
│                                                           │  │  │
└───────────────────────────────────────────────────────────┼──┼──┼─┘
                                                            │  │  │
                                                            │  │  │
┌───────────────────────────────────────────────────────────┼──┼──┼─┐
│                   Agent Worker (Docker)                    │  │  │
│                                                            │  │  │
│  lib/agent/services/agent-worker/src/index.ts             │  │  │
│  └─> runOpenCode()                                        │  │  │
│       └─> executeTool()                                   │  │  │
│            └─> getToolManager().executeTool() ◄───────────┘  │  │
│                                                              │  │
│  lib/agent/v2-executor.ts                                   │  │
│  └─> executeV2Task()                                        │  │
│       └─> getToolManager().executeTool() ◄──────────────────┘  │
│                                                                │
│  lib/agent/opencode-direct.ts                                 │
│  └─> runOpenCodeDirect()                                      │
│       └─> provider.runAgentLoop()                             │
│            └─> onTool callback                                │
│                 └─> getToolManager().executeTool() ◄──────────┘
│                                                                │
│  Redis Queue (agent:jobs)                                     │
│  └─> Jobs with tool lists                                     │
│       └─> Process with ToolIntegrationManager                 │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## ✅ Verification Checklist

### Main App Integration
- [ ] `lib/tools/tool-integration-system.ts` - ToolIntegrationManager exists ✅
- [ ] `lib/tools/bootstrap.ts` - Auto-registration system exists ✅
- [ ] `lib/oauth/index.ts` - OAuth integration exists ✅
- [ ] `lib/tools/registry.ts` - Tool registry with schema lookup exists ✅

### V2 Agent Integration
- [ ] `lib/agent/v2-executor.ts` - Wire getToolManager()
- [ ] `lib/agent/services/agent-worker/src/index.ts` - Wire getToolManager()
- [ ] `lib/agent/services/agent-worker/src/opencode-engine.ts` - Wire getToolManager()
- [ ] `lib/agent/opencode-direct.ts` - Wire getToolManager()

### Gateway Integration
- [ ] `lib/mcp/gateway.ts` - Create MCP gateway wrapper
- [ ] `lib/tools/bootstrap-gateway.ts` - Create gateway bootstrap
- [ ] Add to `lib/tools/bootstrap.ts` - Include gateway registration

### Redis Queue Integration
- [ ] `lib/agent/services/agent-worker/src/index.ts` - Use ToolIntegrationManager for job processing
- [ ] Add tool validation when queuing jobs
- [ ] Add tool execution events to Redis stream

---

## 🚀 Next Steps

1. **Wire V2 Executor** (30 min)
   - Update `lib/agent/v2-executor.ts` to use `getToolManager()`

2. **Wire Agent Worker** (1 hour)
   - Update `lib/agent/services/agent-worker/src/index.ts`
   - Update `lib/agent/services/agent-worker/src/opencode-engine.ts`

3. **Wire OpenCode Direct** (30 min)
   - Update `lib/agent/opencode-direct.ts`

4. **Create Gateway Integration** (1 hour)
   - Create `lib/mcp/gateway.ts`
   - Create `lib/tools/bootstrap-gateway.ts`

5. **Test Integration** (1 hour)
   - Test tool execution from V2 agent
   - Test Redis queue job processing
   - Test gateway tool registration

---

*Integration Guide Created: March 2026*
*Status: Ready for implementation*
