# Auth Module Deep Review

**Date:** February 28, 2026  
**Module:** `lib/auth/`  
**Security Level:** 🔴 CRITICAL  
**Review Status:** ✅ COMPLETE

---

## Executive Summary

The auth module is **well-structured** with good security practices, but has several areas that need attention:

### Overall Score: **7.5/10** ⭐⭐⭐⭐

| Component | Score | Status |
|-----------|-------|--------|
| JWT Implementation | 8/10 | ✅ Good |
| Password Security | 9/10 | ✅ Excellent |
| Session Management | 8/10 | ✅ Good |
| OAuth Service | 7/10 | ⚠️ Needs Work |
| Request Auth | 7/10 | ⚠️ Needs Work |
| Account Lockout | 9/10 | ✅ Excellent |

---

## Detailed Review

### 1. JWT Implementation (`jwt.ts`)

#### ✅ Strengths
- **Environment validation** for JWT_SECRET in production
- **Algorithm enforcement** (HS256 only)
- **Issuer/audience validation**
- **Detailed error messages** for different JWT errors
- **Token expiration handling**

#### ⚠️ Issues Found

**1. Development Secret Hardcoded**
```typescript
const DEVELOPMENT_SECRET = 'your-secret-key-change-in-production';
```
- **Risk:** Developers might forget to change in staging
- **Fix:** Generate random secret on startup for dev

**2. Missing Token Rotation**
- No refresh token mechanism
- 7-day tokens are static
- **Risk:** Stolen tokens valid for 7 days

**3. No Token Blacklist**
- Revoked tokens remain valid until expiry
- **Risk:** Logout doesn't fully invalidate tokens

#### 🔧 Recommended Fixes

```typescript
// 1. Generate random dev secret
const DEVELOPMENT_SECRET = process.env.NODE_ENV === 'production' 
  ? undefined 
  : crypto.randomBytes(32).toString('hex');

// 2. Add token version for rotation
export interface JwtPayload {
  userId: string;
  email: string;
  tokenVersion: number; // Increment on password change
}

// 3. Add token blacklist
const tokenBlacklist = new Set<string>();
export function blacklistToken(token: string, expiresAt: Date) {
  tokenBlacklist.add(token);
  setTimeout(() => tokenBlacklist.delete(token), expiresAt.getTime() - Date.now());
}
```

---

### 2. Auth Service (`auth-service.ts`)

#### ✅ Strengths
- **Strong password requirements** (8+ chars, uppercase, lowercase, numbers)
- **Bcrypt with 12 rounds** (industry standard)
- **Account lockout** after 5 failed attempts
- **30-minute lockout duration**
- **Email verification** flow
- **Session token hashing** with HMAC-SHA256
- **Cache invalidation** on logout

#### ⚠️ Issues Found

**1. Missing Rate Limiting on Registration**
```typescript
async register(credentials: RegisterCredentials) {
  // No rate limiting!
  // Could be abused for email bombing
}
```

**2. Session ID Not Hashed Before Storage**
```typescript
const sessionId = uuidv4();
this.dbOps.createSession(sessionId, ...); // Stored raw
```
Comment says "not hashed" but this is inconsistent with the hashSessionToken function.

**3. No IP-based Rate Limiting**
- Lockout is per-email only
- **Risk:** Distributed brute-force attacks

**4. Missing Password History**
- Users can reuse old passwords
- **Risk:** Compromised passwords remain useful

**5. No 2FA Support**
- No TOTP/WebAuthn
- **Risk:** Single factor authentication

#### 🔧 Recommended Fixes

```typescript
// 1. Add registration rate limiting
const registrationAttempts = new Map<string, number>(); // IP -> count
async register(credentials, ip) {
  const attempts = registrationAttempts.get(ip) || 0;
  if (attempts > 5) throw new Error('Too many registration attempts');
  registrationAttempts.set(ip, attempts + 1);
}

// 2. Hash session IDs consistently
const sessionId = uuidv4();
const hashedSessionId = hashSessionToken(sessionId);
this.dbOps.createSession(hashedSessionId, ...);

// 3. Add IP-based rate limiting
const ipFailedLogins = new Map<string, { count: number; resetAt: number }>();
function checkIpRateLimit(ip: string) {
  const record = ipFailedLogins.get(ip);
  if (record && Date.now() < record.resetAt && record.count >= 10) {
    return { allowed: false, retryAfter: record.resetAt - Date.now() };
  }
  return { allowed: true };
}

// 4. Add password history
const PASSWORD_HISTORY_SIZE = 5;
async function checkPasswordHistory(userId: number, newPassword: string) {
  const history = await getPasswordHistory(userId, PASSWORD_HISTORY_SIZE);
  for (const oldHash of history) {
    if (await bcrypt.compare(newPassword, oldHash)) {
      return false; // Password reused
    }
  }
  return true;
}
```

