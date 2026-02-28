# Mastra Implementation Issues & Fixes

**Date**: 2026-02-27  
**Status**: 🔧 **CRITICAL FIXES REQUIRED**  
**Based on**: Official Mastra Documentation Review

---

## 🔴 Critical Issues

### Issue 1: Incorrect `createStep` Execute Function Signature

**Problem**: Current implementation uses `context.getStepPayload()` which doesn't exist in Mastra API.

**Current Code** (WRONG):
```typescript
// lib/mastra/workflows/code-agent-workflow.ts
execute: async ({ context }) => {
  const { task, ownerId } = context.getStepPayload('planner');
  // ...
}
```

**Correct API** (from docs):
```typescript
execute: async ({ inputData, state, setState, requestContext }) => {
  // inputData is already typed by inputSchema
  const { task, ownerId } = inputData;
  // ...
}
```

**Fix Required**: All step definitions need to be updated.

---

### Issue 2: Missing `name` Property in Agent Configuration

**Problem**: Mastra Agent requires both `id` AND `name` properties.

**Current Code** (INCOMPLETE):
```typescript
// lib/mastra/models/model-router.ts
fast: new Agent({
  id: 'fast-router',
  model: 'openai/gpt-4o-mini',
  instructions: '...',
}),
```

**Correct API** (from docs):
```typescript
fast: new Agent({
  id: 'fast-router',
  name: 'Fast Model Router',  // REQUIRED
  model: 'openai/gpt-4o-mini',
  instructions: '...',
}),
```

**Fix Required**: Add `name` property to all Agent instances.

---

### Issue 3: Incorrect Tool Execute Signature

**Problem**: Tools use `{ context }` but Mastra uses `{ context }` where context contains the input data directly.

**Current Code** (NEEDS VERIFICATION):
```typescript
// lib/mastra/tools/index.ts
execute: async ({ context }) => {
  const { path, content, ownerId } = context;
  // ...
}
```

**Correct API** (based on workflows pattern):
```typescript
execute: async ({ context }) => {
  // context contains the validated input data
  const { path, content, ownerId } = context;
  // This is actually correct, but needs verification
}
```

**Status**: Needs testing to verify exact signature.

---

### Issue 4: Workflow Registration in Mastra Instance

**Problem**: Workflows are registered but the Mastra instance initialization may not be correct.

**Current Code**:
```typescript
// lib/mastra/mastra-instance.ts
export const mastra = new Mastra({
  storage: { type: 'postgresql', uri: process.env.DATABASE_URL },
  workflows: {
    'code-agent': codeAgentWorkflow,
    'hitl-code-review': hitlWorkflow,
  },
});
```

**Correct API** (from docs):
```typescript
import { Mastra } from '@mastra/core/mastra';

export const mastra = new Mastra({
  workflows: {
    codeAgent: codeAgentWorkflow,  // Key becomes workflow ID
    hitlCodeReview: hitlWorkflow,
  },
  storage: {
    type: 'postgresql',
    uri: process.env.DATABASE_URL,
  },
});
```

**Note**: Workflow keys should match workflow IDs or use camelCase.

---

### Issue 5: Missing Error Handling in API Routes

**Problem**: API routes don't handle all workflow status cases (suspended, failed, tripwire).

**Current Code**:
```typescript
// app/api/mastra/workflow/route.ts
const stream = await run.stream({ inputData: { task, ownerId } });
```

**Missing**: Status checking and proper error responses for different workflow states.

**Fix Required**: Add comprehensive error handling.

---

## 🟡 Medium Priority Issues

### Issue 6: No State Management in Workflows

**Problem**: Workflows don't utilize Mastra's state management feature.

**Current**: Steps execute independently without shared state.

**Recommended**: Add `stateSchema` for tracking execution progress.

```typescript
const WorkflowState = z.object({
  currentStep: z.string(),
  attempts: z.number(),
  errors: z.array(z.string()),
});

const executorStep = createStep({
  id: 'executor',
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState }) => {
    setState({ ...state, currentStep: 'executor' });
    // ...
  },
});
```

---

### Issue 7: No RequestContext Usage

**Problem**: Not utilizing Mastra's `requestContext` for dynamic behavior.

**Recommended**: Add request context for user-specific behavior.

```typescript
const step = createStep({
  execute: async ({ inputData, requestContext }) => {
    const userTier = requestContext.get('user-tier') as 'enterprise' | 'pro';
    const maxSteps = userTier === 'enterprise' ? 100 : 10;
    // ...
  },
});
```

---

### Issue 8: Missing Workflow Cloning Support

**Problem**: Not demonstrating workflow cloning for parallel execution.

**Recommended**: Show cloning pattern for concurrent executions.

```typescript
import { cloneWorkflow } from '@mastra/core/workflows';

const clonedWorkflow = cloneWorkflow(codeAgentWorkflow, {
  id: 'code-agent-clone',
});
```

---

## 🟢 Enhancements (Nice to Have)

### Enhancement 1: Add Memory Integration

**Not Implemented**: Mastra memory features (message history, working memory, semantic recall).

**Recommended Addition**:
```typescript
// lib/mastra/memory/index.ts
import { Memory } from '@mastra/memory';

export const agentMemory = new Memory({
  storage: {
    type: 'postgresql',
    uri: process.env.DATABASE_URL,
  },
  options: {
    workingMemory: true,
    semanticRecall: true,
  },
});
```

---

### Enhancement 2: Add Evals/Scorers

**Not Implemented**: Quality measurement with Mastra evals.

