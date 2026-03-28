# Complete Git/GitHub API Endpoints Map

## Existing Endpoints (Pre-Integration)

### 1. `/api/integrations/github/route.ts` (ORIGINAL - 678 lines)
**Purpose**: Unified GitHub integration for importing/cloning repos

**GET Endpoints:**
- `?type=trending&timeframe=daily|weekly|monthly` - **Scrapes GitHub trending page** (no auth needed)
  - Returns: Scraped repo data with stars, forks, descriptions
  - Fallback: GitHub API search if scraping fails
  
- `?type=repos` - List authenticated user's repos
  - Auth: Auth0 connected accounts (`auth0.getAccessToken()`)
  - Returns: User's GitHub repositories

**POST Endpoints:**
- `{ action: 'clone', repoUrl, destinationPath }` - Git clone repo to filesystem
  - Requires: Authentication + git installed
  - Security: Host validation, path traversal protection
  
- `{ action: 'import', owner, repo, branch, maxFiles }` - Import repo files to VFS
  - Auth: Auth0 token for private repos, public for public repos
  - Returns: File contents as base64
  
- `{ url, maxFiles }` - Legacy import from URL
  - Parses GitHub URL, fetches files recursively

**Key Features:**
- ✅ Trending repo scraping (no API key)
- ✅ Auth0 connected accounts integration
- ✅ Git clone with security validation
- ✅ File import with recursion
- ✅ Public repo support (no auth)

---

### 2. `/api/gateway/git/[sessionId]/versions/route.ts` (ORIGINAL)
**Purpose**: Local VFS shadow commit version history

**GET:**
- Returns version history for session's VFS snapshots
- Query: `?limit=20&by=session|user`
- Auth: Session-based (`resolveRequestAuth`)
- Storage: SQLite shadow commits

**Key Features:**
- ✅ Local filesystem versioning (NOT GitHub)
- ✅ Session-based snapshots
- ✅ Rollback support

---

### 3. `/api/gateway/git/[sessionId]/rollback/route.ts` (ORIGINAL)
**Purpose**: Rollback VFS to previous version

**POST:**
- Rollback to specific VFS version
- Auth: Session-based

**Key Features:**
- ✅ Local VFS rollback (NOT GitHub)
- ✅ Shadow commit restoration

---

## New Endpoints (Created by Integration - NEEDS RELOCATION)

### 4. `/api/github/authorize/route.ts` (NEW)
**Purpose**: Start direct GitHub OAuth flow

**GET:**
- Generates OAuth URL with state parameter
- Redirects to GitHub
- Scopes: `repo user workflow`

**Should Move To:** `/api/integrations/github/oauth/authorize`

---

### 5. `/api/github/callback/route.ts` (NEW)
**Purpose**: Handle GitHub OAuth callback

**GET:**
- Exchanges code for token
- Saves token to `external_connections` table
- Maps Auth0 user to local user
- Redirects to `/settings?github_connected=true`

**Should Move To:** `/api/integrations/github/oauth/callback`

---

### 6. `/api/github/status/route.ts` (NEW)
**Purpose**: Check GitHub connection status

**GET:**
- Returns: `{ connected: true, login, avatarUrl, repos: [...] }`
- Auth: Auth0 session
- Token: From `external_connections` table

**Should Move To:** `/api/integrations/github/oauth/status`

---

### 7. `/api/github/disconnect/route.ts` (NEW)
**Purpose**: Disconnect GitHub account

**POST:**
- Sets `is_active = FALSE` in `external_connections`
- Clears tokens

**Should Move To:** `/api/integrations/github/oauth/disconnect`

---

### 8. `/api/github/commits/route.ts` (NEW)
**Purpose**: Fetch commit history

**GET:**
- Query: `?owner=...&repo=...&branch=...`
- Returns: Array of commits with stats
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/commits`

---

### 9. `/api/github/branches/route.ts` (NEW)
**Purpose**: List repository branches

**GET:**
- Query: `?owner=...&repo=...`
- Returns: Array of branches with current indicator
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/branches`

---

### 10. `/api/github/commit/route.ts` (NEW)
**Purpose**: Create commit on GitHub

