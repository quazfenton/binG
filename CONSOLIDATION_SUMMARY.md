# API Route Consolidation Summary

## Consolidated Routes Created

We've created 9 consolidated route files that combine 276 individual routes into wrapper dispatchers:

### 1. filesystem-consolidated (20 routes → 1)
- read, write, delete, list, mkdir, move, rename, create-file
- search, rollback, snapshot, snapshot-restore
- diffs, diffs-apply, edits-accept, edits-deny
- events-push, import, commits, context-pack

### 2. storage-consolidated (6 routes → 1)
- usage, upload, signed-url, list, download, delete

### 3. sandbox-consolidated (17 routes → 1)
- agent, clear-sessions, daemon, devbox, execute, files
- lifecycle, pty, session, sync
- terminal, terminal-input, terminal-resize, terminal-stream, terminal-ws
- terminaluse, webcontainer

### 4. user-consolidated (7 routes → 1)
- api-keys, delete, integrations-status, keys
- preferences, profile

### 5. docker-consolidated (6 routes → 1)
- compose, containers, exec, remove, start, stop

### 6. terminal-consolidated (3 routes → 1)
- pty, input, resize

### 7. auth-consolidated (24 routes → 1)
- arcade-authorize, arcade-verifier, check-auth0, check-email
- confirm-reset, login, logout, me
- mfa-challenge, mfa-disable, mfa-setup, mfa-verify
- nango-authorize, oauth-callback, oauth-error, oauth-initiate, oauth-success
- refresh, register, reset-password, send-verification
- session, validate, verify-email

### 8. agent-consolidated (12 routes → 1)
- health, agent, stateful-agent, interrupt, unified-agent
- cloud-offload, cloud-agent
- v2-execute, v2-session, v2-sync, v2-workforce
- workflows

### 9. integrations-consolidated (23 routes → 1)
- arcade-auth, arcade-token, audit, connections, execute
- figma, figma-callback
- github, github-oauth-authorize, github-oauth-callback, github-oauth-disconnect, github-oauth-status
- github-branch, github-branches, github-commit, github-commits
- github-import-repo, github-pr, github-pull, github-push
- google, linkedin, twitter

## Total Reduction
- **Before**: 276 API routes = 276 serverless functions
- **After**: 9 consolidated routes + ~158 remaining = ~167 functions
- **Savings**: ~109 functions reduced

## Usage
All consolidated routes use query parameter `?action=<action-name>` to dispatch to the appropriate handler.

Example:
- Old: `POST /api/filesystem/write`
- New: `POST /api/filesystem-consolidated?action=write`

## Next Steps
1. Update frontend to use new consolidated endpoints
2. Test all consolidated routes
3. Remove old individual route files once verified
4. Update any documentation/API references