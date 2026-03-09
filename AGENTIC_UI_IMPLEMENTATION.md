# Agentic UI Implementation Guide

## Overview

This implementation adds **streaming agent reasoning** and **enhanced tool invocation display** to create a true "Agentic UI" experience. Users can now watch the agent think, plan, and execute tools in real-time.

## Key Features

### 1. Reasoning/Thought Streaming
- **Inner Monologue**: Stream the agent's thoughts before the main response
- **Type-Specific Display**: Different colors for thoughts, reasoning, plans, and reflections
- **Expandable/Collapsible**: Compact summary expands to full reasoning trace
- **No Yellow Box**: Subtle streaming indicators instead of distracting highlights

### 2. Enhanced Tool Invocations
- **Clean State Display**: 
  - `partial-call`: Minimal "Preparing..." indicator (no yellow box)
  - `call`: Blue pulsing "Executing..." state
  - `result`: Clear success (green) or error (red) states
- **Expandable Details**: Show/hide code and results
- **Real-time Code Streaming**: Watch code appear token-by-token

## Files Created/Modified

### New Files

#### `hooks/use-reasoning-stream.ts`
Hook for capturing and displaying agent reasoning chunks.

```typescript
const reasoningStream = useReasoningStream({
  sandboxId: 'sandbox_123',
  messageId: 'msg_456',
  autoExpand: true,
});

// Access: reasoningStream.reasoningChunks, reasoningStream.fullReasoning
```

#### `components/reasoning-display.tsx`
Components for rendering reasoning with type-specific styling:
- `ReasoningDisplay`: Full expanded view with chunk-by-chunk display
- `ReasoningSummary`: Collapsed preview with expand option

#### `components/tool-invocation-card.tsx`
Enhanced tool invocation display:
- `ToolInvocationCard`: Single tool card with expandable details
- `ToolInvocationsList`: Batch rendering of multiple tools

### Modified Files

#### `types/index.ts`
Added `reasoningChunks` and `sandboxId` to Message metadata:

```typescript
metadata?: {
  reasoningChunks?: Array<{
    id: string;
    content: string;
    timestamp: number;
    isComplete: boolean;
    type: 'thought' | 'reasoning' | 'plan' | 'reflection';
  }>;
  toolInvocations?: Array<{...}>;
  sandboxId?: string;
}
```

#### `components/message-bubble.tsx`
Integrated reasoning display and enhanced tool invocations:
- Uses `useReasoningStream` hook
- Renders `ReasoningDisplay` before main content
- Uses `ToolInvocationsList` for cleaner tool display

#### `lib/sandbox/agent-loop.ts`
Added `onReasoningChunk` callback and event emission:
```typescript
onReasoningChunk(chunk, type) {
  sandboxEvents.emit(sandboxId, 'agent:reasoning_chunk', { text: chunk, type })
}
```

#### `lib/sandbox/sandbox-events-enhanced.ts`
Added new event types:
- `agent:reasoning_start`
- `agent:reasoning_chunk`
- `agent:reasoning_complete`

## Usage Example

### Backend (API Route)

```typescript
// app/api/chat/route.ts
import { streamText, tool } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    maxSteps: 5,
    tools: {
      execute_python: tool({
        description: 'Run Python code',
        parameters: z.object({ code: z.string() }),
        execute: async ({ code }) => {
          // Your sandbox execution logic
          return { output: 'Success!' };
        },
      }),
    },
    // Capture reasoning if using o1/o3 models
    onReasoning: (reasoning) => {
      // Stream reasoning chunks to frontend
    },
  });

  return result.toDataStreamResponse();
}
```

### Frontend (Chat Page)

```typescript
// app/page.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import MessageBubble from '@/components/message-bubble';

export default function Chat() {
  const { messages, isLoading } = useChat({
    api: '/api/chat',
    maxSteps: 5,
  });

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={{
            id: message.id,
            role: message.role,
            content: message.content,
            metadata: {
              sandboxId: `sandbox_${userId}_${message.id}`,
              toolInvocations: message.toolInvocations,
              reasoningChunks: message.reasoningChunks,
            },
          }}
          isStreaming={isLoading && message.id === messages[messages.length - 1].id}
        />
      ))}
    </div>
  );
}
```

## UX Flow

1. **User asks**: "Write a script to calculate primes"

2. **Agent starts thinking**:
   - Blue reasoning box appears (collapsed or expanded based on `autoExpand`)
   - Chunks stream in real-time: "Thought", "Plan", "Reasoning"
   - Subtle pulse animation indicates active thinking

3. **Agent prepares tool**:
   - Minimal "Preparing..." indicator (transparent, no yellow box)
   - Code starts streaming token-by-token

4. **Agent executes tool**:
   - Blue pulsing "Executing..." box
   - Terminal icon indicates active execution

5. **Tool completes**:
   - Green "Execution Success" or Red "Execution Failed" box
   - Expandable code and result display
   - If failed and `maxSteps > 1`, agent automatically retries

6. **Agent responds**:
   - Main content appears after reasoning and tool execution
   - Full conversation flow is visible and traceable

## Configuration

### Reasoning Display
```typescript
useReasoningStream({
  sandboxId: string;      // Sandbox identifier for event listening
  messageId: string;      // Message identifier for chunk IDs
  autoExpand: boolean;    // Auto-expand reasoning (default: false)
  maxDisplayedChunks: number; // Max chunks to keep in memory (default: 50)
})
```

### Tool Invocation Display
```typescript
<ToolInvocationsList
  toolInvocations={toolInvocations}
  compact={boolean}  // Start collapsed (default: false)
/>
```

## Styling

### Reasoning Colors by Type
- **Thought**: Blue (`bg-blue-50`)
- **Reasoning**: Purple (`bg-purple-50`)
- **Plan**: Emerald (`bg-emerald-50`)
- **Reflection**: Amber (`bg-amber-50`)

### Tool States
- **Preparing**: Transparent, minimal border
- **Executing**: Blue with pulse animation
- **Success**: Emerald green
- **Failed**: Red with error details

## Migration Notes

### From Previous Implementation
- Old yellow box for `partial-call` removed
- Tool invocations now use dedicated component
- Reasoning separated from main content
- Event system now supports reasoning chunks

### Backward Compatibility
- Existing tool invocations still work
- Old message format gracefully degrades
- Reasoning display only shows if chunks available

## Performance Considerations

1. **Chunk Limit**: `maxDisplayedChunks` prevents memory issues (default: 50)
2. **Event Cleanup**: Hook automatically cleans up event listeners
3. **Lazy Expansion**: Collapsed state reduces initial render cost
4. **Event Throttling**: Consider throttling `reasoning_chunk` events for very chatty agents

## Future Enhancements

1. **Human-in-the-Loop**: Add approval prompts before tool execution
2. **Generative UI**: Render charts/tables from tool results
3. **Time Travel**: Replay agent reasoning and tool execution history
4. **Parallel Tools**: Display concurrent tool executions
5. **Cost Display**: Show token usage per reasoning/tool step
