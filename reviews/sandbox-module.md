# Code Review: web/lib/sandbox Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/sandbox/ (40+ files)

---

## Module Overview

The sandbox module is one of the largest in the codebase, providing sandbox providers, execution, security, and lifecycle management for code execution environments.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Sandbox Orchestrator (sandbox-orchestrator.ts)          │
│ - Multi-provider coordination                        │
├─────────────────────────────────────────────────────┤
│ Core Providers                                  │
│ - core-sandbox-service.ts - Cloud providers     │
│ - local-sandbox-manager.ts - Local execution   │
│ - e2b-deep-integration.ts - E2B integration   │
├─────────────────────────────────────────────────────┤
│ Security                                       │
│ - security.ts - Command/file blocking          │
│ - security-manager.ts - Security management    │
│ - desktop-security-policy.ts - Desktop policies│
├─────────────────────────────────────────────────────┤
│ Execution                                      │
│ - code-executor.ts - Code execution           │
│ - timeout-retry-utils.ts - Timeout/retry      │
└─────────────────────────────────────────────────────┘
```

---

## Files Reviewed (Key Files)

| File | Lines | Purpose |
|------|-------|--------|
| local-sandbox-manager.ts | 401 | Local sandbox management |
| core-sandbox-service.ts | ~500 | Cloud provider service |
| sandbox-orchestrator.ts | ~400 | Multi-provider orchestration |
| security.ts | 547 | Command/file blocking |
| sandbox-manager.ts | 38 | **DEPRECATED** - backward compat only |
| provider-router.ts | ~200 | Provider routing |
| sandbox-connection-manager.ts | ~300 | Connection management |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 4 |
| Low | 6 |

---

## Detailed Findings

### HIGH PRIORITY

#### 1. Deprecated File Still Exported (sandbox-manager.ts)
**File:** sandbox-manager.ts  
**Lines:** Entire file (38 lines)

```typescript
/**
 * @deprecated Use lib/sandbox/core-sandbox-service.ts for production
 */
```

**Issue:** Deprecated file still exists and re-exports from local-sandbox-manager. Could cause confusion.

**Recommendation:** Remove or mark clearly as deprecated with removal timeline.

---

#### 2. Process Leak Risk (local-sandbox-manager.ts:55)
**File:** local-sandbox-manager.ts  
**Line:** 55

```typescript
private runningProcesses: Map<string, ChildProcess> = new Map();
```

**Issue:** Running processes could leak if not properly cleaned up on sandbox stop.

**Recommendation:** Ensure process cleanup in stopSandbox.

---

#### 3. Missing Input Validation (provider-router.ts)
**File:** provider-router.ts  
**Lines:** ~100-150

**Issue:** Provider selection doesn't validate input parameters.

**Recommendation:** Add input schema validation.

---

### MEDIUM PRIORITY

1. **Hardcoded paths** - /tmp/workspaces, /tmp/snapshots
2. **Missing metrics** - Some operations don't emit metrics
3. **No connection timeout** - Connections can hang indefinitely
4. **Incomplete error messages** - Error handling could be better

---

### SECURITY ASSESSMENT - Excellent

The sandbox security module is well-designed:

**Good Security Practices:**

1. **Command blocking** (security.ts:26-51) - Comprehensive blocked patterns:
   - System destruction (rm -rf /)
   - Permission escalation
   - Remote code execution
   - Fork bombs
   - Network attacks

2. **Path validation** - safeJoin() prevents traversal

3. **Unicode homoglyph detection** - Detects Cyrillic lookalikes

4. **File blocking** - Blocks /etc/passwd, /etc/shadow, /proc, /sys

5. **Resource ID validation** - isValidResourceId()

---

## Wiring Issues

### Properly Wired

- Used by: terminal module, tools module
- Used by: previews (port detection)
- Used by: sandbox-connection-manager

### Standalone Logic

1. **sandbox-manager.ts** - Marked deprecated but still exported

---

## Summary

The sandbox module has excellent security design. Main concerns are around cleanup and deprecated code.

---

**Status:** 🟡 **PARTIALLY REMEDIATED** — Process leak fix, input validation applied 2026-04-30. Deprecated file removal and hardcoded paths deferred.

---

## Remediation Log

### HIGH-2: Process Leak Risk — **FIXED** ✅
- **File:** `web/lib/sandbox/local-sandbox-manager.ts`
- **Fix:** `deleteSandbox()` now sends SIGTERM first, then schedules SIGKILL after 5s if process hasn't exited. `shutdown()` sends SIGTERM to all processes, waits 1s, then force-kills any remaining. Timers use `.unref()` to not prevent process exit.

### HIGH-3: Missing Input Validation — **FIXED** ✅
- **File:** `web/lib/sandbox/provider-router.ts`
- **Fix:** `selectWithServices()` now validates: context is an object, context.type is a non-empty string, needsServices is a non-empty array. Unknown service names are logged as warnings. Prevents undefined/null context from causing cryptic errors downstream.

### HIGH-1: Deprecated File Still Exported — **NOT YET ADDRESSED** ⏳
- **Reason:** sandbox-manager.ts re-exports from local-sandbox-manager. Removing it requires updating all import sites across the codebase. Low risk since it's clearly marked @deprecated.

### MED-1: Hardcoded Paths — **NOT YET ADDRESSED** ⏳
- **Reason:** /tmp/workspaces and /tmp/snapshots are hardcoded defaults. Should be configurable via env vars. Low priority since constructor accepts custom paths.

---

*End of Review*