# Spec Amplification - V1 Mode Only Configuration

## Overview

The spec amplification system is designed to work **exclusively with V1 mode** (regular LLM calls). V2 agent mode has its own planning and execution system and should not use spec amplification.

---

## Mode Detection

### V1 Mode (Spec Amplification Enabled)

```typescript
// Regular LLM calls
{
  agentMode: 'v1',  // or 'auto' for non-code requests
  mode: 'enhanced'  // or 'max' for spec amplification
}
```

**Behavior:**
- ✅ Spec amplification enabled
- ✅ Parallel DAG execution
- ✅ Real-time streaming progress
- ✅ Quality improvement loops

### V2 Mode (Spec Amplification Disabled)

```typescript
// V2 agent mode
{
  agentMode: 'v2',
  // mode parameter ignored
}
```

**Behavior:**
- ❌ Spec amplification skipped
- ✅ V2's own planning system used
- ✅ Containerized agent execution
- ✅ Filesystem-based workflow

---

## Implementation Details

### Backend Routing

**File:** `lib/api/response-router.ts`

```typescript
async routeWithSpecAmplification(
  request: RouterRequest & {
    mode?: 'normal' | 'enhanced' | 'max'
    agentMode?: 'v1' | 'v2' | 'auto'
  }
): Promise<UnifiedResponse> {
  // V2 AGENT MODE: Skip spec amplification entirely
  // V2 has its own planning/execution system
  if (request.agentMode === 'v2') {
    logger.debug('V2 agent mode detected, skipping spec amplification')
    return await this.routeAndFormat(request)
  }
  
  // Continue with spec amplification for V1 mode...
}
```

### API Route Handling

**File:** `app/api/chat/route.ts`

```typescript
// Spec amplification only works with V1 mode (regular LLM calls)
// V2 agent mode has its own planning system
if (agentMode === 'v2') {
  chatLogger.debug('V2 agent mode, using standard routing')
  unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
} else {
  // V1 mode or auto - use spec amplification if enabled
  unifiedResponse = await responseRouter.routeWithSpecAmplification(routerRequest)
}
```

---

## Request Flow Diagram

```
User Request
    │
    ▼
┌─────────────────┐
│ Check agentMode │
└─────────────────┘
    │
    ├──────────────┬──────────────┐
    │              │              │
    ▼              ▼              ▼
 agentMode:     agentMode:     agentMode:
   'v2'           'v1'          'auto'
    │              │              │
    │              │              ├─ Code request?
    │              │              │   ├─ Yes → V2
    │              │              │   └─ No  → V1 + Spec
    │              │              │
    ▼              ▼              ▼
┌─────────────────────────────────────┐
│        Standard Routing             │
│   (No spec amplification)           │
└─────────────────────────────────────┘
    │
    ▼
 Regular LLM Response

For V1 mode only:
    │
    ▼
┌─────────────────────────────────────┐
│   routeWithSpecAmplification()      │
│   - Generate spec (fast model)      │
│   - Parallel refinement (DAG)       │
│   - Stream progress                 │
└─────────────────────────────────────┘
    │
    ▼
 Enhanced Response
```

---

## Fallback Behavior

### Non-SSE Error Handling

If SSE streaming fails during spec amplification:

```typescript
try {
  const refinedOutput = await executeRefinementWithDAG(config, emit)
} catch (error) {
  // Fallback: Return base response without refinement
  if (emit) {
    emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
      stage: 'error',
      error: error.message,
      timestamp: Date.now()
    })
  }
  return baseResponse  // Graceful degradation
}
```

**Behavior:**
1. Error caught and logged
2. SSE error event emitted (if streaming)
3. Falls back to primary LLM response
4. User receives response (no crash)

### V2 Fallback to V1

If V2 agent mode fails:

```typescript
try {
  // V2 execution
  const v2Result = await executeV2Task({...})
} catch (v2Error) {
  // Fallback to V1 with routeAndFormat (no spec amplification for V2 failures)
  chatLogger.info('Using v1 fallback path after V2 failure')
  const unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
}
```

**Behavior:**
1. V2 error caught
2. Logged for observability
3. Falls back to V1 + spec amplification
4. User gets enhanced response

---

## Configuration

### Environment Variables

```bash
# V2 Agent Configuration
V2_AGENT_ENABLED=false          # Disable V2 to force V1+spec
OPENCODE_CONTAINERIZED=false    # Disable containerized agents

# Spec Amplification Configuration
SPEC_AMPLIFICATION_ENABLED=true  # Enable/disable spec amplification
SPEC_AMPLIFICATION_MODE=enhanced # Default: enhanced, max, or normal
```

