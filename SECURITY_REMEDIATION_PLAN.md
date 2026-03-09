# Security Vulnerability Remediation Plan

**Audit Date**: 2026-03-06  
**Auditor**: Corridor Security  
**Status**: IN PROGRESS

---

## 🔴 CRITICAL (Immediate Action Required)

### ✅ 1. Hardcoded JWT Secret Fallback
- **File**: `app/api/user/keys/route.ts`
- **Status**: FIXED
- **Fix**: Removed default fallback, now fails closed if JWT_SECRET not set
- **Commit**: Security fix 2026-03-06

### ✅ 2. Insecure Default Secrets in docker-compose.yml
- **File**: `docker-compose.yml`
- **Status**: FIXED
- **Fix**: Changed from `${VAR:-default}` to `${VAR:?error message}` - fails if not set
- **Commit**: Security fix 2026-03-06

### ✅ 3. CLI Installer Unauthenticated RCE
- **File**: `app/api/cli-install/route.ts`
- **Status**: FIXED
- **Fix**: Added JWT authentication requirement + fail-closed in production
- **Commit**: Security fix 2026-03-06

### ✅ 4. WebSocket Terminal Authentication Bypass
- **File**: `server.ts`, `hooks/use-websocket-terminal.ts`
- **Status**: FIXED
- **Fix**: 
  - JWT token validation required
  - Sandbox ownership verification
  - Token via Authorization header (not URL)
- **Commit**: Security fix 2026-03-06

### ⚠️ 5. Authenticated RCE via WebSocket Terminal on Host
- **File**: `lib/backend/websocket-terminal.ts`
- **Status**: PARTIALLY FIXED
- **Issue**: Terminal spawns `/bin/bash` on host without container isolation
- **Mitigation**: Authentication + ownership checks prevent unauthorized access
- **Remaining Work**: 
  - [ ] Run terminal in container/chroot isolation
  - [ ] Restrict to user workspace directory
  - [ ] Add command filtering/auditing

### ⚠️ 6. Insecure Session Authentication
- **File**: `lib/auth/enhanced-auth-helper.ts` (or similar)
- **Status**: NEEDS FIX
- **Issue**: session_id cookie treated as auth without server verification
- **Fix Required**: 
  - Implement server-side session validation
  - Use HttpOnly, Secure, SameSite cookies
  - Add session expiration/rotation

### ⚠️ 7. Unauthenticated MCP Servers
- **Files**: `lib/mcp/mcp-cli-server.ts`, `lib/mcp/tool-server.ts`
- **Status**: NEEDS FIX
- **Issue**: /tools, /discover, /call endpoints have no auth
- **Fix Required**:
  - Add JWT/API key authentication
  - Bind to 127.0.0.1 if local-only
  - Remove CORS `Access-Control-Allow-Origin: *`
  - Disable EXEC tool or require admin auth

---

## 🟠 HIGH PRIORITY

### ⚠️ 8. Improper Authorization on Docker Management APIs
- **Files**: `app/api/docker/*/route.ts` (exec, start, stop, remove, logs, containers)
- **Status**: NEEDS FIX
- **Issue**: Auth required but no ownership checks
- **Fix Required**:
  - Verify container belongs to authenticated user
  - Hide non-owned container IDs from listing
  - Restrict exec to non-sensitive utilities
  - Add audit logging

### ⚠️ 9. Missing Authentication on Workflow Execution
- **File**: `app/api/agent/workflows/route.ts`
- **Status**: NEEDS FIX
- **Issue**: Publicly reachable, triggers backend workflows
- **Fix Required**: Add `resolveRequestAuth()` check

### ⚠️ 10. Missing Authentication on Stateful Agent
- **File**: `app/api/stateful-agent/route.ts`
- **Status**: NEEDS FIX
- **Issue**: Allows unauthenticated agent/sandbox provisioning
- **Fix Required**: Add `resolveRequestAuth()` check

### ⚠️ 11. Missing Authorization on Global Quota Management
- **File**: `app/api/quota/route.ts`
- **Status**: NEEDS FIX
- **Issue**: Any auth user can reset global quotas
- **Fix Required**:
  - Admin-only authorization (check user role)
  - Audit logging for quota changes

### ⚠️ 12. Command Injection via Shell Execution
- **Files**:
  - `lib/agent/git-manager.ts` - git commands with untrusted input
  - `lib/sandbox/sandbox-manager.ts` - spawn with shell: true
  - `lib/sandbox/providers/sprites-checkpoint-manager.ts` - exec with interpolation
  - `lib/sandbox/providers/sprites-sshfs.ts` - multiple exec calls
