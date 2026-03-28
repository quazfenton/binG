# Phase 4: Durable Event-Sourced Task System

**Implementation Plan** - Building upon existing binG infrastructure  
**Date:** March 10, 2026  
**Status:** Ready for Implementation

---

## Executive Summary

This plan integrates **durable execution** and **event sourcing** into binG's existing agent orchestration system. Rather than a rewrite, we add a **thin event layer** that upgrades:

- ✅ Task persistence (append-only event log)
- ✅ Retry/replay capability (checkpointed execution)
- ✅ Dynamic scheduling (DB-backed cron)
- ✅ Human-in-the-loop (approval events)
- ✅ Self-healing (LLM-based error recovery)

**Key Insight:** Your existing infrastructure already has 80% of what's needed:
- SSE event schema (`lib/streaming/sse-event-schema.ts`)
- Task router (`lib/agent/task-router.ts`)
- DAG execution (`lib/chat/dag-refinement-engine.ts`)
- Background jobs (`lib/agent/background-jobs.ts`)
- Execution graph (`lib/agent/execution-graph.ts`)
- Session manager (`lib/session/session-manager.ts`)
- SQLite database (`lib/database/connection.ts`)

---

## Part 1: Codebase Analysis

### 1.1 Existing Infrastructure (What We Have)

#### Event System ✅
```
lib/streaming/sse-event-schema.ts (299 lines)
├── SSE_EVENT_TYPES constant (22 event types)
├── Typed payloads (SSETokenPayload, SSEToolInvocationPayload, etc.)
├── sseEncode() helper
└── createSSEEmitter() factory

lib/mcp/types.ts
├── MCPEventType (8 types)
├── MCPEvent interface
└── MCPEventListener type

lib/mcp/client.ts
├── EventEmitter pattern
├── onEvent/offEvent methods
└── emitEvent() private method
```

#### Task Orchestration ✅
```
lib/agent/task-router.ts (361 lines)
├── TaskRouter class
├── Keyword-based routing (coding/messaging/browsing/automation)
├── Execution policies (local-safe/sandbox-required/sandbox-heavy)
└── OpenCode/Nullclaw/CLI dispatch

lib/agent/execution-graph.ts (481 lines)
├── ExecutionGraph interface
├── ExecutionNode (agent_step/tool_call/sandbox_action/preview_task/git_operation)
├── NodeStatus (pending/running/completed/failed/blocked/cancelled)
├── Dependency tracking (DAG)
└── Retry logic (maxRetries: 3)

lib/chat/dag-refinement-engine.ts (441 lines)
├── DAGExecutor class
├── Parallel task execution
├── Checkpoint boundaries (io.run() equivalent)
└── Progress streaming via SSE
```

#### Persistence ✅
```
lib/session/session-manager.ts (996 lines)
├── Session interface with backgroundJobs Map
├── executionGraphId tracking
├── SQLite persistence
└── Quota tracking

lib/database/connection.ts (840 lines)
├── better-sqlite3 connection
├── Prepared statements cache
├── Encryption for sensitive data
└── Migration system
```

#### Background Execution ✅
```
lib/agent/background-jobs.ts (374 lines)
├── BackgroundExecutor class (EventEmitter)
├── Interval-based job execution
├── Job status tracking (running/paused/stopped)
└── Execution result logging

lib/agent/enhanced-background-jobs.ts
├── EnhancedJobConfig with interval/timeout
├── Job execution counting
└── Error tracking
```

#### Workflow Integration ✅
```
lib/agent/mastra-workflow-integration.ts (606 lines)
├── MastraWorkflowIntegration class
├── Task proposal/review system
├── Workflow queue with concurrency limit
└── Real-time progress tracking
```

### 1.2 What's Missing (What We Add)

