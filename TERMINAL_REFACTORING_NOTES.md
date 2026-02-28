# Terminal System - Technical Debt & Refactoring Notes

**Last Updated:** February 27, 2026  
**Status:** Critical bugs fixed, remaining items need refactoring

---

## Completed Fixes (February 2026)

| Issue | Status | Description |
|-------|--------|-------------|
| BUG 1 | ✅ FIXED | PTY input not forwarded - added PTY mode check at start of onData |
| BUG 2 | ✅ FIXED | lineBuffer in ref - lifted to lineBufferRef.current |
| BUG 4 | ✅ FIXED | Duplicate command echo - removed redundant writeln |
| BUG 5 | ✅ FIXED | Mode naming - added 'sandbox-cmd' and 'editor' to TerminalMode |
| BUG 7 | ✅ FIXED | Security - removed JWT fallback in URL, only use connection token |
| ISSUE A | ✅ FIXED | Provider timeout wrapper - added 30s timeout per provider |
| ISSUE C | ✅ FIXED | Missing providers - added blaxel/sprites to TerminalManager |
| ISSUE D | ✅ FIXED | HMR interval leak - added global singleton pattern |
| ARCH 2 | ✅ FIXED | Auto-connect on open - added setTimeout to connectTerminal |
| ARCH 5 | ✅ FIXED | Missing AbortController - added connectAbortRef |
| UX 4 | ✅ FIXED | Tab completion - implemented basic path completion |
| FEAT 1 | ✅ FIXED | Persistent history - added save/load from terminal-storage |
| ARCH 1 | ✅ FIXED | Dual state - updateTerminalState now updates both ref and state |
| ARCH 4 | ✅ FIXED | HTTP batching - added 16ms debounce for keystroke batching |

---

## All Issues Resolved ✅### 4. ARCH 4 - Per-Keystroke HTTP Overhead
**Location:** `TerminalPanel.tsx` - sendInput function

**Problem:** Every keystroke triggers POST to `/api/sandbox/terminal/input`. HTTP overhead causes latency.

**Recommended Fix (Option A - Simple):**
```typescript
// Batch keystrokes with 16ms debounce
const inputBatchRef = useRef<Record<string, string>>({});
```

**Recommended Fix (Option B - Best):**
- Upgrade to WebSocket for bidirectional streaming
- Replace SSE + HTTP with single WebSocket connection

**Complexity:** Medium to High

---

### 5. ARCH 5 - Missing AbortController
**Location:** `TerminalPanel.tsx` - connectTerminal function

**Problem:** If user closes panel while connectTerminal is awaiting, the request continues in background.

**Recommended Fix:**
```typescript
const connectAbortRef = useRef<Record<string, AbortController>>({});
// In connectTerminal: connectAbortRef.current[terminalId]?.abort();
// In closeTerminal: connectAbortRef.current[terminalId]?.abort();
```

**Complexity:** Low

---

### 6. UX 4 - Tab Completion
**Location:** `TerminalPanel.tsx` - onData handler line 1181-1183

**Problem:** Tab is silently ignored in local mode.

**Recommended Fix:** Implement basic path completion from localFileSystemRef

**Complexity:** Medium

---

### 7. ISSUE B - Microsandbox Daemon Debugging
**Location:** `microsandbox-daemon.ts`

**Problem:** Daemon spawn uses `stdio: 'ignore'` - impossible to debug startup failures.

**Recommended Fix:**
```typescript
// Capture daemon stderr for debugging
const logStream = fs.createWriteStream('/tmp/microsandbox-daemon.log', { flags: 'a' });
const child = spawn('sh', ['-lc', command], {
  detached: true,
  stdio: ['ignore', logStream, logStream],
});
```

**Complexity:** Low

---

### 8. ISSUE E - Batch File Writes
**Location:** `sandbox-service-bridge.ts` lines 105-115

**Problem:** Files written one-by-one, blocking command execution.

**Recommended Fix:**
```typescript
// Parallelize writes
await Promise.all(snapshot.files.map(f => 
  this.writeFile(sandboxId, f.path, f.content)
));
```

**Complexity:** Low

---

### 9. ISSUE F - Command Sanitizer Too Aggressive
**Location:** `microsandbox-provider.ts` line 159

**Problem:** Blocks legitimate shell constructs like `$PATH`, `$(command)`, globs.

**Recommended Fix:** Replace character-level block with targeted pattern validation from sandbox-tools.ts

**Complexity:** Medium

---

### 10. FEAT 1 - Persistent Command History
**Location:** TerminalPanel.tsx

**Problem:** History lost on panel close/reopen.

**Recommended Fix:** Persist to localStorage via addCommandToHistory

**Complexity:** Low

---

## Files Modified (February 2026)

| File | Changes |
|------|---------|
| `lib/sandbox/terminal-manager.ts` | Added timeout wrapper, blaxel/sprites providers |
| `components/terminal/TerminalPanel.tsx` | PTY check, duplicate echo removed, mode types, JWT removed |
| `lib/sandbox/sandbox-filesystem-sync.ts` | Added global singleton pattern |

---

## Testing Recommendations

1. **PTY Mode Test:** Open terminal, type "connect", verify keystrokes go to sandbox
2. **Provider Timeout Test:** Disable all providers except Daytona, verify timeout after 30s
3. **HMR Test:** Make changes in dev mode, verify only one sync interval runs
4. **Security Test:** Verify no JWT tokens in terminal stream URLs

---

## Related Documentation

- Original Bug Report: See session notes for "Terminal Panel — Full Review, Bug Analysis & Fix Plan"
- MCP Integration: `SMITHERY_BLAXEL_MCP_INTEGRATION_PLAN.md`
