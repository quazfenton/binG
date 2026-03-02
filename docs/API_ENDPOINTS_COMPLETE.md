# API Endpoints Reference - Complete Documentation

**Version:** 3.0 (Advanced Features Release)
**Last Updated:** February 27, 2026
**Total Endpoints:** 100+

## 🆕 New Endpoints (Latest Release)

### Sandbox Advanced Features

| Endpoint | Method | Purpose | Provider |
|----------|--------|---------|----------|
| `/api/sandbox/sync` | POST | Sync VFS to sandbox (tar-pipe) | Sprites |
| `/api/sandbox/checkpoint` | POST | Create/manage checkpoints | Sprites |
| `/api/sandbox/sshfs` | POST | Mount filesystem via SSHFS | Sprites |
| `/api/sandbox/files` | POST | File operations | All |

### Rate Limiting

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rate-limit/status` | GET | Check rate limit status |
| `/api/rate-limit/reset` | POST | Reset rate limits (admin) |

---

## Table of Contents

1. [🔐 Authentication Endpoints](#-authentication-endpoints)
2. [💬 Chat & Agent Endpoints](#-chat--agent-endpoints)
3. [🐳 Docker Management](#-docker-management)
4. [☁️ Cloud Storage](#-cloud-storage)
5. [🧪 Sandbox & Code Execution](#-sandbox--code-execution)
6. [🤖 CI/CD Pipelines](#-cicd-pipelines)
7. [🎨 OAuth Integrations](#-oauth-integrations)
8. [🖼️ AI & Media](#-ai--media)
9. [📁 Virtual Filesystem](#-virtual-filesystem)
10. [🛠️ Tools & Utilities](#-tools--utilities)
11. [👤 User Management](#-user-management)
12. [🔗 URL Services](#-url-services)
13. [📡 Webhooks & Integrations](#-webhooks--integrations)
14. [🏥 System & Health](#-system--health)
15. [Security Summary](#security-summary)
16. [Configuration](#configuration)

---

## 🔐 Authentication Endpoints

### POST /api/auth/register
**Purpose:** Register new user  
**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}
```
**Response:** User object + JWT token

---

### POST /api/auth/login
**Purpose:** User login  
**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
**Response:** User object + JWT token

---

### POST /api/auth/logout
**Purpose:** User logout  
**Headers:** `Authorization: Bearer {token}`  
**Response:** Success message

---

### POST /api/auth/refresh
**Purpose:** Refresh JWT token  
**Headers:** `Authorization: Bearer {token}`  
**Response:** New JWT token

---

### GET /api/auth/validate
**Purpose:** Validate current token  
**Headers:** `Authorization: Bearer {token}`  
**Response:** Token validity status

---

### POST /api/auth/reset-password
**Purpose:** Reset user password  
**Body:**
```json
{
  "email": "user@example.com",
  "newPassword": "newpassword123",
  "resetToken": "token_from_email"
}
```
**Response:** Success message

---

### POST /api/auth/check-email
**Purpose:** Check if email exists  
**Body:**
```json
{ "email": "user@example.com" }
```
**Response:** `{ exists: boolean }`

---

### GET /api/auth/verify-email
**Purpose:** Verify email address  
**Query:** `?token=verification_token`  
**Response:** Redirect to success/error page

---

### POST /api/auth/send-verification
**Purpose:** Send email verification  
**Body:** `{ "email": "user@example.com" }`  
**Response:** Success message

---

## 💬 Chat & Agent Endpoints

### POST /api/chat
**Purpose:** Main chat endpoint with priority routing  
**Authentication:** Recommended  
**Body:**
```json
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "provider": "openrouter",
  "model": "deepseek/deepseek-r1",
  "temperature": 0.7,
  "maxTokens": 4000,
  "stream": true
}
```
**Response:** Chat completion (streaming or non-streaming)  
**Features:** Priority routing, Fast-Agent integration, n8n workflows

---

### POST /api/chat-with-context
**Purpose:** Chat with file context from cloud storage  
**Body:**
```json
{
  "messages": [...],
  "cloudProvider": "nextcloud",
  "filePath": "/path/to/file.txt",
  "credentials": {}
}
```
**Response:** Chat completion with file context