| Feature | Current State | Phase 4 Addition |
|---------|--------------|------------------|
| **Event Store** | SSE events (ephemeral) | SQLite append-only log |
| **Event Schemas** | SSE payload types | Zod-validated event schemas |
| **Durable Execution** | In-memory retry | Checkpointed resume |
| **Dynamic Scheduler** | Fixed interval jobs | DB-backed cron poller |
| **Event Router** | Switch in task-router | Dedicated event router |
| **Human-in-the-Loop** | Not implemented | waitForEvent() API |
| **Self-Healing** | Basic retry | LLM-based error recovery |

---

## Part 2: Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         LLM / Agent                              │
│  (Unified Agent Service / Task Router / OpenCode V2)            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  emitEvent()  │  ← NEW: Event Bus (lib/events/bus.ts)
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────────┐
              │  Event Store      │  ← NEW: SQLite append-only log
              │  (lib/events/     │     (lib/events/store.ts)
              │   store.ts)       │
              └───────┬───────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │   Dynamic Scheduler         │  ← NEW: Cron poller
        │   (lib/events/scheduler.ts) │     (lib/events/scheduler.ts)
        └─────────────┬───────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │   Event Router              │  ← NEW: Switch-based dispatch
        │   (lib/events/router.ts)    │
        └─────────────┬───────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Handler  │ │ Handler  │ │ Handler  │
   │ HN Daily │ │ Research │ │  Email   │
   └──────────┘ └──────────┘ └──────────┘
         │            │            │
         └────────────┴────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │   Existing Infrastructure   │
        │   - DAG Executor            │
        │   - Execution Graph         │
        │   - Background Jobs         │
        │   - Mastra Workflows        │
        └─────────────────────────────┘
```

### 2.2 Event Flow

```
1. LLM Intent
   User: "Summarize Hacker News daily at 9 AM"
   ↓
2. Tool Execution
   schedule_task tool → emitEvent()
   ↓
3. Event Persistence
   INSERT INTO events (type, payload, status)
   ↓
4. Scheduler Polling
   Every 5 min: SELECT * FROM events WHERE status = 'pending'
   ↓
5. Event Routing
   switch (event.type) { case 'HACKER_NEWS_DAILY': ... }
   ↓
6. Handler Execution
   - Fetch HN top stories
   - Summarize with LLM
   - Send via email/SMS
   ↓
7. Status Update
   UPDATE events SET status = 'completed'
```

---

## Part 3: Implementation Phases

### Phase 4.1: Event Store + Bus (Week 1)

**Goal:** Add durable event logging without breaking existing code.

#### Files to Create

**1. `/root/bing/lib/events/schema.ts`** (200 lines)
```typescript
// Zod-validated event schemas
import { z } from 'zod';

export const EventSchemas = {
  HACKER_NEWS_DAILY: z.object({
    type: z.literal('HACKER_NEWS_DAILY'),
    userId: z.string(),
    destination: z.string().email(),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  
  RESEARCH_TASK: z.object({
    type: z.literal('RESEARCH_TASK'),
    query: z.string(),
    depth: z.number().min(1).max(10),
    userId: z.string(),
  }),
  
  SEND_EMAIL: z.object({
    type: z.literal('SEND_EMAIL'),
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    userId: z.string(),
  }),
  
  // ... more event types
};

export const AnyEvent = z.discriminatedUnion('type', [
  EventSchemas.HACKER_NEWS_DAILY,
  EventSchemas.RESEARCH_TASK,
  EventSchemas.SEND_EMAIL,
  // ...
]);

export type AnyEvent = z.infer<typeof AnyEvent>;
```

**2. `/root/bing/lib/events/store.ts`** (250 lines)
```typescript
// SQLite event persistence
import { getDatabase } from '@/lib/database/connection';

export interface EventRecord {
  id: string;
  type: string;
  payload: any;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  retryCount: number;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  userId: string;
  metadata?: Record<string, any>;
}

export async function createEvent(event: AnyEvent, userId: string): Promise<EventRecord> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  
  const stmt = db.prepare(`
    INSERT INTO events 
    (id, type, payload, status, retry_count, user_id, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP)
  `);
  
  stmt.run(id, event.type, JSON.stringify(event), userId);
  
  return {
    id,
    type: event.type,
    payload: event,
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    userId,
  };
}

export async function getPendingEvents(limit: number = 10): Promise<EventRecord[]> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM events 
    WHERE status = 'pending' 
    ORDER BY created_at ASC 
    LIMIT ?
  `);
  
  return stmt.all(limit).map((row: any) => ({
    ...row,
    payload: JSON.parse(row.payload),
  }));
}

export async function markEventRunning(id: string): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    UPDATE events 
    SET status = 'running', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(id);
}

export async function markEventComplete(id: string, result?: any): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    UPDATE events 
    SET status = 'completed', 
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP,
        metadata = ?
    WHERE id = ?
  `).run(JSON.stringify({ result }), id);
}

