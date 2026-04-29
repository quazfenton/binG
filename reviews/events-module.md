# Code Review: web/lib/events Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/events/ (13 files)

---

## Module Overview

The events module provides event-driven architecture including event bus, triggers, scheduler, and human-in-the-loop handling.

---

## Architecture

```
┌─────────────────────────────────────┐
│ Event Bus (bus.ts)                   │
│ - pub/sub pattern                    │
├─────────────────────────────────────┤
│ Event Router (router.ts)             │
│ - route events to handlers           │
├─────────────────────────────────────┤
│ Scheduler (scheduler.ts)              │
│ - cron-style scheduling              │
├─────────────────────────────────────┤
│ Triggers                            │
│ - trigger-integration.ts             │
│ - trigger-dev-tasks.ts              │
└─────────────────────────────────────┘
```

---

## Files

| File | Lines | Purpose |
|------|-------|--------|
| bus.ts | ~200 | Event bus/pub-sub |
| router.ts | ~150 | Event routing |
| scheduler.ts | ~200 | Cron scheduling |
| trigger-integration.ts | ~200 | Trigger integration |
| human-in-loop.ts | ~150 | HITL workflow |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |

---

## Detailed Findings

### HIGH PRIORITY

#### 1. Event Bus Memory Leak (bus.ts)
**File:** bus.ts  
**Lines:** ~50-80

**Issue:** Subscriptions never cleaned up. Memory grows unboundedly.

**Recommendation:** Add unsubscribe tracking and cleanup.

---

### MEDIUM PRIORITY

1. **No event persistence** - Events lost on restart
2. **Scheduler not distributed** - Won't work across instances

### LOW PRIORITY

1. No event schema validation
2. Missing event ordering guarantees
3. Magic strings for event names

---

## Security Assessment

### Good
1. Event type validation
2. Handler isolation

### Concerns
1. No authentication on events
2. Event injection possible

---

## Summary

Events module provides solid event architecture. Main concern is subscription cleanup.

---

*End of Review*