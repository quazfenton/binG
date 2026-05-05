# Analysis: LLM Premature Stopping - Root Causes & Fix Plan

**Date**: 2026-05-05  
**Thread**: T-019df614-8ff0-735d-b688-fff425f54901

---

## Executive Summary

The LLM returned structured `[ROLE_SELECT]` JSON blocks but the system failed to:
1. **Parse** the routing metadata correctly
2. **Auto-continue** multi-step flows via `stepReprompt`
3. **Handle** tool validation failures with self-healing
4. **Detect** empty/malformed tool calls and retry

---

## Issue 1: ROLE_SELECT Not Parsed from Response

### Problem
The LLM returned:
```
[ROLE_SELECT]
{
  "classification": "multi-step",
  "complexity": "high",
  "suggestedRole": "architect",
  "planSteps": [...],
  "continue": true
}
```

But this was shown **raw in the frontend** instead of being parsed and used to trigger the next step.

### Root Cause
Looking at `unified-agent-service.ts:2524-2543`, the routing IS being parsed:

```typescript
const parsedRouting: ParsedRouting = parseFirstResponseRouting(firstResponseContent || content);
if (parsedRouting.found && parsedRouting.routing) {
  (config as any)._roleSelectMetadata = parsedRouting.routing;
  
  if (parsedRouting.routing.continue && parsedRouting.routing.planSteps.length > 0) {
    (config as any)._stepReprompt = generateStepReprompt(parsedRouting.routing, 0);
  }
}
```

**However**, `_stepReprompt` is set on the server-side `config` object but **NOT transmitted to the client** in the response metadata.

### Fix Location
`web/lib/orchestra/unified-agent-service.ts` around line 2570-2600 (result building section)

**Current code** (lines ~2496-2502):
```typescript
roleSelection: (config as any)._roleSelectMetadata ? {
  classification: (config as any)._roleSelectMetadata.classification,
  complexity: (config as any)._roleSelectMetadata.complexity,
  suggestedRole: (config as any)._roleSelectMetadata.suggestedRole,
  specializationRoute: (config as any)._roleSelectMetadata.specializationRoute,
  planSteps: (config as any)._roleSelectMetadata.planSteps?.length || 0,
  continue: (config as any)._roleSelectMetadata.continue,
} : undefined,
```

**Missing**: `stepReprompt` field!

---

## Issue 2: Client Not Receiving stepReprompt

### Problem
Client expects `doneMetadata?.routing?.stepReprompt` (line 1192 of `use-enhanced-chat.ts`):

```typescript
const stepReprompt = doneMetadata?.routing?.stepReprompt;
if (stepReprompt && typeof stepReprompt === 'string' && stepReprompt.trim() && ...) {
  console.log('[StepReprompt] Auto-continuing multi-step flow', ...);
  // Auto-send reprompt
}
```

But the server returns it under `roleSelection`, not `routing`:

```typescript
// Server sends:
metadata: {
  roleSelection: { classification, suggestedRole, ... }  // ← Missing stepReprompt
}

// Client expects:
metadata: {
  routing: {
    stepReprompt: "...",
    primaryRole: "...",
    ...
  }
}
```

### Root Cause
**Mismatch between server response schema and client expectation.**

The `buildRoutingMetadataForClient()` function exists in `first-response-routing.ts:299-320` and generates the correct shape:

```typescript
export function buildRoutingMetadataForClient(routing: RoutingMetadata): {
  stepReprompt: string;
  primaryRole: string;
  estimatedSteps: number;
  classification: TaskClassification;
  complexity: TaskComplexity;
  specializationRoute: SpecializationRoute;
  planSteps: PlanStep[];
  continue: boolean;
}
```

**But it's NEVER called in the unified-agent-service result building!**

---

## Issue 3: Empty Tool Arguments Not Self-Healing

### Problem
Log shows:
```
[TOOL-CALL] ✗ VALIDATION failed — blocking execution
{
  toolCallId: 'chatcmpl-tool-99a461c9096b2c60',
  toolName: 'batch_write',
  validationError: {
    code: 'INVALID_ARGS',
    message: 'Missing required arguments for batch_write: files',
    retryable: true
  }
}
```

The validation correctly flags `retryable: true`, but then:
- **Response returns empty** (responseLength: 0)
- **No auto-retry with feedback** happens
- **Self-healing mechanisms not triggered**

### Root Cause Chain

1. **Tool validation fails** → logged but execution blocked
2. **No tool results** → `toolInvocations: 1` but `0✓/1✗`
3. **Response is empty** → `responseLength: 0`
4. **Empty response detection** in client (line 813-842):
   ```typescript
   const isEmptyResponse = !doneContent.trim() && !hasToolInvocations && !hasFileSystemEdits;
   ```
   But `hasToolInvocations` is TRUE (failed tool call still counted), so `isEmptyResponse` is FALSE!