export async function markEventFailed(id: string, error: string): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    UPDATE events 
    SET status = 'failed',
        error = ?,
        retry_count = retry_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(error, id);
}

export async function getEventById(id: string): Promise<EventRecord | null> {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
}

export async function replayFailedEvents(): Promise<number> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE events 
    SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'failed' AND retry_count < 3
  `);
  const result = stmt.run();
  return result.changes;
}
```

**3. `/root/bing/lib/events/bus.ts`** (100 lines)
```typescript
// Event emission layer (ONLY thing LLM tools call)
import { AnyEvent } from './schema';
import { createEvent } from './store';

export interface EmitEventResult {
  eventId: string;
  status: 'queued';
}

export async function emitEvent(input: unknown, userId: string): Promise<EmitEventResult> {
  // Validate event schema
  const parsed = AnyEvent.parse(input);
  
  // Persist to event store
  const event = await createEvent(parsed, userId);
  
  return {
    eventId: event.id,
    status: 'queued',
  };
}
```

**4. `/root/bing/app/api/events/route.ts`** (100 lines)
```typescript
// Optional: Manual event trigger endpoint
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { emitEvent } from '@/lib/events/bus';
import { AnyEvent } from '@/lib/events/schema';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await request.json();
    const { event } = body as { event: AnyEvent };
    
    if (!event) {
      return NextResponse.json({ error: 'Event required' }, { status: 400 });
    }
    
    const result = await emitEvent(event, session.user.sub);
    
    return NextResponse.json({
      success: true,
      eventId: result.eventId,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to emit event',
    }, { status: 500 });
  }
}
```

#### Database Migration

**`/root/bing/lib/database/migrations/001-events-table.sql`**
```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  user_id TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  completed_at DATETIME
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_created_at ON events(created_at);
```

#### Integration with Existing Code

**Update `lib/agent/task-router.ts`** (minimal change)
```typescript
// Add import
import { emitEvent } from '@/lib/events/bus';

// In executeTask method, add event emission
async executeTask(request: TaskRequest): Promise<any> {
  // Emit event for durability (NEW)
  if (request.executionPolicy === 'durable') {
    const event = await emitEvent({
      type: 'TASK_REQUEST',
      task: request.task,
      userId: request.userId,
      conversationId: request.conversationId,
    }, request.userId);
    
    return { eventId: event.eventId, status: 'queued' };
  }
  
  // Existing routing logic continues unchanged...
  const routing = this.analyzeTask(request.task);
  return this.dispatchToTarget(routing.target, request);
}
```

---

### Phase 4.2: Event Router + Handlers (Week 2)

**Goal:** Add switch-based event dispatch with durable execution.

#### Files to Create

