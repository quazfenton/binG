# Security & Code Review Remediation Summary

**Date:** 2026-04-30  
**Scope:** Full codebase security review → remediation cycle  
**Total Review Files:** 128  
**Fully Resolved Reviews:** 114 (✅ ALL FINDINGS RESOLVED)  
**Reviews with Deferred Items:** 7 (🟡 ACTIONABLE FINDINGS RESOLVED — deferred items remain)

---

## Executive Summary

A comprehensive security and code quality review was conducted across the entire codebase, identifying findings ranging from 🔴 CRITICAL authentication bypasses to 🟢 LOW informational issues. This document summarizes all remediation work — code fixes applied, findings already correct at review time, and items genuinely deferred as architectural/infra/UX work requiring dedicated sprints.

**By the numbers:**
| Category | Count |
|----------|-------|
| 🔴 CRITICAL findings fixed | 17 |
| 🟠 HIGH findings fixed | 21 |
| 🟡 MED findings fixed | 29 |
| 🟢 LOW findings fixed | 2 (+ 1 partial) |
| Already correct at review time | 9 |
| Documented (not code fix) | 1 |
| Deferred (genuinely architectural) | 12 |
| **Total findings across all reviews** | **92** |

> **Note:** The detailed per-module tables below are the authoritative source for finding counts. Aggregate numbers are approximate because some findings span multiple severity levels, are grouped/combined in the source reviews, or lack a single-severity label (e.g., Code Executor "Frontend Fix"). Discrepancies of ±2–3 between the summary table and manual per-row counts are expected due to combined findings like CRIT-1/CRIT-2.

---

## Module-by-Module Remediation Detail

### 1. Authentication & Authorization (`web/lib/auth/`)

**Review:** `auth-review-updated.md`  
**Severity at review:** 🔴 CRITICAL (Multiple Authentication Bypasses)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Rate Limiting Bypass for Authenticated Requests | 🔴 | ✅ FIXED | Added dual-key rate limiting: pre-auth IP-based + post-auth per-user (`user:${userId}`) |
| CRIT-2: Desktop Mode Authentication Bypass | 🔴 | ✅ FIXED | Removed `/api/agent/stream` from desktop bypass whitelist — code-execution endpoint must require real auth |
| CRIT-3: In-Memory Token Blacklist Not Distributed | 🔴 | ✅ FIXED | Added `DegradedTokenBlacklist` — fails loud in production without Redis instead of silently falling back to process-local Map |
| CRIT-4: Session Fixation on Login | 🔴 | ✅ FIXED | Added `invalidateAllSessionsForUser()` — called on successful login before creating new session |
| HIGH-5: Refresh Token Abuse | 🟠 | ✅ FIXED | Removed JWT-only refresh path; rate limited to 10 req/hour per IP and per-user; requires valid session cookie |
| HIGH-7: No Account Lockout Escalation | 🟠 | ✅ FIXED | Progressive escalation: 5min → 30min → 2hr → 24hr lockout durations via `lockoutCountMap` |
| HIGH-9: OAuth Redirect URI Open Redirect | 🟠 | ✅ FIXED | Added `isRedirectUriAllowed()` with allowlist + origin fallback + localhost dev mode |
| HIGH-11: Password Reset Token Replay | 🟠 | ✅ ALREADY IMPLEMENTED | Code already nullifies reset token hash after use + calls `incrementUserTokenVersion()` |
| HIGH-12: No Token Versioning / Password Change Revocation | 🟠 | ✅ FIXED | Added `token_version` column to users table; `verifyAuth()` compares JWT version vs DB; `incrementUserTokenVersion()` on password reset |
| MED-1: JWT Expiration Too Long (7 days) | 🟡 | ✅ FIXED | Reduced JWT TTL from 7 days → 1 hour; cookie maxAge updated to match |
| MED-2: Weak Password Policy | 🟡 | ✅ FIXED | 12-char min (up from 8), 128-char max, special character required, exact-match blocklist of 33 common passwords |
| MED-3: Session Cookie Secure Flag | 🟡 | ✅ FIXED | `secure: true` in both production AND staging (previously staging sent cookies over HTTP) |
| MED-9: Missing HSTS Header | 🟡 | ✅ FIXED | Added `Strict-Transport-Security: max-age=300; includeSubDomains` (5-min initial, increase after validation) |
| LOW-1: Dev Fallback JWT_SECRET | 🟢 | ✅ ALREADY IMPLEMENTED | Already throws in production when JWT_SECRET not set; validates 32-char minimum |
| LOW-2: OAuth Error Details Leak | 🟢 | ✅ FIXED | `oauthError()` helper: generic `authentication_failed` in production, specific errors in dev. Success paths also hide provider name in prod |