5. **Self-healing not triggered** because:
   - `feedback-injection.ts` requires **failures to be added to FeedbackContext**
   - No code adds the validation failure to `feedbackContext.recentFailures`

### Missing Code
In `vfs-mcp-tools.ts`, when validation fails, we return an error object:

```typescript
return {
  success: false,
  error: {
    code: 'INVALID_ARGS',
    message: 'Missing required arguments...',
    retryable: true,
    ...
  }
};
```

**But this error is NOT captured and fed into the feedback system!**

---

## Issue 4: Feedback Injection Never Activates

### Problem
`feedback-injection.ts` has comprehensive healing logic:

- `detectHealingTrigger()` - detects loops, failures, truncation
- `generateHealingPrompt()` - builds retry prompt with context
- `injectFeedback()` - generates correction sections

**But this is NEVER used to auto-retry failed tool calls.**

### Where It's Used
- `unified-agent-service.ts:2422` - calls `detectHealingTrigger()` but only for logging
- `unified-agent-service.ts:2423` - calls `injectFeedback()` but result not used to retry

```typescript
const healingTrigger = detectHealingTrigger(feedbackContext, content, freshTracker.consecutiveToolCalls);
const injectedFeedback = injectFeedback(feedbackContext);

(config as any)._injectedFeedback = injectedFeedback;  // ← Just attached to config, never used!
```

### What Should Happen
When a tool fails with `retryable: true`:

1. Add failure to `feedbackContext.recentFailures`
2. Call `generateHealingPrompt()` 
3. Auto-retry with corrected context
4. OR return error to client with `requiresRetry: true` flag

---

## Issue 5: IndexedDB Clearing Spuriously

### Problem
```
[browser] [useVFS WARN] OPFS: Failed to clear IndexedDB: IndexedDBError: IndexedDB not initialized
```

### Root Cause
`use-virtual-filesystem.ts:350-386` - Logic checks if `lastOwnerId !== opfsOwnerId`:

```typescript
const lastOwnerId = localStorage.getItem(LAST_OPFS_KEY);
if (lastOwnerId && lastOwnerId !== opfsOwnerId) {
  // Clear VFS for security
  await indexedDBBackend.clear(lastOwnerId);  // ← Throws if not initialized
}
```

**Problem**: If user refreshes or revisits without logging out, `opfsOwnerId` may not be set yet when this runs, causing spurious clears.

### Fix
Add initialization check:

```typescript
if (lastOwnerId && lastOwnerId !== opfsOwnerId && lastOwnerId !== 'anonymous') {
  // Don't clear if backend not initialized
  try {
    await indexedDBBackend.ensureInitialized();
    await indexedDBBackend.clear(lastOwnerId);
  } catch (e) {
    logWarn('OPFS: Skipping clear - backend not initialized');
  }
}
```

---

## Issue 6: Continue=false Stopping Flow

### Problem
LLM returns:
```json
{
  "classification": "code",
  "continue": false,
  "planSteps": []
}
```

This signals "I'm done planning, hand off to coder role" but the system interprets it as "stop everything."

### Expected Behavior
When `continue: false` but `planSteps` has items → **auto-redirect to suggested role** with context.

### Current Behavior
Nothing happens - thread stops.

### Fix
In `use-enhanced-chat.ts` around line 1215, add role redirect logic:

```typescript
// After stepReprompt handling
if (!stepReprompt && parsedRouting.routing && !parsedRouting.routing.continue) {
  const { suggestedRole, roleOptions, planSteps } = parsedRouting.routing;
  
  if (planSteps && planSteps.length > 0 && suggestedRole) {
    // Role redirect: start new turn with role-specific context
    console.log('[RoleRedirect] Switching to role:', suggestedRole);
    
    const rolePrompt = `[ROLE_REDIRECT]\nTarget Role: ${suggestedRole}\nTask: Execute the planned steps.\n\nAvailable steps:\n${planSteps.map((s, i) => `${i+1}. ${s.step} (${s.tool})`).join('\n')}\n\nBegin execution with step 1.`;
    
    inputQueue.push(rolePrompt);
  }
}
```

---

## Issue 7: Tool Validation Failure Not Retried

### Problem
`batch_write` called with **empty files array** → validation fails → returns error → **LLM never retries.**

### Root Cause
The validation in `vfs-mcp-tools.ts:1459-1467` correctly returns error:

```typescript
if (!filesArray || !Array.isArray(filesArray) || filesArray.length === 0) {
  return {
    success: false,
    error: 'No files provided to batch_write',
    results: [],
  };
}
```

