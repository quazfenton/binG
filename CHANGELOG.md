# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — Integration Execution System v2.0

### 🔴 Critical Bug Fixes

- **Sandbox session resource leak** — `executeBashCommand` now uses `try/finally` to guarantee `destroySandbox()` is called, preventing process/memory accumulation
- **Arcade userId passthrough** — Fixed `executeViaArcade` hardcoding `'anonymous'`; now correctly threads `context.userId` for user-scoped OAuth
- **Google action OAuth ignored** — `executeGoogleAction` previously fetched user's encrypted_token but never used it; now routes through Arcade with proper userId scoping
- **Nango endpoint mapping** — Expanded endpoint map to cover all registered actions (list_repos, list_branches, list_commits, create_pr, etc.); added fallback `/action` pattern for unmapped actions
- **SSRF vulnerability in webhook action** — Added comprehensive RFC1918/cloud metadata blocklist (AWS `169.254.169.254`, GCP `metadata.google.internal`, Azure `instance-data.*`); protocol validation (http/https only); URL parse error handling
- **Command injection vectors** — Expanded dangerous pattern blocklist from 5 to 15 patterns: added `eval`, backtick execution, `$()` substitution, `${}` expansion, `shutdown`, `reboot`, `su`, `curl | sh`, `wget | sh`

### 🏗 Architecture

- **Action Handler Registry** (`action-registry.ts`) — Replaced 600-line switch-case with pluggable `ActionRegistry`. Each provider registers a self-contained handler with declared action list. New providers = 1-line registration, zero route.ts edits.
- **Execution Audit Trail** (`execution-audit.ts`) — SQLite audit table with per-user execution history, success rate analytics, top provider stats. Parameter hashing redacts sensitive fields (token, secret, password, apiKey, credential).
- **Discovery Endpoint** — `GET /api/integrations/execute` returns all registered providers with their supported actions and optional execution statistics.
- **Audit Endpoint** — `GET /api/integrations/audit` returns user's recent execution history (paginated) or aggregated statistics.
- **Batch Execution** — `POST` accepts array of actions (max 20); executes in parallel via `Promise.allSettled`; one failure doesn't kill the batch.

### 🔒 Security

- **SSRF protection** — Webhook action blocks all RFC1918 ranges, cloud metadata endpoints, and non-HTTP protocols
- **Command sanitization** — 15-pattern blocklist for dangerous shell operations
- **Input validation** — Strict type checking on all request body fields; batch item validation with descriptive errors
- **Parameter redaction** — Audit log hashes params with sensitive field masking
- **Request timeouts** — 30s AbortSignal on webhooks; 30s timeout on sandbox creation

### 📝 Files Changed

| File | Change |
|------|--------|
| `app/api/integrations/execute/route.ts` | Rewritten: 150-line router + provider factories (from 600-line monolith) |
| `app/api/integrations/connections/route.ts` | Created: returns user's OAuth connections |
| `app/api/integrations/audit/route.ts` | Created: audit trail + stats endpoint |
| `lib/integrations/action-registry.ts` | Created: pluggable handler registry with `ExecutionResult<T>` envelope |
| `lib/integrations/execution-audit.ts` | Created: SQLite audit trail with analytics |
| `lib/tools/bootstrap/bootstrap-builtins.ts` | Updated: dynamic Arcade tool discovery (replaced 30 hardcoded entries) |
| `components/plugins/command-deck-plugin.tsx` | Updated: 20 new actions + 10 PROVIDER_META entries |
| `__tests__/lib/integrations/action-registry.test.ts` | Created: unit tests for registry |
| `__tests__/lib/integrations/execution-audit.test.ts` | Created: unit tests for audit trail |

### ✅ How to Verify

```bash
# TypeScript compilation (should produce zero errors)
pnpm exec tsc --noEmit --skipLibCheck

# Start dev server and test endpoints
pnpm dev

# Test discovery endpoint
curl http://localhost:3000/api/integrations/execute

# Test audit endpoint (requires auth)
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/integrations/audit

# Test batch execution
curl -X POST http://localhost:3000/api/integrations/execute \
  -H "Content-Type: application/json" \
  -d '[{"provider":"local","action":"bash","params":{"command":"echo hello"}}]'
```

### ⚠️ Breaking Changes

- None — all existing request/response contracts preserved. The `ExecutionResult<T>` envelope is backward-compatible with the previous response shape (`success`, `data`, `error`, `requiresAuth`, `authUrl` all present).

### 🔮 Future Work

1. Rate limiting per userId + provider (use audit table for sliding window)
2. Webhook allowlist for SSRF opt-out (trusted destinations)
3. Arcade dynamic tool registration at runtime (currently bootstrap-only)
4. Command allowlist mode (whitelist instead of blocklist for stricter security)
5. E2E test suite with mock Arcade/Nango/Composio responses
