---
id: antigravity-oauth-setup-guide
title: Antigravity OAuth Setup Guide
aliases:
  - antigravity-oauth-setup
  - antigravity-oauth-setup.md
tags:
  - auth
  - guide
layer: core
summary: "# Antigravity OAuth Setup Guide\r\n\r\n## Overview\r\n\r\nAntigravity provides access to **Gemini 3**, **Gemini 3.1 Pro**, and **Claude 4.6** via Google's OAuth quota system. Two authentication modes are supported:\r\n\r\n1. **Per-User OAuth** — Users connect their own Google accounts\r\n2. **Master Account** — S"
anchors:
  - Overview
  - Architecture
  - Setup
  - 1. Per-User OAuth (Recommended)
  - 2. Master Account (Server-Level Fallback)
  - 3. Custom OAuth App (Optional)
  - Available Models
  - API Endpoints
  - Database
  - Rate Limit Handling
  - File Structure
  - Troubleshooting
  - '"No refresh token received"'
  - '"Rate limited"'
  - '"invalid_grant" on token refresh'
  - Master account not working
---
# Antigravity OAuth Setup Guide

## Overview

Antigravity provides access to **Gemini 3**, **Gemini 3.1 Pro**, and **Claude 4.6** via Google's OAuth quota system. Two authentication modes are supported:

1. **Per-User OAuth** — Users connect their own Google accounts
2. **Master Account** — Server-level account shared by all users (fallback)

## Architecture

```
User → /api/antigravity/login → Google OAuth → /api/antigravity/callback → Save to DB
                                                                    ↓
                                                          antigravity_accounts table

Request Flow:
1. Check user's per-user accounts (from DB)
2. Fall back to master account (from env vars)
3. Rotate through accounts on rate limit (429)
```

## Setup

### 1. Per-User OAuth (Recommended)

No setup required! Just ensure these env vars are set:

```env
NEXT_PUBLIC_APP_URL=https://your-app.com
```

Users connect their own accounts via `/api/antigravity/login`.

### 2. Master Account (Server-Level Fallback)

Configure a shared server account that all users can fall back to:

```env
# Master account refresh token (obtained from OAuth flow)
ANTIGRAVITY_REFRESH_TOKEN=your_refresh_token_here|rising-fact-p41fc

# Display email (optional)
ANTIGRAVITY_MASTER_EMAIL=admin@yourdomain.com

# Google Cloud Project ID (default: rising-fact-p41fc)
ANTIGRAVITY_DEFAULT_PROJECT_ID=rising-fact-p41fc
```

**To get the refresh token:**

1. Run the OAuth flow as an admin: visit `/api/antigravity/admin/connect`
2. After callback, the refresh token will be displayed
3. Copy it to your `.env` file as `ANTIGRAVITY_REFRESH_TOKEN`

> **Note:** The refresh token format is `actual_refresh_token|projectId`. The projectId is automatically appended during OAuth.

### 3. Custom OAuth App (Optional)

If you want to use your own Google OAuth app instead of the built-in one:

```env
ANTIGRAVITY_CLIENT_ID=your_client_id.apps.googleusercontent.com
ANTIGRAVITY_CLIENT_SECRET=your_client_secret
```

> The built-in credentials work out of the box. Custom credentials are only needed for production apps with branding requirements.

## Available Models

| Model | Context | Output | Thinking |
|-------|---------|--------|----------|
| `antigravity-gemini-3-pro` | 1,048,576 | 65,535 | ✅ (low/high) |
| `antigravity-gemini-3.1-pro` | 1,048,576 | 65,535 | ✅ (low/high) |
| `antigravity-gemini-3-flash` | 1,048,576 | 65,536 | ✅ (minimal/low/medium/high) |
| `antigravity-claude-sonnet-4-6` | 200,000 | 64,000 | ❌ |
| `antigravity-claude-opus-4-6-thinking` | 200,000 | 64,000 | ✅ (8192-32768 budget) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/antigravity/login` | GET | Start per-user OAuth flow |
| `/api/antigravity/callback` | GET | Handle per-user OAuth callback |
| `/api/antigravity/chat` | POST | Send chat request (uses user accounts + master fallback) |
| `/api/antigravity/admin/status` | GET | Check master account status (admin only) |
| `/api/antigravity/admin/connect` | GET | Start OAuth for master account (admin only) |
| `/api/antigravity/admin/callback` | GET | Handle master account OAuth callback (admin only) |

## Database

Accounts are stored in SQLite (`antigravity_accounts` table):

```sql
CREATE TABLE IF NOT EXISTS antigravity_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,  -- Format: refreshToken|projectId|managedProjectId
  project_id TEXT NOT NULL DEFAULT 'rising-fact-p41fc',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  quota_updated_at INTEGER NOT NULL DEFAULT 0,
  cached_quota TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Rate Limit Handling

The system automatically:
1. Tries user's personal accounts first (ordered by last_used ASC for round-robin)
2. Falls back to master account if all personal accounts are rate limited
3. Returns 429 only if ALL accounts (including master) are rate limited

## File Structure

```
web/
├── lib/
│   ├── llm/
│   │   └── antigravity-provider.ts     # Core OAuth + API implementation
│   ├── database/
│   │   └── antigravity-accounts.ts     # Account CRUD + master account support
│   └── chat/
│       └── llm-providers.ts            # LLM service integration
└── app/
    └── api/
        └── antigravity/
            ├── login/route.ts           # Per-user OAuth start
            ├── callback/route.ts        # Per-user OAuth callback
            ├── chat/route.ts            # Chat endpoint
            └── admin/
                ├── status/route.ts      # Admin status check
                ├── connect/route.ts     # Master OAuth start
                └── callback/route.ts    # Master OAuth callback
```

## Troubleshooting

### "No refresh token received"
Ensure `access_type=offline` and `prompt=consent` are in the OAuth URL (they are by default).

### "Rate limited"
- Connect additional Google accounts via `/api/antigravity/login`
- Configure a master account as fallback
- Wait for quota reset (typically 24 hours for Gemini, varies for Claude)

### "invalid_grant" on token refresh
The refresh token was revoked or expired. Re-authenticate via OAuth flow.

### Master account not working
1. Check `ANTIGRAVITY_REFRESH_TOKEN` is set in env
2. Verify format: `actual_token|projectId`
3. Check admin status at `/api/antigravity/admin/status`