---

### GET /api/chat/history
**Purpose:** Get user's chat history  
**Authentication:** Required  
**Query:** `?limit=20&offset=0`  
**Response:**
```json
[
  {
    "id": "chat-abc123",
    "title": "Conversation Title",
    "createdAt": "2026-02-25T10:00:00.000Z",
    "messageCount": 15
  }
]
```

---

### POST /api/agent
**Purpose:** Direct Fast-Agent orchestration  
**Authentication:** Recommended  
**Body:**
```json
{
  "action": "execute|plan|analyze",
  "context": "User request",
  "tools": ["tool1", "tool2"],
  "parameters": {}
}
```
**Response:** Agent execution result

---

### GET /api/agent/health
**Purpose:** Check agent service health  
**Authentication:** None  
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-25T10:00:00.000Z",
  "version": "1.0.0"
}
```

---

### POST /api/agent/workflows
**Purpose:** Execute agent workflows  
**Authentication:** Recommended  
**Body:**
```json
{
  "workflowId": "wf-123",
  "action": "start|stop|status"
}
```
**Response:** Workflow status

---

### POST /api/stateful-agent (NEW - 2026 Architecture)
**Purpose:** Advanced AI agent with Plan-Act-Verify workflow, self-healing, and multi-provider fallback  
**Authentication:** Recommended  
**Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Add a hello function to utils.ts" }
  ],
  "sessionId": "optional-session-id",
  "stream": false,
  "useAI_SDK": true,
  "provider": "openai",
  "model": "gpt-4o",
  "maxSteps": 10,
  "enforcePlanActVerify": true
}
```
**Response:** Agent execution result with VFS snapshot

**Features:**
- Plan-Act-Verify workflow (Discovery → Planning → Editing → Verification)
- Self-healing retry on errors (max 3 attempts by default)
- Multi-provider fallback: OpenAI → Anthropic → Google
- Human-in-the-loop (HITL) for sensitive operations
- Checkpoint/resume for long-running tasks

---

### POST /api/stateful-agent/interrupt (NEW)
**Purpose:** Approve or reject pending human-in-the-loop (HITL) requests  
**Authentication:** Required  
**Body:**
```json
{
  "requestId": "req-123",
  "action": "approve|reject",
  "reason": "Approved for production deployment"
}
```
**Response:** `{ "success": true, "message": "Request approved" }`

---

## 🐳 Docker Management

**Security:** All Docker endpoints require authentication and validate container IDs.

### GET /api/docker/containers
**Purpose:** List all Docker containers  
**Authentication:** Required  
**Response:**
```json
[
  {
    "id": "a1b2c3d4e5f6",
    "name": "nginx-proxy",
    "image": "nginx:latest",
    "state": "running",
    "status": "Up 2 hours",
    "ports": ["80:80"],
    "created": "2026-02-25T10:00:00.000Z"
  }
]
```

---

### POST /api/docker/start/:id
**Purpose:** Start a stopped container  
**Authentication:** Required  
**Validation:** Container ID must match `/^[a-f0-9]{12,64}$/`  
**Response:** `{ "success": true }`  
**Errors:** 401 (auth), 400 (invalid ID), 500 (failed)

---

### POST /api/docker/stop/:id
**Purpose:** Stop a running container  
**Authentication:** Required  
**Validation:** Container ID format  
**Response:** `{ "success": true }`

---

### DELETE /api/docker/remove/:id
**Purpose:** Remove container (force)  
**Authentication:** Required  
**Validation:** Container ID format  
**Response:** `{ "success": true }`

---

### POST /api/docker/exec
**Purpose:** Execute command in container  
**Authentication:** Required  
**Body:**
```json
{
  "containerId": "a1b2c3d4e5f6",
  "command": "ps aux"
}
```

**Allowed Commands (19):**
```
ps, ls, df, top, free, uptime, whoami, pwd, cat, tail, head,
grep, find, du, netstat, ss, ip, ifconfig, ping
```

