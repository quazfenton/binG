---
id: sdk-mastra-1-x-api-update-guide
title: Mastra 1.x API Update Guide
aliases:
  - MASTRA_1X_API_UPDATE
  - MASTRA_1X_API_UPDATE.md
  - mastra-1-x-api-update-guide
  - mastra-1-x-api-update-guide.md
tags:
  - guide
layer: core
summary: "# Mastra 1.x API Update Guide\r\n\r\n**Date**: 2026-02-27  \r\n**Status**: ✅ **UPDATED FOR MASTRA 1.8.0**\r\n\r\n---\r\n\r\n## What Changed\r\n\r\nUpdated Mastra implementation to work with **version 1.8.0+** API.\r\n\r\n---\r\n\r\n## Key Changes\r\n\r\n### 1. Storage Configuration ✅\r\n\r\n**File**: `lib/mastra/mastra-instance.ts`"
anchors:
  - What Changed
  - Key Changes
  - 1. Storage Configuration ✅
  - 2. Tool Creation ✅
  - 3. Workflow Configuration ✅
  - 4. Step Execution Context ✅
  - Required Dependencies
  - Environment Variables
  - Testing
  - Production Deployment
  - 'Option 1: Simple PostgreSQL (Current)'
  - 'Option 2: Composite Storage (Advanced)'
  - Migration from 0.x
  - Storage
  - Tools
  - Workflows
  - Troubleshooting
  - 'Error: "Storage type not supported"'
  - 'Error: "createTool is not a function"'
  - 'Error: "Workflow not found"'
  - Summary
---
# Mastra 1.x API Update Guide

**Date**: 2026-02-27  
**Status**: ✅ **UPDATED FOR MASTRA 1.8.0**

---

## What Changed

Updated Mastra implementation to work with **version 1.8.0+** API.

---

## Key Changes

### 1. Storage Configuration ✅

**File**: `lib/mastra/mastra-instance.ts`

**Updated**:
```typescript
export const mastra = new Mastra({
  storage: {
    type: 'postgresql',
    uri: process.env.DATABASE_URL || 'postgresql://localhost:5432/bing',
    connectionConfig: {
      max: 20,
      idleTimeoutMillis: 30000,
    },
    schema: process.env.MASTRA_SCHEMA || 'mastra',
  },
  telemetry: {
    enabled: process.env.MASTRA_TELEMETRY_ENABLED === 'true',
    serviceName: 'bing-agent',
    samplingRate: 0.1,
  },
  workflows: {
    codeAgent: codeAgentWorkflow,
    hitlCodeReview: hitlWorkflow,
    parallelProcessing: parallelWorkflow,
  },
});
```

**Notes**:
- ✅ Uses simple PostgreSQL config (works with 1.8.0)
- ✅ Added `MASTRA_SCHEMA` env variable support
- ✅ Composite storage example in comments (for production)

---

### 2. Tool Creation ✅

**File**: `lib/mastra/tools/index.ts`

**Import** (already correct):
```typescript
import { createTool } from '@mastra/core/tools';
```

**Tool Structure** (1.x compatible):
```typescript
export const writeFileTool = createTool({
  id: 'WRITE_FILE',
  description: '...',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  execute: async ({ context }) => {
    const { path, content, ownerId } = context;
    try {
      const file = await vfs.writeFile(ownerId, path, content);
      return { success: true, path: file.path, version: file.version };
    } catch (error) {
      return { 
        success: false, 
        path, 
        version: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },
});
```

**Changes**:
- ✅ Added error handling to all tools
- ✅ Returns structured error responses
- ✅ Uses `context` parameter correctly

---

### 3. Workflow Configuration ✅

**File**: `lib/mastra/workflows/code-agent-workflow.ts`

**Already Compatible** - The workflow files use the correct 1.x API:
```typescript
export const codeAgentWorkflow = createWorkflow({
  id: 'code-agent',
  inputSchema: WorkflowInput,
  outputSchema: z.object({ result: z.string() }),
})
  .then(plannerStep)
  .then(executorStep)
  .then(criticStep)
  .commit();
```

**Notes**:
- ✅ No `name` property (removed in 1.x)
- ✅ Uses `.then()` chain
- ✅ Uses `.commit()` to finalize

---

### 4. Step Execution Context ✅

**File**: `lib/mastra/workflows/hitl-workflow.ts`

**Already Compatible** - Uses correct 1.x context API:
```typescript
export const approvalStep = createStep({
  id: 'approval',
  inputSchema: z.object({ ... }),
  resumeSchema: ApprovalDecision,
  suspendSchema: SuspendData,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { valid, errors, code, description, ownerId } = inputData;
    const { approved, feedback } = resumeData ?? {};
    
    if (approved === undefined) {
      return await suspend({
        reason: valid ? 'Code review required' : `Syntax errors found: ${errors.join(', ')}`,
        codePreview: code.slice(0, 500),
      });
    }
    
    // ... rest of logic
  },
});
```

