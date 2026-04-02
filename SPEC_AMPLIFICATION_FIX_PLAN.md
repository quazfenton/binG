# Spec Amplification Timing Fix Plan

## Current Issues

1. **Triggered in wrong scope**: Only runs inside ToolLoopAgent if block (line 2034)
2. **Triggered too early**: Runs before final filesystem edits and done event
3. **No separate message**: Background refinement events mix with original response
4. **Incomplete content check**: Uses `finalContent` which misses post-stream edits

## Required Changes

### 1. Move Spec Amplification Check to After Stream Completion

**Current location (WRONG):**
```typescript
// Line 2034 - INSIDE ToolLoopAgent streaming block
if (shouldRunSpecAmplification) {
  responseRouter.routeWithSpecAmplification(specRequest).catch(...)
}
controller.close();
```

**Should be (CORRECT):**
```typescript
// AFTER all streaming paths complete
// Check if spec amplification should run
const shouldRunSpecAmp = checkSpecAmplificationConditions();
if (shouldRunSpecAmp) {
  // Trigger as SEPARATE request (creates new message bubble)
  triggerSpecAmplificationAsSeparateRequest();
}
```

### 2. Create Separate Message for Spec Amplification

**Problem:** Current implementation streams spec amplification events via `emitRef.current` which mixes them with the original response.

**Solution:** Spec amplification should:
- Run as a completely separate API call
- Create a new assistant message in the UI
- Not mix events with the original response

### 3. Check Code Markers After ALL Parsing Complete

**Current:**
```typescript
const hasCodeMarkers = ['<file_edit', '<file_write', 'WRITE ', '```', '<<<'].some(
  marker => finalContent.includes(marker)
);
```

**Should be:**
```typescript
// Check AFTER final parse and filesystem edits
const finalContent = streamingContentBuffer || unifiedResponse.content || '';
const hasCodeMarkers = checkForCodeMarkers(finalContent);
const hasFileEdits = filesystemEdits && filesystemEdits.applied.length > 0;
const shouldRunSpecAmp = (hasCodeMarkers || hasFileEdits) && isEnhancedMode;
```

### 4. Run Outside ToolLoopAgent Scope

**Current structure:**
```typescript
if (hasToolLoopStreaming) {
  // ... ToolLoopAgent streaming ...
  // Spec amp check HERE (wrong - only runs for ToolLoopAgent)
  if (shouldRunSpecAmplification) { ... }
}
// Regular streaming path has NO spec amp check
```

**Should be:**
```typescript
if (hasToolLoopStreaming) {
  // ... ToolLoopAgent streaming ...
} else if (hasLLMStreamGenerator) {
  // ... Regular LLM streaming ...
}

// AFTER all streaming paths (common code)
const shouldRunSpecAmp = checkSpecAmplificationConditions();
if (shouldRunSpecAmp) {
  triggerSpecAmplificationSeparateRequest();
}
```

## Implementation Steps

1. **Extract spec amplification check to helper function**
2. **Move check to after ALL streaming paths complete**
3. **Ensure it runs for both ToolLoopAgent AND regular LLM streaming**
4. **Make it create a separate message bubble (not stream events)**
5. **Add logging to verify timing**

## Files to Modify

- `app/api/chat/route.ts` - Move spec amp trigger logic
- `lib/api/response-router.ts` - Ensure `routeWithSpecAmplification` creates separate response
- `hooks/use-enhanced-chat.ts` - Handle spec amp as separate message

## Testing

- Verify spec amp only runs after stream completes
- Verify spec amp creates separate message bubble
- Verify spec amp doesn't run for trivial non-code prompts
- Verify spec amp runs for both ToolLoopAgent and regular LLM
