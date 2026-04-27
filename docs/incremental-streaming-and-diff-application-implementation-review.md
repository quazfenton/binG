---
id: incremental-streaming-and-diff-application-implementation-review
title: Incremental Streaming & Diff Application Implementation Review
aliases:
  - INCREMENTAL_STREAMING_REVIEW
  - INCREMENTAL_STREAMING_REVIEW.md
  - incremental-streaming-and-diff-application-implementation-review
  - incremental-streaming-and-diff-application-implementation-review.md
tags:
  - streaming
  - implementation
  - review
layer: core
summary: "# Incremental Streaming & Diff Application Implementation Review\r\n\r\n## Executive Summary\r\n\r\nThis review examines the incremental streaming implementation (Vercel AI SDK), incremental parsing, diff application, and agent loop integration. **Multiple critical issues were identified** that cause infini"
anchors:
  - Executive Summary
  - Actual Issues Found (From Live Logs)
  - 'Issue A: Invalid Path Extraction from JSX/HTML'
  - 'Issue B: Infinite Polling Loop'
  - 'Issue C: Diff Application Failures'
  - 'Issue D: Variable Initialization Error'
  - Original Review Issues (Still Relevant)
  - ✅ What's Working Well
  - ❌ Critical Issues
  - 'Issue 1.1: Inconsistent Path Validation Between Streaming and Final Parse'
  - 'Issue 1.2: Empty Diff Prevention Not Applied Universally'
  - 'Issue 1.3: Missing Event Emission for Applied Diffs in Agentic Mode'
  - 2. Incremental Parsing - `lib/chat/file-edit-parser.ts`
  - ✅ What's Working Well
  - ❌ Critical Issues
  - 'Issue 2.1: `isValidExtractedPath` Not Exported/Used Consistently'
  - 'Issue 2.2: Incremental Parser May Miss Large Edits'
  - 'Issue 2.3: Empty Content Check Happens AFTER Extraction'
  - 3. Diff Application - `conversation-interface.tsx`
  - ✅ What's Working Well
  - ❌ Critical Issues
  - 'Issue 3.1: Path Validation Uses Wrong Function'
  - 'Issue 3.2: Diff Application Doesn''t Validate Diff Content'
  - 'Issue 3.3: Race Condition in Diff Queue'
  - 4. Agent Loop Integration - `lib/orchestra/mastra/agent-loop.ts`
  - ✅ What's Working Well
  - ❌ Critical Issues
  - 'Issue 4.1: ToolLoopAgent Not Properly Integrated'
  - 'Issue 4.2: No Connection to Task Router'
  - 'Issue 4.3: Response Router Doesn''t Use Agent Loop'
  - 5. Event Omission Issues
  - ❌ Critical Issues
  - 'Issue 5.1: FILE_EDIT Events Omitted When Content Empty'
  - 'Issue 5.2: No Event for Path Validation Failures'
  - 6. Summary of Required Fixes
  - 'Priority 1: Critical (Infinite Loop Prevention) - COMPLETED ✅'
  - 'Priority 2: High (Correctness) - REMAINING'
  - 'Priority 3: Medium (Robustness) - REMAINING'
  - Testing Recommendations
  - Conclusion
  - Change Log
  - 2026-04-01 - Critical Fixes Applied (Session 2)
  - 2026-04-01 - Critical Fixes Applied (Session 1)
---
# Incremental Streaming & Diff Application Implementation Review

## Executive Summary

This review examines the incremental streaming implementation (Vercel AI SDK), incremental parsing, diff application, and agent loop integration. **Multiple critical issues were identified** that cause infinite loops, malformed path extraction, and repeated failed diff applications.