**5. `/root/bing/lib/events/router.ts`** (200 lines)
```typescript
// Event router (switch-based dispatch)
import { EventRecord } from './store';
import { markEventComplete, markEventFailed } from './store';
import { handleHackerNewsDaily } from './handlers/hacker-news';
import { handleResearchTask } from './handlers/research';
import { handleSendEmail } from './handlers/email';

export async function routeEvent(event: EventRecord): Promise<void> {
  try {
    await markEventRunning(event.id);
    
    switch (event.type) {
      case 'HACKER_NEWS_DAILY':
        await handleHackerNewsDaily(event);
        break;
        
      case 'RESEARCH_TASK':
        await handleResearchTask(event);
        break;
        
      case 'SEND_EMAIL':
        await handleSendEmail(event);
        break;
        
      default:
        throw new Error(`Unhandled event type: ${event.type}`);
    }
    
    await markEventComplete(event.id);
  } catch (error: any) {
    await markEventFailed(event.id, error.message);
    throw error;
  }
}
```

**6-8. Handler Files** (`/root/bing/lib/events/handlers/*.ts`)
```typescript
// lib/events/handlers/hacker-news.ts
import { EventRecord } from '../store';

export async function handleHackerNewsDaily(event: EventRecord): Promise<void> {
  const { userId, destination } = event.payload;
  
  // 1. Fetch HN top stories
  const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = await response.json();
  const top5 = ids.slice(0, 5);
  
  // 2. Fetch story details
  const stories = await Promise.all(
    top5.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
  );
  
  // 3. Summarize with LLM
  const summary = await summarizeWithLLM(stories);
  
  // 4. Send via email/SMS
  await sendNotification(destination, summary);
}
```

**9. `/root/bing/lib/events/scheduler.ts`** (200 lines)
```typescript
// Dynamic scheduler (DB poller → event emitter)
import { getDatabase } from '@/lib/database/connection';
import { emitEvent } from './bus';

export async function runScheduler(): Promise<void> {
  const db = getDatabase();
  const now = new Date();
  
  // Query scheduled tasks
  const tasks = db.prepare(`
    SELECT * FROM scheduled_tasks 
    WHERE active = TRUE 
      AND (last_run IS NULL OR next_run <= ?)
  `).all(now.toISOString()) as any[];
  
  for (const task of tasks) {
    // Check if should run
    if (shouldRun(task, now)) {
      // Emit event
      await emitEvent({
        type: task.task_type,
        userId: task.user_id,
        ...JSON.parse(task.payload),
      }, task.user_id);
      
      // Update next run
      const nextRun = calculateNextRun(task.cron_expression, now);
      db.prepare(`
        UPDATE scheduled_tasks 
        SET last_run = ?, next_run = ?
        WHERE id = ?
      `).run(now.toISOString(), nextRun.toISOString(), task.id);
    }
  }
}

function shouldRun(task: any, now: Date): boolean {
  if (!task.next_run) return true;
  return new Date(task.next_run) <= now;
}

function calculateNextRun(cronExpression: string, from: Date): Date {
  // Use cron-parser library
  const parser = require('cron-parser');
  const interval = parser.parseExpression(cronExpression);
  return interval.next().toDate();
}

// Run scheduler every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(runScheduler, 5 * 60 * 1000);
}
```

**Database Migration for Scheduler**
```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  payload TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run DATETIME,
  next_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);

CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX idx_scheduled_tasks_active ON scheduled_tasks(active);
```

---

### Phase 4.3: Durable Execution + Checkpoints (Week 3)

**Goal:** Add checkpointed execution for retry/resume.

#### Files to Create

**10. `/root/bing/lib/events/checkpoint.ts`** (200 lines)
```typescript
// State serialization for resume
import { getDatabase } from '@/lib/database/connection';

export interface Checkpoint {
  id: string;
  eventId: string;
  step: string;
  state: Record<string, any>;
  createdAt: string;
}

export async function createCheckpoint(
  eventId: string,
  step: string,
  state: Record<string, any>
): Promise<Checkpoint> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  
  db.prepare(`
    INSERT INTO checkpoints (id, event_id, step, state, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, eventId, step, JSON.stringify(state));
  
  return { id, eventId, step, state, createdAt: new Date().toISOString() };
}