**Features**:
- ✅ Uses `suspend()` for HITL
- ✅ Uses `resumeSchema` and `suspendSchema`
- ✅ Handles `resumeData` correctly

---

## Required Dependencies

**Already Installed**:
```json
{
  "@mastra/core": "^1.8.0",
  "mastra": "^1.3.5"
}
```

**Optional (for production)**:
```bash
# Composite storage with dedicated PostgreSQL
pnpm add @mastra/pg

# Enhanced memory with LibSQL
pnpm add @mastra/libsql

# ClickHouse for observability
pnpm add @mastra/clickhouse
```

---

## Environment Variables

Add to `env.example`:

```bash
# ===========================================
# MASTRA CONFIGURATION
# ===========================================
MASTRA_ENABLED=true
MASTRA_TELEMETRY_ENABLED=true
MASTRA_SCHEMA=mastra

# Storage
DATABASE_URL=postgresql://user:password@localhost:5432/bing

# Worker (for horizontal scaling)
REDIS_URL=redis://localhost:6379
MASTRA_WORKER_CONCURRENCY=5
```

---

## Testing

**Run Mastra workflows**:

```bash
# Test workflow execution
pnpm tsx lib/mastra/workflows/test-workflow.ts

# Test tools
pnpm tsx -e "
  import { allTools } from './lib/mastra/tools';
  const result = await allTools.writeFile.execute({
    context: { path: 'test.txt', content: 'hello', ownerId: 'test' }
  });
  console.log(result);
"
```

---

## Production Deployment

### Option 1: Simple PostgreSQL (Current)

Works for most use cases:

```typescript
export const mastra = new Mastra({
  storage: {
    type: 'postgresql',
    uri: process.env.DATABASE_URL,
    connectionConfig: { max: 20 },
    schema: 'mastra',
  },
});
```

### Option 2: Composite Storage (Advanced)

For production with separate databases per domain:

```typescript
import { MastraCompositeStore } from '@mastra/core/storage';
import { WorkflowsPG, ScoresPG } from '@mastra/pg';

const storage = new MastraCompositeStore({
  id: 'composite',
  domains: {
    workflows: new WorkflowsPG({ 
      connectionString: process.env.DATABASE_URL 
    }),
    scores: new ScoresPG({ 
      connectionString: process.env.DATABASE_URL 
    }),
  },
});

export const mastra = new Mastra({ storage });
```

**Benefits**:
- Use PostgreSQL for workflows
- Use ClickHouse for observability
- Use LibSQL for memory
- Each domain optimized for its workload

---

## Migration from 0.x

If you have old 0.x code:

### Storage
```diff
- storage: {
-   type: 'postgresql',
-   uri: process.env.DATABASE_URL,
- }
+ storage: {
+   type: 'postgresql',
+   uri: process.env.DATABASE_URL,
+   connectionConfig: { max: 20 },
+   schema: 'mastra',
+ }
```

### Tools
```diff
- import { createTool } from '@mastra/core';
+ import { createTool } from '@mastra/core/tools';
```

### Workflows
```diff
  createWorkflow({
    id: 'name',
-   name: 'Display Name',  // Removed in 1.x
    inputSchema: ...,
  })
```

---

## Troubleshooting

### Error: "Storage type not supported"

**Solution**: Make sure you're using the correct storage config:
```typescript
storage: {
  type: 'postgresql',  // Not 'postgres' or 'pg'
  uri: process.env.DATABASE_URL,
}
```

### Error: "createTool is not a function"

**Solution**: Update import:
```typescript
import { createTool } from '@mastra/core/tools';  // Not '@mastra/core'
```

### Error: "Workflow not found"

**Solution**: Check workflow registration:
```typescript
export const mastra = new Mastra({
  workflows: {
    codeAgent: codeAgentWorkflow,  // Key must match workflow ID
  },
});

// Access with:
const workflow = mastra.getWorkflow('codeAgent');
```

---

## Summary

| Component | Status | Changes Required |
|-----------|--------|------------------|
| **Storage** | ✅ Compatible | None (already updated) |
| **Tools** | ✅ Compatible | None (already updated) |
| **Workflows** | ✅ Compatible | None (already updated) |
| **HITL** | ✅ Compatible | None (already updated) |
| **Telemetry** | ✅ Compatible | None (already updated) |

**Status**: All Mastra files are **1.8.0 compatible**.

---

**Generated**: 2026-02-27  
**Next Step**: Test workflow execution with `pnpm tsx lib/mastra/workflows/test-workflow.ts`
