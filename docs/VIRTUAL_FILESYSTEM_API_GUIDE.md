# Virtual Filesystem API Guide

**Version:** 1.0  
**Last Updated:** February 26, 2026  
**Status:** ✅ Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Authentication & Ownership](#authentication--ownership)
4. [API Reference](#api-reference)
5. [TypeScript Service API](#typescript-service-api)
6. [Examples](#examples)
7. [Best Practices](#best-practices)

---

## Overview

The Virtual Filesystem Service provides a **sandbox-independent**, persistent file storage system for user projects. Each user (authenticated or anonymous) has their own isolated workspace with full CRUD operations, search capabilities, and export functionality.

### Key Features

- ✅ **Per-User Isolation**: Each user/anonymous session has isolated storage
- ✅ **Persistent Storage**: Files persist across sessions via JSON storage
- ✅ **Full CRUD Operations**: Create, Read, Update, Delete files and directories
- ✅ **Smart Search**: Search by filename, path, or content with relevance scoring
- ✅ **Language Detection**: Automatic language inference from file extensions
- ✅ **Version Tracking**: Each file maintains version history
- ✅ **Export Capability**: Export entire workspace snapshots

### Storage Location

```
data/virtual-filesystem/
├── {hash1}.json  # User workspace 1
├── {hash2}.json  # User workspace 2
└── {hash3}.json  # User workspace 3
```

Each workspace file contains all files for that user in a single JSON document.

---

## Architecture

### Component Stack

```
┌─────────────────────────────────────────────────────┐
│              API Routes (REST Endpoints)            │
│  /api/filesystem/{list,read,write,delete,search}    │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│         Owner Resolution (resolve-filesystem-owner) │
│  JWT → Session → Anonymous → Fallback               │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│      VirtualFilesystemService (Service Layer)       │
│  - In-memory workspace cache                        │
│  - Persistent JSON storage                          │
│  - Path normalization & validation                  │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│            Filesystem Types (Type Definitions)      │
│  VirtualFile, VirtualFilesystemNode, etc.           │
└─────────────────────────────────────────────────────┘
```

### Core Files

| File | Purpose |
|------|---------|
| `lib/virtual-filesystem/virtual-filesystem-service.ts` | Core service logic |
| `lib/virtual-filesystem/filesystem-types.ts` | TypeScript type definitions |
| `lib/virtual-filesystem/resolve-filesystem-owner.ts` | Authentication resolution |
| `app/api/filesystem/*/route.ts` | REST API endpoints |

---

## Authentication & Ownership

### Owner Resolution Flow

The filesystem automatically resolves the owner from the request using a priority chain:

```
1. JWT Token (Bearer auth) → userId
2. Session Cookie → userId
3. Anonymous Request → 'anon:public'
4. Fallback → 'anon:public'
```

### Resolution Result

```typescript
interface FilesystemOwnerResolution {
  ownerId: string;              // Unique identifier for workspace
  source: 'jwt' | 'session' | 'anonymous' | 'fallback';
  isAuthenticated: boolean;      // True if JWT or session
}
```

### Owner ID Format

- **Authenticated Users**: User UUID from JWT/session (e.g., `usr_abc123xyz`)
- **Anonymous Users**: `'anon:public'` (shared public workspace)
- **Storage**: Owner ID is hashed (SHA-256, first 32 chars) for filename

### Security Features

- ✅ Path traversal prevention (`..` blocked)
- ✅ Null byte injection prevention (`\0` blocked)
- ✅ Max path length enforcement (1024 chars)
- ✅ Content normalization (string conversion)
- ✅ Atomic file writes (tmp + rename pattern)
- ✅ Write queue serialization (prevents race conditions)

---

## API Reference

### Base URL

```
/api/filesystem
```

All endpoints require Node.js runtime and support both authenticated and anonymous access.

---

### 📁 List Directory

**Endpoint:** `GET /api/filesystem/list`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `'project'` | Directory path to list |

**Example Request:**

```bash
GET /api/filesystem/list?path=project/src
Authorization: Bearer {token}
```

**Example Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "path": "project/src",
    "nodes": [
      {
        "type": "directory",
        "name": "components",
        "path": "project/src/components"
      },
      {
        "type": "directory",
        "name": "utils",
        "path": "project/src/utils"
      },
      {
        "type": "file",
        "name": "index.ts",
        "path": "project/src/index.ts",
        "language": "typescript",
        "size": 1024,
        "lastModified": "2026-02-26T10:30:00.000Z"
      },
      {
        "type": "file",
        "name": "app.ts",
        "path": "project/src/app.ts",
        "language": "typescript",
        "size": 2048,
        "lastModified": "2026-02-26T09:15:00.000Z"
      }
    ]
  },
  "owner_source": "jwt"
}
```

**Error Responses:**

```json
// 400 Bad Request
{
  "success": false,
  "error": "Invalid path format"
}
```

---

### 📄 Read File

**Endpoint:** `POST /api/filesystem/read`

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Full path to file |

**Example Request:**

```bash
POST /api/filesystem/read
Authorization: Bearer {token}
Content-Type: application/json

{
  "path": "project/src/index.ts"
}
```

**Example Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "path": "project/src/index.ts",
    "content": "export const app = require('./app');\n\napp.start();",
    "language": "typescript",
    "lastModified": "2026-02-26T10:30:00.000Z",
    "version": 5,
    "size": 45
  }
}
```

**Error Responses:**

```json
// 404 Not Found
{
  "success": false,
  "error": "File not found: project/src/index.ts"
}

// 400 Bad Request
{
  "success": false,
  "error": "path is required"
}
```

---

### ✏️ Write File

**Endpoint:** `POST /api/filesystem/write`

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Full path to file |
| `content` | string | Yes | File content |

**Example Request:**

```bash
POST /api/filesystem/write
Authorization: Bearer {token}
Content-Type: application/json

{
  "path": "project/src/utils/helper.ts",
  "content": "export function helper() {\n  return 'Hello';\n}"
}
```

**Example Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "path": "project/src/utils/helper.ts",
    "version": 1,
    "language": "typescript",
    "size": 48,
    "lastModified": "2026-02-26T10:45:00.000Z"
  }
}
```

**Behavior Notes:**

- Creates parent directories automatically (virtual, not physical)
- Increments file version on each write
- Detects language from file extension
- Normalizes content to string if not already

**Error Responses:**

```json
// 400 Bad Request
{
  "success": false,
  "error": "path is required"
}

// 400 Bad Request (path traversal attempt)
{
  "success": false,
  "error": "Path traversal is not allowed: project/../etc/passwd"
}
```

---

### 🗑️ Delete Path

**Endpoint:** `POST /api/filesystem/delete`

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to file or directory |

**Example Request:**

```bash
POST /api/filesystem/delete
Authorization: Bearer {token}
Content-Type: application/json

{
  "path": "project/src/utils"
}
```

**Example Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "deletedCount": 5
  }
}
```

**Behavior Notes:**

- Deleting a directory removes all nested files recursively
- Deleting a file removes only that file
- Returns count of deleted items
- No error if path doesn't exist (returns `deletedCount: 0`)

**Error Responses:**

```json
// 400 Bad Request
{
  "success": false,
  "error": "path is required"
}
```

---

### 🔍 Search

**Endpoint:** `GET /api/filesystem/search`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query |
| `path` | string | No | `'project'` | Scope search to path |
| `limit` | number | No | `25` | Max results (1-200) |

**Example Request:**

```bash
GET /api/filesystem/search?q=helper&path=project/src&limit=10
Authorization: Bearer {token}
```

**Example Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "query": "helper",
    "path": "project/src",
    "results": [
      {
        "path": "project/src/utils/helper.ts",
        "name": "helper.ts",
        "language": "typescript",
        "score": 200,
        "snippet": "...export function helper() {\n  return 'Hello from helper';\n}...",
        "lastModified": "2026-02-26T10:45:00.000Z"
      },
      {
        "path": "project/src/helpers.ts",
        "name": "helpers.ts",
        "language": "typescript",
        "score": 120,
        "snippet": "export const helpers = { ... }",
        "lastModified": "2026-02-26T09:00:00.000Z"
      }
    ]
  }
}
```

**Scoring Algorithm:**

| Match Type | Score |
|------------|-------|
| Exact filename match | +120 |
| Query in filename | +80 |
| Query in full path | +40 |
| Query in content | +20 |

**Snippet Generation:**

- Shows ~140 characters centered on first match
- Adds `...` prefix/suffix if truncated
- Empty query returns empty results (no error)

**Error Responses:**

```json
// 400 Bad Request
{
  "success": false,
  "error": "Search failed"
}
```

---

## TypeScript Service API

Direct service usage (bypass HTTP):

```typescript
import { virtualFilesystem } from '@/lib/virtual-filesystem';
```

### Service Methods

#### `readFile(ownerId: string, filePath: string): Promise<VirtualFile>`

```typescript
const file = await virtualFilesystem.readFile('usr_abc123', 'project/src/index.ts');
console.log(file.content);
```

#### `writeFile(ownerId: string, filePath: string, content: string): Promise<VirtualFile>`

```typescript
const file = await virtualFilesystem.writeFile(
  'usr_abc123',
  'project/src/new.ts',
  'export const x = 1;'
);
console.log(file.version); // 1
```

#### `deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }>`

```typescript
const result = await virtualFilesystem.deletePath('usr_abc123', 'project/src/old');
console.log(result.deletedCount); // 3
```

#### `listDirectory(ownerId: string, directoryPath?: string): Promise<VirtualFilesystemDirectoryListing>`

```typescript
const listing = await virtualFilesystem.listDirectory('usr_abc123', 'project/src');
console.log(listing.nodes); // Array of files and directories
```

#### `search(ownerId: string, query: string, options?: { path?: string; limit?: number }): Promise<VirtualFilesystemSearchResult[]>`

```typescript
const results = await virtualFilesystem.search('usr_abc123', 'helper', {
  path: 'project/src',
  limit: 10
});
```

#### `exportWorkspace(ownerId: string): Promise<VirtualWorkspaceSnapshot>`

```typescript
const snapshot = await virtualFilesystem.exportWorkspace('usr_abc123');
console.log(snapshot.files); // All files in workspace
console.log(snapshot.version); // Workspace version
```

#### `getWorkspaceVersion(ownerId: string): Promise<number>`

```typescript
const version = await virtualFilesystem.getWorkspaceVersion('usr_abc123');
console.log(version); // 42
```

---

## Type Definitions

```typescript
// From filesystem-types.ts

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
  lastModified: string;      // ISO 8601
  version: number;
  size: number;              // Bytes
}

