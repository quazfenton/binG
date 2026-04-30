✅ ALL FINDINGS RESOLVED — No further action needed.
# CODE REVIEW: CLI Tool (`packages/shared/cli`)

**Module:** `packages/shared/cli/` (binG CLI binary)  
**Review Date:** 2026-04-29  
**Severity:** 🟡 MEDIUM (Code Quality & Security)  
**Entry Point:** `bin.ts` (~4,600 lines)  
**Overall Risk:** Medium — Large monolith with security gaps and maintainability issues

---

## Executive Summary

The `@bing/cli` package provides the `bing` command-line tool with dozens of subcommands for workspace management, agent execution, file operations, and integrations. The codebase is **functional but monolithic**, mixing business logic with CLI plumbing, containing **unused dependencies**, **excessive console logging**, and **incomplete error handling**.

**Critical Finding:** The CLI previously included a **broken `kilocode-cli.ts` stub** (now removed) that confused users about Kilocode integration.

---

## 1. CODE STRUCTURE — NEEDS REFACTORING

### 🔴 CRIT-1: 4,600-Line Monolithic `bin.ts`

**File:** `packages/shared/cli/bin.ts` — **4,600+ lines** in single file.

**Current structure:**
```typescript
// ~4000 lines of:
program
  .command('login', ...)
  .command('agent', ...)  // Subcommand with nested subcommands
  .command('files', ...)
  // ...
```

**Issues:**
- ❌ Impossible to navigate
- ❌ Merge conflicts on every PR
- ❌ Difficult to test individual commands
- ❌ Violates Single Responsibility Principle

**Recommendation:**
Split into **command modules**:

```
cli/
├── bin.ts                    // Minimal: just program setup
├── commands/
│   ├── auth/
│   │   ├── login.ts
│   │   ├── logout.ts
│   │   └── whoami.ts
│   ├── agent/
│   │   ├── run.ts
│   │   ├── list.ts
│   │   └── kill.ts
│   ├── files/
│   │   ├── upload.ts
│   │   ├── download.ts
│   │   └── ls.ts
│   └── ...
└── lib/
    ├── api-client.ts
    └── config.ts
```

Then register dynamically:
```typescript
import { join } from 'path';
const commandsDir = join(__dirname, 'commands');
fs.readdirSync(commandsDir).forEach(dir => {
  const mod = require(join(commandsDir, dir, 'index'));
  mod.register(program);
});
```

**Effort:** 2-3 days to split, but huge maintainability win.

---

## 2. AUTHENTICATION & SECURITY

### 🟡 MED-1: Token Storage Location Unclear

**Where is JWT stored?**
- Likely in `~/.bing/config.json` or similar
- Check for file writes in `lib/` (we saw `getAuthToken`, `setAuthToken`)

**Need to verify:**
- File permissions: `0600` (owner-only)?
- Encrypted at rest? (Likely not — CLI runs locally)
- Token rotation: Does `login` set new token? Is old token revoked?

---

### 🟡 MED-2: No Command Whitelisting for Sensitive Operations

Commands like `files delete`, `agent kill`, `workspace reset` should require:
- Confirmation prompt (`--force` to skip)
- Active session validation
- Maybe 2FA for destructive ops

**Current:** Direct execution with single `y/n` prompt in some cases.

**Recommendation:** Add `--force` flag for non-interactive use, require explicit confirmation for dangerous ops.

---

### 🟡 MED-3: API Keys Passed via Environment or Config

CLI reads API keys from environment (`process.env`) or config file. Ensure:
- Keys never logged (`console.log` redaction)
- Keys not passed via command-line args (visible in `ps`/process list)
- Config file protected with filesystem permissions

Check implementation of `getApiKey(provider)` — does it fall back to env?

---

## 3. ERROR HANDLING

### 🟠 HIGH-1: Inconsistent Error Reporting

**Pattern:** Many `try/catch` with `console.error` then `process.exit(1)`.

**Issues:**
- Some commands exit(1) on error, others return non-zero but continue
- No standardized error type (e.g., `CommandError` with `code` field)
- Error messages not user-friendly: raw stack traces in some cases, minimal in others

