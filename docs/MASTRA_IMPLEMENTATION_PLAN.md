# Mastra Integration Implementation Plan

**Date**: 2026-02-27  
**Status**: 📋 Implementation Ready  
**Based on**: Official Mastra Documentation + Codebase Review

---

## Executive Summary

This plan implements **Mastra** as a production-grade workflow orchestration layer that **augments** existing binG infrastructure with:

1. **Workflow Engine** - Graph-based deterministic orchestration
2. **Human-in-the-Loop** - Suspend/resume with state persistence
3. **Model Router** - 40+ provider unified interface
4. **Tool System** - Schema-validated tool execution
5. **Memory** - Working + semantic memory
6. **Observability** - Built-in tracing and scoring

**Key Principle**: Mastra sits **on top of** existing infrastructure, not replacing it.

---

## Architecture

### Integration Points

| Existing Component | Mastra Integration |
|-------------------|-------------------|
| `lib/stateful-agent/` | Mastra Workflows replace custom loop |
| `lib/virtual-filesystem/` | MCP Tool Server boundary |
| `lib/sandbox/providers/` | Sandboxed execution node |
| `lib/tool-integration/` | Mastra Tools with schemas |
| `lib/stateful-agent/human-in-the-loop.ts` | Mastra suspend/resume |
| `lib/stateful-agent/agents/provider-fallback.ts` | Mastra Model Router |

---

## Phase 1: Core Integration (Days 1-3)

### 1.1 Installation

```bash
pnpm add @mastra/core @mastra/agents @mastra/workflows
pnpm add @mastra/memory @mastra/evals @mastra/mcp
```

### 1.2 Mastra Instance Setup

**File**: `lib/mastra/mastra-instance.ts`

```typescript
import { Mastra } from '@mastra/core';

export const mastra = new Mastra({
  storage: {
    // Reuse existing database
    type: 'postgresql',
    uri: process.env.DATABASE_URL,
  },
  telemetry: {
    enabled: process.env.MASTRA_TELEMETRY_ENABLED === 'true',
    serviceName: 'bing-agent',
  },
});
```

### 1.3 Model Router

**File**: `lib/mastra/models/model-router.ts`

```typescript
import { Agent } from '@mastra/core/agent';

// Reuse existing provider configuration
export const modelRouter = {
  fast: new Agent({
    id: 'fast-router',
    model: 'openai/gpt-4o-mini',
    instructions: 'You are a fast, efficient assistant.',
  }),
  reasoning: new Agent({
    id: 'reasoning-router',
    model: 'openai/gpt-4o',
    instructions: 'You are a thoughtful reasoning assistant.',
  }),
  coder: new Agent({
    id: 'coder-router',
    model: 'anthropic/claude-3-5-sonnet-20241022',
    instructions: 'You are an expert coding assistant.',
  }),
};

export type ModelTier = 'fast' | 'reasoning' | 'coder';

export function getModel(tier: ModelTier) {
  return modelRouter[tier];
}
```

### 1.4 Tool Definitions

**File**: `lib/mastra/tools/index.ts`

```typescript
import { createTool } from '@mastra/core';
import { z } from 'zod';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { getSandboxProvider } from '@/lib/sandbox/providers';

const vfs = new VirtualFilesystemService();
const sandboxProvider = getSandboxProvider();

// Virtual FS Tools
export const writeFileTool = createTool({
  id: 'WRITE_FILE',
  description: 'Write content to a file in the virtual filesystem',
  inputSchema: z.object({
    path: z.string().describe('File path relative to workspace'),
    content: z.string().describe('File content'),
    ownerId: z.string().describe('Workspace owner ID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    version: z.number(),
  }),
  execute: async ({ context }) => {
    const { path, content, ownerId } = context;
    const file = await vfs.writeFile(ownerId, path, content);
    return { success: true, path: file.path, version: file.version };
  },
});

export const readFileTool = createTool({
  id: 'READ_FILE',
  description: 'Read content from a file',
  inputSchema: z.object({
    path: z.string(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    content: z.string(),
    language: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { path, ownerId } = context;
    const file = await vfs.readFile(ownerId, path);
    return { content: file.content, language: file.language };
  },
});

export const deletePathTool = createTool({
  id: 'DELETE_PATH',
  description: 'Delete a file or directory',
  inputSchema: z.object({
    path: z.string(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    deletedCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { path, ownerId } = context;
    const result = await vfs.deletePath(ownerId, path);
    return { deletedCount: result.deletedCount };
  },
});

// Sandbox Execution Tools
export const executeCodeTool = createTool({
  id: 'EXECUTE_CODE',
  description: 'Execute code in a sandboxed environment',
  inputSchema: z.object({
    code: z.string().describe('Code to execute'),
    language: z.enum(['python', 'typescript', 'javascript']),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    output: z.string(),
    exitCode: z.number().optional(),
  }),
  execute: async ({ context }) => {
    const { code, language, ownerId } = context;
    const sandbox = await sandboxProvider.createSandbox({ ownerId });
    const command = language === 'python' 
      ? `python3 -c "${code}"` 
      : `node -e "${code}"`;
    const result = await sandbox.executeCommand(command);
    return { output: result.output || '', exitCode: result.exitCode };
  },
});

// Syntax Check Tool (Safety Gate)
export const syntaxCheckTool = createTool({
  id: 'SYNTAX_CHECK',
  description: 'Check code syntax before execution',
  inputSchema: z.object({
    code: z.string(),
    language: z.enum(['python', 'typescript', 'javascript']),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { code, language } = context;
    const { checkSyntax } = await import('@/lib/code-parser');
    const result = checkSyntax(code, language);
    return { valid: result.valid, errors: result.errors };
  },
});
```