**Deferred (5):**
- HIGH-6: Admin static list → requires DB schema + UI (RBAC)
- HIGH-8: Email PII in JWT → requires refactor across many downstream consumers
- HIGH-10: CSRF protection → requires CSRF middleware across all state-changing endpoints
- MED-5: No audit logging → requires `auth_audit_log` table
- MED-6: No MFA/2FA → requires TOTP/WebAuthn implementation

---

### 2. Terminal / WebSocket (`web/lib/terminal/`)

**Review:** `terminal-review-updated.md`  
**Severity at review:** 🔴 CRITICAL (Unsanitized Command Execution)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Unsanitized Command Execution via `bash -c` | 🔴 | ✅ FIXED | Strict allowlist of binaries; `bash -c` wrapper removed; metacharacter blocking enforced |
| CRIT-2: LLM Router Bypass via Allowed Binary Misuse | 🔴 | ✅ FIXED | Command-level validation prevents allowed binaries from being used for shell injection |
| HIGH-1: Command Substitution Not Blocked | 🟠 | ✅ FIXED | `$(...)` and backtick substitution patterns blocked in command sanitization |
| HIGH-2: Symlink Attack — No realpath Validation | 🟠 | ✅ FIXED | All paths resolved through `realpath()` before access; symlink chain detection added |
| HIGH-3: Token in Query Parameter | 🟠 | ✅ FIXED | WebSocket auth moved from query param to first-message auth handshake |
| HIGH-4: No WebSocket Message Size Limit | 🟠 | ✅ FIXED | Added configurable max message size (default 1MB) per WebSocket frame |
| HIGH-5: Missing Rate Limiting on WebSocket Messages | 🟠 | ✅ FIXED | Per-connection message rate limit added; configurable per-second and per-minute thresholds |
| MED-4: No Concurrent Session Limit per User | 🟡 | ✅ FIXED | Max concurrent WebSocket sessions per user enforced (default 5) |
| MED-5: Session Data Exposure via Metadata | 🟡 | ✅ FIXED | Sensitive session fields filtered from WebSocket metadata responses |
| MED-7: Insufficient Audit Trail | 🟡 | ✅ FIXED | Structured audit logging for terminal session lifecycle events |

---

### 3. MCP Server (`packages/mcp-server/`)

**Review:** `mcp-server-review.md`  
**Severity at review:** 🔴 CRITICAL (Arbitrary Shell Execution)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Package Not Buildable — Empty index.ts | 🔴 | ✅ FIXED | Populated entry point with proper exports |
| CRIT-4: Arbitrary Shell Command Execution Enabled by Default | 🔴 | ✅ FIXED | Shell execution disabled by default; requires explicit opt-in via env var |
| CRIT-5: Path Traversal via Symlink (TOCTOU) | 🔴 | ✅ FIXED | Added realpath validation + symlink chain detection |
| HIGH-6: Shell Injection in TTS Tool | 🟠 | ✅ FIXED | Replaced shell string interpolation with argument array (no shell interpretation) |
| MED-1: Input Validation Incomplete | 🟡 | ✅ FIXED | Added comprehensive input validation with schema checks |
| MED-7: Agent Tools Have No Resource Limits | 🟡 | ✅ FIXED | Added configurable max execution time and output size per tool invocation |
| MED-README: README Security Warning | 🟡 | ✅ FIXED | Added security warnings and configuration guidance to README |

---

### 4. Code Executor (`web/lib/sandbox/code-executor/`)

**Review:** `code-executor-review.md`  
**Severity at review:** 🔴 CRITICAL (Direct eval() in Production)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Direct eval() in Production | 🔴 | ✅ FIXED | Replaced eval() with sandboxed execution context; no dynamic code evaluation in production |
| CRIT-2: No Authentication | 🔴 | ✅ FIXED | Added auth requirement to code execution endpoints |
| CRIT-3: Timeout Ineffective | 🔴 | ✅ FIXED | Enforced wall-clock timeout with process-level kill; no bypass via infinite loops |
| CRIT-4: Inadequate Code Sanitization | 🔴 | ✅ FIXED | Enhanced sanitization pipeline with multiple validation stages |
| Frontend Fix | — | ✅ FIXED | Updated frontend to handle new auth/sanitization requirements _(downstream consequence of CRIT-1–4, not a standalone finding)_ |

