# 🔍 Execution Policy Audit & Integration Plan

**Date:** March 2026
**Purpose:** Identify redundancies and create integration strategy

---

## 📊 Current State Analysis

### Execution Policy Definitions

| File | Lines | Exports | Status |
|------|-------|---------|--------|
| `lib/sandbox/types.ts` | 268 | `ExecutionPolicy`, `determineExecutionPolicy()`, `getExecutionPolicyConfig()`, `requiresCloudSandbox()`, `allowsLocalFallback()`, `getPreferredProviders()` | ✅ **SOURCE OF TRUTH** |
| `lib/sandbox/provider-router.ts` | 728 | `selectByExecutionPolicy()`, latency tracking, task-based selection | ✅ Uses types.ts |
| `lib/session/session-manager.ts` | 822 | Session lifecycle with executionPolicy support | ✅ Uses types.ts |
| `lib/sandbox/types/execution-policy.ts` (NEW) | 300 | Risk patterns, `assessRisk()`, duplicate types | ❌ **REDUNDANT** |
| `lib/sandbox/sandbox-orchestrator.ts` (NEW) | 500 | Orchestrator with duplicate policy logic | ❌ **REDUNDANT** |

---

## 🔴 Redundancy Issues

### 1. **Duplicate ExecutionPolicy Type**

**`lib/sandbox/types.ts` (ORIGINAL - 268 lines):**
```typescript
export type ExecutionPolicy =
  | 'local-safe'
  | 'sandbox-required'
  | 'sandbox-preferred'
  | 'sandbox-heavy'
  | 'persistent-sandbox'
  | 'desktop-required';
```

**`lib/sandbox/types/execution-policy.ts` (NEW - DUPLICATE):**
```typescript
export type ExecutionPolicy =
  | 'local-safe'
  | 'sandbox-required'
  | 'sandbox-preferred'
  | 'sandbox-heavy'
  | 'persistent-sandbox'
  | 'cloud-sandbox';  // Only difference
```

**Issue:** Same type with one additional value (`cloud-sandbox`)

---

### 2. **Duplicate `determineExecutionPolicy()` Function**

**`lib/sandbox/types.ts` (ORIGINAL):**
```typescript
export function determineExecutionPolicy(options: {
  task?: string;
  requiresBash?: boolean;
  requiresFileWrite?: boolean;
  // ...
}): ExecutionPolicy {
  // 150 lines of pattern matching
  // Well-documented with code writing vs execution distinction
}
```

**`lib/sandbox/types/execution-policy.ts` (NEW - DUPLICATE):**
```typescript
export function getExecutionPolicyForTask(task: string, options?: {...}): ExecutionPolicy {
  // Similar logic, less comprehensive
}
```

**Issue:** Same function, different names, original is more comprehensive

---

### 3. **Risk Assessment - NEW Functionality (Not Redundant)**

**`lib/sandbox/types/execution-policy.ts` (NEW - UNIQUE):**
```typescript
export function assessRisk(input: string): RiskAssessment {
  // 20+ risk patterns with severity scoring
  // Returns: level, score, factors, recommendedPolicy, shouldBlock
}
```

**Status:** ✅ **This is NEW functionality not present elsewhere**

---

### 4. **Sandbox Orchestrator vs Existing Components**

| Feature | `sandbox-orchestrator.ts` (NEW) | Existing Files | Status |
|---------|--------------------------------|----------------|--------|
| Provider selection | ✅ | `provider-router.ts` | ❌ **Duplicate** |
| Session management | ✅ | `session-manager.ts` | ❌ **Duplicate** |
| Resource monitoring | ✅ | `resource-monitor.ts` | ❌ **Duplicate** |
| Warm pool | ✅ | **NOWHERE** | ✅ **NEW** |
| Auto-migration | ✅ | `resource-monitor.ts` (recommendations only) | ⚠️ **Partial** |
| Risk assessment | ✅ | **NOWHERE** | ✅ **NEW** |
| Health tracking | ✅ | `provider-router.ts` (latency only) | ⚠️ **Partial** |

---

## ✅ Integration Strategy

### Step 1: Keep `lib/sandbox/types.ts` as Source of Truth

