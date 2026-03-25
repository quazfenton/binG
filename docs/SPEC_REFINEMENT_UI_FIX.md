# Spec Refinement UI Fix - Backend Complete

## Problem

When spec amplification runs in the background, the refinement responses are **not showing up in the UI** as message bubbles. The logs show:
- DAG execution completes successfully
- Tasks complete with refined content
- SSE events are emitted
- BUT the UI never displays these as new assistant messages

## Root Cause

The backend was emitting SSE events for **progress tracking** (`SPEC_AMPLIFICATION` with stage info) but **not emitting the actual refinement content as new assistant messages**.

## Backend Fix (COMPLETED ✅)

### 1. Updated DAG Executor (`lib/chat/dag-refinement-engine.ts`)

Added emission of task completion events with content:

```typescript
// In executeTask() method, after task completes:
if (emit) {
  emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
    stage: 'task_complete',
    taskId: task.id,
    taskTitle: task.title,
    content: refinedContent,  // ← The refined content to display
    timestamp: Date.now()
  })
}
```

### 2. Updated SSE Event Schema (`lib/streaming/sse-event-schema.ts`)

Added new stage and fields to `SSESpecAmplificationPayload`:

```typescript
export interface SSESpecAmplificationPayload {
  stage: 'started' | 'spec_generated' | 'refining' | 
         'task_complete' | 'complete' | 'error' | 'complete_with_timeouts';
  
  // New fields for task_complete stage
  taskId?: string;
  taskTitle?: string;
  content?: string;  // ← Refined content to display as assistant message
  
  // ... other fields
}
```

### 3. Event Flow

```
DAG Task Completes
    ↓
emit('spec_amplification', { 
  stage: 'task_complete',
  content: 'refined content here'
})
    ↓
SSE Stream → Client
    ↓
Frontend receives event (needs frontend fix to display)
```

## Frontend Fix (REQUIRED)

The frontend's `useEnhancedChat` hook needs to process `spec_amplification` events with `stage: 'task_complete'` and create new assistant message bubbles.

### Implementation in `hooks/use-enhanced-chat.ts` or similar:

```typescript
// In the SSE event handler
case 'spec_amplification':
  if (event.stage === 'task_complete') {
    // Create a new assistant message from the refinement content
    const newMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: event.content || '',
      metadata: {
        isRefinement: true,
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        refinementSection: true,
      },
    };
    
    // Add to messages array
    setMessages(prev => [...prev, newMessage]);
    
    // Hide loading indicator if showing
    setIsRefinementLoading(false);
  } 
  else if (event.stage === 'refining') {
    // Show loading state with rotating statements
    setIsRefinementLoading(true);
    setRefinementProgress({
      current: event.currentIteration,
      total: event.totalIterations,
      currentSection: event.currentSection,
    });
  }
  else if (event.stage === 'complete') {
    // Refinement complete
    setIsRefinementLoading(false);
  }
  break;
```

### Loading State Component

Create a loading component that shows while refinement runs:

```tsx
// components/spec-refinement-loading.tsx
import { useRotatingStatements } from '@/hooks/use-rotating-statements';

export function SpecRefinementLoading({ progress }: { progress: any }) {
  const rotatingStatement = useRotatingStatements([
    'Refining project structure...',
    'Improving implementation details...',
    'Adding best practices...',
    'Enhancing code quality...',
    'Validating architecture...',
  ]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="animate-spin" />
      <div>
        <p>{rotatingStatement}</p>
        {progress && (
          <p className="text-xs">
            Section {progress.current} of {progress.total}
            {progress.currentSection && `: ${progress.currentSection}`}
          </p>
        )}
      </div>
    </div>
  );
}
```

### Message Bubble Rendering

Update `message-bubble.tsx` to handle refinement messages:

```tsx
// In message-bubble component
if (message.metadata?.isRefinement) {
  return (
    <div className="message-bubble refinement">
      <div className="refinement-header">
        <SparklesIcon className="w-4 h-4" />
        <span>Refinement: {message.metadata.taskTitle}</span>
      </div>
      <Markdown content={message.content} />
    </div>
  );
}
```

## Testing

### Backend Testing

```bash
# Run chat with spec amplification enabled
# Check logs for:
# - [Refinement:DAG] Task complete
# - emit('spec_amplification', { stage: 'task_complete', content: ... })

# Verify SSE stream contains:
event: spec_amplification
data: {"stage":"task_complete","content":"...","taskId":"refine-0"}
```

### Frontend Testing

1. Enable spec amplification (mode: 'enhanced' or 'max')
2. Send a chat message that triggers spec generation
3. Verify:
   - Loading state appears with rotating statements
   - Each completed task creates a new assistant message bubble
   - Messages show refinement content with proper formatting
   - Progress indicator shows current section

## Files Modified

### Backend (Complete)
- ✅ `lib/chat/dag-refinement-engine.ts` - Emit task_complete events
- ✅ `lib/streaming/sse-event-schema.ts` - Add task_complete stage
- ✅ `lib/api/response-router.ts` - Already passes emit correctly

### Frontend (Required)
- ⏳ `hooks/use-enhanced-chat.ts` - Process spec_amplification events
- ⏳ `components/spec-refinement-loading.tsx` - NEW loading component
- ⏳ `components/message-bubble.tsx` - Render refinement messages
- ⏳ `hooks/use-rotating-statements.ts` - Already exists, reuse for loading text

## Event Sequence

```
User sends message
    ↓
Backend processes request
    ↓
Spec amplification enabled (mode: max)
    ↓
Fast model generates spec
    ↓
DAG execution starts
    ↓
Emit: spec_amplification { stage: 'refining' }
    ↓
[FRONTEND: Show loading with rotating statements]
    ↓
Task refine-0 completes
    ↓
Emit: spec_amplification { stage: 'task_complete', content: '...' }
    ↓
[FRONTEND: Create assistant message bubble #1]
    ↓
Task refine-1 completes
    ↓
Emit: spec_amplification { stage: 'task_complete', content: '...' }
    ↓
[FRONTEND: Create assistant message bubble #2]
    ↓
... (repeat for all tasks)
    ↓
Emit: spec_amplification { stage: 'complete' }
    ↓
[FRONTEND: Hide loading state]
```

## Configuration

Ensure spec amplification is enabled:

```env
# In .env.local
SPEC_AMPLIFICATION_ENABLED=true
SPEC_AMPLIFICATION_MODE=max  # or 'enhanced'
```

In chat request:
```typescript
await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [...],
    mode: 'max',  // Enables spec amplification
  }),
});
```

## Summary

**Backend**: ✅ Complete - Now emits `task_complete` events with refined content

**Frontend**: ⏳ Required - Process events and create message bubbles

The backend now correctly emits SSE events for each completed refinement task. The frontend needs to:
1. Listen for `spec_amplification` events with `stage: 'task_complete'`
2. Create new assistant messages from the `content` field
3. Show loading state with rotating statements during refinement
4. Display refinement messages with appropriate styling