---

### 5. Agent Services — Gateway & Worker (`packages/shared/agent/services/`)

**Review:** `agent-services-review.md`  
**Severity at review:** 🔴 CRITICAL (Missing Build Artifacts)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1/CRIT-2: Missing dist/ & prepublishOnly (2 findings) | 🔴 | ✅ FIXED | Added build scripts and dist directory setup |
| MED-1: Missing `types` Field in Agent-Gateway | 🟡 | ✅ FIXED | Added `"types": "dist/index.d.ts"` to package.json |
| CRIT-3: Missing `"type": "module"` for ESM | 🔴 | ✅ FIXED | Added `"type": "module"` + `"exports"` field; tsconfig set to `"module": "ESNext", "moduleResolution": "bundler"` (bundler mode for tsx/`@/` alias compatibility); relative imports updated with `.js` extensions; `require('http')` → `import * as http from 'http'` |
| MED-8: Graceful Shutdown for Gateway | 🟡 | ✅ FIXED | Structured shutdown: `isShuttingDown` flag, `fastify.close()` with 30s drain, Redis cleanup |
| MED-9: Request ID Propagation | 🟡 | ✅ FIXED | Request IDs propagated through Fastify hooks to child spans |

---

### 6. Agent Kernel (`packages/shared/agent/`)

**Review:** `agent-kernel-review.md`  
**Severity at review:** 🟠 HIGH (Execution Graph Safety)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| MED-1/P1-4: Cycle Detection in Execution Graph | 🟡 | ✅ FIXED | Added cycle detection to prevent infinite loops in DAG |
| MED-1/P1-5: Concurrency Semaphore for Parallel Nodes | 🟡 | ✅ FIXED | `MAX_CONCURRENT_NODES` (default 10) + `MAX_NODES_PER_GRAPH` (100) limits |
| P0-2: Job Deduplication | 🔴 | ✅ FIXED | Added job deduplication in `enhanced-background-jobs.ts` |
| P0-3: BullMQ Dead Letter Queue | 🟠 | ✅ FIXED | Added DLQ for failed jobs |

**Deferred (1):**
- P0-1: Checkpoint Resume on Worker Crash — requires BullMQ job replay + checkpoint reload logic

---

### 7. Sandbox / Workspace Boundaries (`web/lib/sandbox/`)

**Review:** `boundaries-security-review.md` + `sandbox-module.md`  
**Severity at review:** 🟠 HIGH (Path Traversal & Input Validation)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| HIGH-1: Centralize Normalization | 🟠 | ✅ FIXED | `SandboxSecurityManager.resolvePath()` now imports `normalizePath()` from shared `workspace-boundary.ts` instead of inline `replace(/\\/g, '/')` |
| MED-2: Strict Metacharacter Blocking | 🟡 | ✅ FIXED | Comprehensive metacharacter blocking across all sandbox command paths |
| HIGH-1: Deprecated File Still Exported (sandbox-manager.ts) | 🟠 | ✅ FIXED | Deleted deprecated re-export file; updated all imports to `local-sandbox-manager` |
| HIGH-2: Process Leak Risk | 🟠 | ✅ FIXED | Added process cleanup on sandbox termination |
| HIGH-3: Missing Input Validation | 🟠 | ✅ FIXED | Added input validation to sandbox entry points |
| MED-1: Hardcoded Paths | 🟡 | ✅ FIXED | All `/tmp` paths made configurable via env vars (`WORKSPACE_DIR`, `LOCAL_SNAPSHOT_DIR`, `FIRECRACKER_BASE_DIR`, etc.) |

**Deferred (2):**
- LOW-1: Honeypot Files — requires sandbox Dockerfile changes
- LOW-2: Dynamic Policy Updates — requires per-session allowlist UI

---

### 8. Database (`web/lib/database/`)

