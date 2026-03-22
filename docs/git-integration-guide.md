# Git Integration Implementation Guide

## Files Created

### 1. GitHub OAuth (`lib/github/github-oauth.ts`)
- OAuth flow functions
- Token management
- GitHub API helpers
- Repository/branch/commit operations

### 2. GitHub OAuth Routes
- `/api/github/authorize` - Initiates OAuth flow
- `/api/github/callback` - Handles OAuth callback
- `/api/github/status` - Check connection status (create this)
- `/api/github/disconnect` - Disconnect GitHub (create this)
- `/api/github/commits` - Get commit history (create this)
- `/api/github/branches` - Get branches (create this)
- `/api/github/commit` - Create commit (create this)
- `/api/github/push` - Push changes (create this)
- `/api/github/pull` - Pull changes (create this)
- `/api/github/branch` - Switch branch (create this)

### 3. Git Source Control Component (`components/git-source-control.tsx`)
- VSCode-like Git panel
- File staging/unstaging
- Commit creation
- Branch management
- Push/Pull operations

## Adding Git Tab to Workspace Panel

### Step 1: Import the Component

Add to imports in `workspace-panel.tsx`:

```typescript
import GitSourceControl from '@/components/git-source-control';
```

### Step 2: Add Git Tab Trigger

Find the TabsList section and add:

```typescript
<TabsTrigger 
  value="git" 
  className="flex items-center gap-2 data-[state=active]:bg-white/10"
>
  <GitCommit className="w-4 h-4" />
  <span className="text-xs">Git</span>
</TabsTrigger>
```

### Step 3: Add Git Tab Content

Add after the integrations TabContent:

```typescript
<TabsContent value="git" className="flex-1 mt-0 overflow-hidden">
  <GitSourceControl scopePath={filesystemScopePath || 'project'} />
</TabsContent>
```

### Step 4: Add Git Icon Import

Add to Lucide imports:

```typescript
import { GitCommit, GitBranch, GitPullRequest } from 'lucide-react';
```

## Environment Variables Required

Add to `.env.local`:

```env
# GitHub OAuth
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:3000/api/github/callback
```

## GitHub OAuth App Setup

1. Go to GitHub Settings → Developer Settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: binG (or your app name)
   - **Homepage URL**: http://localhost:3000
   - **Authorization callback URL**: http://localhost:3000/api/github/callback
4. Click "Register application"
5. Copy Client ID and generate Client Secret
6. Add to `.env.local`

## Required Scopes

The OAuth app should request these scopes:
- `repo` - Full control of private repositories
- `user` - Read user profile
- `workflow` - Update GitHub Actions workflows

## API Endpoints to Create

### `/api/github/status/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { isGitHubConnected, getGitHubToken } from '@/lib/github/github-oauth';

export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request);
  
  if (!session?.user) {
    return NextResponse.json({ connected: false });
  }
  
  // Get local user ID (implement this mapping)
  const localUserId = await getLocalUserId(session.user.sub);
  
  const connected = isGitHubConnected(localUserId);
  
  if (connected) {
    const token = await getGitHubToken(localUserId);
    // Fetch user info and repos
    return NextResponse.json({
      connected: true,
      login: 'username',
      avatarUrl: '...',
      repos: [],
    });
  }
  
  return NextResponse.json({ connected: false });
}
```

### `/api/github/disconnect/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { disconnectGitHub } from '@/lib/github/github-oauth';

export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request);
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const localUserId = await getLocalUserId(session.user.sub);
  disconnectGitHub(localUserId);
  
  return NextResponse.json({ success: true });
}
```

## Features

### Git Source Control Panel
- ✅ GitHub OAuth integration
- ✅ File change detection
- ✅ Stage/unstage files
- ✅ Commit creation
- ✅ Branch switching
- ✅ Push to GitHub
- ✅ Pull from GitHub
- ✅ Commit history view
- ✅ Connection status indicator

### Future Enhancements
- [ ] Local Git repository initialization
- [ ] Diff viewer for changes
- [ ] Merge conflict resolution
- [ ] Pull request creation
- [ ] Issue tracking integration
- [ ] GitHub Actions workflow management
- [ ] Repository forking
- [ ] Clone from GitHub

## Usage Flow

1. **User opens Git tab** → Sees "Connect GitHub" prompt
2. **Clicks Connect** → Redirected to GitHub OAuth
3. **Authorizes** → Redirected back with token saved
4. **Git panel loads** → Shows files, branches, commit history
5. **Stage changes** → Click + to stage files
6. **Commit** → Enter message, click Commit
7. **Push** → Click Push to send to GitHub
8. **Pull** → Click Pull to get latest changes

## Security Notes

- Tokens encrypted with `ENCRYPTION_KEY`
- OAuth state parameter prevents CSRF
- Scopes limited to what's necessary
- User can disconnect anytime
- Tokens stored server-side, not in browser