**Blocked:** `curl`, `wget` (prevent data exfiltration)  
**Validation:** Container ID + command whitelist + no shell metacharacters  
**Response:**
```json
{
  "success": true,
  "output": "USER PID %CPU COMMAND\nroot 1 0.0 /sbin/init"
}
```

---

### GET /api/docker/logs/:id
**Purpose:** Get container logs  
**Authentication:** Required  
**Query:** `?tail=200` (optional, default: 200)  
**Features:** Auto-detects TTY vs non-TTY format  
**Response:**
```json
[
  {
    "timestamp": "2026-02-25T10:30:00.000Z",
    "level": "INFO",
    "message": "Server started"
  }
]
```

---

### POST /api/docker/compose
**Purpose:** Deploy Docker Compose stacks  
**Authentication:** Required  
**Body:**
```json
{
  "compose": "version: '3.8'\nservices:\n  web:\n    image: nginx:latest"
}
```
**Response:**
```json
{
  "success": true,
  "services": ["web", "db"]
}
```

---

## ☁️ Cloud Storage

**Security:** All storage endpoints require authentication.

### GET /api/storage/list
**Purpose:** List files in cloud storage  
**Query:** `?prefix=folder/`  
**Response:**
```json
{
  "success": true,
  "data": {
    "files": ["file1.txt", "folder/file2.pdf"],
    "prefix": "folder/"
  }
}
```

---

### POST /api/storage/upload
**Purpose:** Upload file  
**Content-Type:** `multipart/form-data`  
**Form:** `file` (File), `path` (string)  
**Response:** `{ "success": true, "url": "https://..." }`

---

### GET /api/storage/download/:path
**Purpose:** Download file  
**Query:** `?path=` (URL encoded)  
**Response:** File blob

---

### DELETE /api/storage/delete
**Purpose:** Delete file  
**Query:** `?path=` (URL encoded)  
**Response:** `{ "success": true }`

---

### GET /api/storage/signed-url
**Purpose:** Get temporary signed URL  
**Query:** `?path=` (URL encoded)  
**Response:**
```json
{
  "success": true,
  "data": { "signedUrl": "https://...?signature=abc&expires=123" }
}
```

---

### GET /api/storage/usage
**Purpose:** Get storage usage  
**Response:**
```json
{
  "success": true,
  "data": { "used": 1073741824, "limit": 5368709120 }
}
```

---

## 🧪 Sandbox & Code Execution

### POST /api/sandbox/execute
**Purpose:** Execute code in isolated sandbox
**Authentication:** Required
**Body:**
```json
{
  "code": "console.log('Hello')",
  "language": "javascript",
  "timeout": 5000
}
```
**Response:**
```json
{
  "success": true,
  "output": "Hello\n",
  "error": null,
  "executionTime": 42
}
```

---

### GET /api/sandbox/session
**Purpose:** Get/create sandbox session
**Authentication:** Required
**Response:**
```json
{
  "sessionId": "sess-abc123",
  "expiresAt": "2026-02-25T12:00:00.000Z",
  "resources": {}
}
```

---

### POST /api/sandbox/terminal
**Purpose:** Create terminal session
**Body:** `{ "sessionId": "sess-abc123", "shell": "bash" }`
**Response:** `{ "terminalId": "term-xyz789", "ready": true }`

---

### POST /api/sandbox/terminal/stream
**Purpose:** Stream terminal output (SSE)
**Authentication:** Required
**Query:** `?sessionId={id}&sandboxId={id}`
**Response:** Server-Sent Events stream
**Event Types:** `connected`, `pty`, `agent:tool_start`, `agent:tool_result`, `agent:complete`, `port_detected`, `error`

---

### POST /api/sandbox/terminal/input
**Purpose:** Send input to terminal PTY
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "data": "ls -la\n"
}
```
**Response:** `{ "success": true }`

---

### POST /api/sandbox/terminal/resize
**Purpose:** Resize terminal PTY
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "cols": 80,
  "rows": 24
}
```
**Response:** `{ "success": true }`

---