export async function getLatestCheckpoint(eventId: string): Promise<Checkpoint | null> {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM checkpoints 
    WHERE event_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(eventId) as any;
  
  return row ? { ...row, state: JSON.parse(row.state) } : null;
}

export async function deleteCheckpoints(eventId: string): Promise<void> {
  const db = getDatabase();
  db.prepare('DELETE FROM checkpoints WHERE event_id = ?').run(eventId);
}
```

**Database Migration**
```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  step TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX idx_checkpoints_event_id ON checkpoints(event_id);
```

#### Integration with DAG Executor

**Update `lib/chat/dag-refinement-engine.ts`**
```typescript
// Add checkpoint imports
import { createCheckpoint, getLatestCheckpoint } from '@/lib/events/checkpoint';

// In DAGExecutor class, add checkpoint boundaries
export class DAGExecutor {
  async execute(): Promise<string> {
    // Check for existing checkpoint
    const checkpoint = await getLatestCheckpoint(this.config.eventId);
    
    if (checkpoint) {
      // Resume from checkpoint
      logger.info('Resuming from checkpoint', { step: checkpoint.step });
      await this.restoreState(checkpoint.state);
    }
    
    // Execute tasks with checkpoints
    for (const [taskId, task] of this.tasks) {
      // Create checkpoint before task
      await createCheckpoint(this.config.eventId, `before_${taskId}`, {
        completedTasks: Array.from(this.completedTasks),
        partialResults: Object.fromEntries(this.partialResults),
      });
      
      // Execute task
      const result = await this.executeTask(task);
      
      // Create checkpoint after task
      await createCheckpoint(this.config.eventId, `after_${taskId}`, {
        completedTasks: Array.from(this.completedTasks),
        partialResults: Object.fromEntries(this.partialResults),
        [taskId]: result,
      });
    }
    
    // Clean up checkpoints on success
    await deleteCheckpoints(this.config.eventId);
    
    return this.mergeResults();
  }
}
```

---

### Phase 4.4: Human-in-the-Loop + Self-Healing (Week 4)

**Goal:** Add approval workflows and LLM-based error recovery.

#### Files to Create

**11. `/root/bing/lib/events/human-in-loop.ts`** (150 lines)
```typescript
// Wait for user approval
import { getDatabase } from '@/lib/database/connection';

export interface ApprovalRequest {
  eventId: string;
  action: string;
  details: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  respondedAt?: string;
  response?: string;
}

export async function createApprovalRequest(
  eventId: string,
  action: string,
  details: Record<string, any>
): Promise<ApprovalRequest> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  
  db.prepare(`
    INSERT INTO approval_requests 
    (id, event_id, action, details, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `).run(id, eventId, action, JSON.stringify(details));
  
  return {
    id,
    eventId,
    action,
    details,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

export async function waitForApproval(
  eventId: string,
  timeoutMs: number
): Promise<{ approved: boolean; response?: string }> {
  const db = getDatabase();
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const request = db.prepare(`
      SELECT * FROM approval_requests 
      WHERE event_id = ? AND status != 'pending'
    `).get(eventId) as any;
    
    if (request) {
      return {
        approved: request.status === 'approved',
        response: request.response,
      };
    }
    
    // Wait 5 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  throw new Error('Approval timeout');
}

export async function respondToApproval(
  requestId: string,
  approved: boolean,
  response?: string
): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    UPDATE approval_requests 
    SET status = ?, response = ?, responded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(approved ? 'approved' : 'rejected', response, requestId);
}
```

**Database Migration**
```sql
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX idx_approval_requests_event_id ON approval_requests(event_id);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
```

**12. `/root/bing/lib/events/self-healing.ts`** (200 lines)
```typescript
// LLM-based error recovery
import { llmService } from '@/lib/chat/llm-providers';
import { EventRecord } from './store';

