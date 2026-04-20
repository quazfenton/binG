---
id: github-oauth-correct-configuration
title: ✅ GitHub OAuth - Correct Configuration
aliases:
  - github-oauth-correct-config
  - github-oauth-correct-config.md
  - github-oauth-correct-configuration
  - github-oauth-correct-configuration.md
tags:
  - auth
layer: core
summary: "# ✅ GitHub OAuth - Correct Configuration\r\n\r\n## Callback URLs (CRITICAL!)\r\n\r\n### Auth0 Dashboard → Application Settings\r\n\r\n**Allowed Callback URLs:**\r\n```\r\nhttp://localhost:3000/auth/callback\r\nhttps://yourdomain.com/auth/callback\r\n```\r\n\r\n⚠️ **NOT** `/api/auth0/callback` - The Auth0 SDK v4 handles `/a"
anchors:
  - Callback URLs (CRITICAL!)
  - Auth0 Dashboard → Application Settings
  - GitHub OAuth App Setup
  - If Using Auth0's GitHub Connection (RECOMMENDED)
  - .env.local Configuration
  - OAuth URLs in Components
  - Settings.tsx - Basic Login
  - Git Source Control - Full Access
  - Testing
  - 1. Verify Auth0 Settings
  - 2. Verify Auth0 Social Connection
  - 3. Test Login
  - Common Mistakes
  - ❌ WRONG Callback URL
  - ✅ CORRECT Callback URL
  - Summary
---
# ✅ GitHub OAuth - Correct Configuration

## Callback URLs (CRITICAL!)

### Auth0 Dashboard → Application Settings

**Allowed Callback URLs:**
```
http://localhost:3000/auth/callback
https://yourdomain.com/auth/callback
```

⚠️ **NOT** `/api/auth0/callback` - The Auth0 SDK v4 handles `/auth/callback` automatically!

---

## GitHub OAuth App Setup

### If Using Auth0's GitHub Connection (RECOMMENDED)

**GitHub Dashboard → Developer Settings → OAuth Apps:**

```
Application name: binG
Homepage URL: http://localhost:3000
Authorization callback URL: https://YOUR_AUTH0_DOMAIN/authorize
  Example: https://dev-xxxxx.us.auth0.com/authorize
```

**Flow:**
```
Our App → Auth0 → GitHub → Auth0 → /auth/callback → Our App
```

Auth0 handles the GitHub OAuth internally, then redirects to our `/auth/callback`.

---

## .env.local Configuration

```env
# Auth0 (REQUIRED)
AUTH0_DOMAIN=dev-xxxxx.us.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_SECRET=your-secret
AUTH0_BASE_URL=http://localhost:3000

# GitHub (NOT NEEDED when using Auth0 connection)
# The GitHub OAuth is handled by Auth0's social connection
```

---

## OAuth URLs in Components

### Settings.tsx - Basic Login
```tsx
// Line 1520
window.location.href = '/auth/login?connection=github'
```

### Git Source Control - Full Access
```tsx
// git-source-control-tabs.tsx:176
const scopes = ['repo', 'user', 'workflow'];
window.location.href = `/auth/login?connection=github&scope=${encodeURIComponent(scopes.join(' '))}`;
```

Both use `/auth/login` - the middleware handles everything!

---

## Testing

### 1. Verify Auth0 Settings
```
Auth0 Dashboard → Applications → binG → Settings

Allowed Callback URLs:
  ✓ http://localhost:3000/auth/callback

Allowed Logout URLs:
  ✓ http://localhost:3000

Allowed Web Origins:
  ✓ http://localhost:3000
```

### 2. Verify Auth0 Social Connection
```
Auth0 Dashboard → Authentication → Social → GitHub
  - Enabled: ✓
  - Client ID: (from GitHub OAuth App)
  - Client Secret: (from GitHub OAuth App)
```

### 3. Test Login
1. Go to Settings → Connected Accounts
2. Click "Sign in with GitHub"
3. Should redirect to GitHub
4. Authorize
5. Should return to `/settings?github_connected=true`

---

## Common Mistakes

### ❌ WRONG Callback URL
```
http://localhost:3000/api/auth0/callback  ← WRONG!
http://localhost:3000/api/github/callback ← WRONG!
http://localhost:3000/api/integrations/github/oauth/callback ← WRONG!
```

### ✅ CORRECT Callback URL
```
http://localhost:3000/auth/callback  ← CORRECT!
```

The Auth0 SDK v4 automatically handles `/auth/callback` via middleware - no route file needed!

---

## Summary

| Setting | Value |
|---------|-------|
| **Our Login URL** | `/auth/login?connection=github` |
| **Our Callback** | `/auth/callback` (auto-handled) |
| **Auth0 Allowed Callback** | `http://localhost:3000/auth/callback` |
| **GitHub OAuth Callback** | `https://AUTH0_DOMAIN/authorize` |
| **Env Variable** | `AUTH0_BASE_URL=http://localhost:3000` |

---

**Status:** ✅ Verified with Google OAuth pattern  
**Callback:** `/auth/callback` (not `/api/auth0/callback`)  
**Handler:** Auth0 SDK middleware (automatic)
