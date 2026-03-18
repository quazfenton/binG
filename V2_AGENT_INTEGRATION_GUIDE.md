# V2 Agent Integration Guide

**Architecture:** NextJS → Agent Gateway → Redis Queue → Workers

---

## 📊 Architecture Overview

```
┌─────────────────┐
│   NextJS App    │
│  /api/chat      │
└────────┬────────┘
         │ HTTP POST
         ▼
┌─────────────────┐
│  Agent Gateway  │  Port 3002
│  (Fastify)      │
└────────┬────────┘
         │ Redis LPUSH
         ▼
┌─────────────────┐
│   Redis Queue   │  agent:jobs
│  (PubSub +      │
│   Streams)      │
└────────┬────────┘
         │ Redis BRPOP
         ▼
┌─────────────────┐
│  Agent Workers  │  (scaled x3)
│  (OpenCode)     │
└────────┬────────┘
         │ Redis PubSub
         ▼
┌─────────────────┐
│  SSE Streaming  │  /stream/:sessionId
│  back to UI     │
└─────────────────┘
```

---

## 🔧 Integration Points

### 1. NextJS /api/chat → Agent Gateway

**File:** `app/api/chat/route.ts` (or similar)

```typescript
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.V2_GATEWAY_URL || 'http://gateway:3002';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { messages, userId, conversationId } = body;

  // Extract prompt from last user message
  const lastUserMessage = messages
    .filter(m => m.role === 'user')
    .pop();
  
  const prompt = typeof lastUserMessage?.content === 'string' 
    ? lastUserMessage.content 
    : '';

  // Create job via Agent Gateway
  const gatewayResponse = await fetch(`${GATEWAY_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      conversationId,
      prompt,
      context: { messages },
      executionPolicy: 'sandbox-required',
      priority: 'normal',
    }),
  });

  if (!gatewayResponse.ok) {
    return NextResponse.json(
      { error: 'Failed to create agent job' },
      { status: 500 }
    );
  }

  const { jobId, sessionId, status } = await gatewayResponse.json();

  // Return job info to client
  return NextResponse.json({
    success: true,
    jobId,
    sessionId,
    status,
    streamUrl: `/api/stream/${sessionId}`,
  });
}
```

---

### 2. SSE Streaming to Client

**File:** `app/api/stream/[sessionId]/route.ts`

```typescript
import { NextRequest } from 'next/server';

const GATEWAY_URL = process.env.V2_GATEWAY_URL || 'http://gateway:3002';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { sessionId } = params;

  // Create readable stream for SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Connect to gateway SSE stream
        const gatewayResponse = await fetch(`${GATEWAY_URL}/stream/${sessionId}`, {
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });

        if (!gatewayResponse.ok || !gatewayResponse.body) {
          controller.error(new Error('Gateway stream failed'));
          return;
        }

        // Pipe gateway stream to client
        const reader = gatewayResponse.body.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            controller.close();
            break;
          }

          // Forward SSE data to client
          controller.enqueue(value);
        }

      } catch (error: any) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

---

### 3. Client-Side SSE Consumption

**File:** `components/chat-interface.tsx` (or similar)

```typescript
import { useEffect, useRef } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function useAgentStream(
  sessionId: string,
  onMessage: (message: ChatMessage) => void,
  onError: (error: string) => void
) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Connect to SSE stream
    const eventSource = new EventSource(`/api/stream/${sessionId}`);
    eventSourceRef.current = eventSource;

    // Handle different event types
    eventSource.addEventListener('token', (event) => {
      const data = JSON.parse(event.data);
      onMessage({
        role: 'assistant',
        content: data.content,
      });
    });

    eventSource.addEventListener('tool:start', (event) => {
      const data = JSON.parse(event.data);
      console.log('Tool started:', data.tool);
    });

    eventSource.addEventListener('tool:result', (event) => {
      const data = JSON.parse(event.data);
      console.log('Tool completed:', data);
    });

    eventSource.addEventListener('job:completed', (event) => {
      console.log('Job completed');
      eventSource.close();
    });

    eventSource.addEventListener('job:failed', (event) => {
      const data = JSON.parse(event.data);
      onError(data.error || 'Job failed');
      eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
      // EventSource error events don't carry a data payload
      // Use a generic error message instead of parsing event.data
      onError('Stream connection error');
      eventSource.close();
    });

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [sessionId, onMessage, onError]);

  return eventSourceRef.current;
}
```

---

## 📝 Job Flow Example

### Step 1: User Sends Message

```typescript
// In chat component
const handleSubmit = async (message: string) => {
  // Add user message to UI
  addMessage({ role: 'user', content: message });

  // Send to API
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        ...conversationHistory,
        { role: 'user', content: message },
      ],
      userId: currentUser.id,
      conversationId: currentConversation.id,
    }),
  });

  const { jobId, sessionId, streamUrl } = await response.json();

  // Start streaming
  startAgentStream(sessionId);
};
```

### Step 2: Gateway Creates Job