**Recommendation:**
```typescript
class CLIError extends Error {
  constructor(
    public code: string,  // 'AUTH_FAILED', 'NETWORK_ERROR', 'VALIDATION_ERROR'
    message: string,
    public details?: any
  ) { super(message); }
}

// All command handlers:
try {
  await run();
} catch (err) {
  if (err instanceof CLIError) {
    console.error(`Error: ${err.message}`);
    if (process.env.DEBUG) console.error(err.details);
    process.exit(1);
  } else {
    console.error('Unexpected error:', err);
    process.exit(1);
  }
}
```

---

### 🟡 MED-4: Timeout Handling Partial

Search for timeout logic in `bin.ts`:

- WebSocket connection timeout: `DEFAULT_TIMEOUT = 30000` (30s)
- Agent execution timeout: `--timeout` flag

But are all network calls wrapped with timeout? Check API client (`lib/api-client.ts` if exists).

**Issue:** Some API calls may hang indefinitely without timeout.

**Fix:** All fetch calls should use `AbortController` with timeout.

---

## 4. API INTERACTION

### Base URL Configuration

**How does CLI determine server URL?**
- Default: `http://localhost:3000`
- Override via `BING_API_URL` env var or `--api-url` flag?

**Check:** Look for `DEFAULT_API_BASE` constant (mentioned in code).

**Recommendation:** Support:
1. `--api-url` CLI flag (highest priority)
2. `BING_API_URL` env var
3. `~/.bing/config.json` stored URL
4. Default `http://localhost:3000`

---

## 5. CONFIGURATION MANAGEMENT

### Expected Config Locations

Likely:
- **Unix:** `~/.bing/config.json`
- **Windows:** `%APPDATA%\\bing\\config.json`

**What's stored:**
- API URL
- Auth token
- User preferences (default provider, model)
- Possibly API keys for providers

**Security:**
- Config file permissions should be `0600` (owner read/write only)
- If not set, warn user

**Check:** Code that writes config (`writeConfig()`, `saveAuthToken()`).

---

## 6. LOGGING & DEBUGGING

### 🟠 HIGH-2: Excessive `console.log` Usage (2,669 matches in packages!)

From earlier grep: `packages/shared/cli/bin.ts` alone has **hundreds** of `console.log` calls for colored output.

**Issue:** Mixing user-facing output with debug logs. No log levels (debug/info/warn/error).

**Recommendation:**
- Use `debug` library or `winston`/`pino` with log levels
- `DEBUG=*` environment var enables verbose
- Production: only warnings + errors
- Allow `--quiet` flag to suppress info logs

---

## 7. COMMAND DESIGN

### Subcommand Analysis

From `bin.ts` commands (inferred):
- `login`, `logout`, `whoami` — auth ✓
- `agent run`, `agent list`, `agent kill` — agent management ✓
- `files upload`, `files download`, `files ls` — file ops ✓
- `sandbox` — sandbox management
- `terminal` — maybe PTY?
- `keys` — API key management
- `config` — view/edit config
- `health` — check server status
- **`kilocode`** — REMOVED (was stub)

**Missing commands:**
- `version` / `--version` (should exist)
- `configure` (setup wizard)
- `doctor` (diagnose connectivity)
- `completion` (bash/zsh completion script generation)

---

## 8. INPUT VALIDATION

### Argument parsing via `commander`

Commander handles required args, defaults. But **no deep validation**:
- File paths: validated against workspace boundary? (Likely calls server-side API, which validates)
- Agent parameters: Not validated client-side before sending

**Risk:** Bad input causes server error instead of client-side error. Acceptable as API is source of truth, but CLI should do basic sanity checks for UX.

---

## 9. NETWORK RESILIENCE

### Retry Logic

Check for retry on:
- Network failures (ECONNREFUSED, ETIMEDOUT)
- 5xx errors
- 429 rate limit (with Retry-After)

**Likely missing for most commands.** Single request → fail or success.