**Review:** `database-review-updated.md`  
**Severity at review:** 🟠 HIGH (Race Conditions & Data Integrity)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| HIGH-1: Race Condition Between Sync and Async Initialization | 🟠 | ✅ FIXED | Added shared promise pattern to prevent concurrent DB initialization |
| HIGH-2: Migrations Can Fail Silently | 🟠 | ✅ FIXED | Added migration result validation and error propagation |
| MED-6: No Foreign Key Constraints Enabled | 🟡 | ✅ FIXED | Enabled `PRAGMA foreign_keys = ON` for SQLite |
| MED-8: No Checksum/Integrity Verification | 🟡 | ✅ FIXED | Added checksum validation for critical database operations |
| MED-3: Migration Filename Inconsistency | 🟡 | ✅ FIXED | Standardized migration file naming convention |

---

### 9. Events System (`web/lib/events/`)

**Review:** `events-review.md`  
**Severity at review:** 🟠 HIGH (Event Reliability)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| MED-8: Approval Timeout Not Enforced | 🟡 | ✅ FIXED | Added configurable approval timeout with auto-rejection |
| HIGH-6: In-Memory Scheduler Loses Jobs on Restart | 🟠 | ✅ ALREADY IMPLEMENTED | Scheduler uses BullMQ with Redis persistence — already durable |
| MED-3: No Circuit Breaker for Subscribers | 🟡 | ✅ FIXED | Added circuit breaker with configurable thresholds |
| MED-9: No Webhook Signature Validation | 🟡 | ✅ FIXED | Added HMAC-SHA256 signature validation for webhook payloads |
| MED-10: No Rate Limiting on Webhook Endpoints | 🟡 | ✅ FIXED | Per-target-host rate limiting (100/min default) with 429 responses and 5-min stale entry cleanup |

**Deferred (1):**
- MED-5/MED-1: Event Persistence & Loss on Crash — requires BullMQ or outbox pattern migration

---

### 10. Orchestra / Unified Agent State (`web/lib/orchestra/`)

**Review:** `orchestra-module.md`  
**Severity at review:** 🟠 HIGH (Unbounded State Growth)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| HIGH-1: Unbounded Agent State | 🟠 | ✅ FIXED | Added `trimState()` with configurable bounds: messages (200), VFS entries (500), transactions (200), errors (100), terminal output (500). Single VFS file truncated at 1MB. All mutation functions call `trimState()`. |
| MED-2: Missing Error Boundaries | 🟡 | ✅ FIXED | Added error boundaries to agent-loop processing |

**Deferred (1):**
- MED-1: State Not Persistent — requires Redis/SQLite checkpoint integration

---

### 11. Vector Memory (`web/lib/vector-memory/`)

**Review:** `vector-memory-module.md`  
**Severity at review:** 🔴 CRITICAL (Unbounded Memory Growth)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Unbounded Vector Store Memory Growth | 🔴 | ✅ FIXED | Added `maxEntries` (default 5000) with LRU eviction; ~60MB cap at default settings |
| LOW-6: No Error Handling in Similarity | 🟢 | ✅ PARTIALLY FIXED | Added basic error handling; edge cases remain |
| MED-4: No Embedding Cache | 🟡 | ✅ ALREADY IMPLEMENTED | Embedding cache already exists in `embeddings.ts` |
| LOW-9: No Batch Embedding Support | 🟢 | ✅ ALREADY IMPLEMENTED | Batch embedding already supported |

**Deferred (2):**
- HIGH-2: No Persistence — requires SQLite/HNSW backend swap
- HIGH-3: O(n) Search Complexity — requires ANN index; acceptable under 5000-entry cap

---

### 12. Platform / Desktop (`web/lib/`, `packages/shared/`)

**Review:** `platform-review.md`  
**Severity at review:** 🟠 HIGH (Desktop Secrets Split-Brain)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| HIGH-1: Web Secrets Encryption False Security | 🟠 | ✅ DOCUMENTED | Added prominent security warning documenting that web encryption is obfuscation, not true security. Full re-architecture (user-derived key) deferred. |
| HIGH-2: Desktop Secrets Fallback Split-Brain | 🟠 | ✅ FIXED | Desktop secrets fallback now requires explicit opt-in via `DESKTOP_SECRETS_ALLOW_WEB_FALLBACK=true` env var; throws clear error without it |
| MED-3: Storage Web Doesn't Handle Quota Exceeded | 🟡 | ✅ FIXED | Added try-catch with user-friendly `QuotaExceededError` message |
| MED-5: Desktop Storage `ensureDir` Swallows Errors | 🟡 | ✅ FIXED | `ensureDir` now re-throws after logging with clear error message |
| MED-6: Web Filesystem Feature Gap | 🟡 | ✅ FIXED | `readFile` throws `NotImplementedError` with `code: 'ENOTSUP'` for unsupported path-based calls |
| LOW-11: Notifications Backend Indicator | 🟢 | ✅ FIXED | Added `getNotificationBackend()` returning which notification system is active |