### POST /api/sandbox/files
**Purpose:** File operations in sandbox
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "operation": "write|read|list|delete",
  "path": "/workspace/file.txt",
  "content": "..." // for write
}
```
**Response:** File operation result

---

### POST /api/sandbox/sync
**Purpose:** Sync virtual filesystem to sandbox (tar-pipe for Sprites)
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "files": [
    { "path": "src/index.ts", "content": "..." }
  ],
  "incremental": true
}
```
**Response:**
```json
{
  "success": true,
  "filesSynced": 15,
  "duration": 3200,
  "method": "tar-pipe"
}
```

---

### POST /api/sandbox/checkpoint
**Purpose:** Create/manage sandbox checkpoints (Sprites)
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "operation": "create|restore|list|delete",
  "checkpointId": "cp-xyz", // for restore/delete
  "name": "before-deploy"  // for create
}
```
**Response:** Checkpoint operation result

---

### POST /api/sandbox/sshfs
**Purpose:** Mount sandbox filesystem via SSHFS (Sprites)
**Authentication:** Required
**Body:**
```json
{
  "sessionId": "sess-abc123",
  "operation": "mount|unmount",
  "mountPoint": "/tmp/sprite-mount",
  "port": 2000
}
```
**Response:** Mount operation result

---

### POST /api/code
**Purpose:** Code operations (format, analyze, lint)  
**Body:**
```json
{
  "code": "function example() {}",
  "operation": "format|analyze|lint",
  "language": "javascript"
}
```
**Response:** Processed code result

---

## 🤖 CI/CD Pipelines

### GET /api/cicd/pipelines
**Purpose:** List CI/CD pipelines  
**Authentication:** Required  
**Response:**
```json
[
  {
    "id": "pipeline-123",
    "name": "Build & Deploy",
    "status": "success",
    "branch": "main"
  }
]
```

---

### POST /api/cicd/restart/:id
**Purpose:** Restart pipeline  
**Authentication:** Required  
**Audit Logging:** Yes (user, timestamp, IP, outcome)  
**Response:** `{ "success": true }`

**Sample Audit Log:**
```json
[AUDIT] {
  "timestamp": "2026-02-25T10:30:00.000Z",
  "userId": "user123",
  "action": "pipeline_restart",
  "resource": "pipeline-456",
  "outcome": "success",
  "ipAddress": "192.168.1.100"
}
```

---

## 🎨 OAuth Integrations

### Generic OAuth

#### POST /api/auth/oauth/initiate
**Purpose:** Start OAuth flow  
**Body:** `{ "provider": "github|google", "scopes": [...] }`  
**Response:** `{ "authorizationUrl": "https://..." }`

#### GET /api/auth/oauth/callback
**Purpose:** Handle OAuth callback  
**Query:** `?code=...&state=...`  
**Response:** Redirect to success/error

#### GET /api/auth/oauth/success | /api/auth/oauth/error
**Purpose:** OAuth result pages  
**Response:** HTML page

---

### Notion OAuth

#### GET /api/oauth/notion/start
**Purpose:** Initiate Notion OAuth  
**Security:** CSRF state in HTTP-only cookie (5 min expiry)  
**Response:** 302 redirect to Notion

---

#### GET /api/oauth/notion/callback
**Purpose:** Handle Notion callback  
**Query:** `?code=...&state=...`  
**Security:**
- State validation (CSRF protection)
- Access token stored in HTTP-only cookie (not returned to browser)
- Token expires in 30 days

**Response:**
```json
{
  "success": true,
  "workspace_id": "abc123",
  "workspace_name": "My Workspace"
}
```

---

### Nango Integration

#### GET /api/auth/nango/authorize
**Purpose:** Authorize Nango integration  
**Query:** `?provider=...&connectionId=...`  
**Response:** Redirect to provider

---

### Arcade Integration

#### GET /api/auth/arcade/authorize
**Purpose:** Arcade OAuth  
**Response:** Redirect to Arcade

#### GET /api/auth/arcade/custom-verifier
**Purpose:** Custom verifier for Arcade  
**Response:** Verifier token

---

## 🖼️ AI & Media

### Image Generation

#### POST /api/image/generate
**Purpose:** Generate images (Replicate)  
**Body:**
```json
{
  "prompt": "Beautiful landscape",
  "model": "sdxl",
  "width": 1024,
  "height": 1024,
  "steps": 30,
  "guidance": 7.5,
  "seed": 42,
  "numImages": 4
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "images": ["url1", "url2", "url3", "url4"]
  }
}
```

---

### HuggingFace

#### POST /api/huggingface/inference
**Purpose:** Run model inference  
**Authentication:** Recommended  
**Body:**
```json
{
  "model": "stabilityai/stable-diffusion-xl",
  "inputs": "A landscape",
  "parameters": { "width": 1024 }
}
```
**Security:** Binary responses handled correctly, error details server-side only

---

#### POST /api/huggingface/audio
**Purpose:** Audio processing (STT/TTS)  
**Content-Type:** `multipart/form-data`  
**Form:** `model`, `text` (TTS), `audio` (STT)  
**Validation:** Model ID format (prevents path traversal/SSRF)

---

### Text-to-Speech

#### POST /api/tts
**Purpose:** Convert text to speech  
**Authentication:** Required  
**Body:**
```json
{
  "text": "Hello world",
  "provider": "elevenlabs|cartesia|web",
  "voiceId": "voice-id"
}
```
**Providers:** ElevenLabs, Cartesia, Web (browser SpeechSynthesis)  
**Security:** VoiceId validation (alphanumeric only)

---

### Voice/LiveKit

#### POST /api/livekit/token
**Purpose:** Generate LiveKit token for voice  
**Body:** `{ "roomName": "room", "participantName": "user" }`  
**Response:** `{ "token": "...", "url": "wss://..." }`

---

## 📁 Virtual Filesystem

**Documentation:** See [Virtual Filesystem API Guide](./VIRTUAL_FILESYSTEM_API_GUIDE.md) for complete details.

The Virtual Filesystem provides sandbox-independent, persistent file storage with per-user isolation. Supports both authenticated and anonymous users.

### Architecture

- **Service:** `lib/virtual-filesystem/virtual-filesystem-service.ts`
- **Types:** `lib/virtual-filesystem/filesystem-types.ts`
- **Auth:** `lib/virtual-filesystem/resolve-filesystem-owner.ts`
- **Storage:** `data/virtual-filesystem/{hash}.json`

### Owner Resolution

Automatically resolves file ownership via priority chain:
1. **JWT Token** → User UUID
2. **Session Cookie** → User UUID
3. **Anonymous** → `'anon:public'`
4. **Fallback** → `'anon:public'`

### Security Features

- ✅ Path traversal prevention (`..` blocked)
- ✅ Null byte injection prevention
- ✅ Max path length (1024 chars)
- ✅ Atomic writes (tmp + rename)
- ✅ Write queue serialization

---

### GET /api/filesystem/list

**Purpose:** List directory contents  
**Authentication:** Optional (supports anonymous)  
**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `'project'` | Directory to list |

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
        "type": "file",
        "name": "index.ts",
        "path": "project/src/index.ts",
        "language": "typescript",
        "size": 1024,
        "lastModified": "2026-02-26T10:30:00.000Z"
      }
    ]
  },
  "owner_source": "jwt"
}
```

