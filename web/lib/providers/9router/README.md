# 9Router Integration for BYOK (Bring Your Own Key)

This directory contains the integration layer to connect your Next.js chat app with a hosted 9Router instance for seamless OAuth-based provider connections.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Chat App (Next.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Provider     │  │ OAuth        │  │ /api/chat Route        │ │
│  │ Connect UI   │  │ Callback     │  │ (forwards to 9Router)  │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘ │
│         │                 │                      │              │
│  ┌──────▼─────────────────▼──────────────────────▼────────────┐ │
│  │              9Router Integration Client                    │ │
│  │  • Manages OAuth flows                                     │ │
│  │  • Stores tokens per-user in YOUR DB                       │ │
│  │  • Forwards chat requests to 9Router /v1                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Hosted 9Router Instance                            │
│  • /api/oauth/[provider]/authorize → auth URL                  │
│  • /api/oauth/[provider]/exchange → tokens                      │
│  • /api/oauth/[provider]/device-code → device code             │
│  • /api/oauth/[provider]/poll → poll for token                 │
│  • /v1/chat/completions → proxy to providers                   │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Steps

### 1. Fork 9Router with Multi-Tenancy

See `FORKS/` directory for the modified files to add userId scoping.

### 2. Configure Environment

```env
# Your 9Router instance (host this on VPS/Docker)
NINEROUTER_BASE_URL=https://your-9router-instance.com
NINEROUTER_ADMIN_KEY=your-admin-api-key-for-management

# Your app's database for user credentials (not 9Router's DB)
```

### 3. Use the Integration Client

```typescript
import { RouterClient } from '@/lib/9router/client'

const router = new RouterClient({
  baseUrl: process.env.NINEROUTER_BASE_URL,
  adminKey: process.env.NINEROUTER_ADMIN_KEY
})

// Connect a provider via OAuth
const { authUrl, provider } = await router.startOAuth('claude-code')

// After OAuth callback, store credentials
await router.completeOAuth(provider, code, redirectUri)

// Use in chat
const response = await router.chat(userId, {
  model: 'cc/claude-opus-4-7',
  messages: [...]
})
```

## Supported Providers

| Provider | OAuth Type | Required Fields |
|----------|------------|-----------------|
| `claude-code` | PKCE + OAuth | Redirect URI |
| `codex` | Proxy + OAuth | App port |
| `cursor` | OAuth | Redirect URI |
| `copilot` | OAuth | Redirect URI |
| `kiro` | Device Code / Social | Auth method |
| `github` | Device Code | - |

## Files

- `client.ts` - Main integration client
- `oauth-utils.ts` - OAuth flow helpers
- `types.ts` - TypeScript types
- `providers.ts` - Provider configuration
- `callback/route.ts` - OAuth callback handler
- `FORKS/` - 9Router fork modifications for multi-tenancy