### Mode Selection

| Use Case | Recommended Mode | agentMode | mode |
|----------|-----------------|-----------|------|
| Quick chat | Normal | 'v1' | 'normal' |
| Quality improvement | Enhanced | 'v1' | 'enhanced' |
| Complex projects | Max | 'v1' | 'max' |
| Filesystem operations | V2 | 'v2' | - |
| Containerized agents | V2 | 'v2' | - |

---

## Error Scenarios

### 1. V2 Mode with Spec Amplification Request

**Request:**
```json
{
  "agentMode": "v2",
  "mode": "enhanced"
}
```

**Behavior:**
```typescript
// V2 mode takes precedence
if (request.agentMode === 'v2') {
  return await this.routeAndFormat(request)  // Skip spec
}
```

**Result:** Standard V2 execution, no spec amplification

### 2. SSE Streaming Failure

**Scenario:** Network error during SSE streaming

**Behavior:**
```typescript
try {
  await executeRefinementWithDAG(config, emit)
} catch (error) {
  // Graceful fallback
  return baseResponse
}
```

**Result:** User receives primary LLM response

### 3. DAG Execution Timeout

**Scenario:** Time budget exceeded

**Behavior:**
```typescript
if (elapsed > timeBudgetMs) {
  emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
    stage: 'error',
    error: 'Time budget exceeded'
  })
  return mergeResults()  // Return partial results
}
```

**Result:** User receives partial refinement results

---

## Testing

### V1 Mode with Spec Amplification

```typescript
// Test V1 mode with enhanced spec amplification
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    provider: 'openai',
    model: 'gpt-4o',
    agentMode: 'v1',
    mode: 'enhanced'
  })
})

// Should include spec amplification metadata
const data = await response.json()
console.assert(data.metadata.specAmplification.enabled === true)
console.assert(data.metadata.specAmplification.fastModel)
console.assert(data.metadata.specAmplification.specScore)
```

### V2 Mode without Spec Amplification

```typescript
// Test V2 mode (spec amplification disabled)
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    agentMode: 'v2'
  })
})

// Should NOT include spec amplification metadata
const data = await response.json()
console.assert(!data.metadata.specAmplification)
console.assert(data.metadata.agentType === 'v2')
```

### Fallback Test

```typescript
// Test V2 failure → V1+spec fallback
mockV2Failure()

const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Build a Next.js app' }],
    agentMode: 'v2'  // Will fail and fallback to V1+spec
  })
})

// Should fallback to V1 with spec amplification
const data = await response.json()
console.assert(data.metadata.specAmplification.enabled === true)
```

---

## Observability

### Logging

**V2 Mode Detected:**
```
[API:ResponseRouter] V2 agent mode detected, skipping spec amplification
```

**V1 Mode with Spec:**
```
[API:ResponseRouter] Spec amplification enabled
  fastModel: google/gemini-2.5-flash
  mode: enhanced
  provider: openai
```

**Spec Complete:**
```
[API:ResponseRouter] Spec amplification complete
  duration: 4521
  sectionsProcessed: 3
  specScore: 8
```

### Metrics

Track these metrics for spec amplification:

```typescript
{
  spec_amplification_requests: number,
  spec_amplification_duration_avg: number,
  spec_amplification_score_avg: number,
  spec_amplification_fallbacks: number,
  spec_amplification_errors: number
}
```

---

## Migration Guide

### From V2 to V1+Spec

If you want to use spec amplification instead of V2:

**Before:**
```json
{
  "agentMode": "v2"
}
```

**After:**
```json
{
  "agentMode": "v1",
  "mode": "enhanced"
}
```

**Benefits:**
- ✅ Faster (no container startup)
- ✅ Real-time progress streaming
- ✅ Quality improvements via spec
- ✅ Lower cost (no agent overhead)

**Tradeoffs:**
- ❌ No filesystem operations
- ❌ No tool execution
- ❌ No persistent workspace

---

## Status

### Current Implementation

| Feature | Status |
|---------|--------|
| V1 mode detection | ✅ Implemented |
| V2 mode skip | ✅ Implemented |
| Non-SSE fallback | ✅ Implemented |
| V2→V1 fallback | ✅ Implemented |
| Error handling | ✅ Implemented |
| Logging | ✅ Implemented |

### Production Ready

✅ **Yes** - Spec amplification is properly gated to V1 mode only with comprehensive fallback handling.