export interface HealingResult {
  success: boolean;
  fix?: string;
  explanation?: string;
}

export async function attemptSelfHealing(
  event: EventRecord,
  error: string
): Promise<HealingResult> {
  // Get event context
  const context = {
    eventType: event.type,
    payload: event.payload,
    error,
    retryCount: event.retry_count,
  };
  
  // Ask LLM to diagnose and fix
  const response = await llmService.generateResponse({
    provider: 'openrouter',
    model: 'anthropic/claude-3-5-sonnet',
    messages: [
      {
        role: 'system',
        content: `You are a self-healing system debugger. 
        Analyze the failed event and suggest a fix.`,
      },
      {
        role: 'user',
        content: `Event failed:
        Type: ${context.eventType}
        Payload: ${JSON.stringify(context.payload)}
        Error: ${context.error}
        Retry count: ${context.retryCount}
        
        Suggest a fix or explain why this cannot be auto-fixed.`,
      },
    ],
    maxTokens: 1000,
  });
  
  // Parse LLM response
  const fix = extractFixFromResponse(response.content);
  
  if (fix) {
    // Apply fix and retry
    return {
      success: true,
      fix,
      explanation: response.content,
    };
  }
  
  return {
    success: false,
    explanation: 'Cannot auto-fix this error',
  };
}

function extractFixFromResponse(response: string): string | null {
  // Look for code blocks or fix patterns
  const match = response.match(/```(?:typescript|json)?\s*([\s\S]*?)```/);
  return match ? match[1] : null;
}
```

#### Integration with Event Router

**Update `lib/events/router.ts`**
```typescript
// Add self-healing import
import { attemptSelfHealing } from './self-healing';

export async function routeEvent(event: EventRecord): Promise<void> {
  try {
    await markEventRunning(event.id);
    
    switch (event.type) {
      // ... handlers
    }
    
    await markEventComplete(event.id);
  } catch (error: any) {
    // Attempt self-healing
    if (event.retry_count < 3) {
      const healing = await attemptSelfHealing(event, error.message);
      
      if (healing.success && healing.fix) {
        // Apply fix and retry
        logger.info('Self-healing succeeded, retrying', { eventId: event.id });
        await retryEventWithFix(event.id, healing.fix);
        return;
      }
    }
    
    await markEventFailed(event.id, error.message);
    throw error;
  }
}

async function retryEventWithFix(eventId: string, fix: string): Promise<void> {
  const db = getDatabase();
  db.prepare(`
    UPDATE events 
    SET status = 'pending', 
        error = NULL,
        retry_count = retry_count + 1,
        metadata = json_set(metadata, '$.fix', ?)
    WHERE id = ?
  `).run(fix, eventId);
}
```

---

## Part 4: UI Integration

### Real-Time Event Monitor

**`/root/bing/components/event-monitor.tsx`** (300 lines)
```typescript
'use client';

import { useEffect, useState } from 'react';

interface EventLog {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  error?: string;
}