- **Status**: NEEDS FIX
- **Fix Required**:
  - Replace `exec()` with `execFile()` or `spawn()` with arg arrays
  - Remove `shell: true` from spawn calls
  - Validate inputs with strict regex: `/^[a-zA-Z0-9._-]+$/`

### ⚠️ 13. Arbitrary Code Execution via Code Runner
- **File**: `lib/sandbox/providers/docker-code-executor.ts` (or similar)
- **Status**: NEEDS FIX
- **Issue**: Spawns interpreters with user code
- **Fix Required**:
  - Run in isolated containers
  - Resource limits (CPU, memory, time)
  - Network isolation

### ⚠️ 14. Missing Webhook Signature Enforcement
- **File**: `app/api/webhooks/composio/route.ts`
- **Status**: NEEDS FIX
- **Issue**: Accepts events without signature verification
- **Fix Required**:
  - Require COMPOSIO_WEBHOOK_SECRET
  - Verify HMAC signatures
  - Reject if secret missing

### ⚠️ 15. Cross-Tenant Data Exposure in VFS
- **File**: `lib/virtual-filesystem/resolve-filesystem-owner.ts`
- **Status**: NEEDS FIX
- **Issue**: All anon users get `ownerId: 'anon:public'` (shared namespace)
- **Fix Required**:
  - Generate unique per-session anonymous ID
  - Store in SameSite HttpOnly cookie
  - Use as ownerId for isolation

---

## 🟡 MEDIUM PRIORITY

### ⚠️ 16. Reverse Tabnabbing
- **Files**:
  - `components/plugins/archive-org-embed-plugin.tsx`
  - `components/plugins/duckduckgo-embed-plugin.tsx`
  - `components/plugins/codesandbox-embed-plugin.tsx`
- **Status**: NEEDS FIX
- **Issue**: `window.open(url, '_blank')` without noopener/noreferrer
- **Fix Required**: Add `'noopener,noreferrer'` to all window.open calls

---

## ✅ COMPLETED FIXES

### ✅ WebSocket Token in URL (CWE-598)
- **Status**: FIXED
- **Fix**: Token now sent via WebSocket subprotocol, not query params

### ✅ WebSocket Terminal Auth Bypass (CWE-306, CWE-639)
- **Status**: FIXED
- **Fix**: JWT validation + sandbox ownership verification

---

## REMEDIATION TIMELINE

| Priority | Count | Target Date | Status |
|----------|-------|-------------|--------|
| 🔴 CRITICAL | 7 | 2026-03-07 | 4 Fixed, 3 In Progress |
| 🟠 HIGH | 8 | 2026-03-10 | 0 Fixed, 8 Pending |
| 🟡 MEDIUM | 1 | 2026-03-14 | 0 Fixed, 1 Pending |

---

## IMMEDIATE ACTIONS REQUIRED

1. **Rotate ALL Secrets** - If this code was ever deployed with defaults:
   ```bash
   # Generate new secrets
   JWT_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   BLAXEL_SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)
   VISUAL_EDITOR_SECRET=$(openssl rand -hex 32)
   ```

2. **Audit Deployment** - Check if any production environment used default secrets

3. **Enable Monitoring** - Add alerts for:
   - Failed authentication attempts
   - Unauthorized access attempts
   - Unusual Docker container operations
   - Quota reset events

4. **Penetration Testing** - Schedule external security audit after fixes

---

## SECURITY TESTING CHECKLIST

- [ ] Attempt CLI install without JWT token (should fail)
- [ ] Attempt WebSocket connection without valid token (should fail)
- [ ] Attempt to access another user's sandbox (should fail)
- [ ] Attempt Docker operations on non-owned containers (should fail)
- [ ] Attempt workflow execution without auth (should fail)
- [ ] Attempt to use default JWT secret (should fail)
- [ ] Verify all secrets are required in docker-compose (should fail if missing)
- [ ] Test command injection in git operations (should be sanitized)
- [ ] Test anonymous VFS isolation (should have unique IDs)

---

## NOTES

- All authentication checks should use existing `resolveRequestAuth()` or `verifyAuth()` helpers
- Authorization should verify resource ownership before any write/exec/delete operations
- Fail-closed behavior: If secrets/config missing, reject requests rather than defaulting to insecure behavior
- Never log tokens, secrets, or sensitive query parameters
- Use parameterized commands (arg arrays) instead of shell string interpolation
