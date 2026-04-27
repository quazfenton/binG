---
id: unified-oauth-connection-pattern
title: ✅ Unified OAuth Connection Pattern
aliases:
  - unified-oauth-connection-pattern
  - unified-oauth-connection-pattern.md
tags:
  - auth
layer: core
summary: "# ✅ Unified OAuth Connection Pattern\r\n\r\n## Simple Connection URLs\r\n\r\nAll OAuth connections now use the **same simple pattern** for modularity:\r\n\r\n```\r\n/auth/login?connection={provider}\r\n```\r\n\r\n---\r\n\r\n## Supported Providers\r\n\r\n| Provider | Connection URL | Auth0 Connection Name |\r\n|----------|-------"
anchors:
  - Simple Connection URLs
  - Supported Providers
  - Usage Examples
  - Component Button (Google)
  - Component Button (GitHub)
  - Programmatic (with scopes)
  - How It Works
  - 1. User Clicks Connection Link
  - 2. Middleware Intercepts
  - 3. Auth0 Handles OAuth Flow
  - 4. Post-Callback (Optional)
  - Benefits of Unified Pattern
  - ✅ Modularity
  - ✅ Simplicity
  - ✅ Maintainability
  - ✅ Flexibility
  - Migration from Custom OAuth Endpoints
  - Old Pattern (DEPRECATED)
  - New Pattern (RECOMMENDED)
  - Custom Scopes
  - GitHub (Default Scopes)
  - Google (Default Scopes)
  - Error Handling
  - Connection Already Exists
  - User Cancels
  - Invalid Connection
  - Testing
  - Test All Providers
  - Auth0 Dashboard Configuration
  - Required Settings
  - Summary
---
# ✅ Unified OAuth Connection Pattern

## Simple Connection URLs

All OAuth connections now use the **same simple pattern** for modularity:

```
/auth/login?connection={provider}
```

---

## Supported Providers

| Provider | Connection URL | Auth0 Connection Name |
|----------|---------------|----------------------|
| **Google** | `/auth/login?connection=google-oauth2` | `google-oauth2` |
| **GitHub** | `/auth/login?connection=github` | `github` |
| **Microsoft** | `/auth/login?connection=windowslive` | `windowslive` |
| **Facebook** | `/auth/login?connection=facebook` | `facebook` |
| **Twitter** | `/auth/login?connection=twitter` | `twitter` |
| **LinkedIn** | `/auth/login?connection=linkedin` | `linkedin` |
| **Apple** | `/auth/login?connection=apple` | `apple` |

---

## Usage Examples

### Component Button (Google)
```tsx
<Button
  onClick={() => window.location.href = '/auth/login?connection=google-oauth2'}
>
  Sign in with Google
</Button>
```

### Component Button (GitHub)
```tsx
<Button
  onClick={() => window.location.href = '/auth/login?connection=github'}
>
  Sign in with GitHub
</Button>
```

### Programmatic (with scopes)
```tsx
// For extended permissions
const scopes = ['repo', 'user', 'workflow'];
window.location.href = `/auth/login?connection=github&scope=${encodeURIComponent(scopes.join(' '))}`;
```

---

## How It Works

### 1. User Clicks Connection Link
```
/auth/login?connection=github
```

### 2. Middleware Intercepts
`middleware.ts` catches `/auth/login` requests and forwards to Auth0 SDK:

```typescript
// middleware.ts:36
if (request.nextUrl.pathname.startsWith('/auth/')) {
  // Query parameters (like ?connection=github) are automatically forwarded
  const auth0Response = await auth0.middleware(request);
  return auth0Response;
}
```

### 3. Auth0 Handles OAuth Flow
- Redirects to GitHub
- User authorizes
- Callback to `/api/auth0/callback`
- Session created

### 4. Post-Callback (Optional)
For mapping to local user account:
```
POST /api/auth0/post-callback
{
  auth0UserId: "...",
  email: "user@example.com",
  connectedAccount: { provider: "github", id: "..." }
}
```

