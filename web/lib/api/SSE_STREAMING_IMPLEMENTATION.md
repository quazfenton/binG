# SSE Streaming Events Implementation

## Overview

This implementation streams **all AI state events** in real-time to the UI, including:
- ✅ **Reasoning/Thinking** - AI chain-of-thought traces
- ✅ **Tool Invocations** - Full lifecycle with state (call → result)
- ✅ **Processing Steps** - Step-by-step execution progress
- ✅ **Filesystem Changes** - Real-time file mutation notifications
- ✅ **Git Diffs** - Git-style diffs for client sync
- ✅ **Sandbox Output** - stdout/stderr from command execution
- ✅ **Reflection Results** - Quality metrics and self-evaluation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Response                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         lib/api/streaming-events.ts                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  createStreamingEvents()                              │  │
│  │  - Extract reasoning                                  │  │
│  │  - Extract tool invocations                           │  │
│  │  - Extract filesystem changes                         │  │
│  │  - Extract diffs                                      │  │
│  │  - Chunk content for streaming                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SSE Events (text/event-stream)                 │
│  event: reasoning                                           │
│  event: tool_invocation                                     │
│  event: step                                                │
│  event: filesystem                                          │
│  event: diffs                                               │
│  event: sandbox_output                                      │
│  event: token                                               │
│  event: done                                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Frontend UI                              │
│  - useEnhancedChat hook                                     │
│  - AgentTerminal component                                  │
│  - Real-time event display                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Event Types

### 1. Reasoning/Thinking Events

```typescript
event: reasoning
data: {
  requestId: "req_123",
  reasoning: "I need to first read the file to understand its structure...",
  timestamp: 1234567890
}
```

**Source:** `response.data.reasoning` or `response.metadata.reasoning`

**UI Display:** Show in a collapsible "Thinking" panel

---

### 2. Tool Invocation Events

```typescript
event: tool_invocation
data: {
  toolCallId: "call_abc",
  toolName: "read_file",
  state: "call" | "result" | "partial-call",
  args: { path: "src/index.ts" },
  result: { success: true, content: "..." },
  latencyMs: 150,
  timestamp: 1234567890
}
```

**Source:** `response.data.toolInvocations`

**UI Display:** Show tool calls with loading state, then results

---

### 3. Processing Step Events

```typescript
event: step
data: {
  step: "Reading file",
  status: "started" | "completed" | "failed",
  stepIndex: 0,
  toolName: "read_file",
  toolCallId: "call_abc",
  timestamp: 1234567890
}
```

**Source:** `response.data.processingSteps`

**UI Display:** Progress bar or step list

---

### 4. Filesystem Change Events

```typescript
event: filesystem
data: {
  scopePath: "project",
  applied: [{ path: "src/index.ts", operation: "write" }],
  errors: [],
  requestedFiles: []
}
```

**Source:** `response.data.files` or filesystem edit results

**UI Display:** File tree updates, change notifications

---

### 5. Git Diff Events

```typescript
event: diffs
data: {
  requestId: "req_123",
  files: [{
    path: "src/index.ts",
    diff: "@@ -1,5 +1,6 @@\n-old code\n+new code",
    changeType: "update"
  }],
  count: 1
}
```

**Source:** `response.commands.write_diffs`

**UI Display:** Diff viewer, inline change highlighting

---

### 6. Sandbox Output Events

```typescript
event: sandbox_output
data: {
  stream: "stdout" | "stderr",
  chunk: "Command output...",
  toolCallId: "call_abc",
  timestamp: 1234567890
}
```

**Source:** Extracted from tool invocation results

**UI Display:** Terminal output, console logs

---

### 7. Token Events (Text Streaming)

```typescript
event: token
data: {
  content: "Hello",
  timestamp: 1234567890,
  offset: 0
}
```

**Source:** `response.content` (chunked)

**UI Display:** Streaming text response

---

### 8. Step Metric Events

```typescript
event: step_metric
data: {
  toolCallId: "call_abc",
  toolName: "read_file",
  state: "result",
  latencyMs: 150,
  timestamp: 1234567890
}
```

**Source:** Tool invocation lifecycle tracking

**UI Display:** Performance metrics, timing info

---

## Implementation

### Backend: `lib/api/streaming-events.ts`

```typescript
import { createStreamingEvents } from '@/lib/api/streaming-events'

// In response-router.ts
createStreamingEvents(response: UnifiedResponse, requestId: string): string[] {
  return createStreamingEvents(response, requestId, {
    includeReasoning: true,
    includeToolState: true,
    includeFilesystem: true,
    includeDiffs: true,
  })
}
```

### Frontend: Event Handler

```typescript
// In useEnhancedChat or similar hook
const eventSource = new EventSource('/api/chat')

eventSource.addEventListener('reasoning', (event) => {
  const data = JSON.parse(event.data)
  setReasoning(prev => [...prev, data.reasoning])
})

eventSource.addEventListener('tool_invocation', (event) => {
  const data = JSON.parse(event.data)
  setToolInvocations(prev => [...prev, data])
})

eventSource.addEventListener('step', (event) => {
  const data = JSON.parse(event.data)
  setSteps(prev => [...prev, data])
})

eventSource.addEventListener('token', (event) => {
  const data = JSON.parse(event.data)
  setContent(prev => prev + data.content)
})
```

