---
id: phase-4-durable-event-sourced-task-system
title: 'Phase 4: Durable Event-Sourced Task System'
aliases:
  - PHASE_4_UPDATED_IMPLEMENTATION_PLAN
  - PHASE_4_UPDATED_IMPLEMENTATION_PLAN.md
  - phase-4-durable-event-sourced-task-system
  - phase-4-durable-event-sourced-task-system.md
tags: []
layer: core
summary: "# Phase 4: Durable Event-Sourced Task System\r\n## Updated Implementation Plan (Based on Existing Codebase Analysis)\r\n\r\n**Date:** March 10, 2026  \r\n**Status:** Ready for Implementation  \r\n**Integration Strategy:** Build upon existing worker infrastructure\r\n\r\n---\r\n\r\n## Part 1: Existing Infrastructure A"
anchors:
  - Updated Implementation Plan (Based on Existing Codebase Analysis)
  - 'Part 1: Existing Infrastructure Analysis'
  - 1.1 Worker Architecture (What You Already Have)
  - Background Jobs System ✅
  - Agent Orchestration ✅
  - Event System ✅
  - Session Management ✅
  - 1.2 What's Missing (To Add)
  - 'Part 2: Updated Architecture'
  - 2.1 System Diagram (Integration with Existing)
  - 2.2 Event Flow (With Existing Integration)
  - 'Part 3: Implementation (Minimal Changes)'
  - 'Phase 4.1: Event Store + Bus (Week 1)'
  - Files to Create
  - Database Migration
  - Integration with Existing Code
  - 'Phase 4.2: Dynamic Scheduler (Week 2)'
  - 'Part 4: Integration Points'
  - 4.1 Integration with EnhancedBackgroundJobsManager
  - 4.2 Integration with AgentOrchestrator
  - 4.3 Integration with WorkflowTemplates
  - 'Part 5: Rollout Plan'
  - 'Week 1: Event Store + Bus'
  - 'Week 2: Dynamic Scheduler'
  - 'Week 3: Event Router + Handlers'
  - 'Week 4: Polish + Documentation'
  - 'Part 6: Summary'
  - What We're Adding
  - What We're Reusing
  - Risk Level
  - Ready to Implement?
---
# Phase 4: Durable Event-Sourced Task System
## Updated Implementation Plan (Based on Existing Codebase Analysis)

**Date:** March 10, 2026  
**Status:** Ready for Implementation  
**Integration Strategy:** Build upon existing worker infrastructure

---

## Part 1: Existing Infrastructure Analysis

### 1.1 Worker Architecture (What You Already Have)

#### Background Jobs System ✅
```
lib/agent/background-jobs.ts (374 lines)
├── BackgroundExecutor class (EventEmitter)
├── Interval-based job execution
├── Job status: running/paused/stopped
├── Execution loop with retry
└── Event emission (executed/error/stopped)

lib/agent/enhanced-background-jobs.ts (915 lines)
├── EnhancedBackgroundJobsManager
├── Session-aware job management
├── Quota tracking (compute/io/api)
├── Execution graph integration
├── Max executions limit
├── LLM-evaluated stop conditions
├── Loop token for duplicate prevention
└── Comprehensive event system (10 event types)
```

#### Agent Orchestration ✅
```
lib/agent/orchestration/agent-orchestrator.ts (361 lines)
├── IterationController (budgets: steps/tokens/time)
├── Plan → Act → Verify → Respond phases
├── Self-healing executor
├── SSE event emission at state transitions
└── Tool execution with retry

lib/agent/workflow-templates.ts (606 lines)
├── 12 pre-built workflow templates
├── Mastra workflow integration
├── Approval gates (human-in-the-loop)
├── Memory wipe workflows
└── Execution history tracking
```

#### Event System ✅
```
lib/streaming/sse-event-schema.ts (299 lines)
├── 22 SSE event types
├── Typed payloads (SSETokenPayload, etc.)
├── sseEncode() helper
└── createSSEEmitter() factory

lib/mcp/client.ts
├── MCP event emitter
├── onEvent/offEvent methods
└── Event types: tool_registered, resource_registered, etc.
```