**Action:** Add `cloud-sandbox` policy and risk assessment to existing file

```typescript
// ADD to lib/sandbox/types.ts

// Add new policy
export type ExecutionPolicy =
  | 'local-safe'
  | 'sandbox-required'
  | 'sandbox-preferred'
  | 'sandbox-heavy'
  | 'persistent-sandbox'
  | 'desktop-required'
  | 'cloud-sandbox';  // NEW

// Add risk assessment types
export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  recommendedPolicy: ExecutionPolicy;
  shouldBlock: boolean;
  blockReason?: string;
}

// Add assessRisk function
export function assessRisk(input: string): RiskAssessment {
  // Import from execution-policy.ts or implement here
}
```

---

### Step 2: Deprecate `lib/sandbox/types/execution-policy.ts`

**Action:** Re-export from `lib/sandbox/types.ts` with deprecation notice

```typescript
// lib/sandbox/types/execution-policy.ts

/**
 * @deprecated Use lib/sandbox/types.ts instead
 * This file is kept for backward compatibility only
 */
export {
  ExecutionPolicy,
  RiskAssessment,
  RiskLevel,
  RiskFactor,
  assessRisk,
  getExecutionPolicyForTask,
  // ... all other exports
} from '../types';
```

---

### Step 3: Integrate `sandbox-orchestrator.ts` with Existing Components

**Action:** Rewrite orchestrator to COORDINATE existing components, not replace them

```typescript
// lib/sandbox/sandbox-orchestrator.ts (REVISED)

import { providerRouter } from './provider-router';
import { sessionManager } from '../session/session-manager';
import { resourceMonitor } from '../management/resource-monitor';
import { assessRisk, type ExecutionPolicy } from './types';

export class SandboxOrchestrator {
  // NEW: Warm pool management
  private warmPool = new Map<SandboxProviderType, SandboxHandle[]>();
  
  async getSandbox(options: {
    userId: string;
    conversationId: string;
    task: string;
    policy?: ExecutionPolicy;
  }): Promise<SandboxHandle> {
    // 1. Assess risk (NEW)
    const risk = assessRisk(options.task);
    if (risk.shouldBlock) {
      throw new Error(risk.blockReason);
    }
    
    // 2. Use existing provider-router for selection
    const provider = await providerRouter.selectOptimalProvider({
      type: this.getTaskType(options.task),
      executionPolicy: options.policy || risk.recommendedPolicy,
      // ... other context
    });
    
    // 3. Try warm pool first (NEW)
    const warmSandbox = await this.getFromWarmPool(provider);
    if (warmSandbox) {
      return warmSandbox;
    }
    
    // 4. Use existing session-manager for creation
    const session = await sessionManager.getOrCreateSession(
      options.userId,
      options.conversationId,
      { executionPolicy: options.policy }
    );
    
    return session.sandboxHandle!;
  }
  
  // NEW: Auto-migration based on resource-monitor alerts
  async migrateSession(sessionId: string, reason: string): Promise<void> {
    const metrics = await resourceMonitor.getMetrics(sessionId);
    
    if (metrics.cpuUsage > 80 || metrics.memoryUsage > 90) {
      // Coordinate migration using existing components
      // ...
    }
  }
  
  // NEW: Warm pool management
  private async replenishWarmPool(provider: SandboxProviderType): Promise<void> {
    // Create and maintain warm sandboxes
    // ...
  }
}

export const sandboxOrchestrator = new SandboxOrchestrator();
```

---

### Step 4: Wire `task-router.ts` with Risk Assessment

**Action:** Add risk assessment to task routing

```typescript
// lib/agent/task-router.ts

import { assessRisk } from '../sandbox/types';

export interface TaskRequest {
  // ... existing fields
  executionPolicy?: ExecutionPolicy;
}

class TaskRouter {
  async routeTask(request: TaskRequest): Promise<TaskRoutingResult> {
    // Existing task type detection
    const routing = this.analyzeTask(request.task);
    
    // NEW: Risk assessment
    const risk = assessRisk(request.task);
    
    // Combine routing + risk for policy
    const policy = request.executionPolicy || risk.recommendedPolicy;
    
    return {
      ...routing,
      executionPolicy: policy,
      riskLevel: risk.level,
    };
  }
}
```

