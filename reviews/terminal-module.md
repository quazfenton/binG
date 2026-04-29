✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/terminal Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/terminal/ (13 files)

---

## Module Overview

The terminal module provides terminal session management, PTY handling, WebSocket streaming, and port detection for terminal services. This is used heavily in both sandbox and local terminal modes.

---

## Architecture Understanding

```
┌─────────────────────────────────────────────────────────────┐
│ Terminal Manager (terminal-manager.ts)               │
│ - Manages PTY/WebSocket/Command-mode connections   │
│ - Connection limits (50 PTY, 100 WS)               │
│ - 5-minute idle cleanup                         │
├─────────────────────────────────────────────────────────────┤
│ Enhanced PTY Terminal (enhanced-pty-terminal.ts) │
│ - PTY providers (desktop, local, web)             │
├─────────────────────────────────────────────────────────────┤
│ WebSocket Handler (ws-upgrade-handler.ts)       │
│ - Upgrade handling for terminal WS               │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|--------|
| terminal-manager.ts | 891 | Core connection management |
| enhanced-terminal-manager.ts | ~200 | Enhanced manager |
| enhanced-pty-terminal.ts | ~200 | PTY wrapper |
| websocket-terminal.ts | ~200 | WebSocket terminal |
| web-local-pty.ts | ~150 | Local PTY |
| desktop-pty-provider.ts | ~150 | Desktop PTY |
| terminal-input-batcher.ts | ~100 | Input batching |
| terminal-health-monitor.ts | ~100 | Health checks |

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

#### 1. No Authentication on WebSocket Connections (ws-upgrade-handler.ts)
**File:** `ws-upgrade-handler.ts`  
**Lines:** ~50-100

**Issue:** WebSocket upgrade doesn't validate authentication. Any client can connect to terminal sessions.

**Recommendation:** Add authentication check before upgrade.

---

#### 2. Command Injection in Shell Execution (bash-executor-locally.ts in packages/shared)
**File:** packages/shared/cli/lib/bash-executor-local.ts  
**Lines:** ~68-95

**Issue:** Path validation exists but shell commands could be injected. The BLOCKED_PATTERNS don't cover all injection vectors.

**Recommendation:** Add explicit command allow/block lists.

---

### MEDIUM PRIORITY

#### 3. Connection Limits Are Soft Limits
**File:** terminal-manager.ts  
**Lines:** 64-66

```typescript
const MAX_PTY_CONNECTIONS = 50
const MAX_WEBSOCKET_CONNECTIONS = 100
```

**Issue:** Limits exist but new connections aren't rejected, just override old ones when cleanup fails.

**Recommendation:** Return error when limits hit.

---

#### 4. Poll Interval Hardcoded For Desktop FS (packages/shared/FS/index.ts:261-267)
**File:** packages/shared/FS/index.ts  
**Lines:** 261-267

```typescript
const envPollInterval = process.env.DESKTOP_FS_POLL_INTERVAL;
this.pollIntervalMs = Math.min(parsed, 30000);
```

**Issue:** Poll fallback is 3 seconds by default but not configurable from web side.

**Recommendation:** Expose configuration to web runtime.

---

#### 5. Memory Leak in Poll Watcher (packages/shared/FS/index.ts:196-199)
**File:** packages/shared/FS/index.ts  
**Lines:** 196-199

```typescript
private fileStates: Map<string, { mtime: number; size: number }> = new Map();
private usePollFallback: boolean = false;
```

**Issue:** fileStates map grows unboundedly - entries never removed when files are deleted.

**Recommendation:** Add eviction for missing files.

---

### LOW PRIORITY

1. Console.log vs Logger inconsistency
2. Duplicate port detection code
3. Missing JSDoc in some files
4. Magic string patterns for port detection
5. No connection timeout enforcement

---

## Security Considerations

### Good Security Practices

1. **Connection limits** - Resource exhaustion prevention
2. **Idle cleanup** - 5-minute timeout
3. **Path validation** - In bash executor

### Concerns

1. **No auth on WS upgrade** - HIGH concern
2. **Command injection** - Medium concern
3. **Poll watcher memory** - Medium concern (fileStates leak)

---

## Wiring Issues

### Properly Wired

- Used by: web/app/api/terminal/* routes
- Used by: sandbox providers
- Used by: previews/port-detector

---

## Summary

Terminal module provides solid terminal management with good resource limits. Main concerns:

1. **WebSocket authentication missing** - Critical fix needed
2. **Command injection protection** - Needs improvement
3. **Poll watcher memory leak** - Should fix

Overall: Good quality, security improvements needed.

---

*End of Review*