#### Session Management ✅
```
lib/session/session-manager.ts (996 lines)
├── Session with backgroundJobs Map
├── executionGraphId tracking
├── Quota tracking
└── SQLite persistence
```

### 1.2 What's Missing (To Add)

| Feature | Current State | Phase 4 Addition |
|---------|--------------|------------------|
| **Event Store** | SSE (ephemeral) | SQLite append-only log |
| **Event Schemas** | SSE payload types | Zod-validated schemas |
| **Dynamic Scheduler** | Fixed interval jobs | DB-backed cron poller |
| **Event Router** | Hardcoded in executor | Switch-based dispatch |
| **Cross-Session Events** | Session-scoped only | User-scoped events |
| **Replay System** | Not implemented | Event replay API |

---

## Part 2: Updated Architecture

### 2.1 System Diagram (Integration with Existing)

```
┌─────────────────────────────────────────────────────────────┐
│                    Existing Infrastructure                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ EnhancedBackgroundJobsManager                         │   │
│  │ - Job execution loop                                  │   │
│  │ - Quota tracking                                      │   │
│  │ - Execution graph integration                         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ AgentOrchestrator                                     │   │
│  │ - Plan → Act → Verify → Respond                       │   │
│  │ - Self-healing                                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ emit events
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              NEW: Event Layer (Phase 4)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ emitEvent() → Event Store (SQLite)                    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Dynamic Scheduler (polls every 5 min)                 │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Event Router (switch-based dispatch)                  │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Handlers (HN Daily, Research, Email, etc.)            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ calls existing
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Re-use Existing Executors                        │
│  - EnhancedBackgroundJobsManager.executeJobLoop()           │
│  - AgentOrchestrator.execute()                              │
│  - workflowTemplateService.executeTemplate()                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Event Flow (With Existing Integration)

```
1. User Request (Chat/Tool)
   "Summarize Hacker News daily at 9 AM"
   ↓
2. Tool Execution (existing)
   schedule_task tool → emitEvent() [NEW]
   ↓
3. Event Persistence [NEW]
   INSERT INTO events (type, payload, status, user_id)
   ↓
4. Dynamic Scheduler [NEW]
   Every 5 min: SELECT * FROM events WHERE status = 'pending'
   ↓
5. Event Router [NEW]
   switch (event.type) { case 'HACKER_NEWS_DAILY': ... }
   ↓
6. Handler Execution [NEW]
   Uses EXISTING EnhancedBackgroundJobsManager.startJob()
   ↓
7. Status Update [NEW]
   UPDATE events SET status = 'completed'
```

---

## Part 3: Implementation (Minimal Changes)

### Phase 4.1: Event Store + Bus (Week 1)

#### Files to Create

**1. `/root/bing/lib/events/schema.ts`** (150 lines)
```typescript
// Zod-validated event schemas (integrates with existing tool types)
import { z } from 'zod';

// Re-use existing task types from task-router.ts
export const TaskTypes = {
  CODING: 'coding',
  MESSAGING: 'messaging',
  BROWSING: 'browsing',
  AUTOMATION: 'automation',
} as const;

export const EventSchemas = {
  // Scheduled tasks (new)
  SCHEDULED_TASK: z.object({
    type: z.literal('SCHEDULED_TASK'),
    taskType: z.enum(['HACKER_NEWS_DAILY', 'RESEARCH_TASK', 'SEND_EMAIL']),
    userId: z.string(),
    payload: z.record(z.any()),
    cronExpression: z.string().optional(),
  }),
  
  // Background job events (integrates with enhanced-background-jobs.ts)
  BACKGROUND_JOB: z.object({
    type: z.literal('BACKGROUND_JOB'),
    jobId: z.string(),
    sessionId: z.string(),
    sandboxId: z.string(),
    command: z.string(),
    interval: z.number(),
    userId: z.string(),
  }),
  
  // Agent orchestration events (integrates with agent-orchestrator.ts)
  ORCHESTRATION_STEP: z.object({
    type: z.literal('ORCHESTRATION_STEP'),
    sessionId: z.string(),
    phase: z.enum(['planning', 'acting', 'verifying', 'responding']),
    iteration: z.number(),
    userId: z.string(),
  }),
};