---

### Step 5: Wire `provider-router.ts` with Risk-Based Selection

**Action:** Use risk level in provider selection

```typescript
// lib/sandbox/provider-router.ts

import { assessRisk } from './types';

class ProviderRouter {
  async selectOptimalProvider(context: TaskContext): Promise<SandboxProviderType> {
    // Existing selection logic
    
    // NEW: Adjust for risk level
    if (context.riskLevel === 'critical') {
      // Force most isolated provider
      return 'daytona';
    }
    
    if (context.riskLevel === 'high') {
      // Prefer providers with full isolation
      return context.preferredProviders?.[0] || 'e2b';
    }
    
    // ... existing logic
  }
}
```

---

## 📋 File Action Plan

| File | Action | Reason |
|------|--------|--------|
| `lib/sandbox/types.ts` | ✅ **KEEP** - Add risk types | Source of truth |
| `lib/sandbox/types/execution-policy.ts` | ⚠️ **DEPRECATE** - Re-export from types.ts | Duplicate |
| `lib/sandbox/sandbox-orchestrator.ts` | 🔄 **REWRITE** - Coordinate existing | Duplicate logic |
| `lib/sandbox/provider-router.ts` | ✅ **KEEP** - Add risk integration | Provider selection |
| `lib/session/session-manager.ts` | ✅ **KEEP** - Session lifecycle | Session management |
| `lib/management/resource-monitor.ts` | ✅ **KEEP** - Add migration triggers | Resource monitoring |
| `lib/agent/task-router.ts` | 🔄 **UPDATE** - Add risk assessment | Task routing |

---

## 🔧 New Features to Preserve

From the NEW files, these features should be integrated:

### 1. **Risk Assessment** (from `execution-policy.ts`)
- 20+ risk patterns with severity scoring
- Automatic blocking of critical risks
- Policy recommendation based on risk

### 2. **Warm Pool** (from `sandbox-orchestrator.ts`)
- Pre-warmed sandboxes (10s → 300ms)
- Automatic replenishment
- Health checking

### 3. **Auto-Migration** (from `sandbox-orchestrator.ts`)
- Resource threshold triggers
- Provider failure handling
- State preservation during migration

### 4. **Enhanced Health Tracking** (from `sandbox-orchestrator.ts`)
- Failure rate tracking
- Load-based selection
- Automatic degradation

---

## 📊 Integration Diagram

```
┌─────────────────────────────────────────────────────────┐
│              lib/sandbox/types.ts                        │
│  (Source of Truth - Execution Policies + Risk)          │
│  - ExecutionPolicy type                                  │
│  - assessRisk() function                                 │
│  - determineExecutionPolicy()                            │
│  - getExecutionPolicyConfig()                            │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┬────────────────┐
        │            │            │                │
        ▼            ▼            ▼                ▼
┌──────────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐
│provider-router│ │session-  │ │resource-   │ │task-router│
│.ts           │ │manager.ts│ │monitor.ts  │ │.ts       │
│(selection)   │ │(lifecycle)│ │(monitoring)│ │(routing) │
└───────┬──────┘ └────┬─────┘ └─────┬──────┘ └────┬─────┘
        │             │             │              │
        └─────────────┼─────────────┼──────────────┘
                      │             │
                      ▼             ▼
            ┌─────────────────────────────────┐
            │  lib/sandbox/sandbox-orchestrator.ts │
            │  (Coordinator - NEW FEATURES)        │
            │  - Warm pool management              │
            │  - Auto-migration coordination       │
            │  - Risk-based routing                │
            │  - Health tracking                   │
            └─────────────────────────────────────┘
```

---

## ✅ Next Steps

1. **Add risk assessment to `lib/sandbox/types.ts`**
2. **Deprecate `lib/sandbox/types/execution-policy.ts`**
3. **Rewrite `sandbox-orchestrator.ts` to coordinate existing components**
4. **Update `task-router.ts` to use risk assessment**
5. **Update `provider-router.ts` to consider risk level**
6. **Wire `resource-monitor.ts` alerts to trigger migration**

---

*Audit completed: March 2026*
*Recommendation: Integrate, don't replace*
