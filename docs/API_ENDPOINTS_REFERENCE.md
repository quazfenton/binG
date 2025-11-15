# API Endpoints Reference

## Complete List of Available Endpoints

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
**Headers:** Authorization: Bearer {token}  
**Response:** Success message

---

### POST /api/auth/refresh
**Purpose:** Refresh JWT token  
**Headers:** Authorization: Bearer {token}  
**Response:** New JWT token

---

### GET /api/auth/validate
**Purpose:** Validate current token  
**Headers:** Authorization: Bearer {token}  
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
{
  "email": "user@example.com"
}
```
**Response:** { exists: boolean }

---

## 💬 Chat Endpoints

### POST /api/chat
**Purpose:** Main chat endpoint with priority routing  
**Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Your message here" }
  ],
  "provider": "openrouter",
  "model": "deepseek/deepseek-r1",
  "temperature": 0.7,
  "maxTokens": 4000,
  "stream": true,
  "apiKeys": {}
}
```
**Response:** Chat completion (streaming or non-streaming)  
**Features:**
- Priority-based routing
- Fast-Agent integration
- n8n agent chaining
- Custom fallback
- Zero API errors guarantee

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

## 🚀 Advanced AI Endpoints

### POST /api/ai/advanced
**Purpose:** Advanced chat with Cloudflare Worker orchestration  
**Body:**
```json
{
  "prompt": "Your complex request",
  "mode": "quality",
  "options": {
    "maxIterations": 3,
    "qualityThreshold": 0.85,
    "parallelVariants": [...]
  }
}
```
**Response:**
```json
{
  "jobId": "uuid",
  "statusUrl": "/api/ai/status/uuid",
  "streamUrl": "/api/ai/stream/uuid"
}
```

---

### GET /api/ai/status/{jobId}
**Purpose:** Get status of advanced AI job  
**Response:**
```json
{
  "meta": {
    "id": "uuid",
    "status": "running|succeeded|failed",
    "candidates": [...],
    "winner": {...},
    "final": {...}
  },
  "events": [...]
}
```

---

### GET /api/ai/stream/{jobId}
**Purpose:** Server-Sent Events stream for job progress  
**Response:** SSE stream with real-time updates

---

## 💻 Code Endpoints

### POST /api/code
**Purpose:** Code-specific operations (formatting, analysis)  
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

## 🖼️ Image Generation

### POST /api/image/generate
**Purpose:** Generate images using AI  
**Body:**
```json
{
  "prompt": "A beautiful landscape",
  "model": "flux-schnell",
  "size": "1024x1024"
}
```
**Response:**
```json
{
  "imageUrl": "https://...",
  "metadata": {...}
}
```

---

## 🎙️ Voice/LiveKit

### POST /api/livekit/token
**Purpose:** Generate LiveKit token for voice features  
**Body:**
```json
{
  "roomName": "chat-room",
  "participantName": "user123"
}
```
**Response:**
```json
{
  "token": "livekit_token",
  "url": "wss://..."
}
```

---

## 💡 Suggestions

### POST /api/suggest
**Purpose:** Get AI-powered suggestions  
**Body:**
```json
{
  "context": "Current context",
  "type": "code|text|action"
}
```
**Response:**
```json
{
  "suggestions": [
    { "text": "Suggestion 1", "confidence": 0.9 },
    { "text": "Suggestion 2", "confidence": 0.85 }
  ]
}
```

---

## ☁️ Cloud Storage Endpoints

### POST /api/storage/upload
**Purpose:** Upload files to cloud storage  
**Body:** FormData with file  
**Response:**
```json
{
  "url": "https://storage.../file.txt",
  "key": "file-key"
}
```

---

### POST /api/storage/download
**Purpose:** Download file from cloud storage  
**Body:**
```json
{
  "key": "file-key"
}
```
**Response:** File stream

---

### GET /api/storage/list
**Purpose:** List files in storage  
**Query:** ?prefix=folder/  
**Response:**
```json
{
  "files": [
    { "key": "file1.txt", "size": 1024, "lastModified": "..." }
  ]
}
```

---

### DELETE /api/storage/delete
**Purpose:** Delete file from storage  
**Body:**
```json
{
  "key": "file-key"
}
```
**Response:** Success message

---

### POST /api/storage/signed-url
**Purpose:** Generate signed URL for file  
**Body:**
```json
{
  "key": "file-key",
  "expiresIn": 3600
}
```
**Response:**
```json
{
  "url": "https://...",
  "expiresAt": "..."
}
```

---

### GET /api/storage/usage
**Purpose:** Get storage usage statistics  
**Response:**
```json
{
  "used": 1024000,
  "total": 10240000,
  "percentage": 10
}
```

---

## 👤 User Management

### GET /api/user/profile
**Purpose:** Get user profile  
**Headers:** Authorization: Bearer {token}  
**Response:** User profile object

---

### PUT /api/user/profile
**Purpose:** Update user profile  
**Headers:** Authorization: Bearer {token}  
**Body:**
```json
{
  "name": "New Name",
  "preferences": {...}
}
```
**Response:** Updated profile

---

### GET /api/user/keys
**Purpose:** Get user's API keys  
**Headers:** Authorization: Bearer {token}  
**Response:**
```json
{
  "keys": [
    { "provider": "openai", "key": "sk-...", "masked": "sk-...***" }
  ]
}
```