export interface VirtualFilesystemNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  language?: string;
  lastModified?: string;
  size?: number;
}

export interface VirtualFilesystemDirectoryListing {
  path: string;
  nodes: VirtualFilesystemNode[];
}

export interface VirtualFilesystemSearchResult {
  path: string;
  name: string;
  language: string;
  score: number;
  snippet: string;
  lastModified: string;
}

export interface VirtualWorkspaceSnapshot {
  root: string;
  version: number;
  updatedAt: string;
  files: VirtualFile[];
}
```

---

## Examples

### Complete CRUD Flow

```typescript
// 1. Write a file
await virtualFilesystem.writeFile('user123', 'project/README.md', '# My Project');

// 2. Read it back
const file = await virtualFilesystem.readFile('user123', 'project/README.md');
console.log(file.content); // "# My Project"

// 3. Update it (version increments)
await virtualFilesystem.writeFile('user123', 'project/README.md', '# Updated Project');

// 4. List directory
const listing = await virtualFilesystem.listDirectory('user123', 'project');
console.log(listing.nodes);

// 5. Search
const results = await virtualFilesystem.search('user123', 'Updated');
console.log(results[0].snippet);

// 6. Delete
await virtualFilesystem.deletePath('user123', 'project/README.md');
```

### Anonymous User Example

```typescript
// Anonymous users get 'anon:public' workspace
await virtualFilesystem.writeFile('anon:public', 'project/public.txt', 'Public content');