---

## Phase 2: Workflow Definitions (Days 4-7)

### 2.1 Code Agent Workflow

**File**: `lib/mastra/workflows/code-agent-workflow.ts`

```typescript
import { createWorkflow, createStep } from '@mastra/core';
import { z } from 'zod';
import { getModel } from '../models/model-router';
import { 
  writeFileTool, 
  readFileTool, 
  executeCodeTool, 
  syntaxCheckTool 
} from '../tools';

// State Schema
const WorkflowInput = z.object({
  task: z.string().describe('User task description'),
  ownerId: z.string(),
});

const PlanOutput = z.object({
  steps: z.array(z.object({
    action: z.string(),
    tool: z.string(),
    parameters: z.record(z.any()),
  })),
});

// Step 1: Planner
const plannerStep = createStep({
  id: 'planner',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
  }),
  execute: async ({ context }) => {
    const { task, ownerId } = context.getStepPayload('planner');
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a planning agent. Output a JSON plan with steps.
        Each step must specify: action, tool, parameters.
        Available tools: WRITE_FILE, READ_FILE, DELETE_PATH, EXECUTE_CODE, SYNTAX_CHECK`,
      },
      { role: 'user', content: task },
    ]);

    const plan = JSON.parse(response.text);
    return { plan, ownerId };
  },
});

// Step 2: Executor
const executorStep = createStep({
  id: 'executor',
  inputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    toolResults: z.array(z.any()),
    attempts: z.number(),
  }),
  execute: async ({ context }) => {
    const { plan, ownerId } = context.getStepPayload('executor');
    const toolResults = [];

    for (const step of plan.steps) {
      const tool = [writeFileTool, readFileTool, executeCodeTool, syntaxCheckTool]
        .find(t => t.id === step.tool);
      
      if (!tool) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }

      const result = await tool.execute({
        context: { ...step.parameters, ownerId },
      });
      
      toolResults.push({ step, result });
    }

    return { toolResults, attempts: 1 };
  },
});

// Step 3: Critic (Self-Healing)
const criticStep = createStep({
  id: 'critic',
  inputSchema: z.object({
    task: z.string(),
    toolResults: z.array(z.any()),
    attempts: z.number(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    final: z.string(),
  }).or(z.object({
    fix: z.string(),
  })),
  execute: async ({ context }) => {
    const { task, toolResults, attempts } = context.getStepPayload('critic');
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `Review the tool execution results.
        Output JSON: { "success": boolean, "fix": string | null }
        If success is false and attempts < 3, provide a fix instruction.`,
      },
      { role: 'user', content: JSON.stringify({ task, toolResults }) },
    ]);

    const parsed = JSON.parse(response.text);

    if (!parsed.success && attempts < 3) {
      return { fix: parsed.fix };
    }

    return { final: JSON.stringify(toolResults) };
  },
});

// Workflow Definition
export const codeAgentWorkflow = createWorkflow({
  id: 'code-agent',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    result: z.string(),
  }),
  steps: [plannerStep, executorStep, criticStep],
})
  .then(plannerStep)
  .then(executorStep)
  .then(criticStep)
  .commit();