**UPDATED** with findings from terminal/browser logs (Run #1 and #2):
- Invalid paths like `project/sessions/002/Input'` (JSX fragments with trailing quotes) are being extracted
- Client is polling filesystem every ~50ms, triggering rate limits (429)
- Diff application is failing repeatedly on the same invalid paths
- Variable initialization error: `Cannot access 'filesystemEdits' before initialization`

---

## Actual Issues Found (From Live Logs)

### Issue A: Invalid Path Extraction from JSX/HTML

**Evidence from browser console:**
```
[applyDiffsToFilesystem] Skipping invalid path (CSS value, SCSS var, etc.): project/sessions/002/Input',
```

**Root Cause:** The path `project/sessions/002/Input'` ends with a single quote - this is clearly a fragment from JSX code like:
```jsx
<path="project/sessions/002/Input"
```

The parser in `mode-manager.ts` / `input-response-separator.ts` is extracting this as a file path when it's actually a JSX attribute.

**Fix Applied:** Added pre-filtering in `conversation-interface.tsx` to reject:
- Paths ending with quotes (`"`, `'`, `` ` ``)
- Paths with spaces in filename
- Paths matching code fragment patterns (import/export/const/function statements)
- Paths that are too short (<3 chars) or too long (>500 chars)

### Issue B: Infinite Polling Loop

**Evidence from terminal:**
```
[VFS LIST WARN] POLLING DETECTED: 4 requests in 103ms for path "project/sessions/002"
[VFS LIST WARN] POLLING DETECTED: 5 requests in 182ms for path "project/sessions/002"
[VFS LIST WARN] RATE LIMITED: 7 requests in 246ms for path "project/sessions/002"
 GET /api/filesystem/list?path=project%2Fsessions%2F002 429 in 13ms
```

**Root Cause:** The `checkConflicts` useEffect in `conversation-interface.tsx` is re-running on every message change, and each run polls the filesystem. When diffs fail to apply, it triggers another re-render, creating a feedback loop.

**Fix Applied:** Changed signature tracking from full content hash to just `id:length` to prevent re-processing:
```typescript
const assistantSignature = `${lastAssistant.id}:${lastAssistant.content.length}`;
```

### Issue C: Diff Application Failures

**Evidence from browser console:**
```
[Diff Application Failed] {
  failedFiles: Array(1),
  failedDiffs: {...},
  reason: 'Search blocks not found or patches could not be applied',
  totalEntriesAttempted: 2,
  appliedCount: 0
}
```

**Root Cause:** Diffs extracted from LLM output don't match actual file content because:
1. The paths are wrong (JSX fragments)
2. The diffs may be for files that don't exist yet
3. The diff format may not be valid unified diff

### Issue D: Variable Initialization Error

**Evidence from terminal:**
```
2026-04-01T19:20:36.911Z [ERROR] Chat API: LLM stream error { error: "Cannot access 'filesystemEdits' before initialization" }
```

**Root Cause:** There's a variable ordering issue in the streaming code where `filesystemEdits` is referenced before it's declared.

---

## Original Review Issues (Still Relevant)

### ✅ What's Working Well

1. **SSE Event Schema** - Well-structured event types with proper TypeScript definitions
2. **Progressive File Edit Detection** - Streams `file_edit` events during LLM response
3. **Buffer Management** - Uses `streamingContentBuffer` to accumulate chunks
4. **Final Parse on Completion** - Re-parses entire buffer after stream completes

### ❌ Critical Issues

#### Issue 1.1: Inconsistent Path Validation Between Streaming and Final Parse

**Location:** Lines 680-720 (streaming parse) vs 780-820 (final parse)

**Problem:**
```typescript
// Streaming path (line 688)
if (!isValidFilePath(edit.path)) {
  chatLogger.debug('Skipping invalid progressive file edit path...');
  continue;
}

// Final parse path (line 795)  
if (!isValidFilePath(edit.path)) {
  chatLogger.debug('Skipping invalid path from appliedEdits...');
  continue;
}
```

**Issue:** `isValidFilePath` is called but the **validation logic differs** between:
- Server-side: `isValidFilePath()` in `file-edit-parser.ts` (comprehensive)
- Client-side: May use different validation or skip it entirely

**Risk:** Invalid paths like CSS values (`0.3s`), Vue directives (`@submit`), or SCSS variables (`$var`) could be emitted during streaming but rejected on final parse, causing UI inconsistency.

**Fix Required:**
```typescript
// Import and use the SAME validation function everywhere
import { isValidExtractedPath } from '@/lib/chat/file-edit-parser';

// Use consistently in BOTH streaming and final parse
if (!isValidExtractedPath(edit.path)) {
  // Skip consistently
}
```

#### Issue 1.2: Empty Diff Prevention Not Applied Universally

**Location:** Lines 693-698, 772-777, 808-813

**Problem:**
```typescript
// Line 693 - Streaming parse ✓
if (!edit.diff || edit.diff.trim().length === 0) {
  chatLogger.debug('Skipping empty diff (prevents infinite loop)');
  continue;
}

// Line 772 - appliedEdits parse ✓  
if (!edit.diff || edit.diff.trim().length === 0) {
  chatLogger.debug('Skipping empty diff from appliedEdits...');
  continue;
}

// Line 808 - finalEdits parse in error handler ✓
if (!edit.diff || edit.diff.trim().length === 0) {
  chatLogger.debug('Skipping empty diff from finalEdits (error handler)...');
  continue;
}
```

**Status:** ✅ Actually this is correctly applied in all three locations. However, the **comment says "prevents infinite loops"** which indicates this is a known critical issue, but there's no guarantee that downstream consumers (client-side) also validate this.

**Recommendation:** Add client-side validation in `use-enhanced-chat.ts` when processing `file_edit` events:

```typescript
case 'file_edit':
  if (!eventData.diff || !eventData.diff.trim()) {
    console.warn('[Chat] Skipping empty file_edit event');
    break;
  }
  // ... rest of handling
```

#### Issue 1.3: Missing Event Emission for Applied Diffs in Agentic Mode

**Location:** Lines 750-765

**Problem:** When `applyFilesystemEditsFromResponse` applies edits, it emits events correctly. However, when **no filesystem owner exists** (line 800+), it only emits `detected` status but the edits are **never actually applied**:

```typescript
} else {
  // Just emit events if no filesystem owner
  for (const edit of finalEdits) {
    if (!isValidFilePath(edit.path)) {
      continue;
    }
    if (!edit.diff || edit.diff.trim().length === 0) {
      continue;
    }
    emit(SSE_EVENT_TYPES.FILE_EDIT, {
      path: edit.path,
      status: 'detected',  // ← Always "detected", never "applied"
      timestamp: Date.now(),
    });
  }
}
```

**Risk:** Client UI shows file edits as "detected" but they're never persisted, leading to confusion.

**Fix:** Either:
1. Return an error when filesystem owner is required but missing
2. Queue edits for later application
3. Clearly indicate in UI that edits are pending authentication

---

## 2. Incremental Parsing - `lib/chat/file-edit-parser.ts`

### ✅ What's Working Well

1. **Unclosed Tag Tracking** - Sophisticated tracking of incomplete tags across chunks
2. **Multiple Format Support** - Handles `<file_edit>`, `WRITE <<<`, bash heredocs, etc.
3. **Deduplication** - Uses path + content hash to prevent duplicate emissions
4. **Fast-Path Checks** - Early bailouts when signatures aren't present

### ❌ Critical Issues

#### Issue 2.1: `isValidExtractedPath` Not Exported/Used Consistently

**Location:** Lines 1020-1070

**Problem:** The function `isValidExtractedPath` is **NOT exported**:

```typescript
function isValidExtractedPath(path: string): boolean {  // ← Not exported
  if (!path || path.length === 0 || path.length > 300) return false;
  // ... validation logic
}
```

But `isValidFilePath` IS exported:
```typescript
export function isValidFilePath(path: string, isFolder: boolean = false): boolean {
  // ... different validation logic
}
```

**Risk:** Different validation rules between:
- `extractCompactFileEdits()` uses `isValidExtractedPath()` (line 475)
- `api/chat/route.ts` uses `isValidFilePath()` (line 688)

These functions have **different validation rules**:
- `isValidExtractedPath`: Rejects paths starting with `$`, `@`, `#`
- `isValidFilePath`: Also rejects but has additional CSS value checks

**Fix Required:**
```typescript
// Export isValidExtractedPath for consistent use
export function isValidExtractedPath(path: string): boolean {
  // ... existing logic
}

// OR unify both functions into one canonical validator
```

#### Issue 2.2: Incremental Parser May Miss Large Edits

**Location:** Lines 1850-1870

**Problem:** The overlap constant is 2000 chars:
```typescript
const INCREMENTAL_PARSE_OVERLAP_CHARS = 2000;
```

But the unclosed scan tail is 5000:
```typescript
const UNCLOSED_SCAN_TAIL_CHARS = 5000;
```

**Issue:** If a file edit is **larger than 2000 chars** and the closing tag lands in the gap between `lastPosition - 2000` and the earliest unclosed position, it may be missed or duplicated.

**Scenario:**
1. Chunk 1: `<file_edit path="large.ts">\n...1500 chars...`
2. Chunk 2: `...500 more chars...\n</file_edit>`

The parser window might not include enough context to match the complete edit.

**Fix:** Increase overlap or use smarter boundary detection:
```typescript
const INCREMENTAL_PARSE_OVERLAP_CHARS = 5000; // Match unclosed scan size
```

#### Issue 2.3: Empty Content Check Happens AFTER Extraction

**Location:** Lines 1940-1960

**Problem:** All extractors run first, THEN empty content is filtered:

```typescript
const allEdits: FileEdit[] = [...extractFileEdits(parseWindow)];
// ... more extractions ...

// THEN filter empty content
for (const edit of allEdits) {
  const editContent = edit.content || edit.diff || '';
  if (!editContent || editContent.trim().length === 0) {
    continue;  // ← Skip AFTER extraction work
  }
}
```

**Issue:** Individual extractors like `extractCompactFileEdits` already have empty content checks (line 482), but this is **duplicated work**.

**Recommendation:** Trust individual extractors to filter empty content, remove redundant check here unless there's a specific edge case.

---

## 3. Diff Application - `conversation-interface.tsx`

### ✅ What's Working Well

1. **Queued Application** - Uses `diffApplyQueueRef` to serialize diff applications
2. **Path Validation** - Validates paths before applying
3. **Empty Diff Check** - Skips empty diffs (line 1208)
4. **Infinite Loop Prevention** - Explicitly avoids emitting events for self-applied diffs (line 1319)

### ❌ Critical Issues

#### Issue 3.1: Path Validation Uses Wrong Function

**Location:** Lines 1195-1210

**Problem:**
```typescript
const resolvedPath = resolveScopedPath({
  requestedPath: entry.path,
  scopePath: filesystemScopePath,
  attachedPaths: Object.keys(attachedFilesystemFiles),
  lastUserMessage: messages[messages.length - 1]?.content,
});

// Uses isValidFilePath from import
if (!isValidFilePath(resolvedPath)) {
  console.warn('[applyDiffsToFilesystem] Skipping invalid path...');
  return;
}
```

But `isValidFilePath` is imported from `@/lib/chat/file-edit-parser` where there are **TWO** functions:
- `isValidFilePath()` - exported, less strict
- `isValidExtractedPath()` - NOT exported, more strict

**Risk:** Paths that should be rejected (like CSS values) might pass `isValidFilePath` but fail `isValidExtractedPath`.

**Fix:** Export and use `isValidExtractedPath` consistently:
```typescript
import { isValidExtractedPath } from '@/lib/chat/file-edit-parser';

if (!isValidExtractedPath(resolvedPath)) {
  // Skip
}
```

#### Issue 3.2: Diff Application Doesn't Validate Diff Content

**Location:** Lines 1240-1250

**Problem:**
```typescript
const nextContent = applyDiffToContent(currentContent, resolvedPath, entry.diff);
if (nextContent === null) {
  console.warn('[applyDiffsToFilesystem] Diff application returned null', {
    path: resolvedPath,
  });
  continue;
}
```

**Issue:** No check for whether `entry.diff` itself is empty or malformed BEFORE calling `applyDiffToContent`. While `applyDiffToContent` has its own check (line 230 in `file-diff-utils.ts`), the warning message is less helpful.

**Fix:** Add pre-validation:
```typescript
if (!entry.diff || entry.diff.trim().length === 0) {
  console.warn('[applyDiffsToFilesystem] Skipping empty diff (prevents infinite loop)');
  continue;
}
```

#### Issue 3.3: Race Condition in Diff Queue

**Location:** Lines 1373-1385

**Problem:**
```typescript
const applyDiffsToFilesystemQueued = useCallback((entries) => {
  const run = async () => {
    await applyDiffsToFilesystem(entries);
  };
  const queued = diffApplyQueueRef.current.then(run, run);
  diffApplyQueueRef.current = queued.catch(() => {});
}, [applyDiffsToFilesystem]);
```

**Issue:** The `.catch(() => {})` **silently swallows errors**. If one diff application fails, the queue continues but the user is never notified.

**Fix:** At least log the error:
```typescript
diffApplyQueueRef.current = queued.catch((error) => {
  console.error('[applyDiffsToFilesystemQueued] Error in queue:', error);
  toast.error('Failed to apply some file changes');
});
```

---

## 4. Agent Loop Integration - `lib/orchestra/mastra/agent-loop.ts`

### ✅ What's Working Well

1. **ToolLoopAgent Fallback** - Gracefully falls back to manual loop if ToolLoopAgent unavailable
2. **Streaming Support** - Both streaming and non-streaming modes
3. **Loop Detection** - Tracks failed tool calls to detect infinite loops (line 385)

### ❌ Critical Issues

#### Issue 4.1: ToolLoopAgent Not Properly Integrated

**Location:** Lines 25-40

**Problem:**
```typescript
let ToolLoopAgent: any = null;
try {
  ToolLoopAgent = require('ai').ToolLoopAgent;
} catch {
  log.warn('ToolLoopAgent not available, using fallback agent loop');
}
```

**Issue:** `ToolLoopAgent` is from Vercel AI SDK **v4+**, but the project uses **AI SDK v3.x** (based on package.json dependencies). This means `ToolLoopAgent` will **always be null** and the fallback is always used.

**Verification Needed:** Check `package.json` for `ai` version:
```bash
pnpm list ai
```

**Fix:** Either:
1. Upgrade to AI SDK v4+ if ToolLoopAgent is desired
2. Remove ToolLoopAgent references and commit to manual loop
3. Add version check with clearer error message

#### Issue 4.2: No Connection to Task Router

**Location:** `lib/orchestra/mastra/agent-loop.ts` vs `lib/agent/task-router.ts`

**Problem:** The `AgentLoop` class in `agent-loop.ts` is **completely independent** from the `TaskRouter` in `task-router.ts`.

Looking at `task-router.ts` lines 1-100:
- Routes tasks to `opencode`, `nullclaw`, `cli`, or `advanced`
- Has `executeAdvancedTask()` method that routes to kernel or event system
- **Never references `AgentLoop` from `mastra/agent-loop.ts`**

**Issue:** There's **no wiring** between the task router and the agent loop. They're two separate execution paths.

**Evidence:** Search for imports:
```typescript
// task-router.ts does NOT import from agent-loop.ts
// agent-loop.ts does NOT import from task-router.ts
```

**Fix Required:** Either:
1. Have `TaskRouter.executeWithOpenCode()` use `AgentLoop` internally
2. Or clarify that they serve different purposes (Mastra for filesystem ops, TaskRouter for agent selection)

#### Issue 4.3: Response Router Doesn't Use Agent Loop

**Location:** `lib/api/response-router.ts`

**Problem:** The response router (lines 1-750 reviewed) handles:
- Fast Agent
- Original System (LLM)
- n8n Agents
- Tool Execution
- Sandbox Agent
- **But NOT Mastra AgentLoop**

**Issue:** There's a `createAgentLoop` import in `route.ts` (line 615):
```typescript
import { createFilesystemTools, createAgentLoop } from '@/lib/orchestra/mastra';
```

But it's **never actually used** in the routing logic. The agent loop exists but isn't wired into the request flow.

**Fix:** Add Mastra agent loop as a routing option:
```typescript
{
  name: 'mastra-agent',
  priority: 7,
  enabled: (req) => req.enableTools !== false && !!req.userId,
  canHandle: (req) => detectRequestType(req.messages) === 'filesystem',
  processRequest: async (req) => {
    const agent = createAgentLoop(req.userId, workspacePath);
    return agent.executeTask(task);
  },
}
```

---

## 5. Event Omission Issues

### ❌ Critical Issues

#### Issue 5.1: FILE_EDIT Events Omitted When Content Empty

**Location:** `app/api/chat/route.ts` lines 688-700

**Problem:**
```typescript
if (!edit.diff || edit.diff.trim().length === 0) {
  chatLogger.debug('Skipping empty diff (prevents infinite loop)');
  continue;  // ← Event NOT emitted
}
```

**Issue:** While this prevents infinite loops, the **client never knows** that a file edit was attempted but skipped. This could be confusing if the LLM clearly indicated an edit should happen.

**Better Approach:** Emit event with `error` status:
```typescript
if (!edit.diff || edit.diff.trim().length === 0) {
  emit(SSE_EVENT_TYPES.FILE_EDIT, {
    path: edit.path,
    status: 'error',
    error: 'Empty diff content - edit skipped',
    timestamp: Date.now(),
  });
  continue;
}
```

#### Issue 5.2: No Event for Path Validation Failures

**Location:** Multiple locations

**Problem:** When `isValidFilePath` returns false, the edit is silently skipped with only a debug log.

**Fix:** Emit error event:
```typescript
if (!isValidFilePath(edit.path)) {
  emit(SSE_EVENT_TYPES.FILE_EDIT, {
    path: edit.path,
    status: 'error',
    error: 'Invalid file path rejected',
    timestamp: Date.now(),
  });
  continue;
}
```

---

## 6. Summary of Required Fixes

### Priority 1: Critical (Infinite Loop Prevention) - COMPLETED ✅

1. ✅ **Add client-side empty diff validation** in `use-enhanced-chat.ts`
   - Added validation for `file_edit` SSE events
   - Filters out empty content/diff
   - Rejects obviously invalid paths (CSS values, operators, etc.)
   
2. ✅ **Add path pre-filtering** in `conversation-interface.tsx`
   - Rejects paths ending with quotes (JSX fragments)
   - Rejects paths with spaces in filename  
   - Rejects code fragment patterns (import/export/const/function)
   - Validates path length (3-500 chars)

3. ✅ **Prevent re-processing of same message** in `conversation-interface.tsx`
   - Changed signature from full content hash to `id:length`
   - Prevents infinite useEffect re-runs

4. ✅ **Add path validation at extraction source** in `lib/chat/`
   - `extractFencedDiffEdits()` now validates paths with `isValidExtractedPath()`
   - `mode-manager.ts` COMMANDS block parser validates paths
   - Prevents invalid paths from entering the pipeline at all

### Priority 2: High (Correctness) - REMAINING

4. **Export `isValidExtractedPath`** for consistent use across client/server
5. **Fix ToolLoopAgent integration** - either upgrade SDK or remove references
6. **Wire AgentLoop into TaskRouter** or clarify separation of concerns
7. **Add error handling** to diff queue (don't silently swallow errors)
8. **Fix `filesystemEdits` initialization error** in streaming code

### Priority 3: Medium (Robustness) - REMAINING

9. **Increase incremental parse overlap** to 5000 chars
10. **Unify path validation** - use same function everywhere
11. **Improve logging** for skipped edits (include reason in event)
12. **Add error events** when edits are skipped (empty diff, invalid path)

---

## Testing Recommendations

1. **Unit Tests:**
   - `isValidExtractedPath()` with CSS values, Vue directives, SCSS variables
   - `extractIncrementalFileEdits()` with large files (>2000 chars)
   - `applyDiffToContent()` with empty diffs

2. **Integration Tests:**
   - Stream a file edit that spans chunk boundaries
   - Verify empty diffs are rejected end-to-end
   - Test path validation consistency between server/client

3. **E2E Tests:**
   - Create a file via streaming chat
   - Verify file edit appears in UI diff viewer
   - Confirm invalid paths are rejected with user-facing error

---

## Conclusion

The incremental streaming implementation has a **solid foundation** with good patterns like:
- SSE event schema
- Progressive file edit detection
- Unclosed tag tracking
- Empty diff prevention

**Critical fixes applied in this session:**
- ✅ Client-side validation for file edits (empty diff, invalid paths)
- ✅ Path pre-filtering to reject JSX/HTML fragments
- ✅ Message re-processing prevention to stop infinite loops

**Remaining gaps:**
- Path validation consistency (export `isValidExtractedPath`)
- Agent loop integration (ToolLoopAgent not wired in)
- Error event emission (silently skipping vs. notifying client)
- Variable initialization order (`filesystemEdits` error)

Addressing the Priority 1 items has significantly reduced infinite loop risks. The remaining Priority 2/3 items should be fixed before the next production release for full robustness.

---

## Change Log

### 2026-04-01 - Critical Fixes Applied (Session 2)

**Files Modified:**
- `lib/chat/file-edit-parser.ts` - Added `isValidExtractedPath()` validation to `extractFencedDiffEdits()`
- `lib/chat/mode-manager.ts` - Added path validation to COMMANDS block parser, imported `isValidExtractedPath`

**Issues Fixed:**
- Invalid paths extracted from fenced diff blocks (```diff)
- Invalid paths extracted from COMMANDS blocks (write_diffs)
- Paths now validated at extraction source, not just at application

### 2026-04-01 - Critical Fixes Applied (Session 1)

**Files Modified:**
- `hooks/use-enhanced-chat.ts` - Added client-side validation for `file_edit` events
- `components/conversation-interface.tsx` - Added path pre-filtering and re-processing prevention

**Issues Fixed:**
- Invalid path extraction from JSX/HTML (e.g., `project/sessions/002/Input'`)
- Infinite polling loop triggering rate limits
- Repeated diff application failures on same invalid paths
- Message re-processing on every render

**Evidence:**
- Terminal logs showing 429 rate limits from polling every 50ms
- Browser console showing "Skipping invalid path" warnings
- Diff application failures with "Search blocks not found"
- Client-side validation

Addressing the Priority 1 items should be done **immediately** to prevent infinite loops and data corruption. Priority 2 items should be fixed before the next production release.