// All anonymous users share this workspace
const listing = await virtualFilesystem.listDirectory('anon:public');
```

### Export for Backup

```typescript
// Export entire workspace
const snapshot = await virtualFilesystem.exportWorkspace('user123');

// Save to external storage
await fs.writeFile(
  `backups/user123-${snapshot.version}.json`,
  JSON.stringify(snapshot, null, 2)
);
```

### Search with Scoring

```typescript
const results = await virtualFilesystem.search('user123', 'index', {
  path: 'project/src',
  limit: 50
});

// Results sorted by score (highest first)
results.forEach(r => {
  console.log(`${r.path}: score=${r.score}, snippet="${r.snippet}"`);
});
```

---

## Best Practices

### ✅ Do

1. **Always normalize paths on the client** before sending to API
2. **Use meaningful owner IDs** (user UUIDs) for proper isolation
3. **Implement retry logic** for write operations (atomic writes are resilient but network isn't)
4. **Cache directory listings** client-side to reduce API calls
5. **Use search with path scoping** for better performance on large workspaces
6. **Export workspaces periodically** for backup purposes

### ❌ Don't

1. **Don't allow user input directly in paths** without validation
2. **Don't store binary files** (service is optimized for text)
3. **Don't rely on physical filesystem** paths (everything is virtual/JSON-based)
4. **Don't exceed 200 search results** (hard limit for performance)
5. **Don't use for large files** (>1MB content not recommended)

### Performance Tips

| Operation | Optimization |
|-----------|--------------|
| List large dirs | Use pagination client-side |
| Search | Scope to specific path when possible |
| Write | Batch writes when creating multiple files |
| Read | Cache frequently accessed files |

### Security Checklist

- [ ] Validate all user input paths
- [ ] Use authenticated requests for sensitive data
- [ ] Implement rate limiting on API routes
- [ ] Monitor workspace sizes (prevent DoS)
- [ ] Sanitize ownerId before hashing

---

## Configuration

### Environment Variables

```bash
# Optional: Custom storage directory
VIRTUAL_FILESYSTEM_STORAGE_DIR=/path/to/storage