```

### 2.2 Human-in-the-Loop Workflow

**File**: `lib/mastra/workflows/hitl-workflow.ts`

```typescript
import { createWorkflow, createStep } from '@mastra/core';
import { z } from 'zod';
import { getModel } from '../models/model-router';
import { writeFileTool, syntaxCheckTool } from '../tools';

const HITLInput = z.object({
  code: z.string(),
  description: z.string(),
  ownerId: z.string(),
});

const ApprovalStep = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
});

// Step 1: Syntax Check
const syntaxCheckStep = createStep({
  id: 'syntax-check',
  inputSchema: HITLInput,
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()).optional(),
    code: z.string(),
    ownerId: z.string(),
  }),
  execute: async ({ context }) => {
    const { code, ownerId } = context.getStepPayload('syntax-check');
    const tool = syntaxCheckTool;
    
    const result = await tool.execute({
      context: { code, language: 'typescript' },
    });

    return { valid: result.valid, errors: result.errors, code, ownerId };
  },
});

// Step 2: Human Approval (Suspend/Resume)
const approvalStep = createStep({
  id: 'approval',
  inputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    code: z.string(),
    ownerId: z.string(),
  }),
  resumeSchema: ApprovalStep,
  suspendSchema: z.object({
    reason: z.string(),
    codePreview: z.string(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    code: z.string(),
  }),
  execute: async ({ context, resumeData, suspend }) => {
    const { valid, errors, code } = context.getStepPayload('approval');
    const { approved, feedback } = resumeData ?? {};

    // If not approved yet, suspend for human review
    if (approved === undefined) {
      return await suspend({
        reason: valid ? 'Code review required' : 'Syntax errors found',
        codePreview: code.slice(0, 500),
      });
    }

    if (!approved) {
      throw new Error(`Approval rejected: ${feedback || 'No feedback provided'}`);
    }

    return { approved: true, feedback, code };
  },
});

