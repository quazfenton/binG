# binG Codebase Security & Architecture Review — Master Index

**Review Period:** 2026-04-29  
**Reviewer:** Kilo (Automated Architecture Analysis)  
**Scope:** Entire monorepo — all packages, services, libraries  
**Methodology:** Systematic deep-dive per module with threat modeling, code tracing, and dependency analysis

---

## 📊 Overall Assessment

| Metric | Score | Status |
|--------|-------|--------|
| **Security Posture** | 4/10 | 🔴 Critical vulnerabilities present |
| **Architecture Quality** | 6/10 | 🟡 Structural debt, package boundaries leaky |
| **Code Quality** | 5/10 | 🟡 Massive files, duplication, minimal tests |
| **Reliability** | 5/10 | 🟡 Race conditions, no persistence, weak error handling |
| **Maintainability** | 4/10 | 🔴 Poor organization, missing docs, naming confusion |

**Verdict:** 🟡 **Not production-hardened** — Requires 2-3 weeks of stabilization work before confident deployment.

---

## 🚨 Top 10 Critical Issues (Immediate Action Required)

| # | Issue | Severity | Module | Effort |
|---|-------|----------|--------|--------|
| 1 | **Unrestricted RCE via `/api/code/execute`** (`eval()` no sandbox) | 🔴 CRITICAL | `code-executor` | 1 day |
| 2 | **Command injection in terminal** (`bash -c` unsanitized) | 🔴 CRITICAL | `terminal` | 3 days |
| 3 | **Desktop auth bypass** (env var impersonation) | 🔴 CRITICAL | `auth` | 2 days |
| 4 | **Rate-limit bypass for authenticated users** | 🔴 CRITICAL | `auth` | 4 hours |
| 5 | **In-memory JWT blacklist (not distributed)** | 🔴 HIGH | `auth` | 1 day |
| 6 | **Session fixation (no invalidation on login)** | 🔴 HIGH | `auth` | 3 hours |
| 7 | **`kilocode-cli.ts` stub published in `@bing/cli`** | 🔴 HIGH | `packages/shared/cli` | 15 min |
| 8 | **Database dual-init race condition** (sync + async) | 🔴 HIGH | `database` | 1 day |
| 9 | **Migrations fail silently** (continue with broken schema) | 🔴 HIGH | `database` | 2 hours |
| 10| **Better-sqlite3 in web bundle** (native, won't run) | 🔴 HIGH | `web/package.json` | 1 hour |

---

## 📋 Complete Module Reviews

### Core Infrastructure

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| A1 | `packages/platform/` | 🟡 Medium | Web secrets false encryption, desktop fallback split-brain | [platform-review.md](platform-review.md) |
| A2 | `web/lib/database/` | 🟠 High | Race conditions, silent migration failures | [database-review-updated.md](database-review-updated.md) |
| A3 | `web/lib/virtual-filesystem/` | 🟢 Low | Strong path validation, good design | [virtual-filesystem-module.md](virtual-filesystem-module.md) *(existing)* |
| A4 | `web/lib/cache.ts` | 🟢 Low | Simple in-memory cache | *(no new review needed)* |

---

### AI & Agent Systems

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| B1 | `web/lib/chat/` | 🟠 High | No token pre-validation, untested file parser | [chat-review-updated.md](chat-review-updated.md) *(updated)* |
| B2 | `web/lib/orchestra/` & `stateful-agent/` | 🟠 High | No crash recovery, state bloat, no circuit breakers | [orchestra-review-updated.md](orchestra-review-updated.md) *(updated)* |
| B3 | `packages/shared/agent/` (kernel) | 🟡 Medium | No job deduplication, no DLQ, weak observability | [agent-kernel-review.md](agent-kernel-review.md) |
| B4 | `agent-gateway/` & `agent-worker/` services | 🟡 Medium | Not buildable, missing prepublish, no metrics | [agent-services-review.md](agent-services-review.md) |
| B5 | `web/lib/agent-catalyst/` | 🟢 Low | Experimental, limited scope | *(no new review)* |
| B6 | `web/lib/agent-bins/` | 🟢 Low | Binary finders — low risk | *(no new review)* |

---

### Execution & Sandbox

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| C1 | `web/lib/code-executor/` | 🔴 CRITICAL | **Unauthenticated RCE via eval()** | [code-executor-review.md](code-executor-review.md) *(NEW)* |
| C2 | `web/lib/sandbox/` | 🟠 High | Provider explosion (25+), no unified interface | [sandbox-module.md](sandbox-module.md) *(existing, update needed)* |
| C3 | `web/lib/terminal/` | 🔴 CRITICAL | Command injection, no resource limits, desktop PTY unrestricted | [terminal-review-updated.md](terminal-review-updated.md) *(updated)* |
| C4 | `web/lib/bash/` | 🟡 Medium | DAG executor — needs better validation | *(covered by terminal)* |

---

### Authentication & Security

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| D1 | `web/lib/auth/` | 🔴 CRITICAL | 4 critical auth bypasses, rate-limit evasion | [auth-review-updated.md](auth-review-updated.md) *(NEW)* |
| D2 | `web/lib/security/` | 🟢 Low | Headers, CSP — OK | *(covered in auth)* |

---

### Services & Background Jobs

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| E1 | `web/lib/events/` | 🟡 Medium | No persistence, at-most-once delivery, no DLQ | [events-review.md](events-review.md) *(NEW)* |
| E2 | `packages/shared/services/` | 🟡 Medium | Duplicate service bootstrap, no health checks | *(covered in agent services)* |
| E3 | `packages/platform/src/jobs.ts` | 🟢 Low | Simple job runner | *(covered in platform)* |

---

### Integration & Tools

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| F1 | `packages/mcp-server/` | 🔴 HIGH | Broken package, arbitrary command exec, path traversal | [mcp-server-review.md](mcp-server-review.md) *(NEW)* |
| F2 | `web/lib/mcp/` | 🟡 Medium | MCP client implementation | *(existing: mcp-module.md)* |
| F3 | `web/lib/tools/` | 🟡 Medium | Tool system — needs ACLs | *(existing: tools-module.md)* |
| F4 | `web/lib/plugins/` | 🟢 Low | Plugin isolation | *(existing: plugins-module.md)* |
| F5 | `web/lib/github/`, `figma/`, `email/` | 🟢 Low | Standard integrations | *(individual reviews exist)* |

---

### User Interface & API

| # | Module | Status | Critical Issues | Review File |
|---|--------|--------|-----------------|-------------|
| G1 | `web/app/api/` (100+ routes) | 🟠 High | Many endpoints missing auth/rate-limit | [api-routes-module.md](api-routes-module.md) |
| G2 | `web/lib/components/` | 🟢 Low | UI only | *(no security review needed)* |
| G3 | `web/app/(main)/` | 🟢 Low | Next.js pages | *(no new issues)* |

---

## 📁 Review Documents (Newly Created)

| File | Scope | Priority |
|------|-------|----------|
| `code-executor-review.md` | RCE vulnerability — eval() without sandbox | 🔴 P0 |
| `terminal-review-updated.md` | Command injection, PTY security | 🔴 P0 |
| `auth-review-updated.md` | 4 critical auth bypasses, 8 high | 🔴 P0 |
| `platform-review.md` | Secrets false encryption, storage gaps | 🟠 P1 |
| `database-review-updated.md` | Race conditions, silent migration failures | 🟠 P1 |
| `agent-kernel-review.md` | No crash recovery, missing observability | 🟡 P2 |
| `agent-services-review.md` | Packaging broken, not buildable | 🟡 P2 |
| `events-review.md` | No persistence, at-most-once delivery | 🟡 P2 |
| `mcp-server-review.md` | Broken package, dangerous tools | 🔴 P0 |

---

## 📋 Cross-Cutting Issues (Affect Multiple Modules)

| Issue | Affected Modules | Severity | Fix Complexity |
|-------|------------------|----------|----------------|
| **No central config with validation** | All packages reading `process.env` directly | 🔴 HIGH | 3 days |
| **Duplicate logger (3 copies)** | agent-gateway, agent-worker, shared/cli | 🟡 MEDIUM | 2 hours |
| **Duplicate Redis client init (8×)** | All services using Redis | 🟡 MEDIUM | 4 hours |
| **Conflicting env defaults** | CLI, chat, settings-schema | 🟠 HIGH | 2 hours |
| **Missing tests** | Most packages have <20% coverage | 🟡 MEDIUM | Ongoing |
| **`any` types** | utils, config, services | 🟢 LOW | 1 week |
| **`console.log` vs logger** | CLI, web, services (2,669 matches!) | 🟡 MEDIUM | 3 days |

---

## 🔧 Priority Fix Roadmap

### Sprint 0 (Emergency — This Week)

**Day 1-2: Disable/kill vulnerable endpoints**

```bash
# 1. Disable /api/code/execute (RCE)
# 2. Add WAF rule blocking dangerous bash patterns (&&, ;, |, $()
# 3. Remove vm2 & better-sqlite3 from web package.json
# 4. Delete kilocode-cli.ts from repo (if not already)
```

**Day 3: Auth hardening**

- Deploy Redis token blacklist
- Fix rate-limit bypass (use userId)
- Disable desktop auth bypass (or restrict severely)

**Day 4-5: Packaging fixes**

- Build all packages, commit `dist/`
- Add `prepublishOnly` to agent services
- Fix `main`/`types` fields

---

### Sprint 1 (Stabilization — Week 2)

- Consolidate logger into shared package
- Consolidate Redis client factory
- Create `BaseService` class for HTTP services
- Fix database race condition (single init gate)
- Fail on migration errors (production)
- Enable foreign keys in SQLite

---

### Sprint 2 (Security — Week 3)

- Rewrite code-executor to use SandboxService
- Fix command injection in terminal (shell-escaping or `execFile`)
- Add symlink `realpath` validation to path checks
- Implement CSRF tokens
- Add audit logging for auth & sensitive operations
- Shorten JWT TTL to 1h, add refresh rotation

---

### Sprint 3 (Reliability — Week 4)

- Replace in-memory event bus with BullMQ persistence
- Add job deduplication, DLQ
- Implement checkpoint compression & versioning
- Add agent crash recovery (resume from checkpoint)
- Add per-user concurrent session limits
- Implement tool ACLs for agents

---

### Sprint 4 (Observability — Week 5)

- Add structured JSON logging (pino/winston)
- Prometheus metrics for all services
- OpenTelemetry tracing
- Dashboard for agent runs, queue depth, error rates
- Alerting on critical failures

---

### Sprint 5 (Debloat & Performance — Week 6)

- Remove 20+ unused dependencies from web
- Standardize AI SDK stack (pick one framework)
- Group sandbox providers, extract interface
- Optimize VFS search (add full-text index)
- Add database connection pooling

---

## 📈 Metrics & Coverage Targets

| Metric | Current | Target (Sprint 5) |
|--------|---------|-------------------|
| **Security vulnerabilities** | 50+ issues | < 5 critical/high |
| **Test coverage** | ~15% (estimated) | > 60% overall, critical paths > 80% |
| **Duplicate code** | ~1,800 lines | < 200 lines |
| **Dependency bloat** | 164 deps (web) | < 120 deps |
| **Build reliability** | Broken packages | All packages build + test CI-green |
| **Documentation** | Sparse | README for all packages, API docs |

---

## 🔍 How to Use This Review

1. **Start with critical issues** — fix RCE, auth bypasses immediately
2. **Read module-specific reviews** for deep context
3. **Follow action items** in priority order (each review has "Immediate", "Short-term", "Long-term")
4. **Assign owners** — each module needs a responsible engineer
5. **Track progress** — create GitHub issues from each action item
6. **Re-review** after fixes — verify remediation closed issues

---

## 📁 Review File Descriptions

| File | Purpose | Audience |
|------|---------|----------|
| `code-executor-review.md` | Explains RCE vulnerability, PoC exploits, fix plan | Security, Platform |
| `terminal-review-updated.md` | Deep terminal/PTY security analysis | Security, Backend |
| `auth-review-updated.md` | Full auth/authz subsystem review with 17 findings | Security, Backend |
| `platform-review.md` | Cross-platform abstraction layer issues | Platform, Desktop |
| `database-review-updated.md` | SQLite layer race conditions & migrations | Backend, SRE |
| `agent-kernel-review.md` | Core agent orchestration reliability | AI/Agent team |
| `agent-services-review.md` | Microservice packaging & deployment | DevOps, Backend |
| `events-review.md` | Event bus reliability gaps | Backend, Platform |
| `mcp-server-review.md` | MCP server security & packaging | Security, Integration |
| `chat-review-updated.md` | LLM chat service token management | AI/Agent team |
| `sandbox-review-updated.md` | Sandbox provider isolation analysis | Security, Platform |
| `orchestra-review-updated.md` | Stateful agent implementation flaws | AI/Agent team |

*(Files marked "updated" incorporate new findings from this review session; others are existing reviews with corrections sync'd.)*

---

## 🎯 Quick Start: Fix The Worst First

### 0. Disable RCE endpoint NOW

```typescript
// In web/app/api/code/execute/route.ts:
export const POST = async () => {
  return NextResponse.json(
    { error: 'Disabled for security audit' },
    { status: 503 }
  );
};
```

### 1. Fix auth bypasses (auth-review-updated.md CRIT-1,2,3,4)

- Apply per-user rate limiting
- Remove desktop auth bypass
- Deploy Redis blacklist
- Invalidate sessions on login

### 2. Fix terminal injection (terminal-review-updated.md CRIT-1,2)

- Switch `bash -c` → `execFile` with array args
- Implement proper shell escaping
- Add `realpath` symlink check
- Set PTY output limits

### 3. Fix packaging (agent-services-review.md)

- Build and commit `dist/` for all packages
- Add `prepublishOnly`
- Add `types` fields
- Remove duplicate logger

### 4. Fix database race (database-review-updated.md HIGH-1,2)

- Single initialization gate with mutex
- Fail startup if migrations fail (production)

### 5. Clean up npm dependencies

```bash
cd web && pnpm remove vm2 better-sqlite3 @vercel/sandbox ... # 20+ unused
```

---

## 📚 Key Evidence References

All findings traceable to specific files/lines:

```
RCE vulnerability:      web/lib/code-executor/code-executor.ts:114
Auth bypass:            web/lib/auth/enhanced-middleware.ts:158-196
Desktop impersonation:  web/lib/auth/desktop-auth-bypass.ts:37-39
Command injection:      web/lib/terminal/bash-tool.ts:269-275
Path traversal:         web/lib/terminal/security-utils.ts:33-77
Silent migration fail:  web/lib/database/connection.ts:439-466
Package broken:         packages/mcp-server/package.json (main field)
Database race:          web/lib/database/connection.ts:176-229
```

---

## ✅ Validation Checklist

Before declaring any issue "fixed":

- [ ] Code change implemented
- [ ] Unit test added (if logic change)
- [ ] Integration test passes
- [ ] Manual verification (PoC no longer works)
- [ ] No regression (existing tests still pass)
- [ ] Documentation updated (README, comments)
- [ ] Monitoring/alerting added (if reliability impact)

---

## 🔄 Review Process

This review was conducted in phases:

1. **Catalog phase** — Enumerated all modules, categorized by criticality
2. **Deep-dive phase** — Focused 1-hour analysis per high-criticality module
3. **Synthesis phase** — Compiled findings into actionable reports
4. **Index phase** — Created this master document

**Tools used:**
- Static code analysis (grep, AST scanning)
- Control flow tracing
- Threat modeling per module
- Dependency graph analysis
- Test coverage inference

---

## 📞 Questions / Follow-up

For questions on specific findings:
1. Locate module review file in `reviews/`
2. Check "Evidence" and "Remediation" sections
3. Review "Specific Line References" table if provided

For architectural questions not covered:
- See `docs/architectureUpdate.md` (existing architecture notes)
- Create new issue with "[ARCH]" prefix

---

**Report generated:** 2026-04-29  
**Total modules reviewed:** 15  
**Critical issues found:** 10  
**High-severity:** 25  
**Medium-severity:** 35  
**Estimated stabilization effort:** 12-15 developer days

**Status:** 🔴 **NOT PRODUCTION READY** — Address critical & high issues before scaling.

---

*End of Master Index*