---

## Integration Points

### 1. Chat Route (`app/api/chat/route.ts`)

Already integrated at lines 775-820:

```typescript
// Stream from agent
for await (const chunk of agentLoop.executeTaskStreaming(task)) {
  if (chunk.type === 'tool-invocation') {
    const toolEvent = `event: tool_invocation\ndata: ${JSON.stringify({
      requestId: streamRequestId,
      toolCallId: chunk.toolInvocation.toolCallId,
      toolName: chunk.toolInvocation.toolName,
      state: chunk.toolInvocation.state,
      args: chunk.toolInvocation.args,
      result: chunk.toolInvocation.result,
      timestamp: Date.now(),
    })}\n\n`
    controller.enqueue(encoderRef.encode(toolEvent))
  } else if (chunk.type === 'reasoning') {
    const reasoningEvent = `event: reasoning\ndata: ${JSON.stringify({
      requestId: streamRequestId,
      reasoning: chunk.reasoning,
      timestamp: Date.now(),
    })}\n\n`
    controller.enqueue(encoderRef.encode(reasoningEvent))
  }
}
```

### 2. Response Router (`lib/api/response-router.ts`)

Uses `streaming-events.ts` module:

```typescript
createStreamingEvents(response: UnifiedResponse, requestId: string): string[] {
  const { createStreamingEvents } = require('./streaming-events')
  return createStreamingEvents(response, requestId, {
    includeReasoning: true,
    includeToolState: true,
    includeFilesystem: true,
    includeDiffs: true,
  })
}
```

### 3. SSE Event Schema (`lib/streaming/sse-event-schema.ts`)

Canonical event type definitions:

```typescript
export const SSE_EVENT_TYPES = {
  TOKEN: 'token',
  TOOL_INVOCATION: 'tool_invocation',
  STEP: 'step',
  REASONING: 'reasoning',
  FILESYSTEM: 'filesystem',
  DIFFS: 'diffs',
  DONE: 'done',
  ERROR: 'error',
} as const
```

---

## UI Components

### AgentTerminal Component

Already has basic event handling in `components/agent/AgentTerminal.tsx`:

```typescript
const {
  connected,
  output,
  send,
} = useAgent({
  onConnect: (session) => console.log('Connected:', session),
})
```

**Enhancement:** Add specific handlers for each event type:

```typescript
eventSource.addEventListener('reasoning', (event) => {
  const data = JSON.parse(event.data)
  // Show in thinking panel
})

eventSource.addEventListener('tool_invocation', (event) => {
  const data = JSON.parse(event.data)
  // Show tool call with loading state
})
```

---

## Testing

### Manual Testing

1. **Enable streaming:**
   ```bash
   # In .env
   LLM_AGENT_TOOLS_ENABLED=true
   ```

2. **Send request:**
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"messages": [{"role": "user", "content": "Read src/index.ts"}], "stream": true}'
   ```

3. **Observe events:**
   ```
   event: reasoning
   data: {"reasoning": "I need to read the file..."}
   
   event: tool_invocation
   data: {"toolName": "read_file", "state": "call"}
   
   event: tool_invocation
   data: {"toolName": "read_file", "state": "result"}
   
   event: token
   data: {"content": "File content..."}
   
   event: done
   ```

---

## Benefits

1. **Real-time Visibility** - Users see AI thinking process
2. **Tool Transparency** - Full lifecycle of tool calls
3. **Progress Tracking** - Step-by-step execution status
4. **File Change Awareness** - Immediate notification of mutations
5. **Debugging** - Easy to trace what happened and when
6. **Performance Metrics** - Latency tracking for each step

---

## Next Steps

1. **Update UI Components** - Add event handlers for all event types
2. **Add Thinking Panel** - Collapsible reasoning display
3. **Add Tool Call Display** - Show tool calls with loading states
4. **Add Progress Bar** - Step progress visualization
5. **Add Diff Viewer** - Git-style diff display
6. **Add Terminal Output** - Sandbox stdout/stderr display

---

## Files Created/Modified

| File | Purpose | Status |
|------|---------|--------|
| `lib/api/streaming-events.ts` | Enhanced event generation | ✅ Created |
| `lib/api/response-router.ts` | Use streaming-events module | ✅ Updated |
| `lib/streaming/sse-event-schema.ts` | Canonical event types | ✅ Already exists |
| `app/api/chat/route.ts` | Stream events to client | ✅ Already integrated |

---

## Summary

**All AI state events are now streamed in real-time:**
- ✅ Reasoning/thinking traces
- ✅ Tool invocations with state
- ✅ Processing steps
- ✅ Filesystem changes
- ✅ Git diffs
- ✅ Sandbox output
- ✅ Performance metrics

**Ready for UI integration!**