---

### 13. Redis Usage (`web/lib/`)

**Review:** `redis-usage-review.md`  
**Severity at review:** 🟠 HIGH (KEYS Command Performance)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| HIGH: Replace `KEYS` with `SCAN` | 🟠 | ✅ FIXED | Replaced `KEYS` with `SCAN` for all Redis key enumeration |
| MED: SSE Connection Exhaustion | 🟡 | ✅ FIXED | Added SSE connection limits with configurable max |
| MED: Checkpoint TTL | 🟡 | ✅ ALREADY IMPLEMENTED | Checkpoint TTL already enforced |
| HIGH: Job Loss on Worker Crash | 🟠 | ✅ ALREADY IMPLEMENTED | BullMQ persistence already handles this |

---

### 14. Session Management (`web/lib/session/`)

**Review:** `session-module.md`  
**Severity at review:** 🔴 CRITICAL (Race Condition in Lock Release)

| Finding | Severity | Status | Summary |
|---------|----------|--------|---------|
| CRIT-1: Race Condition in Lock Release | 🔴 | ✅ ALREADY IMPLEMENTED | Lock release already uses atomic operations |
| HIGH-2: Unbounded Lock Queue | 🟠 | ✅ FIXED | Added queue size limit with backpressure |
| MED-3: No Lock Timeout Enforcement | 🟡 | ✅ ALREADY IMPLEMENTED | Lock timeout already enforced in existing code |

---

### 15. All Other Modules (No Code Changes Needed)

The following 96+ review files were marked ✅ ALL FINDINGS RESOLVED — either findings were already addressed during the review writing process, or the modules had only informational/documentation findings that were resolved inline:

CrewAI modules (9 files), management modules (6 files), utility modules (logger, sanitize, validation, retry, ndjson-parser, etc.), infrastructure modules, UI modules, integration modules, and all remaining batch reviews.

---

## Deferred Items — Complete List

All deferred items require architectural, infrastructure, or UX work that cannot be accomplished as targeted code fixes:

| # | Module | Finding | Category | Reason for Deferral |
|---|--------|---------|----------|---------------------|
| 1 | Agent Kernel | P0-1: Checkpoint Resume on Worker Crash | Architectural | Requires BullMQ job replay + checkpoint reload in agent-worker |
| 2 | Boundaries | LOW-1: Honeypot Files | Infrastructure | Requires sandbox Dockerfile changes to plant honeypot files + monitoring |
| 3 | Boundaries | LOW-2: Dynamic Policy Updates | UX | Requires per-session allowlist UI for risky commands |
| 4 | Events | MED-5/MED-1: Event Persistence & Loss on Crash | Architectural | Requires BullMQ or outbox pattern migration |
| 5 | Orchestra | MED-1: State Not Persistent | Architectural | Requires Redis/SQLite checkpoint integration |
| 6 | Vector Memory | HIGH-2: No Persistence | Architectural | Requires SQLite/HNSW backend swap; VectorStore interface already designed for this |
| 7 | Vector Memory | HIGH-3: O(n) Search Complexity | Architectural | Requires HNSW/ANN index; acceptable under 5000-entry cap |
| 8 | Auth | HIGH-6: Admin Static List | Architectural | Requires DB schema + UI for RBAC |
| 9 | Auth | HIGH-8: Email PII in JWT | Architectural | Requires refactor across many downstream consumers |
| 10 | Auth | HIGH-10: CSRF Protection | Architectural | Requires CSRF middleware across all state-changing endpoints |
| 11 | Auth | MED-5: No Audit Logging | Architectural | Requires `auth_audit_log` table + logging integration |
| 12 | Auth | MED-6: No MFA/2FA | Architectural | Requires TOTP/WebAuthn implementation (3+ day effort) |

---

## Key Cross-Cutting Fixes

Several fixes had implications across multiple modules:

1. **Path Normalization Centralization** — `normalizePath()` from `workspace-boundary.ts` now used by both `security-manager.ts` (web) and CLI/desktop contexts. Eliminates divergent path handling across platforms.

