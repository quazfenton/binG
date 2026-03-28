# Mistral Fallback for Spec Amplification

## Issue

**Log Message:**
```
[API:ResponseRouter] No fast model available
```

**Problem:** When there's no telemetry data yet (fresh database), spec amplification would fail and fall back to normal routing.

---

## Fix Applied

**File:** `lib/api/response-router.ts`

```typescript
// Get fastest model from telemetry
let fastModel = getSpecGenerationModel()

// Fallback: If no telemetry data available, use Mistral Small (fast & cheap)
if (!fastModel) {
  logger.info('No telemetry data available, using Mistral Small as fallback')
  fastModel = {
    provider: 'mistral',
    model: 'mistral-small-latest',
    avgLatency: 500,
    failureRate: 0.01,
    lastUpdated: Date.now(),
    totalCalls: 0,
    successRate: 0.99,
    score: 0.5,
    rank: 1
  }
}
```

---

## Why Mistral Small?

| Criteria | Mistral Small |
|----------|---------------|
| **Speed** | ⚡ Fast (~500ms) |
| **Cost** | 💰 Cheap |
| **Quality** | ✅ Good for spec generation |
| **Availability** | ✅ Always available |
| **Context** | ✅ 32K tokens (enough for specs) |

---

## Behavior

### With Telemetry Data

```
[API:ResponseRouter] Spec amplification enabled
  fastModel: google/gemini-2.5-flash
  fromTelemetry: true
```

### Without Telemetry Data (Fallback)

```
[API:ResponseRouter] No telemetry data available, using Mistral Small as fallback

[API:ResponseRouter] Spec amplification enabled
  fastModel: mistral-small-latest
  fromTelemetry: false
```

---

## Testing

### Fresh Database (No Telemetry)

```bash
# First request (no telemetry yet)
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Build app"}], "mode": "max"}'
```

**Expected:**
- ✅ Uses `mistral-small-latest` for spec generation
- ✅ Spec amplification works
- ✅ Response includes metadata

### After Some Requests (With Telemetry)

```bash
# After several requests
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Build app"}], "mode": "max"}'
```

**Expected:**
- ✅ Uses fastest model from telemetry
- ✅ Spec amplification works
- ✅ Response includes metadata

---

## Override Fallback (Optional)

If you want to use a different fallback model:

**Edit:** `lib/api/response-router.ts`

```typescript
fastModel = {
  provider: 'google',  // Change provider
  model: 'gemini-2.5-flash',  // Change model
  avgLatency: 400,
  failureRate: 0.01,
  lastUpdated: Date.now(),
  totalCalls: 0,
  successRate: 0.99,
  score: 0.5,
  rank: 1
}
```

---

## Status

✅ **Fixed** - Always has a fast model for spec amplification

**No more "No fast model available" errors!** 🚀