---

### POST /api/filesystem/read

**Purpose:** Read file content  
**Authentication:** Optional (supports anonymous)  
**Body:**
```json
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
    "content": "export const app = require('./app');\napp.start();",
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
{ "success": false, "error": "File not found: project/src/index.ts" }

// 400 Bad Request
{ "success": false, "error": "path is required" }
```

---

### POST /api/filesystem/write

**Purpose:** Create or update file  
**Authentication:** Optional (supports anonymous)  
**Body:**
```json
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
- Creates parent directories automatically (virtual)
- Increments version on updates
- Auto-detects language from extension
- Atomic writes prevent corruption

**Error Responses:**
```json
// 400 Bad Request
{ "success": false, "error": "path is required" }

// 400 Bad Request (security)
{ "success": false, "error": "Path traversal is not allowed: project/../etc/passwd" }
```

---

### POST /api/filesystem/delete

**Purpose:** Delete file or directory (recursive)  
**Authentication:** Optional (supports anonymous)  
**Body:**
```json
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
- Deleting directory removes all nested files
- Returns count of deleted items
- No error if path doesn't exist (returns `deletedCount: 0`)

---

### GET /api/filesystem/search

**Purpose:** Search files by name, path, or content  
**Authentication:** Optional (supports anonymous)  
**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | - | Search query (required) |
| `path` | string | `'project'` | Scope to path |
| `limit` | number | `25` | Max results (1-200) |

