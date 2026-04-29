# Code Review: web/lib/agent-bins

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## agent-bins/ Module (11 files)

This module provides a unified, cross-platform engine for discovering the location of various AI agent CLI binaries (OpenCode, Claude Code, Pi, etc.) on the host system.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| find-agent-binary-base.ts | 310 | Shared OS-aware detection logic |
| find-opencode-binary.ts | ~60 | OpenCode-specific finder |
| find-claude-code-binary.ts | ~60 | Claude Code-specific finder |
| find-pi-binary.ts | ~60 | Pi-specific finder |
| security.ts | ~120 | Path validation and executable safety |
| agent-filesystem.ts | ~150 | Agent-specific filesystem context |
| index.ts | 78 | Barrel exports |

### Good Practices

1. **OS-Aware Detection** (line 10-13)
   Uses multiple discovery methods (`which`, `where`, `Get-Command`) to ensure compatibility across Windows (CMD/PowerShell), macOS, and Linux.

2. **Detection Priority** (line 8-14)
   Correctly prioritizes: Environment Overrides > Command Detection > Default OS Paths > NPM Globals.

3. **Module-level Caching** (line 17)
   Prevents expensive shell executions on every request by caching found paths in memory.

4. **Security Gating**
   The `security.ts` file ensures that found binaries are within expected paths and have correct permissions before being returned to callers.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **Synchronous Execution (execSync)** (line 20)
   Using `execSync` to run `which`/`where` commands blocks the Node.js event loop. If multiple agents are being initialized or if the shell is slow, it will impact the entire server's responsiveness.
   
   **Recommendation:** Use `exec` (asynchronous) from `child_process` and return a Promise. Since binaries are cached, the async overhead only happens once.

### LOW PRIORITY

1. **Search Depth Limit** (line 16)
   Stops searching after a fixed number of attempts. Ensure this is configurable for systems with complex `PATH` variables.
2. **NPM Global Path Variability**
   The `npmWrapperWindows` (line 44) detection logic might fail if the user uses a non-standard `prefix` in their `.npmrc`.
3. **Standalone Status**
   This module is currently standalone and not imported by the main application flows.

---

## Wiring

- **Used by:**
  - **Standalone** (as identified in previous search).

**Status:** ⚠️ Ready but unintegrated.

---

## Summary

The `agent-bins` module is a high-quality utility that solves the difficult "where is the binary?" problem for heterogeneous agent ecosystems. Moving from synchronous to asynchronous discovery is the primary architectural improvement suggested.

---

*End of Review*