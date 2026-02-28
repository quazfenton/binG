# Mastra Advanced Agentic Engine Integration Plan

**Date**: February 27, 2026
**Status**: 📋 Planning Phase
**Target**: Production-Grade Multi-Cluster Agentic Infrastructure

---

## 🎯 Executive Summary

This plan outlines the integration of **Mastra** as an advanced agentic engine into the existing binG codebase. Rather than replacing existing infrastructure, Mastra will **augment** current capabilities with:

- **Workflow runtime** for deterministic multi-step orchestration
- **Tool execution boundaries** with strict schema enforcement
- **Stateful orchestration** with suspend/resume capabilities
- **Model routing** across 40+ providers
- **Human-in-the-loop** approval workflows
- **Horizontal scaling** with distributed queue execution
- **MCP integration** for provider-agnostic tooling
- **Self-optimizing verification** budget allocation

**Key Principle**: Mastra is **not** "LangChain but different" — it's a **production orchestration layer** that sits **on top of** existing infrastructure.

---

## 📊 Current Codebase Analysis

### Existing Infrastructure (To Preserve & Augment)

| Component | Current Implementation | Mastra Integration Point |
|-----------|----------------------|-------------------------|
| **Agent Loop** | `lib/stateful-agent/agents/` | Mastra Workflow as deterministic replacement |
| **Tool Executor** | `lib/stateful-agent/tools/tool-executor.ts` | Mastra Tools with schema validation |
| **Virtual FS** | `lib/virtual-filesystem/virtual-filesystem-service.ts` | MCP Tool Server boundary |
| **Sandbox** | `lib/sandbox/providers/` | Sandboxed execution node |
| **Model Router** | `lib/stateful-agent/agents/provider-fallback.ts` | Mastra Model Router with 40+ providers |
| **Tool Routing** | `lib/tool-integration/` | MCP integration layer |
| **HITL** | `lib/stateful-agent/human-in-the-loop.ts` | Mastra suspend/resume |

### What Mastra Replaces

❌ **Custom agent loop** → ✅ Mastra Workflow engine
❌ **Manual retry logic** → ✅ Built-in retry per step
❌ **Tool parsing in prompt** → ✅ Schema-validated tool calls
❌ **Coupled sandbox execution** → ✅ Sandboxed execution boundary

### What Mastra Augments

✅ **Virtual FS** → MCP Tool Server
✅ **Sandbox providers** → Execution boundary
✅ **Model providers** → Unified routing layer
✅ **HITL system** → Suspend/resume workflows

---

## 🏗️ Architecture Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Frontend                         │
│         (Chat UI, Workflow Dashboard, Approval UI)          │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST / SSE Streaming
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Mastra Control Node                        │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│   │   Agents    │  │  Workflows  │  │  Model Router   │   │
│   │  (Mastra)   │  │  (Mastra)   │  │  (40+ providers)│   │
│   └─────────────┘  └─────────────┘  └─────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ Tool Calls (MCP Protocol)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   MCP Tool Server                           │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│   │   VFS    │  │ Sandbox  │  │  Email   │  │   Git    │  │
│   │  Tools   │  │  Tools   │  │  Tools   │  │  Tools   │  │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               Existing Infrastructure                       │
│   Virtual FS │ Sandbox Providers │ Email │ Git │ External  │
└─────────────────────────────────────────────────────────────┘
```

### Distributed Execution (Phase 2)

```
┌─────────────────────┐
│   Next.js API       │
│   (Job Producer)    │
└──────────┬──────────┘
           │
           ▼
    ┌──────────────┐
    │  Redis Queue │
    └──────┬───────┘
           │
    ┌──────┴───────┬───────────────┬──────────────┐
    ▼              ▼               ▼              ▼
