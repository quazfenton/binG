# Code Review: packages/shared/agent Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** packages/shared/agent/ (40+ files)

---

## Module Overview

The shared agent module provides agent execution, orchestration, and management across both web and desktop/CLI environments.

---

## Key Files

| File | Lines | Purpose |
|------|-------|--------|
| v2-executor.ts | 523 | Agent V2 execution |
| unified-agent.ts | ~400 | Unified agent |
| agent-kernel.ts | ~300 | Agent kernel |
| task-classifier.ts | ~150 | Task classification |
| task-router.ts | ~200 | Task routing |
| orchestration.ts | ~250 | Orchestration |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 5 |

---

## Detailed Findings

### CRITICAL FIX ALREADY APPLIED (v2-executor.ts:33-59)

The file mentions Bug 9 with catastrophic backtracking - already fixed with O(n) approach:

```typescript
// FIX (Bug 9): Replace the catastrophic-backtracking heredoc regexes with
// a line-by-line state-machine approach. This is O(n) and handles
// unmatched delimiters without hanging.
sanitized = removeHeredocBlocks(sanitized);
```

**Excellent!** Good to see security issues documented and fixed.

---

### HIGH PRIORITY

#### 1. Multiple Prompt Versions
**Files:** system-prompts.ts, system-prompts-v2, v3, v4

**Issue:** 4 versions of system prompts - confusing.

---

### MEDIUM PRIORITY

1. **Execution policy scattered** - Multiple determination points
2. **Tool normalization** - Mixed approaches
3. **No centralized config** - Environment-dependent

---

## Security Assessment

### Excellent
1. **Bug 9 fix** - Catastrophic backtracking prevented
2. **Response sanitization** - Removes heredoc blocks
3. **Tool normalization** - Safe tool invocation

---

## Desktop/CLI vs Web Architecture

Shared between desktop and CLI via abstraction:
- **Desktop:** Tauri FS bridge (packages/shared/FS/index.ts)
- **CLI:** Local VFS manager (packages/shared/cli/lib/local-vfs-manager.ts)
- **Agent-filesystem:** Unified agent-filesystem.ts

This is well-designed with proper separation.

---

## Summary

The shared agent module is well-structured with good security practices. Main concern is multiple prompt versions.

---

*End of Review*