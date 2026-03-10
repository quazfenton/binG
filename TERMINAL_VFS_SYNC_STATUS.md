# Terminal VFS Sync Status

## What's Working ✅

### Commands that sync to VFS:
1. **mkdir** ✅ - Creates `.keep` file and syncs
2. **touch** ✅ - Syncs new empty files
3. **echo** ✅ - Syncs with redirect (`>`) and append (`>>`)
4. **nano/vim/vi** ✅ - Syncs when saving file
5. **sandbox file operations** ✅ - Syncs via `syncFileToVFS()` in session handlers

### VFS Sync Flow:
```
Terminal command (mkdir, touch, echo, nano save)
  ↓ calls
syncFileToVFS(filePath, content)
  ↓ POST to
/api/filesystem/write
  ↓ dispatches
CustomEvent('filesystem-updated')
  ↓ received by
CodePreviewPanel Files tab
  ↓ refreshes
File explorer shows new/updated file
```

---

## What's Missing ❌

### Commands that DON'T sync to VFS (yet):

1. **cp** - Copy file
   ```typescript
   // ADD after line ~1565:
   syncFileToVFS(dstPath, fs[dstPath].content || '')
   ```

2. **mv** - Move/rename file  
   ```typescript
   // ADD after line ~1597:
   syncFileToVFS(dstPath, fs[dstPath].content || '')
   // And delete old file from VFS (if API supports)
   ```

3. **rm** - Remove file
   ```typescript
   // ADD after deletion loop ~1515:
   // Call VFS delete endpoint (if exists)
   // OR: sync parent directory to reflect deletion
   ```

4. **cat with redirect** - `cat file1 > file2`
   ```typescript
   // Already works via echo redirect handling
   ```

---

## What Can Be Deleted 🗑️

### 1. Duplicate LocalCommandExecutor in enhanced-pty-terminal.ts
**Location:** `lib/sandbox/enhanced-pty-terminal.ts` lines ~136-220

**Why:** Now uses `LocalCommandExecutor` from `local-filesystem-executor.ts`

**Action:** Already deleted ✅

---

### 2. Inline command handling in TerminalPanel (FUTURE)
**Location:** `components/terminal/TerminalPanel.tsx` lines ~1142-2000

**Why:** Could use `TerminalLocalFSHandler` instead

**Action:** KEEP for now - it's working and tested
**Future:** Gradually migrate to handler-based execution

---

### 3. Unused imports in TerminalPanel
Check for:
```typescript
// If not used, can delete:
import { useWebSocketTerminal } from '@/hooks/use-websocket-terminal'
```

**Status:** Currently used for WebSocket connection ✅

---

### 4. Old WebSocket connection code (FUTURE)
**Location:** `components/terminal/TerminalPanel.tsx` lines ~3322-3650

**Why:** Could use `enhanced-pty-terminal.ts` or `useWebSocketTerminal` hook

**Action:** KEEP for now - working
**Future:** Migrate to cleaner architecture

---

## Files That Can Be Deleted Entirely 🗑️

### 1. `lib/backend/websocket-terminal.ts` (IF migrating)
**Status:** Currently NOT used by frontend
**Frontend connects to:** `/api/sandbox/terminal/ws` (port 3000)
**This server listens on:** port 8080 at `/sandboxes/:sandboxId/terminal`

**Decision:**
- **KEEP** if using standalone WebSocket server architecture
- **DELETE** if using Next.js upgrade handler architecture

**Recommendation:** KEEP for now, decide after testing both approaches

---

### 2. Duplicate handler files
Check for any files like:
- `terminal-handler-old.ts`
- `websocket-terminal-backup.ts`
- `terminal-panel-v2.tsx`

**Action:** Delete if not referenced anywhere

---

## Recommended Next Steps

### Phase 1: Add Missing VFS Sync (30 minutes)
1. Add sync to `cp` command
2. Add sync to `mv` command  
3. Add sync to `rm` command (or VFS delete)

### Phase 2: Test VFS Sync (15 minutes)
```bash
# In TerminalPanel:
mkdir test-sync
cd test-sync
touch file1.txt
echo "hello" > file2.txt
cp file1.txt file3.txt
mv file3.txt file4.txt
rm file2.txt

# Check CodePreviewPanel Files tab
# All changes should appear
```

### Phase 3: Decide Architecture (future)
- Test `websocket-terminal.ts` on port 8080
- Compare with Next.js upgrade handler
- Choose one approach, delete the other

---

## Code to Add

### cp command sync:
```typescript
// After line ~1565 in TerminalPanel.tsx
fs[dstPath] = {
  type: 'file',
  content: fs[srcPath].content,
  createdAt: Date.now(),
  modifiedAt: Date.now()
};
// ADD:
syncFileToVFS(dstPath, fs[srcPath].content || '')
```

### mv command sync:
```typescript
// After line ~1597 in TerminalPanel.tsx
fs[dstPath] = { ...fs[srcPath], modifiedAt: Date.now() };
delete fs[srcPath];
// ADD:
syncFileToVFS(dstPath, fs[dstPath].content || '')
// TODO: Also delete old file from VFS if API supports it
```

### rm command sync:
```typescript
// After deletion loop ~1515 in TerminalPanel.tsx
for (const path of Object.keys(fs)) {
  if (path === targetPath || path.startsWith(`${targetPath}/`)) {
    delete fs[path];
  }
}
// ADD:
// TODO: Call VFS delete endpoint if exists
// OR: Sync parent directory
const parentPath = getParentPath(targetPath)
const parentDir = listLocalDirectory(parentPath)
const parentContent = parentDir.join('\n')
syncFileToVFS(`${parentPath}/.directory`, parentContent)
```

---

## Summary

### ✅ Working:
- mkdir, touch, echo, nano/vim save all sync to VFS
- VFS sync dispatches events for cross-panel sync
- CodePreviewPanel receives events and refreshes

### ❌ Missing:
- cp, mv, rm don't sync to VFS
- Need to add 3 lines of code total

### 🗑️ Can Delete:
- Duplicate `LocalCommandExecutor` in enhanced-pty-terminal.ts (already done ✅)
- Old backup files (if any exist)
- `websocket-terminal.ts` (IF choosing Next.js upgrade handler approach)

### ⏸️ Keep For Now:
- TerminalPanel's 2000+ lines of command logic (working, tested)
- WebSocket connection code (working)
- Can gradually migrate to handler-based architecture