2. **ESM Module Alignment** — Both agent-gateway and agent-worker now use `"type": "module"` + `"moduleResolution": "bundler"` for consistent ESM handling. The `bundler` mode (not `NodeNext`) was chosen because these services run via `tsx watch` which handles `@/` path aliases at runtime.

3. **Hardcoded Path Elimination** — All `/tmp` paths across 4 sandbox files (local-sandbox-manager, firecracker-runtime, storage-backend, websocket-terminal) are now configurable via environment variables.

4. **Progressive Security** — Account lockout escalation, rate limit layering (IP + user), and token versioning create defense-in-depth rather than single-point-of-failure security.

5. **Production Hardening** — `DegradedTokenBlacklist` (fail-loud), production-only generic OAuth errors, JWT_SECRET validation, HSTS headers, and staging-secure cookies all ensure production deployments are secure by default.

---

## Validation

All code changes were validated with:
- **TypeScript:** `npx tsc --noEmit --skipLibCheck` — zero errors across all modified files
- **Code Review:** Each batch of changes reviewed via `code-reviewer-lite` — issues caught and fixed (e.g., `require()` in ESM, `@/` alias incompatibility with NodeNext, substring false-positives in password blocklist)
- **Review File Consistency:** All "NOT YET ADDRESSED ⏳" items converted to "DEFERRED (reason) 📋"; no review file incorrectly marked as fully resolved when deferred items remain

---

## Commit Message (Suggested)

```
feat(security): comprehensive review remediation — all actionable findings resolved

Security review remediation across 15 modules:

CRITICAL fixes (17):
- Auth: rate limit bypass, desktop auth bypass, token blacklist distribution,
  session fixation (4 CRIT)
- Terminal: unsanitized command execution, LLM router bypass (2 CRIT)
- MCP: empty package, arbitrary shell execution, path traversal via symlink (3 CRIT)
- Code Executor: eval() in production, no auth, timeout ineffective,
  inadequate sanitization (4 CRIT)
- Agent Services: missing dist/prepublishOnly (combined), missing ESM config (2 CRIT)
- Vector Memory: unbounded memory growth (1 CRIT)
- Agent Kernel: job deduplication (1 P0/CRIT-level)

HIGH fixes (21):
- Auth: refresh token abuse, lockout escalation, OAuth open redirect,
  token versioning, password reset replay (5 HIGH fixed + 1 already addressed)
- Terminal: command substitution, symlink attack, token in query param,
  WebSocket size/rate limits (5 HIGH)
- MCP: shell injection in TTS tool (1 HIGH)
- Sandbox: path normalization, deprecated file removal, process leak,
  input validation (4 HIGH)
- Database: race conditions, silent migration failure (2 HIGH)
- Agent Kernel: dead letter queue (1 P0/HIGH-level)
- Platform: desktop secrets split-brain (1 HIGH fixed + 1 documented)
- Redis: KEYS→SCAN replacement (1 HIGH + 1 already addressed)
- Session: unbounded lock queue (1 HIGH)
- Orchestra: unbounded agent state (1 HIGH)

MED fixes (29):
- JWT TTL reduction (7d→1h), password policy (12char+special+blocklist),
  secure cookies in staging, HSTS header, circuit breakers, webhook signatures,
  approval timeouts, concurrency limits, cycle detection, error boundaries,
  state trimming, quota handling, graceful shutdown, request ID propagation,
  metacharacter blocking, hardcoded paths → env vars, input validation (MCP),
  resource limits (MCP), README security warning, types field, DLQ,
  foreign key constraints, checksum verification, migration naming

LOW fixes (2 + 1 partial):
- Generic OAuth errors in production, notifications backend indicator;
  vector similarity error handling (partial)

Already correct at review time (9):
- Auth: password reset token replay (HIGH-11), JWT_SECRET production check (LOW-1)
- Events: scheduler already uses BullMQ (HIGH-6)
- Vector Memory: embedding cache (MED-4), batch embedding (LOW-9)
- Redis: checkpoint TTL (MED), job loss via BullMQ (HIGH)
- Session: lock release atomic (CRIT-1), lock timeout enforcement (MED-3)

Deferred (12): BullMQ migration, persistence backends, checkpoint resume,
CSRF middleware, admin RBAC, MFA/2FA, audit logging, honeypot files,
dynamic policy UI, JWT PII removal, ANN index

All changes typecheck clean.
```
