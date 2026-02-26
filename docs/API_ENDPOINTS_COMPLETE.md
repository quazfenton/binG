# API Endpoints Reference - Complete Documentation

**Version:** 2.0 (Security Hardening Release)  
**Last Updated:** February 25, 2026  
**Total Endpoints:** 90+

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
9. [🛠️ Tools & Utilities](#-tools--utilities)
10. [👤 User Management](#-user-management)
11. [🔗 URL Services](#-url-services)
12. [📡 Webhooks & Integrations](#-webhooks--integrations)
13. [🏥 System & Health](#-system--health)
14. [Security Summary](#security-summary)
15. [Configuration](#configuration)

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
**Purpose:** Stream terminal output  
**Body:** `{ "terminalId": "term-xyz789", "data": "ls -la\n" }`  
**Response:** Terminal output stream

---

### POST /api/sandbox/terminal/input
**Purpose:** Send input to terminal  
**Body:** `{ "terminalId": "term-xyz789", "input": "cd /app\n" }`  
**Response:** `{ "success": true }`

---

### POST /api/sandbox/terminal/resize
**Purpose:** Resize terminal  
**Body:** `{ "terminalId": "term-xyz789", "cols": 80, "rows": 24 }`  
**Response:** `{ "success": true }`

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