---

### 3. Request Auth (`request-auth.ts`)

#### ✅ Strengths
- **Multi-factor auth** (JWT, session, anonymous)
- **LRU cache** with 5-minute TTL
- **Cache size limit** (1000 entries)
- **Cache invalidation** on logout
- **Error message sanitization**

#### ⚠️ Issues Found

**1. Cache Key Collision Risk**
```typescript
// BEFORE (vulnerable)
const cacheKey = `auth:${authHeader}`;

// AFTER (fixed)
const cacheKey = `auth:${authHeader}:${sessionId}:${anonId}`;
```
✅ Already fixed in code!

**2. Anonymous Auth Too Permissive**
```typescript
if (allowAnonymous) {
  const anonId = normalizeAnonymousId(anonRaw);
  if (anonId) {
    return { success: true, userId: `anon:${anonId}` };
  }
}
```
- **Risk:** Any string becomes a valid user ID
- **No validation** of anonymous session ownership

**3. Missing Auth Audit Logging**
- No logging of auth attempts
- **Risk:** Can't detect attack patterns

#### 🔧 Recommended Fixes

```typescript
// 2. Add anonymous session validation
interface AnonymousSession {
  id: string;
  createdAt: number;
  lastActivity: number;
  ipAddress: string;
}
const anonymousSessions = new Map<string, AnonymousSession>();

function validateAnonymousSession(anonId: string, ip: string) {
  const session = anonymousSessions.get(anonId);
  if (!session) return false;
  // Check IP matches or is from same subnet
  // Check session hasn't expired (24 hours)
  return Date.now() - session.lastActivity < 24 * 60 * 60 * 1000;
}

// 3. Add auth audit logging
interface AuthAuditLog {
  timestamp: Date;
  userId?: string;
  source: 'jwt' | 'session' | 'anonymous';
  success: boolean;
  ipAddress: string;
  userAgent: string;
  failureReason?: string;
}
const authAuditLog: AuthAuditLog[] = [];

function logAuthAttempt(log: AuthAuditLog) {
  authAuditLog.push(log);
  // Keep only last 10000 entries
  if (authAuditLog.length > 10000) authAuditLog.shift();
}
```

---

### 4. OAuth Service (`oauth-service.ts`)

#### ✅ Strengths
- **AES-256-GCM encryption** for tokens
- **Proper IV generation** (12 bytes per NIST)
- **Database encryption** at rest
- **Token expiration tracking**
- **Connection management** (revoke, list)

#### ⚠️ Issues Found

**1. Missing Token Refresh Logic**
```typescript
async getUserConnections(userId: number) {
  // Returns connections but doesn't check token expiry
  // No automatic token refresh
}
```

**2. No PKCE Support**
- OAuth flow vulnerable to authorization code interception
- **Risk:** Token theft via MITM

**3. Missing Scope Validation**
```typescript
scopes: string[]; // Stored but never validated
```

**4. No Connection Health Checks**
- Revoked external connections not detected
- **Risk:** Using invalid tokens

**5. Encryption Key Validation**
```typescript
if (!key) throw new Error('TOKEN_ENCRYPTION_KEY required');
// But no validation of key strength
```

#### 🔧 Recommended Fixes

```typescript
// 1. Add automatic token refresh
async function getValidAccessToken(connectionId: number, userId: number) {
  const connection = await getConnection(connectionId, userId);
  
  // Refresh if expires within 5 minutes
  if (connection.tokenExpiresAt && 
      connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    await refreshAccessToken(connection);
  }
  
  return decrypt(connection.access_token_encrypted);
}

// 2. Add PKCE support
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// 3. Add scope validation
async function requestWithScopes(connectionId: number, requiredScopes: string[]) {
  const connection = await getConnection(connectionId);
  const hasScopes = requiredScopes.every(s => connection.scopes.includes(s));
  if (!hasScopes) {
    throw new Error(`Missing required scopes: ${requiredScopes.join(', ')}`);
  }
}

// 4. Add connection health check
async function checkConnectionHealth(connectionId: number) {
  try {
    // Make test API call to provider
    await testProviderConnection(connectionId);
    return { healthy: true };
  } catch {
    // Mark as inactive
    await revokeConnection(connectionId);
    return { healthy: false };
  }
}

// 5. Validate encryption key strength
function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY required');
  
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  
  // Check entropy (basic check for weak keys)
  const uniqueBytes = new Set(buf).size;
  if (uniqueBytes < 16) {
    throw new Error('TOKEN_ENCRYPTION_KEY has insufficient entropy');
  }
  
  return buf;
}
```