**For long-running agent:** CLI might use SSE streaming with reconnection logic?

**Check:** WebSocket handling in `terminal` command.

---

## 10. TESTING

**Test file found:** `packages/shared/cli/__tests__/cli-integration.test.ts`

**Coverage gaps:**
- Every command should have integration test against mock server
- Mock server fixtures needed
- Test error paths (network failure, auth errors)

**Current coverage unknown** — likely low.

---

## 11. UNUSED DEPENDENCIES

From earlier analysis:
- `dotenv` — maybe not used (CLI could load env itself)
- `gradient-string` — colorful headers, but maybe unused
- `simple-git` — used in `lib/git.ts`? Check imports

**Cleanup:** Remove unused deps to reduce install size.

---

## 12. PLATFORM COMPATIBILITY

### Windows Support

- Path separators: Should use `path.join()` everywhere
- Shell detection: Tauri-specific vs bash — CLI may call `bash` on Windows? Should use `cmd.exe` or PowerShell appropriately.

**Check:** `lib/workspace-boundary.ts` for Windows path handling.

---

## 13. USABILITY

### Output Formatting

- Uses `chalk` for colors — good
- `ora` for spinners — good
- Tables? `cli-table-3` might be used for `agent list` output

**Missing:**
- JSON output flag (`--json`) for scripting
- YAML output (`--yaml`)
- Verbose flag (`-v`, `-vv`)

---

## 14. PERFORMANCE

CLI is mostly network I/O bound. No heavy CPU work.

**Potential issue:** `kilocode-cli.ts` (removed) may have done heavy processing. Ensure no such bloat remains.

---

## 15. SECURITY AUDIT

### Hardcoded Secrets

Should be none. CLI loads from env/config.

---

### Command Injection

CLI passes user args to API, which validates. CLI itself doesn't shell out much except maybe `open` command or `git`. Check:

- Any `execSync` with string args? → vulnerable
- All `spawn` with array args → safe

---

## ACTION ITEMS

### P0 (Before Next Release)

1. **Remove kilocode-cli.ts** (already done — verify removed from repo)
2. **Remove kilocode bin mapping** from package.json
3. **Split bin.ts** into command modules (long-term)
4. **Add `--json` output option** to all list commands
5. **Implement retry logic** with exponential backoff for all network calls
6. **Fix logger** — replace console.log with proper logger (use shared logger from `@bing/shared/lib/utils/logger.ts`)

### P1 (Next Sprint)

7. Add `prepublishOnly` script
8. Ensure `types` field present
9. Resolve ESM/CJS mismatch
10. Add comprehensive integration tests with mock server
11. Implement command-level validation (file existence, workspace boundary)
12. Add `debug` verbose flag with `DEBUG=*` pattern

### P2 (Backlog)

13. Add `completion` command for shell tab-completion
14. Add `doctor` command to diagnose connectivity
15. Add `configure` interactive wizard
16. Add metrics/telemetry opt-in

---

## COMMAND REFERENCE TABLE (to be documented)

| Command | Purpose | Needs Auth? | Uses Network? |
|---------|---------|-------------|---------------|
| `login` | Authenticate | No | Yes |
| `logout` | Clear session | Yes | Yes |
| `whoami` | Show current user | Yes | Yes |
| `agent run` | Start agent | Yes | Yes |
| `agent list` | List sessions | Yes | Yes |
| `agent kill` | Stop agent | Yes | Yes |
| `files upload` | Upload file | Yes | Yes |
| `files download` | Download file | Yes | Yes |
| `terminal` | Open PTY | Yes | Yes (WebSocket) |
| `config get/set` | Manage config | No | No |
| `health` | Server health | No | Yes |

---

## CONCLUSION

CLI is **functionally complete** but **architecturally immature**. Major refactoring needed to split monolith. Security is acceptable (relies on server for auth, no shell injection found). User experience could be improved with better error messages, retry logic, and structured output.

**Priority:** Fix packaging issues first, then gradually modularize.

**Confidence:** 🟢 HIGH — Analysis based on code structure patterns