```
POST http://gateway:3002/jobs
Body: {
  "userId": "user_123",
  "conversationId": "conv_456",
  "prompt": "Create a React component",
  "executionPolicy": "sandbox-required",
  "priority": "normal"
}

Response: {
  "jobId": "job_abc123",
  "sessionId": "session_conv_456_1234567890",
  "status": "pending"
}
```

### Step 3: Worker Processes Job

```
Worker polls Redis queue:
BRPOP agent:jobs 5

Worker receives job and:
1. Updates job status to "processing"
2. Publishes "job:started" event
3. Runs OpenCode engine loop
4. Publishes "token" events for streaming
5. Publishes "tool:start" / "tool:result" events
6. Updates job status to "completed"
```

### Step 4: Events Stream to Client

```
Gateway → Redis PubSub → SSE Stream → Client

Events:
- connected: { sessionId, timestamp }
- job:started: { jobId, workerId }
- token: { content: "Hello" }
- tool:start: { tool: "write_file", args: {...} }
- tool:result: { success: true }
- job:completed: { duration: 5000 }
```

---

## 🔍 Monitoring & Administration

### Check Job Status

```bash
# Get job details
curl http://gateway:3002/jobs/job_abc123

# List all jobs
curl http://gateway:3002/jobs

# Get session info
curl http://gateway:3002/sessions/session_conv_456_1234567890
```

### Terminate Runaway Job

```bash
# Cancel job
curl -X DELETE http://gateway:3002/jobs/job_abc123

# Force terminate (admin)
curl -X POST http://gateway:3002/admin/jobs/job_abc123/terminate \
  -H "Content-Type: application/json" \
  -d '{"reason": "runaway_detection"}'
```

### Migrate Sandbox

```bash
# Initiate sandbox migration
curl -X POST http://gateway:3002/sandboxes/migrate \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session_123",
    "fromSandbox": "sandbox_old_123",
    "toSandbox": "sandbox_new_456"
  }'

# Check migration status
curl http://gateway:3002/sandboxes/migrate/session_123
```

### Worker Management

```bash
# Register worker
curl -X POST http://gateway:3002/workers/register \
  -H "Content-Type: application/json" \
  -d '{
    "workerId": "worker_1",
    "metadata": {
      "concurrency": 4,
      "model": "opencode/minimax-m2.5-free"
    }
  }'

# Worker heartbeat
curl -X POST http://gateway:3002/workers/worker_1/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "stats": {
      "currentJobs": 2,
      "memoryUsage": 512,
      "cpuUsage": 45
    }
  }'

# List active workers
curl http://gateway:3002/workers
```

---

## 🚨 Error Handling

### Gateway Unavailable

```typescript
// Fallback to local execution if gateway is down
try {
  const response = await fetch(`${GATEWAY_URL}/jobs`, {...});
  if (!response.ok) throw new Error('Gateway unavailable');
  
  // Use gateway flow
} catch (error) {
  // Fallback to local agent execution
  console.warn('Gateway unavailable, using local execution');
  await executeLocalAgent(prompt);
}
```

### Stream Reconnection

```typescript
// Auto-reconnect on stream failure
useEffect(() => {
  let reconnectAttempts = 0;
  const maxReconnects = 3;

  const connect = () => {
    const eventSource = new EventSource(`/api/stream/${sessionId}`);
    
    eventSource.onerror = () => {
      eventSource.close();
      reconnectAttempts++;
      
      if (reconnectAttempts < maxReconnects) {
        setTimeout(connect, 2000 * reconnectAttempts); // Exponential backoff
      } else {
        onError('Stream connection failed');
      }
    };

    // ... event handlers
  };

  connect();
}, [sessionId]);
```

---

## 📊 Environment Variables

```bash
# Gateway configuration
V2_GATEWAY_URL=http://gateway:3002
REDIS_URL=redis://redis:6379

# Job configuration
JOB_TIMEOUT_MS=300000        # 5 minutes
SESSION_TIMEOUT_MS=3600000   # 1 hour
MAX_CONCURRENT_JOBS=10

# Worker configuration
WORKER_CONCURRENCY=4
OPENCODE_MODEL=opencode/minimax-m2.5-free
OPENCODE_MAX_STEPS=15
```

---

## 🎯 Key Features

### ✅ Implemented

1. **Job Queue Management** - Priority-based job queuing via Redis
2. **SSE Streaming** - Real-time event streaming to NextJS clients
3. **Runaway Detection** - Automatic termination of jobs with no heartbeat
4. **Sandbox Migration** - Migrate execution between sandboxes
5. **Worker Coordination** - Worker registration and heartbeat
6. **Session Management** - Track user sessions with TTL
7. **Health Monitoring** - Gateway and Redis health checks

### 🔄 Integration Status

| Component | Status | Location |
|-----------|--------|----------|
| NextJS /api/chat | ⏳ Needs wiring | `app/api/chat/route.ts` |
| SSE Streaming | ⏳ Needs wiring | `app/api/stream/[sessionId]/route.ts` |
| Agent Gateway | ✅ Complete | `lib/agent/services/agent-gateway/` |
| Redis Service | ✅ Complete | `lib/redis/agent-service.ts` |
| Workers | ✅ Complete | `lib/agent/services/agent-worker/` |

---

*Created: March 2026*
*For V2 Agent Architecture*