// Step 3: Write File
const writeStep = createStep({
  id: 'write-file',
  inputSchema: z.object({
    approved: z.boolean(),
    code: z.string(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    path: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ context }) => {
    const { code, ownerId } = context.getStepPayload('write-file');
    const tool = writeFileTool;
    
    const result = await tool.execute({
      context: { path: 'output/generated.ts', content: code, ownerId },
    });

    return { path: result.path, success: result.success };
  },
});

export const hitlWorkflow = createWorkflow({
  id: 'hitl-code-review',
  inputSchema: HITLInput,
  outputSchema: z.object({
    path: z.string(),
    success: z.boolean(),
  }),
  steps: [syntaxCheckStep, approvalStep, writeStep],
})
  .then(syntaxCheckStep)
  .then(approvalStep)
  .then(writeStep)
  .commit();
```

---

## Phase 3: API Endpoints (Days 8-10)

### 3.1 Workflow Execution Endpoint

**File**: `app/api/mastra/workflow/route.ts`

```typescript
import { codeAgentWorkflow } from '@/lib/mastra/workflows/code-agent-workflow';
import { mastra } from '@/lib/mastra/mastra-instance';

export async function POST(req: Request) {
  try {
    const { task, ownerId } = await req.json();

    const workflow = mastra.getWorkflow('code-agent');
    const run = await workflow.createRun();

    // Stream execution
    const stream = await run.stream({
      inputData: { task, ownerId },
    });

    return new Response(stream.toReadableStream(), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Workflow failed' },
      { status: 500 }
    );
  }
}
```

### 3.2 HITL Resume Endpoint

**File**: `app/api/mastra/resume/route.ts`

```typescript
import { hitlWorkflow } from '@/lib/mastra/workflows/hitl-workflow';
import { mastra } from '@/lib/mastra/mastra-instance';

export async function POST(req: Request) {
  try {
    const { runId, approved, feedback } = await req.json();

    const workflow = mastra.getWorkflow('hitl-code-review');
    const run = await workflow.createRun({ runId });

    const approvalStep = await workflow.getStep('approval');
    
    const result = await run.resume({
      step: approvalStep,
      resumeData: { approved, feedback },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Resume failed' },
      { status: 500 }
    );
  }
}
```

### 3.3 Workflow Status Endpoint

**File**: `app/api/mastra/status/route.ts`

```typescript
import { mastra } from '@/lib/mastra/mastra-instance';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');

  if (!runId) {
    return Response.json({ error: 'runId required' }, { status: 400 });
  }

  const workflow = mastra.getWorkflow('code-agent');
  const run = await workflow.createRun({ runId });
  const status = await run.getStatus();

  return Response.json({ status });
}
```

---

## Phase 4: Frontend Integration (Days 11-14)

### 4.1 Workflow UI Component

**File**: `components/mastra/workflow-ui.tsx`

```typescript
'use client';

import { useState } from 'react';

interface WorkflowUIProps {
  ownerId: string;
  workflowType: 'code-agent' | 'hitl';
}

export function WorkflowUI({ ownerId, workflowType }: WorkflowUIProps) {
  const [input, setInput] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);

  const runWorkflow = async () => {
    setIsRunning(true);
    setEvents([]);

    const response = await fetch('/api/mastra/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        task: input, 
        ownerId,
        workflowType,
      }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const event = decoder.decode(value);
      const data = JSON.parse(event.slice(6));
      setEvents(prev => [...prev, data]);

      if (data.type === 'suspend') {
        setSuspended(true);
        setRunId(data.runId);
      }
    }

    setIsRunning(false);
  };

  const resumeWorkflow = async (approved: boolean, feedback?: string) => {
    const response = await fetch('/api/mastra/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, approved, feedback }),
    });

    const result = await response.json();
    setEvents(prev => [...prev, { type: 'resume-result', data: result }]);
    setSuspended(false);
  };

  return (
    <div className="p-4 border rounded">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Describe your task..."
        className="w-full p-2 border rounded mb-4"
        rows={4}
      />
      
      <button
        onClick={runWorkflow}
        disabled={isRunning}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {isRunning ? 'Running...' : 'Run Workflow'}
      </button>

      {suspended && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
          <p className="mb-2">Workflow awaiting approval</p>
          <div className="flex gap-2">
            <button
              onClick={() => resumeWorkflow(true)}
              className="px-4 py-2 bg-green-500 text-white rounded"
            >
              Approve
            </button>
            <button
              onClick={() => resumeWorkflow(false, 'Rejected')}
              className="px-4 py-2 bg-red-500 text-white rounded"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {events.map((event, i) => (
          <div key={i} className="p-2 bg-gray-50 rounded">
            <span className="font-mono text-sm">{event.type}:</span>
            <pre className="text-xs mt-1 overflow-auto">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Environment Variables

Add to `env.example`:

```bash
# ===========================================
# MASTRA WORKFLOW ENGINE
# ===========================================

# Enable Mastra telemetry
MASTRA_TELEMETRY_ENABLED=true

# Mastra storage (reuse existing DATABASE_URL)
# MASTRA_STORAGE_URL=postgresql://...

# Model routing
MASTRA_DEFAULT_MODEL=openai/gpt-4o
MASTRA_FAST_MODEL=openai/gpt-4o-mini
MASTRA_CODER_MODEL=anthropic/claude-3-5-sonnet-20241022
```

---

## Testing Strategy

### Unit Tests

```typescript
// __tests__/mastra/workflows.test.ts
import { codeAgentWorkflow } from '@/lib/mastra/workflows/code-agent-workflow';

describe('Code Agent Workflow', () => {
  it('should execute planner step', async () => {
    const result = await codeAgentWorkflow.execute({
      task: 'Create a hello world function',
      ownerId: 'test-user',
    });
    expect(result.result).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// __tests__/mastra/hitl.test.ts
import { hitlWorkflow } from '@/lib/mastra/workflows/hitl-workflow';
import { mastra } from '@/lib/mastra/mastra-instance';

describe('HITL Workflow', () => {
  it('should suspend for approval', async () => {
    const workflow = mastra.getWorkflow('hitl-code-review');
    const run = await workflow.createRun();
    
    const result = await run.start({
      inputData: {
        code: 'export const hello = "world";',
        description: 'Test export',
        ownerId: 'test-user',
      },
    });

    expect(result.status).toBe('suspended');
  });
});
```

---

## Next Steps

1. ✅ Install Mastra packages
2. ✅ Create Mastra instance
3. ✅ Define tools from existing services
4. ✅ Create workflows
5. ✅ Add API endpoints
6. ✅ Build frontend UI
7. ✅ Add tests
8. ✅ Deploy and monitor

---

**Implementation Date**: 2026-02-27  
**Estimated Duration**: 10-14 days  
**Status**: Ready for implementation