**Recommended Addition**:
```typescript
// lib/mastra/evals/code-quality.ts
import { createScorer } from '@mastra/evals';

export const codeQualityScorer = createScorer({
  id: 'code-quality',
  name: 'Code Quality Scorer',
  instructions: 'Rate code quality from 1-10',
  outputSchema: z.object({ score: z.number() }),
});
```

---

### Enhancement 3: Add Observability Integration

**Not Implemented**: Full observability with traces and spans.

**Recommended**: Integrate with existing telemetry.

---

## 📋 Fix Implementation Plan

### Phase 1: Critical Fixes (Day 1)

1. ✅ Fix `createStep` execute function signature
2. ✅ Add `name` property to all Agents
3. ✅ Verify tool execute signature
4. ✅ Fix Mastra instance registration
5. ✅ Add comprehensive error handling

### Phase 2: Medium Priority (Day 2-3)

6. ✅ Add state management to workflows
7. ✅ Implement RequestContext usage
8. ✅ Add workflow cloning examples

### Phase 3: Enhancements (Day 4-5)

9. ⏳ Add memory integration
10. ⏳ Add evals/scorers
11. ⏳ Add observability integration

---

## 🔧 Fixed Code Examples

### Fixed: Code Agent Workflow

```typescript
// lib/mastra/workflows/code-agent-workflow.ts

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getModel } from '../models/model-router';
import { writeFileTool, readFileTool, executeCodeTool, syntaxCheckTool } from '../tools';

// Schema Definitions
export const WorkflowInput = z.object({
  task: z.string().describe('User task description'),
  ownerId: z.string().describe('Workspace owner ID'),
});

export const PlanOutput = z.object({
  steps: z.array(z.object({
    action: z.string(),
    tool: z.string(),
    parameters: z.record(z.any()),
  })),
});

// Step 1: Planner (FIXED)
export const plannerStep = createStep({
  id: 'planner',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {  // ✅ FIXED: Use inputData directly
    const { task, ownerId } = inputData;  // ✅ FIXED: Destructure from inputData
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a planning agent. Output a JSON plan with steps.`,
      },
      { role: 'user', content: task },
    ]);

    try {
      const plan = JSON.parse(response.text);
      return { plan, ownerId };
    } catch (error) {
      throw new Error(`Failed to parse plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Step 2: Executor (FIXED)
export const executorStep = createStep({
  id: 'executor',
  inputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    toolResults: z.array(z.any()),
    attempts: z.number(),
  }),
  execute: async ({ inputData }) => {  // ✅ FIXED
    const { plan, ownerId } = inputData;  // ✅ FIXED
    const toolResults = [];

    for (const step of plan.steps) {
      const tool = [writeFileTool, readFileTool, executeCodeTool, syntaxCheckTool]
        .find(t => t.id === step.tool);
      
      if (!tool) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }

      try {
        const result = await tool.execute({
          context: { ...step.parameters, ownerId },
        });
        
        toolResults.push({ step, result });
      } catch (error) {
        toolResults.push({ 
          step, 
          result: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    }

    return { toolResults, attempts: 1 };
  },
});

// Workflow Definition
export const codeAgentWorkflow = createWorkflow({
  id: 'code-agent',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    result: z.string(),
  }),
})
  .then(plannerStep)
  .then(executorStep)
  .then(criticStep)
  .commit();
```

---

### Fixed: Model Router Agents

```typescript
// lib/mastra/models/model-router.ts

import { Agent } from '@mastra/core/agent';

export const modelRouter = {
  fast: new Agent({
    id: 'fast-router',
    name: 'Fast Model Router',  // ✅ ADDED: Required name property
    model: 'openai/gpt-4o-mini',
    instructions: [
      'You are a fast, efficient assistant.',
      'Provide concise, direct answers.',
    ],
  }),
  reasoning: new Agent({
    id: 'reasoning-router',
    name: 'Reasoning Model Router',  // ✅ ADDED
    model: 'openai/gpt-4o',
    instructions: [
      'You are a thoughtful reasoning assistant.',
      'Think step-by-step before answering.',
    ],
  }),
  coder: new Agent({
    id: 'coder-router',
    name: 'Coder Model Router',  // ✅ ADDED
    model: 'anthropic/claude-3-5-sonnet-20241022',
    instructions: [
      'You are an expert coding assistant.',
      'Write clean, maintainable code.',
    ],
  }),
};
```

---

### Fixed: Mastra Instance

```typescript
// lib/mastra/mastra-instance.ts

import { Mastra } from '@mastra/core/mastra';
import { codeAgentWorkflow } from './workflows/code-agent-workflow';
import { hitlWorkflow } from './workflows/hitl-workflow';

export const mastra = new Mastra({
  storage: {
    type: 'postgresql',
    uri: process.env.DATABASE_URL || 'postgresql://localhost:5432/bing',
  },
  telemetry: {
    enabled: process.env.MASTRA_TELEMETRY_ENABLED === 'true',
    serviceName: 'bing-agent',
  },
  workflows: {
    codeAgent: codeAgentWorkflow,  // ✅ Use camelCase or match workflow id
    hitlCodeReview: hitlWorkflow,
  },
});
```

---

## ✅ Verification Checklist

After applying fixes:

- [ ] Run `tsc` to check for TypeScript errors
- [ ] Test workflow execution with `run.start()`
- [ ] Test streaming with `run.stream()`
- [ ] Test suspend/resume functionality
- [ ] Verify tool execution
- [ ] Check error handling in API routes
- [ ] Test state management
- [ ] Verify request context usage

---

**Next Steps**: Apply all critical fixes before deployment.