┌────────┐   ┌────────┐    ┌────────┐    ┌────────┐
│Worker A│   │Worker B│    │Worker C│    │Worker D│
│Mastra  │   │Mastra  │    │Mastra  │    │Mastra  │
│Workflow│   │Workflow│    │Workflow│    │Workflow│
└────────┘   └────────┘    └────────┘    └────────┘
```

---

## 📦 Phase 1: Core Mastra Integration (Week 1-2)

### 1.1 Installation & Setup

```bash
pnpm add mastra @mastra/core @mastra/agents @mastra/workflows
pnpm add @mastra/mcp @mastra/memory @mastra/evals
```

**File**: `lib/mastra/mastra-instance.ts`

```typescript
import { Mastra } from '@mastra/core';
import { createBundler } from '@mastra/core/bundler';

export const mastra = new Mastra({
  bundler: createBundler({
    outputDir: '.mastra',
  }),
  storage: {
    // Use existing database
    type: 'postgresql',
    uri: process.env.DATABASE_URL,
  },
  telemetry: {
    enabled: true,
    serviceName: 'bing-agent',
  },
});
```

### 1.2 Model Router Integration

**File**: `lib/mastra/models/router.ts`

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// Reuse existing provider configuration
const modelMap = {
  fast: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })('gpt-4o-mini'),
  reasoning: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })('gpt-4o'),
  coder: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })('claude-3-5-sonnet-20241022'),
  costEffective: createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY })('gemini-1.5-flash'),
};

export type ModelTier = 'fast' | 'reasoning' | 'coder' | 'costEffective';

export async function routeModel(tier: ModelTier, messages: any[]) {
  const model = modelMap[tier];
  
  // Add latency tracking
  const start = Date.now();
  const result = await model.doGenerate({ messages });
  const latency = Date.now() - start;
  
  // Log for observability
  console.log(`[ModelRouter] ${tier} completed in ${latency}ms`);
  
  return result;
}
```

### 1.3 Tool Integration with MCP

**File**: `lib/mastra/tools/mcp-server.ts`

```typescript
import { McpServer } from '@mastra/mcp';
import { z } from 'zod';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { getSandboxProvider } from '@/lib/sandbox/providers';

const vfs = new VirtualFilesystemService();
const sandboxProvider = getSandboxProvider();

export const mcpServer = new McpServer({
  name: 'bing-tools',
  version: '1.0.0',
});

// Virtual FS Tools
mcpServer.tool(
  'WRITE_FILE',
  'Write content to a file in the virtual filesystem',
  {
    path: z.string().describe('File path'),
    content: z.string().describe('File content'),
    ownerId: z.string().describe('Workspace owner ID'),
  },
  async ({ path, content, ownerId }) => {
    const file = await vfs.writeFile(ownerId, path, content);
    return {
      success: true,
      path: file.path,
      version: file.version,
    };
  }
);

mcpServer.tool(
  'READ_FILE',
  'Read content from a file',
  {
    path: z.string(),
    ownerId: z.string(),
  },
  async ({ path, ownerId }) => {
    const file = await vfs.readFile(ownerId, path);
    return { content: file.content, language: file.language };
  }
);

mcpServer.tool(
  'DELETE_PATH',
  'Delete a file or directory',
  {
    path: z.string(),
    ownerId: z.string(),
  },
  async ({ path, ownerId }) => {
    const result = await vfs.deletePath(ownerId, path);
    return { deletedCount: result.deletedCount };
  }
);

// Sandbox Execution Tools
mcpServer.tool(
  'EXECUTE_CODE',
  'Execute code in a sandboxed environment',
  {
    code: z.string().describe('Code to execute'),
    language: z.enum(['python', 'typescript', 'javascript']),
    ownerId: z.string(),
  },
  async ({ code, language, ownerId }) => {
    const sandbox = await sandboxProvider.createSandbox({});
    const result = await sandbox.executeCommand(
      language === 'python' ? `python3 -c "${code}"` : `node -e "${code}"`
    );
    
    if (!result.success) {
      throw new Error(result.output || 'Execution failed');
    }
    
    return { output: result.output, exitCode: result.exitCode };
  }
);

// Syntax Check Tool (Safety Gate)
mcpServer.tool(
  'SYNTAX_CHECK',
  'Check code syntax before execution',
  {
    code: z.string(),
    language: z.enum(['python', 'typescript', 'javascript']),
  },
  async ({ code, language }) => {
    // Use existing code parser
    const { checkSyntax } = await import('@/lib/code-parser');
    const result = checkSyntax(code, language);
    
    return {
      valid: result.valid,
      errors: result.errors,
    };
  }
);
```