**Example Request:**
```bash
GET /api/filesystem/search?q=helper&path=project/src&limit=10
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
        "snippet": "...export function helper() { return 'Hello'; }...",
        "lastModified": "2026-02-26T10:45:00.000Z"
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

Results sorted by score (descending), then path.

---

### TypeScript Service API

Direct usage without HTTP:

```typescript
import { virtualFilesystem } from '@/lib/virtual-filesystem';

// Read
const file = await virtualFilesystem.readFile('user123', 'project/src/index.ts');

// Write
await virtualFilesystem.writeFile('user123', 'project/src/new.ts', 'content');

// List
const listing = await virtualFilesystem.listDirectory('user123', 'project');

// Search
const results = await virtualFilesystem.search('user123', 'helper', { limit: 10 });

// Delete
await virtualFilesystem.deletePath('user123', 'project/src/old');

// Export
const snapshot = await virtualFilesystem.exportWorkspace('user123');
```

---

## 🛠️ Tools & Utilities

### POST /api/tools/execute
**Purpose:** Execute registered tools  
**Authentication:** Required  
**Body:**
```json
{
  "tool": "tool-name",
  "parameters": { "param1": "value1" }
}
```
**Available Tools:** File ops, shell commands (restricted), API calls, DB queries

---

### GET /api/providers
**Purpose:** List AI providers  
**Authentication:** Recommended  
**Response:**
```json
[
  {
    "id": "openai",
    "name": "OpenAI",
    "models": ["gpt-4", "gpt-3.5-turbo"],
    "configured": true
  }
]
```

---

### GET /api/plugins/marketplace
**Purpose:** List available plugins  
**Query:** `?search=...&category=...`  
**Response:**
```json
[
  {
    "id": "plugin-id",
    "name": "Plugin Name",
    "author": "publisher-username",
    "category": "utility",
    "rating": 4.5,
    "installed": false
  }
]
```

---

### POST /api/modal/train
**Purpose:** Train models on Modal  
**Authentication:** Required  
**Body:**
```json
{
  "modelType": "text-classification",
  "dataset": "dataset-id",
  "parameters": { "epochs": 10 }
}
```
**Response:** `{ "jobId": "train-xyz", "status": "queued" }`

---

## 👤 User Management

### GET /api/user/profile
**Purpose:** Get user profile  
**Authentication:** Required  
**Response:** User profile object

---

### PUT /api/user/profile
**Purpose:** Update profile  
**Authentication:** Required  
**Body:** `{ "name": "New Name", "preferences": {...} }`

---

### GET /api/user/keys
**Purpose:** Get user's API keys  
**Authentication:** Required  
**Response:**
```json
{
  "keys": [
    {
      "id": "key-abc123",
      "name": "Production Key",
      "created": "2026-02-01T00:00:00.000Z",
      "lastUsed": "2026-02-25T10:00:00.000Z"
    }
  ]
}
```

---

### POST /api/user/keys
**Purpose:** Add/update API key  
**Authentication:** Required  
**Body:** `{ "provider": "openai", "key": "sk-..." }`

---

## 🔗 URL Services

### POST /api/url/shorten
**Purpose:** Create short URL  
**Body:** `{ "url": "https://example.com/long" }`  
**Validation:** Must be valid HTTP/HTTPS URL (400 on invalid, not 500)  
**Features:** LRU eviction (max 10,000, configurable)  
**Response:**
```json
{
  "original": "https://example.com/long",
  "shortened": "http://localhost:3000/api/url/redirect/abc12345",
  "clicks": 0
}
```

---

### GET /api/url/redirect/:id
**Purpose:** Redirect to original URL  
**Features:** 404 uses request origin (not hardcoded), increments click counter  
**Response:** 302 redirect

---

## 📡 Webhooks & Integrations

### POST /api/webhooks
**Purpose:** Receive webhooks  
**Authentication:** Varies by provider  
**Providers:** GitHub, Stripe, Vercel, custom  
**Response:** `{ "received": true }`

---

## 🏥 System & Health

### GET /api/health
**Purpose:** System health check  
**Authentication:** None  
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-25T10:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "docker": "available"
  }
}
```