---

## Security Vulnerabilities Summary

### High Priority

| Issue | Severity | Impact | Fix Time |
|-------|----------|--------|----------|
| No token blacklist | 🔴 High | Stolen tokens remain valid | 1 hour |
| Missing PKCE | 🔴 High | Authorization code interception | 2 hours |
| No token refresh | 🔴 High | Sessions expire unexpectedly | 2 hours |

### Medium Priority

| Issue | Severity | Impact | Fix Time |
|-------|----------|--------|----------|
| No registration rate limiting | 🟡 Medium | Email bombing | 1 hour |
| No IP-based rate limiting | 🟡 Medium | Distributed brute-force | 2 hours |
| No password history | 🟡 Medium | Password reuse | 1 hour |
| Anonymous auth too permissive | 🟡 Medium | Session hijacking | 1 hour |

### Low Priority

| Issue | Severity | Impact | Fix Time |
|-------|----------|--------|----------|
| Hardcoded dev secret | 🟢 Low | Dev/prod confusion | 30 min |
| No auth audit logging | 🟢 Low | Attack detection | 2 hours |
| No connection health checks | 🟢 Low | Stale connections | 1 hour |

---

## Code Quality Issues

### 1. Inconsistent Error Handling

```typescript
// Some functions return error objects
return { success: false, error: 'Invalid email' };

// Others throw
throw new Error('JWT_SECRET must be set');
```

**Recommendation:** Standardize on one pattern (prefer throwing for unexpected errors).

### 2. Missing Type Safety

```typescript
const dbUser = this.dbOps.getUserByEmail(credentials.email) as any;
```

**Recommendation:** Add proper TypeScript types for database rows.

### 3. No Unit Tests

**Critical module with zero test coverage!**

**Recommendation:** Add tests for:
- Password validation
- Account lockout logic
- JWT verification
- Session management
- OAuth encryption/decryption

---

## Recommendations by Priority

### Immediate (This Week)
1. ✅ Add token blacklist mechanism
2. ✅ Implement PKCE for OAuth flows
3. ✅ Add automatic token refresh
4. ✅ Add registration rate limiting

### Short-term (This Month)
5. Add IP-based rate limiting
6. Implement password history
7. Add auth audit logging
8. Add connection health checks
9. Write comprehensive unit tests

### Long-term (Next Quarter)
10. Implement 2FA (TOTP/WebAuthn)
11. Add session management UI
12. Implement device fingerprinting
13. Add suspicious activity detection
14. Implement OAuth account linking

---

## Testing Checklist

### Unit Tests Needed
- [ ] Password validation (strength requirements)
- [ ] Account lockout logic
- [ ] JWT generation and verification
- [ ] Session creation and validation
- [ ] Token encryption/decryption
- [ ] Rate limiting logic
- [ ] Cache invalidation

### Integration Tests Needed
- [ ] Full registration flow
- [ ] Login with lockout
- [ ] OAuth connection flow
- [ ] Token refresh flow
- [ ] Logout and cache invalidation

### Security Tests Needed
- [ ] Brute-force attack simulation
- [ ] Token theft simulation
- [ ] Session hijacking attempt
- [ ] SQL injection attempt
- [ ] XSS in error messages

---

## Files to Modify

1. **`lib/auth/jwt.ts`**
   - Add token blacklist
   - Add token version for rotation
   - Generate random dev secret

2. **`lib/auth/auth-service.ts`**
   - Add registration rate limiting
   - Add IP-based rate limiting
   - Add password history
   - Hash session IDs consistently

3. **`lib/auth/request-auth.ts`**
   - ✅ Cache key collision fixed
   - Add anonymous session validation
   - Add auth audit logging

4. **`lib/auth/oauth-service.ts`**
   - Add PKCE support
   - Add token refresh logic
   - Add scope validation
   - Add connection health checks

5. **NEW: `lib/auth/auth-audit.ts`**
   - Auth audit logging
   - Suspicious activity detection

6. **NEW: `__tests__/auth/*.test.ts`**
   - Comprehensive test suite

---

## Conclusion

The auth module has a **solid foundation** with good security practices:
- ✅ Strong password requirements
- ✅ Account lockout protection
- ✅ Session token hashing
- ✅ Cache invalidation on logout

However, several **critical improvements** are needed:
- 🔴 Token blacklist for immediate revocation
- 🔴 PKCE for OAuth security
- 🔴 Automatic token refresh
- 🔴 Rate limiting on registration

**Overall Risk Level:** 🟡 MEDIUM
- Production-ready with current implementation
- Recommended fixes before scaling

---

**Review Date:** 2026-02-28  
**Reviewer:** AI Code Review System  
**Next Review:** 2026-03-28 (after fixes)
