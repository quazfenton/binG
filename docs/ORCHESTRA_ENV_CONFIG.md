# Orchestra Improvements - Environment Configuration

## New Environment Variables (Added in this update)

### Task Classifier Configuration

```bash
# Task Classifier Thresholds
# Complexity scores below this are classified as 'simple'
TASK_CLASSIFIER_SIMPLE_THRESHOLD=0.3

# Complexity scores above this are classified as 'complex'
TASK_CLASSIFIER_COMPLEX_THRESHOLD=0.7

# Feature flags
TASK_CLASSIFIER_ENABLE_SEMANTIC=true      # Enable LLM-based semantic analysis
TASK_CLASSIFIER_ENABLE_HISTORY=true       # Enable historical learning
TASK_CLASSIFIER_ENABLE_CONTEXT=true       # Enable context-aware classification

# Weight configuration (must sum to ~1.0)
TASK_CLASSIFIER_SEMANTIC_WEIGHT=0.3
TASK_CLASSIFIER_CONTEXT_WEIGHT=0.2
TASK_CLASSIFIER_HISTORY_WEIGHT=0.1

# Fast model for semantic analysis (uses less tokens)
FAST_MODEL=gpt-3.5-turbo
```

### Session Lock Configuration

```bash
# Redis Lock (Primary Strategy)
# Timeout for acquiring Redis lock (milliseconds)
SESSION_LOCK_REDIS_TIMEOUT=10000

# Memory Lock (Secondary Strategy)
# TTL for memory-based locks (milliseconds)
SESSION_LOCK_MEMORY_TTL=30000

# Queue Lock (Tertiary Strategy)
# Timeout for queue-based locking (milliseconds)
SESSION_LOCK_QUEUE_TIMEOUT=60000

# Unified Lock
# General timeout for lock acquisition
SESSION_LOCK_TIMEOUT=10000

# Metrics and Monitoring
SESSION_LOCK_METRICS_ENABLED=true

# Alert threshold (success rate below this triggers alert)
SESSION_LOCK_ALERT_THRESHOLD=0.9

# Optional: Webhook for alerts
LOCK_ALERT_WEBHOOK_URL=https://your-webhook.com/alerts

# Optional: StatsD integration
STATSD_HOST=localhost:8125
```

### Project Context (Optional)

```bash
# Project size for context-aware classification
# Values: small | medium | large
PROJECT_SIZE=medium

# Agent preference for mode selection
# Values: fast | balanced | thorough
AGENT_PREFERENCE=balanced
```

## Usage Examples

### Task Classifier

```typescript
import { createTaskClassifier } from '@/lib/agent/task-classifier';

const classifier = createTaskClassifier({
  simpleThreshold: 0.3,
  complexThreshold: 0.7,
  enableSemanticAnalysis: true,
});

const result = await classifier.classify(
  'Implement OAuth2 authentication with JWT tokens',
  {
    projectSize: 'large',
    userPreference: 'thorough',
  }
);

console.log(result);
// {
//   complexity: 'complex',
//   recommendedMode: 'stateful-agent',
//   confidence: 0.89,
//   reasoning: [...]
// }
```

### Session Lock

```typescript
import { acquireUnifiedLock } from '@/lib/session';

// Automatic fallback: Redis → Memory → Queue
const { release, strategy, duration } = await acquireUnifiedLock({
  sessionId: 'user-123-conversation-456',
  timeout: 10000,
});

try {
  // Critical section - exclusive access to session
  await performSessionOperations();
} finally {
  await release();
}
```

### Lock Metrics

```typescript
import { getLockMetrics, getLockHealth } from '@/lib/session';

// Get comprehensive metrics
const metrics = getLockMetrics();
console.log(metrics.successRate); // 0.95
console.log(metrics.byStrategy.redis.successRate); // 0.98
console.log(metrics.recent.last5Minutes.successRate); // 0.92

// Get health status
const health = getLockHealth();
console.log(health.status); // 'healthy' | 'degraded' | 'unhealthy'
console.log(health.recommendation); // Actionable advice
```

