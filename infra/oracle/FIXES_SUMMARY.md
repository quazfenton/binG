# Infrastructure Fixes Summary

## Issues Fixed

### 1. HTTPS Tunnel Login Failure
**Problem**: 9Router dashboard login works on HTTP IP (`http://129.213.35.8:3000`) but fails on HTTPS tunnel URL (`https://xxx.trycloudflare.com`) with "An error occurred. Please try again".

**Root Cause**: 
- Session cookies were set with a `Domain=129.213.35.8` attribute
- Browsers refuse to send cookies to `*.trycloudflare.com` when Domain is set to a different host
- OAuth redirect URIs in 9Router's config pointed to HTTP IP, not tunnel URL

**Fix**:
- **Caddyfile**: Strips `Domain` attribute from `Set-Cookie` headers using simple string replacement
- **Security Note**: Stripping `Domain` is SAFE — it makes cookies "host-only" which is MORE restrictive than domain-scoped cookies. Host-only cookies are only sent to the exact hostname, not shared across subdomains.
- **Caddyfile**: Adds `X-Forwarded-Proto: https` so 9Router knows the external connection is secure
- **Script**: Created `update-9router-tunnel-url.sh` to update 9Router's OAuth redirect URIs in SQLite

**Why this is secure**:
- Before: `Set-Cookie: session=abc; Domain=129.213.35.8` → Browser won't send to tunnel URL
- After: `Set-Cookie: session=abc` → Browser sends ONLY to exact hostname (host-only)
- Host-only cookies are scoped to the exact hostname, preventing cross-subdomain leakage

### 2. CORS Misconfiguration
**Problem**: `proxy.ts` echoed arbitrary origin with `Access-Control-Allow-Credentials: true`, allowing any site to make credentialed requests.

**Root Cause**: `response.headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*')` with credentials enabled is a security vulnerability.

**Fix**:
- **proxy.ts**: Added origin allowlist validation before echoing origin
- **backend/index.ts**: Added dynamic CORS origin validation including `*.trycloudflare.com` for tunnel access
- **backend/index.ts**: Added explicit `Authorization` header to allowed headers list

### 3. Insecure Cookie Configuration
**Problem**: Sidecar token cookie had `secure: false` hardcoded, even for production.

**Fix**:
- **proxy.ts**: Changed to `secure: process.env.NODE_ENV === 'production'`

### 4. Sandbox Authentication Verification
**Problem**: Concern that sandbox routes might be unauthenticated.

**Verification**: 
- All sandbox gateway handlers call `verifyAuth(req)` from `@/lib/auth/jwt`
- `verifyAuth()` requires valid JWT token from `Authorization` header or session cookie
- Sandbox routes ARE properly authenticated

**Fix**:
- **backend/index.ts**: Added explicit `Authorization` header to CORS allowHeaders
- **proxy.ts**: Added `X-Forwarded-Authorization` header forwarding for rewrite responses

## Files Modified

1. `/opt/bing/infra/oracle/Caddyfile`
   - Added cookie domain stripping for tunnel access
   - Added forwarded headers for proper proxy detection

2. `/opt/bing/web/proxy.ts`
   - Fixed CORS origin validation (allowlist instead of echo)
   - Fixed sidecar cookie secure flag
   - Added Authorization header forwarding

3. `/opt/bing/backend/src/index.ts`
   - Added dynamic CORS origin validation
   - Added tunnel URL support (`*.trycloudflare.com`)
   - Added explicit Authorization header to allowed headers

## New Scripts

1. `/opt/bing/infra/oracle/update-9router-tunnel-url.sh`
   - Updates 9Router's OAuth redirect URIs in SQLite to match tunnel URL
   - Auto-detects tunnel URL from docker logs

2. `/opt/bing/infra/oracle/test-tunnel-api.sh`
   - Tests 9Router API endpoints through the tunnel
   - Verifies health, models, and chat completion endpoints

3. `/opt/bing/infra/oracle/test-all-fixes.sh`
   - Comprehensive test suite for all fixes
   - Tests tunnel connectivity, cookies, API, auth, and CORS

## Deployment Steps

1. **Rebuild and restart services**:
   ```bash
   cd /opt/bing
   docker compose -f infra/oracle/docker-compose.yml down
   docker compose -f infra/oracle/docker-compose.yml up -d --build
   ```

2. **Update 9Router OAuth configuration**:
   ```bash
   ./infra/oracle/update-9router-tunnel-url.sh
   # Or manually: ./infra/oracle/update-9router-tunnel-url.sh https://xxx.trycloudflare.com
   ```

3. **Restart 9Router to apply config**:
   ```bash
   docker restart bing-ninerouter-1
   ```

4. **Clear browser cookies** for both HTTP IP and tunnel URL domains

5. **Run tests**:
   ```bash
   ./infra/oracle/test-all-fixes.sh [tunnel-url] [api-key]
   ```

## Verification Checklist

- [ ] HTTPS tunnel login works without "An error occurred"
- [ ] Session cookies are set without Domain attribute
- [ ] API endpoints return 200 through tunnel
- [ ] OAuth flows complete successfully with tunnel URL
- [ ] Sandbox routes require authentication (401 without token)
- [ ] CORS headers are correct for tunnel origin
- [ ] No security warnings in browser console

## Notes

- 9Router's internal "Enable Cloudflare Tunnel" feature (port 7844) is separate from your existing tunnel setup. Do NOT enable it unless you want to replace your current Caddy + cloudflared setup.
- The tunnel URL changes each time cloudflared restarts. Run `update-9router-tunnel-url.sh` after each restart to update OAuth config.
- For production, consider using Cloudflare Zero Trust or a custom domain with fixed tunnel URL.