---

## Security Summary

### Authentication Requirements

| Endpoint Category | Auth Required | Notes |
|------------------|---------------|-------|
| Authentication | No | Public endpoints |
| Chat/Agent | Recommended | Should be required |
| Docker | ✅ Required | All endpoints |
| Cloud Storage | ✅ Required | All endpoints |
| Sandbox | ✅ Required | All endpoints |
| CI/CD | ✅ Required | All endpoints |
| OAuth | Varies | Provider-specific |
| User | ✅ Required | All endpoints |
| TTS | ✅ Required | Prevents quota abuse |
| HuggingFace | Recommended | Should be required |
| Webhooks | Varies | Provider-specific |

### Input Validation

| Input | Validation Pattern | Notes |
|-------|-------------------|-------|
| Container ID | `/^[a-f0-9]{12,64}$/` | Docker endpoints |
| Commands | Whitelist (19 allowed) | No shell metacharacters |
| URLs | Valid HTTP/HTTPS | 400 on invalid |
| Model ID | `/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/...)?$/` | Prevents SSRF |
| VoiceId | `/^[a-zA-Z0-9_-]+$/` | TTS only |

### Security Features

- **CSRF Protection:** OAuth state parameter validation
- **Command Injection Prevention:** Docker exec whitelist + metacharacter blocking
- **Data Exfiltration Prevention:** `curl`/`wget` blocked in Docker exec
- **Audit Logging:** Pipeline restarts logged with full context
- **Secure Token Storage:** HTTP-only cookies for OAuth tokens
- **Error Handling:** Generic client messages, detailed server logs

---

## Configuration

### Environment Variables

```bash
# Docker
DOCKER_SOCKET=/var/run/docker.sock

# URL Shortener
URL_SHORTENER_MAX_STORE_SIZE=10000

# OAuth
NOTION_CLIENT_ID=your-client-id
NOTION_CLIENT_SECRET=your-client-secret
NOTION_REDIRECT_URI=https://your-app.com/api/oauth/notion/callback

# Security
JWT_SECRET=your-jwt-secret-here
ENCRYPTION_KEY=your-64-char-hex-key-here

# AI Providers
REPLICATE_API_TOKEN=your-token
HUGGINGFACE_API_TOKEN=your-token
```

---

## Error Handling

All endpoints follow consistent error patterns:

```typescript
// 401 Authentication
return NextResponse.json(
  { error: 'Authentication required' },
  { status: 401 }
);

// 400 Validation
return NextResponse.json(
  { error: 'Invalid container ID format' },
  { status: 400 }
);

// 403 Authorization
return NextResponse.json(
  { error: 'Command not allowed' },
  { status: 403 }
);

// 500 Server Error
return NextResponse.json(
  { error: 'Failed to execute command' },
  { status: 500 }
);
```

**Security Note:** Error responses don't leak internal details.

---

## Base URLs

- **Development:** `http://localhost:3000/api`
- **Production:** `https://your-domain.com/api`

---

## Related Documentation

- [SECURITY_UPDATES.md](../SECURITY_UPDATES.md) - Dependency security fixes
- [DATABASE_SECURITY.md](DATABASE_SECURITY.md) - Encryption and backup security
- [Audit Logger](../lib/audit/audit-logger.ts) - Implementation details

---

**Questions?** Check route files in `app/api/` or contact the team.