## Migration Guide

### Before (Fragile Regex)

```typescript
// Old approach
const isComplexTask = /(create|build|implement|...)/i.test(userMessage);
if (isComplexTask) {
  return 'stateful-agent';
}
```

### After (Task Classifier)

```typescript
// New approach
import { classifyTask } from '@/lib/agent/task-classifier';

const classification = await classifyTask(userMessage, {
  projectSize: 'large',
});

// classification.recommendedMode = 'stateful-agent' (intelligent)
// classification.confidence = 0.89 (knows when unsure)
// classification.reasoning = [...] (explainable)
```

### Before (Silent Lock Failure)

```typescript
// Old approach - silent no-op fallback
async function acquireLock(sessionId: string) {
  try {
    return await redisLock(sessionId);
  } catch {
    return () => {}; // Silent no-op - DANGEROUS!
  }
}
```

### After (Multi-Strategy with Alerts)

```typescript
// New approach - guaranteed locking or error
import { acquireUnifiedLock } from '@/lib/session';

const { release, strategy } = await acquireUnifiedLock({ sessionId });
// strategy = 'redis' | 'memory' | 'queue'
// Automatically falls back and records metrics
// Alerts if success rate drops below threshold
```

## Testing

### Unit Tests

```bash
# Run task classifier tests
npm test -- task-classifier

# Run session lock tests
npm test -- session-lock
npm test -- memory-lock
npm test -- queue-lock
```

### Integration Tests

```bash
# Test full flow with Redis
REDIS_URL=redis://localhost:6379 npm test -- integration:locks

# Test without Redis (memory fallback)
REDIS_URL='' npm test -- integration:locks-fallback
```

## Monitoring Dashboard

### Key Metrics to Track

1. **Task Classification**
   - Classification distribution (simple/moderate/complex)
   - Confidence scores
   - Mode routing accuracy

2. **Session Locks**
   - Success rate by strategy
   - Average acquisition time
   - Fallback frequency
   - Alert count

3. **Health Status**
   - Redis connectivity
   - Memory lock count
   - Queue depth

### Alerting Rules

```yaml
# Example Prometheus alerting rules
groups:
  - name: session-locks
    rules:
      - alert: SessionLockSuccessRateLow
        expr: session_lock_success_rate < 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Session lock success rate below 90%
          
      - alert: RedisLockUnavailable
        expr: session_lock_redis_available == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: Redis lock strategy unavailable
```

## Troubleshooting

### Task Classifier Issues

**Problem:** Classification always returns 'simple'
- Check `TASK_CLASSIFIER_COMPLEX_THRESHOLD` (should be 0.7)
- Verify semantic analysis is enabled
- Check FAST_MODEL is configured

**Problem:** Classification too slow
- Reduce semantic analysis weight
- Use faster model (gpt-3.5-turbo)
- Disable historical learning if not needed

### Session Lock Issues

**Problem:** All strategies failing
- Check Redis connectivity: `redis-cli ping`
- Verify memory isn't exhausted
- Check for deadlocks in queue

**Problem:** Frequent fallbacks to memory/queue
- Check Redis health: `getLockStrategyHealth()`
- Review Redis logs for errors
- Consider increasing `SESSION_LOCK_REDIS_TIMEOUT`

## Performance Considerations

### Task Classifier

- **Semantic analysis**: Adds ~200-500ms (LLM call)
- **Historical learning**: ~5ms (in-memory lookup)
- **Context analysis**: ~1ms (pattern matching)

**Recommendation:** Enable all features for production, disable semantic analysis for latency-critical paths.

### Session Locks

- **Redis lock**: ~5-20ms (network round-trip)
- **Memory lock**: ~0.1ms (in-memory)
- **Queue lock**: ~0.1ms + wait time

**Recommendation:** Redis for production multi-instance, memory for development single-instance.
