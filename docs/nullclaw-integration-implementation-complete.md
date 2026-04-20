---
id: nullclaw-integration-implementation-complete
title: Nullclaw Integration - Implementation Complete
aliases:
  - NULLCLAW_IMPLEMENTATION
  - NULLCLAW_IMPLEMENTATION.md
  - nullclaw-integration-implementation-complete
  - nullclaw-integration-implementation-complete.md
tags:
  - implementation
layer: core
summary: "# Nullclaw Integration - Implementation Complete\r\n\r\n## Summary\r\n\r\nThe Nullclaw integration has been successfully refactored to support a **hybrid approach**:\r\n1. **URL-based** (Primary) - Use external Nullclaw service via HTTP\r\n2. **Container Pool** (Fallback) - Spawn local containers when URL not a"
anchors:
  - Summary
  - Files Modified
  - Core Integration
  - Docker Compose Configuration
  - Important Notes
  - Response Handling
  - HTTP Response Format (Already Implemented)
  - Response Handling Flow
  - Response Processing
  - Configuration
  - Production (URL Mode)
  - Development (Container Pool)
  - Isolated (Per-Session)
  - Testing
  - Check Status
  - Execute Task
  - Migration Notes
  - Breaking Changes
  - Non-Breaking
  - Architecture Diagram
  - Documentation
---
# Nullclaw Integration - Implementation Complete

## Summary

The Nullclaw integration has been successfully refactored to support a **hybrid approach**:
1. **URL-based** (Primary) - Use external Nullclaw service via HTTP
2. **Container Pool** (Fallback) - Spawn local containers when URL not available

**Key Feature**: Container implementations are **fully preserved** with proper variable checking:
- If `NULLCLAW_URL` is set → Use external service
- If `NULLCLAW_MODE=shared` → Spawn container pool
- If `NULLCLAW_MODE=per-session` → Spawn dedicated container per session

## Files Modified

### Core Integration
- **`lib/agent/nullclaw-integration.ts`** - Complete rewrite with hybrid approach
  - URL-based configuration (`NULLCLAW_URL`)
  - Container pool management (shared/per-session modes)
  - Automatic initialization and health checks
  - Task execution with session tracking
  - **Container implementations preserved** with proper variable checking

### Docker Compose Configuration
- **`docker-compose.yml`** - Added Nullclaw service and environment variables
- **`docker-compose.v2.yml`** - Updated Nullclaw configuration
- **`env.example`** - Comprehensive Nullclaw environment variables

### Important Notes

**Dockerfile**: No changes needed - app container does NOT need Docker CLI
- URL mode: App makes HTTP calls to external Nullclaw service
- Container mode: App uses Docker socket (mounted in docker-compose)

**Architecture**:
- Production: Use URL mode with Nullclaw as separate service
- Development: Use container mode with Docker socket mount

## Response Handling

### HTTP Response Format (Already Implemented)

Both URL-based and container modes use the same HTTP API:

```typescript
// Request
POST /tasks/execute
{
  "type": "message" | "browse" | "automate" | "api" | "schedule",
  "description": "Task description",
  "params": { ... }
}

// Response
{
  "id": "task-uuid",
  "status": "pending" | "running" | "completed" | "failed",
  "result": { ... },  // On success
  "error": "Error message"  // On failure
}
```

### Response Handling Flow

```
┌─────────────────┐
│  Tool Call      │
│  (nullclaw_*)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  nullclawMCP    │
│  Bridge         │
│  executeTool()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  nullclaw       │
│  Integration    │
│  executeTask()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  HTTP POST      │
│  /tasks/execute │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Nullclaw       │
│  Service        │
│  (URL or Local) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  JSON Response  │
│  { status,      │
│    result,      │
│    error }      │
└─────────────────┘
```

### Response Processing

The response is already handled correctly in `nullclaw-mcp-bridge.ts`:

```typescript
const result = await nullclawIntegration.executeTask(...);

return {
  success: result.status === 'completed',
  output: JSON.stringify(result.result || {}),
  error: result.error,
  metadata: {
    taskId: result.id,
    status: result.status,
  },
};
```

This works for **both** URL and container modes because:
1. Both use the same HTTP API
2. Both return the same JSON structure
3. The integration layer abstracts the deployment mode

## Configuration

### Production (URL Mode)
```bash
NULLCLAW_URL=http://nullclaw:3000
NULLCLAW_API_KEY=your-api-key
NULLCLAW_ENABLED=true
```

### Development (Container Pool)
```bash
NULLCLAW_MODE=shared
NULLCLAW_POOL_SIZE=2
NULLCLAW_ENABLED=true
```

### Isolated (Per-Session)
```bash
NULLCLAW_MODE=per-session
NULLCLAW_MAX_CONTAINERS=4
NULLCLAW_ENABLED=true
```

## Testing

### Check Status
```typescript
import { 
  isNullclawAvailable,
  getNullclawStatus,
  getNullclawMode
} from '@bing/shared/agent/nullclaw-integration';

console.log(`Available: ${isNullclawAvailable()}`);
console.log(`Mode: ${getNullclawMode()}`);
console.log(`Status:`, getNullclawStatus());
```

### Execute Task
```typescript
import { sendNullclawDiscordMessage } from '@bing/shared/agent/nullclaw-integration';

const task = await sendNullclawDiscordMessage(
  'channel-id',
  'Hello!',
  userId,
  conversationId
);

console.log(`Task ${task.status}: ${task.result?.output}`);
```

## Migration Notes

### Breaking Changes
- `initializeForSession()` → `initialize()` (no session-specific init)
- `startContainer()` → Removed (handled automatically)
- `executeTask(sessionId, userId, task)` → `executeTask(type, description, params, userId, conversationId)`
- `getContainerForSession()` → `getContainerForSession()` (internal use only)
- `setNullclawEndpoint()` → `setNullclawAvailable()`

### Non-Breaking
- `nullclawMCPBridge.executeTool()` - Still works as before
- Tool definitions - Unchanged
- Response format - Unchanged

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│  OpenCode Application                                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Task Router  │  │ MCP Bridge   │  │ V2 Provider  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │          │
│         └─────────────────┴─────────────────┘          │
│                           │                             │
│                  ┌────────▼────────┐                   │
│                  │  nullclaw       │                   │
│                  │  Integration    │                   │
│                  │  (Singleton)    │                   │
│                  └────────┬────────┘                   │
└───────────────────────────┼────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐
    │  URL Mode       │         │  Container Mode │
    │  (Primary)      │         │  (Fallback)     │
    │                 │         │                 │
    │  NULLCLAW_URL   │         │  Shared Pool    │
    │  http://...     │         │  or Per-Session │
    └────────┬────────┘         └────────┬────────┘
             │                           │
             └─────────────┬─────────────┘
                           │
                           ▼
                 ┌─────────────────┐
                 │  Nullclaw       │
                 │  Service        │
                 │  (HTTP API)     │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │  External APIs  │
                 │  - Discord      │
                 │  - Telegram     │
                 │  - Web Browsing │
                 └─────────────────┘
```

## Documentation

See `docs/NULLCLAW_CONFIGURATION.md` for:
- Complete environment variable reference
- Deployment examples
- Troubleshooting guide
- Usage examples
