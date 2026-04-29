# Code Review: web/hooks Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/hooks/ (30+ files)

---

## Module Overview

The hooks module provides React hooks for virtual filesystem, chat, streaming, file operations, and utilities.

---

## Key Hooks

| File | Purpose |
|------|---------|
| use-virtual-filesystem.ts | VFS operations (1078 lines) |
| use-chat-history.ts | Chat history |
| use-streaming-state.ts | Streaming state |
| use-file-explorer.ts | File explorer |
| use-enhanced-chat.ts | Enhanced chat |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 5 |

---

## Detailed Findings

### HIGH PRIORITY

#### 1. In-Memory Snapshot Cache (use-virtual-filesystem.ts:64-80)
**File:** use-virtual-filesystem.ts  
**Lines:** 64-80

```typescript
// SHARED IN-MEMORY SNAPSHOT CACHE
// Single shared cache for VFS snapshots
```

**Issue:** Cache unbounded, never cleaned up.

**Recommendation:** Add TTL/cache eviction.

---

#### 2. No Error Boundaries
**Multiple hooks**

**Issue:** Errors can crash entire component tree.

---

### MEDIUM PRIORITY

1. **Memory leak in listeners** - onFilesystemUpdated not unregistered
2. **No loading states** - Some hooks missing loading
3. **Race conditions** - Concurrent updates not handled

---

### LOW PRIORITY

1. Magic strings for event names
2. Console logging vs proper logger
3. Missing JSDoc
4. Some hooks too large (split needed)
5. No TypeScript strict in some files

---

## Security Assessment

### Good
1. Use client directive present
2. Path sanitization imported
3. Proper React patterns

---

## Summary

Hooks are well-structured React patterns. Main concerns are cache cleanup and error handling.

---

*End of Review*