### 1.4 Declarative Workflow Definition

**File**: `lib/mastra/workflows/code-agent-workflow.ts`

```typescript
import { createWorkflow, createStep } from '@mastra/core';
import { z } from 'zod';
import { routeModel } from '../models/router';
import { mcpServer } from '../tools/mcp-server';

// State Schema
const AgentState = z.object({
  input: z.string().describe('User input or task description'),
  plan: z.object({
    steps: z.array(z.object({
      action: z.string(),
      tool: z.string(),
      parameters: z.record(z.any()),
    })),
  }).optional(),
  toolResults: z.array(z.any()).optional(),
  final: z.string().optional(),
  attempts: z.number().default(0),
  ownerId: z.string(),
});

// Step 1: Planner
const plannerStep = createStep({
  id: 'planner',
  inputSchema: z.object({ input: z.string(), ownerId: z.string() }),
  outputSchema: z.object({ plan: z.any(), ownerId: z.string() }),
  execute: async ({ context }) => {
    const { input, ownerId } = context.getStepPayload<{ input: string; ownerId: string }>('planner');
    
    const response = await routeModel('reasoning', [
      {
        role: 'system',
        content: `You are a planning agent. Output a JSON plan with steps.
        Each step must specify: action, tool, parameters.
        Available tools: WRITE_FILE, READ_FILE, DELETE_PATH, EXECUTE_CODE, SYNTAX_CHECK`,
      },
      { role: 'user', content: input },
    ]);
    
    const plan = JSON.parse(response.text);
    
    return { plan, ownerId };
  },
});

// Step 2: Executor
const executorStep = createStep({
  id: 'executor',
  inputSchema: z.object({ plan: z.any(), ownerId: z.string() }),
  outputSchema: z.object({ toolResults: z.array(z.any()), attempts: z.number() }),
  execute: async ({ context }) => {
    const { plan, ownerId } = context.getStepPayload<{ plan: any; ownerId: string }>('executor');
    const toolResults = [];
    
    for (const step of plan.steps) {
      const tool = mcpServer.getTool(step.tool);
      const result = await tool.execute(step.parameters);
      toolResults.push({ step, result });
    }
    
    return { toolResults, attempts: 1 };
  },
});

// Step 3: Critic (Self-Healing)
const criticStep = createStep({
  id: 'critic',
  inputSchema: z.object({ 
    input: z.string(), 
    toolResults: z.array(z.any()), 
    attempts: z.number(),
    ownerId: z.string(),
  }),
  outputSchema: z.object({ final: z.string() }).or(z.object({ fix: z.string() })),
  execute: async ({ context }) => {
    const { input, toolResults, attempts, ownerId } = context.getStepPayload<{
      input: string;
      toolResults: any[];
      attempts: number;
      ownerId: string;
    }>('critic');
    
    const response = await routeModel('reasoning', [
      {
        role: 'system',
        content: `Review the tool execution results. 
        Output JSON: { "success": boolean, "fix": string | null }
        If success is false and attempts < 3, provide a fix instruction.`,
      },
      { role: 'user', content: JSON.stringify({ input, toolResults }) },
    ]);
    
    const parsed = JSON.parse(response.text);
    
    if (!parsed.success && attempts < 3) {
      // Retry with fix instruction
      return { fix: parsed.fix };
    }
    
    return { final: JSON.stringify(toolResults) };
  },
});

// Workflow Definition
export const codeAgentWorkflow = createWorkflow({
  id: 'code-agent',
  schema: AgentState,
  steps: [plannerStep, executorStep, criticStep],
});
```