export const AnyEvent = z.discriminatedUnion('type', [
  EventSchemas.SCHEDULED_TASK,
  EventSchemas.BACKGROUND_JOB,
  EventSchemas.ORCHESTRATION_STEP,
]);

export type AnyEvent = z.infer<typeof AnyEvent>;
export type TaskType = typeof TaskTypes[keyof typeof TaskTypes];
```

**2. `/root/bing/lib/events/store.ts`** (200 lines)
```typescript
// SQLite event persistence (uses existing database connection)
import { getDatabase } from '@/lib/database/connection';
import { AnyEvent } from './schema';

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
  sessionId?: string;
  metadata?: Record<string, any>;
}

export async function createEvent(event: AnyEvent, userId: string, sessionId?: string): Promise<EventRecord> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  
  const stmt = db.prepare(`
    INSERT INTO events 
    (id, type, payload, status, retry_count, user_id, session_id, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?, ?, CURRENT_TIMESTAMP)
  `);
  
  stmt.run(id, event.type, JSON.stringify(event), userId, sessionId || null);
  
  return {
    id,
    type: event.type,
    payload: event,
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    userId,
    sessionId,
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

export async function replayFailedEvents(maxRetries: number = 3): Promise<number> {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE events 
    SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'failed' AND retry_count < ?
  `);
  const result = stmt.run(maxRetries);
  return result.changes;
}

export async function getEventsByUser(userId: string, limit: number = 50): Promise<EventRecord[]> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM events 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(userId, limit).map((row: any) => ({
    ...row,
    payload: JSON.parse(row.payload),
  }));
}
```

**3. `/root/bing/lib/events/bus.ts`** (80 lines)
```typescript
// Event emission layer (integrates with existing tools)
import { AnyEvent } from './schema';
import { createEvent } from './store';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Bus');

export interface EmitEventResult {
  eventId: string;
  status: 'queued';
}

/**
 * Emit event to event store
 * This is the ONLY function LLM tools should call
 */
export async function emitEvent(input: unknown, userId: string, sessionId?: string): Promise<EmitEventResult> {
  try {
    // Validate event schema
    const parsed = AnyEvent.parse(input);
    
    // Persist to event store
    const event = await createEvent(parsed, userId, sessionId);
    
    logger.info('Event emitted', {
      eventId: event.id,
      type: event.type,
      userId,
    });
    
    return {
      eventId: event.id,
      status: 'queued',
    };
  } catch (error: any) {
    logger.error('Failed to emit event', {
      error: error.message,
      input,
    });
    throw error;
  }
}

/**
 * Emit event and start background job immediately
 * Integrates with EnhancedBackgroundJobsManager
 */
export async function emitEventWithJob(
  input: AnyEvent,
  userId: string,
  sessionId: string,
  jobManager: any // EnhancedBackgroundJobsManager
): Promise<EmitEventResult & { jobId?: string }> {
  const eventResult = await emitEvent(input, userId, sessionId);
  
  // If it's a background job event, start the job immediately
  if (input.type === 'BACKGROUND_JOB') {
    try {
      const job = await jobManager.startJob({
        sessionId,
        sandboxId: input.sandboxId,
        command: input.command,
        interval: input.interval,
        quotaCategory: 'compute',
      });
      
      return {
        ...eventResult,
        jobId: job.jobId,
      };
    } catch (error: any) {
      logger.error('Failed to start background job', { error: error.message });
      await markEventFailed(eventResult.eventId, error.message);
      throw error;
    }
  }
  
  return eventResult;
}

import { markEventFailed } from './store';
```

**4. `/root/bing/app/api/events/route.ts`** (100 lines)
```typescript
// API endpoint for manual event triggers and monitoring
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { emitEvent } from '@/lib/events/bus';
import { getEventsByUser, replayFailedEvents } from '@/lib/events/store';
import { AnyEvent } from '@/lib/events/schema';

// GET: List user events
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    
    const events = await getEventsByUser(session.user.sub, limit);
    
    return NextResponse.json({
      success: true,
      events,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to get events',
    }, { status: 500 });
  }
}

// POST: Emit new event
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await request.json();
    const { event, sessionId } = body as { event: AnyEvent; sessionId?: string };
    
    if (!event) {
      return NextResponse.json({ error: 'Event required' }, { status: 400 });
    }
    
    const result = await emitEvent(event, session.user.sub, sessionId);
    
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

// POST: Replay failed events
export async function POST_REPLAY(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const maxRetries = parseInt(searchParams.get('maxRetries') || '3');
    
    const replayed = await replayFailedEvents(maxRetries);
    
    return NextResponse.json({
      success: true,
      replayed,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to replay events',
    }, { status: 500 });
  }
}
```

#### Database Migration

**`/root/bing/lib/database/migrations/001-events-table.sql`**
```sql
-- Event store for durable execution
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  user_id TEXT NOT NULL,
  session_id TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_status_type ON events(status, type);
```

#### Integration with Existing Code

**Update `lib/agent/task-router.ts`** (minimal change - 10 lines)
```typescript
// Add import at top
import { emitEvent } from '@/lib/events/bus';

// In executeTask method, add event emission for durable tasks
async executeTask(request: TaskRequest): Promise<any> {
  // NEW: Emit event for durable execution tracking
  if (request.executionPolicy === 'durable') {
    const event = await emitEvent({
      type: 'ORCHESTRATION_STEP',
      phase: 'planning',
      iteration: 0,
      sessionId: request.conversationId,
      userId: request.userId,
    }, request.userId, request.conversationId);
    
    return { eventId: event.eventId, status: 'queued' };
  }
  
  // Existing routing logic continues unchanged...
  const routing = this.analyzeTask(request.task);
  return this.dispatchToTarget(routing.target, request);
}
```

---

### Phase 4.2: Dynamic Scheduler (Week 2)

**5. `/root/bing/lib/events/scheduler.ts`** (150 lines)
```typescript
// Dynamic scheduler (DB poller → event emitter)
import { getDatabase } from '@/lib/database/connection';
import { emitEvent } from './bus';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Scheduler');

export interface ScheduledTask {
  id: string;
  userId: string;
  taskType: string;
  cronExpression: string;
  payload: string;
  active: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

/**
 * Run scheduler - poll DB and emit events
 * Called every 5 minutes by background interval
 */
export async function runScheduler(): Promise<{ emitted: number }> {
  const db = getDatabase();
  const now = new Date();
  
  // Query scheduled tasks that are due
  const tasks = db.prepare(`
    SELECT * FROM scheduled_tasks 
    WHERE active = TRUE 
      AND (last_run IS NULL OR next_run <= ?)
    ORDER BY next_run ASC
    LIMIT 100
  `).all(now.toISOString()) as ScheduledTask[];
  
  let emitted = 0;
  
  for (const task of tasks) {
    try {
      // Emit event for this task
      await emitEvent({
        type: 'SCHEDULED_TASK',
        taskType: task.taskType,
        userId: task.userId,
        payload: JSON.parse(task.payload),
        cronExpression: task.cronExpression,
      }, task.userId);
      
      // Calculate next run time
      const nextRun = calculateNextRun(task.cronExpression, now);
      
      // Update task
      db.prepare(`
        UPDATE scheduled_tasks 
        SET last_run = ?, next_run = ?
        WHERE id = ?
      `).run(now.toISOString(), nextRun.toISOString(), task.id);
      
      emitted++;
      logger.info('Scheduled task emitted', {
        taskId: task.id,
        taskType: task.taskType,
        nextRun: nextRun.toISOString(),
      });
    } catch (error: any) {
      logger.error('Failed to emit scheduled task', {
        taskId: task.id,
        error: error.message,
      });
    }
  }
  
  return { emitted };
}

/**
 * Calculate next run time from cron expression
 */
function calculateNextRun(cronExpression: string, from: Date): Date {
  try {
    // Use cron-parser library (add to package.json)
    const parser = require('cron-parser');
    const interval = parser.parseExpression(cronExpression, { currentDate: from });
    return interval.next().toDate();
  } catch (error: any) {
    logger.error('Failed to parse cron expression', {
      cronExpression,
      error: error.message,
    });
    // Fallback: 24 hours from now
    return new Date(from.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Start scheduler interval
 * Call this once on server startup
 */
export function startScheduler(intervalMs: number = 5 * 60 * 1000): void {
  logger.info('Starting scheduler', { intervalMs });
  
  // Run immediately
  runScheduler().catch(console.error);
  
  // Then run on interval
  setInterval(() => {
    runScheduler().catch(console.error);
  }, intervalMs);
}
```

**Database Migration for Scheduler**
```sql
-- Scheduled tasks table
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  payload TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run DATETIME,
  next_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX idx_scheduled_tasks_active ON scheduled_tasks(active);
CREATE INDEX idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
```

---

## Part 4: Integration Points

### 4.1 Integration with EnhancedBackgroundJobsManager

The existing `EnhancedBackgroundJobsManager` already has:
- Job execution loop
- Quota tracking
- Event emission
- Execution graph integration

**No changes needed** - the event system just adds persistence on top.

### 4.2 Integration with AgentOrchestrator

The existing `AgentOrchestrator` already has:
- Phase transitions (planning/acting/verifying/responding)
- SSE event emission
- Iteration tracking

**Optional enhancement:** Add event persistence
```typescript
// In lib/agent/orchestration/agent-orchestrator.ts
import { emitEvent } from '@/lib/events/bus';

async *execute(task: string, initialContext: any[]): AsyncGenerator<OrchestratorEvent> {
  // Emit event for phase change
  await emitEvent({
    type: 'ORCHESTRATION_STEP',
    phase: 'planning',
    iteration: 0,
    sessionId: this.sessionId,
    userId: this.userId,
  }, this.userId, this.sessionId);
  
  // ... rest of existing code
}
```

### 4.3 Integration with WorkflowTemplates

The existing `workflowTemplateService` already has:
- 12 pre-built templates
- Execution history
- Mastra integration

**Optional enhancement:** Add event logging
```typescript
// In lib/agent/workflow-templates.ts
import { emitEvent } from '@/lib/events/bus';

async executeTemplate(config: TemplateExecutionConfig): Promise<TemplateExecutionResult> {
  // Emit start event
  await emitEvent({
    type: 'WORKFLOW_STARTED',
    templateId: config.templateId,
    userId: this.userId,
  }, this.userId);
  
  // ... execute workflow
  
  // Emit complete event
  await emitEvent({
    type: 'WORKFLOW_COMPLETED',
    templateId: config.templateId,
    result,
  }, this.userId);
}
```

---

## Part 5: Rollout Plan

### Week 1: Event Store + Bus
- [ ] Create schema.ts, store.ts, bus.ts
- [ ] Create events table migration
- [ ] Create `/api/events/route.ts`
- [ ] Test event creation/retrieval
- [ ] Update task-router.ts to emit events (optional)

### Week 2: Dynamic Scheduler
- [ ] Create scheduler.ts
- [ ] Create scheduled_tasks table migration
- [ ] Add cron-parser to package.json
- [ ] Start scheduler on server startup
- [ ] Test scheduled task emission

### Week 3: Event Router + Handlers
- [ ] Create router.ts
- [ ] Create 3 sample handlers (HN, research, email)
- [ ] Test event routing
- [ ] Add retry logic

### Week 4: Polish + Documentation
- [ ] Add event monitor UI component
- [ ] Write API documentation
- [ ] Add error handling
- [ ] Performance optimization

---

## Part 6: Summary

### What We're Adding
- 5 new files (~700 lines)
- 2 database migrations
- Zero breaking changes

### What We're Reusing
- ✅ EnhancedBackgroundJobsManager (job execution)
- ✅ AgentOrchestrator (phase management)
- ✅ WorkflowTemplates (pre-built flows)
- ✅ SSE event schema (event types)
- ✅ Session manager (quota tracking)
- ✅ Database connection (SQLite)

### Risk Level
**LOW** - All additions are additive, existing code continues to work unchanged.

---

## Ready to Implement?

Start with **Week 1: Event Store + Bus** - creates the foundation for everything else.