export function EventMonitor({ userId }: { userId: string }) {
  const [events, setEvents] = useState<EventLog[]>([]);
  
  useEffect(() => {
    // Poll for event updates
    const interval = setInterval(async () => {
      const response = await fetch(`/api/events?userId=${userId}`);
      const data = await response.json();
      setEvents(data.events);
    }, 2000);
    
    return () => clearInterval(interval);
  }, [userId]);
  
  return (
    <div className="event-monitor">
      <h3>Event Logs</h3>
      <ul>
        {events.map(event => (
          <li key={event.id} className={`status-${event.status}`}>
            <span>{event.type}</span>
            <span>{event.status}</span>
            <span>{new Date(event.createdAt).toLocaleString()}</span>
            {event.error && <span className="error">{event.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**API Endpoint**
```typescript
// /root/bing/app/api/events/route.ts (GET handler)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }
  
  const db = getDatabase();
  const events = db.prepare(`
    SELECT * FROM events 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 50
  `).all(userId);
  
  return NextResponse.json({ events });
}
```

---

## Part 5: Testing Strategy

### Unit Tests
```typescript
// __tests__/events/event-store.test.ts
import { createEvent, getPendingEvents, markEventComplete } from '@/lib/events/store';

describe('Event Store', () => {
  it('should create and retrieve event', async () => {
    const event = await createEvent({
      type: 'HACKER_NEWS_DAILY',
      userId: 'user_123',
      destination: 'test@example.com',
      time: '09:00',
    }, 'user_123');
    
    expect(event.id).toBeDefined();
    expect(event.status).toBe('pending');
  });
  
  it('should update event status', async () => {
    // ... test markEventComplete
  });
});
```

### Integration Tests
```typescript
// __tests__/events/event-router.test.ts
import { routeEvent } from '@/lib/events/router';

describe('Event Router', () => {
  it('should route and complete event', async () => {
    const event = await createEvent({
      type: 'HACKER_NEWS_DAILY',
      userId: 'user_123',
      destination: 'test@example.com',
    }, 'user_123');
    
    await routeEvent(event);
    
    const updated = await getEventById(event.id);
    expect(updated?.status).toBe('completed');
  });
});
```

### E2E Tests
```typescript
// tests/e2e/event-system.test.ts
import { test, expect } from '@playwright/test';

test('Event system end-to-end', async ({ page }) => {
  // 1. Schedule task via chat
  await page.fill('[data-testid="chat-input"]', 'Summarize HN daily at 9 AM');
  await page.click('[data-testid="send-button"]');
  
  // 2. Check event was created
  const events = await page.request.get('/api/events?userId=test');
  expect(events.json().events).toHaveLength(1);
  
  // 3. Trigger scheduler manually
  await page.request.post('/api/events/scheduler/run');
  
  // 4. Wait for completion
  await page.waitForTimeout(5000);
  
  // 5. Verify event completed
  const updated = await page.request.get('/api/events?userId=test');
  expect(updated.json().events[0].status).toBe('completed');
});
```

---

## Part 6: Rollout Plan

### Week 1: Event Store + Bus
- [ ] Create schema.ts, store.ts, bus.ts
- [ ] Run database migration
- [ ] Update task-router.ts to emit events
- [ ] Test event creation/retrieval

### Week 2: Event Router + Handlers
- [ ] Create router.ts, scheduler.ts
- [ ] Implement 3 handlers (HN, research, email)
- [ ] Test event routing
- [ ] Test scheduler polling

### Week 3: Durable Execution
- [ ] Create checkpoint.ts
- [ ] Update DAG executor with checkpoints
- [ ] Test retry/resume
- [ ] Test checkpoint cleanup

### Week 4: Human-in-the-Loop + Self-Healing
- [ ] Create human-in-loop.ts, self-healing.ts
- [ ] Add approval UI component
- [ ] Test approval workflow
- [ ] Test self-healing retry

### Week 5: Polish + Documentation
- [ ] Add event monitor UI
- [ ] Write API documentation
- [ ] Add error handling
- [ ] Performance optimization

---

## Part 7: Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Event durability | 99.9% | Events completed vs created |
| Retry success rate | 80% | Self-healed events / failed events |
| Scheduler latency | <5 min | Event created → handler started |
| Checkpoint overhead | <10% | Execution time with vs without |
| User satisfaction | 4.5/5 | Post-task survey |

---

## Conclusion

This plan **builds upon** your existing infrastructure rather than replacing it:

- ✅ Uses existing SSE event schema
- ✅ Integrates with existing task router
- ✅ Enhances existing DAG executor
- ✅ Leverages existing SQLite database
- ✅ Works with existing session manager

**Total new code:** ~2,000 lines across 12 files  
**Existing code modified:** ~200 lines across 5 files  
**Risk level:** Low (additive, not breaking changes)

**Ready to implement Phase 4.1?**