**POST:**
- Body: `{ message, description, changes, branch, owner, repo }`
- Creates blobs, tree, commit via GitHub API
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/commit`

---

### 11. `/api/github/push/route.ts` (NEW)
**Purpose**: Push commits to GitHub

**POST:**
- Body: `{ branch, owner, repo }`
- Updates remote branch
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/push`

---

### 12. `/api/github/pull/route.ts` (NEW)
**Purpose**: Pull from GitHub

**POST:**
- Body: `{ branch, owner, repo }`
- Fetches file contents from remote
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/pull`

---

### 13. `/api/github/branch/route.ts` (NEW)
**Purpose**: Switch branch

**POST:**
- Body: `{ branch, owner, repo }`
- Validates branch exists
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/branch`

---

### 14. `/api/github/pr/route.ts` (NEW)
**Purpose**: Create pull request

**POST:**
- Body: `{ title, body, head, base, draft, owner, repo }`
- Creates PR via GitHub API
- Auth: Direct GitHub token

**Should Move To:** `/api/integrations/github/source-control/pr`

---

### 15. `/api/github/import/route.ts` (NEW)
**Purpose**: Import repository (duplicate of existing?)

**POST:**
- Body: `{ owner, repo, branch }`
- Fetches all files recursively
- **OVERLAPS with `/api/integrations/github` POST action: 'import'**

**Should Move To:** `/api/integrations/github/source-control/import-repo`
**OR DEPRECATE** - Use existing `/api/integrations/github` import

---

## Component Usage Map

### Components Using New Endpoints:

1. **`git-source-control-tabs.tsx`**
   - `/api/github/status` → Check connection
   - `/api/github/commits` → Load history
   - `/api/github/branches` → Load branches
   - `/api/github/commit` → Create commit
   - `/api/github/push` → Push changes
   - `/api/github/pull` → Pull changes
   - `/api/github/branch` → Switch branch

2. **`github-create-pr.tsx`**
   - `/api/github/pr` → Create PR

3. **`github-import.tsx`**
   - `/api/github/status` → Check connection
   - `/api/github/import` → Import repo

---

## Consolidation Plan

### Option A: Keep Separate (Recommended)
**Structure:**
```
/api/integrations/github/
├── route.ts                          # Existing: Import/clone/trending
├── oauth/
│   ├── authorize/route.ts            # New OAuth flow
│   ├── callback/route.ts
│   ├── status/route.ts
│   └── disconnect/route.ts
└── source-control/
    ├── commits/route.ts
    ├── branches/route.ts
    ├── commit/route.ts
    ├── push/route.ts
    ├── pull/route.ts
    ├── branch/route.ts
    ├── pr/route.ts
    └── import-repo/route.ts          # Or deprecate
```

**Benefits:**
- Clear separation of concerns
- Existing `/api/integrations/github` unchanged
- New source control features organized
- Trending scraping stays in original route

### Option B: Fully Integrate
Move ALL new functionality into `/api/integrations/github/route.ts` as actions:
- `action: 'oauth-authorize'`
- `action: 'oauth-status'`
- `action: 'create-commit'`
- `action: 'push'`
- `action: 'create-pr'`

**Drawbacks:**
- Massive file (already 678 lines)
- Harder to maintain
- Mixes OAuth with source control

---

## Trending Scraping Location

**Current Location:** `/api/integrations/github/route.ts`
```typescript
GET /api/integrations/github?type=trending&timeframe=daily
```

**Function:** `scrapeTrendingRepos(timeframe)`
- Scrapes `https://github.com/trending?since=${timeframe}`
- Parses HTML with regex
- Fallback: GitHub API search if scraping fails

**This should NOT be moved** - it's working correctly in the existing endpoint.

---

## Recommendation

**Keep `/api/integrations/github/route.ts` as-is** for:
- Trending scraping (`?type=trending`)
- Repo listing (`?type=repos`)
- Import action (`action: 'import'`)
- Clone action (`action: 'clone'`)

**Move new source control endpoints to:**
```
/api/integrations/github/oauth/*       # OAuth flow
/api/integrations/github/source-control/*  # Git operations
```

**Update components to use new paths.**