**But this error is swallowed** - it doesn't trigger:
1. Feedback injection
2. Self-healing retry
3. Auto-reprompt with corrected instructions

### Solution
In unified-agent service, when tool result has `success: false`:

```typescript
if (toolResult.success === false && toolResult.error?.retryable) {
  // Add to feedback context
  const failureEntry = createFeedbackEntry(
    'failure',
    `Tool ${toolName} failed: ${toolResult.error.message}`,
    'tool_execution',
    { toolName, error: toolResult.error, args: toolArgs },
    'high'
  );
  feedbackContext = addFeedback(feedbackContext, failureEntry);
  
  // Generate retry prompt
  const healingPrompt = generateHealingPrompt(
    detectHealingTrigger(feedbackContext, '', 0),
    feedbackContext,
    config.userMessage
  );
  
  // Auto-retry with healing context
  // OR return to client with retry flag
}
```

---

## Fix Implementation Plan

### Priority 1: Fix ROLE_SELECT → stepReprompt Flow

**File**: `web/lib/orchestra/unified-agent-service.ts`

**Changes**:
1. Import `buildRoutingMetadataForClient`
2. Replace manual roleSelection object with function call
3. Ensure `routing` field (not `roleSelection`) is populated in metadata

**Location**: Lines 2496-2502 and similar metadata building sections

### Priority 2: Wire Feedback Injection to Tool Failures

**File**: `web/lib/orchestra/unified-agent-service.ts`

**Changes**:
1. After each tool execution, check if `success === false`
2. If `retryable: true`, add to `feedbackContext.recentFailures`
3. Call `generateHealingPrompt()` if healing detected
4. Either auto-retry OR return error with `requiresRetry: true` in metadata

**Location**: `runV1ApiWithTools` function around line 1850-1900 (tool execution loop)

### Priority 3: Client Auto-Retry on Empty Response

**File**: `web/hooks/use-enhanced-chat.ts`

**Changes**:
1. Fix `isEmptyResponse` detection - count only SUCCESSFUL tool invocations
2. If `isEmptyResponse && metadata.requiresRetry`, auto-retry
3. If `metadata.routing.stepReprompt`, auto-send

**Location**: Lines 803-842 (done event handler)

### Priority 4: Fix IndexedDB Spurious Clear

**File**: `web/hooks/use-virtual-filesystem.ts`

**Changes**:
1. Add backend initialization check before clear
2. Skip clear for 'anonymous' or undefined owners

**Location**: Lines 350-386

### Priority 5: Add Role Redirect Auto-Continue

**File**: `web/hooks/use-enhanced-chat.ts`

**Changes**:
1. After done event, check if routing has `continue: false` with planSteps
2. Auto-send role redirect prompt

**Location**: After line 1215

---

## Test Cases

### Test 1: ROLE_SELECT Parsing
```typescript
const response = `
Here's the plan:

[ROLE_SELECT]
{
  "classification": "multi-step",
  "planSteps": [
    {"step": "Create file", "tool": "write_file", "role": "coder"}
  ],
  "continue": true
}
`;

// Expected:
// 1. Response shown WITHOUT [ROLE_SELECT] block
// 2. Auto-reprompt sent: "[AUTO-REPROMPT] Current Step: Create file..."
// 3. Next LLM call executes the step
```

### Test 2: Tool Validation Failure Auto-Retry
```typescript
// LLM calls: batch_write(files=[])
// System detects validation error
// System auto-retries with feedback: "batch_write requires non-empty files array"

// Expected: LLM corrects the call
```

### Test 3: Empty Response Detection
```typescript
// LLM returns: tool call with invalid args → validation fails → empty response
// System detects: !doneContent && failedToolCalls > 0 && !hasFileSystemEdits
// System auto-retries with healing prompt
```

---

## Files to Modify

1. `web/lib/orchestra/unified-agent-service.ts` - Fix metadata building, wire feedback
2. `web/hooks/use-enhanced-chat.ts` - Fix empty response detection, auto-retry
3. `web/hooks/use-virtual-filesystem.ts` - Fix IndexedDB clear
4. `web/lib/mcp/vfs-mcp-tools.ts` - Ensure retryable errors have correct structure
5. `web/app/api/chat/route.ts` - Ensure routing metadata passed through in SSE

---

## Validation Commands

```bash
# Run tests
pnpm test packages/shared/agent/__tests__/first-response-routing.test.ts

# Run type check
pnpm exec tsc --noEmit

# Run build
pnpm build
```

---

## Next Steps

1. ✅ Analysis complete
2. ⏳ Implement fixes (starting with Priority 1)
3. ⏳ Write test cases
4. ⏳ Manual testing
5. ⏳ Commit with comprehensive message

