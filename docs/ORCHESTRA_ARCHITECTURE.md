# Orchestra Architecture - Updated

## Task Classification Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Request                                    │
│                    "Implement OAuth2 auth"                              │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Task Classifier (NEW)                                │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐                            │
│  │ Keyword Analysis │  │ Semantic Analysis│                            │
│  │ Score: 0.72      │  │ Score: 0.81      │                            │
│  │ +3 "auth"        │  │ 6 files, 8 steps │                            │
│  │ +2 "implement"   │  │ requires research│                            │
│  └──────────────────┘  └──────────────────┘                            │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐                            │
│  │ Context Analysis │  │ History Learning │                            │
│  │ Score: 0.65      │  │ Score: 0.50      │                            │
│  │ large project    │  │ (no prior data)  │                            │
│  └──────────────────┘  └──────────────────┘                            │
│                                                                         │
│  WEIGHTED AVERAGE: 0.73 → COMPLEX                                       │
│  CONFIDENCE: 0.89 (factors agree)                                       │
│  RECOMMENDED MODE: stateful-agent                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Mode Router                                        │
│                                                                         │
│  classification.recommendedMode = 'stateful-agent'                      │
│  Check provider health → v2-native available ✓                          │
│  Route to: runV2Native() → runStatefulAgentMode()                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    StatefulAgent Execution                              │
│  Discovery → Planning → Editing → Verification → Reflection             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Session Lock Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    acquireUnifiedLock(sessionId)                        │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STRATEGY 1: REDIS (Primary)                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ checkRedisHealth() → PONG ✓                                      │  │
│  │ redis.set(lockKey, value, 'EX', 30, 'NX')                        │  │
│  │                                                                   │  │
│  │ If successful:                                                    │  │
│  │   → Record metric: { strategy: 'redis', success: true }          │  │
│  │   → Return release function (atomic Lua script)                  │  │
│  │                                                                   │  │
│  │ If failed:                                                        │  │
│  │   → Record metric: { strategy: 'redis', error: '...' }           │  │
│  │   → Try next strategy                                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
                                 │
                                 ▼ (if Redis fails)
┌─────────────────────────────────────────────────────────────────────────┐
│  STRATEGY 2: MEMORY (Secondary)                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ memoryLocks.set(sessionId, { value, expires, acquired })         │  │
│  │                                                                   │  │
│  │ If successful:                                                    │  │
│  │   → Record metric: { strategy: 'memory', success: true }         │  │
│  │   → Return release function (ownership check)                    │  │
│  │                                                                   │  │
│  │ If failed (lock held):                                            │  │
│  │   → Record metric: { strategy: 'memory', error: 'held' }         │  │
│  │   → Try next strategy                                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
                                 │
                                 ▼ (if Memory fails)
┌─────────────────────────────────────────────────────────────────────────┐
│  STRATEGY 3: QUEUE (Tertiary)                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ sessionQueues.get(sessionId).entries.push(request)               │  │
│  │                                                                   │  │
│  │ Wait until front of queue                                        │  │
│  │                                                                   │  │
│  │ When acquired:                                                    │  │
│  │   → Record metric: { strategy: 'queue', success: true }          │  │
│  │   → Return release function (processes next in queue)            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
                                 │
                                 ▼ (if ALL fail)
┌─────────────────────────────────────────────────────────────────────────┐
│  THROW ERROR                                                            │
│  "Failed to acquire session lock after 3 strategies"                    │
│  → No silent degradation                                                │
│  → Triggers alerting                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Metrics & Alerting Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Lock Metric Recorded                                 │
│  { strategy: 'redis', sessionId: '...', duration: 15, error?: '...' }   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Metrics Buffer (max 1000)                            │
│  [metric1, metric2, metric3, ..., metric1000]                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼ (Every 60 seconds)
┌─────────────────────────────────────────────────────────────────────────┐
│                    Alert Monitor Check                                  │
│                                                                         │
│  recent = metrics.slice(-100)  // Last 100 attempts                     │
│  successRate = recent.filter(m => !m.error).length / recent.length      │
│                                                                         │
│  If successRate < 0.9 (threshold):                                      │
│    → Log error with breakdown by strategy                               │
│    → Send webhook alert (if configured)                                 │
│    → Emit to StatsD (if configured)                                     │
│    → Add to alert history (max 10)                                      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Health Status                                        │
│                                                                         │
│  getLockHealth():                                                       │
│    - healthy: successRate >= 0.9                                        │
│    - degraded: 0.7 <= successRate < 0.9                                 │
│    - unhealthy: successRate < 0.7                                       │
│                                                                         │
│  Returns actionable recommendation                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Dependencies