---

## Benefits of Unified Pattern

### ✅ Modularity
- Same pattern for all providers
- Easy to add new providers
- Consistent UX across integrations

### ✅ Simplicity
- No complex API endpoints
- No custom OAuth flow code per provider
- Single middleware handles all

### ✅ Maintainability
- One place to update (middleware)
- Consistent error handling
- Unified logging

### ✅ Flexibility
- Add scopes via query params
- Add custom params via query string
- Works with existing Auth0 connections

---

## Migration from Custom OAuth Endpoints

### Old Pattern (DEPRECATED)
```tsx
// ❌ Old - Custom endpoint
window.location.href = '/api/integrations/github/oauth/authorize'
```

### New Pattern (RECOMMENDED)
```tsx
// ✅ New - Unified pattern
window.location.href = '/auth/login?connection=github'
```

---

## Custom Scopes

For providers requiring extended permissions:

### GitHub (Default Scopes)
```tsx
// Basic connection (read-only public data)
window.location.href = '/auth/login?connection=github'

// Extended scopes (repo access, etc.)
const scopes = ['repo', 'user:email', 'workflow'];
window.location.href = `/auth/login?connection=github&scope=${encodeURIComponent(scopes.join(' '))}`;
```

### Google (Default Scopes)
```tsx
// Basic connection (profile, email)
window.location.href = '/auth/login?connection=google-oauth2'

// Extended scopes (Drive, Gmail, etc.)
const scopes = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly'
];
window.location.href = `/auth/login?connection=google-oauth2&scope=${encodeURIComponent(scopes.join(' '))}`;
```

---

## Error Handling

### Connection Already Exists
```typescript
// Auth0 will show account linking prompt
// Handle in post-callback
```

### User Cancels
```typescript
// Redirects to /auth/error
// Check for error query param
```

### Invalid Connection
```typescript
// Auth0 returns error
// Middleware catches and redirects to /auth/error
```

---

## Testing

### Test All Providers
```tsx
// Settings component or test page
const providers = [
  { name: 'Google', connection: 'google-oauth2' },
  { name: 'GitHub', connection: 'github' },
  { name: 'Microsoft', connection: 'windowslive' },
  { name: 'Facebook', connection: 'facebook' },
  { name: 'LinkedIn', connection: 'linkedin' },
];

{providers.map(({ name, connection }) => (
  <Button
    key={name}
    onClick={() => window.location.href = `/auth/login?connection=${connection}`}
  >
    Connect {name}
  </Button>
))}
```

---

## Auth0 Dashboard Configuration

### Required Settings

1. **Enable Social Connections:**
   - Go to Authentication → Social
   - Enable desired providers (GitHub, Google, etc.)
   - Configure API keys for each

2. **Allowed Callback URLs:**
   ```
   http://localhost:3000/api/auth0/callback
   https://yourdomain.com/api/auth0/callback
   ```

3. **Allowed Logout URLs:**
   ```
   http://localhost:3000
   https://yourdomain.com
   ```

---

## Summary

| Feature | Old Approach | New Unified Approach |
|---------|-------------|---------------------|
| **URL Pattern** | Custom per provider | `/auth/login?connection={provider}` |
| **Code Changes** | New endpoint per provider | No code changes needed |
| **Middleware** | Custom logic per provider | Single middleware handles all |
| **Scopes** | Custom implementation | Query parameter |
| **Error Handling** | Per-provider | Unified |
| **Testing** | Per-provider tests | Same test pattern |

---

**Status:** ✅ Implemented  
**Providers Supported:** 7 (Google, GitHub, Microsoft, Facebook, Twitter, LinkedIn, Apple)  
**Pattern:** Unified `/auth/login?connection={provider}`  
**Backward Compatible:** Yes (custom endpoints still work)
