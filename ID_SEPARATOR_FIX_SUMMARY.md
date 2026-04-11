# ID Separator Fix Summary

## Security Issue: `lastIndexOf` vs `indexOf` for `$` and `:` Separators

### The Problem
If a user names a folder or file with `$` or `:` (e.g., `my$project` or `config:v2`), using `lastIndexOf` or `split().pop()` to extract the userId/sessionId would **incorrectly split at the user-provided character**, causing:
- **Cross-session data leaks** — extracting wrong userId
- **Invalid folder names** — extracting wrong sessionId
- **Security vulnerability** — reading/writing to wrong user's workspace

### The Fix
**Always use `indexOf` (FIRST occurrence)** not `lastIndexOf` or `split().pop()`, because:
- **userId is system-controlled** and **NEVER contains `$` or `:`**
- **sessionId/conversationId MAY contain user-provided `$` or `:`** in folder/file names
- The **FIRST separator** is always our system separator

### Example
Composite: `1$my$project`
- `indexOf('$')` → position 1 → userId=`1`, sessionId=`my$project` ✅ **CORRECT**
- `lastIndexOf('$')` → position 6 → userId=`1$my`, sessionId=`project` ❌ **SECURITY BUG**

---

## Files Fixed

### 1. MCP Route (`web/app/api/mcp/route.ts`)
- **Line 273-274**: Changed `anon:${simpleSessionId}` → `buildCompositeSessionId('anon', simpleSessionId)`
- **Import added**: `buildCompositeSessionId, buildScopePath, extractSimpleSessionId` from `@/lib/identity`
- **userId**: Now correctly set to `'anon'` instead of using composite as userId

### 2. Session Manager (`web/lib/session/session-manager.ts`)
- **Lines 708-731**: Idle session cleanup — changed from `lastIndexOf` to `indexOf` for both `$` and `:`
- **Lines 934-957**: Shutdown cleanup — same fix

### 3. Shadow Commit Manager (`web/lib/orchestra/stateful-agent/commit/shadow-commit.ts`)
- **Lines 168-192**: ownerId extraction from sessionId — changed from `lastIndexOf` to `indexOf`
- **Lines 471-487**: Rollback ownerId extraction — changed from `split()` to `indexOf`

### 4. Stateful Agent (`web/lib/orchestra/stateful-agent/agents/stateful-agent.ts`)
- **Lines 192-211**: conversationId extraction — changed from `lastIndexOf(':')` to `indexOf` for both `$` and `:`

### 5. ID Normalization (`web/lib/virtual-filesystem/id-normalization.ts`)
- **Lines 41-78**: `extractSessionIdFromOwnerId` and `extractUserIdFromOwnerId` — changed from `split().pop()` and `split()[0]` to `indexOf`

### 6. Git Rollback Route (`web/app/api/gateway/git/[sessionId]/rollback/route.ts`)
- **Lines 94-112**: conversationId extraction — changed from `split().pop()` to `indexOf`

### 7. VFS Hooks (`web/hooks/use-virtual-filesystem.ts`)
- **Lines 222-238**: `deriveSessionFolderFromComposite` — changed from `split().pop()` to `indexOf`
- **Lines 275-293**: `getOwnerId` — changed from `split()[0]` to `indexOf`
- **Lines 507-525**: `extractSessionPart` — changed from `split().pop()` to `indexOf`

### 8. Snapshot Route (`web/app/api/filesystem/snapshot/route.ts`)
- **Lines 39-51**: Cache cleanup — changed from `split(':')[0]` to `indexOf`
- **Lines 63-75**: Size limit cleanup — same fix

### 9. Cloud FS Manager (`web/lib/virtual-filesystem/cloud-fs-manager.ts`)
- **Lines 307-318**: Cache invalidation (single file) — changed from `split(':')[1]` to `indexOf`
- **Lines 374-387**: Cache invalidation (batch files) — same fix

### 10. Identity Module (`web/lib/identity/composite-session-id.ts`)
- **Lines 100-153**: `extractSimpleSessionId` and `extractUserIdFromComposite` — already had security comments, verified using `indexOf`

---

## Files NOT Changed (Intentional)

These use `split(':')` for **non-session-ID purposes** and are correct:
- `crypto.ts` — Encrypted data format (`salt:iv:authTag:encrypted`)
- `database/connection.ts` — Encrypted credentials
- `oauth-service.ts` — OAuth token format
- `lock-metrics.ts` — STATSD host:port parsing
- UI components — Provider:model parsing
- `smithery.ts` — Tool name parsing
- `deprecated/` — Deprecated code

---

## Security Impact

Before this fix, a malicious or accidental user-provided `$` or `:` in a folder/file name could cause:
1. **Data leakage** — Reading another user's session data
2. **Data corruption** — Writing to wrong user's workspace
3. **Authorization bypass** — Extracting wrong userId for ownership checks

After this fix:
- userId is **always correctly extracted** as the FIRST part before the FIRST separator
- sessionId correctly includes any user-provided `$` or `:` characters
- Cross-session isolation is **guaranteed**

---

*Fix applied: 2026-04-11*
*Files modified: 9*
*Security vulnerability: Cross-session data leak via user-provided separators*
