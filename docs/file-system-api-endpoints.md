---
id: file-system-api-endpoints
title: File System API Endpoints
aliases:
  - filesystem-api
  - filesystem-api.md
tags: []
layer: core
summary: "# File System API Endpoints\r\n\r\nComplete reference for the virtual filesystem API endpoints.\r\n\r\n## Base URL\r\n```\r\n/api/filesystem\r\n```\r\n\r\n## Authentication\r\nAll write operations require JWT authentication via:\r\n- `Authorization: Bearer <token>` header, OR\r\n- Session cookie\r\n\r\nRead operations may allo"
anchors:
  - Base URL
  - Authentication
  - Endpoints
  - 1. List Directory
  - 2. Read File
  - 3. Write File (Update)
  - 4. Create File (NEW)
  - 5. Create Directory (NEW)
  - 6. Delete File/Directory
  - Frontend Integration
  - Create File Button (+File)
  - Create Folder Button (+Folder)
  - Debug Logging
  - Log Colors
  - Security
  - Path Validation
  - Authentication
  - Rate Limiting
  - Error Codes
  - Examples
  - Create a new markdown file
  - Create a new folder
  - List directory contents
---
# File System API Endpoints

Complete reference for the virtual filesystem API endpoints.

## Base URL
```
/api/filesystem
```

## Authentication
All write operations require JWT authentication via:
- `Authorization: Bearer <token>` header, OR
- Session cookie

Read operations may allow anonymous access depending on configuration.

---

## Endpoints

### 1. List Directory
**GET** `/api/filesystem/list?path=<path>`

List contents of a directory.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| path | string | No | `project` | Directory path to list |
| ownerId | string | No | auto | Owner ID (derived from auth) |

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "project/sessions",
    "nodes": [
      {
        "type": "directory",
        "name": "draft-chat_123",
        "path": "project/sessions/draft-chat_123",
        "isExplicit": true
      },
      {
        "type": "file",
        "name": "notes.md",
        "path": "project/sessions/notes.md",
        "language": "markdown",
        "size": 1024,
        "lastModified": "2026-03-09T08:00:00.000Z"
      }
    ]
  }
}
```

**Debug Logging:** `[VFS LIST]` (cyan)

---

### 2. Read File
**POST** `/api/filesystem/read`

Read file content.

**Request Body:**
```json
{
  "path": "project/file.txt",
  "ownerId": "optional"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "project/file.txt",
    "content": "File content here...",
    "language": "plaintext",
    "size": 1234,
    "version": 1,
    "lastModified": "2026-03-09T08:00:00.000Z"
  }
}
```

---

### 3. Write File (Update)
**POST** `/api/filesystem/write`

Update an existing file's content.

**Request Body:**
```json
{
  "path": "project/file.txt",
  "content": "New content...",
  "language": "plaintext",
  "ownerId": "optional"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "project/file.txt",
    "version": 2,
    "language": "plaintext",
    "size": 5678,
    "lastModified": "2026-03-09T08:05:00.000Z"
  }
}
```

**Debug Logging:** `[VFS WRITE]` (if enabled)

---

### 4. Create File (NEW)
**POST** `/api/filesystem/create-file`

Create a new file. Returns 409 if file already exists.

**Request Body:**
```json
{
  "path": "project/new-file.txt",
  "content": "Initial content...",
  "language": "plaintext"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "project/new-file.txt",
    "version": 1,
    "language": "plaintext",
    "size": 123,
    "lastModified": "2026-03-09T08:10:00.000Z"
  }
}
```

**Error Response (409 Conflict):**
```json
{
  "success": false,
  "error": "File already exists: project/new-file.txt"
}
```

**Debug Logging:** `[VFS CREATE FILE]` (green)

---

### 5. Create Directory (NEW)
**POST** `/api/filesystem/mkdir`

Create a new directory. Parent directories are created implicitly.

**Request Body:**
```json
{
  "path": "project/new-folder"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "project/new-folder",
    "createdAt": "2026-03-09T08:15:00.000Z"
  }
}
```

**Error Response (409 Conflict):**
```json
{
  "success": false,
  "error": "A file already exists at this path: project/new-folder"
}
```

**Debug Logging:** `[VFS MKDIR]` (cyan)

---

### 6. Delete File/Directory
**DELETE** `/api/filesystem/delete`

Delete a file or directory.

**Request Body:**
```json
{
  "path": "project/file-to-delete.txt"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deletedCount": 1
  }
}
```

---

## Frontend Integration

### Create File Button (+File)
```typescript
async function handleCreateFile() {
  const fileName = prompt('Enter file name:');
  if (!fileName) return;

  const response = await fetch('/api/filesystem/create-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `project/sessions/${currentSessionId}/${fileName}`,
      content: '',
      language: detectLanguage(fileName),
    }),
  });

  const result = await response.json();
  if (result.success) {
    // Refresh file list
    refreshFileList();
  } else {
    alert(result.error);
  }
}
```

### Create Folder Button (+Folder)
```typescript
async function handleCreateFolder() {
  const folderName = prompt('Enter folder name:');
  if (!folderName) return;

  const response = await fetch('/api/filesystem/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `project/sessions/${currentSessionId}/${folderName}`,
    }),
  });

  const result = await response.json();
  if (result.success) {
    // Refresh file list
    refreshFileList();
  } else {
    alert(result.error);
  }
}
```

---

## Debug Logging

Enable debug logging with environment variables:

```bash
# Enable VFS debug logging
DEBUG_VFS=true

# Enable file logging (logs to logs/app.log)
LOG_TO_FILE=true
LOG_FILE_PATH=./logs/app.log
LOG_LEVEL=debug
```

### Log Colors

| Prefix | Color | Endpoint |
|--------|-------|----------|
| `[VFS LIST]` | Cyan | `/list` |
| `[VFS CREATE FILE]` | Green | `/create-file` |
| `[VFS MKDIR]` | Cyan | `/mkdir` |
| `[VFS WRITE]` | (if added) | `/write` |
| `[... WARN]` | Yellow | All warnings |
| `[... ERROR]` | Red | All errors |

---

## Security

### Path Validation
All endpoints validate paths to prevent:
- Directory traversal (`..`)
- Null byte injection (`\0`)
- Absolute paths (must start with `/home/` or `/workspace/`)

### Authentication
- **Read operations**: May allow anonymous (configurable)
- **Write operations**: Always require authentication
- **Delete operations**: Always require authentication

### Rate Limiting
- 30 file operations per minute per user
- 30 command executions per minute per user

---

## Error Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Invalid request (validation failed) |
| 401 | Authentication required |
| 403 | Unauthorized (wrong owner) |
| 404 | File/directory not found |
| 409 | Conflict (already exists) |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## Examples

### Create a new markdown file
```bash
curl -X POST http://localhost:3000/api/filesystem/create-file \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"path":"project/notes.md","content":"# Notes\n\nContent here...","language":"markdown"}'
```

### Create a new folder
```bash
curl -X POST http://localhost:3000/api/filesystem/mkdir \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"path":"project/screenshots"}'
```

### List directory contents
```bash
curl "http://localhost:3000/api/filesystem/list?path=project" \
  -H "Authorization: Bearer YOUR_TOKEN"
```