---

### POST /api/user/keys
**Purpose:** Add/update API key  
**Headers:** Authorization: Bearer {token}  
**Body:**
```json
{
  "provider": "openai",
  "key": "sk-..."
}
```
**Response:** Success message

---

## 🏥 Health Check

### GET /api/health
**Purpose:** API health check  
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-18T...",
  "services": {
    "database": "ok",
    "storage": "ok"
  }
}
```

---

## 🔄 Cloudflare Worker Endpoints (When Deployed)

### POST https://your-worker.workers.dev/session/start
**Purpose:** Start advanced orchestration session  
**Body:**
```json
{
  "prompt": "Your request",
  "mode": "quality|fast|balanced",
  "options": {...}
}
```

### GET https://your-worker.workers.dev/session/{id}/status
**Purpose:** Get session status

### GET https://your-worker.workers.dev/session/{id}/stream
**Purpose:** SSE stream for session

### POST https://your-worker.workers.dev/session/{id}/cancel
**Purpose:** Cancel session

### POST https://your-worker.workers.dev/proxy
**Purpose:** Simple proxy to Fast-Agent

### GET https://your-worker.workers.dev/health
**Purpose:** Worker health check

---

## 📊 Endpoint Summary

| Category | Count | Status |
|----------|-------|--------|
| Authentication | 7 | ✅ Active |
| Chat | 2 | ✅ Active |
| Advanced AI | 3 | ✅ Active |
| Code | 1 | ✅ Active |
| Image | 1 | ✅ Active |
| Voice/LiveKit | 1 | ✅ Active |
| Suggestions | 1 | ✅ Active |
| Storage | 6 | ✅ Active |
| User | 3 | ✅ Active |
| Health | 1 | ✅ Active |
| **Total Next.js** | **26** | **✅ Active** |
| **Cloudflare Worker** | **6** | **⏳ Ready to Deploy** |

---

## 🔑 Authentication

Most endpoints (except auth and health) require authentication:

```http
Authorization: Bearer your_jwt_token
```

Get token from `/api/auth/login` or `/api/auth/register`

---

## 🌐 Base URLs

- **Next.js API:** `http://localhost:3000/api` (dev) or `https://your-domain.com/api` (prod)
- **Cloudflare Worker:** `https://your-worker.workers.dev` (when deployed)

---

## 💡 Usage Examples

### Simple Chat
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello!' }],
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1'
  })
});
```

### Advanced Quality Mode
```javascript
// Start job
const startRes = await fetch('/api/ai/advanced', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Write production-ready auth system',
    mode: 'quality'
  })
});
const { jobId, streamUrl } = await startRes.json();

// Stream progress
const eventSource = new EventSource(streamUrl);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Progress:', data);
};
```

---

## 🔄 Request Flow

```
Client Request
    ↓
Next.js API Endpoint
    ↓
Priority Router (for /api/chat)
    ├─ Cloudflare Worker (advanced mode)
    ├─ Fast-Agent (direct)
    ├─ n8n Agents (workflows)
    ├─ Custom Fallback
    └─ Original System
    ↓
Response to Client
```

---

## 📝 Notes

- **Streaming:** Use `stream: true` for real-time responses
- **Rate Limits:** Varies by provider/endpoint
- **Timeouts:** Most endpoints have 30-60s timeout
- **CORS:** Configured for your domain

---

**Questions about specific endpoints?** Check the route files in `app/api/` or ask!

---

## 🤖 Fast-Agent Endpoints (NEW - Dedicated)

### POST /api/agent
**Purpose:** Direct Fast-Agent access (separated from main chat)  
**Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Your message" }
  ],
  "provider": "openrouter",
  "model": "deepseek/deepseek-r1",
  "temperature": 0.7,
  "maxTokens": 4000,
  "stream": true
}
```
**Response:** Fast-Agent output (streaming or non-streaming)  
**Features:**
- Direct Fast-Agent communication
- MCP tools support
- File handling
- Quality optimization

---

### GET /api/agent
**Purpose:** Get Fast-Agent status and configuration  
**Response:**
```json
{
  "enabled": true,
  "endpoint": "https://fast-agent.yourdomain.com/api/chat",
  "supportedProviders": ["openai", "anthropic", "google"],
  "status": "available"
}
```

---

### GET /api/agent/health
**Purpose:** Fast-Agent health check  
**Response:**
```json
{
  "healthy": true,
  "enabled": true,
  "endpoint": "https://fast-agent.yourdomain.com/api/chat",
  "status": "ok"
}
```

---

### POST /api/agent/workflows
**Purpose:** Execute Fast-Agent workflows (chaining, parallel, router, evaluator)  
**Body:**
```json
{
  "workflow": "chaining",
  "input": "Your input",
  "config": {
    "agents": [...],
    "options": {...}
  }
}
```
**Response:** Workflow execution result  
**Note:** Currently returns 501 - implementation pending

---

### GET /api/agent/workflows
**Purpose:** List available workflows  
**Response:**
```json
{
  "availableWorkflows": [
    { "name": "chaining", "description": "..." },
    { "name": "parallel", "description": "..." },
    { "name": "router", "description": "..." },
    { "name": "evaluator", "description": "..." }
  ]
}
```

---