```
lib/
├── agent/
│   ├── task-classifier.ts ─────────────────┐
│   │   └── Uses: ai (generateObject)       │
│   │                                        │
│   └── index.ts                             │
│       └── Exports: task-classifier ────────┤
│                                            │
├── orchestra/                               │
│   ├── unified-agent-service.ts             │
│   │   └── Imports: task-classifier ◄───────┤
│   │       └── Routes based on classification
│   │                                         │
│   └── stateful-agent/                      │
│       └── agents/                          │
│           └── stateful-agent.ts            │
│               └── Uses: unified-lock ◄─────┼──┐
│                                             │  │
├── session/                                  │  │
│   ├── unified-lock.ts ◄─────────────────────┼──┘
│   │   └── Orchestrates:                     │
│   │       ├── session-lock.ts (Redis)       │
│   │       ├── memory-lock.ts                │
│   │       └── queue-lock.ts                 │
│   │                                         │
│   ├── session-lock.ts                       │
│   │   └── Uses: redis-client                │
│   │                                         │
│   ├── memory-lock.ts                        │
│   │   └── In-memory Map                     │
│   │                                         │
│   ├── queue-lock.ts                         │
│   │   └── In-memory queues                  │
│   │                                         │
│   ├── lock-metrics.ts                       │
│   │   └── Metrics buffer + alerting         │
│   │                                         │
│   └── index.ts                              │
│       └── Exports all lock modules ─────────┘
```

## Data Flow Example

```
User: "Implement JWT authentication"

1. TASK CLASSIFICATION
   ────────────────────
   Input: "Implement JWT authentication"
   Context: { projectSize: 'large', userPreference: 'thorough' }
   
   Keyword Score:     0.75 (+3 "authentication", +2 "implement", +2 "JWT")
   Semantic Score:    0.85 (LLM: 8 files, 12 steps, high risk)
   Context Score:     0.65 (large project)
   Historical Score:  0.50 (no prior data)
   
   Weighted: 0.75*0.4 + 0.85*0.3 + 0.65*0.2 + 0.50*0.1 = 0.735
   → COMPLEX (> 0.7 threshold)
   Confidence: 0.87 (factors agree)
   Recommended: stateful-agent

2. MODE ROUTING
   ────────────
   classification.recommendedMode = 'stateful-agent'
   Provider health check: v2-native available ✓
   → Route to: runStatefulAgentMode()

3. SESSION LOCK ACQUISITION
   ─────────────────────────
   acquireUnifiedLock({ sessionId: 'user-123' })
   
   Try Redis:
     checkRedisHealth() → PONG ✓
     redis.set('session:lock:user-123', 'value', 'EX', 30, 'NX') → OK
     → Acquired via Redis (15ms)
     → Record metric: { strategy: 'redis', duration: 15, success: true }
   
4. AGENT EXECUTION
   ────────────────
   StatefulAgent.run()
   ├── Discovery (read files)
   ├── Planning (create task graph)
   ├── Editing (apply changes)
   ├── Verification (validate)
   └── Reflection (improve)
   
   All operations protected by session lock
   → No concurrent modification possible

5. LOCK RELEASE
   ─────────────
   release() → Lua script atomic delete
   → Record metric: { duration: 45000 }

6. METRICS AGGREGATION (every 60s)
   ────────────────────────────────
   getLockMetrics() → {
     totalAttempts: 150,
     successRate: 0.97,
     byStrategy: {
       redis: { attempts: 145, successRate: 0.98 },
       memory: { attempts: 5, successRate: 1.0 },
       queue: { attempts: 0, successRate: 0 }
     },
     recent: {
       last5Minutes: { successRate: 0.96, attempts: 25 }
     }
   }
   
   Health: healthy (0.96 > 0.9 threshold)
```