# Default workspace root (internal)
# No environment variable needed - defaults to 'project'
```

### Constructor Options

```typescript
const fs = new VirtualFilesystemService({
  workspaceRoot: 'my-project',      // Default: 'project'
  storageDir: '/custom/storage',     // Default: ./data/virtual-filesystem
});
```

---

## Troubleshooting

### Common Issues

**Issue:** "File not found" after write  
**Cause:** Different ownerId used for read vs write  
**Solution:** Ensure consistent owner resolution

**Issue:** Path traversal error  
**Cause:** Attempting to use `..` in paths  
**Solution:** Use absolute paths from workspace root

**Issue:** Slow search performance  
**Cause:** Searching entire workspace with 1000+ files  
**Solution:** Use `path` parameter to scope search

**Issue:** Workspace not persisting  
**Cause:** Storage directory not writable  
**Solution:** Check permissions on `data/virtual-filesystem`

---

## Future Enhancements

- [ ] Binary file support (base64 encoding)
- [ ] File sharing between users
- [ ] Real-time collaboration (WebSocket sync)
- [ ] Git integration (commit/push)
- [ ] File version history (keep N versions)
- [ ] Trash/recycle bin (soft delete)
- [ ] Quota management (max files/size per user)

---

## Related Documentation

- [Sandbox Service Bridge](./sdk/e2b/README.md)
- [API Endpoints Complete](./API_ENDPOINTS_COMPLETE.md)
- [Database Migrations](./DATABASE_MIGRATIONS.md)