### 1.5 Streaming API Endpoint

**File**: `app/api/mastra/agent/route.ts`

```typescript
import { codeAgentWorkflow } from '@/lib/mastra/workflows/code-agent-workflow';

export async function POST(req: Request) {
  const { input, ownerId } = await req.json();
  
  // Stream workflow execution
  const stream = await codeAgentWorkflow.stream({
    input: { input, ownerId },
  });
  
  // Convert to SSE stream for frontend
  return new Response(stream.toReadableStream(), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 1.6 Frontend Integration

**File**: `components/mastra/mastra-agent-ui.tsx`

```typescript
'use client';

import { useState } from 'react';

export function MastraAgentUI({ ownerId }: { ownerId: string }) {
  const [input, setInput] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runAgent = async () => {
    setIsRunning(true);
    setEvents([]);
    
    const response = await fetch('/api/mastra/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, ownerId }),
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const event = decoder.decode(value);
      setEvents(prev => [...prev, JSON.parse(event.slice(6))]);
    }
    
    setIsRunning(false);
  };

  return (
    <div>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Describe your task..."
      />
      <button onClick={runAgent} disabled={isRunning}>
        {isRunning ? 'Running...' : 'Run Agent'}
      </button>
      
      <div>
        {events.map((event, i) => (
          <div key={i}>{event.type}: {JSON.stringify(event.payload)}</div>
        ))}
      </div>
    </div>
  );
}
```

---

## 🚀 Phase 2: Horizontal Scaling (Week 3-4)

### 2.1 Queue Infrastructure

**File**: `infra/queue.ts`

```typescript
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export const agentQueue = new Queue('mastra-agent', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

export const resultQueue = new Queue('mastra-result', {
  connection: redis,
});
```

### 2.2 API Producer (Next.js)

**File**: `app/api/refactor/route.ts`

```typescript
import { agentQueue } from '@/infra/queue';
import { v4 as uuid } from 'uuid';

export async function POST(req: Request) {
  const { repoUrl, instructions, ownerId } = await req.json();
  
  const jobId = uuid();
  
  await agentQueue.add('refactor-job', {
    repoUrl,
    instructions,
    ownerId,
  }, {
    jobId,
  });
  
  return Response.json({ jobId });
}
```

### 2.3 Distributed Worker

**File**: `worker/index.ts`

```typescript
import { Worker } from 'bullmq';
import { codeAgentWorkflow } from '@/lib/mastra/workflows/code-agent-workflow';
import { redis } from '@/infra/queue';

const worker = new Worker(
  'mastra-agent',
  async job => {
    const { repoUrl, instructions, ownerId } = job.data;
    
    // Run workflow
    const result = await codeAgentWorkflow.execute({
      input: instructions,
      ownerId,
    });
    
    // Store result
    await resultQueue.add('store-result', {
      jobId: job.id,
      result,
    });
    
    return result;
  },
  {
    connection: redis,
    concurrency: 5, // Process 5 jobs concurrently
  }
);

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed:`, error);
});
```

### 2.4 Kubernetes Deployment

**File**: `k8s/mastra-worker-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mastra-worker
spec:
  replicas: 10
  selector:
    matchLabels:
      app: mastra-worker
  template:
    metadata:
      labels:
        app: mastra-worker
    spec:
      containers:
      - name: worker
        image: bing-mastra-worker:latest
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: url
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mastra-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mastra-worker
  minReplicas: 5
  maxReplicas: 50
  metrics:
  - type: External
    external:
      metric:
        name: queue_depth
      target:
        type: AverageValue
        averageValue: 10
```

---

## 🔥 Phase 3: Advanced Features (Week 5-6)

### 3.1 Contract Inference Engine

**File**: `lib/mastra/verification/contract-extractor.ts`

```typescript
import { Project } from 'ts-morph';

export interface ContractNode {
  id: string;
  signature: string;
  dependencies: string[];
  filePath: string;
}

export function extractContracts(rootPath: string): ContractNode[] {
  const project = new Project({ tsConfigFilePath: `${rootPath}/tsconfig.json` });
  const contracts: ContractNode[] = [];
  
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    
    for (const fn of sourceFile.getFunctions()) {
      if (fn.isExported()) {
        contracts.push({
          id: `${filePath}:${fn.getName()}`,
          signature: fn.getType().getText(),
          dependencies: fn
            .getDescendantsOfKind(SyntaxKind.Identifier)
            .map(id => id.getSymbol()?.getName())
            .filter((n): n is string => !!n),
          filePath,
        });
      }
    }
  }
  
  return contracts;
}

export function detectBreakingChanges(
  oldContracts: ContractNode[],
  newContracts: ContractNode[]
): ContractNode[] {
  return oldContracts.filter(oldC => {
    const newC = newContracts.find(n => n.id === oldC.id);
    return !newC || newC.signature !== oldC.signature;
  });
}
```

### 3.2 Incremental Verification

**File**: `lib/mastra/verification/incremental-verifier.ts`

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface VerificationResult {
  passed: boolean;
  errors?: string[];
  duration: number;
}

export class IncrementalVerifier {
  async verify(
    changedFiles: string[],
    dependencyGraph: Map<string, string[]>,
    tier: 'MINIMAL' | 'STANDARD' | 'STRICT' | 'PARANOID'
  ): Promise<VerificationResult> {
    const start = Date.now();
    const impactedFiles = this.computeImpactedFiles(changedFiles, dependencyGraph);
    
    const results = [];
    
    // Tier-based verification
    if (tier === 'MINIMAL') {
      results.push(await this.incrementalTypeCheck(changedFiles));
      results.push(await this.runImpactedTests(impactedFiles));
    } else if (tier === 'STANDARD') {
      results.push(await this.incrementalTypeCheck(impactedFiles));
      results.push(await this.runImpactedTests(impactedFiles));
      results.push(await this.targetedSecurityScan(impactedFiles));
    } else if (tier === 'STRICT') {
      results.push(await this.fullTypeCheck());
      results.push(await this.runImpactedTests(impactedFiles));
      results.push(await this.targetedSecurityScan(impactedFiles));
      results.push(await this.llmDiffReview(changedFiles));
    } else { // PARANOID
      results.push(await this.fullTypeCheck());
      results.push(await this.fullTestSuite());
      results.push(await this.fullSecurityScan());
      results.push(await this.multiModelConsensus(changedFiles));
    }
    
    const passed = results.every(r => r.passed);
    const duration = Date.now() - start;
    
    return {
      passed,
      errors: results.filter(r => !r.passed).flatMap(r => r.errors || []),
      duration,
    };
  }
  
  private computeImpactedFiles(
    changedFiles: string[],
    graph: Map<string, string[]>
  ): string[] {
    const impacted = new Set(changedFiles);
    
    for (const [file, deps] of graph.entries()) {
      if (deps.some(d => changedFiles.includes(d))) {
        impacted.add(file);
      }
    }
    
    return [...impacted];
  }
  
  private async incrementalTypeCheck(files: string[]): Promise<VerificationResult> {
    try {
      await execPromise(`tsc --incremental --build ${files.join(' ')}`);
      return { passed: true, duration: 0 };
    } catch (error: any) {
      return { passed: false, errors: [error.stderr], duration: 0 };
    }
  }
  
  private async runImpactedTests(files: string[]): Promise<VerificationResult> {
    // Map files to test files
    const testFiles = files.map(f => f.replace('.ts', '.spec.ts'));
    
    try {
      await execPromise(`npm test -- ${testFiles.join(' ')}`);
      return { passed: true, duration: 0 };
    } catch (error: any) {
      return { passed: false, errors: [error.stderr], duration: 0 };
    }
  }
  
  private async targetedSecurityScan(files: string[]): Promise<VerificationResult> {
    try {
      await execPromise(`semgrep --include ${files.join(' --include ')} --config=auto`);
      return { passed: true, duration: 0 };
    } catch (error: any) {
      return { passed: false, errors: [error.stderr], duration: 0 };
    }
  }
  
  private async llmDiffReview(changedFiles: string[]): Promise<VerificationResult> {
    // Use Mastra model for diff review
    const { routeModel } = await import('../models/router');
    
    const response = await routeModel('reasoning', [
      {
        role: 'system',
        content: 'Review changed files for security issues, bugs, and regressions. Output JSON: { "safe": boolean, "issues": string[] }',
      },
      { role: 'user', content: JSON.stringify({ changedFiles }) },
    ]);
    
    const parsed = JSON.parse(response.text);
    
    return {
      passed: parsed.safe,
      errors: parsed.issues,
      duration: 0,
    };
  }
  
  private async multiModelConsensus(changedFiles: string[]): Promise<VerificationResult> {
    // Run multiple models and vote
    const results = await Promise.all([
      this.llmDiffReview(changedFiles),
      // Add more model reviews here
    ]);
    
    const passed = results.filter(r => r.passed).length > results.length / 2;
    
    return {
      passed,
      errors: results.flatMap(r => r.errors || []),
      duration: 0,
    };
  }
  
  // Additional methods: fullTypeCheck, fullTestSuite, fullSecurityScan...
}
```

### 3.3 Self-Optimizing Budget Allocation

**File**: `lib/mastra/verification/budget-allocator.ts`

```typescript
export interface RiskFactors {
  linesChanged: number;
  contractChanges: number;
  dependencyFanout: number;
  touchesSensitiveArea: boolean;
  historicalFailureRate: number;
  llmConfidence: number;
}

export enum VerificationTier {
  MINIMAL = 'MINIMAL',
  STANDARD = 'STANDARD',
  STRICT = 'STRICT',
  PARANOID = 'PARANOID',
}

export function computeRisk(f: RiskFactors): number {
  let score = 0;
  
  score += f.linesChanged * 0.01;
  score += f.contractChanges * 2;
  score += f.dependencyFanout * 0.5;
  score += f.historicalFailureRate * 3;
  
  if (f.touchesSensitiveArea) score += 5;
  if (f.llmConfidence < 0.6) score += 4;
  
  return Math.min(score, 100);
}

export function tierFromRisk(score: number): VerificationTier {
  if (score < 5) return VerificationTier.MINIMAL;
  if (score < 15) return VerificationTier.STANDARD;
  if (score < 30) return VerificationTier.STRICT;
  return VerificationTier.PARANOID;
}

export class BudgetAllocator {
  private history: Array<{
    tier: VerificationTier;
    postMergeFailures: boolean;
    productionIncidents: boolean;
  }> = [];
  
  async allocate(changedFiles: string[], riskFactors: RiskFactors): Promise<{
    tier: VerificationTier;
    maxTimeMs: number;
    maxTokens: number;
  }> {
    const risk = computeRisk(riskFactors);
    const tier = tierFromRisk(risk);
    
    // Adjust based on historical failure rate
    const adjustedTier = this.adjustTierBasedOnHistory(tier);
    
    // Budget constraints
    const budgets = {
      [VerificationTier.MINIMAL]: { maxTimeMs: 30000, maxTokens: 1000 },
      [VerificationTier.STANDARD]: { maxTimeMs: 120000, maxTokens: 4000 },
      [VerificationTier.STRICT]: { maxTimeMs: 300000, maxTokens: 10000 },
      [VerificationTier.PARANOID]: { maxTimeMs: 600000, maxTokens: 50000 },
    };
    
    return {
      tier: adjustedTier,
      ...budgets[adjustedTier],
    };
  }
  
  private adjustTierBasedOnHistory(currentTier: VerificationTier): VerificationTier {
    const recentHistory = this.history.slice(-20);
    const failureRate = recentHistory.filter(h => h.postMergeFailures).length / recentHistory.length;
    
    if (failureRate > 0.05) {
      // Increase strictness
      const tiers = Object.values(VerificationTier);
      const currentIndex = tiers.indexOf(currentTier);
      return tiers[Math.min(currentIndex + 1, tiers.length - 1)];
    } else if (failureRate < 0.01) {
      // Reduce strictness
      const tiers = Object.values(VerificationTier);
      const currentIndex = tiers.indexOf(currentTier);
      return tiers[Math.max(currentIndex - 1, 0)];
    }
    
    return currentTier;
  }
  
  logOutcome(tier: VerificationTier, outcome: { postMergeFailures: boolean; productionIncidents: boolean }): void {
    this.history.push({ tier, ...outcome });
  }
}
```

---

## 📝 Environment Variables

**File**: `env.example` (additions)

```env
# ===========================================
# MASTRA INTEGRATION
# ===========================================
# Mastra Agentic Engine
MASTRA_ENABLED=true
MASTRA_STORAGE_DIR=.mastra
MASTRA_TELEMETRY_ENABLED=true

# Model Routing
MASTRA_DEFAULT_MODEL_TIER=reasoning
MASTRA_FAST_MODEL=gpt-4o-mini
MASTRA_REASONING_MODEL=gpt-4o
MASTRA_CODER_MODEL=claude-3-5-sonnet-20241022
MASTRA_COST_MODEL=gemini-1.5-flash

# Queue Infrastructure (for horizontal scaling)
REDIS_URL=redis://localhost:6379
MASTRA_WORKER_CONCURRENCY=5

# Verification Budget
MASTRA_VERIFICATION_ENABLED=true
MASTRA_DEFAULT_VERIFICATION_TIER=STANDARD
MASTRA_MAX_VERIFICATION_TIME_MS=300000
MASTRA_MAX_VERIFICATION_TOKENS=10000

# MCP Integration
MASTRA_MCP_ENABLED=true
MASTRA_MCP_SERVER_URL=http://localhost:8261/mcp
```

---

## ✅ Implementation Checklist

### Phase 1: Core Integration (Week 1-2)
- [ ] Install Mastra packages
- [ ] Create Mastra instance
- [ ] Integrate model router
- [ ] Set up MCP tool server
- [ ] Define first workflow (code agent)
- [ ] Create streaming API endpoint
- [ ] Build frontend UI component
- [ ] Test end-to-end

### Phase 2: Horizontal Scaling (Week 3-4)
- [ ] Set up Redis queue
- [ ] Create API producer endpoint
- [ ] Build distributed worker
- [ ] Deploy to Kubernetes
- [ ] Configure autoscaling
- [ ] Load test with 100 concurrent jobs

### Phase 3: Advanced Features (Week 5-6)
- [ ] Implement contract extractor
- [ ] Build incremental verifier
- [ ] Create budget allocator
- [ ] Integrate with workflow verification step
- [ ] Add observability hooks
- [ ] Tune risk thresholds

---

## 🎯 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Workflow Success Rate** | >95% | Mastra observability |
| **Average Execution Time** | <2 min | Workflow logs |
| **Verification Cost** | -40% vs full scan | Token usage tracking |
| **False Positive Rate** | <5% | Post-merge failures |
| **Horizontal Scale** | 50 workers | Kubernetes HPA |

---

**Status**: 📋 **Ready for Implementation**
**Next Step**: Begin Phase 1 - Core Integration
